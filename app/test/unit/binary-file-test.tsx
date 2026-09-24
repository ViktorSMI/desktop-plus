import * as React from 'react'
import * as Path from 'path'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { cleanup, fireEvent, render, within } from '@testing-library/react'

import { DiffType, IBinaryDiff } from '../../src/models/diff'
import { Repository } from '../../src/models/repository'
import { BinaryFile } from '../../src/ui/diff/binary-file'

function createDiff(hunkCount: number, previewBytes = 16): IBinaryDiff {
  return {
    kind: DiffType.Binary,
    previous: { loadedByteLength: hunkCount * 2048, truncated: false },
    current: { loadedByteLength: hunkCount * 2048, truncated: false },
    changeCount: hunkCount,
    hunksTruncated: false,
    hunks: Array.from({ length: hunkCount }, (_, index) => ({
      changes: [
        {
          previousStart: index * 2048,
          previousLength: previewBytes,
          currentStart: index * 2048,
          currentLength: previewBytes,
        },
      ],
      previous: [
        {
          offset: index * 2048,
          data: Array.from({ length: previewBytes }, () => 0x41),
          omittedBefore: 0,
        },
      ],
      current: [
        {
          offset: index * 2048,
          data: Array.from({ length: previewBytes }, () => 0x42),
          omittedBefore: 0,
        },
      ],
    })),
  }
}

const repository = new Repository(
  Path.join(process.cwd(), 'binary-diff-test'),
  1,
  null,
  false
)

function view(
  diff: IBinaryDiff,
  onOpenBinaryFile: (path: string) => void = () => {}
) {
  return (
    <BinaryFile
      repository={repository}
      path="example.bin"
      diff={diff}
      onOpenBinaryFile={onOpenBinaryFile}
    />
  )
}

function assertActiveHunk(container: HTMLElement, index: number) {
  const headers = container.querySelectorAll('.binary-diff-change-row')
  assert.equal(headers.length, 1)
  assert.equal(headers[0].id, `binary-diff-hunk-${index}`)
  assert.equal(container.querySelectorAll('.binary-diff-table').length, 1)
}

function isButtonDisabled(button: HTMLElement) {
  return button.getAttribute('aria-disabled') === 'true'
}

