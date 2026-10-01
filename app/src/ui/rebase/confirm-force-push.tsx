import * as React from 'react'

import { Repository } from '../../models/repository'
import { IRemoteForcePushRequest } from '../../models/remote-force-push'
import { remoteUrlToWebUrl } from '../../lib/remote-parsing'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Dispatcher } from '../dispatcher'
import { DialogFooter, DialogContent, Dialog } from '../dialog'
import { Ref } from '../lib/ref'
import { TextBox } from '../lib/text-box'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IConfirmForcePushProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly upstreamBranch: string
  readonly remoteRequest?: IRemoteForcePushRequest
  readonly askForConfirmationOnForcePush: boolean
  readonly onDismissed: () => void
}

interface IConfirmForcePushState {
  readonly confirmationValue: string
  readonly confirmationRequest?: IRemoteForcePushRequest
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
      confirmationValue: '',
      isLoading: false,
      askForConfirmationOnForcePush: props.askForConfirmationOnForcePush,
    }
  }

  private get canForcePush() {
    const request = this.props.remoteRequest
    return (
      request === undefined ||
      (this.state.confirmationRequest === request &&
        this.state.confirmationValue ===
          `${request.remote.name}/${request.branchName}`)
    )
  }

  private onConfirmationChanged = (confirmationValue: string) => {
    this.setState({
      confirmationValue,
      confirmationRequest: this.props.remoteRequest,
    })
  }

  public render() {
    const request = this.props.remoteRequest
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
          {request !== undefined ? (
            <>
              <p>
                Repository: <strong>{this.props.repository.name}</strong>
              </p>
              <p>
                Destination:{' '}
                <Ref>
                  {request.remote.name}/{request.branchName}
                </Ref>{' '}
                (
                {remoteUrlToWebUrl(request.pushURL) ?? 'Local or custom remote'}
                )
              </p>
              <p>
                Replace remote commit{' '}
                <Ref>{request.lease.expectedRemoteTip.slice(0, 12)}</Ref> with{' '}
                <Ref>{request.branchName}</Ref> at{' '}
                <Ref>{request.lease.localTip.slice(0, 12)}</Ref>.
              </p>
              <p>
                Only this remote branch will be replaced. Your configured
                upstream, other remotes, and tags will not be changed. If the
                remote has new commits, the push will be rejected. Fetch and
                review them before trying again.
              </p>
              <TextBox
                label={`To confirm, type ${request.remote.name}/${request.branchName}`}
                value={
                  this.state.confirmationRequest === request
                    ? this.state.confirmationValue
                    : ''
                }
                onValueChanged={this.onConfirmationChanged}
                disabled={this.state.isLoading}
                spellcheck={false}
              />
            </>
          ) : (
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
            okButtonText={request === undefined ? "I'm sure" : 'Force push'}
            okButtonDisabled={this.state.isLoading || !this.canForcePush}
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
    if (this.submitted || !this.canForcePush) {
      return
    }
    this.submitted = true
    this.setState({ isLoading: true })
    const request = this.props.remoteRequest
    if (request !== undefined) {
      this.props.onDismissed()
      await this.props.dispatcher.forcePushToRemote(
        this.props.repository,
        request
      )
      return
    }

    this.props.dispatcher.setConfirmForcePushSetting(
      this.state.askForConfirmationOnForcePush
    )
    this.props.onDismissed()

    await this.props.dispatcher.performForcePush(this.props.repository)
  }
}
