import { API, GiteaAPI, getHTMLURL } from './api'
import { deriveWebBaseUrl } from './endpoint-api-type-registry'
import { GiteaActionsClient } from './gitea-actions-client'
import { APIError, parsedResponse } from './http'
import { Account } from '../models/account'
import { Repository } from '../models/repository'
import { IRemote } from '../models/remote'
import { asHost, parseRemote } from './remote-parsing'
import {
  ActionsProvider,
  ActionsRunFilter,
  IActionsJob,
  IActionsJobsPage,
  IActionsRun,
  IActionsRunsPage,
  IActionsTarget,
} from '../models/actions'

export type ActionsAccount = Pick<Account, 'endpoint' | 'login' | 'apiType'>

export const ActionsRunsPerPage = 30
export const ActionsJobsPerPage = 100

export function actionsProviderName(provider: ActionsProvider) {
  return provider === 'gitea' ? 'Gitea' : 'GitHub'
}

function webRoot(endpoint: string, provider: ActionsProvider) {
  return (
    provider === 'gitea'
      ? deriveWebBaseUrl(endpoint, 'gitea')
      : getHTMLURL(endpoint)
  ).replace(/\/+$/, '')
}

/** Match the full HTTP instance root; SSH ports are not web/API ports. */
function remoteOwner(account: ActionsAccount, remote: IRemote): string | null {
  const parsed = parseRemote(remote.url)
  if (parsed === null) {
    return null
  }
  if (account.apiType !== 'gitea') {
    return parsed.owner.includes('/') ||
      new URL(getHTMLURL(account.endpoint)).host.toLowerCase() !==
        asHost(parsed).toLowerCase()
      ? null
      : parsed.owner
  }
  const root = new URL(webRoot(account.endpoint, 'gitea'))
  let owner = parsed.owner
  if (parsed.protocol === 'ssh') {
    if (root.hostname.toLowerCase() !== parsed.hostname.toLowerCase()) {
      return null
    }
  } else {
    const url = new URL(remote.url)
    if (root.origin !== url.origin) {
      return null
    }
    const prefix = root.pathname.replace(/^\/|\/$/g, '')
    if (prefix !== '') {
      if (!owner.startsWith(`${prefix}/`)) {
        return null
      }
      owner = owner.slice(prefix.length + 1)
    }
  }
  // Gitea owners are one path component, even when the instance has a prefix.
  const decoded = decodeURIComponent(owner)
  return decoded === '' ||
    decoded === '.' ||
    decoded === '..' ||
    /[\/\\]/.test(decoded)
    ? null
    : decoded
}

/** Other providers must not receive GitHub or Gitea Actions endpoints. */
export function getActionsAccounts(
  accounts: ReadonlyArray<ActionsAccount>,
  remote: IRemote
) {
  return accounts.filter(account => {
    if (!['dotcom', 'enterprise', 'gitea'].includes(account.apiType)) {
      return false
    }
    try {
      return remoteOwner(account, remote) !== null
    } catch {
      return false
    }
  })
}

/** Resolve the actual remote, not a fork's upstream contribution target. */
export function getActionsTarget(
  repository: Repository,
  remote: IRemote,
  accounts: ReadonlyArray<ActionsAccount>,
  preferredLogin: string | null,
  preferredEndpoint: string | null = null
): IActionsTarget | null {
  const parsed = parseRemote(remote.url)
  const candidates = getActionsAccounts(accounts, remote).filter(
    a => preferredEndpoint === null || a.endpoint === preferredEndpoint
  )
  if (parsed === null || candidates.length === 0) {
    return null
  }
  // An SSH host can expose multiple web instances/ports. Never guess between them.
  if (new Set(candidates.map(a => a.endpoint)).size > 1) {
    return null
  }
  const account =
    preferredLogin !== null
      ? candidates.find(a => a.login === preferredLogin)
      : candidates.find(a => a.login === repository.login) ??
        candidates.find(
          a => a.login.toLowerCase() === remoteOwner(a, remote)?.toLowerCase()
        ) ??
        (candidates.length === 1 ? candidates[0] : undefined)
  return account === undefined
    ? null
    : {
        provider: account.apiType === 'gitea' ? 'gitea' : 'github',
        endpoint: account.endpoint,
        owner: remoteOwner(account, remote)!,
        name: parsed.name,
        login: account.login,
      }
}

export function actionsTargetKey(target: IActionsTarget) {
  return JSON.stringify([
    target.provider,
    target.endpoint,
    target.owner,
    target.name,
    target.login,
  ])
}

/** Construct links from the trusted target; never open URLs from API payloads. */
export function actionsWebURL(
  target: IActionsTarget,
  runId?: number,
  jobId?: number
) {
  const base = webRoot(target.endpoint, target.provider)
  return (
    `${base}/${encodeURIComponent(target.owner)}/${encodeURIComponent(
      target.name
    )}/actions` +
    (runId === undefined ? '' : `/runs/${positiveInteger(runId)}`) +
    (jobId === undefined ? '' : `/job/${positiveInteger(jobId)}`)
  )
}

/** Gitea web routes use run_number, whereas REST routes use the database id. */
export function actionsRunWebURL(target: IActionsTarget, run: IActionsRun) {
  return actionsWebURL(
    target,
    target.provider === 'gitea' ? run.run_number : run.id
  )
}

