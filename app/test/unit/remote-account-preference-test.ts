import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import {
  clearRemoteAccountLogin,
  getAccountsForRemote,
  getRemoteAccountLogin,
  inferRemoteAccountLogin,
  setRemoteAccountLogin,
} from '../../src/lib/remote-account-preference'

const account = (login: string) =>
  new Account(
    login,
    getDotComAPIEndpoint(),
    'dotcom',
    'token',
    '',
    0,
    [],
    '',
    login.length,
    login
  )

describe('remote account preferences', () => {
  it('stores a choice independently for every repository and remote', () => {
    const path = '/tmp/account-routing'
    clearRemoteAccountLogin(path, 'origin')
    clearRemoteAccountLogin(path, 'upstream')

    setRemoteAccountLogin(path, 'origin', 'alice')
    setRemoteAccountLogin(path, 'upstream', 'bob')

    assert.equal(getRemoteAccountLogin(path, 'origin'), 'alice')
    assert.equal(getRemoteAccountLogin(path, 'upstream'), 'bob')

    clearRemoteAccountLogin(path, 'origin')
    clearRemoteAccountLogin(path, 'upstream')
  })

  it('matches signed-in accounts only for HTTPS remotes on that host', () => {
    const accounts = [account('alice'), account('bob')]

    assert.deepEqual(
      getAccountsForRemote(accounts, {
        name: 'origin',
        url: 'https://github.com/alice/project.git',
      }).map(a => a.login),
      ['alice', 'bob']
    )

    assert.deepEqual(
      getAccountsForRemote(accounts, {
        name: 'origin',
        url: 'git@github.com:alice/project.git',
      }),
      []
    )
  })

  it('returns no accounts for malformed HTTPS origins without throwing', () => {
    for (const accounts of [[], [account('alice')]]) {
      assert.deepEqual(
        getAccountsForRemote(accounts, {
          name: 'origin',
          url: 'https://git.example.com:99999/owner/repo.git',
        }),
        []
      )
    }
  })

  it('keeps accounts on distinct HTTPS ports separate, including identical logins', () => {
    const makeAccount = (port: string) =>
      new Account(
        'alice',
        `https://git.example.com${port}/api/v3`,
        'enterprise',
        'token',
        '',
        0,
        [],
        '',
        1,
        'alice'
      )
    const standard = makeAccount('')
    const custom = makeAccount(':8443')
    const accounts = [standard, custom]

    assert.deepEqual(
      getAccountsForRemote(accounts, {
        name: 'origin',
        url: 'https://git.example.com:8443/alice/project.git',
      }),
      [custom]
    )
    assert.deepEqual(
      getAccountsForRemote(accounts, {
        name: 'origin',
        url: 'https://git.example.com:443/alice/project.git',
      }),
      [standard]
    )
    assert.deepEqual(
      getAccountsForRemote(accounts, {
        name: 'origin',
        url: 'https://git.example.com:9443/alice/project.git',
      }),
      []
    )
  })

  it('infers fork owners and the repository account for origin', () => {
    const accounts = [account('alice'), account('bob')]

    assert.equal(
      inferRemoteAccountLogin(
        accounts,
        { name: 'personal', url: 'https://github.com/bob/project.git' },
        'alice'
      ),
      'bob'
    )

    assert.equal(
      inferRemoteAccountLogin(
        accounts,
        { name: 'origin', url: 'https://github.com/acme/project.git' },
        'alice'
      ),
      'alice'
    )

    assert.equal(
      inferRemoteAccountLogin(
        accounts,
        { name: 'upstream', url: 'https://github.com/acme/project.git' },
        'alice'
      ),
      null
    )
  })
})
