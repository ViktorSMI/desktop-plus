import * as React from 'react'

import { IssuesStore, IIssueHit } from '../../lib/stores/issues-store'
import { assertNever } from '../../lib/fatal-error'
import {
  RepositoryWithGitHubRepository,
} from '../../models/repository'
import { RepoType } from '../../models/github-repository'
import { FoldoutType } from '../../lib/app-state'
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

function getIssueUrl(
  type: RepoType,
  baseUrl: string,
  issueNumber: number
): string {
  switch (type) {
    case 'github':
      return `${baseUrl}/issues/${issueNumber}`
    case 'gitlab':
      return `${baseUrl}/-/issues/${issueNumber}`
    case 'forgejo':
    case 'gitea':
      return `${baseUrl}/issues/${issueNumber}`
    case 'bitbucket':
      return `${baseUrl}/issues/${issueNumber}`
    default:
      return assertNever(type, `Unknown repository type: ${type}`)
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

    const repository = this.props.repository.gitHubRepository
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
    const repository = this.props.repository.gitHubRepository

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
      Open issues in {this.props.repository.gitHubRepository.fullName}
    </div>
  )

  private getListAriaLabel = () =>
    `Open issues in ${this.props.repository.gitHubRepository.fullName}`

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
    const repository = this.props.repository.gitHubRepository
    if (repository.htmlURL === null) {
      return
    }

    const url = getIssueUrl(
      repository.type,
      repository.htmlURL,
      item.issue.number
    )

    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.openInBrowser(url)
  }
}
