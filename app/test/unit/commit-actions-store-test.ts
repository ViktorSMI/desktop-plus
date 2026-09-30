import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CommitActionsStore } from '../../src/lib/stores/commit-actions-store'
import { ICommitActionsSummary } from '../../src/lib/commit-actions'

const passed: ICommitActionsSummary = {state: 'success', description: 'Passed', count: 1}
const running: ICommitActionsSummary = {state: 'pending', description: 'Running', count: 1}
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred() {
  let resolve!: (value: ICommitActionsSummary) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ICommitActionsSummary>((yes, no) => {
    resolve = yes
    reject = no
  })
  return {promise, resolve, reject}
}

describe('bounded commit Actions polling', () => {
  it('deduplicates the same commit and shares its result', async () => {
    const request = deferred()
    let calls = 0
    const store = new CommitActionsStore(() => {calls++; return request.promise})
    const first: unknown[] = [], second: unknown[] = []
    const offA = store.subscribe('a', value => first.push(value))
    const offB = store.subscribe('a', value => second.push(value))
    assert.equal(calls, 1)
    request.resolve(passed)
    await flush()
    assert.deepEqual(first, [undefined, passed])
    assert.deepEqual(second, first)
    offA(); offB(); store.dispose()
  })
  it('limits concurrency to two and skips offscreen queued commits', async () => {
    const requests = [deferred(), deferred(), deferred()]
    const calls: string[] = []
    const store = new CommitActionsStore(sha => {
      calls.push(sha)
      return requests[calls.length - 1].promise
    })
    store.subscribe('a', () => {})
    store.subscribe('b', () => {})
    const off = store.subscribe('c', () => {})
    store.subscribe('d', () => {})
    assert.deepEqual(calls, ['a', 'b'])
    off()
    requests[0].resolve(passed)
    await flush()
    assert.deepEqual(calls, ['a', 'b', 'd'])
    store.dispose()
    requests[1].resolve(passed); requests[2].resolve(passed)
    await flush()
  })
  it('refreshes active checks at 30 seconds and completed checks at two minutes', async () => {
    let now = 0, calls = 0
    const store = new CommitActionsStore(async () => ++calls === 1 ? running : passed, () => now)
    store.subscribe('a', () => {})
    await flush()
    now = 29999; store.refreshDue(); await flush()
    assert.equal(calls, 1)
    now = 30000; store.refreshDue(); await flush()
    assert.equal(calls, 2)
    now = 149999; store.refreshDue(); await flush()
    assert.equal(calls, 2)
    now = 150000; store.refreshDue(); await flush()
    assert.equal(calls, 3)
    store.dispose()
  })
  it('never notifies an unsubscribed row or a disposed view from a late response', async () => {
    const request = deferred()
    let updates = 0
    const store = new CommitActionsStore(() => request.promise)
    const off = store.subscribe('a', () => updates++)
    off(); store.dispose()
    request.resolve(passed)
    await flush()
    assert.equal(updates, 1)
    assert.throws(() => store.subscribe('a', () => {}))
  })
  it('pauses the whole target after an error and does not retain stale green results', async () => {
    let now = 0, calls = 0
    const values: Array<ICommitActionsSummary | undefined> = []
    const store = new CommitActionsStore(async () => {
      if (++calls === 1) {return passed}
      throw new Error('Rate limited')
    }, () => now)
    store.subscribe('a', value => values.push(value))
    await flush()
    now = 120000; store.refreshDue(); await flush()
    assert.equal(values[values.length - 1]?.state, 'unknown')
    store.subscribe('b', value => assert.equal(value?.state, 'unknown'))
    now = 419999; store.refreshDue(); await flush()
    assert.equal(calls, 2)
    store.dispose()
  })
  it('does not poll after the row unsubscribes', async () => {
    let now = 0, calls = 0
    const store = new CommitActionsStore(async () => {calls++; return running}, () => now)
    const off = store.subscribe('a', () => {})
    await flush(); off()
    now = 1000000; store.refreshDue(); await flush()
    assert.equal(calls, 1)
    store.dispose()
  })
  it('keeps repositories and accounts isolated', async () => {
    const a = new CommitActionsStore(async () => passed)
    const b = new CommitActionsStore(async () => running)
    let first: ICommitActionsSummary | undefined, second: ICommitActionsSummary | undefined
    a.subscribe('same-sha', value => {first = value})
    b.subscribe('same-sha', value => {second = value})
    await flush()
    assert.equal(first?.state, 'success')
    assert.equal(second?.state, 'pending')
    a.dispose(); b.dispose()
  })
})
