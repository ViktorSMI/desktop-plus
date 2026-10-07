import assert from 'node:assert/strict'
import { before, describe, it, mock } from 'node:test'

const sent: unknown[][] = []
class TestWindow {
  public static getAllWindows() {
    return [new TestWindow()]
  }

  public isVisible() {
    return true
  }

  public readonly webContents = {
    isDestroyed: () => false,
    send: (...args: unknown[]) => sent.push(args),
  }
}

// Keep the real menu template and IPC event emitter; replace only Electron.
// This file runs in its own worker. Replace the bootstrap mock once, before
// importing the real menu, and retain its shell/renderer exports.
mock.restoreAll()
mock.module('electron', {
  namedExports: {
    BrowserWindow: TestWindow,
    shell: { openPath: async () => '' },
    ipcRenderer: { invoke: mock.fn(async () => {}), on: mock.fn(() => {}) },
  },
})
let menu: typeof import('../../../src/main-process/menu')
before(async () => {
  menu = await import('../../../src/main-process/menu')
})

describe('ordinary Push menu command and shortcut', () => {
  for (const isForcePushForCurrentRepository of [false, true]) {
    for (const askForConfirmationOnForcePush of [false, true]) {
      it(`emits only normal push with rewrite=${isForcePushForCurrentRepository}, confirmation=${askForConfirmationOnForcePush}`, () => {
        sent.length = 0
        const template = menu.buildDefaultMenuTemplate({
          selectedShell: null,
          selectedExternalEditor: null,
          askForConfirmationOnRepositoryRemoval: true,
          gitHubRepositoryType: null,
          gitHubRepositoryEndpoint: null,
          isForcePushForCurrentRepository,
          askForConfirmationOnForcePush,
        })
        const submenu = template.find(item => item.id === 'repository')?.submenu
        assert.ok(Array.isArray(submenu))
        const push = submenu.find(item => item.id === 'push')
        assert.ok(push)
        assert.equal(push.label?.replace('&', ''), 'Push')
        assert.equal(push.accelerator, 'CmdOrCtrl+P')
        assert.ok(push.click)
        push.click(
          {} as Electron.MenuItem,
          undefined,
          {} as Electron.KeyboardEvent
        )
        assert.deepEqual(sent, [['menu-event', 'push']])
      })
    }
  }
})
