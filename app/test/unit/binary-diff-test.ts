import { describe, it } from 'node:test'
import assert from 'node:assert'

import { createBinaryDiff, findBinaryChanges } from '../../src/lib/binary-diff'

function patternedBuffer(length: number) {
  return Buffer.from(
    Array.from({ length }, (_, index) => (index * 17 + 3) % 251)
  )
}

describe('binary diff', () => {
  it('returns no changes for identical buffers', () => {
    const data = patternedBuffer(256)
    const result = createBinaryDiff(data, Buffer.from(data))

    assert.equal(result.changeCount, 0)
    assert.equal(result.hunks.length, 0)
    assert.equal(result.hunksTruncated, false)
  })

  it('finds a byte replacement without marking the rest of the file', () => {
    const previous = patternedBuffer(256)
    const current = Buffer.from(previous)
    current[80] = current[80] ^ 0xff

    const result = findBinaryChanges(previous, current)

    assert.equal(result.truncated, false)
    assert.deepStrictEqual(result.changes, [
      {
        previousStart: 80,
        previousLength: 1,
        currentStart: 80,
        currentLength: 1,
      },
    ])
  })

  it('prefers replacement alignment in repeated byte regions', () => {
    const previous = Buffer.alloc(512, 0)
    const current = Buffer.from(previous)
    current.fill(0xff, 128, 160)

    const result = findBinaryChanges(previous, current)

    assert.equal(result.truncated, false)
    assert.deepStrictEqual(result.changes, [
      {
        previousStart: 128,
        previousLength: 32,
        currentStart: 128,
        currentLength: 32,
      },
    ])
  })

  it('resynchronizes after an insertion', () => {
    const previous = patternedBuffer(320)
    const current = Buffer.concat([
      previous.subarray(0, 96),
      Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      previous.subarray(96),
    ])

    const result = findBinaryChanges(previous, current)

    assert.equal(result.truncated, false)
    assert.deepStrictEqual(result.changes, [
      {
        previousStart: 96,
        previousLength: 0,
        currentStart: 96,
        currentLength: 4,
      },
    ])
  })

  it('keeps later changes separate after an insertion shifts offsets', () => {
    const previous = patternedBuffer(512)
    const inserted = Buffer.from([0xfa, 0xfb, 0xfc])
    const current = Buffer.concat([
      previous.subarray(0, 80),
      inserted,
      previous.subarray(80),
    ])

    current[280 + inserted.length] ^= 0xff

    const result = findBinaryChanges(previous, current)

    assert.equal(result.truncated, false)
    assert.equal(result.changes.length, 2)
    assert.deepStrictEqual(result.changes[0], {
      previousStart: 80,
      previousLength: 0,
      currentStart: 80,
      currentLength: inserted.length,
    })
    assert.deepStrictEqual(result.changes[1], {
      previousStart: 280,
      previousLength: 1,
      currentStart: 280 + inserted.length,
      currentLength: 1,
    })
  })

  it('groups nearby changes into one hunk with context', () => {
    const previous = patternedBuffer(512)
    const current = Buffer.from(previous)
    current[100] ^= 0xff
    current[120] ^= 0xff

    const result = createBinaryDiff(previous, current)

    assert.equal(result.changeCount, 2)
    assert.equal(result.hunks.length, 1)
    assert.equal(result.hunks[0].changes.length, 2)
    assert(result.hunks[0].previous[0].offset <= 100)
    assert(result.hunks[0].current[0].offset <= 100)
  })

  it('splits dense change groups before they become huge render trees', () => {
    const previous = patternedBuffer(2048)
    const current = Buffer.from(previous)

    for (let offset = 100; offset <= 1300; offset += 60) {
      current[offset] ^= 0xff
    }

    const result = createBinaryDiff(previous, current)

    assert(result.hunks.length >= 2)
    for (const hunk of result.hunks) {
      const previousBytes = hunk.previous.reduce(
        (total, segment) => total + segment.data.length,
        0
      )
      const currentBytes = hunk.current.reduce(
        (total, segment) => total + segment.data.length,
        0
      )

      assert(previousBytes <= 1024)
      assert(currentBytes <= 1024)
    }
  })

  it('collapses the middle of a very large changed region', () => {
    const previous = Buffer.alloc(16 * 1024, 0x11)
    const current = Buffer.alloc(16 * 1024, 0xee)

    const result = createBinaryDiff(previous, current)
    const hunk = result.hunks[0]

    assert.equal(result.changeCount, 1)
    assert.equal(hunk.previous.length, 2)
    assert.equal(hunk.current.length, 2)
    assert(hunk.previous[1].omittedBefore > 0)
    assert(hunk.current[1].omittedBefore > 0)
  })
})
