import * as React from 'react'
import * as Path from 'path'

import {
  IBinaryDiff,
  IBinaryDiffChange,
  IBinaryDiffSegment,
} from '../../models/diff'
import { Repository } from '../../models/repository'

import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'

const BytesPerRow = 16

interface IBinaryFileProps {
  readonly repository: Repository
  readonly path: string
  readonly diff: IBinaryDiff
  /**
   * Called when the user requests to open a binary file in an the
   * system-assigned application for said file type.
   */
  readonly onOpenBinaryFile: (fullPath: string) => void
}

interface IBinaryFileState {
  readonly activeHunk: number
}

function formatOffset(offset: number) {
  const width = offset > 0xffffffff ? 16 : 8
  return offset.toString(16).padStart(width, '0').toUpperCase()
}

function formatByteCount(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = units[0]

  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024
    unit = units[i]
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}

function isPrintable(byte: number) {
  return byte >= 0x20 && byte <= 0x7e
}

/**
 * Hex comparer for binary files.
 *
 * The diff engine performs bounded resynchronization so insertions and
 * deletions don't make the remainder of the file look changed. This component
 * only renders compact context windows around those change regions.
 */
export class BinaryFile extends React.Component<
  IBinaryFileProps,
  IBinaryFileState
> {
  public state: IBinaryFileState = {
    activeHunk: 0,
  }

  public componentDidUpdate(previousProps: IBinaryFileProps) {
    if (
      previousProps.diff !== this.props.diff &&
      this.state.activeHunk !== 0
    ) {
      this.setState({ activeHunk: 0 })
    }
  }

  private open = () => {
    const fullPath = Path.join(this.props.repository.path, this.props.path)
    this.props.onOpenBinaryFile(fullPath)
  }

  private setActiveHunk = (index: number) => {
    const hunkCount = this.props.diff.hunks.length

    if (hunkCount === 0) {
      return
    }

    const activeHunk = Math.max(0, Math.min(index, hunkCount - 1))
    this.setState({ activeHunk }, () => {
      document
        .getElementById(`binary-diff-hunk-${activeHunk}`)
        ?.scrollIntoView({ block: 'center' })
    })
  }

  private previousHunk = () => {
    this.setActiveHunk(this.state.activeHunk - 1)
  }

  private nextHunk = () => {
    this.setActiveHunk(this.state.activeHunk + 1)
  }

  private isChanged(
    offset: number,
    changes: ReadonlyArray<IBinaryDiffChange>,
    side: 'previous' | 'current'
  ) {
    for (const change of changes) {
      const start =
        side === 'previous' ? change.previousStart : change.currentStart
      const length =
        side === 'previous' ? change.previousLength : change.currentLength

      if (length > 0 && offset >= start && offset < start + length) {
        return true
      }
    }

    return false
  }

  private renderHexBytes(
    segment: IBinaryDiffSegment | undefined,
    rowIndex: number,
    changes: ReadonlyArray<IBinaryDiffChange>,
    side: 'previous' | 'current'
  ) {
    const bytes: React.ReactNode[] = []

    for (let column = 0; column < BytesPerRow; column++) {
      const dataIndex = rowIndex * BytesPerRow + column
      const value =
        segment !== undefined && dataIndex < segment.data.length
          ? segment.data[dataIndex]
          : undefined
      const offset =
        segment === undefined ? 0 : segment.offset + dataIndex
      const changed =
        value !== undefined && this.isChanged(offset, changes, side)

      bytes.push(
        <span
          className={
            changed
              ? `hex-byte ${side === 'previous' ? 'hex-byte-removed' : 'hex-byte-added'}`
              : 'hex-byte'
          }
          key={column}
        >
          {value === undefined
            ? '  '
            : value.toString(16).padStart(2, '0').toUpperCase()}
        </span>
      )
    }

    return bytes
  }

  private renderAsciiBytes(
    segment: IBinaryDiffSegment | undefined,
    rowIndex: number,
    changes: ReadonlyArray<IBinaryDiffChange>,
    side: 'previous' | 'current'
  ) {
    const bytes: React.ReactNode[] = []

    for (let column = 0; column < BytesPerRow; column++) {
      const dataIndex = rowIndex * BytesPerRow + column
      const value =
        segment !== undefined && dataIndex < segment.data.length
          ? segment.data[dataIndex]
          : undefined
      const offset =
        segment === undefined ? 0 : segment.offset + dataIndex
      const changed =
        value !== undefined && this.isChanged(offset, changes, side)

      bytes.push(
        <span
          className={
            changed
              ? `hex-ascii-byte ${side === 'previous' ? 'hex-byte-removed' : 'hex-byte-added'}`
              : 'hex-ascii-byte'
          }
          key={column}
        >
          {value === undefined
            ? ' '
            : isPrintable(value)
              ? String.fromCharCode(value)
              : '.'}
        </span>
      )
    }

    return bytes
  }

  private renderSide(
    segment: IBinaryDiffSegment | undefined,
    rowIndex: number,
    changes: ReadonlyArray<IBinaryDiffChange>,
    side: 'previous' | 'current'
  ) {
    const hasData =
      segment !== undefined && rowIndex * BytesPerRow < segment.data.length

    return (
      <>
        <td className="hex-offset">
          {hasData
            ? formatOffset(segment.offset + rowIndex * BytesPerRow)
            : ''}
        </td>
        <td className="hex-bytes">
          {this.renderHexBytes(segment, rowIndex, changes, side)}
        </td>
        <td className="hex-ascii">
          {this.renderAsciiBytes(segment, rowIndex, changes, side)}
        </td>
      </>
    )
  }

  private renderGap(
    previousOmitted: number,
    currentOmitted: number,
    key: string
  ) {
    if (previousOmitted === 0 && currentOmitted === 0) {
      return null
    }

    return (
      <tr className="binary-diff-gap" key={key}>
        <td colSpan={3}>
          {previousOmitted > 0
            ? `… ${formatByteCount(previousOmitted)} omitted …`
            : ''}
        </td>
        <td colSpan={3}>
          {currentOmitted > 0
            ? `… ${formatByteCount(currentOmitted)} omitted …`
            : ''}
        </td>
      </tr>
    )
  }

  private renderHunkRows(
    previous: ReadonlyArray<IBinaryDiffSegment>,
    current: ReadonlyArray<IBinaryDiffSegment>,
    changes: ReadonlyArray<IBinaryDiffChange>
  ) {
    const rows: React.ReactNode[] = []
    const segmentCount = Math.max(previous.length, current.length)

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const previousSegment = previous[segmentIndex]
      const currentSegment = current[segmentIndex]
      const gap = this.renderGap(
        previousSegment?.omittedBefore ?? 0,
        currentSegment?.omittedBefore ?? 0,
        `gap-${segmentIndex}`
      )

      if (gap !== null) {
        rows.push(gap)
      }

      const previousRows =
        previousSegment === undefined
          ? 0
          : Math.ceil(previousSegment.data.length / BytesPerRow)
      const currentRows =
        currentSegment === undefined
          ? 0
          : Math.ceil(currentSegment.data.length / BytesPerRow)
      const rowCount = Math.max(previousRows, currentRows)

      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        rows.push(
          <tr key={`segment-${segmentIndex}-row-${rowIndex}`}>
            {this.renderSide(
              previousSegment,
              rowIndex,
              changes,
              'previous'
            )}
            {this.renderSide(currentSegment, rowIndex, changes, 'current')}
          </tr>
        )
      }
    }

    return rows
  }

  private getHunkSummary(changes: ReadonlyArray<IBinaryDiffChange>) {
    let previousBytes = 0
    let currentBytes = 0

    for (const change of changes) {
      previousBytes += change.previousLength
      currentBytes += change.currentLength
    }

    if (previousBytes === currentBytes) {
      return `${formatByteCount(previousBytes)} changed`
    }

    return `${formatByteCount(previousBytes)} removed, ${formatByteCount(currentBytes)} added`
  }

  private renderHunk(index: number) {
    const hunk = this.props.diff.hunks[index]
    const firstChange = hunk.changes[0]
    const isActive = index === this.state.activeHunk

    return (
      <section
        className={`binary-diff-hunk${isActive ? ' active' : ''}`}
        id={`binary-diff-hunk-${index}`}
        key={index}
        onMouseDown={() => this.setState({ activeHunk: index })}
      >
        <div className="binary-diff-hunk-header">
          <span className="binary-diff-hunk-title">Change {index + 1}</span>
          <span className="binary-diff-hunk-summary">
            0x{formatOffset(firstChange.previousStart)} → 0x
            {formatOffset(firstChange.currentStart)}
            {' · '}
            {this.getHunkSummary(hunk.changes)}
          </span>
        </div>
        <table className="binary-diff-table">
          <thead>
            <tr>
              <th colSpan={3} className="binary-diff-side-title">
                Before
              </th>
              <th colSpan={3} className="binary-diff-side-title">
                After
              </th>
            </tr>
            <tr>
              <th>Offset</th>
              <th>Hex</th>
              <th>ASCII</th>
              <th>Offset</th>
              <th>Hex</th>
              <th>ASCII</th>
            </tr>
          </thead>
          <tbody>
            {this.renderHunkRows(
              hunk.previous,
              hunk.current,
              hunk.changes
            )}
          </tbody>
        </table>
      </section>
    )
  }

  public render() {
    const { diff } = this.props
    const hunkCount = diff.hunks.length
    const previousTruncated = diff.previous?.truncated === true
    const currentTruncated = diff.current?.truncated === true
    const comparisonTruncated = previousTruncated || currentTruncated
    const loadedBytes = Math.max(
      diff.previous?.loadedByteLength ?? 0,
      diff.current?.loadedByteLength ?? 0
    )

    return (
      <div className="panel binary binary-diff" id="diff">
        <div className="binary-diff-header">
          <div className="binary-diff-heading">
            <div className="binary-diff-title">Binary compare</div>
            <div className="binary-diff-subtitle">
              {BytesPerRow} bytes per row · resynchronizes after insertions and
              deletions · {diff.changeCount}
              {diff.hunksTruncated ? '+' : ''} change regions
            </div>
          </div>
          <div className="binary-diff-actions">
            <div className="binary-diff-navigation">
              <Button
                size="small"
                disabled={hunkCount === 0 || this.state.activeHunk === 0}
                onClick={this.previousHunk}
              >
                Previous
              </Button>
              <span className="binary-diff-position">
                {hunkCount === 0 ? '0 / 0' : `${this.state.activeHunk + 1} / ${hunkCount}`}
              </span>
              <Button
                size="small"
                disabled={
                  hunkCount === 0 ||
                  this.state.activeHunk >= hunkCount - 1
                }
                onClick={this.nextHunk}
              >
                Next
              </Button>
            </div>
            <LinkButton onClick={this.open}>
              Open file in external program
            </LinkButton>
          </div>
        </div>

        {comparisonTruncated ? (
          <div className="binary-diff-notice">
            Compared the first {formatByteCount(loadedBytes)} of each available
            side. The file is larger, so additional differences may exist later.
          </div>
        ) : null}

        {diff.hunksTruncated ? (
          <div className="binary-diff-notice">
            This file has many separate change regions. Showing the first{' '}
            {hunkCount} grouped changes to keep the viewer responsive.
          </div>
        ) : null}

        <div className="binary-diff-table-container">
          {hunkCount === 0 ? (
            <div className="binary-diff-empty">
              {comparisonTruncated
                ? 'No byte differences were found in the loaded range. The reported change may be later in the file.'
                : 'No byte differences found.'}
            </div>
          ) : (
            diff.hunks.map((_, index) => this.renderHunk(index))
          )}
        </div>
      </div>
    )
  }
}
