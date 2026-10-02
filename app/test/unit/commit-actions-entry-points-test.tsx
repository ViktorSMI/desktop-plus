import * as React from 'react'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { cleanup, fireEvent, render } from '../helpers/ui/render'
import { CommitList } from '../../src/ui/history/commit-list'
import { CommitActionsStatus } from '../../src/ui/history/commit-actions-status'
import { CommitActionsClient } from '../../src/lib/commit-actions-client'
import { ISerializableMenuItem } from '../../src/lib/menu-item'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Commit } from '../../src/models/commit'
import { CommitIdentity } from '../../src/models/commit-identity'
import { Repository } from '../../src/models/repository'
import { Popup, PopupType } from '../../src/models/popup'
import { Dispatcher } from '../../src/ui/dispatcher'

const sha = 'a'.repeat(40)
const otherSHA = 'b'.repeat(40)
const identity = new CommitIdentity('Tester', 'tester@example.test', new Date())
const commit = (head: string) =>
  new Commit(
    head,
    head.slice(0, 7),
    'Test commit',
    '',
    identity,
    identity,
    [],
    [],
    []
  )
const account = {
  id: 1,
  apiType: 'gitea',
  endpoint: 'https://gitea.test/prefix/api/v1',
  login: 'me',
  token: 'test-only',
  refreshToken: '',
} as Account
const hosted = {
  type: 'gitea',
  name: 'repo',
  endpoint: account.endpoint,
  owner: { login: 'team', endpoint: account.endpoint },
  login: 'me',
} as GitHubRepository
const target = {
  provider: 'gitea',
  endpoint: account.endpoint,
  owner: 'team',
  name: 'repo',
  login: 'me',
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

describe('History Actions entry points', () => {
  const oldObserver = globalThis.IntersectionObserver
  const oldHidden = Object.getOwnPropertyDescriptor(document, 'hidden')
  let menus: ReadonlyArray<ISerializableMenuItem>
  let choose: (indices: number[] | null) => void
  let opened: Popup[]
  let restore: () => void
  let restoreReader: () => void
  let reads: number
  beforeEach(async () => {
    reads = 0
    opened = []
    menus = []
    choose = () => assert.fail('No menu')
    // jsdom has no layout; mounting starts the normal visible-row subscription.
    Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
    const read = mock.method(
      CommitActionsClient.prototype,
      'forCommit',
      async () => {
        reads++
        return { state: 'success', count: 1, description: 'Passed' } as const
      }
    )
    restoreReader = () => read.mock.restore()
    const { ipcRenderer } = await import('electron')
    const old = ipcRenderer.invoke
    ipcRenderer.invoke = (
      channel: string,
      items: ReadonlyArray<ISerializableMenuItem>
    ) => {
      assert.equal(channel, 'show-contextual-menu')
      menus = items
      return new Promise<number[] | null>(resolve => {
        choose = resolve
      })
    }
    restore = () => {
      ipcRenderer.invoke = old
    }
  })
  afterEach(() => {
    cleanup()
    render(
      <CommitActionsStatus gitHubRepository={null} accounts={[]} sha={sha} />
    )
    cleanup()
    restore()
    restoreReader()
    globalThis.IntersectionObserver = oldObserver
    if (oldHidden === undefined) {
      Reflect.deleteProperty(document, 'hidden')
    } else {
      Object.defineProperty(document, 'hidden', oldHidden)
    }
  })
  function list(repo: GitHubRepository | null = hosted, accounts = [account]) {
    const props: React.ComponentProps<typeof CommitList> = {
      repository: new Repository('/test/repo', 1, repo, false),
      dispatcher: {
        showPopup: async (popup: Popup) => {
          opened.push(popup)
        },
      } as Dispatcher,
      commitSHAs: [sha, otherSHA],
      commitLookup: new Map([
        [sha, commit(sha)],
        [otherSHA, commit(otherSHA)],
      ]),
      selectedSHAs: [sha],
      localCommitSHAs: [],
      emoji: new Map(),
      accounts,
      isLocalRepository: false,
      preferAbsoluteDates: false,
      showConventionalCommitBadges: false,
    }
    return new CommitList(props)
  }
  function menu(instance: CommitList) {
    // Exercise the actual context-menu handler and Electron menu serialization.
    const event = { preventDefault() {} } as React.MouseEvent<HTMLDivElement>
    ;(instance as any).onRowContextMenu(1, event)
    return menus.findIndex(item =>
      /View Actions for [Cc]ommit/.test(item.label ?? '')
    )
  }
  it('adds a native context-menu entry for the clicked SHA, not the selected commit', async () => {
    const index = menu(list())
    assert.ok(index >= 0)
    assert.equal(menus[index].enabled, true)
    assert.equal(opened.length, 0)
    assert.equal(reads, 0, 'Building a menu does not make requests')
    choose([index])
    await flush()
    assert.deepEqual(opened, [
      { type: PopupType.CommitActions, target, sha: otherSHA },
    ])
  })
  it('captures the original target even if the native menu outlives a repository change', async () => {
    const instance = list()
    const index = menu(instance)
    Object.assign(instance, {
      props: {
        ...instance.props,
        repository: new Repository(
          '/test/other',
          2,
          { ...hosted, name: 'other' } as GitHubRepository,
          false
        ),
      },
    })
    choose([index])
    await flush()
    assert.deepEqual(opened, [
      { type: PopupType.CommitActions, target, sha: otherSHA },
    ])
  })
  it('does not navigate when the context menu is cancelled', async () => {
    menu(list())
    choose(null)
    await flush()
    assert.deepEqual(opened, [])
  })
  it('disables the action without a matching signed-in account', async () => {
    const index = menu(list(hosted, []))
    assert.equal(menus[index].enabled, false)
    choose([index])
    await flush()
    assert.deepEqual(opened, [])
  })
  it('omits Actions for local repositories and unsupported providers', () => {
    assert.equal(menu(list(null)), -1)
    assert.equal(
      menu(list({ ...hosted, type: 'gitlab' } as GitHubRepository)),
      -1
    )
  })
  it('wires a real rendered row badge to the same commit popup', async () => {
    const instance = list()
    const view = render((instance as any).renderCommit(1))
    const button = await view.findByRole('button', {
      name: /View Actions for this commit/,
    })
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog')
    fireEvent.click(button)
    assert.deepEqual(opened, [
      { type: PopupType.CommitActions, target, sha: otherSHA },
    ])
    assert.equal(reads, 1)
  })
  it('does not bubble activation into selection, drag, squash or checkout handlers', async () => {
    let rowEvents = 0
    const rowEvent = () => {
      rowEvents++
    }
    const view = render(
      <div
        role="presentation"
        onClick={rowEvent}
        onMouseDown={rowEvent}
        onMouseUp={rowEvent}
        onDoubleClick={rowEvent}
        onKeyDown={rowEvent}
        onKeyUp={rowEvent}
      >
        <CommitActionsStatus
          accounts={[account]}
          gitHubRepository={hosted}
          sha={sha}
          onOpenActions={(t, s) => {
            opened.push({ type: PopupType.CommitActions, target: t, sha: s })
          }}
        />
      </div>
    )
    const button = await view.findByRole('button', { name: /View Actions/ })
    fireEvent.mouseDown(button)
    fireEvent.mouseUp(button)
    fireEvent.click(button)
    fireEvent.click(button, { detail: 2 })
    fireEvent.doubleClick(button)
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.keyUp(button, { key: 'Enter' })
    fireEvent.keyDown(button, { key: ' ' })
    fireEvent.keyUp(button, { key: ' ' })
    assert.equal(rowEvents, 0)
    assert.equal(opened.length, 1)
  })
  it('preserves the cache, button DOM and correct target across profile/layout rerenders', async () => {
    const onOpenActions = (t: typeof target, head: string) => {
      opened.push({
        type: PopupType.CommitActions,
        target: t as any,
        sha: head,
      })
    }
    const element = (head: string) => (
      <CommitActionsStatus
        accounts={[{ ...account } as Account]}
        gitHubRepository={hosted}
        sha={head}
        onOpenActions={onOpenActions}
      />
    )
    const view = render(element(sha))
    const button = await view.findByRole('button', { name: /View Actions/ })
    for (let i = 0; i < 50; i++) {
      view.rerender(element(sha))
    }
    assert.equal(view.getByRole('button', { name: /View Actions/ }), button)
    assert.equal(reads, 1)
    view.rerender(element(otherSHA))
    const next = await view.findByRole('button', { name: /View Actions/ })
    fireEvent.click(next)
    assert.equal(opened[0].type, PopupType.CommitActions)
    assert.deepEqual(opened, [
      { type: PopupType.CommitActions, target, sha: otherSHA },
    ])
  })
})
