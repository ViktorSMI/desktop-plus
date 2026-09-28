import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ActionsClient,
  actionsDuration,
  actionsErrorMessage,
  actionsStatus,
  actionsWebURL,
  getActionsAccounts,
  getActionsTarget,
} from '../../src/lib/actions-client'
import { APIError, HTTPMethod } from '../../src/lib/http'
import { Account } from '../../src/models/account'
import { Repository } from '../../src/models/repository'
import { IActionsTarget } from '../../src/models/actions'

const target: IActionsTarget = {
  endpoint: 'https://api.github.com',
  owner: 'ViktorSMI',
  name: 'desktop-plus',
  login: 'ViktorSMI',
}
const repository = new Repository('/repos/desktop-plus', 1, null, false)
const remote = {
  name: 'origin',
  url: 'https://github.com/ViktorSMI/desktop-plus.git',
}
function account(
  login: string,
  endpoint = target.endpoint,
  type: 'dotcom' | 'enterprise' | 'gitlab' = 'dotcom'
) {
  return new Account(
    login,
    endpoint,
    type,
    'test-token',
    '',
    0,
    [],
    '',
    1,
    login
  )
}

class TestActionsClient extends ActionsClient {
  public readonly requests: {
    endpoint: string
    method: HTTPMethod
    path: string
    reload: boolean
  }[] = []
  public response = new Response('{}')
  protected async request(
    endpoint: string,
    method: HTTPMethod,
    path: string,
    options: { reloadCache?: boolean } = {}
  ) {
    this.requests.push({
      endpoint,
      method,
      path,
      reload: options.reloadCache === true,
    })
    return this.response
  }
}

