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
import { IAPIIssueDetails } from '../../lib/api'
import { Emoji } from '../../lib/emoji'
import { IssueDetail } from './issue-detail'

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
  readonly emoji: Map<string, Emoji>
  readonly underlineLinks: boolean
}

interface IIssueListState {
  readonly issues: ReadonlyArray<IIssueHit>
  readonly filterText: string
  readonly selectedItem: IIssueListItem | null
  readonly isLoading: boolean
  readonly screenReaderStateMessage: string | null
  readonly openedIssue: IIssueHit | null
  readonly issueDetails: IAPIIssueDetails | null
  readonly isLoadingDetails: boolean
  readonly issueDetailsError: boolean
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

  public constructor(props: IIssueListProps) {
    super(props)

    this.state = {
      issues: [],
      filterText: '',
      selectedItem: null,
      isLoading: true,
      screenReaderStateMessage: null,
      openedIssue: null,
      issueDetails: null,
      isLoadingDetails: false,
      issueDetailsError: false,
    }
  }

  public componentDidMount() {
    this.refreshIssues()
  }

  public componentDidUpdate(prevProps: IIssueListProps) {
    if (prevProps.repository.hash !== this.props.repository.hash) {
      this.setState({
        issues: [],
        selectedItem: null,
        filterText: '',
        isLoading: true,
        openedIssue: null,
        issueDetails: null,
        isLoadingDetails: false,
        issueDetailsError: false,
      })
      this.refreshIssues()
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
  }

  private refreshIssues = async () => {
    if (this.unmounted) {
      return
    }

    this.setState({
      isLoading: true,
      screenReaderStateMessage: 'Loading issues',
    })

    const repository = getNonForkGitHubRepository(this.props.repository)
    await this.props.dispatcher.refreshIssues(repository)

    const issues = await this.props.issuesStore.getAllIssuesFor(repository)
    if (this.unmounted) {
      return
    }

    const selectedIssueNumber = this.state.selectedItem?.issue.number
    const group = createListItems(issues)
    const selectedItem =
      selectedIssueNumber === undefined
        ? null
        : group.items.find(i => i.issue.number === selectedIssueNumber) ?? null

    const plural = issues.length === 1 ? '' : 's'
    this.setState({
      issues,
      selectedItem,
      isLoading: false,
      screenReaderStateMessage: `${issues.length} open issue${plural} found`,
    })
  }

  public render() {
    if (this.state.openedIssue !== null) {
      return this.renderOpenedIssue()
    }

    const group = createListItems(this.state.issues)

    return (
      <>
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

  private renderOpenedIssue = () => {
    const openedIssue = this.state.openedIssue
    const repository = getNonForkGitHubRepository(this.props.repository)

    if (openedIssue === null) {
      return null
    }

    if (this.state.isLoadingDetails) {
      return (
        <div className="issue-detail-state">
          <Octicon symbol={syncClockwise} className="spin" />
          <div>Loading #{openedIssue.number}…</div>
          <Button onClick={this.closeIssue}>Back to issues</Button>
        </div>
      )
    }

    if (this.state.issueDetailsError || this.state.issueDetails === null) {
      return (
        <div className="issue-detail-state">
          <div>Unable to load issue #{openedIssue.number}.</div>
          <Button onClick={this.retryOpenedIssue}>Retry</Button>
          <Button onClick={this.closeIssue}>Back to issues</Button>
        </div>
      )
    }

    return (
      <IssueDetail
        repository={repository}
        details={this.state.issueDetails}
        dispatcher={this.props.dispatcher}
        emoji={this.props.emoji}
        underlineLinks={this.props.underlineLinks}
        onBack={this.closeIssue}
      />
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
            <HighlightText
              text={item.issue.title}
              highlight={matches.title}
            />
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
      Open issues in {getNonForkGitHubRepository(this.props.repository).fullName}
    </div>
  )

  private getListAriaLabel = () =>
    `Open issues in ${getNonForkGitHubRepository(this.props.repository).fullName}`

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
    this.openIssue(item.issue)
  }

  private openIssue = async (issue: IIssueHit) => {
    const repository = getNonForkGitHubRepository(this.props.repository)

    this.setState({
      openedIssue: issue,
      issueDetails: null,
      isLoadingDetails: true,
      issueDetailsError: false,
    })

    const details = await this.props.dispatcher.fetchIssueDetails(
      repository,
      issue.number
    )

    if (this.unmounted || this.state.openedIssue?.number !== issue.number) {
      return
    }

    this.setState({
      issueDetails: details,
      isLoadingDetails: false,
      issueDetailsError: details === null,
    })
  }

  private retryOpenedIssue = () => {
    if (this.state.openedIssue !== null) {
      this.openIssue(this.state.openedIssue)
    }
  }

  private closeIssue = () => {
    this.setState({
      openedIssue: null,
      issueDetails: null,
      isLoadingDetails: false,
      issueDetailsError: false,
    })
  }
}
