import { Account } from '../../models/account'
import { IActionsTarget } from '../../models/actions'
import { ICommitActionsSummary } from '../commit-actions'
import { CommitActionsStore } from './commit-actions-store'

type CacheAccount = Pick<
  Account,
  'id' | 'apiType' | 'endpoint' | 'login' | 'token' | 'refreshToken'
>
type Listener = (value: ICommitActionsSummary | undefined) => void
interface IPoolEntry<TAccount> {
  account: TAccount
  readonly store: CommitActionsStore
  timer: ReturnType<typeof setInterval> | undefined
  eviction: ReturnType<typeof setTimeout> | undefined
  subscribers: number
  disposed: boolean
}

const IdleRetention = 5 * 60 * 1000
const MaxIdleTargets = 8

function sameAccount(a: CacheAccount, b: CacheAccount) {
  return (
    a.id === b.id &&
    a.apiType === b.apiType &&
    a.endpoint === b.endpoint &&
    a.login === b.login
  )
}

function sameCredentials(a: CacheAccount, b: CacheAccount) {
  return (
    sameAccount(a, b) &&
    a.token === b.token &&
    a.refreshToken === b.refreshToken
  )
}

/** Retain bounded snapshots across row remounts, without polling hidden rows. */
export class CommitActionsPool<TAccount extends CacheAccount> {
  private readonly entries = new Map<string, IPoolEntry<TAccount>>()

  public constructor(
    private readonly read: (
      account: TAccount,
      target: IActionsTarget,
      sha: string
    ) => Promise<ICommitActionsSummary>,
    private readonly now: () => number = () => Date.now()
  ) {}

  private key(account: TAccount, target: IActionsTarget) {
    // No credentials in keys. Equivalent Account instances share a cache, but
    // another user, provider, server or repository can never reuse its status.
    return JSON.stringify([
      account.id,
      account.apiType,
      account.endpoint,
      account.login,
      target.provider,
      target.endpoint,
      target.owner,
      target.name,
      target.login,
    ])
  }

  /** Pure read for the first render of a recycled row; never starts a request. */
  public getSnapshot(account: TAccount, target: IActionsTarget, sha: string) {
    const entry = this.entries.get(this.key(account, target))
    return entry !== undefined && sameCredentials(entry.account, account)
      ? entry.store.getSnapshot(sha)
      : undefined
  }

  public subscribe(
    account: TAccount,
    target: IActionsTarget,
    sha: string,
    listener: Listener
  ) {
    const key = this.key(account, target)
    let entry = this.entries.get(key)
    if (entry !== undefined && !sameCredentials(entry.account, account)) {
      this.remove(key, entry)
      entry = undefined
    }
    if (entry === undefined) {
      const current: IPoolEntry<TAccount> = {
        account,
        store: new CommitActionsStore(
          sha => this.read(current.account, target, sha),
          this.now
        ),
        timer: undefined,
        eviction: undefined,
        subscribers: 0,
        disposed: false,
      }
      entry = current
    }
    entry.account = account
    // Map insertion order is the LRU order of target subscriptions.
    this.entries.delete(key)
    this.entries.set(key, entry)
    clearTimeout(entry.eviction)
    entry.eviction = undefined
    if (entry.subscribers++ === 0) {
      const store = entry.store
      entry.timer = setInterval(() => store.refreshDue(), 30000)
    }
    const retained = entry
    const unsubscribe = retained.store.subscribe(sha, listener)
    let closed = false
    return () => {
      if (closed) {
        return
      }
      closed = true
      unsubscribe()
      if (retained.disposed || --retained.subscribers !== 0) {
        return
      }
      // Stop network polling immediately, but do not throw away results or
      // in-flight requests when resize/scroll briefly unmounts all the rows.
      clearInterval(retained.timer)
      retained.timer = undefined
      retained.eviction = setTimeout(
        () => this.remove(key, retained),
        IdleRetention
      )
      const idle = Array.from(this.entries).filter(
        ([, item]) => item.subscribers === 0
      )
      for (const [idleKey, item] of idle.slice(
        0,
        Math.max(0, idle.length - MaxIdleTargets)
      )) {
        this.remove(idleKey, item)
      }
    }
  }

  /** Account removal or credential replacement invalidates retained snapshots. */
  public retainAccounts(accounts: ReadonlyArray<TAccount>) {
    for (const [key, entry] of this.entries) {
      if (!accounts.some(account => sameCredentials(entry.account, account))) {
        this.remove(key, entry)
      }
    }
  }

  private remove(key: string, entry: IPoolEntry<TAccount>) {
    clearInterval(entry.timer)
    clearTimeout(entry.eviction)
    entry.disposed = true
    entry.store.dispose()
    // Cleanup from a retired credential must not remove its replacement pool.
    if (this.entries.get(key) === entry) {
      this.entries.delete(key)
    }
  }

  public dispose() {
    for (const [key, entry] of this.entries) {
      this.remove(key, entry)
    }
  }
}
