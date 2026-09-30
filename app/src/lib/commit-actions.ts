/** Workflow summaries used by history; independent of Electron and API clients. */
export type CommitActionsState =
  | 'none'
  | 'pending'
  | 'success'
  | 'failure'
  | 'neutral'
  | 'unknown'

export interface ICommitActionsSummary {
  readonly state: CommitActionsState
  readonly description: string
  readonly count: number
}

export interface ICommitActionsRun {
  readonly id: number
  readonly attempt: number
  readonly workflow: string
  readonly event: string
  readonly branch: string
  readonly status: string
  readonly conclusion: string | null
}

export const UnavailableCommitActions: ICommitActionsSummary = {
  state: 'unknown',
  description:
    'Actions status unavailable. Check your connection and account access.',
  count: 0,
}

export function validateCommitSHA(sha: string) {
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(sha)) {
    throw new Error('Expected a full commit SHA')
  }
  return sha.toLowerCase()
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Actions response')
  }
  return value as Record<string, unknown>
}

function integer(value: unknown, minimum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error('Invalid Actions identifier or count')
  }
  return value
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Fail closed if a provider ignores head_sha; another commit must never turn green. */
export function parseCommitActionsPage(body: unknown, sha: string) {
  const expected = validateCommitSHA(sha)
  const page = record(body)
  const total = integer(page.total_count, 0)
  if (!Array.isArray(page.workflow_runs)) {
    throw new Error('Invalid Actions run list')
  }
  const runs: ICommitActionsRun[] = page.workflow_runs.map(value => {
    const run = record(value)
    if (text(run.head_sha).toLowerCase() !== expected) {
      throw new Error('Actions response belongs to another commit')
    }
    const id = integer(run.id, 1)
    // Workflow names need not be unique. Without a stable identity, retain
    // each run rather than potentially hiding a failure from another workflow.
    const workflow =
      (typeof run.workflow_id === 'number' &&
        Number.isSafeInteger(run.workflow_id) && run.workflow_id > 0) ||
      (typeof run.workflow_id === 'string' && run.workflow_id !== '' && run.workflow_id !== '0')
        ? `id:${run.workflow_id}`
        : text(run.path) !== ''
        ? `path:${text(run.path).split('@')[0]}`
        : `run:${id}`
    return {
      id,
      attempt:
        run.run_attempt == null || run.run_attempt === 0
          ? 1
          : integer(run.run_attempt, 1),
      workflow,
      event: text(run.event),
      branch: text(run.head_branch),
      status: text(run.status),
      conclusion: run.conclusion == null ? null : text(run.conclusion),
    }
  })
  return { total, runs }
}

function runState(run: ICommitActionsRun): Exclude<CommitActionsState, 'none'> {
  const result = run.status === 'completed' ? run.conclusion : run.status
  switch (result) {
    case 'failure':
    case 'timed_out':
    case 'action_required':
      return 'failure'
    case 'queued':
    case 'requested':
    case 'waiting':
    case 'pending':
    case 'in_progress':
      return 'pending'
    case 'success':
      return 'success'
    case 'neutral':
    case 'skipped':
      return 'neutral'
    default:
      // Cancelled, stale, completed-without-conclusion and future API values
      // are not successes, even when all other workflows have passed.
      return 'unknown'
  }
}

export function summarizeCommitActions(
  runs: ReadonlyArray<ICommitActionsRun>
): ICommitActionsSummary {
  const latest = new Map<string, ICommitActionsRun>()
  for (const run of runs) {
    const key = JSON.stringify([run.workflow, run.event, run.branch])
    const previous = latest.get(key)
    if (
      previous === undefined ||
      run.id > previous.id ||
      (run.id === previous.id && run.attempt > previous.attempt)
    ) {
      latest.set(key, run)
    } else if (
      run.id === previous.id && run.attempt === previous.attempt &&
      (run.status !== previous.status || run.conclusion !== previous.conclusion)
    ) {
      // Pagination can race an in-flight update. Conflicting snapshots of the
      // same attempt must not produce green until the next consistent refresh.
      latest.set(key, { ...run, status: 'unknown', conclusion: null })
    }
  }
  const states = Array.from(latest.values(), runState)
  const count = states.length
  const state: CommitActionsState =
    count === 0
      ? 'none'
      : states.includes('failure')
      ? 'failure'
      : states.includes('pending')
      ? 'pending'
      : states.includes('unknown')
      ? 'unknown'
      : states.includes('success')
      ? 'success'
      : 'neutral'
  const descriptions: Record<CommitActionsState, string> = {
    none: 'No Actions runs for this commit',
    failure: 'Actions failed or require attention',
    pending: 'Actions queued or running',
    success: 'Actions passed',
    neutral: 'Actions skipped or neutral',
    unknown: 'Actions cancelled, stale, or result unknown',
  }
  return {
    state,
    description:
      descriptions[state] + (count === 0 ? '' : ` (${count} workflows)`),
    count,
  }
}

export interface ICommitActionsPage {
  readonly body: unknown
  readonly hasNextPage: boolean | undefined
}

/** Read every page, bounded for API/rate-limit safety. Incomplete is not success. */
export async function loadCommitActions(
  sha: string,
  readPage: (page: number) => Promise<ICommitActionsPage>
): Promise<ICommitActionsSummary> {
  validateCommitSHA(sha)
  const runs: ICommitActionsRun[] = []
  const seen = new Set<number>()
  for (let page = 1; page <= 10; page++) {
    const response = await readPage(page)
    const parsed = parseCommitActionsPage(response.body, sha)
    const oldSize = seen.size
    for (const run of parsed.runs) {
      runs.push(run)
      seen.add(run.id)
    }
    const more = response.hasNextPage ?? seen.size < parsed.total
    if (!more) {
      if (seen.size < parsed.total) {
        throw new Error('Actions result is incomplete')
      }
      return summarizeCommitActions(runs)
    }
    if (seen.size === oldSize) {
      throw new Error('Actions pagination did not advance')
    }
  }
  throw new Error('Actions result is incomplete')
}
