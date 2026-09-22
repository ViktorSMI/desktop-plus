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
