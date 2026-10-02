import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { API, GiteaAPI } from '../../src/lib/api'
import { CommitActionsClient } from '../../src/lib/commit-actions-client'
import {
  loadCommitActions,
  loadCommitActionsRuns,
} from '../../src/lib/commit-actions'
import { IActionsTarget } from '../../src/models/actions'
import { Account } from '../../src/models/account'

const sha = 'a'.repeat(40)
const run = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  run_number: id + 100,
  name: `CI ${id}`,
  workflow_id: id,
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  ...extra,
})
const page = (runs: unknown[], total = runs.length, next = false) => ({
  body: { total_count: total, workflow_runs: runs },
  hasNextPage: next,
})

describe('commit Actions navigation lookup', () => {
  afterEach(() => mock.restoreAll())
  it('keeps run ids, display names and run numbers without storing arbitrary URLs', async () => {
    const [value] = await loadCommitActionsRuns(sha, async () =>
      page([
        run(42, {
          name: '<script>workflow</script>',
          html_url: 'javascript:alert(1)',
        }),
      ])
    )
    assert.equal(value.id, 42)
    assert.equal(value.number, 142)
    assert.equal(value.name, '<script>workflow</script>')
    assert.equal('html_url' in value, false)
  })
  it('includes every workflow across pages and uses exactly the same latest attempts as badges', async () => {
    const calls: number[] = []
    const read = async (p: number) => {
      calls.push(p)
      return p === 1
        ? page([run(1), run(2, { workflow_id: 1 })], 3, true)
        : page(
            [
              run(2, { workflow_id: 1, run_attempt: 2, conclusion: 'failure' }),
              run(3),
            ],
            3
          )
    }
    const choices = await loadCommitActionsRuns(sha, read)
    assert.deepEqual(calls, [1, 2])
    assert.deepEqual(
      choices.map(r => [r.id, r.attempt]),
      [
        [3, 1],
        [2, 2],
      ]
    )
    const summary = await loadCommitActions(sha, read)
    assert.deepEqual(summary, {
      state: 'failure',
      count: 2,
      description: 'Actions failed or require attention (2 workflows)',
    })
    assert.equal('runs' in summary, false, 'Badge caches remain compact')
  })
  it('keeps same-name workflows, events and branches distinct', async () => {
    const choices = await loadCommitActionsRuns(sha, async () =>
      page([
        run(1, { name: 'CI' }),
        run(2, { name: 'CI' }),
        run(3, { name: 'CI', workflow_id: 1, event: 'workflow_dispatch' }),
        run(4, { name: 'CI', workflow_id: 1, head_branch: 'dev' }),
      ])
    )
    assert.equal(choices.length, 4)
  })
  it('returns an empty list for a commit without runs', async () => {
    assert.deepEqual(await loadCommitActionsRuns(sha, async () => page([])), [])
  })
  it('rejects incomplete or cross-commit results instead of navigating to an unrelated run', async () => {
    await assert.rejects(
      loadCommitActionsRuns(sha, async () =>
        page([run(1, { head_sha: 'b'.repeat(40) })])
      )
    )
    await assert.rejects(
      loadCommitActionsRuns(sha, async () => page([run(1)], 2))
    )
    await assert.rejects(
      loadCommitActionsRuns(sha, async () => page([run(1)], 2, true))
    )
    await assert.rejects(loadCommitActionsRuns('main', async () => page([])))
  })
  for (const provider of ['github', 'gitea'] as const) {
    it(`looks up ${provider} by the complete SHA without event/status filters`, async () => {
      const target: IActionsTarget = {
        provider,
        endpoint:
          provider === 'github'
            ? 'https://api.github.com'
            : 'https://gitea.test/prefix/api/v1',
        login: 'me',
        owner: 'team',
        name: 'repo',
      }
      const account = {
        ...target,
        apiType: provider === 'github' ? 'dotcom' : 'gitea',
        token: 'test-only',
      } as unknown as Account
      const client = new CommitActionsClient(
        account.endpoint,
        account.token,
        account.login
      )
      const paths: string[] = []
      const reply = async (path: string) => {
        paths.push(path)
        return new Response(JSON.stringify(page([run(42)]).body))
      }
      if (provider === 'github') {
        mock.method(
          client as any,
          'ghRequest',
          async (method: string, path: string) => {
            assert.equal(method, 'GET')
            return reply(path)
          }
        )
      } else {
        const api = Object.create(GiteaAPI.prototype) as GiteaAPI
        mock.method(API, 'fromAccount', () => api)
        mock.method(api, 'fetchActionsResource', reply)
      }
      const choices = await client.runsForCommit(account, target, sha)
      assert.equal(choices[0].id, 42)
      assert.equal(choices[0].number, 142)
      assert.ok(paths[0].startsWith('repos/team/repo/actions/runs?'))
      const query = new URLSearchParams(paths[0].split('?')[1])
      assert.equal(query.get('head_sha'), sha)
      assert.equal(
        query.get(provider === 'github' ? 'per_page' : 'limit'),
        '100'
      )
      assert.equal(query.has('event'), false)
      assert.equal(query.has('status'), false)
      await assert.rejects(
        client.runsForCommit(account, { ...target, login: 'other' }, sha)
      )
      assert.equal(paths.length, 1)
    })
  }
})
