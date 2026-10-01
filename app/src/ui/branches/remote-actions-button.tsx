import * as React from 'react'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IRemoteActionsButtonProps {
  /** Repository, remote, branch tip and selected login; never rendered in DOM. */
  readonly contextKey: string
  readonly disabled: boolean
  readonly forcePushLabel?: string
  readonly forcePushDisabled: boolean
  readonly onManageRemotes: () => void
  /** Open confirmation only. This must never send a push directly. */
  readonly onForcePush: () => void
}

/** Keep history replacement out of the everyday Fetch/Pull/Push controls. */
export class RemoteActionsButton extends React.PureComponent<IRemoteActionsButtonProps> {
  private unmounted = false
  private menuOpen = false

  public componentWillUnmount() {
    this.unmounted = true
  }

  private onOpenMenu = async () => {
    if (this.props.disabled || this.unmounted || this.menuOpen) {
      return
    }
    const snapshot = this.props
    const isCurrent = () =>
      !this.unmounted &&
      !this.props.disabled &&
      this.props.contextKey === snapshot.contextKey
    const items: IMenuItem[] = [
      {
        label: 'Manage remotes…',
        action: () => {
          if (isCurrent()) {
            snapshot.onManageRemotes()
          }
        },
      },
    ]
    if (snapshot.forcePushLabel !== undefined) {
      items.push(
        { type: 'separator' },
        {
          label: `Force push ${snapshot.forcePushLabel}…`,
          enabled: !snapshot.forcePushDisabled,
          action: () => {
            // A native menu can outlive its React props. Never apply an old
            // selection to a newly selected remote, branch, commit or account.
            if (
              isCurrent() &&
              !snapshot.forcePushDisabled &&
              !this.props.forcePushDisabled
            ) {
              snapshot.onForcePush()
            }
          },
        }
      )
    }
    this.menuOpen = true
    try {
      await showContextualMenu(items)
    } finally {
      this.menuOpen = false
    }
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.onOpenMenu()
    }
  }

  public render() {
    return (
      <Button
        className="remote-more-actions-button"
        onClick={this.onOpenMenu}
        onKeyDown={this.onKeyDown}
        disabled={this.props.disabled}
        tooltip="More remote actions"
        ariaLabel="More remote actions"
        ariaHaspopup="menu"
      >
        <Octicon symbol={octicons.kebabHorizontal} />
      </Button>
    )
  }
}
