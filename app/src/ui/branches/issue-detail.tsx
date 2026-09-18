import * as React from 'react'

import { IAPIIssueDetails } from '../../lib/api'
import { assertNever } from '../../lib/fatal-error'
import { formatDate } from '../../lib/format-date'
import { formatRelative } from '../../lib/format-relative'
import { getForgejoName } from '../../lib/forgejo-name'
import { Emoji } from '../../lib/emoji'
import { getPreferAbsoluteDates } from '../../models/formatting-preferences'
import { GitHubRepository } from '../../models/github-repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { SandboxedMarkdown } from '../lib/sandboxed-markdown'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IIssueDetailProps {
  readonly repository: GitHubRepository
  readonly details: IAPIIssueDetails
  readonly dispatcher: Dispatcher
  readonly emoji: Map<string, Emoji>
  readonly underlineLinks: boolean
  readonly onBack: () => void
}

function getViewLabel(repository: GitHubRepository): string {
  switch (repository.type) {
    case 'github':
      return 'View on GitHub'
    case 'gitlab':
      return 'View on GitLab'
    case 'forgejo':
      return `View on ${getForgejoName(repository.endpoint)}`
    case 'gitea':
      return 'View on Gitea'
    case 'bitbucket':
      return 'View on Bitbucket'
    default:
      return assertNever(
        repository.type,
        `Unknown repository type: ${repository.type}`
      )
  }
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }

  return getPreferAbsoluteDates()
    ? formatDate(new Date(timestamp))
    : formatRelative(timestamp - Date.now())
}

/** Read-only issue body and discussion shown inside the branch dropdown. */
export class IssueDetail extends React.Component<IIssueDetailProps> {
  private onMarkdownLinkClicked = (url: string) => {
    this.props.dispatcher.openInBrowser(url)
  }

  private onViewIssue = () => {
    if (this.props.details.issue.html_url.length > 0) {
      this.props.dispatcher.openInBrowser(this.props.details.issue.html_url)
    }
  }

  public render() {
    const { issue, comments } = this.props.details
    const displayBody =
      issue.body !== null && issue.body.trim() !== ''
        ? issue.body
        : '_No description provided._'

    return (
      <div className="issue-detail">
        <header className="issue-detail-header">
          <Button
            className="button-with-icon"
            onClick={this.props.onBack}
            ariaLabel="Back to issues"
          >
            <Octicon symbol={octicons.chevronLeft} className="mr" />
            Issues
          </Button>
          <Button
            className="button-with-icon"
            onClick={this.onViewIssue}
            role="link"
          >
            {getViewLabel(this.props.repository)}
            <Octicon symbol={octicons.linkExternal} className="ml" />
          </Button>
        </header>

        <div className="issue-detail-scroll">
          <div className="issue-detail-status">
            <Octicon symbol={octicons.issueOpened} className="icon" />
            <span>Open</span>
          </div>
          <h2 className="issue-detail-title">{issue.title}</h2>
          <div className="issue-detail-meta">
            #{issue.number} opened {formatTimestamp(issue.created_at)} by{' '}
            {issue.user.login}
          </div>

          <div className="issue-detail-body">
            <SandboxedMarkdown
              markdown={displayBody}
              emoji={this.props.emoji}
              baseHref={this.props.repository.htmlURL ?? undefined}
              repository={this.props.repository}
              onMarkdownLinkClicked={this.onMarkdownLinkClicked}
              underlineLinks={this.props.underlineLinks}
              ariaLabel="Issue description"
            />
          </div>

          <div className="issue-comments-heading">
            Comments ({comments.length})
          </div>

          {comments.length === 0 ? (
            <div className="issue-no-comments">No comments yet.</div>
          ) : (
            comments.map(comment => (
              <article className="issue-comment" key={comment.id}>
                <div className="issue-comment-meta">
                  <strong>{comment.user.login}</strong>{' '}
                  commented {formatTimestamp(comment.created_at)}
                </div>
                <SandboxedMarkdown
                  markdown={comment.body}
                  emoji={this.props.emoji}
                  baseHref={this.props.repository.htmlURL ?? undefined}
                  repository={this.props.repository}
                  markdownContext="IssueComment"
                  onMarkdownLinkClicked={this.onMarkdownLinkClicked}
                  underlineLinks={this.props.underlineLinks}
                  ariaLabel={`Comment by ${comment.user.login}`}
                />
              </article>
            ))
          )}
        </div>
      </div>
    )
  }
}
