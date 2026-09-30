import { API, GiteaAPI } from './api'
import { parsedResponse } from './http'
import { Account } from '../models/account'
import { GitHubRepository } from '../models/github-repository'
import { IActionsTarget } from '../models/actions'
import { loadCommitActions, validateCommitSHA } from './commit-actions'

/** Use the history repository itself, never a fork's upstream parent. */
export function commitActionsTarget(
  repository: GitHubRepository | null,
  accounts: ReadonlyArray<Account>
): { readonly account: Account; readonly target: IActionsTarget } | null {
  if (repository === null || !['github', 'gitea'].includes(repository.type)) {
    return null
  }
  const provider = repository.type === 'gitea' ? 'gitea' : 'github'
  const candidates = accounts.filter(
    a =>
      a.endpoint === repository.endpoint &&
      (provider === 'gitea'
        ? a.apiType === 'gitea'
        : a.apiType === 'dotcom' || a.apiType === 'enterprise')
  )
  const account =
    repository.login !== null
      ? candidates.find(a => a.login === repository.login)
      : candidates.find(a => a.login === repository.owner.login) ??
        (candidates.length === 1 ? candidates[0] : undefined)
  return account === undefined
    ? null
    : {
        account,
        target: {
          provider,
          endpoint: account.endpoint,
          login: account.login,
          owner: repository.owner.login,
          name: repository.name,
        },
      }
}

function component(value: string) {
  if (
    value === '' ||
    value === '.' ||
    value === '..' ||
    /[\/\\?#]/.test(value)
  ) {
    throw new Error('Invalid Actions repository component')
  }
  return encodeURIComponent(value)
}

/** Same authenticated transport as the Actions tab. GET requests only. */
export class CommitActionsClient extends API {
  public async forCommit(
    account: Account,
    target: IActionsTarget,
    sha: string
  ) {
    const head = validateCommitSHA(sha)
    if (
      account.endpoint !== target.endpoint ||
      account.login !== target.login
    ) {
      throw new Error('Actions account does not match history repository')
    }
    const path = `repos/${component(target.owner)}/${component(
      target.name
    )}/actions/runs`
    const gitea = target.provider === 'gitea' ? API.fromAccount(account) : null
    if (target.provider === 'gitea' && !(gitea instanceof GiteaAPI)) {
      throw new Error('Expected the selected Gitea API instance')
    }
    return loadCommitActions(head, async page => {
      const query = new URLSearchParams({
        head_sha: head,
        page: String(page),
        [target.provider === 'gitea' ? 'limit' : 'per_page']: '100',
      })
      const response =
        gitea instanceof GiteaAPI
          ? await gitea.fetchActionsResource(`${path}?${query}`)
          : await this.ghRequest('GET', `${path}?${query}`, {
              reloadCache: true,
            })
      const link = response.headers.get('link')
      return {
        body: await parsedResponse<unknown>(response),
        // Never follow server-supplied pagination URLs with account credentials.
        hasNextPage:
          link === null ? undefined : /rel="?next"?(?:\s|,|$)/.test(link),
      }
    })
  }
}
