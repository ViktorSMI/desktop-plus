import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../../src/models/account'
import { CredentialSessions } from '../../src/lib/credential-sessions'
import { AsyncInMemoryStore } from '../helpers/stores'

const endpoint = 'https://api.github.com'
const makeAccount = (login: string, id: number) =>
  new Account(
    login,
    endpoint,
    'dotcom',
    `${login}-token`,
    '',
    0,
    [],
    '',
    id,
    login
  )

describe('CredentialSessions multiple accounts on one host', () => {
  it('rotates and retires only the selected identity', async () => {
    const first = makeAccount('first', 1)
    const second = makeAccount('second', 2)
    const signedOut: string[] = []
    const renewed: string[] = []
    const sessions: CredentialSessions = new CredentialSessions(
      new AsyncInMemoryStore(),
      {
        requireSignIn: async account => {
          sessions.retire(account.endpoint, account.login)
          signedOut.push(account.login)
          return account
        },
        onTokenRenewed: (_endpoint, _token, login) => renewed.push(login!),
        onSignedIn: () => {},
      },
      async (_endpoint, token) => ({ accessToken: `${token}-renewed` }),
      () => 1_000,
      async () => true
    )
    sessions.restore(first, {
      accessToken: first.token,
      refreshToken: 'first-refresh',
      expiresAt: 1_001,
    })
    sessions.restore(second, { accessToken: second.token })
    assert.equal(await sessions.getFreshToken(first), 'first-refresh-renewed')
    assert.equal(await sessions.getFreshToken(second), second.token)
    assert.deepEqual(renewed, ['first'])
    assert.equal(sessions.trackToken(endpoint)(), null)
    await sessions.invalidateToken(endpoint, 'first-refresh-renewed')
    assert.deepEqual(signedOut, ['first'])
    assert.equal(await sessions.getFreshToken(second), second.token)
  })

  it('adding and deleting one login preserves another login on the same host', async () => {
    const first = makeAccount('first', 1)
    const second = makeAccount('second', 2)
    const sessions = new CredentialSessions(new AsyncInMemoryStore(), {
      requireSignIn: async () => null,
      onTokenRenewed: () => {},
      onSignedIn: () => {},
    })
    await sessions.add(first, { accessToken: first.token })
    await sessions.add(second, { accessToken: second.token })
    sessions.retire(endpoint, first.login)
    await sessions.delete(first)
    assert.equal(
      await sessions.resolveToken(endpoint, second.token),
      second.token
    )
    assert.equal(await sessions.getFreshToken(second), second.token)
  })
})
