import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { ISerializableMenuItem } from '../../../src/lib/menu-item'
import { RemoteActionsButton } from '../../../src/ui/branches/remote-actions-button'
import { cleanup, fireEvent, render, screen } from '../../helpers/ui/render'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

describe('remote actions overflow safety', () => {
  let menus: ReadonlyArray<ISerializableMenuItem>[]
  let choose: (indices: number[] | null) => void
  let confirmations: number
  let managed: number
  let restoreBridge: (() => void) | undefined
  const props = () => ({
    contextKey: 'repository/remote/branch/tip/account',
    disabled: false,
    forcePushDisabled: false,
    forcePushLabel: 'origin/main',
    onManageRemotes: () => managed++,
    onForcePush: () => confirmations++,
  })

  beforeEach(async () => {
    menus = []
    confirmations = 0
    managed = 0
    choose = () => assert.fail('No menu is open')
    const { ipcRenderer } = await import('electron')
    const originalInvoke = ipcRenderer.invoke
    restoreBridge = () => {
      ipcRenderer.invoke = originalInvoke
    }
    ipcRenderer.invoke = (
      channel: string,
      items: ReadonlyArray<ISerializableMenuItem>
    ) => {
      assert.equal(channel, 'show-contextual-menu')
      menus.push(items)
      return new Promise<number[] | null>(resolve => {
        choose = resolve
      })
    }
  })
  afterEach(() => {
    try {
      cleanup()
    } finally {
      restoreBridge?.()
      restoreBridge = undefined
    }
  })

  it('shows only a neutral overflow button and never pushes when opening or cancelling its menu', async () => {
    const { container } = render(<RemoteActionsButton {...props()} />)
    assert.equal(container.querySelector('.destructive'), null)
    assert.equal(screen.queryByRole('button', { name: /Force push/ }), null)
    const button = screen.getByRole('button', { name: 'More remote actions' })
    assert.equal(button.getAttribute('aria-haspopup'), 'menu')
    fireEvent.click(button)
    assert.equal(menus.length, 1)
    assert.equal(menus[0][0].label, 'Manage remotes…')
    assert.equal(menus[0][1].type, 'separator')
    assert.equal(menus[0][2].label, 'Force push origin/main…')
    assert.equal(confirmations, 0)
    choose(null)
    await flush()
    assert.equal(confirmations, 0)
    assert.equal(managed, 0)
  })

  it('requires selecting the force-push item to request confirmation', async () => {
    render(<RemoteActionsButton {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More remote actions' }))
    choose([2])
    await flush()
    assert.equal(confirmations, 1)
    assert.equal(managed, 0)
  })

  it('opens by ArrowDown and ignores double activation while the native menu is open', async () => {
    render(<RemoteActionsButton {...props()} />)
    const button = screen.getByRole('button', { name: 'More remote actions' })
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    fireEvent.click(button)
    assert.equal(menus.length, 1)
    choose([0])
    await flush()
    assert.equal(managed, 1)
    assert.equal(confirmations, 0)
  })

  it('omits force push for All remotes or a missing local branch', async () => {
    render(<RemoteActionsButton {...props()} forcePushLabel={undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'More remote actions' }))
    assert.equal(menus[0].length, 1)
    choose([2])
    await flush()
    assert.equal(confirmations, 0)
  })

  it('does not open the menu while repository operations are blocked', () => {
    render(<RemoteActionsButton {...props()} disabled={true} />)
    const button = screen.getByRole('button', { name: 'More remote actions' })
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'ArrowDown' })
    assert.equal(menus.length, 0)
  })

  it('guards a disabled force push even if an invalid menu selection is returned', async () => {
    render(<RemoteActionsButton {...props()} forcePushDisabled={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'More remote actions' }))
    assert.equal(menus[0][2].enabled, false)
    choose([2])
    await flush()
    assert.equal(confirmations, 0)
  })

  for (const changed of [
    { contextKey: 'another repository/remote/branch/tip/account' },
    { disabled: true },
    { forcePushDisabled: true },
  ]) {
    it(`ignores a stale menu after ${JSON.stringify(changed)}`, async () => {
      const initial = props()
      const view = render(<RemoteActionsButton {...initial} />)
      fireEvent.click(
        screen.getByRole('button', { name: 'More remote actions' })
      )
      view.rerender(<RemoteActionsButton {...initial} {...changed} />)
      choose([2])
      await flush()
      assert.equal(confirmations, 0)
    })
  }

  it('ignores native menu callbacks after leaving the picker', async () => {
    const view = render(<RemoteActionsButton {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'More remote actions' }))
    view.unmount()
    choose([2])
    await flush()
    assert.equal(confirmations, 0)
  })
})