describe('BinaryFile', () => {
  afterEach(() => cleanup())

  it('mounts the same byte count for one or 512 hunks', async () => {
    const { container, rerender, getByText } = render(view(createDiff(1)))
    const singleHunkBytes = container.querySelectorAll('.hex-byte').length
    const singleHunkAscii = container.querySelectorAll('.hex-ascii-byte').length

    rerender(view(createDiff(512)))

    assertActiveHunk(container, 0)
    assert.equal(
      container.querySelectorAll('.hex-byte').length,
      singleHunkBytes
    )
    assert.equal(
      container.querySelectorAll('.hex-ascii-byte').length,
      singleHunkAscii
    )
    assert.equal(singleHunkBytes, 32)
    assert.equal(singleHunkAscii, 32)
    assert.ok(getByText('1 / 512'))
  })

  it('renders at most one full-sized preview at a time', async () => {
    const { container, getByRole } = render(view(createDiff(2, 1024)))

    assertActiveHunk(container, 0)
    assert.equal(container.querySelectorAll('.hex-byte').length, 2048)
    assert.equal(container.querySelectorAll('.hex-ascii-byte').length, 2048)

    fireEvent.click(getByRole('button', { name: 'Next' }))

    assertActiveHunk(container, 1)
    assert.equal(container.querySelectorAll('.hex-byte').length, 2048)
    assert.equal(container.querySelectorAll('.hex-ascii-byte').length, 2048)
    assert.equal(container.querySelector('#binary-diff-hunk-0'), null)
  })

  it('navigates all hunks without retaining previous DOM', async () => {
    const { container, getByRole, getByText } = render(view(createDiff(8)))
    const previous = getByRole('button', { name: 'Previous' })
    const next = getByRole('button', { name: 'Next' })

    assert.equal(isButtonDisabled(previous), true)
    assert.equal(isButtonDisabled(next), false)

    for (let index = 1; index < 8; index++) {
      fireEvent.click(next)
      assertActiveHunk(container, index)
      assert.equal(container.querySelectorAll('.hex-byte').length, 32)
      assert.ok(getByText(`${index + 1} / 8`))
    }

    assert.equal(isButtonDisabled(next), true)

    for (let index = 6; index >= 0; index--) {
      fireEvent.click(previous)
      assertActiveHunk(container, index)
      assert.equal(container.querySelectorAll('.hex-byte').length, 32)
    }

    assert.equal(isButtonDisabled(previous), true)
  })

  it('resets before rendering a shorter replacement diff', async () => {
    const { container, getByRole, getByText, rerender } = render(
      view(createDiff(3))
    )
    fireEvent.click(getByRole('button', { name: 'Next' }))
    fireEvent.click(getByRole('button', { name: 'Next' }))
    assertActiveHunk(container, 2)

    rerender(view(createDiff(1)))

    assertActiveHunk(container, 0)
    assert.ok(getByText('1 / 1'))
    assert.equal(
      isButtonDisabled(getByRole('button', { name: 'Previous' })),
      true
    )
    assert.equal(isButtonDisabled(getByRole('button', { name: 'Next' })), true)
  })

  it('handles empty diffs and newly available changes', async () => {
    const { container, getByRole, getByText, rerender } = render(
      view(createDiff(3))
    )
    fireEvent.click(getByRole('button', { name: 'Next' }))
    fireEvent.click(getByRole('button', { name: 'Next' }))

    rerender(view(createDiff(0)))

    assert.equal(container.querySelectorAll('.binary-diff-table').length, 0)
    assert.equal(container.querySelectorAll('.hex-byte').length, 0)
    assert.ok(getByText('0 / 0'))
    assert.ok(getByText('No byte differences found.'))
    assert.equal(
      isButtonDisabled(getByRole('button', { name: 'Previous' })),
      true
    )
    assert.equal(isButtonDisabled(getByRole('button', { name: 'Next' })), true)

    rerender(view(createDiff(2)))

    assertActiveHunk(container, 0)
    assert.ok(getByText('1 / 2'))
  })

  it('preserves the active hunk when the diff has not changed', async () => {
    const diff = createDiff(3)
    const { container, getByRole, rerender } = render(view(diff))
    fireEvent.click(getByRole('button', { name: 'Next' }))

    rerender(view(diff))

    assertActiveHunk(container, 1)
  })

  it('resets scroll only in its own viewer', async () => {
    const first = render(view(createDiff(3)))
    const second = render(view(createDiff(3)))
    const firstScroller = first.container.querySelector<HTMLElement>(
      '.binary-diff-table-container'
    )
    const secondScroller = second.container.querySelector<HTMLElement>(
      '.binary-diff-table-container'
    )
    assert.ok(firstScroller)
    assert.ok(secondScroller)
    firstScroller.scrollTop = 200
    secondScroller.scrollTop = 300

    fireEvent.click(
      within(first.container).getByRole('button', { name: 'Next' })
    )

    assert.equal(firstScroller.scrollTop, 0)
    assert.equal(secondScroller.scrollTop, 300)
    assertActiveHunk(first.container, 1)
    assertActiveHunk(second.container, 0)

    firstScroller.scrollTop = 200
    first.rerender(view(createDiff(1)))

    assert.equal(firstScroller.scrollTop, 0)
    assert.equal(secondScroller.scrollTop, 300)
  })

  it('preserves partial-comparison warnings', async () => {
    const diff: IBinaryDiff = {
      ...createDiff(1),
      previous: { loadedByteLength: 64 * 1024 * 1024, truncated: true },
      hunksTruncated: true,
    }
    const { getByText } = render(view(diff))

    assert.ok(getByText(/Compared the first 64 MiB/))
    assert.ok(getByText(/This file has many separate change regions/))
  })

  it('still opens the file in the external program', async () => {
    let openedPath: string | undefined
    const { getByText } = render(
      view(createDiff(1), path => {
        openedPath = path
      })
    )

    fireEvent.click(getByText('Open file in external program'))

    assert.equal(openedPath, Path.join(repository.path, 'example.bin'))
  })
})
