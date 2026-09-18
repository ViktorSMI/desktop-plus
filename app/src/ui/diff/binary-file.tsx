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

interface IBinaryDiffCell {
  readonly previousByte?: number
  readonly currentByte?: number
  readonly previousOffset?: number
  readonly currentOffset?: number
  readonly changed: boolean
  readonly changeIndex?: number
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

function getRowOffset(
  cells: ReadonlyArray<IBinaryDiffCell>,
  side: 'previous' | 'current'
) {
  for (let column = 0; column < cells.length; column++) {
    const offset =
      side === 'previous'
        ? cells[column].previousOffset
        : cells[column].currentOffset

    if (offset !== undefined) {
      return Math.max(0, offset - column)
    }
  }

  return undefined
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

  private renderHexCells(
    cells: ReadonlyArray<IBinaryDiffCell>,
    side: 'previous' | 'current'
  ) {
    const spans: React.ReactNode[] = []

    for (let column = 0; column < BytesPerRow; column++) {
      const cell = cells[column]
      const value =
        cell === undefined
          ? undefined
          : side === 'previous'
            ? cell.previousByte
            : cell.currentByte
      const changed = cell?.changed === true
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

  private renderAsciiCells(
    cells: ReadonlyArray<IBinaryDiffCell>,
    side: 'previous' | 'current'
  ) {
    const spans: React.ReactNode[] = []

    for (let column = 0; column < BytesPerRow; column++) {
      const cell = cells[column]
      const value =
        cell === undefined
          ? undefined
          : side === 'previous'
            ? cell.previousByte
            : cell.currentByte
      const changed = cell?.changed === true
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

  private appendChunkCells(
    cells: IBinaryDiffCell[],
    chunk: IBinaryDiffChunk
  ) {
    const cellCount = Math.max(
      chunk.previousData.length,
      chunk.currentData.length
    )

    for (let index = 0; index < cellCount; index++) {
      const previousByte = chunk.previousData[index]
      const currentByte = chunk.currentData[index]
      const isChange = chunk.kind === 'change'

      cells.push({
        previousByte,
        currentByte,
        previousOffset:
          previousByte === undefined
            ? undefined
            : chunk.previousOffset + index,
        currentOffset:
          currentByte === undefined
            ? undefined
            : chunk.currentOffset + index,
        changed: isChange && previousByte !== currentByte,
        changeIndex: isChange ? chunk.changeIndex : undefined,
      })
    }
  }

  private renderCellGroup(
    chunks: ReadonlyArray<IBinaryDiffChunk>,
    groupIndex: number,
    seenChanges: Set<number>
  ) {
    const cells: IBinaryDiffCell[] = []

    for (const chunk of chunks) {
      this.appendChunkCells(cells, chunk)
    }

    if (cells.length === 0) {
      return []
    }

    const firstCell = cells[0]
    const firstOffset =
      firstCell.previousOffset ?? firstCell.currentOffset ?? 0
    const leadingCells = firstOffset % BytesPerRow

    if (leadingCells > 0) {
      const padding: IBinaryDiffCell[] = []

      for (let i = 0; i < leadingCells; i++) {
        padding.push({ changed: false })
      }

      cells.unshift(...padding)
    }

    const rows: React.ReactNode[] = []
    const rowCount = Math.ceil(cells.length / BytesPerRow)

    for (let row = 0; row < rowCount; row++) {
      const rowStart = row * BytesPerRow
      const rowCells = cells.slice(rowStart, rowStart + BytesPerRow)
      const rowChanges = Array.from(
        new Set(
          rowCells
            .map(cell => cell.changeIndex)
            .filter(
              (changeIndex): changeIndex is number =>
                changeIndex !== undefined
            )
        )
      )
      const changesToCapture = rowChanges.filter(
        changeIndex => !seenChanges.has(changeIndex)
      )

      for (const changeIndex of changesToCapture) {
        seenChanges.add(changeIndex)
      }

      const isActive = rowChanges.includes(
        this.state.activeChangeIndex
      )
      const previousOffset = getRowOffset(rowCells, 'previous')
      const currentOffset = getRowOffset(rowCells, 'current')
      const ref =
        changesToCapture.length > 0
          ? (element: HTMLTableRowElement | null) => {
              for (const changeIndex of changesToCapture) {
                if (element === null) {
                  this.changeRows.delete(changeIndex)
                } else {
                  this.changeRows.set(changeIndex, element)
                }
              }
            }
          : undefined

      rows.push(
        <tr
          className={`hex-diff-row${isActive ? ' active' : ''}`}
          key={`group-${groupIndex}-row-${row}`}
          ref={ref}
        >
          <td className="hex-offset">
            {previousOffset === undefined
              ? ''
              : formatOffset(previousOffset)}
          </td>
          <td className="hex-bytes">
            {this.renderHexCells(rowCells, 'previous')}
          </td>
          <td className="hex-ascii">
            {this.renderAsciiCells(rowCells, 'previous')}
          </td>
          <td className="hex-offset">
            {currentOffset === undefined
              ? ''
              : formatOffset(currentOffset)}
          </td>
          <td className="hex-bytes">
            {this.renderHexCells(rowCells, 'current')}
          </td>
          <td className="hex-ascii">
            {this.renderAsciiCells(rowCells, 'current')}
          </td>
        </tr>
      )
    }

    return rows
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

  private renderRows() {
    const rows: React.ReactNode[] = []
    const group: IBinaryDiffChunk[] = []
    const seenChanges = new Set<number>()
    let groupIndex = 0

    const flushGroup = () => {
      if (group.length === 0) {
        return
      }

      rows.push(
        ...this.renderCellGroup(group, groupIndex++, seenChanges)
      )
      group.length = 0
    }

    this.props.diff.chunks.forEach((chunk, chunkIndex) => {
      if (chunk.kind !== 'equal-gap' && chunk.kind !== 'change-gap') {
        group.push(chunk)
        return
      }

      flushGroup()

      const changeIndex = chunk.changeIndex
      const captureRef =
        changeIndex !== undefined && !seenChanges.has(changeIndex)

      if (captureRef && changeIndex !== undefined) {
        seenChanges.add(changeIndex)
      }

      rows.push(
        this.renderGap(
          chunk,
          `gap-${chunkIndex}`,
          captureRef
        )
      )
    })

    flushGroup()
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
