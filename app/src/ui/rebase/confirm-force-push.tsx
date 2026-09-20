import * as React from 'react'

import { Repository } from '../../models/repository'
import { IRemoteForcePushTarget } from '../../models/remote-force-push'
import { remoteUrlToWebUrl } from '../../lib/remote-parsing'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Dispatcher } from '../dispatcher'
import { DialogFooter, DialogContent, Dialog } from '../dialog'
import { Ref } from '../lib/ref'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IConfirmForcePushProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly upstreamBranch: string
  readonly remoteForcePush?: IRemoteForcePushTarget
  readonly askForConfirmationOnForcePush: boolean
  readonly onDismissed: () => void
}

interface IConfirmForcePushState {
  readonly isLoading: boolean
  readonly askForConfirmationOnForcePush: boolean
}

export class ConfirmForcePush extends React.Component<
  IConfirmForcePushProps,
  IConfirmForcePushState
> {
  private submitted = false

  public constructor(props: IConfirmForcePushProps) {
    super(props)

    this.state = {
      isLoading: false,
      askForConfirmationOnForcePush: props.askForConfirmationOnForcePush,
    }
  }

  public render() {
    const target = this.props.remoteForcePush
    return (
      <Dialog
        title="Are you sure you want to force push?"
        dismissDisabled={this.state.isLoading}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onForcePush}
        type="warning"
      >
        <DialogContent>
          <p>
            A force push will rewrite history on{' '}
            <Ref>{this.props.upstreamBranch}</Ref>. Any collaborators working on
            this branch will need to reset their own local branch to match the
            history of the remote.
          </p>
          {target !== undefined && (
            <>
              <p>
                Destination:{' '}
                <Ref>
                  {target.remote.name}/{target.branchName}
                </Ref>
                {' · '}
                {remoteUrlToWebUrl(target.pushURL) ?? 'Local Git remote'}
              </p>
              <p>
                Replace remote commit{' '}
                <Ref>{target.remoteTip.substring(0, 12)}</Ref>
                {' with '}
                <Ref>
                  {target.branchName} @ {target.localTip.substring(0, 12)}
                </Ref>
                .
              </p>
              <p>
                Commits only on the remote may be lost. This uses the remote tip
                from your last Fetch. If it has changed, the push will be
                rejected. Your configured upstream and other remotes will not be
                changed.
              </p>
            </>
          )}
          {target === undefined && (
            <div>
              <Checkbox
                label="Do not show this message again"
                value={
                  this.state.askForConfirmationOnForcePush
                    ? CheckboxValue.Off
                    : CheckboxValue.On
                }
                onChange={this.onAskForConfirmationOnForcePushChanged}
              />
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            destructive={true}
            okButtonText={
              target === undefined ? "I'm sure" : 'Force push with lease'
            }
            okButtonDisabled={this.state.isLoading}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onAskForConfirmationOnForcePushChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = !event.currentTarget.checked

    this.setState({ askForConfirmationOnForcePush: value })
  }

  private onForcePush = async () => {
    if (this.submitted) {
      return
    }
    this.submitted = true
    this.setState({ isLoading: true })
    if (this.props.remoteForcePush !== undefined) {
      this.props.onDismissed()
      try {
        await this.props.dispatcher.forcePushToRemote(
          this.props.repository,
          this.props.remoteForcePush
        )
      } catch (error) {
        await this.props.dispatcher.postError(error)
      }
      return
    }
    this.props.dispatcher.setConfirmForcePushSetting(
      this.state.askForConfirmationOnForcePush
    )
    this.props.onDismissed()

    await this.props.dispatcher.performForcePush(this.props.repository)
  }
}
