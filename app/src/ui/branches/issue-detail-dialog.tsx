import * as React from 'react'

import { IAPIIssueDetails } from '../../lib/api'
import { FoldoutType } from '../../lib/app-state'
import { Emoji } from '../../lib/emoji'
import { GitHubRepository } from '../../models/github-repository'
import { Dialog, DialogPreferredFocusClassName } from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { IssueDetail } from './issue-detail'

interface IIssueDetailDialogProps {
  readonly repository: GitHubRepository
  readonly issueNumber: number
  readonly dispatcher: Dispatcher
  readonly emoji: Map<string, Emoji>
  readonly underlineLinks: boolean
  readonly onDismissed: () => void
}

interface IIssueDetailDialogState {
  readonly details: IAPIIssueDetails | null
  readonly loading: boolean
  readonly failed: boolean
}

/** A viewport-bounded, read-only reader independent of the branch foldout. */
export class IssueDetailDialog extends React.Component<
  IIssueDetailDialogProps,
  IIssueDetailDialogState
> {
  private requestId = 0
  private contentRef = React.createRef<HTMLDivElement>()

  public constructor(props: IIssueDetailDialogProps) {
    super(props)
    this.state = { details: null, loading: true, failed: false }
  }

  public componentDidMount() {
    this.loadDetails()
  }

  public componentDidUpdate(previous: IIssueDetailDialogProps) {
    if (
      previous.repository.hash !== this.props.repository.hash ||
      previous.issueNumber !== this.props.issueNumber
    ) {
      this.setState({ details: null })
      this.contentRef.current?.scrollTo(0, 0)
      this.loadDetails()
    }
  }

  public componentWillUnmount() {
    // Ignore late responses, including a response from a previous repository.
    this.requestId++
  }

  private loadDetails = async () => {
    const requestId = ++this.requestId
    this.setState({ loading: true, failed: false })

    try {
      const details = await this.props.dispatcher.fetchIssueDetails(
        this.props.repository,
        this.props.issueNumber
      )

      if (requestId !== this.requestId) {
        return
      }

      if (details === null) {
        this.setState({ loading: false, failed: true })
        return
      }

      this.setState({ details, loading: false, failed: false })
    } catch {
      if (requestId === this.requestId) {
        this.setState({ loading: false, failed: true })
      }
    }
  }

  private onViewIssue = () => {
    const url = this.state.details?.issue.html_url
    if (url && /^https?:\/\//i.test(url)) {
      this.props.dispatcher.openInBrowser(url)
    }
  }

  private onBackToIssues = () => {
    this.props.onDismissed()
    this.props.dispatcher.showFoldout({ type: FoldoutType.Branch })
  }

  private onJumpToComments = () => {
    this.contentRef.current
      ?.querySelector<HTMLElement>('.issue-comments-heading')
      ?.focus()
  }

  public render() {
    const { details, loading, failed } = this.state
    const { repository, issueNumber } = this.props

    return (
      <Dialog
        id="issue-detail-dialog"
        title={`Issue #${issueNumber}`}
        onDismissed={this.props.onDismissed}
        loading={loading}
      >
        <div className="issue-reader-toolbar">
          <span className="issue-reader-repository">{repository.fullName}</span>
          <div className="issue-reader-actions">
            <Button onClick={this.onJumpToComments} disabled={details === null}>
              Comments
            </Button>
            <Button onClick={this.loadDetails} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
            <Button onClick={this.onViewIssue} disabled={details === null}>
              Open in browser
            </Button>
          </div>
        </div>
        <div
          className={`dialog-content issue-reader-content ${DialogPreferredFocusClassName}`}
          role="region"
          aria-label="Issue description and comments"
          aria-busy={loading}
          tabIndex={0}
          ref={this.contentRef}
        >
          {failed && (
            <div className="issue-reader-message" role="alert">
              <p>
                Unable to load this issue. Check your connection and account
                access, then try again.
              </p>
              <Button onClick={this.loadDetails} disabled={loading}>
                Retry
              </Button>
            </div>
          )}
          {details === null && loading && (
            <p className="issue-reader-message" role="status">
              Loading issue #{issueNumber}…
            </p>
          )}
          {details !== null && (
            <IssueDetail
              key={`${repository.hash}-${issueNumber}`}
              repository={repository}
              details={details}
              dispatcher={this.props.dispatcher}
              emoji={this.props.emoji}
              underlineLinks={this.props.underlineLinks}
            />
          )}
        </div>
        <div className="issue-reader-footer">
          <span>Read only</span>
          <Button onClick={this.onBackToIssues}>Back to issues</Button>
        </div>
      </Dialog>
    )
  }
}
