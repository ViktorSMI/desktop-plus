import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  canSyncRemotes,
  getUserRemotes,
  IRemote,
} from '../../src/models/remote'

const remote = (name: string): IRemote => ({
  name,
  url: `https://example.com/${name}`,
})

describe('sync remote configuration', () => {
  it('falls back to ordinary actions after removing or adding a user remote', () => {
    assert.equal(canSyncRemotes([]), false)
    assert.equal(canSyncRemotes([remote('origin')]), false)
    assert.equal(canSyncRemotes([remote('origin'), remote('backup')]), true)
    assert.equal(
      canSyncRemotes([remote('origin'), remote('backup'), remote('third')]),
      false
    )
  })

  it('does not count generated pull-request remotes as user remotes', () => {
    const origin = remote('origin')
    const backup = remote('backup')
    const generated = remote('github-desktop-contributor')
    assert.deepEqual(getUserRemotes([origin, generated, backup]), [
      origin,
      backup,
    ])
    assert.equal(canSyncRemotes([origin, generated]), false)
    assert.equal(canSyncRemotes([origin, generated, backup]), true)
  })
})
