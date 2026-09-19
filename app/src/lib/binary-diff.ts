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
const MaxChangeRegions = 4096
const MaxRenderedHunks = 512
const MaxBytesPerHunkSide = 1024
const PreviewBytesPerHunkEdge = MaxBytesPerHunkSide / 2

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

function findSyncPointInWindow(
  previous: Buffer,
  current: Buffer,
  previousOffset: number,
  currentOffset: number,
  previousLimit: number,
  currentLimit: number,
  window: number
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

  const currentAnchors = new Map<number, number[]>()

  for (let offset = currentOffset; offset <= currentLastAnchor; offset++) {
    const hash = anchorHash(current, offset)
    const positions = currentAnchors.get(hash)

    if (positions === undefined) {
      currentAnchors.set(hash, [offset])
    } else if (positions.length < MaxAnchorCandidates) {
      positions.push(offset)
    }
  }

  let best: ISyncPoint | undefined = undefined
  let bestScore = Number.POSITIVE_INFINITY
  let bestShiftDelta = Number.POSITIVE_INFINITY

  for (
    let previousAnchor = previousOffset;
    previousAnchor <= previousLastAnchor;
    previousAnchor++
  ) {
    const candidates = currentAnchors.get(anchorHash(previous, previousAnchor))

    if (candidates === undefined) {
      continue
    }

    for (const currentAnchor of candidates) {
      if (!anchorMatches(previous, current, previousAnchor, currentAnchor)) {
        continue
      }

      const previousAdvance = previousAnchor - previousOffset
      const currentAdvance = currentAnchor - currentOffset

      if (previousAdvance === 0 && currentAdvance === 0) {
        continue
      }

      const shiftDelta = Math.abs(previousAdvance - currentAdvance)
      const score = Math.max(previousAdvance, currentAdvance) + shiftDelta * 4

      if (
        score < bestScore ||
        (score === bestScore && shiftDelta < bestShiftDelta)
      ) {
        best = { previous: previousAnchor, current: currentAnchor }
        bestScore = score
        bestShiftDelta = shiftDelta

        if (bestScore <= 2) {
          return best
        }
      }
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
  currentLimit: number
) {
  for (const window of ResyncWindows) {
    const sync = findSyncPointInWindow(
      previous,
      current,
      previousOffset,
      currentOffset,
      previousLimit,
      currentLimit,
      window
    )

    if (sync !== undefined) {
      return sync
    }
  }

  return undefined
}

function getCommonPrefixLength(previous: Buffer, current: Buffer) {
  const limit = Math.min(previous.length, current.length)
  let offset = 0

  while (offset < limit && previous[offset] === current[offset]) {
    offset++
  }

  return offset
}

function getCommonSuffixLength(
  previous: Buffer,
  current: Buffer,
  commonPrefixLength: number
) {
  const limit = Math.min(previous.length, current.length)
  let length = 0

  while (
    length < limit - commonPrefixLength &&
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
    while (
      previousOffset < previousLimit &&
      currentOffset < currentLimit &&
      previous[previousOffset] === current[currentOffset]
    ) {
      previousOffset++
      currentOffset++
    }

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
      currentLimit
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
        data: Array.from(data.subarray(displayStart, displayEnd)),
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
        data: Array.from(data.subarray(displayStart, displayEnd)),
        omittedBefore: 0,
      },
    ]
  }

  return [
    {
      offset: displayStart,
      data: Array.from(data.subarray(displayStart, headEnd)),
      omittedBefore: 0,
    },
    {
      offset: tailStart,
      data: Array.from(data.subarray(tailStart, displayEnd)),
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

    if (
      previousGap <= BinaryContextBytes * 2 &&
      currentGap <= BinaryContextBytes * 2
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
