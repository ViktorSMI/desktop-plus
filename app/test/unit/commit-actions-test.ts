import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  loadCommitActions,
  parseCommitActionsPage,
  summarizeCommitActions,
  validateCommitSHA,
} from '../../src/lib/commit-actions'

const sha = 'a'.repeat(40)
function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    workflow_id: 10,
    event: 'push',
    head_branch: 'main',
    head_sha: sha,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }
}
function summary(runs: ReadonlyArray<unknown>) {
  return summarizeCommitActions(
    parseCommitActionsPage(
      {
        total_count: runs.length,
        workflow_runs: runs,
      },
      sha
    ).runs
  )
}

describe('commit Actions status', () => {
  it('does not show green for a commit without workflows', () => {
    assert.equal(summary([]).state, 'none')
    assert.equal(summary([]).count, 0)
  })
  it('shows green for successful workflows', () => {
    assert.equal(summary([run()]).state, 'success')
  })
  for (const status of [
    'queued',
    'pending',
    'requested',
    'waiting',
    'in_progress',
  ]) {
    it(`shows orange for ${status}, including a rerun with an old conclusion`, () => {
      assert.equal(
        summary([run({ status, conclusion: 'failure' })]).state,
        'pending'
      )
    })
  }
  for (const conclusion of ['failure', 'timed_out', 'action_required']) {
    it(`shows red for ${conclusion}`, () => {
      assert.equal(summary([run({ conclusion })]).state, 'failure')
    })
  }
  it('gives failures precedence over running and successful workflows', () => {
    assert.equal(
      summary([
        run(),
        run({ id: 2, workflow_id: 11, status: 'in_progress' }),
        run({ id: 3, workflow_id: 12, conclusion: 'failure' }),
      ]).state,
      'failure'
    )
  }
  for (const conclusion of ['cancelled', 'stale', null, 'future_state']) {
    it(`never treats ${conclusion} as success`, () => {
      assert.equal(
        summary([run(), run({ id: 2, workflow_id: 11, conclusion })]).state,
        'unknown'
      )
    })
  }
  it('reports all-skipped as neutral, not successful', () => {
    assert.equal(summary([run({ conclusion: 'skipped' })]).state, 'neutral')
    assert.equal(summary([run({ conclusion: 'neutral' })]).state, 'neutral')
  })
  it('permits skipped optional workflows alongside a successful workflow', () => {
    assert.equal(
      summary([run(), run({ id: 2, workflow_id: 11, conclusion: 'skipped' })])
        .state,
      'success'
    )
  })
  it('recognizes Gitea terminal states without a conclusion', () => {
    assert.equal(
      summary([run({ status: 'success', conclusion: null })]).state,
      'success'
    )
    assert.equal(
      summary([run({ status: 'failure', conclusion: null })]).state,
      'failure'
    )
    assert.equal(
      summary([run({ status: 'skipped', conclusion: null })]).state,
      'neutral'
    )
  })
  it('uses the newest attempt and superseding run regardless of response order', () => {
    const failed = run({ conclusion: 'failure' })
    const passed = run({ run_attempt: 2 })
    assert.equal(summary([failed, passed]).state, 'success')
    assert.equal(summary([passed, failed]).state, 'success')
    assert.equal(summary([run({ id: 2 }), failed]).count, 1)
    assert.equal(summary([run({ id: 2 }), failed]).state, 'success')
    assert.equal(
      summary([failed, run({ run_attempt: 2, status: 'queued' })]).state,
      'pending'
    )
  })
  it('does not collapse different events, branches or workflows with identical names', () => {
    assert.equal(
      summary([
        run(),
        run({ id: 2, event: 'pull_request', conclusion: 'failure' }),
      ]).state,
      'failure'
    )
    assert.equal(
      summary([
        run(),
        run({ id: 2, head_branch: 'release', conclusion: 'failure' }),
      ]).count,
      2
    )
    assert.equal(
      summary([
        run({ workflow_id: undefined, name: 'CI' }),
        run({
          id: 2,
          workflow_id: undefined,
          name: 'CI',
          conclusion: 'failure',
        }),
      ]).state,
      'failure'
    )
  })
  it('uses Gitea workflow paths when numeric workflow ids are absent', () => {
    assert.equal(
      summary([
        run({
          workflow_id: undefined,
          path: 'build.yml@refs/heads/main',
          conclusion: 'failure',
        }),
        run({
          id: 2,
          workflow_id: undefined,
          path: 'build.yml@refs/heads/main',
        }),
      ]).state,
      'success'
    )
  })
  it('never collapses absent workflow identifiers into a shared zero id', () => {
    assert.equal(summary([
      run({ workflow_id: 0 }),
      run({ id: 2, workflow_id: 0, conclusion: 'failure' }),
    ]).state, 'failure')
    assert.equal(summary([
      run({ workflow_id: '' }),
      run({ id: 2, workflow_id: '', conclusion: 'failure' }),
    ]).count, 2)
  })
  it('does not show green for conflicting snapshots of the same attempt', () => {
    const completed = run()
    const active = run({ status: 'in_progress', conclusion: null })
    assert.equal(summary([completed, active]).state, 'unknown')
    assert.equal(summary([active, completed]).state, 'unknown')
    assert.equal(summary([completed, active, completed]).state, 'unknown')
  })
  it('rejects invalid and mismatched SHAs before displaying results', () => {
    for (const invalid of ['', 'main', '../main', 'a'.repeat(39)]) {
      assert.throws(() => validateCommitSHA(invalid))
    }
    assert.equal(validateCommitSHA(sha.toUpperCase()), sha)
    assert.throws(() => summary([run({ head_sha: 'b'.repeat(40) })]))
  })
  it('rejects malformed API responses instead of assuming success', () => {
    for (const body of [
      null,
      {},
      { total_count: 0 },
      { total_count: -1, workflow_runs: [] },
    ]) {
      assert.throws(() => parseCommitActionsPage(body, sha))
    }
    assert.throws(() => summary([run({ id: -1 })]))
  })
  it('includes failing workflows on later pages', async () => {
    const pages: number[] = []
    const result = await loadCommitActions(sha, async page => {
      pages.push(page)
      return {
        body: {
          total_count: 2,
          workflow_runs: [
            page === 1
              ? run()
              : run({ id: 2, workflow_id: 11, conclusion: 'failure' }),
          ],
        },
        hasNextPage: page === 1,
      }
    })
    assert.deepEqual(pages, [1, 2])
    assert.equal(result.state, 'failure')
  })
  it('handles server page-size limits without Link headers', async () => {
    const pages: number[] = []
    await loadCommitActions(sha, async page => {
      pages.push(page)
      return {
        body: { total_count: 3, workflow_runs: [run({ id: page })] },
        hasNextPage: undefined,
      }
    })
    assert.deepEqual(pages, [1, 2, 3])
  })
  it('rejects incomplete pagination and pages which never advance', async () => {
    await assert.rejects(
      loadCommitActions(sha, async () => ({
        body: { total_count: 2, workflow_runs: [run()] },
        hasNextPage: false,
      }))
    )
    await assert.rejects(
      loadCommitActions(sha, async () => ({
        body: { total_count: 2, workflow_runs: [run()] },
        hasNextPage: true,
      }))
    )
    let calls = 0
    await assert.rejects(
      loadCommitActions(sha, async page => {
        calls++
        return {
          body: { total_count: 10000, workflow_runs: [run({ id: page })] },
          hasNextPage: true,
        }
      })
    )
    assert.equal(calls, 10)
  })
})
