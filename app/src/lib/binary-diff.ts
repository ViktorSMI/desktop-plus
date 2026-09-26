import {
  IBinaryDiffChange,
  IBinaryDiffHunk,
  IBinaryDiffSegment,
} from '../models/diff'

export const BinaryBytesPerRow = 16

const BinaryAnchorLength = 16
const BinaryContextRows = 2
const BinaryContextBytes = BinaryBytesPerRow * BinaryContextRows
const MaxAnchorCandidates = 8
const MaxAnchorProbes = 16
const MaxChangeRegions = 4096
const MaxRenderedHunks = 512
const MaxBytesPerHunkSide = 1024
const MaxGroupedChangeSpan = MaxBytesPerHunkSide - BinaryContextBytes * 2
const PreviewBytesPerHunkEdge = MaxBytesPerHunkSide / 2

const CompareBlockSizes = [16 * 1024, 256] as const

const ResyncWindows = [256, 4096, 64 * 1024] as const

export interface IBinaryDiffResult {
  readonly hunks: ReadonlyArray<IBinaryDiffHunk>
  readonly changeCount: number
  readonly hunksTruncated: boolean
}

interface IChangeSearchResult {
  readonly changes: ReadonlyArray<IBinaryDiffChange>
  readonly truncated: boolean
}

interface ISyncPoint {
  readonly previous: number
  readonly current: number
}

/** Scratch space belongs to a single comparison, never a process-wide cache. */
interface IAnchorIndex {
  readonly slots: Uint32Array
  readonly hashes: Uint32Array
  readonly tails: Uint32Array
  readonly next: Uint32Array
  readonly counts: Uint8Array
  readonly overflow: Map<number, number>
}

function createAnchorIndex(window: number): IAnchorIndex {
  const capacity = window + 1
  let slotCount = 1
  while (slotCount < capacity * 2) {
    slotCount *= 2
  }

  return {
    slots: new Uint32Array(slotCount),
    hashes: new Uint32Array(capacity),
    tails: new Uint32Array(capacity),
    next: new Uint32Array(capacity),
    counts: new Uint8Array(capacity),
    overflow: new Map(),
  }
}

/** Bound probing even for deliberately colliding input, falling back to Map. */
function findAnchorSlot(index: IAnchorIndex, hash: number) {
  const { slots, hashes } = index
  const mask = slots.length - 1
  let slot = hash & mask
  for (let probes = 0; probes < MaxAnchorProbes; probes++) {
    if (slots[slot] === 0 || hashes[slots[slot] - 1] === hash) {
      return slot
    }
    slot = (slot + 1) & mask
  }

  return -1
}

