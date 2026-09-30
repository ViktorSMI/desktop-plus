import {
  ICommitActionsSummary,
  UnavailableCommitActions,
} from '../commit-actions'

type Listener = (value: ICommitActionsSummary | undefined) => void
interface IEntry {
  readonly listeners: Set<Listener>
  value: ICommitActionsSummary | undefined
  expires: number
  pending: boolean
}

/** One bounded queue/cache per account and repository, not a timer per row. */
export class CommitActionsStore {
  private readonly entries = new Map<string, IEntry>()
  private activeRequests = 0
  private cooldownUntil = 0
  private disposed = false

  public constructor(
    private readonly read: (sha: string) => Promise<ICommitActionsSummary>,
    private readonly now: () => number = Date.now
  ) {}

  public subscribe(sha: string, listener: Listener) {
    if (this.disposed) {
      throw new Error('Commit Actions store has been disposed')
    }
    let entry = this.entries.get(sha)
    if (entry === undefined) {
      // Evict only inactive rows. An active result must remain available to all
      // consumers; leaving history disposes the entire cache.
      for (const [key, item] of this.entries) {
        if (this.entries.size < 128) {
          break
        }
        if (item.listeners.size === 0 && !item.pending) {
          this.entries.delete(key)
        }
      }
      entry = {
        listeners: new Set(),
        value: undefined,
        expires: 0,
        pending: false,
      }
      this.entries.set(sha, entry)
    }
    if (this.now() < this.cooldownUntil) {
      entry.value = UnavailableCommitActions
      entry.expires = this.cooldownUntil
    }
    entry.listeners.add(listener)
    listener(entry.value)
    this.refreshDue()
    return () => {
      entry!.listeners.delete(listener)
    }
  }

  public refreshDue() {
    if (this.disposed || this.now() < this.cooldownUntil) {
      return
    }
    for (const [sha, entry] of this.entries) {
      if (this.activeRequests >= 2) {
        break
      }
      if (
        entry.listeners.size === 0 ||
        entry.pending ||
        entry.expires > this.now()
      ) {
        continue
      }
      entry.pending = true
      this.activeRequests++
      void this.load(sha, entry)
    }
  }

  private async load(sha: string, entry: IEntry) {
    try {
      const value = await this.read(sha)
      if (!this.disposed && this.now() >= this.cooldownUntil) {
        entry.value = value
        // Running work is refreshed quickly. Finished/no-run commits are cached
        // for two minutes, including reruns and commits pushed after first look.
        entry.expires =
          this.now() +
          (value.state === 'pending' || value.state === 'failure'
            ? 30000
            : 120000)
        entry.listeners.forEach(listener => listener(value))
      }
    } catch {
      if (!this.disposed) {
        // One denied/rate-limited/offline request pauses the entire target,
        // rather than hitting the same error once for every visible commit.
        this.cooldownUntil = this.now() + 300000
        for (const item of this.entries.values()) {
          item.value = UnavailableCommitActions
          item.expires = this.cooldownUntil
          item.listeners.forEach(listener => listener(item.value))
        }
      }
    } finally {
      entry.pending = false
      this.activeRequests--
      this.refreshDue()
    }
  }

  public dispose() {
    this.disposed = true
    this.entries.forEach(entry => entry.listeners.clear())
    this.entries.clear()
  }
}
