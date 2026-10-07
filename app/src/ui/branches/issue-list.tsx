import * as React from 'react'

import { IssuesStore, IIssueHit } from '../../lib/stores/issues-store'
import {
  getNonForkGitHubRepository,
  RepositoryWithGitHubRepository,
} from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import {
  IFilterListGroup,
  IFilterListItem,
  SelectionSource,
} from '../lib/filter-list'
import { SectionFilterList } from '../lib/section-filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { HighlightText } from '../lib/highlight-text'
import { TooltippedContent } from '../lib/tooltipped-content'
import { Button } from '../lib/button'
import { Octicon, syncClockwise } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import { FoldoutType } from '../../lib/app-state'
import { PopupType } from '../../models/popup'

const RowHeight = 47

interface IIssueListItem extends IFilterListItem {
  readonly id: string
  readonly text: ReadonlyArray<string>
  readonly issue: IIssueHit
}

interface IIssueListProps {
  readonly repository: RepositoryWithGitHubRepository
  readonly dispatcher: Dispatcher
  readonly issuesStore: IssuesStore
}

interface IIssueListState {
  readonly issues: ReadonlyArray<IIssueHit>
  readonly filterText: string
  readonly selectedItem: IIssueListItem | null
  readonly failed: boolean
  readonly isLoading: boolean
  readonly screenReaderStateMessage: string | null
}

function createListItems(
  issues: ReadonlyArray<IIssueHit>
): IFilterListGroup<IIssueListItem> {
  return {
    identifier: 'issues',
    items: issues.map(issue => ({
      id: issue.number.toString(),
      text: [issue.title, `#${issue.number}`],
      issue,
    })),
  }
}

/** Read-only list of open issues for the selected repository. */
export class IssueList extends React.Component<
  IIssueListProps,
  IIssueListState
