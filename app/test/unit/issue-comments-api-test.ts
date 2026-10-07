import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API, GitLabAPI } from '../../src/lib/api'

describe('issue comment errors', () => {
  for (const Provider of [API, GitLabAPI]) {
    it(`${Provider.name} rejects a failed comment request instead of returning an empty list`, async () => {
      const api: API = Object.create(Provider.prototype)
      const error = new Error('Request failed')
      Object.defineProperty(api, 'fetchAll', {
        value: async () => {
          throw error
        },
      })
      await assert.rejects(api.fetchIssueComments('owner', 'repo', '1'), error)
    })

    it(`${Provider.name} permits a successful empty comment response`, async () => {
      const api: API = Object.create(Provider.prototype)
      Object.defineProperty(api, 'fetchAll', { value: async () => [] })
      assert.deepEqual(await api.fetchIssueComments('owner', 'repo', '1'), [])
    })
  }
})
