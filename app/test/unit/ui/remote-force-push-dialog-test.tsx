import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import { ConfirmForcePush } from '../../../src/ui/rebase/confirm-force-push'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { Repository } from '../../../src/models/repository'
import { IRemoteForcePushTarget } from '../../../src/models/remote-force-push'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const repository = new Repository('/repo', 1, null, false)
const target: IRemoteForcePushTarget = {
  repositoryPath: repository.path,
  remote: {
    name: 'gitea',
    url: 'https://user:secret@gitea.example/team/repo.git',
  },
  pushURL: 'https://user:secret@gitea.example/team/repo.git',
  branchName: 'main',
  localTip: 'a'.repeat(40),
  remoteTip: 'b'.repeat(40),
}

function setup() {
  const pushed: IRemoteForcePushTarget[] = []
  let ordinaryPushes = 0
  let settingsChanges = 0
  let dismissed = 0
  const dispatcher = {
    forcePushToRemote: async (
      _repository: Repository,
      plan: IRemoteForcePushTarget
    ) => {
      pushed.push(plan)
    },
    performForcePush: async () => {
      ordinaryPushes++
    },
    setConfirmForcePushSetting: () => {
      settingsChanges++
    },
    postError: async (error: Error) => {
      throw error
    },
  } as unknown as Dispatcher
  const view = render(
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <ConfirmForcePush
        repository={repository}
        dispatcher={dispatcher}
        upstreamBranch="gitea/main"
        remoteForcePush={target}
        askForConfirmationOnForcePush={false}
        onDismissed={() => {
          dismissed++
        }}
      />
    </DialogStackContext.Provider>
  )
  unmountDialog = view.unmount
  return {
    view,
    pushed,
    counts: () => ({ ordinaryPushes, settingsChanges, dismissed }),
  }
}

const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal'
)
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close'
)
let restoreIpcSend: (() => void) | null = null
let unmountDialog: (() => void) | null = null

describe('remote force push confirmation', () => {
  beforeEach(async () => {
    const electron = await import('electron')
    const previousSend = electron.ipcRenderer.send
    electron.ipcRenderer.send = () => {}
    restoreIpcSend = () => {
      electron.ipcRenderer.send = previousSend
      restoreIpcSend = null
    }

    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
      this.focus()
    }
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
  })

  afterEach(() => {
    unmountDialog?.()
    unmountDialog = null
    restoreIpcSend?.()

    if (showModalDescriptor === undefined) {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    } else {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        'showModal',
        showModalDescriptor
      )
    }

    if (closeDescriptor === undefined) {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
    } else {
      Object.defineProperty(
        HTMLDialogElement.prototype,
        'close',
        closeDescriptor
      )
    }
  })

  it('shows the chosen remote and frozen tips without exposing URL credentials', () => {
    const { view } = setup()
    const text = view.container.textContent ?? ''
    assert.match(text, /gitea\/main/)
    assert.match(text, /aaaaaaaaaaaa/)
    assert.match(text, /bbbbbbbbbbbb/)
    assert.match(text, /gitea.example\/team\/repo/)
    assert.doesNotMatch(text, /secret|user:/)
    assert.equal(screen.queryByRole('checkbox'), null)
    assert.equal(
      screen.getByRole('button', { name: 'Cancel' }).getAttribute('type'),
      'submit'
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Force push with lease' })
        .getAttribute('type'),
      'button'
    )
  })

  it('Cancel sends no push and does not change confirmation preferences', async () => {
    const { pushed, counts } = setup()
    // The standard dialog ignores dismissal during its entrance animation.
    await new Promise(resolve => setTimeout(resolve, 300))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.equal(counts().dismissed, 1))
    assert.deepEqual(pushed, [])
    assert.equal(counts().ordinaryPushes, 0)
    assert.equal(counts().settingsChanges, 0)
  })

  it('confirms exactly once with the captured plan, never the toolbar upstream', async () => {
    const { view, pushed, counts } = setup()
    const form = view.container.querySelector('form')
    assert(form)
    fireEvent.click(
      screen.getByRole('button', { name: 'Force push with lease' })
    )
    fireEvent.submit(form)
    await waitFor(() => assert.equal(pushed.length, 1))
    assert.equal(pushed[0], target)
    assert.deepEqual(counts(), {
      ordinaryPushes: 0,
      settingsChanges: 0,
      dismissed: 1,
    })
  })
})
