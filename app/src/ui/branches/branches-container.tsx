import * as React from 'react'

import { PullRequest } from '../../models/pull-request'
import {
  Repository,
  isRepositoryWithGitHubRepository,
} from '../../models/repository'
import { Branch, IAheadBehind } from '../../models/branch'
import { BranchesTab } from '../../models/branches-tab'
import { FetchType } from '../../models/fetch'
import { PopupType } from '../../models/popup'
import { ForkedRemotePrefix, IRemote } from '../../models/remote'
import { Account } from '../../models/account'

import { Dispatcher } from '../dispatcher'
import { FoldoutType } from '../../lib/app-state'
import { assertNever } from '../../lib/fatal-error'

import { TabBar } from '../tab-bar'

import { Row } from '../lib/row'
import { Select } from '../lib/select'
import { Octicon, syncClockwise } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

import { BranchList } from './branch-list'
import { PullRequestList } from './pull-request-list'
import { IssueList } from './issue-list'
import { IssuesStore } from '../../lib/stores/issues-store'
import { filterBranchesByRemote, IBranchListItem } from './group-branches'
import { BranchSortOrder } from '../../models/branch-sort-order'
import {
  getDefaultAriaLabelForBranch,
  renderDefaultBranch,
} from './branch-renderer'
import { IMatches } from '../../lib/fuzzy-find'
import { startTimer } from '../lib/timing'
import { dragAndDropManager } from '../../lib/drag-and-drop-manager'
import { DragType, DropTargetType } from '../../models/drag-drop'
import {
  enablePullRequestQuickView,
  enableResizingToolbarButtons,
  enableWorktreeSupport,
} from '../../lib/feature-flag'
import { PullRequestQuickView } from '../pull-request-quick-view'
import { Emoji } from '../../lib/emoji'
import classNames from 'classnames'
import { asHost, parseRemote } from '../../lib/remote-parsing'
import { formatCompactNumber } from '../../lib/format-number'
import {
  clearRemoteAccountLogin,
  getAccountsForRemote,
  getRemoteAccountLogin,
  inferRemoteAccountLogin,
  setRemoteAccountLogin,
} from '../../lib/remote-account-preference'

const AllRemotesValue = '__all_remotes__'
const RemoteSelectionStoragePrefix = 'branches-selected-remote:'

interface IBranchesContainerProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly selectedTab: BranchesTab
  readonly isRemoteOperationBlocked: boolean
  readonly allBranches: ReadonlyArray<Branch>
  readonly defaultBranch: Branch | null
  readonly currentBranch: Branch | null
  readonly recentBranches: ReadonlyArray<Branch>
  readonly pullRequests: ReadonlyArray<PullRequest>
  readonly onRenameBranch: (branchName: string) => void
  readonly onSetAsDefaultBranch: (branchName: string) => void
  readonly onDeleteBranch: (branchName: string) => void
  readonly onDeleteUnusedLocalBranches: () => void
  readonly onCheckoutInNewWorktree?: (branch: Branch) => void

  /** Optional callback to checkout a PR in a new worktree */
  readonly onCheckoutPRInNewWorktree?: (pullRequest: PullRequest) => void
  readonly onPullSingleBranch: (branchName: string) => void

  readonly branchSortOrder: BranchSortOrder

  /** The pull request associated with the current branch. */
  readonly currentPullRequest: PullRequest | null

  /** Are we currently loading pull requests? */
  readonly isLoadingPullRequests: boolean

  /** Map from the emoji shortcut (e.g., :+1:) to the image's local path. */
  readonly emoji: Map<string, Emoji>

  readonly underlineLinks: boolean

  /** Store used to refresh and read cached issues. */
  readonly issuesStore: IssuesStore
}

interface IBranchesContainerState {
  /**
   * A copy of the last seen currentPullRequest property
   * from props. Used in order to be able to detect when
   * the selected PR in props changes in getDerivedStateFromProps
   */
  readonly currentPullRequest: PullRequest | null
  readonly selectedPullRequest: PullRequest | null
  readonly selectedBranch: Branch | null
  readonly branchFilterText: string
  readonly pullRequestBeingViewed: {
    pr: PullRequest
    prListItemTop: number
  } | null
  readonly remotes: ReadonlyArray<IRemote>
  readonly accounts: ReadonlyArray<Account>
  readonly remoteAccountLogins: ReadonlyMap<string, string>
  readonly selectedRemoteName: string | null
  readonly loadingRemotes: boolean
  readonly remoteAheadBehind: IAheadBehind | null
  readonly loadingRemoteAheadBehind: boolean
  readonly remoteOperation: 'fetch' | 'pull' | 'push' | 'force-push' | null
}