describe('Actions client and target routing', () => {
  it('uses the actual fork remote rather than a contribution target', () => {
    assert.deepEqual(
      getActionsTarget(repository, remote, [account('ViktorSMI')], null),
      target
    )
    const upstream = {
      name: 'upstream',
      url: 'https://github.com/desktop/desktop.git',
    }
    assert.equal(
      getActionsTarget(repository, upstream, [account('ViktorSMI')], null)
        ?.owner,
      'desktop'
    )
  })
  it('honors the remembered login, never falls back from a missing explicit account', () => {
    const accounts = [account('work'), account('ViktorSMI')]
    assert.equal(
      getActionsTarget(repository, remote, accounts, 'work')?.login,
      'work'
    )
    assert.equal(
      getActionsTarget(repository, remote, accounts, 'removed'),
      null
    )
  })
  it('requires a choice when the matching host has multiple ambiguous accounts', () => {
    assert.equal(
      getActionsTarget(repository, remote, [account('a'), account('b')], null),
      null
    )
  })
  it('supports SSH GitHub remotes without using SSH keys for the API', () => {
    assert.deepEqual(
      getActionsTarget(
        repository,
        { ...remote, url: 'git@github.com:ViktorSMI/desktop-plus.git' },
        [account('ViktorSMI')],
        null
      ),
      target
    )
  })
  it('matches Enterprise host and HTTPS port, rejecting accounts from another host', () => {
    const enterprise = {
      name: 'work',
      url: 'https://git.example.test:8443/team/project.git',
    }
    const selected = account(
      'work',
      'https://git.example.test:8443/api/v3',
      'enterprise'
    )
    assert.deepEqual(
      getActionsAccounts(
        [
          account('ViktorSMI'),
          selected,
          account('wrong', 'https://git.example.test/api/v3', 'enterprise'),
        ],
        enterprise
      ),
      [selected]
    )
    assert.equal(
      getActionsTarget(repository, enterprise, [selected], null)?.endpoint,
      selected.endpoint
    )
  })
  it('does not send GitHub Actions requests to GitLab, local paths, or nested groups', () => {
    assert.deepEqual(
      getActionsAccounts(
        [account('work', 'https://gitlab.com/api/v4', 'gitlab')],
        { name: 'gitlab', url: 'https://gitlab.com/a/b.git' }
      ),
      []
    )
    assert.equal(
      getActionsTarget(
        repository,
        { name: 'local', url: '/tmp/repo' },
        [account('a')],
        null
      ),
      null
    )
    assert.equal(
      getActionsTarget(
        repository,
        { ...remote, url: 'https://github.com/group/nested/repo' },
        [account('a')],
        null
      ),
      null
    )
  })
  it('builds paginated all-event GET requests with fresh cache and escaped path components', async () => {
    const client = new TestActionsClient(
      target.endpoint,
      'test-token',
      target.login
    )
    client.response = new Response(
      JSON.stringify({ total_count: 0, workflow_runs: [] })
    )
    await client.runs(
      { ...target, owner: 'team space', name: 'repo?x' },
      2,
      'failure'
    )
    assert.deepEqual(client.requests, [
      {
        endpoint: target.endpoint,
        method: 'GET',
        path: 'repos/team%20space/repo%3Fx/actions/runs?per_page=30&page=2&status=failure',
        reload: true,
      },
    ])
  })
  it('pins jobs to the observed run attempt and supports pages beyond 100 jobs', async () => {
    const client = new TestActionsClient(
      target.endpoint,
      'test-token',
      target.login
    )
    await client.jobs(target, 123, 3, 2)
    assert.equal(
      client.requests[0].path,
      'repos/ViktorSMI/desktop-plus/actions/runs/123/attempts/3/jobs?per_page=100&page=2'
    )
    assert.equal(client.requests[0].method, 'GET')
  })
  it('fetches a run by id and never executes the rerun or cancel endpoints', async () => {
    const client = new TestActionsClient(
      target.endpoint,
      'test-token',
      target.login
    )
    await client.run(target, 123)
    assert.equal(
      client.requests[0].path,
      'repos/ViktorSMI/desktop-plus/actions/runs/123'
    )
    assert.equal(client.requests[0].method, 'GET')
  })
  it('rejects unsafe identifiers and pages before requesting', async () => {
    const client = new TestActionsClient(target.endpoint, '', target.login)
    await assert.rejects(client.jobs(target, 123, 0, 1))
    await assert.rejects(client.run(target, NaN))
    await assert.rejects(client.runs(target, -1, ''))
    assert.equal(client.requests.length, 0)
  })
  it('surfaces access and rate-limit failures rather than an empty successful list', async () => {
    for (const status of [401, 403, 404, 429, 500]) {
      const client = new TestActionsClient(target.endpoint, '', target.login)
      client.response = new Response(
        JSON.stringify({ message: 'test error' }),
        { status }
      )
      await assert.rejects(client.runs(target, 1, ''), APIError)
      assert.ok(
        actionsErrorMessage(new APIError(client.response, null)).length > 10
      )
    }
  })
  it('constructs safe same-host run/job links, not URLs supplied by workflows', () => {
    assert.equal(
      actionsWebURL(target, 123, 456),
      'https://github.com/ViktorSMI/desktop-plus/actions/runs/123/job/456'
    )
    assert.equal(
      actionsWebURL(
        { ...target, endpoint: 'https://git.example.test:8443/api/v3' },
        123
      ),
      'https://git.example.test:8443/ViktorSMI/desktop-plus/actions/runs/123'
    )
  })
  it('reports status without confusing completion with success', () => {
    assert.equal(actionsStatus('completed', 'failure'), 'failure')
    assert.equal(actionsStatus('completed', null), 'completed')
    assert.equal(actionsStatus('in_progress', null), 'in progress')
    assert.equal(actionsStatus('waiting', null), 'waiting')
    assert.equal(actionsStatus(null, null), 'unknown')
  })
  it('handles missing times and prevents negative elapsed durations', () => {
    assert.equal(actionsDuration(null, null), 'Not started')
    assert.equal(actionsDuration('invalid', null), 'Not started')
    assert.equal(
      actionsDuration('2026-01-01T00:00:00Z', '2026-01-01T00:01:12Z'),
      '1m 12s'
    )
    assert.equal(
      actionsDuration('2026-01-01T00:00:00Z', '2025-12-31T23:59:00Z'),
      '0s'
    )
  })
})
