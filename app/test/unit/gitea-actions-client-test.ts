import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GiteaActionsClient } from '../../src/lib/gitea-actions-client'
import {
  actionsErrorMessage,
  actionsJobWebURL,
  actionsRunWebURL,
  actionsTargetKey,
  createActionsClient,
  getActionsAccounts,
  getActionsTarget,
} from '../../src/lib/actions-client'
import { GiteaAPI } from '../../src/lib/api'
import { APIError, HTTPMethod } from '../../src/lib/http'
import { Account } from '../../src/models/account'
import { Repository } from '../../src/models/repository'
import { IActionsJob, IActionsTarget } from '../../src/models/actions'

const target: IActionsTarget = {
  provider: 'gitea',
  endpoint: 'https://git.example.test:8443/gitea/api/v1',
  owner: 'team',
  name: 'project',
  login: 'tester',
}
const repository = new Repository('/repos/project', 1, null, false)
const remote = {
  name: 'origin',
  url: 'https://git.example.test:8443/gitea/team/project.git',
}
const rawRun = {
  id: 501,
  run_number: 7,
  display_title: 'Compile <b>not HTML</b>',
  path: 'ci.yml@refs/heads/main',
  head_branch: 'main',
  head_sha: 'abc12345',
  event: 'push',
  status: 'in_progress',
  conclusion: '',
  run_started_at: '2026-01-01T00:00:00Z',
  actor: { login: 'tester' },
}
const rawJob = {
  id: 9001,
  run_id: 501,
  run_attempt: 2,
  name: 'Build Linux',
  status: 'in_progress',
  conclusion: '',
  started_at: '2026-01-01T00:00:00Z',
  completed_at: '1970-01-01T00:00:00Z',
  html_url:
    'https://git.example.test:8443/gitea/team/project/actions/runs/7/jobs/0',
  steps: [
    {
      number: 0,
      name: 'Compile',
      status: 'in_progress',
      conclusion: '',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '0001-01-01T00:00:00Z',
    },
  ],
}
function account(endpoint = target.endpoint, login = target.login) {
  return new Account(
    login,
    endpoint,
    'gitea',
    'test-token',
    '',
    0,
    [],
    '',
    42,
    login
  )
}

class TestGiteaAPI extends GiteaAPI {
  public readonly requests: {
    endpoint: string
    method: HTTPMethod
    path: string
    reload: boolean
  }[] = []
  public body: unknown = { total_count: 1, workflow_runs: [rawRun] }
  public status = 200
  public headers: Record<string, string> = {}

  public constructor() {
    super(target.endpoint, 'test-token', target.login, '', 0)
  }

  protected override async request(
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
    return new Response(JSON.stringify(this.body), {
      status: this.status,
      headers: this.headers,
    })
  }
}
function setup() {
  const api = new TestGiteaAPI()
  return { api, client: new GiteaActionsClient(api, target.endpoint) }
}