> {
  private unmounted = false
  private requestId = 0

  public constructor(props: IIssueListProps) {
    super(props)

    this.state = {
      failed: false,
      issues: [],
      filterText: '',
      selectedItem: null,
      isLoading: true,
      screenReaderStateMessage: null,
    }
  }

  public componentDidMount() {
    this.refreshIssues()
  }

  public componentDidUpdate(prevProps: IIssueListProps) {
    if (prevProps.repository.hash !== this.props.repository.hash) {
      this.setState({
        failed: false,
        issues: [],
        selectedItem: null,
        filterText: '',
        isLoading: true,
      })
      this.refreshIssues()
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
    this.requestId++
  }

  private refreshIssues = async () => {
    if (this.unmounted) {
      return
    }

    const requestId = ++this.requestId
    this.setState({
      isLoading: true,
      failed: false,
      screenReaderStateMessage: 'Loading issues',
    })

    const repository = getNonForkGitHubRepository(this.props.repository)
    const isCurrent = () => !this.unmounted && requestId === this.requestId
    try {
      // Show cached content even when the network refresh fails.
      const cached = await this.props.issuesStore.getAllIssuesFor(repository)
      if (!isCurrent()) {
        return
      }
      this.setState({ issues: cached })

      const refreshed = await this.props.dispatcher.refreshIssues(repository)
      if (!refreshed) {
        throw new Error('Unable to refresh issues')
      }
      const issues = await this.props.issuesStore.getAllIssuesFor(repository)
      if (!isCurrent()) {
        return
      }

      const selectedIssueNumber = this.state.selectedItem?.issue.number
      const group = createListItems(issues)
      const selectedItem =
        selectedIssueNumber === undefined
          ? null
          : group.items.find(i => i.issue.number === selectedIssueNumber) ??
            null

      const plural = issues.length === 1 ? '' : 's'
      this.setState({
        issues,
        selectedItem,
        isLoading: false,
        failed: false,
        screenReaderStateMessage: `${issues.length} open issue${plural} found`,
      })
    } catch {
      if (isCurrent()) {
        this.setState({
          isLoading: false,
          failed: true,
          screenReaderStateMessage: 'Unable to refresh issues',
        })
      }
    }
  }

  public render() {
    const group = createListItems(this.state.issues)

    return (
      <>
        {this.state.failed && (
          <div role="alert">
            <p>
              Unable to refresh issues. Previously loaded issues may be out of
              date.
            </p>
            <Button
              onClick={this.refreshIssues}
              disabled={this.state.isLoading}
            >
              Retry
            </Button>
          </div>
        )}
        <SectionFilterList<IIssueListItem>
          className="pull-request-list issue-list"
          rowHeight={RowHeight}
          groups={[group]}
          selectedItem={this.state.selectedItem}
          renderItem={this.renderIssue}
          filterText={this.state.filterText}
          onFilterTextChanged={this.onFilterTextChanged}
          invalidationProps={this.state.issues}
          onItemClick={this.onItemClick}
          onSelectionChanged={this.onSelectionChanged}
          renderGroupHeader={this.renderListHeader}
          renderNoItems={this.renderNoItems}
          renderPostFilter={this.renderPostFilter}
          getGroupAriaLabel={this.getListAriaLabel}
        />
        <AriaLiveContainer message={this.state.screenReaderStateMessage} />
      </>
    )
  }

  private renderIssue = (item: IIssueListItem, matches: IMatches) => {
    const subtitle = `#${item.issue.number}`

    return (
      <div className="pull-request-item issue-item open">
        <div>
          <Octicon className="icon" symbol={octicons.issueOpened} />
        </div>
        <div className="info">
          <TooltippedContent
            tagName="div"
            className="title"
            tooltip={item.issue.title}
            onlyWhenOverflowed={true}
          >
            <HighlightText text={item.issue.title} highlight={matches.title} />
          </TooltippedContent>
          <TooltippedContent
            tagName="div"
            className="subtitle"
            tooltip={subtitle}
            onlyWhenOverflowed={true}
          >
            <HighlightText text={subtitle} highlight={matches.subtitle} />
          </TooltippedContent>
        </div>
      </div>
    )
  }

  private renderNoItems = () => {
    const repository = getNonForkGitHubRepository(this.props.repository)

    let message = this.state.isLoading
      ? 'Loading issues…'
      : this.state.failed
      ? 'Unable to load issues.'
      : this.state.filterText.length > 0
      ? 'No issues match your filter.'
      : 'No open issues.'

    if (!this.state.isLoading && repository.type === 'bitbucket') {
      message = 'Issue browsing is not available for Bitbucket repositories.'
    } else if (!this.state.isLoading && repository.issuesEnabled === false) {
      message = 'Issues are not enabled for this repository.'
    }

    return (
      <div className="no-pull-requests">
        <div className="title">{message}</div>
      </div>
    )
  }

  private renderListHeader = () => (
    <div className="filter-list-group-header">
      Open issues in{' '}
      {getNonForkGitHubRepository(this.props.repository).fullName}
    </div>
  )

  private getListAriaLabel = () =>
    `Open issues in ${
      getNonForkGitHubRepository(this.props.repository).fullName
    }`

  private renderPostFilter = () => {
    const tooltip = 'Refresh the list of issues'

    return (
      <Button
        disabled={this.state.isLoading}
        onClick={this.refreshIssues}
        ariaLabel={tooltip}
        tooltip={tooltip}
      >
        <Octicon
          symbol={syncClockwise}
          className={this.state.isLoading ? 'spin' : undefined}
        />
      </Button>
    )
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onSelectionChanged = (
    selectedItem: IIssueListItem | null,
    _source: SelectionSource
  ) => {
    this.setState({ selectedItem })
  }

  private onItemClick = (item: IIssueListItem) => {
    const repository = getNonForkGitHubRepository(this.props.repository)
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.showPopup({
      type: PopupType.IssueDetail,
      repository,
      issueNumber: item.issue.number,
    })
  }
}
