import { IBinaryDiffChunk } from '../models/diff'

const AnchorSize = 32
const ResyncSearchBytes = 64 * 1024
const ContextBytes = 32
const MaxChangePreviewBytes = 4 * 1024
const ChangeEdgePreviewBytes = 512
const MaxChangeRegions = 4096

const HashBase = 257

interface IRawBinaryDiffChunk {
  readonly kind: 'equal' | 'change'
  readonly previousOffset: number
  readonly currentOffset: number
  readonly previousLength: number
  readonly currentLength: number
  readonly changeIndex?: number
}

interface IResyncPoint {
  readonly previousOffset: number
  readonly currentOffset: number
}

export interface IBinaryDiffChunks {
  readonly chunks: ReadonlyArray<IBinaryDiffChunk>
  readonly changeCount: number
}

function getEqualRun(
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>,
  previousOffset: number,
  currentOffset: number,
  previousLimit: number,
  currentLimit: number
) {
  let length = 0

  while (
    previousOffset + length < previousLimit &&
    currentOffset + length < currentLimit &&
    previous[previousOffset + length] === current[currentOffset + length]
  ) {
    length++
  }

  return length
}

function getCommonSuffixLength(
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>,
  previousStart: number,
  currentStart: number
) {
  let length = 0

  while (
    previous.length - length - 1 >= previousStart &&
    current.length - length - 1 >= currentStart &&
    previous[previous.length - length - 1] ===
      current[current.length - length - 1]
  ) {
    length++
  }

  return length
}

function bytesEqual(
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>,
  previousOffset: number,
  currentOffset: number,
  length: number
) {
  for (let i = 0; i < length; i++) {
    if (previous[previousOffset + i] !== current[currentOffset + i]) {
      return false
    }
  }

  return true
}

function getHashPower() {
  let power = 1

  for (let i = 1; i < AnchorSize; i++) {
    power = Math.imul(power, HashBase) >>> 0
  }

  return power
}

const HashPower = getHashPower()

function getWindowHash(data: ReadonlyArray<number>, offset: number) {
  let hash = 0

  for (let i = 0; i < AnchorSize; i++) {
    hash = (Math.imul(hash, HashBase) + data[offset + i] + 1) >>> 0
  }

  return hash
}

function slideWindowHash(
  hash: number,
  outgoingByte: number,
  incomingByte: number
) {
  const withoutOutgoing =
    (hash - Math.imul(outgoingByte + 1, HashPower)) >>> 0

  return (
    Math.imul(withoutOutgoing, HashBase) +
    incomingByte +
    1
  ) >>> 0
}

/**
 * Locate a nearby equal byte run after a mismatch. This is deliberately
 * bounded: binary files can be very large and a byte-level Myers diff has
 * pathological memory/runtime characteristics for them.
 *
 * A rolling hash keeps the search linear in the look-ahead window and lets us
 * recover from insertions/deletions instead of treating the whole tail as
 * modified.
 */
function findResyncPoint(
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>,
  previousOffset: number,
  currentOffset: number,
  previousLimit: number,
  currentLimit: number
): IResyncPoint | null {
  const previousLastStart = Math.min(
    previousLimit - AnchorSize,
    previousOffset + ResyncSearchBytes
  )
  const currentLastStart = Math.min(
    currentLimit - AnchorSize,
    currentOffset + ResyncSearchBytes
  )

  if (
    previousLastStart < previousOffset ||
    currentLastStart < currentOffset
  ) {
    return null
  }

  const previousHashes = new Map<number, number>()

  let previousHash = getWindowHash(previous, previousOffset)
  for (
    let candidateOffset = previousOffset;
    candidateOffset <= previousLastStart;
    candidateOffset++
  ) {
    if (!previousHashes.has(previousHash)) {
      previousHashes.set(previousHash, candidateOffset)
    }

    if (candidateOffset < previousLastStart) {
      previousHash = slideWindowHash(
        previousHash,
        previous[candidateOffset],
        previous[candidateOffset + AnchorSize]
      )
    }
  }

  let best: IResyncPoint | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let bestImbalance = Number.POSITIVE_INFINITY
  let bestRunLength = 0

  let currentHash = getWindowHash(current, currentOffset)
  for (
    let candidateCurrent = currentOffset;
    candidateCurrent <= currentLastStart;
    candidateCurrent++
  ) {
    const candidatePrevious = previousHashes.get(currentHash)

    if (
      candidatePrevious !== undefined &&
      bytesEqual(
        previous,
        current,
        candidatePrevious,
        candidateCurrent,
        AnchorSize
      )
    ) {
      const previousDelta = candidatePrevious - previousOffset
      const currentDelta = candidateCurrent - currentOffset
      const distance = previousDelta + currentDelta
      const imbalance = Math.abs(previousDelta - currentDelta)
      const runLength = getEqualRun(
        previous,
        current,
        candidatePrevious,
        candidateCurrent,
        previousLimit,
        currentLimit
      )

      if (
        distance < bestDistance ||
        (distance === bestDistance && imbalance < bestImbalance) ||
        (distance === bestDistance &&
          imbalance === bestImbalance &&
          runLength > bestRunLength)
      ) {
        best = {
          previousOffset: candidatePrevious,
          currentOffset: candidateCurrent,
        }
        bestDistance = distance
        bestImbalance = imbalance
        bestRunLength = runLength
      }
    }

    const currentDelta = candidateCurrent - currentOffset
    if (best !== null && currentDelta > bestDistance) {
      break
    }

    if (candidateCurrent < currentLastStart) {
      currentHash = slideWindowHash(
        currentHash,
        current[candidateCurrent],
        current[candidateCurrent + AnchorSize]
      )
    }
  }

  return best
}

