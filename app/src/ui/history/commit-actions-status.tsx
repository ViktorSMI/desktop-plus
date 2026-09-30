import * as React from 'react'
import { Account } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import { IActionsTarget } from '../../models/actions'
import { actionsTargetKey } from '../../lib/actions-client'
import {
  CommitActionsClient,
  commitActionsTarget,
} from '../../lib/commit-actions-client'
import { ICommitActionsSummary } from '../../lib/commit-actions'
import { CommitActionsStore } from '../../lib/stores/commit-actions-store'
import { TooltippedContent } from '../lib/tooltipped-content'

type Listener = (value: ICommitActionsSummary | undefined) => void
export type CommitActionsSubscribe = (listener: Listener) => () => void
interface IPoolEntry {
  readonly store: CommitActionsStore
  readonly timer: ReturnType<typeof setInterval>
  subscribers: number
}

// Account identity scopes caches across logins/token replacement; credentials
// are never placed in cache keys, React state, tooltips or DOM attributes.
const pools = new WeakMap<Account, Map<string, IPoolEntry>>()

function subscribeToStatus(
  account: Account,
  target: IActionsTarget,
  sha: string,
  listener: Listener
) {
  let pool = pools.get(account)
  if (pool === undefined) {
    pool = new Map()
    pools.set(account, pool)
  }
  const key = actionsTargetKey(target)
  let entry = pool.get(key)
  if (entry === undefined) {
    const client = new CommitActionsClient(
      account.endpoint,
      account.token,
      account.login
    )
    const store = new CommitActionsStore(sha =>
      client.forCommit(account, target, sha)
    )
    entry = {
      store,
      timer: setInterval(() => store.refreshDue(), 30000),
      subscribers: 0,
    }
    pool.set(key, entry)
  }
  entry.subscribers++
  const unsubscribe = entry.store.subscribe(sha, listener)
  return () => {
    unsubscribe()
    entry!.subscribers--
    if (entry!.subscribers === 0) {
      clearInterval(entry!.timer)
      entry!.store.dispose()
      pool!.delete(key)
      if (pool!.size === 0) {
        pools.delete(account)
      }
    }
  }
}

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
}

/** Only visible, mounted rows in a visible window subscribe to the shared poll. */
export function ObservedCommitActionsStatus({
  subscribe,
  repositoryName,
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

  // A recycled virtual row must never flash the previous commit's green badge.
  const value = snapshot?.subscribe === subscribe ? snapshot.value : undefined
  return (
    <span
      ref={ref}
      className="commit-actions-status"
      style={{
        display: 'inline-flex',
        width: 20,
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
  const subscribe = React.useMemo<CommitActionsSubscribe | undefined>(() => {
    if (account === undefined || target === undefined) {
      return undefined
    }
    return listener => subscribeToStatus(account, target, sha, listener)
  }, [account, key, sha])
  return subscribe === undefined || target === undefined ? null : (
    <ObservedCommitActionsStatus
      subscribe={subscribe}
      repositoryName={`${target.owner}/${target.name}`}
    />
  )
}