function anchorHash(data: Buffer, offset: number) {
  let hash = 2166136261

  for (let i = 0; i < BinaryAnchorLength; i++) {
    hash ^= data[offset + i]
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function anchorMatches(
  previous: Buffer,
  current: Buffer,
  previousOffset: number,
  currentOffset: number
) {
  for (let i = 0; i < BinaryAnchorLength; i++) {
    if (previous[previousOffset + i] !== current[currentOffset + i]) {
      return false
    }
  }

  return true
}

interface IPeriodicAnchorRun {
  readonly period: number
  readonly lastAnchor: number
}

/** Find a short repeating run. No hashes or bytes are approximated. */
function findPeriodicAnchorRun(
  data: Buffer,
  offset: number,
  lastAnchor: number
): IPeriodicAnchorRun | undefined {
  for (
    let period = 1;
    period <= BinaryAnchorLength && offset + period <= lastAnchor;
    period++
  ) {
    if (!anchorMatches(data, data, offset, offset + period)) {
      continue
    }

    let end = offset + period + BinaryAnchorLength
    const limit = lastAnchor + BinaryAnchorLength
    while (end < limit && data[end] === data[end - period]) {
      end++
    }

    return { period, lastAnchor: end - BinaryAnchorLength }
  }

  return undefined
}

/**
 * A cheap, conservative rejection for large windows of unrelated data.
 * Every 16-byte anchor must share its first eight bytes. Index these as two
 * exact words instead of computing FNV over all 16 bytes. A match (or a long
 * probe chain) falls back to the unchanged full search; only a proven absence
 * skips that search. Reuse scratch arrays; nothing escapes the comparison.
 */
function mayHaveCommonAnchor(
  previous: Buffer,
  current: Buffer,
  previousOffset: number,
  currentOffset: number,
  previousLastAnchor: number,
  currentLastAnchor: number,
  index: IAnchorIndex
) {
  const { slots, hashes, tails } = index
  const mask = slots.length - 1
  slots.fill(0)

  for (let offset = currentOffset; offset <= currentLastAnchor; offset++) {
    const low = current.readUInt32LE(offset)
    const high = current.readUInt32LE(offset + 4)
    let slot = (low ^ Math.imul(high, 0x9e3779b1)) & mask
    let probes = 0
    while (
      slots[slot] !== 0 &&
      (hashes[slots[slot] - 1] !== low || tails[slots[slot] - 1] !== high)
    ) {
      if (++probes === MaxAnchorProbes) {
        return true
      }
      slot = (slot + 1) & mask
    }
    if (slots[slot] === 0) {
      const position = offset - currentOffset
      slots[slot] = position + 1
      hashes[position] = low
      tails[position] = high
    }
  }

  for (let offset = previousOffset; offset <= previousLastAnchor; offset++) {
    const low = previous.readUInt32LE(offset)
    const high = previous.readUInt32LE(offset + 4)
    let slot = (low ^ Math.imul(high, 0x9e3779b1)) & mask
    let probes = 0
    while (slots[slot] !== 0) {
      const position = slots[slot] - 1
      if (hashes[position] === low && tails[position] === high) {
        return true
      }
      if (++probes === MaxAnchorProbes) {
        return true
      }
      slot = (slot + 1) & mask
    }
  }

  return false
}

function findSyncPointInWindow(
  previous: Buffer,
  current: Buffer,
  previousOffset: number,
  currentOffset: number,
  previousLimit: number,
  currentLimit: number,
  window: number,
  indexes: Array<IAnchorIndex | undefined>,
  windowIndex: number
): ISyncPoint | undefined {
  const previousLastAnchor = Math.min(
    previousLimit - BinaryAnchorLength,
    previousOffset + window
  )
  const currentLastAnchor = Math.min(
    currentLimit - BinaryAnchorLength,
    currentOffset + window
  )

  if (
    previousLastAnchor < previousOffset ||
    currentLastAnchor < currentOffset
  ) {
    return undefined
  }

  const index = indexes[windowIndex] ?? createAnchorIndex(window)
  indexes[windowIndex] = index
  const currentRun = findPeriodicAnchorRun(
    current,
    currentOffset,
    currentLastAnchor
  )
  const previousRun = findPeriodicAnchorRun(
    previous,
    previousOffset,
    previousLastAnchor
  )
  if (
    window === ResyncWindows[2] &&
    currentRun === undefined &&
    previousRun === undefined &&
    !mayHaveCommonAnchor(
      previous,
      current,
      previousOffset,
      currentOffset,
      previousLastAnchor,
      currentLastAnchor,
      index
    )
  ) {
    return undefined
  }

  const { slots, hashes, tails, next, counts, overflow } = index
  slots.fill(0)
  overflow.clear()

  // Store relative positions + 1: zero marks an empty slot/end of a list.
  // Linear probing resolves table collisions; the full FNV hash still defines
  // a bucket, retaining the same first eight candidates as the original search.
  for (let offset = currentOffset; offset <= currentLastAnchor; offset++) {
    const hash = anchorHash(current, offset)
    const slot = findAnchorSlot(index, hash)
    const head = slot === -1 ? overflow.get(hash) ?? 0 : slots[slot]

    const position = offset - currentOffset
    const first = head - 1
    if (first < 0) {
      if (slot === -1) {
        overflow.set(hash, position + 1)
      } else {
        slots[slot] = position + 1
      }
      hashes[position] = hash
      tails[position] = position
      counts[position] = 1
      next[position] = 0
    } else if (counts[first] < MaxAnchorCandidates) {
      next[tails[first]] = position + 1
      next[position] = 0
      tails[first] = position
      counts[first]++
    }

    // After eight full periods every hash in this run has its first eight
    // candidates. Later identical anchors would be discarded by the cap.
    if (
      currentRun !== undefined &&
      offset === currentOffset + currentRun.period * MaxAnchorCandidates - 1
    ) {
      offset = Math.max(offset, currentRun.lastAnchor)
    }
  }

  let best: ISyncPoint | undefined = undefined
  let bestScore = Number.POSITIVE_INFINITY
  let bestShiftDelta = Number.POSITIVE_INFINITY
  let sawBucket = false

  for (
    let previousAnchor = previousOffset;
    previousAnchor <= previousLastAnchor &&
    previousAnchor - previousOffset <= bestScore;
    previousAnchor++
  ) {
    const hash = anchorHash(previous, previousAnchor)
    const slot = findAnchorSlot(index, hash)
    const head = slot === -1 ? overflow.get(hash) ?? 0 : slots[slot]

    sawBucket = sawBucket || head !== 0

    for (
      let candidate = head;
      candidate !== 0;
      candidate = next[candidate - 1]
    ) {
      const currentAnchor = currentOffset + candidate - 1
      const previousAdvance = previousAnchor - previousOffset
      const currentAdvance = currentAnchor - currentOffset

      if (previousAdvance === 0 && currentAdvance === 0) {
        continue
      }

      const shiftDelta = Math.abs(previousAdvance - currentAdvance)
      const score = Math.max(previousAdvance, currentAdvance) + shiftDelta * 4

      // Reject candidates that cannot improve the result before comparing bytes.
      if (
        (score < bestScore ||
          (score === bestScore && shiftDelta < bestShiftDelta)) &&
        anchorMatches(previous, current, previousAnchor, currentAnchor)
      ) {
        best = { previous: previousAnchor, current: currentAnchor }
        bestScore = score
        bestShiftDelta = shiftDelta

        if (bestScore <= 2) {
          return best
        }
      }
    }

    // A full period without even a hash bucket proves the remaining repeated
    // anchors cannot match. Continue at the first anchor containing new bytes.
    if (
      previousRun !== undefined &&
      previousAnchor === previousOffset + previousRun.period - 1 &&
      !sawBucket
    ) {
      previousAnchor = Math.max(previousAnchor, previousRun.lastAnchor)
    }
  }

  return best
}

function findSyncPoint(
  previous: Buffer,
  current: Buffer,
  previousOffset: number,
  currentOffset: number,
  previousLimit: number,
  currentLimit: number,
  indexes: Array<IAnchorIndex | undefined>
) {
  // Scores 1 and 2 can only be produced by aligned anchors. Both positions
  // are among the first eight hash candidates, even in repeated data.
  // No shifted anchor can beat these (its minimum score is 5).
  for (let advance = 1; advance <= 2; advance++) {
    if (
      previousOffset + advance + BinaryAnchorLength <= previousLimit &&
      currentOffset + advance + BinaryAnchorLength <= currentLimit &&
      anchorMatches(
        previous,
        current,
        previousOffset + advance,
        currentOffset + advance
      )
    ) {
      return {
        previous: previousOffset + advance,
        current: currentOffset + advance,
      }
    }
  }

  for (let windowIndex = 0; windowIndex < ResyncWindows.length; windowIndex++) {
    const window = ResyncWindows[windowIndex]
    const sync = findSyncPointInWindow(
      previous,
      current,
      previousOffset,
      currentOffset,
      previousLimit,
      currentLimit,
      window,
      indexes,
      windowIndex
    )

    if (sync !== undefined) {
      return sync
    }
  }

  return undefined
}

/** Skip equal ranges with native comparisons, without allocating Buffer views. */
function getCommonLength(
  previous: Buffer,
  current: Buffer,
  previousOffset: number,
  currentOffset: number,
  limit: number
) {
  let length = 0
  for (const block of CompareBlockSizes) {
    while (
      length + block <= limit &&
      previous[previousOffset + length] === current[currentOffset + length] &&
      previous.compare(
        current,
        currentOffset + length,
        currentOffset + length + block,
        previousOffset + length,
        previousOffset + length + block
      ) === 0
    ) {
      length += block
    }
  }

  while (
    length < limit &&
    previous[previousOffset + length] === current[currentOffset + length]
  ) {
    length++
  }

  return length
}

function getCommonPrefixLength(previous: Buffer, current: Buffer) {
  return getCommonLength(
    previous,
    current,
    0,
    0,
    Math.min(previous.length, current.length)
  )
}

function getCommonSuffixLength(
  previous: Buffer,
  current: Buffer,
  commonPrefixLength: number
) {
  const limit = Math.min(previous.length, current.length) - commonPrefixLength
  let length = 0

  for (const block of CompareBlockSizes) {
    while (
      length + block <= limit &&
      previous[previous.length - length - 1] ===
        current[current.length - length - 1] &&
      previous.compare(
        current,
        current.length - length - block,
        current.length - length,
        previous.length - length - block,
        previous.length - length
      ) === 0
    ) {
      length += block
    }
  }

  while (
    length < limit &&
    previous[previous.length - length - 1] ===
      current[current.length - length - 1]
  ) {
    length++
  }

  return length
}

/**
 * Finds byte-level change regions while allowing the two streams to
 * re-synchronize after insertions and deletions.
 *
 * This intentionally uses bounded anchor searches instead of a full byte-level
 * LCS/Myers matrix. Binary files can be tens of MiB and a quadratic algorithm
 * would make the diff viewer unusable.
 */
export function findBinaryChanges(
  previous: Buffer,
  current: Buffer
): IChangeSearchResult {
  const changes: IBinaryDiffChange[] = []
  const indexes: Array<IAnchorIndex | undefined> = []
  const commonPrefixLength = getCommonPrefixLength(previous, current)
  const commonSuffixLength = getCommonSuffixLength(
    previous,
    current,
    commonPrefixLength
  )

  const previousLimit = previous.length - commonSuffixLength
  const currentLimit = current.length - commonSuffixLength

  let previousOffset = commonPrefixLength
  let currentOffset = commonPrefixLength

  while (previousOffset < previousLimit || currentOffset < currentLimit) {
    const commonLength = getCommonLength(
      previous,
      current,
      previousOffset,
      currentOffset,
      Math.min(previousLimit - previousOffset, currentLimit - currentOffset)
    )
    previousOffset += commonLength
    currentOffset += commonLength

    if (previousOffset >= previousLimit && currentOffset >= currentLimit) {
      break
    }

    if (changes.length >= MaxChangeRegions) {
      return { changes, truncated: true }
    }

    const changePreviousStart = previousOffset
    const changeCurrentStart = currentOffset
    const sync = findSyncPoint(
      previous,
      current,
      previousOffset,
      currentOffset,
      previousLimit,
      currentLimit,
      indexes
    )

    if (sync === undefined) {
      changes.push({
        previousStart: changePreviousStart,
        previousLength: previousLimit - changePreviousStart,
        currentStart: changeCurrentStart,
        currentLength: currentLimit - changeCurrentStart,
      })
      break
    }

    changes.push({
      previousStart: changePreviousStart,
      previousLength: sync.previous - changePreviousStart,
      currentStart: changeCurrentStart,
      currentLength: sync.current - changeCurrentStart,
    })

    previousOffset = sync.previous
    currentOffset = sync.current
  }

  return { changes, truncated: false }
}

function alignDown(value: number) {
  return Math.floor(value / BinaryBytesPerRow) * BinaryBytesPerRow
}

function alignUp(value: number) {
  return Math.ceil(value / BinaryBytesPerRow) * BinaryBytesPerRow
}

/** Copy just the preview bytes; never retain a view of the input buffer. */
function copyBytes(data: Buffer, start: number, end: number) {
  const bytes = new Array<number>(end - start)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = data[start + i]
  }

  return bytes
}

function createSegments(
  data: Buffer,
  changes: ReadonlyArray<IBinaryDiffChange>,
  side: 'previous' | 'current'
): ReadonlyArray<IBinaryDiffSegment> {
  if (data.length === 0 || changes.length === 0) {
    return []
  }

  const startKey = side === 'previous' ? 'previousStart' : 'currentStart'
  const lengthKey = side === 'previous' ? 'previousLength' : 'currentLength'

  const first = changes[0]
  const last = changes[changes.length - 1]

  const changeStart = first[startKey]
  const changeEnd = last[startKey] + last[lengthKey]

  const displayStart = alignDown(Math.max(0, changeStart - BinaryContextBytes))
  const displayEnd = Math.min(
    data.length,
    alignUp(Math.min(data.length, changeEnd + BinaryContextBytes))
  )

  if (displayEnd <= displayStart) {
    return []
  }

  if (displayEnd - displayStart <= MaxBytesPerHunkSide) {
    return [
      {
        offset: displayStart,
        data: copyBytes(data, displayStart, displayEnd),
        omittedBefore: 0,
      },
    ]
  }

  const headEnd = alignDown(
    Math.min(displayEnd, displayStart + PreviewBytesPerHunkEdge)
  )
  const tailStart = alignDown(
    Math.max(displayStart, displayEnd - PreviewBytesPerHunkEdge)
  )

  if (tailStart <= headEnd) {
    return [
      {
        offset: displayStart,
        data: copyBytes(data, displayStart, displayEnd),
        omittedBefore: 0,
      },
    ]
  }

  return [
    {
      offset: displayStart,
      data: copyBytes(data, displayStart, headEnd),
      omittedBefore: 0,
    },
    {
      offset: tailStart,
      data: copyBytes(data, tailStart, displayEnd),
      omittedBefore: tailStart - headEnd,
    },
  ]
}

function groupChanges(
  changes: ReadonlyArray<IBinaryDiffChange>
): ReadonlyArray<ReadonlyArray<IBinaryDiffChange>> {
  const groups: IBinaryDiffChange[][] = []

  for (const change of changes) {
    const group = groups[groups.length - 1]

    if (group === undefined) {
      groups.push([change])
      continue
    }

    const previousChange = group[group.length - 1]
    const previousGap =
      change.previousStart -
      (previousChange.previousStart + previousChange.previousLength)
    const currentGap =
      change.currentStart -
      (previousChange.currentStart + previousChange.currentLength)
    const firstChange = group[0]
    const previousSpan =
      change.previousStart + change.previousLength - firstChange.previousStart
    const currentSpan =
      change.currentStart + change.currentLength - firstChange.currentStart

    if (
      previousGap <= BinaryContextBytes * 2 &&
      currentGap <= BinaryContextBytes * 2 &&
      previousSpan <= MaxGroupedChangeSpan &&
      currentSpan <= MaxGroupedChangeSpan
    ) {
      group.push(change)
    } else {
      groups.push([change])
    }
  }

  return groups
}

/**
 * Builds compact, render-ready hex hunks from two binary buffers.
 *
 * Only context around changes is retained in the result, so the React tree
 * stays small even when the compared buffers themselves are large.
 */
export function createBinaryDiff(
  previous: Buffer,
  current: Buffer
): IBinaryDiffResult {
  const search = findBinaryChanges(previous, current)
  const groups = groupChanges(search.changes)
  const visibleGroups = groups.slice(0, MaxRenderedHunks)

  return {
    hunks: visibleGroups.map(changes => ({
      changes,
      previous: createSegments(previous, changes, 'previous'),
      current: createSegments(current, changes, 'current'),
    })),
    changeCount: search.changes.length,
    hunksTruncated: search.truncated || groups.length > MaxRenderedHunks,
  }
}