function buildRawChunks(
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>
): ReadonlyArray<IRawBinaryDiffChunk> {
  const chunks: IRawBinaryDiffChunk[] = []

  const prefixLength = getEqualRun(
    previous,
    current,
    0,
    0,
    previous.length,
    current.length
  )

  let previousOffset = prefixLength
  let currentOffset = prefixLength

  if (prefixLength > 0) {
    chunks.push({
      kind: 'equal',
      previousOffset: 0,
      currentOffset: 0,
      previousLength: prefixLength,
      currentLength: prefixLength,
    })
  }

  const suffixLength = getCommonSuffixLength(
    previous,
    current,
    previousOffset,
    currentOffset
  )
  const previousLimit = previous.length - suffixLength
  const currentLimit = current.length - suffixLength

  let changeIndex = 0

  while (previousOffset < previousLimit || currentOffset < currentLimit) {
    if (changeIndex >= MaxChangeRegions - 1) {
      chunks.push({
        kind: 'change',
        previousOffset,
        currentOffset,
        previousLength: previousLimit - previousOffset,
        currentLength: currentLimit - currentOffset,
        changeIndex,
      })
      changeIndex++
      previousOffset = previousLimit
      currentOffset = currentLimit
      break
    }

    const resync = findResyncPoint(
      previous,
      current,
      previousOffset,
      currentOffset,
      previousLimit,
      currentLimit
    )

    const nextPreviousOffset = resync?.previousOffset ?? previousLimit
    const nextCurrentOffset = resync?.currentOffset ?? currentLimit

    chunks.push({
      kind: 'change',
      previousOffset,
      currentOffset,
      previousLength: nextPreviousOffset - previousOffset,
      currentLength: nextCurrentOffset - currentOffset,
      changeIndex,
    })
    changeIndex++

    previousOffset = nextPreviousOffset
    currentOffset = nextCurrentOffset

    const equalLength = getEqualRun(
      previous,
      current,
      previousOffset,
      currentOffset,
      previousLimit,
      currentLimit
    )

    if (equalLength > 0) {
      chunks.push({
        kind: 'equal',
        previousOffset,
        currentOffset,
        previousLength: equalLength,
        currentLength: equalLength,
      })
      previousOffset += equalLength
      currentOffset += equalLength
    }
  }

  if (suffixLength > 0) {
    chunks.push({
      kind: 'equal',
      previousOffset: previousLimit,
      currentOffset: currentLimit,
      previousLength: suffixLength,
      currentLength: suffixLength,
    })
  }

  return chunks
}

function copyBytes(
  data: ReadonlyArray<number>,
  offset: number,
  length: number
) {
  const result = new Array<number>(length)

  for (let i = 0; i < length; i++) {
    result[i] = data[offset + i]
  }

  return result
}

function createDataChunk(
  kind: 'equal' | 'change',
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>,
  previousOffset: number,
  currentOffset: number,
  previousLength: number,
  currentLength: number,
  changeIndex?: number
): IBinaryDiffChunk {
  return {
    kind,
    previousOffset,
    currentOffset,
    previousLength,
    currentLength,
    previousData: copyBytes(previous, previousOffset, previousLength),
    currentData: copyBytes(current, currentOffset, currentLength),
    changeIndex,
  }
}

