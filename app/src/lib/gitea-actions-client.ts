import { GiteaAPI } from './api'
import { parsedResponse } from './http'
import {
  ActionsRunFilter,
  IActionsJob,
  IActionsJobsPage,
  IActionsRun,
  IActionsRunsPage,
  IActionsStep,
  IActionsTarget,
} from '../models/actions'

const RunsPerPage = 30
const JobsPerPage = 50

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid Gitea Actions response')
  }
  return value as Record<string, unknown>
}

function integer(value: unknown, minimum = 1): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error('Invalid Gitea Actions identifier, count or page')
  }
  return value
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Older Gitea versions serialize an unset timestamp as the Unix epoch. */
function timestamp(value: unknown): string | null {
  const result = text(value)
  return result !== null &&
    Number.isFinite(Date.parse(result)) &&
    Date.parse(result) > 0
    ? result
    : null
}

function normalizeRun(value: unknown): IActionsRun {
  const run = record(value)
  const path = text(run.path)?.split('@')[0]
  return {
    id: integer(run.id),
    run_number: integer(run.run_number),
    // The field is absent before attempt-aware APIs; never fabricate an attempt.
    run_attempt:
      run.run_attempt === undefined ||
      run.run_attempt === null ||
      run.run_attempt === 0
        ? null
        : integer(run.run_attempt),
    name: text(run.name) ?? path?.split('/').pop() ?? null,
    display_title: text(run.display_title) ?? 'Workflow run',
    head_branch: text(run.head_branch),
    head_sha: text(run.head_sha) ?? '',
    event: text(run.event) ?? 'unknown',
    status: text(run.status),
    conclusion: text(run.conclusion),
    created_at: timestamp(run.created_at),
    updated_at: timestamp(run.updated_at),
    started_at: timestamp(run.run_started_at ?? run.started_at),
    actor:
      typeof run.actor === 'object' &&
      run.actor !== null &&
      text(record(run.actor).login) !== null
        ? { login: text(record(run.actor).login)! }
        : null,
  }
}

function normalizeStep(value: unknown): IActionsStep {
  const step = record(value)
  return {
    // Gitea numbers steps from zero; the viewer uses human-readable numbering.
    number: integer(step.number, 0) + 1,
    name: text(step.name) ?? 'Step',
    status: text(step.status) ?? 'unknown',
    conclusion: text(step.conclusion),
    started_at: timestamp(step.started_at),
    completed_at: timestamp(step.completed_at),
  }
}

function normalizeJob(
  value: unknown,
  runId: number,
  attempt: number | null
): IActionsJob {
  const job = record(value)
  if (job.run_id !== undefined && job.run_id !== runId) {
    throw new Error('Gitea returned a job from another run')
  }
  if (
    attempt !== null &&
    job.run_attempt !== undefined &&
    job.run_attempt !== attempt
  ) {
    throw new Error('Gitea returned a job from another attempt')
  }
  if (
    job.steps !== undefined &&
    job.steps !== null &&
    !Array.isArray(job.steps)
  ) {
    throw new Error('Invalid Gitea Actions steps')
  }
  return {
    id: integer(job.id),
    name: text(job.name) ?? 'Job',
    status: text(job.status) ?? 'unknown',
    conclusion: text(job.conclusion),
    started_at: timestamp(job.started_at),
    completed_at: timestamp(job.completed_at),
    html_url: text(job.html_url),
    steps: Array.isArray(job.steps) ? job.steps.map(normalizeStep) : undefined,
  }
}

function component(value: string) {
  if (value === '' || value === '.' || value === '..' || /[\/\\]/.test(value)) {
    throw new Error('Invalid Gitea repository component')
  }
  return encodeURIComponent(value)
}

function list(
  body: Record<string, unknown>,
  key: string
): ReadonlyArray<unknown> {
  const value = body[key]
  if (!Array.isArray(value)) {
    throw new Error(`Invalid Gitea Actions ${key}`)
  }
  return value
}

function hasNext(
  response: Response,
  page: number,
  size: number,
  total: number
) {
  const link = response.headers.get('link')
  // Respect a server-configured page limit rather than assuming 50/30 forever.
  // Read only the relation; never follow an API-supplied URL with credentials.
  return link !== null
    ? /rel="?next"?(?:\s|,|$)/.test(link)
    : page * size < total
}

/** Gitea 1.25+ workflow API. All requests use the selected OAuth API instance. */
export class GiteaActionsClient {
  public constructor(
    private readonly api: Pick<GiteaAPI, 'fetchActionsResource'>,
    private readonly endpoint: string
  ) {}

  private repositoryPath(target: IActionsTarget) {
    if (target.provider !== 'gitea' || target.endpoint !== this.endpoint) {
      throw new Error('Gitea Actions target does not match the account')
    }
    return `repos/${component(target.owner)}/${component(
      target.name
    )}/actions/runs`
  }

  public async runs(
    target: IActionsTarget,
    page: number,
    status: ActionsRunFilter
  ): Promise<IActionsRunsPage> {
    const query = new URLSearchParams({
      limit: String(RunsPerPage),
      page: String(integer(page)),
    })
    if (status !== '') {
      query.set('status', status)
    }
    const response = await this.api.fetchActionsResource(
      `${this.repositoryPath(target)}?${query}`
    )
    const body = record(await parsedResponse<unknown>(response))
    const total = integer(body.total_count, 0)
    return {
      total_count: total,
      workflow_runs: list(body, 'workflow_runs').map(normalizeRun),
      hasNextPage: hasNext(response, page, RunsPerPage, total),
    }
  }

  public async run(target: IActionsTarget, id: number): Promise<IActionsRun> {
    const response = await this.api.fetchActionsResource(
      `${this.repositoryPath(target)}/${integer(id)}`
    )
    const run = normalizeRun(await parsedResponse<unknown>(response))
    if (run.id !== id) {
      throw new Error('Gitea returned a different workflow run')
    }
    return run
  }

  public async jobs(
    target: IActionsTarget,
    id: number,
    attempt: number | null,
    page: number
  ): Promise<IActionsJobsPage> {
    const attemptPath = attempt === null ? '' : `/attempts/${integer(attempt)}`
    const path = `${this.repositoryPath(target)}/${integer(
      id
    )}${attemptPath}/jobs?limit=${JobsPerPage}&page=${integer(page)}`
    const response = await this.api.fetchActionsResource(path)
    const body = record(await parsedResponse<unknown>(response))
    const total = integer(body.total_count, 0)
    return {
      total_count: total,
      jobs: list(body, 'jobs').map(job => normalizeJob(job, id, attempt)),
      hasNextPage: hasNext(response, page, JobsPerPage, total),
    }
  }
}
