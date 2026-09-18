import { describe, it } from 'node:test'
import assert from 'node:assert'

import { buildBinaryDiffChunks } from '../../src/lib/binary-diff'

function makeData(length: number) {
  const data = Buffer.alloc(length)
  let state = 0x12345678

  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    data[i] = state >>> 24
  }

  return data
}

describe('binary diff', () => {
  it('finds a byte replacement at its real offset', () => {
    const previous = makeData(256)
    const current = Buffer.from(previous)
    current[80] ^= 0xff

    const diff = buildBinaryDiffChunks(previous, current)
    const changes = diff.chunks.filter(chunk => chunk.kind === 'change')

    assert.equal(diff.changeCount, 1)
    assert.equal(changes.length, 1)
    assert.equal(changes[0].previousOffset, 80)
    assert.equal(changes[0].currentOffset, 80)
    assert.equal(changes[0].previousLength, 1)
    assert.equal(changes[0].currentLength, 1)
  })

  it('represents inserted bytes without shifting the rest of the file', () => {
    const previous = makeData(256)
    const current = Buffer.concat([
      previous.subarray(0, 40),
      Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      previous.subarray(40),
    ])

    const diff = buildBinaryDiffChunks(previous, current)
    const changes = diff.chunks.filter(chunk => chunk.kind === 'change')

    assert.equal(diff.changeCount, 1)
    assert.equal(changes.length, 1)
    assert.equal(changes[0].previousOffset, 40)
    assert.equal(changes[0].currentOffset, 40)
    assert.equal(changes[0].previousLength, 0)
    assert.equal(changes[0].currentLength, 4)
    assert.deepEqual(changes[0].currentData, [0xde, 0xad, 0xbe, 0xef])
  })

  it('resynchronizes after an insertion and finds later changes', () => {
    const previous = makeData(512)
    const withInsertion = Buffer.concat([
      previous.subarray(0, 64),
      Buffer.from([0xaa, 0xbb, 0xcc]),
      previous.subarray(64),
    ])
    const current = Buffer.from(withInsertion)
    current[320] ^= 0x7f

    const diff = buildBinaryDiffChunks(previous, current)
    const changes = diff.chunks.filter(chunk => chunk.kind === 'change')

    assert.equal(diff.changeCount, 2)
    assert.equal(changes[0].previousOffset, 64)
    assert.equal(changes[0].currentOffset, 64)
    assert.equal(changes[0].previousLength, 0)
    assert.equal(changes[0].currentLength, 3)

    assert.equal(changes[1].previousOffset, 317)
    assert.equal(changes[1].currentOffset, 320)
    assert.equal(changes[1].previousLength, 1)
    assert.equal(changes[1].currentLength, 1)
  })

  it('detects changes well beyond the old 64 KiB preview', () => {
    const previous = makeData(128 * 1024)
    const current = Buffer.from(previous)
    const changedOffset = 96 * 1024 + 7
    current[changedOffset] ^= 0x55

    const diff = buildBinaryDiffChunks(previous, current)
    const change = diff.chunks.find(chunk => chunk.kind === 'change')

    assert.equal(diff.changeCount, 1)
    assert(change !== undefined)
    assert.equal(change.previousOffset, changedOffset)
    assert.equal(change.currentOffset, changedOffset)
  })

  it('collapses long unchanged ranges to context and gaps', () => {
    const previous = makeData(4096)
    const current = Buffer.from(previous)
    current[100] ^= 0x33
    current[3000] ^= 0x44

    const diff = buildBinaryDiffChunks(previous, current)

    assert.equal(diff.changeCount, 2)
    assert(diff.chunks.some(chunk => chunk.kind === 'equal-gap'))
  })

  it('keeps same-offset changes aligned in repetitive data', () => {
    const previous = Buffer.alloc(4096, 0x00)
    const current = Buffer.from(previous)
    current.fill(0x01, 0x40, 0x50)
    current.fill(0x01, 0x840, 0x850)

    const diff = buildBinaryDiffChunks(previous, current)
    const changes = diff.chunks.filter(chunk => chunk.kind === 'change')

    assert.equal(diff.changeCount, 2)
    assert.equal(changes[0].previousOffset, 0x40)
    assert.equal(changes[0].currentOffset, 0x40)
    assert.equal(changes[0].previousLength, 0x10)
    assert.equal(changes[0].currentLength, 0x10)

    assert.equal(changes[1].previousOffset, 0x840)
    assert.equal(changes[1].currentOffset, 0x840)
    assert.equal(changes[1].previousLength, 0x10)
    assert.equal(changes[1].currentLength, 0x10)
  })

  it('bounds the rendered data for a huge changed region', () => {
    const previous = Buffer.alloc(16 * 1024, 0x00)
    const current = Buffer.alloc(16 * 1024, 0xff)

    const diff = buildBinaryDiffChunks(previous, current)

    assert.equal(diff.changeCount, 1)
    assert(diff.chunks.some(chunk => chunk.kind === 'change-gap'))

    const renderedBytes = diff.chunks
      .filter(chunk => chunk.kind === 'change')
      .reduce(
        (sum, chunk) =>
          sum + chunk.previousData.length + chunk.currentData.length,
        0
      )

    assert(renderedBytes <= 2048)
  })
})
