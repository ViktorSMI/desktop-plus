import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ICommitActionsSummary } from '../../src/lib/commit-actions'
import { CommitActionsPool } from '../../src/lib/stores/commit-actions-pool'
import { CommitActionsStore } from '../../src/lib/stores/commit-actions-store'
import { IActionsTarget } from '../../src/models/actions'

const account = {
  id: 1, apiType: 'dotcom' as const, endpoint: 'https://api.github.com',
  login: 'owner', token: 'test-token', refreshToken: '',
}
const target: IActionsTarget = {
  provider: 'github', endpoint: account.endpoint, owner: 'owner',
  name: 'repo', login: account.login,
}
const passed: ICommitActionsSummary = { state: 'success', count: 1, description: 'Passed' }
const running: ICommitActionsSummary = { state: 'pending', count: 1, description: 'Running' }
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred() {
  let resolve!: (value: ICommitActionsSummary) => void
  const promise = new Promise<ICommitActionsSummary>(yes => { resolve = yes })
  return { promise, resolve }
}

describe('commit Actions cache lifetime', () => {
  it('shares cached status across 100 complete remounts and equivalent account objects', async () => {
    let calls = 0
    const pool = new CommitActionsPool(async () => { calls++; return passed })
    try {
      const off = pool.subscribe(account, target, 'a', () => {})
      await flush()
      off()
      for (let i = 0; i < 100; i++) {
        assert.equal(pool.getSnapshot({ ...account }, { ...target }, 'a'), passed)
        const values: unknown[] = []
        const unsubscribe = pool.subscribe({ ...account }, { ...target }, 'a', v => values.push(v))
        assert.deepEqual(values, [passed])
        unsubscribe()
        unsubscribe() // cleanup is idempotent, not a second pool release
      }
      assert.equal(calls, 1)
    } finally { pool.dispose() }
  })

  it('keeps an in-flight request when all rows disappear and reappear', async () => {
    let calls = 0
    const request = deferred()
    const pool = new CommitActionsPool(() => { calls++; return request.promise })
    try {
      const oldValues: unknown[] = []
      pool.subscribe(account, target, 'a', v => oldValues.push(v))()
      const values: unknown[] = []
      pool.subscribe({ ...account }, target, 'a', v => values.push(v))
      assert.equal(calls, 1)
      request.resolve(passed)
      await flush()
      assert.deepEqual(oldValues, [undefined])
      assert.deepEqual(values, [undefined, passed])
    } finally { pool.dispose() }
  })

  it('caches a late result even while the view has no subscribers', async () => {
    const request = deferred()
    const pool = new CommitActionsPool(() => request.promise)
    try {
      pool.subscribe(account, target, 'a', () => {})()
      request.resolve(passed)
      await flush()
      assert.equal(pool.getSnapshot(account, target, 'a'), passed)
    } finally { pool.dispose() }
  })

  it('stops polling immediately, keeps the last circle, and refreshes stale results only on return', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    let now = 0, calls = 0
    const request = deferred()
    const pool = new CommitActionsPool(() => ++calls === 1 ? Promise.resolve(running) : request.promise, () => now)
    try {
      const off = pool.subscribe(account, target, 'a', () => {})
      await flush()
      off()
      now = 240000
      t.mock.timers.tick(now)
      await flush()
      assert.equal(calls, 1)
      assert.equal(pool.getSnapshot(account, target, 'a'), running)
      const values: unknown[] = []
      pool.subscribe(account, target, 'a', v => values.push(v))
      assert.equal(calls, 2)
      assert.deepEqual(values, [running])
      assert.equal(pool.getSnapshot(account, target, 'a'), running)
      request.resolve(passed)
      await flush()
      assert.deepEqual(values, [running, passed])
    } finally { pool.dispose() }
  })

  it('preserves refresh deadlines rather than refreshing on every resubscription', async () => {
    let now = 0, calls = 0
    const pool = new CommitActionsPool(async () => ++calls === 1 ? running : passed, () => now)
    try {
      let off = pool.subscribe(account, target, 'a', () => {})
      await flush()
      off()
      now = 29999
      off = pool.subscribe(account, target, 'a', () => {})
      assert.equal(calls, 1)
      off()
      now = 30000
      off = pool.subscribe(account, target, 'a', () => {})
      await flush()
      assert.equal(calls, 2)
      off()
      now = 149999
      pool.subscribe(account, target, 'a', () => {})
      assert.equal(calls, 2)
    } finally { pool.dispose() }
  })

  it('expires an idle cache after five minutes without making a network request', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    let calls = 0
    const pool = new CommitActionsPool(async () => { calls++; return passed })
    try {
      const off = pool.subscribe(account, target, 'a', () => {})
      await flush()
      off()
      t.mock.timers.tick(299999)
      assert.equal(pool.getSnapshot(account, target, 'a'), passed)
      t.mock.timers.tick(1)
      assert.equal(pool.getSnapshot(account, target, 'a'), undefined)
      assert.equal(calls, 1)
    } finally { pool.dispose() }
  })

  it('cancels idle eviction on resume and bounds retained target caches', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
    const pool = new CommitActionsPool(async () => passed)
    try {
      const off = pool.subscribe(account, target, 'a', () => {})
      await flush()
      off()
      t.mock.timers.tick(299000)
      pool.subscribe(account, target, 'a', () => {})
      t.mock.timers.tick(1000)
      assert.equal(pool.getSnapshot(account, target, 'a'), passed)
      for (let i = 0; i < 10; i++) {
        const other = { ...target, name: `repo-${i}` }
        const stop = pool.subscribe(account, other, 'a', () => {})
        await flush()
        stop()
      }
      assert.equal(pool.getSnapshot(account, target, 'a'), passed)
      assert.equal(pool.getSnapshot(account, { ...target, name: 'repo-0' }, 'a'), undefined)
      assert.equal(pool.getSnapshot(account, { ...target, name: 'repo-1' }, 'a'), undefined)
      assert.equal(pool.getSnapshot(account, { ...target, name: 'repo-2' }, 'a'), passed)
      assert.equal(pool.getSnapshot(account, { ...target, name: 'repo-9' }, 'a'), passed)
    } finally { pool.dispose() }
  })

  it('isolates SHA, repository, server, account id and login', async () => {
    const pool = new CommitActionsPool(async () => passed)
    try {
      pool.subscribe(account, target, 'a', () => {})
      await flush()
      assert.equal(pool.getSnapshot(account, target, 'b'), undefined)
      assert.equal(pool.getSnapshot(account, { ...target, name: 'other' }, 'a'), undefined)
      assert.equal(pool.getSnapshot(account, { ...target, endpoint: 'https://other.example/api' }, 'a'), undefined)
      assert.equal(pool.getSnapshot({ ...account, id: 2 }, target, 'a'), undefined)
      assert.equal(pool.getSnapshot({ ...account, login: 'other' }, target, 'a'), undefined)
      assert.equal(pool.getSnapshot(account, { ...target, provider: 'gitea' }, 'a'), undefined)
    } finally { pool.dispose() }
  })

  it('invalidates changed credentials and ignores old responses and late cleanup', async () => {
    const request = deferred()
    let calls = 0
    const pool = new CommitActionsPool(() => ++calls === 1 ? request.promise : Promise.resolve(running))
    try {
      const off = pool.subscribe(account, target, 'a', () => {})
      const replacement = { ...account, token: 'replacement' }
      assert.equal(pool.getSnapshot(replacement, target, 'a'), undefined)
      pool.subscribe(replacement, target, 'a', () => {})
      await flush()
      off()
      request.resolve(passed)
      await flush()
      assert.equal(pool.getSnapshot(replacement, target, 'a'), running)
      assert.equal(pool.getSnapshot(account, target, 'a'), undefined)
      assert.equal(pool.getSnapshot({ ...replacement, refreshToken: 'new' }, target, 'a'), undefined)
    } finally { pool.dispose() }
  })

  it('clears cached data on account removal and prevents late repopulation', async () => {
    const request = deferred()
    const pool = new CommitActionsPool(() => request.promise)
    try {
      pool.subscribe(account, target, 'a', () => {})
      pool.retainAccounts([])
      request.resolve(passed)
      await flush()
      assert.equal(pool.getSnapshot(account, target, 'a'), undefined)
    } finally { pool.dispose() }
  })

  it('keeps error cooldown across unmounts and equivalent account objects', async () => {
    let calls = 0
    const pool = new CommitActionsPool(async () => { calls++; throw new Error('Offline') })
    try {
      const off = pool.subscribe(account, target, 'a', () => {})
      await flush()
      off()
      for (let i = 0; i < 100; i++) {
        const values: Array<ICommitActionsSummary | undefined> = []
        pool.subscribe({ ...account }, target, 'a', v => values.push(v))()
        assert.equal(values[0]?.state, 'unknown')
      }
      assert.equal(calls, 1)
    } finally { pool.dispose() }
  })

  it('evicts inactive commit snapshots in least-recently-used order', async () => {
    const store = new CommitActionsStore(async () => passed)
    try {
      for (let i = 0; i < 128; i++) {
        const off = store.subscribe(String(i), () => {})
        await flush()
        off()
      }
      store.subscribe('0', () => {})()
      const off = store.subscribe('128', () => {})
      await flush()
      off()
      assert.equal(store.getSnapshot('0'), passed)
      assert.equal(store.getSnapshot('1'), undefined)
      assert.equal(store.getSnapshot('128'), passed)
    } finally { store.dispose() }
    assert.equal(store.getSnapshot('0'), undefined)
  })
})
