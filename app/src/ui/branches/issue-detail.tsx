import * as React from 'react'

import { IAPIIssueDetails } from '../../lib/api'
import { Emoji } from '../../lib/emoji'
import { formatDate } from '../../lib/format-date'
import { formatRelative } from '../../lib/format-relative'
import { getPreferAbsoluteDates } from '../../models/formatting-preferences'
import { GitHubRepository } from '../../models/github-repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { SandboxedMarkdown } from '../lib/sandboxed-markdown'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

const CommentsPerBatch = 20
const IssueMarkdownCSS = `
  .markdown-body { overflow-wrap: anywhere; }
  .markdown-body pre { overflow-x: auto; }
  .markdown-body pre code { overflow-wrap: normal; }
  .markdown-body table { display: block; max-width: 100%; overflow-x: auto; }
`

interface IIssueDetailProps {
  readonly repository: GitHubRepository
  readonly details: IAPIIssueDetails
  readonly dispatcher: Dispatcher
  readonly emoji: Map<string, Emoji>
  readonly underlineLinks: boolean
}

interface IIssueDetailState {
  readonly visibleComments: number
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

/** Issue content; the surrounding dialog owns the single vertical scrollbar. */
export class IssueDetail extends React.Component<IIssueDetailProps, IIssueDetailState> {
  public constructor(props: IIssueDetailProps) {
    super(props)
    this.state = { visibleComments: CommentsPerBatch }
  }

  private onMarkdownLinkClicked = (url: string) => {
    this.props.dispatcher.openInBrowser(url)
  }

  private onShowMoreComments = () => {
    this.setState(state => ({
      visibleComments: state.visibleComments + CommentsPerBatch,
    }))
  }

  private renderMarkdown(markdown: string, ariaLabel: string) {
    return (
      <SandboxedMarkdown
        markdown={markdown}
        emoji={this.props.emoji}
        baseHref={this.props.repository.htmlURL ?? undefined}
        repository={this.props.repository}
        markdownContext="IssueComment"
        onMarkdownLinkClicked={this.onMarkdownLinkClicked}
        underlineLinks={this.props.underlineLinks}
        customCSS={IssueMarkdownCSS}
        ariaLabel={ariaLabel}
      />
    )
  }

  public render() {
    const { issue, comments } = this.props.details
    const body = issue.body?.trim() ? issue.body : '_No description provided._'
    const closed = issue.state === 'closed'
    const visibleComments = comments.slice(0, this.state.visibleComments)
    const remaining = comments.length - visibleComments.length

    return (
      <div className="issue-detail">
        <div className={`issue-detail-status ${closed ? 'closed' : 'open'}`}>
          <Octicon symbol={closed ? octicons.issueClosed : octicons.issueOpened} />
          <span>{closed ? 'Closed' : 'Open'}</span>
        </div>
        <h2 className="issue-detail-title">{issue.title}</h2>
        <div className="issue-detail-meta">
          #{issue.number} opened {formatTimestamp(issue.created_at)} by{' '}
          {issue.user.login}
        </div>
        <div className="issue-detail-body">
          {this.renderMarkdown(body, 'Issue description')}
        </div>
        <h2 className="issue-comments-heading" tabIndex={-1}>
          Comments ({comments.length})
        </h2>
        {comments.length === 0 && <p className="issue-no-comments">No comments yet.</p>}
        {visibleComments.map(comment => (
          <article className="issue-comment" key={comment.id}>
            <h3 className="issue-comment-meta">
              <strong>{comment.user.login}</strong> commented{' '}
              <time dateTime={comment.created_at}>
                {formatTimestamp(comment.created_at)}
              </time>
            </h3>
            {this.renderMarkdown(comment.body, `Comment by ${comment.user.login}`)}
          </article>
        ))}
        {remaining > 0 && (
          <div className="issue-more-comments">
            <Button onClick={this.onShowMoreComments}>
              Show more comments ({remaining} remaining)
            </Button>
          </div>
        )}
      </div>
    )
  }
}
