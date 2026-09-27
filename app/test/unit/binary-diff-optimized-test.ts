import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createBinaryDiff, findBinaryChanges } from '../../src/lib/binary-diff'
import {
  createBinaryDiff as createBaselineDiff,
  findBinaryChanges as findBaselineChanges,
} from '../fixtures/binary-diff-baseline'

function generator(seed: number) {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

function bytes(length: number, next = generator(0x12345678)) {
  const buffer = Buffer.alloc(length)
  for (let i = 0; i < length; i++) {
    buffer[i] = next() & 0xff
  }
  return buffer
}

function assertEquivalent(previous: Buffer, current: Buffer) {
  const result = findBinaryChanges(previous, current)
  assert.deepEqual(result, findBaselineChanges(previous, current))
  assert.deepEqual(
    createBinaryDiff(previous, current),
    createBaselineDiff(previous, current)
  )

  // Check an independent invariant as well as parity with the reference.
  // Applying every reported change must reconstruct the current buffer.
  if (!result.truncated) {
    const parts: Buffer[] = []
    let offset = 0
    for (const change of result.changes) {
      assert.ok(change.previousStart >= offset)
      parts.push(previous.subarray(offset, change.previousStart))
      parts.push(
        current.subarray(
          change.currentStart,
          change.currentStart + change.currentLength
        )
      )
      offset = change.previousStart + change.previousLength
    }
    parts.push(previous.subarray(offset))
    assert.deepEqual(Buffer.concat(parts), current)
  }
}

function hash(data: Buffer) {
  let value = 2166136261
  for (const byte of data) {
    value = Math.imul(value ^ byte, 16777619)
  }
  return value >>> 0
}

describe('binary diff optimized search', () => {
  it('handles empty, short, insert-only and delete-only inputs', async () => {
    for (const size of [0, 1, 2, 15, 16, 17, 31, 32, 255, 256, 257]) {
      const data = bytes(size)
      assertEquivalent(data, Buffer.from(data))
      assertEquivalent(data, Buffer.alloc(0))
      assertEquivalent(Buffer.alloc(0), data)
      for (const offset of [0, size - 1]) {
        if (offset >= 0 && offset < size) {
          const current = Buffer.from(data)
          current[offset] ^= 0xff
          assertEquivalent(data, current)
        }
      }
    }
  })

  it('matches native-compare and anchor boundaries', async () => {
    const previous = bytes(128 * 1024)
    for (const offset of [
      255, 256, 257, 4095, 4096, 4097, 16383, 16384, 16385, 65535, 65536, 65537,
    ]) {
      const current = Buffer.from(previous)
      current[offset] ^= 0xff
      current[current.length - 4] ^= 0xff
      assertEquivalent(previous, current)
    }
  })

  it('keeps alignment at resync window edges', async () => {
    const previous = bytes(160 * 1024)
    for (const size of [
      1, 2, 15, 16, 255, 256, 257, 4095, 4096, 4097, 65535, 65536, 65537,
    ]) {
      const inserted = Buffer.concat([
        previous.subarray(0, 64),
        bytes(size, generator(size + 1)),
        previous.subarray(64),
      ])
      inserted[inserted.length - 65] ^= 0xff
      assertEquivalent(previous, inserted)

      const deleted = Buffer.concat([
        previous.subarray(0, 64),
        previous.subarray(64 + size),
      ])
      deleted[deleted.length - 65] ^= 0xff
      assertEquivalent(previous, deleted)
    }
  })

  it('handles periodic runs near anchor boundaries', async () => {
    for (let period = 1; period <= 16; period++) {
      const pattern = bytes(period, generator(period + 17))
      for (const length of [
        16, 17, 23, 127, 128, 129, 255, 256, 257, 4095, 4096, 4097,
      ]) {
        const previous = Buffer.alloc(length + 128, pattern)
        const current = Buffer.from(previous)
        current[0] ^= 0xff
        current[length] ^= 0xff
        assertEquivalent(previous, current)
        assertEquivalent(current, previous)
        assertEquivalent(previous, Buffer.alloc(previous.length, 0xff))
      }
    }
  })

  it('resumes matching immediately after a skipped periodic run', async () => {
    for (let period = 1; period <= 16; period++) {
      const previous = Buffer.concat([
        Buffer.alloc(1024, bytes(period, generator(period + 32))),
        bytes(512),
      ])
      const current = Buffer.concat([
        Buffer.alloc(768, 0xff),
        previous.subarray(1024),
      ])
      current[current.length - 32] ^= 0xff
      assertEquivalent(previous, current)
      assertEquivalent(current, previous)
    }
  })

  it('never treats eight shared bytes as a full anchor', async () => {
    const previous = bytes(192 * 1024, generator(11))
    const current = bytes(previous.length, generator(12))
    const common = bytes(8)
    common.copy(previous, 24000)
    common.copy(current, 40000)
    previous.fill(0, 24008, 24016)
    current.fill(0xff, 40008, 40016)
    assertEquivalent(previous, current)
  })

  it('clears scratch state between searches in one window', async () => {
    const previous = bytes(128 * 1024)
    const current = Buffer.from(previous)
    for (let offset = 128; offset < current.length - 128; offset += 1024) {
      current.fill(0xff, offset, offset + 64)
    }
    assertEquivalent(previous, current)
  })

  it('does not read beyond unaligned Buffer views', async () => {
    const backing = bytes(64 * 1024 + 33)
    for (let padding = 0; padding <= 16; padding++) {
      const previous = backing.subarray(padding, backing.length - 17)
      const copy = Buffer.from(backing)
      copy.fill(0xff, 0, padding)
      copy.fill(0, backing.length - 17)
      const current = copy.subarray(padding, copy.length - 17)
      assertEquivalent(previous, current)
      current[257] ^= 0xff
      assertEquivalent(previous, current)
    }
  })

  it('preserves the cap and verifies full FNV collisions', async () => {
    const first = Buffer.from('af78eb93a452e475b12bc664799202d1', 'hex')
    const second = Buffer.from('879c6626732240f3541c864caf756093', 'hex')
    assert.equal(hash(first), hash(second))
    assert.notDeepEqual(first, second)
    for (const count of [1, 7, 8, 9, 20]) {
      const previous = Buffer.concat([second, bytes(1024)])
      const current = Buffer.concat([
        ...Array.from({ length: count }, () => first),
        second,
        bytes(1024),
      ])
      current[current.length - 1] ^= 0xff
      assertEquivalent(previous, current)
    }
  })

  it('bounds probing for colliding table slots', async () => {
    const anchors = [
      '77020bc41e73fc0ee055088226a8fac2',
      '8846b975ab8ab17a90082f8ae22decca',
      '5bc32aa945dd564db9d90a353872e22d',
      'ec2982085fafde70855db37d6f923195',
      'df739f260e0215a33c7214e1ddf55f8d',
      'e2c4d8b81eed8308c9bdf0acdaca6a50',
      'adf84aeeeeed9325c3b8016abd06fae7',
      'c81c3909ab9609ff3a56b87f11ee4655',
      '902acd1a60d2f33e0d23a7ce9d754366',
      '62a89cfa92c447b87cae0b82a4f12732',
      'dbbcc19b8029a106fbc8b6ffcaa5e07e',
      'caaacb70c00102f9eef959b86563a0a3',
      '338ddf3c6306930b4a952512b49ce264',
      '53488f13db9c97c3acad41f9ba32a219',
      '7c5a17c1ee4b87df245c5a0feb9355b1',
      '61f85418333e8aeb638434917fd93a43',
      '811b63c70eee0218d6b92e7539233d17',
      '98186f7c3ddd3f2cb90b9fb47c9a42e7',
      'c455639f55287b71be66be7b3bcd99e2',
      'b705a074ced0f68f1fd12fa0c28bd211',
    ].map(value => Buffer.from(value, 'hex'))
    assert.ok(anchors.every(anchor => (hash(anchor) & 1023) === 997))
    assert.equal(new Set(anchors.map(hash)).size, anchors.length)
    const current = Buffer.concat([...anchors, bytes(1024)])
    for (const anchor of anchors.slice(16)) {
      const previous = Buffer.concat([anchor, bytes(1024)])
      current[current.length - 1] ^= 0xff
      assertEquivalent(previous, current)
    }
  })

  it('preserves change and rendered-hunk truncation metadata', async () => {
    for (const step of [60, 128]) {
      const previous = bytes(6000 * step)
      const current = Buffer.from(previous)
      for (let offset = 100; offset < current.length - 100; offset += step) {
        current[offset] ^= 0xff
      }
      assertEquivalent(previous, current)
      const result = createBinaryDiff(previous, current)
      assert.ok(result.hunksTruncated)
      assert.ok(result.hunks.length <= 512)
      assert.equal(result.changeCount, 4096)
    }
  })

  it('copies previews without retaining input buffers', async () => {
    const previous = bytes(64 * 1024)
    const current = Buffer.from(previous)
    current.fill(0xff, 100, 2000)
    const oldCopy = Buffer.from(previous)
    const newCopy = Buffer.from(current)
    const result = createBinaryDiff(previous, current)
    const snapshot = structuredClone(result)
    assert.deepEqual(previous, oldCopy)
    assert.deepEqual(current, newCopy)
    for (const hunk of result.hunks) {
      for (const side of [hunk.previous, hunk.current]) {
        assert.ok(side.reduce((sum, s) => sum + s.data.length, 0) <= 1024)
        assert.ok(side.every(segment => Array.isArray(segment.data)))
      }
    }
    previous.fill(0)
    current.fill(0)
    assert.deepEqual(result, snapshot)
  })

  it('matches 3000 deterministic mixed-edit cases', async () => {
    const next = generator(0x6a09e667)
    for (let trial = 0; trial < 3000; trial++) {
      const length = next() % 4097
      const previous =
        trial % 3 === 0
          ? Buffer.alloc(length, bytes(1 + (next() % 16), next))
          : bytes(length, next)
      let current: Buffer = Buffer.from(previous)
      for (let edit = 0; edit < 1 + (trial % 8); edit++) {
        const start = next() % (current.length + 1)
        const size = 1 + (next() % 64)
        switch (next() % 3) {
          case 0:
            current = Buffer.concat([
              current.subarray(0, start),
              bytes(size, next),
              current.subarray(start),
            ])
            break
          case 1:
            current = Buffer.concat([
              current.subarray(0, start),
              current.subarray(start + size),
            ])
            break
          case 2:
            current.fill(
              next() & 0xff,
              start,
              Math.min(start + size, current.length)
            )
            break
        }
      }
      assertEquivalent(previous, current)
    }
  })
})
