import * as React from 'react'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { act, cleanup, render } from '@testing-library/react'
import {
  CommitActionsStatusBadge,
  ObservedCommitActionsStatus,
  CommitActionsSubscribe,
} from '../../src/ui/history/commit-actions-status'
import { ICommitActionsSummary } from '../../src/lib/commit-actions'

const originalObserver = globalThis.IntersectionObserver
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
const observers: TestObserver[] = []
class TestObserver implements IntersectionObserver {
  public readonly root = null
  public readonly rootMargin = '0px'
  public readonly thresholds = [0]
  private element: Element | undefined
  public disconnected = false
  public constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this)
  }
  public observe(element: Element) {this.element = element}
  public unobserve() {}
  public disconnect() {this.disconnected = true}
  public takeRecords() {return []}
  public show(visible: boolean) {
    this.callback([{isIntersecting: visible, target: this.element} as IntersectionObserverEntry], this)
  }
}
const summary = (state: ICommitActionsSummary['state']): ICommitActionsSummary => ({
  state, count: state === 'none' ? 0 : 1, description: `Actions ${state}`,
})

describe('commit Actions indicators', () => {
  beforeEach(() => {
    observers.length = 0
    globalThis.IntersectionObserver = TestObserver
    Object.defineProperty(document, 'hidden', {configurable: true, value: false})
  })
  afterEach(() => {
    cleanup()
    globalThis.IntersectionObserver = originalObserver
    if (originalHidden === undefined) {
      Reflect.deleteProperty(document, 'hidden')
    } else {
      Object.defineProperty(document, 'hidden', originalHidden)
    }
  })
  for (const [state, color] of [['failure', '#d1242f'], ['pending', '#d97706'], ['success', '#1a7f37']] as const) {
    it(`renders a ${state} circle and an accessible label`, () => {
      const {container, getByRole} = render(<CommitActionsStatusBadge value={summary(state)} repositoryName="owner/repo" />)
      assert.equal(container.querySelector('circle')?.getAttribute('fill'), color)
      assert.ok(getByRole('img', {name: `owner/repo: Actions ${state}`}))
      assert.ok(container.querySelector('path'))
    })
  }
  it('renders no success icon for a commit without runs', () => {
    const {container} = render(<CommitActionsStatusBadge value={summary('none')} repositoryName="owner/repo" />)
    assert.equal(container.querySelector('svg'), null)
  })
  it('keeps unknown results distinct from running and successful checks', () => {
    const {container} = render(<CommitActionsStatusBadge value={summary('unknown')} repositoryName="owner/repo" />)
    assert.equal(container.querySelector('circle')?.getAttribute('fill'), '#6e7781')
  })
  it('subscribes only while intersecting and disconnects on unmount', () => {
    let subscriptions = 0, removals = 0
    const subscribe: CommitActionsSubscribe = listener => {
      subscriptions++; listener(summary('pending'))
      return () => {removals++}
    }
    const view = render(<ObservedCommitActionsStatus subscribe={subscribe} repositoryName="owner/repo" />)
    assert.equal(subscriptions, 0)
    act(() => observers[0].show(true))
    assert.equal(subscriptions, 1)
    act(() => observers[0].show(false))
    assert.equal(removals, 1)
    act(() => observers[0].show(true))
    assert.equal(subscriptions, 2)
    view.unmount()
    assert.equal(removals, 2)
    assert.equal(observers[0].disconnected, true)
  })
  it('stops while the window is hidden and refreshes on return', () => {
    let subscriptions = 0, removals = 0
    const subscribe: CommitActionsSubscribe = listener => {
      subscriptions++; listener(summary('success'))
      return () => {removals++}
    }
    render(<ObservedCommitActionsStatus subscribe={subscribe} repositoryName="owner/repo" />)
    act(() => observers[0].show(true))
    act(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true})
      document.dispatchEvent(new Event('visibilitychange'))
    })
    assert.equal(removals, 1)
    act(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: false})
      document.dispatchEvent(new Event('visibilitychange'))
    })
    assert.equal(subscriptions, 2)
  })
  it('does not flash or apply a previous commit result after row recycling', () => {
    let late: ((value: ICommitActionsSummary) => void) | undefined
    const first: CommitActionsSubscribe = listener => {
      late = listener; listener(summary('success')); return () => {}
    }
    const second: CommitActionsSubscribe = listener => {listener(undefined); return () => {}}
    const {container, rerender} = render(<ObservedCommitActionsStatus subscribe={first} repositoryName="old/repo" />)
    act(() => observers[0].show(true))
    assert.ok(container.querySelector('.status-success'))
    rerender(<ObservedCommitActionsStatus subscribe={second} repositoryName="new/repo" />)
    act(() => observers[1].show(true))
    assert.equal(container.querySelector('svg'), null)
    act(() => late?.(summary('failure')))
    assert.equal(container.querySelector('svg'), null)
  })
})
