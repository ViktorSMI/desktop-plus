import * as React from 'react'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { act, cleanup, render } from '@testing-library/react'
import { CommitActionsStatus } from '../../src/ui/history/commit-actions-status'
import { CommitActionsClient } from '../../src/lib/commit-actions-client'
import { ICommitActionsSummary } from '../../src/lib/commit-actions'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'

const account = {
  id: 1, endpoint: 'https://api.github.com', login: 'owner',
  apiType: 'dotcom', token: 'test-only', refreshToken: '',
} as Account
const repository = {
  name: 'repo', type: 'github', endpoint: account.endpoint, login: 'owner',
  owner: { login: 'owner', endpoint: account.endpoint },
} as GitHubRepository
const sha = 'a'.repeat(40)
const passed: ICommitActionsSummary = { state: 'success', count: 1, description: 'Passed' }
const failed: ICommitActionsSummary = { state: 'failure', count: 1, description: 'Failed' }
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred() {
  let resolve!: (value: ICommitActionsSummary) => void
  const promise = new Promise<ICommitActionsSummary>(yes => { resolve = yes })
  return { promise, resolve }
}
function badge(user = account, commit = sha, repo = repository) {
  return <CommitActionsStatus accounts={[user]} gitHubRepository={repo} sha={commit} />
}
const originalObserver = globalThis.IntersectionObserver
const originalResizeObserver = globalThis.ResizeObserver
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
const observers: TestObserver[] = []
class TestObserver implements IntersectionObserver {
  public readonly root = null
  public readonly rootMargin = '0px'
  public readonly thresholds = [0]
  private element: Element | undefined
  public constructor(private readonly callback: IntersectionObserverCallback) { observers.push(this) }
  public observe(element: Element) { this.element = element }
  public unobserve() {}
  public disconnect() {}
  public takeRecords() { return [] }
  public show(visible: boolean) {
    this.callback([{ isIntersecting: visible, target: this.element } as IntersectionObserverEntry], this)
  }
}
function showLast() { observers[observers.length - 1].show(true) }
function hideWindow(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  document.dispatchEvent(new window.Event('visibilitychange'))
}

