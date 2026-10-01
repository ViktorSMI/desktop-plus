import * as React from 'react'
import { Account } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import { actionsTargetKey } from '../../lib/actions-client'
import {
  CommitActionsClient,
  commitActionsTarget,
} from '../../lib/commit-actions-client'
import { ICommitActionsSummary } from '../../lib/commit-actions'
import { CommitActionsPool } from '../../lib/stores/commit-actions-pool'
import { TooltippedContent } from '../lib/tooltipped-content'

type Listener = (value: ICommitActionsSummary | undefined) => void
export type CommitActionsSubscribe = (listener: Listener) => () => void

// The cache belongs to the account/repository, not to a virtual row or a layout.
// Credentials remain inside the existing account/client, never in cache keys.
const statusPool = new CommitActionsPool((account: Account, target, sha) => {
  const client = new CommitActionsClient(
    account.endpoint,
    account.token,
    account.login
  )
  return client.forCommit(account, target, sha)
})

interface IBadgeProps {
  readonly value: ICommitActionsSummary
  readonly repositoryName: string
}

/** Shape and accessible label supplement color, including on selected rows. */
export function CommitActionsStatusBadge({
  value,
  repositoryName,
}: IBadgeProps) {
  if (value.state === 'none') {
    return null
  }
  const color =
    value.state === 'failure'
      ? '#d1242f'
      : value.state === 'pending'
      ? '#d97706'
      : value.state === 'success'
      ? '#1a7f37'
      : '#6e7781'
  const label = `${repositoryName}: ${value.description}`
  return (
    <TooltippedContent tagName="span" tooltip={label}>
      <svg
        className={`commit-actions-status-icon status-${value.state}`}
        width="16"
        height="16"
        viewBox="0 0 16 16"
        role="img"
        aria-label={label}
        style={{ display: 'block', flexShrink: 0 }}
      >
        <circle
          cx="8"
          cy="8"
          r="7"
          fill={color}
          stroke="white"
          strokeWidth="1"
        />
        {value.state === 'success' ? (
          <path
            d="M4.5 8l2.2 2.2 4.8-4.8"
            fill="none"
            stroke="white"
            strokeWidth="1.6"
          />
        ) : value.state === 'failure' ? (
          <path d="M5 5l6 6M11 5l-6 6" stroke="white" strokeWidth="1.6" />
        ) : value.state === 'pending' ? (
          <path d="M8 4v4l3 1.5" fill="none" stroke="white" strokeWidth="1.6" />
        ) : (
          <path d="M5 8h6" stroke="white" strokeWidth="1.6" />
        )}
      </svg>
    </TooltippedContent>
  )
}

interface IObservedProps {
  readonly subscribe: CommitActionsSubscribe
  readonly repositoryName: string
  readonly getSnapshot?: () => ICommitActionsSummary | undefined
}

/** Only visible, mounted rows in a visible window subscribe to the shared poll. */
export function ObservedCommitActionsStatus({
  subscribe,
  repositoryName,
  getSnapshot,
}: IObservedProps) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const [snapshot, setSnapshot] = React.useState<{
    readonly subscribe: CommitActionsSubscribe
    readonly value: ICommitActionsSummary | undefined
  }>()
  React.useEffect(() => {
    const element = ref.current
    if (element === null) {
      return
    }
    let intersecting = typeof IntersectionObserver === 'undefined'
    let unsubscribe: (() => void) | undefined
    let generation = 0
    const update = () => {
      if (!intersecting || document.hidden) {
        generation++
        unsubscribe?.()
        unsubscribe = undefined
      } else if (unsubscribe === undefined) {
        const current = ++generation
        unsubscribe = subscribe(value => {
          if (generation === current) {
            setSnapshot({ subscribe, value })
          }
        })
      }
    }
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(entries => {
            intersecting = entries.some(entry => entry.isIntersecting)
            update()
          })
    observer?.observe(element)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      generation++
      observer?.disconnect()
      document.removeEventListener('visibilitychange', update)
      unsubscribe?.()
    }
  }, [subscribe])

  // Hydrate a remounted row synchronously, before IntersectionObserver runs.
  // A new SHA/account uses its own cache; never flash the recycled row's badge.
  const value =
    getSnapshot?.() ??
    (snapshot?.subscribe === subscribe ? snapshot.value : undefined)
  return (
    <span
      ref={ref}
      className="commit-actions-status"
      style={{
        display: 'inline-flex',
        width: 24,
        height: 16,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {value !== undefined && (
        <CommitActionsStatusBadge
          value={value}
          repositoryName={repositoryName}
        />
      )}
    </span>
  )
}

interface IStatusProps {
  readonly gitHubRepository: GitHubRepository | null
  readonly accounts: ReadonlyArray<Account>
  readonly sha: string
}

export function CommitActionsStatus({
  gitHubRepository,
  accounts,
  sha,
}: IStatusProps) {
  const resolved = commitActionsTarget(gitHubRepository, accounts)
  const account = resolved?.account
  const target = resolved?.target
  const key = target === undefined ? '' : actionsTargetKey(target)
  React.useEffect(() => statusPool.retainAccounts(accounts), [accounts])
  const source = React.useMemo(() => {
    if (account === undefined || target === undefined) {
      return undefined
    }
    return {
      subscribe: (listener: Listener) =>
        statusPool.subscribe(account, target, sha, listener),
      getSnapshot: () => statusPool.getSnapshot(account, target, sha),
    }
    // Profile updates can reconstruct Account objects. Depend on identity and
    // credentials, not object references; token replacement still invalidates.
  }, [
    account?.id,
    account?.apiType,
    account?.endpoint,
    account?.login,
    account?.token,
    account?.refreshToken,
    key,
    sha,
  ])
  return source === undefined || target === undefined ? null : (
    <ObservedCommitActionsStatus
      subscribe={source.subscribe}
      getSnapshot={source.getSnapshot}
      repositoryName={`${target.owner}/${target.name}`}
    />
  )
}
