import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as React from 'react'
import { ForcePushBranchState } from '../../../src/lib/rebase'
import { FetchType } from '../../../src/models/fetch'
import { Repository } from '../../../src/models/repository'
import { TipState } from '../../../src/models/tip'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { PushPullButton } from '../../../src/ui/toolbar/push-pull-button'
import { fireEvent, render } from '../../helpers/ui/render'

type Props = React.ComponentProps<typeof PushPullButton>

function fixture(overrides: Partial<Props> = {}) {
  const calls: { action: string; args: unknown[] }[] = []
  const record =
    (action: string) =>
    (...args: unknown[]) => {
      calls.push({ action, args })
      return Promise.resolve()
    }
  const forbidden = () =>
    assert.fail('The ordinary toolbar must never force push')
  const props: Props = {
    repository: new Repository('/test/toolbar-safety', -1, null, false),
    dispatcher: {
      push: record('push'),
      pull: record('pull'),
      fetch: record('fetch'),
      syncRemotes: record('sync'),
      closeFoldout: () => Promise.resolve(),
      confirmOrForcePush: forbidden,
      performForcePush: forbidden,
      confirmForcePushToRemote: forbidden,
      forcePushToRemote: forbidden,
    } as unknown as Dispatcher,
    aheadBehind: { ahead: 1, behind: 0 },
    remoteName: 'origin',
    networkActionInProgress: false,
    syncRemotes: false,
    lastFetched: null,
    progress: null,
    tipState: TipState.Valid,
    rebaseInProgress: false,
    forcePushBranchState: ForcePushBranchState.NotAvailable,
    shouldNudge: false,
    numTagsToPush: 0,
    isDropdownOpen: false,
    enableFocusTrap: false,
    pushPullButtonWidth: { value: 250, min: 200, max: 350 },
    onDropdownStateChanged: () => {},
    ...overrides,
  }
  const view = render(<PushPullButton {...props} />)
  const mainButton = () => {
    const button = view.container.querySelector<HTMLButtonElement>(
      '.toolbar-button.push-pull-button > button'
    )
    assert.ok(button, 'The primary toolbar button must be present')
    return button
  }
  return { props, view, calls, mainButton }
}