describe('commit status cache through actual React row lifecycle', () => {
  beforeEach(() => {
    observers.length = 0
    globalThis.IntersectionObserver = TestObserver
    globalThis.ResizeObserver = class implements ResizeObserver {
      public observe() {}
      public unobserve() {}
      public disconnect() {}
    }
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })
  afterEach(() => {
    cleanup()
    // Exercise the real sign-out path to release all retained caches and timers.
    render(<CommitActionsStatus accounts={[]} gitHubRepository={null} sha={sha} />)
    cleanup()
    mock.restoreAll()
    globalThis.IntersectionObserver = originalObserver
    globalThis.ResizeObserver = originalResizeObserver
    if (originalHidden === undefined) { Reflect.deleteProperty(document, 'hidden') }
    else { Object.defineProperty(document, 'hidden', originalHidden) }
  })

  it('renders the remembered circle on remount before any intersection callback', async () => {
    const read = mock.method(CommitActionsClient.prototype, 'forCommit', async () => passed)
    const first = render(badge())
    await act(async () => { showLast(); await flush() })
    assert.ok(first.container.querySelector('.status-success'))
    first.unmount()
    const next = render(badge({ ...account } as Account))
    assert.ok(next.container.querySelector('.status-success'))
    assert.equal(read.mock.callCount(), 1)
    act(showLast)
    assert.equal(read.mock.callCount(), 1)
  })

  it('does not recreate subscriptions, requests or the SVG on 100 layout/profile rerenders', async () => {
    const read = mock.method(CommitActionsClient.prototype, 'forCommit', async () => passed)
    const view = render(badge())
    await act(async () => { showLast(); await flush() })
    const svg = view.container.querySelector('svg')
    for (let i = 0; i < 100; i++) {
      view.rerender(badge({ ...account, name: `Profile ${i}` } as Account, sha, { ...repository } as GitHubRepository))
      assert.equal(view.container.querySelector('svg'), svg)
    }
    assert.equal(observers.length, 1)
    assert.equal(read.mock.callCount(), 1)
  })

  it('does not reload when a resized or scrolled row crosses visibility 100 times', async () => {
    const read = mock.method(CommitActionsClient.prototype, 'forCommit', async () => passed)
    const view = render(badge())
    await act(async () => { showLast(); await flush() })
    for (let i = 0; i < 100; i++) {
      act(() => observers[0].show(false))
      act(() => observers[0].show(true))
      assert.ok(view.container.querySelector('.status-success'))
    }
    assert.equal(read.mock.callCount(), 1)
  })

  it('keeps remembered status when the window is hidden and restored', async () => {
    const read = mock.method(CommitActionsClient.prototype, 'forCommit', async () => passed)
    const view = render(badge())
    await act(async () => { showLast(); await flush() })
    act(() => hideWindow(true))
    act(() => hideWindow(false))
    assert.ok(view.container.querySelector('.status-success'))
    assert.equal(read.mock.callCount(), 1)
  })

  it('shares an unfinished request through a complete row remount', async () => {
    const request = deferred()
    const read = mock.method(CommitActionsClient.prototype, 'forCommit', () => request.promise)
    const first = render(badge())
    act(showLast)
    first.unmount()
    const next = render(badge())
    act(showLast)
    assert.equal(read.mock.callCount(), 1)
    await act(async () => { request.resolve(passed); await flush() })
    assert.ok(next.container.querySelector('.status-success'))
  })

  it('retains the last circle during stale-while-revalidate and then changes its color', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] })
    const request = deferred()
    let calls = 0
    mock.method(CommitActionsClient.prototype, 'forCommit', () => ++calls === 1 ? Promise.resolve(passed) : request.promise)
    const first = render(badge())
    await act(async () => { showLast(); await flush() })
    first.unmount()
    t.mock.timers.tick(120000)
    const next = render(badge())
    assert.ok(next.container.querySelector('.status-success'))
    assert.equal(calls, 1)
    act(showLast)
    assert.equal(calls, 2)
    assert.ok(next.container.querySelector('.status-success'))
    await act(async () => { request.resolve(failed); await flush() })
    assert.ok(next.container.querySelector('.status-failure'))
  })

  it('does not reuse the old circle for a different SHA or repository', async () => {
    const request = deferred()
    let calls = 0
    mock.method(CommitActionsClient.prototype, 'forCommit', () => ++calls === 1 ? Promise.resolve(passed) : request.promise)
    const view = render(badge())
    await act(async () => { showLast(); await flush() })
    view.rerender(badge(account, 'b'.repeat(40)))
    assert.equal(view.container.querySelector('svg'), null)
    view.rerender(badge(account, sha, { ...repository, name: 'other' } as GitHubRepository))
    assert.equal(view.container.querySelector('svg'), null)
    view.rerender(badge())
    assert.ok(view.container.querySelector('.status-success'))
    assert.equal(calls, 1)
    request.resolve(failed)
  })

  it('does not reuse a cached green circle after credential replacement', async () => {
    const request = deferred()
    let calls = 0
    mock.method(CommitActionsClient.prototype, 'forCommit', () => ++calls === 1 ? Promise.resolve(passed) : request.promise)
    const view = render(badge())
    await act(async () => { showLast(); await flush() })
    view.rerender(badge({ ...account, token: 'replacement' } as Account))
    assert.equal(view.container.querySelector('svg'), null)
    act(showLast)
    assert.equal(calls, 2)
    await act(async () => { request.resolve(failed); await flush() })
    assert.ok(view.container.querySelector('.status-failure'))
  })

  it('clears remembered status on sign-out', async () => {
    const read = mock.method(CommitActionsClient.prototype, 'forCommit', async () => passed)
    const view = render(badge())
    await act(async () => { showLast(); await flush() })
    view.rerender(<CommitActionsStatus accounts={[]} gitHubRepository={repository} sha={sha} />)
    assert.equal(view.container.querySelector('svg'), null)
    view.rerender(badge())
    assert.equal(view.container.querySelector('svg'), null)
    await act(async () => { showLast(); await flush() })
    assert.equal(read.mock.callCount(), 2)
  })
})
