import * as React from 'react'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { act } from 'react-dom/test-utils'
import { cleanup, fireEvent, render } from '../helpers/ui/render'
import { DialogStackContext } from '../../src/ui/dialog'
import {
  CommitActionsDialog,
  ICommitActionsReader,
} from '../../src/ui/actions/commit-actions-dialog'
import { ICommitActionsRun } from '../../src/lib/commit-actions'
import { IActionsRun, IActionsTarget } from '../../src/models/actions'

const sha = 'a'.repeat(40)
const target: IActionsTarget = {
  provider: 'github',
  endpoint: 'https://api.github.com',
  owner: 'owner',
  name: 'repo',
  login: 'me',
}
const choice = (id = 42): ICommitActionsRun => ({
  id,
  name: `Workflow ${id}`,
  number: id + 100,
  workflow: `id:${id}`,
  attempt: 1,
  event: 'push',
  branch: 'main',
  status: 'completed',
  conclusion: 'success',
})
const details = (id: number, head = sha): IActionsRun => ({
  id,
  name: `Workflow ${id}`,
  run_number: id + 100,
  display_title: `Build ${id}`,
  run_attempt: 1,
  head_sha: head,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  created_at: null,
  updated_at: null,
  actor: null,
})
const noop = () => {}
function reader(
  extra: Partial<ICommitActionsReader> = {}
): ICommitActionsReader {
  return {
    fetchCommitActionsRuns: async () => [choice()],
    fetchActionsRuns: async () =>
      assert.fail('Must not load all repository runs'),
    fetchActionsRun: async (_target, id) => details(id),
    fetchActionsJobs: async () => ({ total_count: 0, jobs: [] }),
    openInBrowser: noop,
    ...extra,
  }
}
function element(
  api: ICommitActionsReader,
  t = target,
  head = sha,
  onDismissed = noop
) {
  return (
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <CommitActionsDialog
        reader={api}
        target={t}
        sha={head}
        onDismissed={onDismissed}
      />
    </DialogStackContext.Provider>
  )
}
async function flush() {
  await new Promise<void>(resolve => setImmediate(resolve))
  act(() => {})
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => {
    resolve = yes
  })
  return { promise, resolve }
}