describe('Gitea Actions adapter', () => {
  it('routes self-hosted prefixes, HTTPS ports and Gitea Cloud to the actual remote', () => {
    assert.deepEqual(
      getActionsTarget(repository, remote, [account()], null),
      target
    )
    const cloud = account('https://gitea.com/api/v1')
    assert.deepEqual(
      getActionsAccounts([cloud], {
        name: 'cloud',
        url: 'https://gitea.com/team/project.git',
      }),
      [cloud]
    )
    for (const url of [
      'https://git.example.test/gitea/team/project.git',
      'https://git.example.test:8443/other/team/project.git',
      'https://git.example.test:8443/gitea/team/nested/project.git',
      'http://git.example.test:8443/gitea/team/project.git',
      'https://evil.test/gitea/team/project.git',
    ]) {
      assert.deepEqual(getActionsAccounts([account()], { ...remote, url }), [])
    }
  })
  it('handles SSH without confusing its port with the web port and refuses ambiguous instances', () => {
    const ssh = {
      name: 'ssh',
      url: 'ssh://git@git.example.test:2222/team/project.git',
    }
    assert.deepEqual(
      getActionsTarget(repository, ssh, [account()], null),
      target
    )
    const other = account('https://git.example.test/another/api/v1')
    assert.equal(
      getActionsTarget(repository, ssh, [account(), other], target.login),
      null
    )
    assert.deepEqual(
      getActionsTarget(
        repository,
        ssh,
        [account(), other],
        target.login,
        target.endpoint
      ),
      target
    )
    assert.equal(
      getActionsTarget(repository, ssh, [account()], 'missing'),
      null
    )
  })
  it('uses the existing Gitea API factory without putting credentials into target state', () => {
    assert.ok(
      createActionsClient(account(), target) instanceof GiteaActionsClient
    )
    assert.throws(() =>
      createActionsClient(account(), { ...target, provider: 'github' })
    )
    assert.throws(() =>
      createActionsClient(account(), { ...target, login: 'other' })
    )
    assert.notEqual(
      actionsTargetKey(target),
      actionsTargetKey({ ...target, provider: 'github' })
    )
    assert.equal(
      JSON.stringify(
        getActionsTarget(repository, remote, [account()], null)
      ).includes('test-token'),
      false
    )
  })
  it('normalizes the 1.25 response without fabricated names, dates or attempts', async () => {
    const { api, client } = setup()
    const result = await client.runs(target, 2, 'failure')
    const run = result.workflow_runs[0]
    assert.equal(run.id, 501)
    assert.equal(run.run_number, 7)
    assert.equal(run.run_attempt, null)
    assert.equal(run.name, 'ci.yml')
    assert.equal(run.created_at, null)
    assert.equal(run.updated_at, null)
    assert.equal(run.conclusion, null)
    assert.equal(run.started_at, rawRun.run_started_at)
    assert.deepEqual(api.requests, [
      {
        endpoint: target.endpoint,
        method: 'GET',
        path: 'repos/team/project/actions/runs?limit=30&page=2&status=failure',
        reload: true,
      },
    ])
  })
  it('uses database ids for REST, run numbers for web links, and latest jobs on older servers', async () => {
    const { api, client } = setup()
    api.body = rawRun
    const run = await client.run(target, 501)
    assert.equal(api.requests[0].path, 'repos/team/project/actions/runs/501')
    assert.equal(
      actionsRunWebURL(target, run),
      'https://git.example.test:8443/gitea/team/project/actions/runs/7'
    )
    api.body = { total_count: 101, jobs: [rawJob] }
    const result = await client.jobs(target, run.id, run.run_attempt, 2)
    assert.equal(
      api.requests[1].path,
      'repos/team/project/actions/runs/501/jobs?limit=50&page=2'
    )
    assert.equal(result.hasNextPage, true)
    assert.equal(result.jobs[0].conclusion, null)
    assert.equal(result.jobs[0].completed_at, null)
    assert.equal(result.jobs[0].steps?.[0].number, 1)
    assert.equal(result.jobs[0].steps?.[0].completed_at, null)
  })
  it('pins jobs to the observed attempt when the server exposes run_attempt', async () => {
    const { api, client } = setup()
    api.body = { ...rawRun, run_attempt: 2 }
    const run = await client.run(target, 501)
    api.body = { total_count: 1, jobs: [rawJob] }
    await client.jobs(target, run.id, run.run_attempt, 1)
    assert.equal(
      api.requests[1].path,
      'repos/team/project/actions/runs/501/attempts/2/jobs?limit=50&page=1'
    )
    api.body = { total_count: 1, jobs: [{ ...rawJob, run_attempt: 3 }] }
    await assert.rejects(client.jobs(target, 501, 2, 1), /another attempt/)
    api.body = { total_count: 1, jobs: [{ ...rawJob, run_id: 502 }] }
    await assert.rejects(client.jobs(target, 501, null, 1), /another run/)
  })
  it('honors server pagination links without following their potentially unsafe URLs', async () => {
    const { api, client } = setup()
    api.headers = { link: '<https://untrusted.test/?page=2>; rel="next"' }
    api.body = { total_count: 20, workflow_runs: [rawRun] }
    assert.equal((await client.runs(target, 1, '')).hasNextPage, true)
    assert.equal(api.requests.length, 1)
    assert.equal(api.requests[0].endpoint, target.endpoint)
    api.headers = { link: '<https://untrusted.test/?page=1>; rel="prev"' }
    api.body = { total_count: 1000, jobs: [rawJob] }
    assert.equal((await client.jobs(target, 501, null, 3)).hasNextPage, false)
  })
  it('accepts validated legacy index and modern database-id job links, rejecting foreign links', async () => {
    const { api, client } = setup()
    api.body = rawRun
    const run = await client.run(target, 501)
    const job: IActionsJob = { ...rawJob, steps: [] }
    const base = actionsRunWebURL(target, run)
    for (const suffix of ['0', '9001']) {
      assert.equal(
        actionsJobWebURL(target, run, {
          ...job,
          html_url: `${base}/jobs/${suffix}?download=1#step:1`,
        }),
        `${base}/jobs/${suffix}`
      )
    }
    for (const html_url of [
      `https://evil.test/team/project/actions/runs/7/jobs/0`,
      `${base.replace('/runs/7', '/runs/8')}/jobs/0`,
      `${base.replace('/team/project/', '/other/project/')}/jobs/0`,
      `${base}/jobs/-1`,
      `${base}/jobs/0/logs`,
      `${base}/jobs/NaN`,
      `${base}/jobs/9007199254740992`,
      `javascript:alert(1)`,
      `${base.replace('https://', 'https://password@')}/jobs/0`,
      '',
    ]) {
      assert.equal(actionsJobWebURL(target, run, { ...job, html_url }), base)
    }
  })
  it('rejects malformed successful responses instead of presenting an empty success', async () => {
    const { api, client } = setup()
    for (const body of [
      null,
      {},
      { total_count: 1, workflow_runs: {} },
      { total_count: -1, workflow_runs: [] },
      { total_count: 1, workflow_runs: [{ ...rawRun, id: 0 }] },
    ]) {
      api.body = body
      await assert.rejects(client.runs(target, 1, ''))
    }
    api.body = { ...rawRun, id: 502 }
    await assert.rejects(client.run(target, 501), /different workflow/)
  })
  it('rejects unsafe targets and identifiers before sending a request', async () => {
    const { api, client } = setup()
    await assert.rejects(
      client.runs({ ...target, endpoint: 'https://evil.test/api/v1' }, 1, '')
    )
    await assert.rejects(client.run({ ...target, owner: '..' }, 501))
    await assert.rejects(client.jobs(target, 501, 0, 1))
    await assert.rejects(client.run(target, NaN))
    await assert.rejects(client.runs(target, -1, ''))
    for (const path of [
      'repos/../project/actions/runs',
      'repos/%2e%2e/project/actions/runs',
      'repos/team%2Fother/project/actions/runs',
      'users/me',
      'repos/team/project/actions/runs/1/rerun',
      'https://evil.test/runs',
      'repos/team/project/actions/runs/1/logs',
    ]) {
      await assert.rejects(api.fetchActionsResource(path))
    }
    assert.equal(api.requests.length, 0)
  })
  it('reports permission, rate limit and unsupported-version failures as Gitea errors', async () => {
    const { api, client } = setup()
    for (const status of [401, 403, 404, 429, 500]) {
      api.status = status
      api.body = { message: 'not available' }
      await assert.rejects(client.runs(target, 1, ''), APIError)
    }
    const message = actionsErrorMessage(
      new APIError(new Response('', { status: 404 }), null),
      'gitea'
    )
    assert.match(message, /Gitea 1.25/)
    assert.equal(message.includes('GitHub'), false)
  })
  it('keeps terminal results and missing steps distinct from running work', async () => {
    const { api, client } = setup()
    api.body = {
      total_count: 1,
      workflow_runs: [
        {
          ...rawRun,
          status: 'completed',
          conclusion: 'cancelled',
          run_started_at: '1970-01-01T00:00:00Z',
          actor: null,
        },
      ],
    }
    const run = (await client.runs(target, 1, 'completed')).workflow_runs[0]
    assert.equal(run.conclusion, 'cancelled')
    assert.equal(run.started_at, null)
    api.body = { total_count: 1, jobs: [{ ...rawJob, steps: null }] }
    assert.equal(
      (await client.jobs(target, 501, null, 1)).jobs[0].steps,
      undefined
    )
  })
})
