import * as React from 'react'
import * as Path from 'path'

import { IBinaryDiff } from '../../models/diff'
import { Repository } from '../../models/repository'

import { LinkButton } from '../lib/link-button'

const BytesPerRow = 16
const ContextRows = 1
const MaxRenderedRows = 2048

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

interface IRowsToRender {
  readonly rowIndexes: ReadonlyArray<number>
  readonly truncated: boolean
}

function getByte(data: ReadonlyArray<number>, offset: number) {
  return offset < data.length ? data[offset] : undefined
}

function getRowsToRender(
  previous: ReadonlyArray<number>,
  current: ReadonlyArray<number>
): IRowsToRender {
  const rowCount = Math.ceil(
    Math.max(previous.length, current.length) / BytesPerRow
  )
  const includedRows = new Set<number>()

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const rowOffset = rowIndex * BytesPerRow
    let changed = false

    for (let column = 0; column < BytesPerRow; column++) {
      const offset = rowOffset + column
      if (getByte(previous, offset) !== getByte(current, offset)) {
        changed = true
        break
      }
    }

    if (changed) {
      const firstContextRow = Math.max(0, rowIndex - ContextRows)
      const lastContextRow = Math.min(rowCount - 1, rowIndex + ContextRows)

      for (
        let contextRow = firstContextRow;
        contextRow <= lastContextRow;
        contextRow++
      ) {
        includedRows.add(contextRow)
      }
    }
  }

  const allRows = Array.from(includedRows).sort((a, b) => a - b)

  return {
    rowIndexes: allRows.slice(0, MaxRenderedRows),
    truncated: allRows.length > MaxRenderedRows,
  }
}

/** Renders a compact byte-by-byte hex preview for binary file changes. */
export class BinaryFile extends React.Component<IBinaryFileProps, {}> {
  private open = () => {
    const fullPath = Path.join(this.props.repository.path, this.props.path)
    this.props.onOpenBinaryFile(fullPath)
  }

  private renderBytes(
    previous: ReadonlyArray<number>,
    current: ReadonlyArray<number>,
    offset: number,
    side: 'previous' | 'current'
  ) {
    const spans = []

    for (let column = 0; column < BytesPerRow; column++) {
      const byteOffset = offset + column
      const previousByte = getByte(previous, byteOffset)
      const currentByte = getByte(current, byteOffset)
      const value = side === 'previous' ? previousByte : currentByte
      const changed = previousByte !== currentByte
      const changeClass =
        changed && value !== undefined
          ? side === 'previous'
            ? ' hex-byte-removed'
            : ' hex-byte-added'
          : ''

      spans.push(
        <span
          className={`hex-byte${changeClass}`}
          key={column}
          title={`0x${byteOffset.toString(16).toUpperCase()}`}
        >
          {value === undefined
            ? '  '
            : value.toString(16).padStart(2, '0').toUpperCase()}
        </span>
      )
    }

    return spans
  }

  private renderRows(
    previous: ReadonlyArray<number>,
    current: ReadonlyArray<number>,
    rowIndexes: ReadonlyArray<number>
  ) {
    const rows: React.ReactNode[] = []
    let previousRowIndex: number | undefined = undefined

    for (const rowIndex of rowIndexes) {
      if (previousRowIndex !== undefined && rowIndex > previousRowIndex + 1) {
        rows.push(
          <tr className="hex-diff-gap" key={`gap-${rowIndex}`}>
            <td colSpan={3}>… unchanged bytes …</td>
          </tr>
        )
      }

      const offset = rowIndex * BytesPerRow
      rows.push(
        <tr key={rowIndex}>
          <td className="hex-offset">
            {offset.toString(16).padStart(8, '0').toUpperCase()}
          </td>
          <td className="hex-bytes">
            {this.renderBytes(previous, current, offset, 'previous')}
          </td>
          <td className="hex-bytes">
            {this.renderBytes(previous, current, offset, 'current')}
          </td>
        </tr>
      )

      previousRowIndex = rowIndex
    }

    return rows
  }

  public render() {
    const previous = this.props.diff.previous?.data ?? []
    const current = this.props.diff.current?.data ?? []
    const rows = getRowsToRender(previous, current)
    const previewTruncated =
      this.props.diff.previous?.truncated === true ||
      this.props.diff.current?.truncated === true

    return (
      <div className="panel binary binary-diff" id="diff">
        <div className="binary-diff-header">
          <div>
            <div className="binary-diff-title">Hex diff</div>
            <div className="binary-diff-subtitle">
              {BytesPerRow} bytes per row, changed rows with context
            </div>
          </div>
          <LinkButton onClick={this.open}>
            Open file in external program
          </LinkButton>
        </div>

        {previewTruncated ? (
          <div className="binary-diff-notice">
            Preview is limited to the first 64 KiB of each file.
          </div>
        ) : null}

        {rows.truncated ? (
          <div className="binary-diff-notice">
            Only the first {MaxRenderedRows} changed/context rows are shown.
          </div>
        ) : null}

        <div className="binary-diff-table-container">
          {rows.rowIndexes.length === 0 ? (
            <div className="binary-diff-empty">
              No byte differences found in the available preview.
            </div>
          ) : (
            <table className="binary-diff-table">
              <thead>
                <tr>
                  <th>Offset</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {this.renderRows(previous, current, rows.rowIndexes)}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }
}
