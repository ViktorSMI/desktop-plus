import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import { IRemoteForcePushRequest } from '../../../src/models/remote-force-push'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import { ConfirmForcePush } from '../../../src/ui/rebase/confirm-force-push'
import { Dispatcher } from '../../../src/ui/dispatcher'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '../../helpers/ui/render'

const request: IRemoteForcePushRequest = {
  remote: { name: 'gitea', url: 'https://git.example.test/team/project.git' },
  pushURL: 'https://username:secret@git.example.test/team/project.git',
  branchName: 'main',
  lease: { localTip: 'a'.repeat(40), expectedRemoteTip: 'b'.repeat(40) },
}

function renderDialog(targeted = true) {
  const pushed: IRemoteForcePushRequest[] = []
  let normalPushes = 0
  let dismissals = 0
  let preferenceChanges = 0
  const dispatcher = {
    forcePushToRemote: async (
      _repo: Repository,
      req: IRemoteForcePushRequest
    ) => {
      pushed.push(req)
    },
    performForcePush: async () => {
      normalPushes++
    },
    setConfirmForcePushSetting: () => {
      preferenceChanges++
    },
  } as unknown as Dispatcher
  const element = (remoteRequest: IRemoteForcePushRequest | undefined) => (
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <ConfirmForcePush
        dispatcher={dispatcher}
        repository={new Repository('/test/project', -1, null, false)}
        upstreamBranch={targeted ? 'gitea/main' : 'origin/main'}
        remoteRequest={remoteRequest}
        askForConfirmationOnForcePush={false}
        onDismissed={() => {
          dismissals++
        }}
      />
    </DialogStackContext.Provider>
  )
  const view = render(element(targeted ? request : undefined))
  return {
    rerenderRequest: (next: IRemoteForcePushRequest) =>
      view.rerender(element(next)),
    pushed,
    counts: () => ({ normalPushes, dismissals, preferenceChanges }),
  }
}

describe('remote force push confirmation', () => {
  let restorePlatformBridges: (() => void) | undefined

  beforeEach(async () => {
    // Keep the real dialog and controls; only replace Electron and native DOM bridges.
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
    restorePlatformBridges = () => {
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
      restorePlatformBridges?.()
      restorePlatformBridges = undefined
    }
  })

  it('shows the destination and both approved commits, never credentials or a skip-confirmation checkbox', () => {
    renderDialog()
    const content = document.body.textContent ?? ''
    assert(content.includes('gitea/main'))
    assert(content.includes('aaaaaaaaaaaa'))
    assert(content.includes('bbbbbbbbbbbb'))
    assert(content.includes('git.example.test/team/project'))
    assert(!content.includes('username:secret'))
    assert.equal(screen.queryByRole('checkbox'), null)
    assert.equal(
      screen
        .getByRole('button', { name: 'Cancel', exact: true })
        .getAttribute('type'),
      'submit'
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Force push', exact: true })
        .getAttribute('type'),
      'button'
    )
  })

  it('Cancel never sends a push', async () => {
    const view = renderDialog()
    await new Promise(resolve => setTimeout(resolve, 300))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    await waitFor(() => assert.equal(view.counts().dismissals, 1))
    assert.deepEqual(view.pushed, [])
    assert.equal(view.counts().normalPushes, 0)
  })

  it('submits the original snapshot once without invoking normal upstream push or changing preferences', async () => {
    const view = renderDialog()
    const button = screen.getByRole('button', {
      name: 'Force push',
      exact: true,
    })
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'gitea/main' },
    })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => assert.equal(view.pushed.length, 1))
    assert.equal(view.pushed[0], request)
    assert.equal(view.counts().normalPushes, 0)
    assert.equal(view.counts().preferenceChanges, 0)
  })

  it('requires the exact destination and blocks direct form submission without it', () => {
    const view = renderDialog()
    const input = screen.getByRole('textbox', {
      name: 'To confirm, type gitea/main',
    })
    const button = screen.getByRole('button', {
      name: 'Force push',
      exact: true,
    })
    const form = button.closest('form')
    assert.ok(form)
    for (const value of [
      '',
      'main',
      'origin/main',
      'gitea/Main',
      ' gitea/main',
      'gitea/main ',
    ]) {
      fireEvent.change(input, { target: { value } })
      assert.equal(button.getAttribute('aria-disabled'), 'true')
      fireEvent.click(button)
      fireEvent.submit(form)
      assert.equal(view.pushed.length, 0)
      assert.equal(view.counts().dismissals, 0)
    }
    fireEvent.change(input, { target: { value: 'gitea/main' } })
    assert.notEqual(button.getAttribute('aria-disabled'), 'true')
    fireEvent.change(input, { target: { value: '' } })
    assert.equal(button.getAttribute('aria-disabled'), 'true')
  })

  it('invalidates typed consent when the approved snapshot changes, even on the same branch', () => {
    const view = renderDialog()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'gitea/main' },
    })
    const next = {
      ...request,
      lease: { ...request.lease, localTip: 'c'.repeat(40) },
    }
    view.rerenderRequest(next)
    const input = screen.getByRole('textbox') as HTMLInputElement
    const button = screen.getByRole('button', {
      name: 'Force push',
      exact: true,
    })
    assert.equal(input.value, '')
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    const form = button.closest('form')
    assert.ok(form)
    fireEvent.submit(form)
    assert.equal(view.pushed.length, 0)
    fireEvent.change(input, { target: { value: 'gitea/main' } })
    fireEvent.click(button)
    assert.deepEqual(view.pushed, [next])
  })

  it('Cancel remains the safe default even after typing the destination', async () => {
    const view = renderDialog()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'gitea/main' },
    })
    const cancel = screen.getByRole('button', { name: 'Cancel', exact: true })
    assert.equal(cancel.getAttribute('type'), 'submit')
    await new Promise(resolve => setTimeout(resolve, 300))
    fireEvent.click(cancel)
    await waitFor(() => assert.equal(view.counts().dismissals, 1))
    assert.deepEqual(view.pushed, [])
  })

  it('retains the existing upstream confirmation path', async () => {
    const view = renderDialog(false)
    assert(screen.getByRole('checkbox'))
    fireEvent.click(
      screen.getByRole('button', { name: "I'm sure", exact: true })
    )
    await waitFor(() => assert.equal(view.counts().normalPushes, 1))
    assert.equal(view.counts().preferenceChanges, 1)
    assert.deepEqual(view.pushed, [])
  })
})
