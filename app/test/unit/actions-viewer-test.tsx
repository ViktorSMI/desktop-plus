import * as React from 'react'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { cleanup, fireEvent, render, waitFor } from '../helpers/ui/render'
import { act } from 'react-dom/test-utils'
import { setImmediate } from 'node:timers'
import { DialogStackContext } from '../../src/ui/dialog'
import { ActionsRuns } from '../../src/ui/actions/actions-runs'
import { ActionsRunDialog } from '../../src/ui/actions/actions-run-dialog'
import {
  useActionsData,
  ActionsPollInterval,
} from '../../src/ui/actions/use-actions-data'
import {
  IActionsReader,
  IActionsRun,
  IActionsRunsPage,
  IActionsTarget,
} from '../../src/models/actions'

const target: IActionsTarget = {
  provider: 'github',
  endpoint: 'https://api.github.com',
  owner: 'ViktorSMI',
  name: 'desktop-plus',
  login: 'ViktorSMI',
}
const run: IActionsRun = {
  id: 123,
  name: 'CI',
  display_title: 'Build <script>safe text</script>',
  run_number: 8,
  run_attempt: 2,
  head_branch: 'main',
  head_sha: '1234567890abcdef',
  event: 'push',
  status: 'completed',
  conclusion: 'failure',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:02:00Z',
  actor: { login: 'tester' },
}
function reader(overrides: Partial<IActionsReader> = {}): IActionsReader {
  return {
    fetchActionsRuns: async () => ({ total_count: 1, workflow_runs: [run] }),
    fetchActionsRun: async () => run,
    fetchActionsJobs: async () => ({
      total_count: 1,
      jobs: [
        {
          id: 321,
          name: 'Build Linux',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2026-01-01T00:00:00Z',
          completed_at: '2026-01-01T00:02:00Z',
          steps: [
            {
              number: 1,
              name: 'Compile',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2026-01-01T00:00:00Z',
              completed_at: '2026-01-01T00:02:00Z',
            },
          ],
        },
      ],
    }),
    openInBrowser: () => {},
    ...overrides,
  }
}
// React 16.8 has synchronous act only. Drain promises with the real Node
// scheduler, including while setTimeout is controlled by a test clock.
async function flushReact() {
  await new Promise<void>(resolve => setImmediate(resolve))
  act(() => {})
  await new Promise<void>(resolve => setImmediate(resolve))
}