describe('commit Actions navigation dialog', () => {
  let restore: () => void
  beforeEach(async () => {
    const { ipcRenderer } = await import('electron')
    const oldSend = ipcRenderer.send
    const proto = HTMLDialogElement.prototype
    const oldShow = Object.getOwnPropertyDescriptor(proto, 'showModal')
    const oldClose = Object.getOwnPropertyDescriptor(proto, 'close')
    ipcRenderer.send = noop
    proto.showModal = function () {
      this.open = true
    }
    proto.close = function () {
      this.open = false
    }
    restore = () => {
      ipcRenderer.send = oldSend
      for (const [name, old] of [
        ['showModal', oldShow],
        ['close', oldClose],
      ] as const) {
        if (old === undefined) {
          Reflect.deleteProperty(proto, name)
        } else {
          Object.defineProperty(proto, name, old)
        }
      }
    }
  })
  afterEach(() => {
    cleanup()
    restore()
  })

  for (const provider of ['github', 'gitea'] as const) {
    it(`opens the only ${provider} run directly and uses the correct browser route`, async () => {
      const t = {
        ...target,
        provider,
        endpoint:
          provider === 'github'
            ? target.endpoint
            : 'https://gitea.test/prefix/api/v1',
      }
      const urls: string[] = []
      const ids: number[] = []
      const api = reader({
        fetchCommitActionsRuns: async (selected, head) => {
          assert.deepEqual(selected, t)
          assert.equal(head, sha)
          return [choice()]
        },
        fetchActionsRun: async (selected, id) => {
          assert.deepEqual(selected, t)
          ids.push(id)
          return details(id)
        },
        openInBrowser: url => {
          urls.push(url)
        },
      })
      const view = render(element(api, t))
      await view.findByText('Build 42')
      assert.deepEqual(ids, [42], 'REST navigation uses id, not run_number')
      fireEvent.click(view.getByRole('button', { name: 'Open run in browser' }))
      assert.deepEqual(urls, [
        provider === 'github'
          ? 'https://github.com/owner/repo/actions/runs/42'
          : 'https://gitea.test/prefix/owner/repo/actions/runs/142',
      ])
      fireEvent.click(view.getByRole('button', { name: 'Back to commit runs' }))
      assert.ok(view.getByRole('button', { name: /Workflow 42/ }))
    })
  }
  it('offers all workflows instead of choosing a possibly unrelated successful one', async () => {
    const ids: number[] = []
    let lookups = 0
    const view = render(
      element(
        reader({
          fetchCommitActionsRuns: async () => {
            lookups++
            return [choice(1), { ...choice(2), conclusion: 'failure' }]
          },
          fetchActionsRun: async (_target, id) => {
            ids.push(id)
            return details(id)
          },
        })
      )
    )
    await view.findByRole('button', { name: /Workflow 2/ })
    assert.deepEqual(ids, [])
    fireEvent.click(view.getByRole('button', { name: /Workflow 2/ }))
    await view.findByText('Build 2')
    assert.deepEqual(ids, [2])
    fireEvent.click(view.getByRole('button', { name: 'Back to commit runs' }))
    fireEvent.click(view.getByRole('button', { name: /Workflow 1/ }))
    await view.findByText('Build 1')
    assert.deepEqual(ids, [2, 1])
    assert.equal(lookups, 1, 'Back navigation reuses the opened chooser')
  })
  it('has explicit empty and retry states and never falls back to the latest repository run', async () => {
    let lookups = 0
    const view = render(
      element(
        reader({
          fetchCommitActionsRuns: async () => {
            if (++lookups === 1) {
              throw new Error('offline')
            }
            return []
          },
          fetchActionsRun: async () => assert.fail('No matching runs'),
        })
      )
    )
    await view.findByRole('alert')
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }))
    await view.findByText(/No Actions runs for this commit/)
    assert.equal(lookups, 2)
  })
  for (const wrong of [{ head_sha: 'b'.repeat(40) }, { id: 99 }]) {
    it(`rejects run details outside the selected commit/id: ${JSON.stringify(
      wrong
    )}`, async () => {
      let jobs = 0,
        opened = 0
      const view = render(
        element(
          reader({
            fetchActionsRun: async () => ({ ...details(42), ...wrong }),
            fetchActionsJobs: async () => {
              jobs++
              return { total_count: 0, jobs: [] }
            },
            openInBrowser: () => {
              opened++
            },
          })
        )
      )
      await view.findByRole('alert')
      assert.equal(view.queryByText('Build 42'), null)
      assert.equal(jobs, 0)
      const button = view.getByRole('button', { name: 'Open run in browser' })
      assert.equal(button.getAttribute('aria-disabled'), 'true')
      fireEvent.click(button)
      assert.equal(opened, 0)
    })
  }
  it('ignores a late list response after changing the commit and repository', async () => {
    const old = deferred<ReadonlyArray<ICommitActionsRun>>()
    const api = reader({
      fetchCommitActionsRuns: async t => (t.name === 'repo' ? old.promise : []),
    })
    const view = render(element(api))
    view.rerender(element(api, { ...target, name: 'other' }, 'b'.repeat(40)))
    await view.findByText(/No Actions runs for this commit/)
    old.resolve([choice()])
    await flush()
    assert.equal(view.queryByText('Build 42'), null)
    assert.ok(view.getByText(/owner\/other/))
  })
  it('does not reopen a popup after dismissal while the lookup is in flight', async () => {
    const request = deferred<ReadonlyArray<ICommitActionsRun>>()
    let detailsCalls = 0
    const view = render(
      element(
        reader({
          fetchCommitActionsRuns: () => request.promise,
          fetchActionsRun: async () => {
            detailsCalls++
            return details(42)
          },
        })
      )
    )
    view.unmount()
    request.resolve([choice()])
    await flush()
    assert.equal(detailsCalls, 0)
  })
  it('escapes workflow names instead of interpreting them as markup', async () => {
    const view = render(
      element(
        reader({
          fetchCommitActionsRuns: async () => [
            { ...choice(1), name: '<img src=x onerror=alert(1)>' },
            choice(2),
          ],
        })
      )
    )
    await view.findByRole('button', { name: /<img src=x onerror=alert\(1\)>/ })
    assert.equal(view.container.querySelector('img'), null)
  })
})