export function actionsJobWebURL(
  target: IActionsTarget,
  run: IActionsRun,
  job: IActionsJob
) {
  if (target.provider !== 'gitea') {
    return actionsWebURL(target, run.id, job.id)
  }
  const runURL = actionsRunWebURL(target, run)
  // Gitea changed job web identifiers from zero-based indexes to database ids.
  // Accept either only inside this trusted instance/repository/run; never follow
  // an arbitrary URL supplied by a workflow or guess a job id on older servers.
  try {
    const expected = new URL(runURL)
    const supplied = new URL(job.html_url ?? '')
    const prefix = `${expected.pathname}/jobs/`
    const suffix = supplied.pathname.slice(prefix.length)
    if (
      supplied.origin === expected.origin &&
      supplied.username === '' &&
      supplied.password === '' &&
      supplied.pathname.startsWith(prefix) &&
      /^(0|[1-9]\d*)$/.test(suffix) &&
      Number.isSafeInteger(Number(suffix))
    ) {
      return `${runURL}/jobs/${suffix}`
    }
  } catch {
    // Missing/malformed links fall back to this run, not another host.
  }
  return runURL
}

function positiveInteger(value: number | null) {
  if (value === null || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Expected a positive Actions identifier or page')
  }
  return value
}

/** Reuses the app's authenticated HTTP/token handling; all methods are GETs. */
export class ActionsClient extends API {
  private repositoryPath(target: IActionsTarget) {
    return `repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(
      target.name
    )}/actions/runs`
  }

  public async runs(
    target: IActionsTarget,
    page: number,
    status: ActionsRunFilter
  ): Promise<IActionsRunsPage> {
    const query = new URLSearchParams({
      per_page: String(ActionsRunsPerPage),
      page: String(positiveInteger(page)),
    })
    if (status !== '') {
      query.set('status', status)
    }
    const response = await this.ghRequest(
      'GET',
      `${this.repositoryPath(target)}?${query}`,
      { reloadCache: true }
    )
    return parsedResponse<IActionsRunsPage>(response)
  }

  public async run(target: IActionsTarget, id: number): Promise<IActionsRun> {
    return parsedResponse<IActionsRun>(
      await this.ghRequest(
        'GET',
        `${this.repositoryPath(target)}/${positiveInteger(id)}`,
        { reloadCache: true }
      )
    )
  }

  public async jobs(
    target: IActionsTarget,
    id: number,
    attempt: number | null,
    page: number
  ): Promise<IActionsJobsPage> {
    // Pin the attempt: a rerun must not mix old run metadata with new jobs.
    const path = `${this.repositoryPath(target)}/${positiveInteger(
      id
    )}/attempts/${positiveInteger(
      attempt
    )}/jobs?per_page=${ActionsJobsPerPage}&page=${positiveInteger(page)}`
    return parsedResponse<IActionsJobsPage>(
      await this.ghRequest('GET', path, { reloadCache: true })
    )
  }
}

/** Keep Gitea OAuth refresh state on the application's existing API singleton. */
export function createActionsClient(account: Account, target: IActionsTarget) {
  if (account.endpoint !== target.endpoint || account.login !== target.login) {
    throw new Error('Actions account does not match the selected target')
  }
  if (target.provider === 'gitea' && account.apiType === 'gitea') {
    const api = API.fromAccount(account)
    if (api instanceof GiteaAPI) {
      return new GiteaActionsClient(api, account.endpoint)
    }
  } else if (
    target.provider === 'github' &&
    (account.apiType === 'dotcom' || account.apiType === 'enterprise')
  ) {
    return new ActionsClient(account.endpoint, account.token, account.login)
  }
  throw new Error('Unsupported Actions account provider')
}

export function actionsErrorMessage(
  error: unknown,
  provider: ActionsProvider = 'github'
): string {
  const name = actionsProviderName(provider)
  if (error instanceof APIError) {
    switch (error.responseStatus) {
      case 401:
        return `Sign in again to the selected ${name} account, then refresh.`
      case 403:
      case 429:
        return `${name} denied access or rate-limited this request. Check repository/Actions read permission and account authorization, or wait before refreshing.`
      case 404:
        if (provider === 'gitea') {
          return 'Gitea Actions API or this run is unavailable. This view requires Gitea 1.25 or later with Actions enabled and repository access. Open Actions in the browser to check the server.'
        }
        return 'Actions or this run is unavailable. Check the selected remote, account access, and whether the run still exists.'
    }
  }
  return 'Unable to load Actions. Check your connection and selected account, then refresh.'
}

export function actionsStatus(
  status: string | null,
  conclusion: string | null
) {
  const value =
    status === 'completed' ? conclusion ?? 'completed' : status ?? 'unknown'
  return value.replace(/_/g, ' ')
}

export function actionsDuration(
  start: string | null,
  end: string | null,
  now = Date.now()
) {
  const first = start === null ? NaN : Date.parse(start)
  const last = end === null ? now : Date.parse(end)
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return 'Not started'
  }
  const seconds = Math.max(0, Math.floor((last - first) / 1000))
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
