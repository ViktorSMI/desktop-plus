import * as React from 'react'
import * as Path from 'path'

import { IBinaryDiff, IBinaryDiffChunk } from '../../models/diff'
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
  readonly activeChangeIndex: number
}

function formatOffset(offset: number) {
  return offset.toString(16).padStart(8, '0').toUpperCase()
}

function formatByteCount(value: number | undefined) {
  if (value === undefined) {
    return '—'
  }

  if (value < 1024) {
    return `${value} B`
  }

  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = value / 1024
  let unit = units[0]

  for (let i = 1; i < units.length && size >= 1024; i++) {
    size /= 1024
    unit = units[i]
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`
}

function formatInteger(value: number) {
  return value.toLocaleString()
}

function byteToAscii(value: number | undefined) {
  if (value === undefined) {
    return ' '
  }

  return value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '·'
}

/** Renders an HxD/WinMerge-style side-by-side binary comparison. */
export class BinaryFile extends React.Component<
  IBinaryFileProps,
  IBinaryFileState
> {
  public state: IBinaryFileState = {
    activeChangeIndex: 0,
  }

  private readonly changeRows = new Map<number, HTMLTableRowElement>()

  public componentDidUpdate(previousProps: IBinaryFileProps) {
    if (
      previousProps.diff !== this.props.diff &&
      this.state.activeChangeIndex !== 0
    ) {
      this.setState({ activeChangeIndex: 0 })
    }
  }

  private open = () => {
    const fullPath = Path.join(this.props.repository.path, this.props.path)
    this.props.onOpenBinaryFile(fullPath)
  }

  private selectChange = (changeIndex: number) => {
    if (
      changeIndex < 0 ||
      changeIndex >= this.props.diff.changeCount ||
      changeIndex === this.state.activeChangeIndex
    ) {
      return
    }

    this.setState({ activeChangeIndex: changeIndex }, () => {
      this.changeRows.get(changeIndex)?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
    })
  }

  private previousChange = () => {
    this.selectChange(this.state.activeChangeIndex - 1)
  }

  private nextChange = () => {
    this.selectChange(this.state.activeChangeIndex + 1)
  }

  private renderHexBytes(
    chunk: IBinaryDiffChunk,
    rowStart: number,
    side: 'previous' | 'current'
  ) {
    const previous = chunk.previousData
    const current = chunk.currentData
    const selected = side === 'previous' ? previous : current
    const spans: React.ReactNode[] = []

    for (let column = 0; column < BytesPerRow; column++) {
      const index = rowStart + column
      const previousByte = previous[index]
      const currentByte = current[index]
      const value = selected[index]
      const changed =
        chunk.kind === 'change' && previousByte !== currentByte
      const changeClass =
        changed && value !== undefined
          ? side === 'previous'
            ? ' hex-byte-removed'
            : ' hex-byte-added'
          : ''
      const missingClass =
        changed && value === undefined ? ' hex-byte-missing' : ''
      const groupClass = column === 7 ? ' hex-byte-group-end' : ''

      spans.push(
        <span
          className={`hex-byte${changeClass}${missingClass}${groupClass}`}
          key={column}
        >
          {value === undefined
            ? '  '
            : value.toString(16).padStart(2, '0').toUpperCase()}
        </span>
      )
    }

    return spans
  }

  private renderAsciiBytes(
    chunk: IBinaryDiffChunk,
    rowStart: number,
    side: 'previous' | 'current'
  ) {
    const previous = chunk.previousData
    const current = chunk.currentData
    const selected = side === 'previous' ? previous : current
    const spans: React.ReactNode[] = []

    for (let column = 0; column < BytesPerRow; column++) {
      const index = rowStart + column
      const previousByte = previous[index]
      const currentByte = current[index]
      const value = selected[index]
      const changed =
        chunk.kind === 'change' && previousByte !== currentByte
      const changeClass =
        changed && value !== undefined
          ? side === 'previous'
            ? ' hex-ascii-removed'
            : ' hex-ascii-added'
          : ''
      const missingClass =
        changed && value === undefined ? ' hex-ascii-missing' : ''

      spans.push(
        <span
          className={`hex-ascii-byte${changeClass}${missingClass}`}
          key={column}
        >
          {byteToAscii(value)}
        </span>
      )
    }

    return spans
  }

  private renderGap(
    chunk: IBinaryDiffChunk,
    key: string,
    captureRef: boolean
  ) {
    const isChange = chunk.kind === 'change-gap'
    const changeIndex = chunk.changeIndex
    const isActive =
      isChange && changeIndex === this.state.activeChangeIndex

    const ref =
      captureRef && changeIndex !== undefined
        ? (element: HTMLTableRowElement | null) => {
            if (element === null) {
              this.changeRows.delete(changeIndex)
            } else {
              this.changeRows.set(changeIndex, element)
            }
          }
        : undefined

    const message = isChange
      ? `… changed bytes hidden: ${formatInteger(
          chunk.previousLength
        )} before / ${formatInteger(chunk.currentLength)} after …`
      : `… ${formatInteger(chunk.previousLength)} unchanged bytes …`

    return (
      <tr
        className={`hex-diff-gap${isChange ? ' changed' : ''}${
          isActive ? ' active' : ''
        }`}
        key={key}
        ref={ref}
      >
        <td colSpan={6}>{message}</td>
      </tr>
    )
  }

  private renderChunkRows(
    chunk: IBinaryDiffChunk,
    chunkIndex: number,
    seenChanges: Set<number>
  ) {
    const rows: React.ReactNode[] = []
    const changeIndex = chunk.changeIndex
    const captureRef =
      changeIndex !== undefined && !seenChanges.has(changeIndex)

    if (changeIndex !== undefined) {
      seenChanges.add(changeIndex)
    }

    if (chunk.kind === 'equal-gap' || chunk.kind === 'change-gap') {
      rows.push(
        this.renderGap(chunk, `gap-${chunkIndex}`, captureRef)
      )
      return rows
    }

    const rowCount = Math.ceil(
      Math.max(chunk.previousData.length, chunk.currentData.length) /
        BytesPerRow
    )

    for (let row = 0; row < rowCount; row++) {
      const rowStart = row * BytesPerRow
      const previousHasData = rowStart < chunk.previousData.length
      const currentHasData = rowStart < chunk.currentData.length
      const isActive =
        chunk.kind === 'change' &&
        changeIndex === this.state.activeChangeIndex
      const ref =
        captureRef && row === 0 && changeIndex !== undefined
          ? (element: HTMLTableRowElement | null) => {
              if (element === null) {
                this.changeRows.delete(changeIndex)
              } else {
                this.changeRows.set(changeIndex, element)
              }
            }
          : undefined

      rows.push(
        <tr
          className={`${chunk.kind === 'change' ? 'hex-diff-change' : ''}${
            isActive ? ' active' : ''
          }`}
          key={`${chunkIndex}-${row}`}
          ref={ref}
        >
          <td className="hex-offset">
            {previousHasData
              ? formatOffset(chunk.previousOffset + rowStart)
              : ''}
          </td>
          <td className="hex-bytes">
            {this.renderHexBytes(chunk, rowStart, 'previous')}
          </td>
          <td className="hex-ascii">
            {this.renderAsciiBytes(chunk, rowStart, 'previous')}
          </td>
          <td className="hex-offset">
            {currentHasData
              ? formatOffset(chunk.currentOffset + rowStart)
              : ''}
          </td>
          <td className="hex-bytes">
            {this.renderHexBytes(chunk, rowStart, 'current')}
          </td>
          <td className="hex-ascii">
            {this.renderAsciiBytes(chunk, rowStart, 'current')}
          </td>
        </tr>
      )
    }

    return rows
  }

  private renderRows() {
    const rows: React.ReactNode[] = []
    const seenChanges = new Set<number>()

    this.props.diff.chunks.forEach((chunk, chunkIndex) => {
      rows.push(...this.renderChunkRows(chunk, chunkIndex, seenChanges))
    })

    return rows
  }

  private renderIncompleteNotice() {
    const diff = this.props.diff

    if (diff.complete) {
      return null
    }

    if (
      diff.previousSize === undefined &&
      diff.currentSize === undefined
    ) {
      return (
        <div className="binary-diff-notice">
          Binary conflict contents are not available for inline comparison.
        </div>
      )
    }

    const before =
      diff.previousSize === undefined
        ? null
        : `Before: compared ${formatByteCount(
            diff.previousComparedBytes
          )} of ${formatByteCount(diff.previousSize)}`
    const after =
      diff.currentSize === undefined
        ? null
        : `After: compared ${formatByteCount(
            diff.currentComparedBytes
          )} of ${formatByteCount(diff.currentSize)}`

    return (
      <div className="binary-diff-notice">
        Comparison is limited for oversized files.{' '}
        {[before, after].filter(x => x !== null).join(' · ')}
      </div>
    )
  }

  private renderEmpty() {
    const diff = this.props.diff

    if (!diff.complete) {
      return (
        <div className="binary-diff-empty">
          No differences were found in the compared byte range.
        </div>
      )
    }

    return (
      <div className="binary-diff-empty">
        No byte differences found.
      </div>
    )
  }

  public render() {
    const diff = this.props.diff
    const hasChanges = diff.changeCount > 0
    const currentDifference = hasChanges
      ? this.state.activeChangeIndex + 1
      : 0

    return (
      <div className="panel binary binary-diff" id="diff">
        <div className="binary-diff-header">
          <div className="binary-diff-heading">
            <div className="binary-diff-title">Binary compare</div>
            <div className="binary-diff-subtitle">
              Before {formatByteCount(diff.previousSize)} · After{' '}
              {formatByteCount(diff.currentSize)} ·{' '}
              {formatInteger(diff.changeCount)} changed region
              {diff.changeCount === 1 ? '' : 's'}
            </div>
          </div>

          <div className="binary-diff-actions">
            <Button
              size="small"
              onClick={this.previousChange}
              disabled={
                !hasChanges || this.state.activeChangeIndex === 0
              }
            >
              Previous
            </Button>
            <span className="binary-diff-position">
              {hasChanges
                ? `Difference ${currentDifference} of ${formatInteger(
                    diff.changeCount
                  )}`
                : 'No differences'}
            </span>
            <Button
              size="small"
              onClick={this.nextChange}
              disabled={
                !hasChanges ||
                this.state.activeChangeIndex >= diff.changeCount - 1
              }
            >
              Next
            </Button>
            <LinkButton onClick={this.open}>
              Open file in external program
            </LinkButton>
          </div>
        </div>

        {this.renderIncompleteNotice()}

        <div className="binary-diff-table-container">
          {diff.chunks.length === 0 ? (
            this.renderEmpty()
          ) : (
            <table className="binary-diff-table">
              <thead>
                <tr>
                  <th>Before offset</th>
                  <th>Before hex</th>
                  <th>ASCII</th>
                  <th>After offset</th>
                  <th>After hex</th>
                  <th>ASCII</th>
                </tr>
              </thead>
              <tbody>{this.renderRows()}</tbody>
            </table>
          )}
        </div>
      </div>
    )
  }
}