const noop = () => {}
const keepPolling = () => true
function Probe({
  name,
  load,
}: {
  readonly name: string
  readonly load: () => Promise<string>
}) {
  const state = useActionsData(name, load, keepPolling)
  return (
    <div>
      <span data-testid="value">{state.data}</span>
      <button onClick={state.refresh}>Refresh probe</button>
      {state.error !== null && <p role="alert">{state.error}</p>}
    </div>
  )
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('GitHub and Gitea Actions viewer', () => {
  let restoreBridges: (() => void) | undefined
  beforeEach(async () => {
    const electron = await import('electron')
    const send = electron.ipcRenderer.send
    const prototype = HTMLDialogElement.prototype
    const showModal = Object.getOwnPropertyDescriptor(prototype, 'showModal')
    const close = Object.getOwnPropertyDescriptor(prototype, 'close')
    electron.ipcRenderer.send = () => {}
    prototype.showModal = function () {
      this.open = true
    }
    prototype.close = function () {
      this.open = false
    }
    restoreBridges = () => {
      electron.ipcRenderer.send = send
      for (const [name, descriptor] of [
        ['showModal', showModal],
        ['close', close],
      ] as const) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(prototype, name)
        } else {
          Object.defineProperty(prototype, name, descriptor)
        }
      }
    }
  })
  afterEach(() => {
    try {
      cleanup()
    } finally {
      restoreBridges?.()
      restoreBridges = undefined
    }
  })

  it('renders push runs, branch, commit and failure without interpreting workflow text as HTML', async () => {
    let selected: IActionsRun | null = null
    const view = render(
      <ActionsRuns
        target={target}
        reader={reader()}
        onSelect={value => {
          selected = value
        }}
      />
    )
    await view.findByText('CI #8')
    assert.ok(view.getByText(/main · push · 1234567/))
    assert.ok(view.getByText('failure'))
    assert.equal(view.container.querySelectorAll('script').length, 0)
    fireEvent.click(view.getByRole('button', { name: /CI #8/ }))
    assert.deepEqual(selected, run)
  })
  it('paginates and sends server-side status filters, resetting to page one', async () => {
    const calls: { page: number; status: string }[] = []
    const api = reader({
      fetchActionsRuns: async (_target, page, status) => {
        calls.push({ page, status })
        return {
          total_count: 50,
          workflow_runs: [{ ...run, id: page, name: `Page ${page}` }],
        }
      },
    })
    const view = render(
      <ActionsRuns target={target} reader={api} onSelect={noop} />
    )
    await view.findByText('Page 1 #8')
    fireEvent.click(view.getByRole('button', { name: 'Next page' }))
    await view.findByText('Page 2 #8')
    fireEvent.change(view.getByLabelText('Run status'), {
      target: { value: 'failure' },
    })
    await waitFor(() =>
      assert.deepEqual(calls[calls.length - 1], { page: 1, status: 'failure' })
    )
  })
  it('shows jobs, steps, attempt and links to job logs in a read-only dialog', async () => {
    const urls: string[] = []
    const attempts: (number | null)[] = []
    const api = reader({
      openInBrowser: url => {
        urls.push(url)
      },
      fetchActionsJobs: async (selected, id, attempt, page) => {
        attempts.push(attempt)
        return reader().fetchActionsJobs(selected, id, attempt, page)
      },
    })
    const view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ActionsRunDialog
          target={target}
          runId={123}
          reader={api}
          onDismissed={noop}
          onBack={noop}
        />
      </DialogStackContext.Provider>
    )
    await view.findByText('Build Linux')
    assert.ok(view.getByText('1. Compile'))
    assert.ok(view.getByText(/Attempt 2/))
    assert.deepEqual(attempts, [2])
    fireEvent.click(
      view.getByRole('button', { name: 'Open job logs in browser' })
    )
    assert.equal(
      urls[0],
      'https://github.com/ViktorSMI/desktop-plus/actions/runs/123/job/321'
    )
    assert.equal(
      view.queryByRole('button', { name: /re-run|cancel run/i }),
      null
    )
  })
  it('shows Gitea limitations honestly and opens repository run numbers, not database ids', async () => {
    const urls: string[] = []
    const gitea: IActionsTarget = {
      ...target,
      provider: 'gitea',
      endpoint: 'https://gitea.test/prefix/api/v1',
    }
    const giteaRun: IActionsRun = {
      ...run,
      run_attempt: null,
      created_at: null,
      updated_at: null,
      started_at: null,
    }
    const view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ActionsRunDialog
          target={gitea}
          runId={123}
          reader={reader({
            fetchActionsRun: async () => giteaRun,
            openInBrowser: url => {
              urls.push(url)
            },
          })}
          onDismissed={noop}
          onBack={noop}
        />
      </DialogStackContext.Provider>
    )
    await view.findByText('Build Linux')
    assert.ok(view.getByText(/server does not report run attempts/))
    assert.equal(view.queryByText(/Attempt 1/), null)
    assert.equal(view.container.querySelector('time'), null)
    assert.ok(view.getByText('Read only · Logs open on Gitea'))
    fireEvent.click(view.getByRole('button', { name: 'Open run in browser' }))
    fireEvent.click(
      view.getByRole('button', { name: 'Open job logs in browser' })
    )
    assert.deepEqual(urls, [
      'https://gitea.test/prefix/ViktorSMI/desktop-plus/actions/runs/8',
      'https://gitea.test/prefix/ViktorSMI/desktop-plus/actions/runs/8',
    ])
  })
  it('uses provider pagination metadata instead of assuming GitHub page sizes', async () => {
    const pages: number[] = []
    const api = reader({
      fetchActionsJobs: async (selected, id, attempt, page) => {
        pages.push(page)
        const data = await reader().fetchActionsJobs(
          selected,
          id,
          attempt,
          page
        )
        return { ...data, total_count: 51, hasNextPage: page === 1 }
      },
    })
    const view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <ActionsRunDialog
          target={{ ...target, provider: 'gitea' }}
          runId={123}
          reader={api}
          onDismissed={noop}
          onBack={noop}
        />
      </DialogStackContext.Provider>
    )
    await view.findByText('Build Linux')
    fireEvent.click(view.getByRole('button', { name: 'Next jobs' }))
    await waitFor(() => assert.deepEqual(pages, [1, 2]))
    await flushReact()
    assert.equal(
      view
        .getByRole('button', { name: 'Next jobs' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })
  it('ignores a previous target response even when it finishes last', async () => {
    const old = deferred<string>()
    const first = () => old.promise
    const second = async () => 'new account'
    const view = render(<Probe name="old" load={first} />)
    view.rerender(<Probe name="new" load={second} />)
    await view.findByText('new account')
    old.resolve('old private data')
    await flushReact()
    assert.equal(view.queryByText('old private data'), null)
  })
  it('shows an access/network failure and succeeds on manual retry', async () => {
    let fail = true
    const api = reader({
      fetchActionsRuns: async () => {
        if (fail) {
          throw new Error('network')
        }
        return { total_count: 1, workflow_runs: [run] }
      },
    })
    const view = render(
      <ActionsRuns target={target} reader={api} onSelect={noop} />
    )
    await view.findByRole('alert')
    assert.ok(view.getByText('Auto-refresh paused.'))
    assert.equal(view.queryByText('No workflow runs match this view.'), null)
    fail = false
    fireEvent.click(view.getByRole('button', { name: 'Refresh Actions' }))
    await view.findByText('CI #8')
    assert.equal(view.queryByRole('alert'), null)
  })
  it('does not overlap refresh requests', async () => {
    const pending = deferred<IActionsRunsPage>()
    let calls = 0
    const api = reader({
      fetchActionsRuns: () => {
        calls++
        return pending.promise
      },
    })
    const view = render(
      <ActionsRuns target={target} reader={api} onSelect={noop} />
    )
    fireEvent.click(view.getByRole('button', { name: 'Refresh Actions' }))
    fireEvent.click(view.getByRole('button', { name: 'Refresh Actions' }))
    assert.equal(calls, 1)
    pending.resolve({ total_count: 1, workflow_runs: [run] })
    await flushReact()
  })
  it('polls only while mounted, stops on errors, and requires explicit retry', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] })
    let calls = 0
    let fail = false
    const load = async () => {
      calls++
      if (fail) {
        throw new Error('limited')
      }
      return String(calls)
    }
    const view = render(<Probe name="poll" load={load} />)
    await flushReact()
    assert.equal(calls, 1)
    act(() => {
      context.mock.timers.tick(ActionsPollInterval)
    })
    await flushReact()
    assert.equal(calls, 2)
    fail = true
    act(() => {
      context.mock.timers.tick(ActionsPollInterval)
    })
    await flushReact()
    assert.equal(calls, 3)
    act(() => {
      context.mock.timers.tick(ActionsPollInterval * 10)
    })
    await flushReact()
    assert.equal(calls, 3)
    fail = false
    fireEvent.click(view.getByText('Refresh probe'))
    await flushReact()
    assert.equal(calls, 4)
    view.unmount()
    act(() => {
      context.mock.timers.tick(ActionsPollInterval * 10)
    })
    await flushReact()
    assert.equal(calls, 4)
  })
  it('suppresses polling while the document is hidden and resumes on visibility', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] })
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
    let hidden = true
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    try {
      let calls = 0
      const load = async () => {
        calls++
        return 'visible'
      }
      const view = render(<Probe name="visible" load={load} />)
      act(() => {
        context.mock.timers.tick(ActionsPollInterval)
      })
      await flushReact()
      assert.equal(calls, 0)
      hidden = false
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await flushReact()
      assert.equal(calls, 1)
      hidden = true
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await flushReact()
      act(() => {
        context.mock.timers.tick(ActionsPollInterval * 10)
      })
      await flushReact()
      assert.equal(calls, 1)
      view.unmount()
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(document, 'hidden', descriptor)
      } else {
        Reflect.deleteProperty(document, 'hidden')
      }
    }
  })
  it('ignores a late response after unmount and creates no follow-up timer', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] })
    const pending = deferred<string>()
    let calls = 0
    const load = () => {
      calls++
      return pending.promise
    }
    const view = render(<Probe name="late" load={load} />)
    view.unmount()
    pending.resolve('late')
    await flushReact()
    act(() => {
      context.mock.timers.tick(ActionsPollInterval * 10)
    })
    await flushReact()
    assert.equal(calls, 1)
  })
})
