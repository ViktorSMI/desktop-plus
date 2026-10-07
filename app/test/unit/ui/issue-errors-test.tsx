import assert from 'node:assert'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import * as React from 'react'

import { IAPIIssueDetails } from '../../../src/lib/api'
import { GitHubRepository } from '../../../src/models/github-repository'
import { IssuesStore } from '../../../src/lib/stores/issues-store'
import { RepositoryWithGitHubRepository } from '../../../src/models/repository'
import { IssueList } from '../../../src/ui/branches/issue-list'
import { IssueDetailDialog } from '../../../src/ui/branches/issue-detail-dialog'
import { SandboxedMarkdown } from '../../../src/ui/lib/sandboxed-markdown'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const repository = {
  hash: 'owner/repo',
  fullName: 'owner/repo',
} as GitHubRepository

const details = {
  issue: {
    number: 1,
    title: 'An issue',
    body: '',
    state: 'open',
    created_at: '2026-01-01T00:00:00Z',
    user: { login: 'author' },
  },
  comments: [
    {
      id: 1,
      body: 'Existing comment',
      created_at: '2026-01-02T00:00:00Z',
      user: { login: 'commenter' },
    },
  ],
} as unknown as IAPIIssueDetails

function showDialog(fetchIssueDetails: () => Promise<IAPIIssueDetails | null>) {
  const dispatcher = { fetchIssueDetails } as unknown as Dispatcher
  return render(
    <IssueDetailDialog
      repository={repository}
      issueNumber={1}
      dispatcher={dispatcher}
      emoji={new Map()}
      underlineLinks={false}
      onDismissed={() => {}}
    />
  )
}

describe('issue comment loading errors', () => {
  let restoreIpcSend: () => void
  let restoreMarkdown: () => void
  beforeEach(async () => {
    const mount = mock.method(
      SandboxedMarkdown.prototype,
      'componentDidMount',
      async () => {}
    )
    const update = mock.method(
      SandboxedMarkdown.prototype,
      'componentDidUpdate',
      async () => {}
    )
    restoreMarkdown = () => {
      mount.mock.restore()
      update.mock.restore()
    }
    const electron = await import('electron')
    const previousSend = electron.ipcRenderer.send
    electron.ipcRenderer.send = () => {}
    restoreIpcSend = () => {
      electron.ipcRenderer.send = previousSend
    }
  })
  afterEach(() => {
    restoreIpcSend()
    restoreMarkdown()
  })

  it('keeps the issue readable and offers retry without a false empty state', async () => {
    let calls = 0
    showDialog(async () => {
      calls++
      return calls === 1
        ? { ...details, comments: [], commentsError: true }
        : { ...details, comments: [] }
    })

    await screen.findByRole('button', { name: 'Retry comments', hidden: true })
    assert.ok(screen.getByText('An issue'))
    assert.equal(screen.queryByText('No comments yet.'), null)
    assert.equal(screen.queryByText('Comments (0)'), null)

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry comments', hidden: true })
    )
    await screen.findByText('No comments yet.')
    assert.equal(
      screen.queryByRole('button', { name: 'Retry comments', hidden: true }),
      null
    )
  })

  it('preserves previously loaded comments when refresh fails', async () => {
    let calls = 0
    showDialog(async () => {
      calls++
      return calls === 1
        ? details
        : { ...details, comments: [], commentsError: true }
    })

    await screen.findByText('commenter')
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh', hidden: true })
    )
    await screen.findByRole('button', { name: 'Retry comments', hidden: true })
    assert.ok(screen.getByText('commenter'))
    assert.equal(screen.queryByText('No comments yet.'), null)
  })

  it('ignores an old response after navigating to a different issue', async () => {
    let finishOld!: (value: IAPIIssueDetails) => void
    const oldRequest = new Promise<IAPIIssueDetails>(resolve => {
      finishOld = resolve
    })
    const dispatcher = {
      fetchIssueDetails: async (
        _repository: GitHubRepository,
        issueNumber: number
      ) =>
        issueNumber === 1
          ? oldRequest
          : {
              ...details,
              issue: { ...details.issue, number: 2, title: 'New issue' },
            },
    } as unknown as Dispatcher
    const props = {
      repository,
      dispatcher,
      emoji: new Map(),
      underlineLinks: false,
      onDismissed: () => {},
    }
    const view = render(<IssueDetailDialog {...props} issueNumber={1} />)
    const content = view.container.querySelector('.issue-reader-content')!
    Object.assign(content, { scrollTo: () => {} })
    view.rerender(<IssueDetailDialog {...props} issueNumber={2} />)
    await screen.findByText('New issue')
    finishOld({ ...details, comments: [], commentsError: true })
    await oldRequest
    await waitFor(() => {
      assert.ok(screen.getByText('New issue'))
      assert.equal(screen.queryByText('An issue'), null)
      assert.equal(screen.queryByText('Retry comments'), null)
    })
  })

  it('preserves valid details when the entire refresh rejects', async () => {
    let calls = 0
    showDialog(async () => {
      if (++calls > 1) {
        throw new Error('Offline')
      }
      return details
    })
    await screen.findByText('commenter')
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh', hidden: true })
    )
    await waitFor(() => assert.ok(screen.getByRole('alert', { hidden: true })))
    assert.ok(screen.getByText('An issue'))
    assert.ok(screen.getByText('commenter'))
  })
})

describe('issue list loading errors', () => {
  let originalResizeObserver: typeof ResizeObserver
  beforeEach(() => {
    originalResizeObserver = window.ResizeObserver
    window.ResizeObserver = globalThis.ResizeObserver
  })
  afterEach(() => {
    if (originalResizeObserver === undefined) {
      Reflect.deleteProperty(window, 'ResizeObserver')
    } else {
      window.ResizeObserver = originalResizeObserver
    }
  })

  it('preserves cached issues on failure and clears the error after retry', async () => {
    let calls = 0
    const dispatcher = {
      refreshIssues: async () => ++calls > 1,
    } as unknown as Dispatcher
    const issuesStore = {
      getAllIssuesFor: async () => [{ number: 1, title: 'Cached issue' }],
    } as unknown as IssuesStore
    const ref = React.createRef<IssueList>()
    render(
      <IssueList
        ref={ref}
        repository={
          {
            gitHubRepository: repository,
            hash: 'repo',
          } as RepositoryWithGitHubRepository
        }
        dispatcher={dispatcher}
        issuesStore={issuesStore}
      />
    )

    await screen.findByRole('button', { name: 'Retry' })
    assert.deepEqual(ref.current?.state.issues, [
      { number: 1, title: 'Cached issue' },
    ])
    assert.equal(screen.queryByText('No open issues.'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.equal(ref.current?.state.failed, false))
    await waitFor(() => assert.equal(ref.current?.state.isLoading, false))
    assert.equal(calls, 2)
  })

  it('finishes loading and offers retry when the cache read fails', async () => {
    const ref = React.createRef<IssueList>()
    render(
      <IssueList
        ref={ref}
        repository={
          {
            gitHubRepository: repository,
            hash: 'repo',
          } as RepositoryWithGitHubRepository
        }
        dispatcher={{} as Dispatcher}
        issuesStore={
          {
            getAllIssuesFor: async () => {
              throw new Error('Database unavailable')
            },
          } as unknown as IssuesStore
        }
      />
    )
    await screen.findByRole('button', { name: 'Retry' })
    assert.equal(ref.current?.state.isLoading, false)
    assert.equal(screen.queryByText('No open issues.'), null)
  })
})