/** The unified Branches and Pull Requests component. */
export class BranchesContainer extends React.Component<
  IBranchesContainerProps,
  IBranchesContainerState
> {
  public static getDerivedStateFromProps(
    props: IBranchesContainerProps,
    state: IBranchesContainerProps
  ): Partial<IBranchesContainerState> | null {
    if (state.currentPullRequest !== props.currentPullRequest) {
      return {
        currentPullRequest: props.currentPullRequest,
        selectedPullRequest: props.currentPullRequest,
      }
    }

    return null
  }

  private pullRequestQuickViewTimerId: number | null = null
  private unmounted = false
  private remoteAheadBehindRequestId = 0

  public constructor(props: IBranchesContainerProps) {
    super(props)

    this.state = {
      selectedBranch: props.currentBranch,
      selectedPullRequest: props.currentPullRequest,
      currentPullRequest: props.currentPullRequest,
      branchFilterText: '',
      pullRequestBeingViewed: null,
      remotes: [],
      accounts: [],
      remoteAccountLogins: new Map(),
      selectedRemoteName: null,
      loadingRemotes: true,
      remoteAheadBehind: null,
      loadingRemoteAheadBehind: false,
      remoteOperation: null,
    }
  }

  public componentDidMount() {
    this.unmounted = false
    this.loadRemotes()
  }

  public componentDidUpdate(prevProps: IBranchesContainerProps) {
    if (prevProps.repository.path !== this.props.repository.path) {
      this.setState({
        remotes: [],
        accounts: [],
        remoteAccountLogins: new Map(),
        selectedRemoteName: null,
        loadingRemotes: true,
        remoteAheadBehind: null,
        loadingRemoteAheadBehind: false,
        remoteOperation: null,
      })
      this.loadRemotes()
      return
    }

    if (
      prevProps.currentBranch?.ref !== this.props.currentBranch?.ref ||
      prevProps.currentBranch?.tip.sha !== this.props.currentBranch?.tip.sha ||
      prevProps.allBranches !== this.props.allBranches
    ) {
      this.loadRemoteAheadBehind()
    }
  }

  public componentWillUnmount = () => {
    this.unmounted = true
    this.clearPullRequestQuickViewTimer()
  }

  public render() {
    const classes = classNames('branches-container', {
      resizable: enableResizingToolbarButtons(),
    })
    return (
      <div className={classes}>
        {this.renderTabBar()}
        {this.renderSelectedTab()}
        {this.renderMergeButtonRow()}
        {this.renderPullRequestQuickView()}
      </div>
    )
  }

  private get remoteSelectionStorageKey() {
    return `${RemoteSelectionStoragePrefix}${this.props.repository.path}`
  }

  private resolveSelectedRemoteName(remotes: ReadonlyArray<IRemote>) {
    if (remotes.length < 2) {
      return null
    }

    const stored = localStorage.getItem(this.remoteSelectionStorageKey)
    if (stored === AllRemotesValue) {
      return null
    }

    if (stored !== null && remotes.some(remote => remote.name === stored)) {
      return stored
    }

    const trackingRemoteName = this.props.currentBranch?.upstreamRemoteName
    if (
      trackingRemoteName !== null &&
      trackingRemoteName !== undefined &&
      remotes.some(remote => remote.name === trackingRemoteName)
    ) {
      return trackingRemoteName
    }

    if (remotes.some(remote => remote.name === 'origin')) {
      return 'origin'
    }

    return remotes[0]?.name ?? null
  }

  private loadRemotes = async () => {
    const repositoryPath = this.props.repository.path

    try {
      const [remotes, accounts] = await Promise.all([
        this.props.dispatcher.getRemotes(this.props.repository),
        Promise.resolve(this.props.dispatcher.getAccounts()),
      ])

      if (this.unmounted || repositoryPath !== this.props.repository.path) {
        return
      }

      const remoteAccountLogins = new Map<string, string>()
      for (const remote of remotes) {
        const candidates = getAccountsForRemote(accounts, remote)
        const stored = getRemoteAccountLogin(repositoryPath, remote.name)

        if (
          stored !== null &&
          candidates.some(account => account.login === stored)
        ) {
          remoteAccountLogins.set(remote.name, stored)
          continue
        }

        if (stored !== null) {
          clearRemoteAccountLogin(repositoryPath, remote.name)
        }

        const inferred = inferRemoteAccountLogin(
          accounts,
          remote,
          this.props.repository.login
        )
        if (inferred !== null) {
          setRemoteAccountLogin(repositoryPath, remote.name, inferred)
          remoteAccountLogins.set(remote.name, inferred)
        }
      }

      this.setState(
        {
          remotes,
          accounts,
          remoteAccountLogins,
          selectedRemoteName: this.resolveSelectedRemoteName(remotes),
          loadingRemotes: false,
        },
        this.loadRemoteAheadBehind
      )
    } catch (error) {
      if (!this.unmounted) {
        this.setState({
          remotes: [],
          accounts: [],
          remoteAccountLogins: new Map(),
          selectedRemoteName: null,
          loadingRemotes: false,
          remoteAheadBehind: null,
          loadingRemoteAheadBehind: false,
        })
      }
      await this.props.dispatcher.postError(error)
    }
  }

  private get selectedRemote(): IRemote | null {
    const selectedRemoteName = this.state.selectedRemoteName
    if (selectedRemoteName === null) {
      return null
    }

    return (
      this.state.remotes.find(remote => remote.name === selectedRemoteName) ??
      null
    )
  }

  private get visibleBranches() {
    return filterBranchesByRemote(
      this.props.allBranches,
      this.state.selectedRemoteName
    )
  }

  private get visibleRecentBranches() {
    if (this.state.selectedRemoteName === null) {
      return this.props.recentBranches
    }

    const visibleRefs = new Set(this.visibleBranches.map(branch => branch.ref))
    return this.props.recentBranches.filter(branch =>
      visibleRefs.has(branch.ref)
    )
  }

  private get visibleDefaultBranch() {
    const defaultBranch = this.props.defaultBranch
    const selectedRemoteName = this.state.selectedRemoteName

    if (
      defaultBranch === null ||
      selectedRemoteName === null ||
      defaultBranch.remoteName === null ||
      defaultBranch.remoteName === selectedRemoteName
    ) {
      return defaultBranch
    }

    return (
      this.visibleBranches.find(
        branch =>
          branch.nameWithoutRemote === defaultBranch.nameWithoutRemote &&
          (branch.remoteName === null ||
            branch.remoteName === selectedRemoteName)
      ) ?? null
    )
  }

  private getRemoteHost(remote: IRemote) {
    const parsed = parseRemote(remote.url)
    return parsed === null ? 'Custom remote' : asHost(parsed)
  }

  private getRemoteBranchCount(remoteName: string) {
    return this.props.allBranches.filter(
      branch =>
        !branch.isDesktopForkRemoteBranch && branch.remoteName === remoteName
    ).length
  }

  private remoteHasCurrentBranch(remote: IRemote) {
    const branchName = this.props.currentBranch?.nameWithoutRemote
    if (branchName === undefined) {
      return false
    }

    return this.props.allBranches.some(
      branch =>
        branch.remoteName === remote.name &&
        branch.nameWithoutRemote === branchName
    )
  }

  private loadRemoteAheadBehind = async () => {
    const requestId = ++this.remoteAheadBehindRequestId
    const remote = this.selectedRemote
    const branch = this.props.currentBranch

    if (
      remote === null ||
      branch === null ||
      !this.remoteHasCurrentBranch(remote)
    ) {
      this.setState({
        remoteAheadBehind: null,
        loadingRemoteAheadBehind: false,
      })
      return
    }

    this.setState({ loadingRemoteAheadBehind: true })

    try {
      const remoteAheadBehind =
        await this.props.dispatcher.getRemoteAheadBehind(
          this.props.repository,
          remote,
          branch.nameWithoutRemote
        )

      if (this.unmounted || requestId !== this.remoteAheadBehindRequestId) {
        return
      }

      this.setState({
        remoteAheadBehind,
        loadingRemoteAheadBehind: false,
      })
    } catch (error) {
      if (this.unmounted || requestId !== this.remoteAheadBehindRequestId) {
        return
      }

      log.warn(
        `Unable to compare ${branch.nameWithoutRemote} with ${remote.name}/${branch.nameWithoutRemote}`,
        error
      )
      this.setState({
        remoteAheadBehind: null,
        loadingRemoteAheadBehind: false,
      })
    }
  }

  private renderRemoteAheadBehind() {
    const aheadBehind = this.state.remoteAheadBehind
    if (this.state.loadingRemoteAheadBehind) {
      return <span className="remote-ahead-behind loading">Comparing…</span>
    }

    if (aheadBehind === null) {
      return null
    }

    if (aheadBehind.ahead === 0 && aheadBehind.behind === 0) {
      return <span className="remote-ahead-behind">Up to date</span>
    }

    return (
      <span className="remote-ahead-behind">
        {aheadBehind.ahead > 0 && (
          <span>
            {formatCompactNumber(aheadBehind.ahead)}
            <Octicon symbol={octicons.arrowUp} />
            <span className="remote-ahead-behind-label">to push</span>
          </span>
        )}
        {aheadBehind.behind > 0 && (
          <span>
            {formatCompactNumber(aheadBehind.behind)}
            <Octicon symbol={octicons.arrowDown} />
            <span className="remote-ahead-behind-label">to pull</span>
          </span>
        )}
      </span>
    )
  }

  private get userRemotes() {
    return this.state.remotes.filter(
      remote => !remote.name.startsWith(ForkedRemotePrefix)
    )
  }

  private get syncRemotesEnabled() {
    return this.props.repository.workflowPreferences.syncRemotes === true
  }

  private get selectedRemoteAccounts(): ReadonlyArray<Account> {
    const remote = this.selectedRemote
    return remote === null
      ? []
      : getAccountsForRemote(this.state.accounts, remote)
  }

  private get selectedRemoteAccountLogin(): string | null {
    const remote = this.selectedRemote
    return remote === null
      ? null
      : this.state.remoteAccountLogins.get(remote.name) ?? null
  }

  private renderRemoteSwitcher = () => {
    if (this.state.loadingRemotes || this.state.remotes.length < 2) {
      return null
    }

    const selectedRemote = this.selectedRemote
    const selectedRemoteName = this.state.selectedRemoteName
    const currentBranchName = this.props.currentBranch?.nameWithoutRemote
    const isBusy =
      this.state.remoteOperation !== null || this.props.isRemoteOperationBlocked
    const hasRemoteBranch =
      selectedRemote !== null && this.remoteHasCurrentBranch(selectedRemote)
    const fetchLabel =
      selectedRemote === null ? 'Fetch all' : `Fetch ${selectedRemote.name}`
    const remoteAccounts = this.selectedRemoteAccounts
    const accountSelectionRequired =
      selectedRemote !== null &&
      remoteAccounts.length > 1 &&
      this.selectedRemoteAccountLogin === null
    const operationDisabled = isBusy || accountSelectionRequired

    return (
      <div className="remote-switcher">
        <div className="remote-switcher-row">
          <Octicon className="remote-switcher-icon" symbol={octicons.server} />
          <Select
            label="Remote"
            className="remote-switcher-select"
            value={selectedRemoteName ?? AllRemotesValue}
            onChange={this.onRemoteSelectionChanged}
            disabled={isBusy}
          >
            <option value={AllRemotesValue}>All remotes</option>
            {this.state.remotes.map(remote => (
              <option value={remote.name} key={remote.name}>
                {remote.name} — {this.getRemoteHost(remote)}
              </option>
            ))}
          </Select>
        </div>

        {selectedRemote !== null && remoteAccounts.length > 0 && (
          <div className="remote-account-row">
            <Octicon
              className="remote-switcher-icon"
              symbol={octicons.person}
            />
            <Select
              label="Account"
              className="remote-switcher-select"
              value={this.selectedRemoteAccountLogin ?? ''}
              onChange={this.onRemoteAccountChanged}
              disabled={isBusy}
            >
              {remoteAccounts.length > 1 && (
                <option value="">Choose account…</option>
              )}
              {remoteAccounts.map(account => (
                <option value={account.login} key={account.login}>
                  @{account.login} — {account.friendlyEndpoint}
                </option>
              ))}
            </Select>
          </div>
        )}

        {this.userRemotes.length === 2 && (
          <div className="remote-sync-preference">
            <Checkbox
              value={
                this.syncRemotesEnabled ? CheckboxValue.On : CheckboxValue.Off
              }
              onChange={this.onSyncRemotesChanged}
              disabled={isBusy}
              label={`Sync ${this.userRemotes[0].name} ↔ ${this.userRemotes[1].name} with toolbar`}
            />
          </div>
        )}

        <div className="remote-switcher-meta">
          <span className="remote-switcher-description">
            {selectedRemote === null
              ? `${this.state.remotes.length} remotes`
              : currentBranchName === undefined
              ? `${this.getRemoteBranchCount(
                  selectedRemote.name
                )} remote branches · ${this.getRemoteHost(selectedRemote)}`
              : hasRemoteBranch
              ? `${currentBranchName} ↔ ${selectedRemote.name}/${currentBranchName}`
              : `${currentBranchName} → new ${selectedRemote.name}/${currentBranchName}`}
          </span>

          {selectedRemote !== null &&
            currentBranchName !== undefined &&
            hasRemoteBranch &&
            this.renderRemoteAheadBehind()}

          <div className="remote-switcher-actions">
            <Button
              className="remote-action-button button-with-icon"
              onClick={this.onFetchSelectedRemote}
              disabled={operationDisabled}
              tooltip={
                accountSelectionRequired
                  ? 'Choose an account for this remote first'
                  : fetchLabel
              }
            >
              <Octicon
                symbol={syncClockwise}
                className={classNames('mr', {
                  spin: this.state.remoteOperation === 'fetch',
                })}
              />
              Fetch
            </Button>

            {selectedRemote !== null && (
              <>
                <Button
                  className="remote-action-button"
                  onClick={this.onPullSelectedRemote}
                  disabled={
                    operationDisabled ||
                    currentBranchName === undefined ||
                    !hasRemoteBranch
                  }
                  tooltip={
                    hasRemoteBranch && currentBranchName !== undefined
                      ? `Pull ${selectedRemote.name}/${currentBranchName} into ${currentBranchName}`
                      : `${selectedRemote.name} has no ${
                          currentBranchName ?? 'current'
                        } branch to pull`
                  }
                >
                  Pull
                </Button>
                <Button
                  className="remote-action-button"
                  onClick={this.onPushSelectedRemote}
                  disabled={
                    operationDisabled || currentBranchName === undefined
                  }
                  tooltip={
                    currentBranchName === undefined
                      ? 'Check out a local branch before pushing'
                      : `Push ${currentBranchName} to ${selectedRemote.name}/${currentBranchName} without changing upstream`
                  }
                >
                  Push
                </Button>
              </>
            )}

            <Button
              className="remote-manage-button"
              onClick={this.onManageRemotes}
              disabled={isBusy}
              tooltip="Manage remotes"
              ariaLabel="Manage remotes"
            >
              <Octicon symbol={octicons.gear} />
            </Button>
          </div>
        </div>
        {selectedRemote !== null && currentBranchName !== undefined && (
          <div className="remote-force-push-row">
            <Button
              className="destructive"
              onClick={this.onForcePushSelectedRemote}
              disabled={operationDisabled || !hasRemoteBranch}
              tooltip={
                hasRemoteBranch
                  ? `Replace history on ${selectedRemote.name}/${currentBranchName} with a checked lease`
                  : `Fetch ${selectedRemote.name} first. Use Push to create a new remote branch.`
              }
            >
              Force push…
            </Button>
          </div>
        )}
      </div>
    )
  }

  private onSyncRemotesChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.props.dispatcher.updateRepositoryWorkflowPreferences(
      this.props.repository,
      {
        ...this.props.repository.workflowPreferences,
        syncRemotes: event.currentTarget.checked,
      }
    )
  }

  private onRemoteAccountChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const remote = this.selectedRemote
    if (remote === null) {
      return
    }

    const login = event.currentTarget.value
    const remoteAccountLogins = new Map(this.state.remoteAccountLogins)

    if (login.length === 0) {
      clearRemoteAccountLogin(this.props.repository.path, remote.name)
      remoteAccountLogins.delete(remote.name)
    } else {
      setRemoteAccountLogin(this.props.repository.path, remote.name, login)
      remoteAccountLogins.set(remote.name, login)
    }

    this.setState({ remoteAccountLogins })
  }

  private onRemoteSelectionChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const value = event.currentTarget.value
    const selectedRemoteName = value === AllRemotesValue ? null : value

    localStorage.setItem(
      this.remoteSelectionStorageKey,
      selectedRemoteName ?? AllRemotesValue
    )

    this.setState(
      {
        selectedRemoteName,
        selectedBranch: this.props.currentBranch,
        remoteAheadBehind: null,
      },
      this.loadRemoteAheadBehind
    )
  }

  private runRemoteOperation = async (
    operation: 'fetch' | 'pull' | 'push' | 'force-push',
    action: () => Promise<void>
  ) => {
    this.setState({ remoteOperation: operation })

    try {
      await action()
    } catch (error) {
      await this.props.dispatcher.postError(error)
    } finally {
      if (!this.unmounted) {
        this.setState({ remoteOperation: null }, this.loadRemoteAheadBehind)
      }
    }
  }

  private onFetchSelectedRemote = () => {
    return this.runRemoteOperation('fetch', async () => {
      const selectedRemote = this.selectedRemote
      if (selectedRemote === null) {
        await this.props.dispatcher.fetch(
          this.props.repository,
          FetchType.UserInitiatedTask
        )
      } else {
        await this.props.dispatcher.fetchRemote(
          this.props.repository,
          selectedRemote,
          FetchType.UserInitiatedTask
        )
      }
    })
  }

  private onPullSelectedRemote = () => {
    const selectedRemote = this.selectedRemote
    if (selectedRemote === null) {
      return
    }

    return this.runRemoteOperation('pull', () =>
      this.props.dispatcher.pullFromRemote(
        this.props.repository,
        selectedRemote
      )
    )
  }

  private onPushSelectedRemote = () => {
    const selectedRemote = this.selectedRemote
    if (selectedRemote === null) {
      return
    }

    return this.runRemoteOperation('push', () =>
      this.props.dispatcher.pushToRemote(this.props.repository, selectedRemote)
    )
  }

  private onForcePushSelectedRemote = () => {
    const remote = this.selectedRemote
    if (remote === null || this.props.isRemoteOperationBlocked) {
      return
    }
    const repository = this.props.repository
    return this.runRemoteOperation('force-push', () =>
      this.props.dispatcher.confirmForcePushToRemote(repository, remote)
    )
  }

  private onManageRemotes = () => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.showPopup({
      type: PopupType.ManageRemotes,
      repository: this.props.repository,
    })
  }

  private renderPullRequestQuickView = (): JSX.Element | null => {
    if (
      !enablePullRequestQuickView() ||
      this.state.pullRequestBeingViewed === null
    ) {
      return null
    }

    const { pr, prListItemTop } = this.state.pullRequestBeingViewed

    return (
      <PullRequestQuickView
        dispatcher={this.props.dispatcher}
        emoji={this.props.emoji}
        pullRequest={pr}
        pullRequestItemTop={prListItemTop}
        onMouseEnter={this.onMouseEnterPullRequestQuickView}
        onMouseLeave={this.onMouseLeavePullRequestQuickView}
        underlineLinks={this.props.underlineLinks}
      />
    )
  }

  private onMouseEnterPullRequestQuickView = () => {
    this.clearPullRequestQuickViewTimer()
  }

  private onMouseLeavePullRequestQuickView = () => {
    this.setState({
      pullRequestBeingViewed: null,
    })
    this.clearPullRequestQuickViewTimer()
  }

  private renderMergeButtonRow() {
    const { currentBranch } = this.props

    // This could happen if HEAD is detached, in that
    // case it's better to not render anything at all.
    if (currentBranch === null) {
      return null
    }

    return (
      <Row className="merge-button-row">
        <Button
          className="merge-button button-with-icon"
          onClick={this.onMergeClick}
          tooltip={`Choose a branch to merge into ${currentBranch.name}`}
        >
          <Octicon className="icon" symbol={octicons.gitMerge} />
          <span>Choose a branch to merge into</span>
          <strong>{currentBranch.name}</strong>
        </Button>
      </Row>
    )
  }

  private renderOpenPullRequestsBubble() {
    const pullRequests = this.props.pullRequests

    if (pullRequests.length > 0) {
      return <span className="count">{pullRequests.length}</span>
    }

    return null
  }

  private renderTabBar() {
    if (!this.props.repository.gitHubRepository) {
      return null
    }

    return (
      <TabBar
        onTabClicked={this.onTabClicked}
        selectedIndex={this.props.selectedTab}
        allowDragOverSwitching={true}
      >
        <span id="branches-tab">Branches</span>
        <span id="pull-requests-tab" className="pull-request-tab">
          {__DARWIN__ ? 'Pull Requests' : 'Pull requests'}
          {this.renderOpenPullRequestsBubble()}
        </span>
        <span id="issues-tab">Issues</span>
      </TabBar>
    )
  }

  private renderBranch = (item: IBranchListItem, matches: IMatches) => {
    return renderDefaultBranch(
      item,
      matches,
      this.props.currentBranch,
      this.onDropOntoBranch,
      this.onDropOntoCurrentBranch
    )
  }

  private getBranchAriaLabel = (item: IBranchListItem): string => {
    return getDefaultAriaLabelForBranch(item)
  }

  private renderSelectedTab() {
    const { selectedTab, repository } = this.props

    let ariaLabelledBy = 'branches-tab'
    if (repository.gitHubRepository) {
      switch (selectedTab) {
        case BranchesTab.Branches:
          ariaLabelledBy = 'branches-tab'
          break
        case BranchesTab.PullRequests:
          ariaLabelledBy = 'pull-requests-tab'
          break
        case BranchesTab.Issues:
          ariaLabelledBy = 'issues-tab'
          break
        default:
          assertNever(selectedTab, `Unknown Branches tab: ${selectedTab}`)
      }
    }

    return (
      <div
        role="tabpanel"
        aria-labelledby={ariaLabelledBy}
        className="branches-container-panel"
      >
        {this.renderSelectedTabContent()}
      </div>
    )
  }

  private renderSelectedTabContent() {
    let tab = this.props.selectedTab

    if (!this.props.repository.gitHubRepository) {
      tab = BranchesTab.Branches
    }

    switch (tab) {
      case BranchesTab.Branches:
        return (
          <div className="branches-tab-content">
            {this.renderRemoteSwitcher()}
            <BranchList
              repository={this.props.repository}
              defaultBranch={this.visibleDefaultBranch}
              currentBranch={this.props.currentBranch}
              allBranches={this.visibleBranches}
              recentBranches={this.visibleRecentBranches}
              branchSortOrder={this.props.branchSortOrder}
              onItemClick={this.onBranchItemClick}
              filterText={this.state.branchFilterText}
              onFilterTextChanged={this.onBranchFilterTextChanged}
              selectedBranch={this.state.selectedBranch}
              onSelectionChanged={this.onBranchSelectionChanged}
              canCreateNewBranch={true}
              onCreateNewBranch={this.onCreateBranchWithName}
              renderBranch={this.renderBranch}
              getBranchAriaLabel={this.getBranchAriaLabel}
              hideFilterRow={dragAndDropManager.isDragOfTypeInProgress(
                DragType.Commit
              )}
              renderPreList={this.renderPreList}
              onRenameBranch={this.props.onRenameBranch}
              onSetAsDefaultBranch={this.props.onSetAsDefaultBranch}
              onDuplicateBranch={this.onDuplicateBranch}
              onDeleteBranch={this.props.onDeleteBranch}
              onDeleteUnusedLocalBranches={
                this.props.onDeleteUnusedLocalBranches
              }
              onPullSingleBranch={this.props.onPullSingleBranch}
              onCheckoutInNewWorktree={
                enableWorktreeSupport()
                  ? this.props.onCheckoutInNewWorktree
                  : undefined
              }
            />
          </div>
        )
      case BranchesTab.PullRequests: {
        return this.renderPullRequests()
      }
      case BranchesTab.Issues: {
        return this.renderIssues()
      }
      default:
        return assertNever(tab, `Unknown Branches tab: ${tab}`)
    }
  }

  private renderPreList = () => {
    if (!dragAndDropManager.isDragOfTypeInProgress(DragType.Commit)) {
      return null
    }

    const label = __DARWIN__ ? 'New Branch' : 'New branch'

    return (
      /**
       * This a11y linter is a false-positive as the element is a drop target
       * facilitating our drag and drop functionality for cherry-picking.
       */
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div
        className="branches-list-item new-branch-drop"
        onMouseEnter={this.onMouseEnterNewBranchDrop}
        onMouseLeave={this.onMouseLeaveNewBranchDrop}
        onMouseUp={this.onMouseUpNewBranchDrop}
      >
        <Octicon className="icon" symbol={octicons.plus} />
        <div className="name">{label}</div>
      </div>
    )
  }

  private onMouseUpNewBranchDrop = async () => {
    const { dragData } = dragAndDropManager
    if (dragData === null || dragData.type !== DragType.Commit) {
      return
    }

    const { dispatcher, repository, currentBranch } = this.props

    await dispatcher.setCherryPickCreateBranchFlowStep(
      repository,
      '',
      dragData.commits,
      currentBranch
    )

    this.props.dispatcher.showPopup({
      type: PopupType.MultiCommitOperation,
      repository,
    })
  }

  private onMouseEnterNewBranchDrop = () => {
    // This is just used for displaying on windows drag ghost.
    // Thus, it doesn't have to be an actual branch name.
    dragAndDropManager.emitEnterDropTarget({
      type: DropTargetType.Branch,
      branchName: 'a new branch',
    })
  }

  private onMouseLeaveNewBranchDrop = () => {
    dragAndDropManager.emitLeaveDropTarget()
  }

  private renderPullRequests() {
    const repository = this.props.repository
    if (!isRepositoryWithGitHubRepository(repository)) {
      return null
    }

    const isOnDefaultBranch =
      this.props.defaultBranch &&
      this.props.currentBranch &&
      this.props.defaultBranch.name === this.props.currentBranch.name

    return (
      <PullRequestList
        key="pr-list"
        pullRequests={this.props.pullRequests}
        selectedPullRequest={this.state.selectedPullRequest}
        isOnDefaultBranch={!!isOnDefaultBranch}
        onSelectionChanged={this.onPullRequestSelectionChanged}
        onCreateBranch={this.onCreateBranch}
        dispatcher={this.props.dispatcher}
        repository={repository}
        isLoadingPullRequests={this.props.isLoadingPullRequests}
        onMouseEnterPullRequest={this.onMouseEnterPullRequestListItem}
        onMouseLeavePullRequest={this.onMouseLeavePullRequestListItem}
        onCheckoutInNewWorktree={
          enableWorktreeSupport()
            ? this.props.onCheckoutPRInNewWorktree
            : undefined
        }
      />
    )
  }

  private renderIssues() {
    const repository = this.props.repository
    if (!isRepositoryWithGitHubRepository(repository)) {
      return null
    }

    return (
      <IssueList
        key="issue-list"
        repository={repository}
        dispatcher={this.props.dispatcher}
        issuesStore={this.props.issuesStore}
      />
    )
  }

  private onMouseEnterPullRequestListItem = (
    pr: PullRequest,
    prListItemTop: number
  ) => {
    this.clearPullRequestQuickViewTimer()
    this.setState({ pullRequestBeingViewed: null })
    this.pullRequestQuickViewTimerId = window.setTimeout(
      () => this.setState({ pullRequestBeingViewed: { pr, prListItemTop } }),
      250
    )
  }

  private onMouseLeavePullRequestListItem = async () => {
    this.clearPullRequestQuickViewTimer()
    this.pullRequestQuickViewTimerId = window.setTimeout(
      () => this.setState({ pullRequestBeingViewed: null }),
      500
    )
  }

  private onTabClicked = (tab: BranchesTab) => {
    this.props.dispatcher.changeBranchesTab(tab)
  }

  private onMergeClick = () => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    this.props.dispatcher.startMergeBranchOperation(this.props.repository)
  }

  private onBranchItemClick = (branch: Branch) => {
    const { repository, dispatcher } = this.props
    dispatcher.closeFoldout(FoldoutType.Branch)

    const timer = startTimer('checkout branch from list', repository)
    dispatcher.checkoutBranch(repository, branch).then(() => timer.done())
  }

  private onBranchSelectionChanged = (selectedBranch: Branch | null) => {
    this.setState({ selectedBranch })
  }

  private onBranchFilterTextChanged = (text: string) => {
    this.setState({ branchFilterText: text })
  }

  private onCreateBranchWithName = (name: string) => {
    const { repository, dispatcher } = this.props

    dispatcher.closeFoldout(FoldoutType.Branch)
    dispatcher.showPopup({
      type: PopupType.CreateBranch,
      repository,
      initialName: name,
    })
  }

  private onCreateBranch = () => {
    this.onCreateBranchWithName('')
  }

  private onDuplicateBranch = (branch: Branch) => {
    const { repository, dispatcher } = this.props

    dispatcher.closeFoldout(FoldoutType.Branch)
    dispatcher.showPopup({
      type: PopupType.CreateBranch,
      repository,
      baseBranch: branch,
    })
  }

  private onPullRequestSelectionChanged = (
    selectedPullRequest: PullRequest | null
  ) => {
    this.setState({ selectedPullRequest })
  }

  /**
   * Method is to handle when something is dragged and dropped onto a branch
   * in the branch dropdown.
   *
   * Currently this is being implemented with cherry picking. But, this could be
   * expanded if we ever dropped something else on a branch; in which case,
   * we would likely have to check the app state to see what action is being
   * performed. As this branch container is not being used anywhere except
   * for the branch dropdown, we are not going to pass the repository state down
   * during this implementation.
   */
  private onDropOntoBranch = (branchName: string) => {
    const branch = this.props.allBranches.find(b => b.name === branchName)
    if (branch === undefined) {
      log.warn(
        '[branches-container] - Branch name of branch dropped on does not exist.'
      )
      return
    }

    if (dragAndDropManager.isDragOfType(DragType.Commit)) {
      this.props.dispatcher.startCherryPickWithBranch(
        this.props.repository,
        branch
      )
    }
  }

  private onDropOntoCurrentBranch = () => {
    const { currentBranch } = this.props
    if (dragAndDropManager.isDragOfType(DragType.Commit) && currentBranch) {
      this.props.dispatcher.startCherryPickWithBranch(
        this.props.repository,
        currentBranch
      )
    }
  }

  private clearPullRequestQuickViewTimer = () => {
    if (this.pullRequestQuickViewTimerId === null) {
      return
    }

    window.clearTimeout(this.pullRequestQuickViewTimerId)
    this.pullRequestQuickViewTimerId = null
  }
}
