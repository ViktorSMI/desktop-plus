import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { API, GiteaAPI } from '../../src/lib/api'
import {
  CommitActionsClient,
  commitActionsTarget,
} from '../../src/lib/commit-actions-client'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'

const sha = 'a'.repeat(40)
const account = {
  endpoint: 'https://api.github.com',
  login: 'owner',
  apiType: 'dotcom',
  token: 'test-only',
} as Account
const repository = {
  name: 'repo',
  type: 'github',
  endpoint: account.endpoint,
  login: null,
  owner: { login: 'owner', endpoint: account.endpoint },
  parent: { name: 'upstream' },
} as GitHubRepository

describe('history Actions target and transport', () => {
  afterEach(() => mock.restoreAll())

  it('selects the history repository, not a fork parent', () => {
    const result = commitActionsTarget(repository, [account])
    assert.equal(result?.target.owner, 'owner')
    assert.equal(result?.target.name, 'repo')
    assert.equal(result?.account, account)
  })
  it('honors explicit login without falling back to another account', () => {
    const repo = { ...repository, login: 'other' } as GitHubRepository
    assert.equal(commitActionsTarget(repo, [account]), null)
    const other = { ...account, login: 'other' } as Account
    assert.equal(commitActionsTarget(repo, [account, other])?.account, other)
  })
  it('does not guess between ambiguous accounts or cross endpoints', () => {
    const repo = {
      ...repository,
      owner: { ...repository.owner, login: 'org' },
    } as GitHubRepository
    assert.equal(
      commitActionsTarget(repo, [
        account,
        { ...account, login: 'other' } as Account,
      ]),
      null
    )
    assert.equal(
      commitActionsTarget(repository, [
        { ...account, endpoint: 'https://other.example/api' } as Account,
      ]),
      null
    )
  })
  it('does not query unsupported providers or local repositories', () => {
    assert.equal(commitActionsTarget(null, [account]), null)
    for (const type of ['bitbucket', 'gitlab', 'forgejo'] as const) {
      assert.equal(
        commitActionsTarget({ ...repository, type } as GitHubRepository, [
          account,
        ]),
        null
      )
    }
  })
  it('uses full head_sha without filtering out push workflows', async () => {
    const resolved = commitActionsTarget(repository, [account])!
    const client = new CommitActionsClient(
      account.endpoint,
      account.token,
      account.login
    )
    const calls: unknown[][] = []
    // Test only: observe the inherited protected transport without making requests.
    mock.method(client as any, 'ghRequest', async (...args: unknown[]) => {
      calls.push(args)
      return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }))
    })
    assert.equal(
      (await client.forCommit(account, resolved.target, sha)).state,
      'none'
    )
    assert.equal(calls[0][0], 'GET')
    const path = String(calls[0][1])
    assert.ok(path.startsWith('repos/owner/repo/actions/runs?'))
    const query = new URLSearchParams(path.split('?')[1])
    assert.equal(query.get('head_sha'), sha)
    assert.equal(query.get('per_page'), '100')
    assert.equal(query.has('event'), false)
    assert.equal(query.has('status'), false)
  })
  it('uses the existing Gitea API singleton and limit pagination', async () => {
    const giteaAccount = {
      ...account,
      apiType: 'gitea',
      endpoint: 'https://git.example/team/api/v1',
    } as Account
    const repo = {
      ...repository,
      type: 'gitea',
      endpoint: giteaAccount.endpoint,
    } as GitHubRepository
    const resolved = commitActionsTarget(repo, [giteaAccount])!
    const api = Object.create(GiteaAPI.prototype) as GiteaAPI
    mock.method(API, 'fromAccount', () => api)
    let path = ''
    mock.method(api, 'fetchActionsResource', async (value: string) => {
      path = value
      return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }))
    })
    const client = new CommitActionsClient(
      giteaAccount.endpoint,
      giteaAccount.token,
      giteaAccount.login
    )
    await client.forCommit(giteaAccount, resolved.target, sha)
    assert.ok(path.includes(`head_sha=${sha}`))
    assert.ok(path.includes('limit=100'))
    assert.equal(path.includes('per_page'), false)
  })
  it('rejects invalid SHA, repository components and mismatched accounts before HTTP', async () => {
    const target = commitActionsTarget(repository, [account])!.target
    const client = new CommitActionsClient(
      account.endpoint,
      account.token,
      account.login
    )
    let calls = 0
    mock.method(client as any, 'ghRequest', async () => {
      calls++
      throw new Error('Must not call')
    })
    await assert.rejects(client.forCommit(account, target, 'main'))
    await assert.rejects(
      client.forCommit(account, { ...target, owner: '..' }, sha)
    )
    await assert.rejects(
      client.forCommit(account, { ...target, login: 'other' }, sha)
    )
    assert.equal(calls, 0)
  })
})