function appendEqualChunks(
  result: IBinaryDiffChunk[],
  rawChunks: ReadonlyArray<IRawBinaryDiffChunk>,
  index: number,
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>
) {
  const chunk = rawChunks[index]
  const hasChangeBefore = rawChunks[index - 1]?.kind === 'change'
  const hasChangeAfter = rawChunks[index + 1]?.kind === 'change'

  if (!hasChangeBefore && !hasChangeAfter) {
    return
  }

  const keepAtStart = hasChangeBefore
    ? Math.min(ContextBytes, chunk.previousLength)
    : 0
  const keepAtEnd = hasChangeAfter
    ? Math.min(
        ContextBytes,
        Math.max(0, chunk.previousLength - keepAtStart)
      )
    : 0

  if (chunk.previousLength <= keepAtStart + keepAtEnd) {
    result.push(
      createDataChunk(
        'equal',
        previous,
        current,
        chunk.previousOffset,
        chunk.currentOffset,
        chunk.previousLength,
        chunk.currentLength
      )
    )
    return
  }

  if (keepAtStart > 0) {
    result.push(
      createDataChunk(
        'equal',
        previous,
        current,
        chunk.previousOffset,
        chunk.currentOffset,
        keepAtStart,
        keepAtStart
      )
    )
  }

  const skippedLength = chunk.previousLength - keepAtStart - keepAtEnd
  if (skippedLength > 0) {
    result.push({
      kind: 'equal-gap',
      previousOffset: chunk.previousOffset + keepAtStart,
      currentOffset: chunk.currentOffset + keepAtStart,
      previousLength: skippedLength,
      currentLength: skippedLength,
      previousData: [],
      currentData: [],
    })
  }

  if (keepAtEnd > 0) {
    result.push(
      createDataChunk(
        'equal',
        previous,
        current,
        chunk.previousOffset + chunk.previousLength - keepAtEnd,
        chunk.currentOffset + chunk.currentLength - keepAtEnd,
        keepAtEnd,
        keepAtEnd
      )
    )
  }
}

function appendChangeChunks(
  result: IBinaryDiffChunk[],
  chunk: IRawBinaryDiffChunk,
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>
) {
  const changeIndex = chunk.changeIndex
  const largestLength = Math.max(
    chunk.previousLength,
    chunk.currentLength
  )

  if (largestLength <= MaxChangePreviewBytes) {
    result.push(
      createDataChunk(
        'change',
        previous,
        current,
        chunk.previousOffset,
        chunk.currentOffset,
        chunk.previousLength,
        chunk.currentLength,
        changeIndex
      )
    )
    return
  }

  const firstPreviousLength = Math.min(
    ChangeEdgePreviewBytes,
    chunk.previousLength
  )
  const firstCurrentLength = Math.min(
    ChangeEdgePreviewBytes,
    chunk.currentLength
  )

  const remainingPrevious = chunk.previousLength - firstPreviousLength
  const remainingCurrent = chunk.currentLength - firstCurrentLength

  const lastPreviousLength = Math.min(
    ChangeEdgePreviewBytes,
    remainingPrevious
  )
  const lastCurrentLength = Math.min(
    ChangeEdgePreviewBytes,
    remainingCurrent
  )

  if (firstPreviousLength > 0 || firstCurrentLength > 0) {
    result.push(
      createDataChunk(
        'change',
        previous,
        current,
        chunk.previousOffset,
        chunk.currentOffset,
        firstPreviousLength,
        firstCurrentLength,
        changeIndex
      )
    )
  }

  const hiddenPreviousLength =
    chunk.previousLength - firstPreviousLength - lastPreviousLength
  const hiddenCurrentLength =
    chunk.currentLength - firstCurrentLength - lastCurrentLength

  if (hiddenPreviousLength > 0 || hiddenCurrentLength > 0) {
    result.push({
      kind: 'change-gap',
      previousOffset: chunk.previousOffset + firstPreviousLength,
      currentOffset: chunk.currentOffset + firstCurrentLength,
      previousLength: hiddenPreviousLength,
      currentLength: hiddenCurrentLength,
      previousData: [],
      currentData: [],
      changeIndex,
    })
  }

  if (lastPreviousLength > 0 || lastCurrentLength > 0) {
    result.push(
      createDataChunk(
        'change',
        previous,
        current,
        chunk.previousOffset + chunk.previousLength - lastPreviousLength,
        chunk.currentOffset + chunk.currentLength - lastCurrentLength,
        lastPreviousLength,
        lastCurrentLength,
        changeIndex
      )
    )
  }
}

/**
 * Build a display-oriented binary diff with byte resynchronization, collapsed
 * unchanged ranges, and bounded previews for very large changed regions.
 */
export function buildBinaryDiffChunks(
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>
): IBinaryDiffChunks {
  const rawChunks = buildRawChunks(previous, current)
  const changeCount = rawChunks.reduce(
    (count, chunk) => count + (chunk.kind === 'change' ? 1 : 0),
    0
  )

  if (changeCount === 0) {
    return { chunks: [], changeCount: 0 }
  }

  const chunks: IBinaryDiffChunk[] = []

  for (let index = 0; index < rawChunks.length; index++) {
    const chunk = rawChunks[index]

    if (chunk.kind === 'equal') {
      appendEqualChunks(chunks, rawChunks, index, previous, current)
    } else {
      appendChangeChunks(chunks, chunk, previous, current)
    }
  }

  return { chunks, changeCount }
}