describe('ordinary push/pull/fetch toolbar safety', () => {
  const cases: {
    name: string
    overrides: Partial<Props>
    title: string
    action: string
  }[] = [
    { name: 'ahead', overrides: {}, title: 'Push origin', action: 'push' },
    {
      name: 'behind',
      overrides: { aheadBehind: { ahead: 0, behind: 2 } },
      title: 'Pull origin',
      action: 'pull',
    },
    {
      name: 'up to date',
      overrides: { aheadBehind: { ahead: 0, behind: 0 } },
      title: 'Fetch origin',
      action: 'fetch',
    },
    {
      name: 'new tags',
      overrides: { aheadBehind: { ahead: 0, behind: 0 }, numTagsToPush: 2 },
      title: 'Push origin',
      action: 'push',
    },
    {
      name: 'unpublished branch',
      overrides: { aheadBehind: null },
      title: 'Publish branch',
      action: 'push',
    },
    {
      name: 'no remote',
      overrides: { remoteName: null },
      title: 'Publish repository',
      action: 'push',
    },
    {
      name: 'unborn branch',
      overrides: { tipState: TipState.Unborn },
      title: 'Fetch origin',
      action: 'fetch',
    },
    {
      name: 'diverged without local rewrite',
      overrides: {
        aheadBehind: { ahead: 2, behind: 1 },
        forcePushBranchState: ForcePushBranchState.Available,
      },
      title: 'Pull origin',
      action: 'pull',
    },
    {
      name: 'explicit pull with rebase',
      overrides: {
        aheadBehind: { ahead: 2, behind: 1 },
        pullWithRebase: true,
        forcePushBranchState: ForcePushBranchState.Available,
      },
      title: 'Pull origin with rebase',
      action: 'pull',
    },
    {
      name: 'amended or rebased published history',
      overrides: {
        aheadBehind: { ahead: 2, behind: 1 },
        forcePushBranchState: ForcePushBranchState.Recommended,
      },
      title: 'Pull origin',
      action: 'pull',
    },
    {
      name: 'rewritten history and pending tags',
      overrides: {
        aheadBehind: { ahead: 2, behind: 1 },
        numTagsToPush: 3,
        forcePushBranchState: ForcePushBranchState.Recommended,
      },
      title: 'Pull origin',
      action: 'pull',
    },
    {
      name: 'rewritten history with configured rebase',
      overrides: {
        aheadBehind: { ahead: 2, behind: 1 },
        pullWithRebase: true,
        forcePushBranchState: ForcePushBranchState.Recommended,
      },
      title: 'Pull origin with rebase',
      action: 'pull',
    },
    {
      name: 'reconciled history with a stale rewrite hint',
      overrides: { forcePushBranchState: ForcePushBranchState.Recommended },
      title: 'Push origin',
      action: 'push',
    },
    {
      name: 'two remote synchronization',
      overrides: {
        syncRemotes: true,
        aheadBehind: { ahead: 2, behind: 1 },
        forcePushBranchState: ForcePushBranchState.Recommended,
      },
      title: 'Sync remotes',
      action: 'sync',
    },
  ]
  for (const { name, overrides, title, action } of cases) {
    it(`never force pushes with ${name}`, () => {
      const { props, calls, mainButton, view } = fixture(overrides)
      assert.equal(mainButton().querySelector('.title')?.textContent, title)
      assert.equal(view.container.querySelector('.destructive'), null)
      fireEvent.click(mainButton())
      assert.deepEqual(calls, [
        {
          action,
          args:
            action === 'fetch'
              ? [props.repository, FetchType.UserInitiatedTask]
              : [props.repository],
        },
      ])
    })
  }

  it('reconciles rewritten history through Pull then ordinary Push instead of getting stuck on Fetch', () => {
    const { props, calls, mainButton, view } = fixture()
    fireEvent.click(mainButton())
    const rewritten: Props = {
      ...props,
      aheadBehind: { ahead: 2, behind: 1 },
      forcePushBranchState: ForcePushBranchState.Recommended,
    }
    for (let i = 0; i < 25; i++) {
      view.rerender(<PushPullButton {...rewritten} lastFetched={new Date(i)} />)
      assert.equal(
        mainButton().querySelector('.title')?.textContent,
        'Pull origin'
      )
      assert.doesNotMatch(
        mainButton().textContent ?? '',
        /History rewritten|force push/i
      )
      fireEvent.click(mainButton())
    }
    view.rerender(
      <PushPullButton {...rewritten} aheadBehind={{ ahead: 3, behind: 0 }} />
    )
    assert.equal(
      mainButton().querySelector('.title')?.textContent,
      'Push origin'
    )
    fireEvent.click(mainButton())
    view.rerender(
      <PushPullButton {...rewritten} aheadBehind={{ ahead: 0, behind: 0 }} />
    )
    assert.equal(
      mainButton().querySelector('.title')?.textContent,
      'Fetch origin'
    )
    fireEvent.click(mainButton())
    assert.deepEqual(
      calls.map(c => c.action),
      ['push', ...Array(25).fill('pull'), 'push', 'fetch']
    )
  })

  for (const forcePushBranchState of [
    ForcePushBranchState.Available,
    ForcePushBranchState.Recommended,
  ]) {
    it(`contains no force-push option even with an open dropdown in state ${forcePushBranchState}`, () => {
      const { view } = fixture({
        isDropdownOpen: true,
        aheadBehind: { ahead: 2, behind: 1 },
        forcePushBranchState,
      })
      for (const button of view.container.querySelectorAll('button')) {
        assert.doesNotMatch(button.textContent ?? '', /force push/i)
      }
    })
  }

  it('keeps the ordinary dropdown Fetch action non-destructive', () => {
    const { props, calls, view } = fixture({
      isDropdownOpen: true,
      aheadBehind: { ahead: 2, behind: 1 },
      forcePushBranchState: ForcePushBranchState.Available,
    })
    const buttons = view.container.querySelectorAll<HTMLButtonElement>(
      '.push-pull-dropdown-item'
    )
    assert.deepEqual(
      Array.from(buttons, b => b.querySelector('.title')?.textContent),
      ['Fetch origin', 'Reset and pull']
    )
    fireEvent.click(buttons[0])
    assert.deepEqual(calls, [
      {
        action: 'fetch',
        args: [props.repository, FetchType.UserInitiatedTask],
      },
    ])
  })

  it('keeps detached HEAD disabled and never offers force push', () => {
    const { calls, mainButton } = fixture({
      tipState: TipState.Detached,
      forcePushBranchState: ForcePushBranchState.Recommended,
    })
    assert.equal(mainButton().getAttribute('aria-disabled'), 'true')
    fireEvent.click(mainButton())
    assert.deepEqual(calls, [])
  })

  it('shows existing operation progress as disabled, then resumes normal Pull', () => {
    const { props, calls, mainButton, view } = fixture({
      aheadBehind: { ahead: 2, behind: 1 },
      forcePushBranchState: ForcePushBranchState.Recommended,
      networkActionInProgress: true,
      progress: {
        kind: 'fetch',
        remote: 'origin',
        title: 'Fetching origin',
        value: 0.5,
      },
    })
    assert.equal(mainButton().getAttribute('aria-disabled'), 'true')
    fireEvent.click(mainButton())
    assert.deepEqual(calls, [])
    view.rerender(
      <PushPullButton
        {...props}
        progress={null}
        networkActionInProgress={false}
      />
    )
    fireEvent.click(mainButton())
    assert.deepEqual(calls, [
      {
        action: 'pull',
        args: [props.repository],
      },
    ])
  })
})
