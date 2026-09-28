import { API, getHTMLURL } from './api'
import { APIError, parsedResponse } from './http'
import { Account } from '../models/account'
import { Repository } from '../models/repository'
import { IRemote } from '../models/remote'
import { asHost, parseRemote } from './remote-parsing'
import {
  ActionsRunFilter,
  IActionsJobsPage,
  IActionsRun,
  IActionsRunsPage,
  IActionsTarget,
} from '../models/actions'

export type ActionsAccount = Pick<Account, 'endpoint' | 'login' | 'apiType'>

export const ActionsRunsPerPage = 30
export const ActionsJobsPerPage = 100

/** GitHub only: other providers must not receive GitHub Actions endpoints. */
export function getActionsAccounts(
  accounts: ReadonlyArray<ActionsAccount>,
  remote: IRemote
) {
  const parsed = parseRemote(remote.url)
  if (parsed === null || parsed.owner.includes('/')) {
    return []
  }
  return accounts.filter(account => {
    if (account.apiType !== 'dotcom' && account.apiType !== 'enterprise') {
      return false
    }
    try {
      return (
        new URL(getHTMLURL(account.endpoint)).host.toLowerCase() ===
        asHost(parsed).toLowerCase()
      )
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
  preferredLogin: string | null
): IActionsTarget | null {
  const parsed = parseRemote(remote.url)
  const candidates = getActionsAccounts(accounts, remote)
  if (parsed === null) {
    return null
  }
  const account =
    preferredLogin !== null
      ? candidates.find(a => a.login === preferredLogin)
      : candidates.find(a => a.login === repository.login) ??
        candidates.find(
          a => a.login.toLowerCase() === parsed.owner.toLowerCase()
        ) ??
        (candidates.length === 1 ? candidates[0] : undefined)
  return account === undefined
    ? null
    : {
        endpoint: account.endpoint,
        owner: parsed.owner,
        name: parsed.name,
        login: account.login,
      }
}

export function actionsTargetKey(target: IActionsTarget) {
  return JSON.stringify([
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
  const base = getHTMLURL(target.endpoint).replace(/\/$/, '')
  return (
    `${base}/${encodeURIComponent(target.owner)}/${encodeURIComponent(
      target.name
    )}/actions` +
    (runId === undefined ? '' : `/runs/${positiveInteger(runId)}`) +
    (jobId === undefined ? '' : `/job/${positiveInteger(jobId)}`)
  )
}

function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
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
    attempt: number,
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

export function actionsErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    switch (error.responseStatus) {
      case 401:
        return 'Sign in again to the selected GitHub account, then refresh.'
      case 403:
      case 429:
        return 'GitHub denied access or rate-limited this request. Check Actions read permission and any SSO authorization, or wait before refreshing.'
      case 404:
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
