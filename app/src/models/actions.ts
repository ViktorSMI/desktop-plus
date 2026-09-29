/** Read-only Actions data. Never store an account token in UI state. */
export type ActionsProvider = 'github' | 'gitea'
export interface IActionsTarget {
  readonly provider: ActionsProvider
  readonly endpoint: string
  readonly owner: string
  readonly name: string
  readonly login: string
}

export interface IActionsRun {
  readonly id: number
  readonly name: string | null
  readonly display_title: string
  readonly run_number: number
  readonly run_attempt: number | null
  readonly head_branch: string | null
  readonly head_sha: string
  readonly event: string
  readonly status: string | null
  readonly conclusion: string | null
  readonly created_at: string | null
  readonly updated_at: string | null
  readonly started_at?: string | null
  readonly actor: { readonly login: string } | null
}

export interface IActionsStep {
  readonly number: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
}

export interface IActionsJob {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly steps?: ReadonlyArray<IActionsStep>
  /** Untrusted provider URL; validate before opening it. */
  readonly html_url?: string | null
}

export interface IActionsRunsPage {
  readonly hasNextPage?: boolean
  readonly total_count: number
  readonly workflow_runs: ReadonlyArray<IActionsRun>
}

export interface IActionsJobsPage {
  readonly hasNextPage?: boolean
  readonly total_count: number
  readonly jobs: ReadonlyArray<IActionsJob>
}

export type ActionsRunFilter =
  | ''
  | 'in_progress'
  | 'queued'
  | 'failure'
  | 'completed'

/** Small interface also used by the monitor's isolated UI tests. */
export interface IActionsReader {
  fetchActionsRuns(
    target: IActionsTarget,
    page: number,
    status: ActionsRunFilter
  ): Promise<IActionsRunsPage>
  fetchActionsRun(target: IActionsTarget, id: number): Promise<IActionsRun>
  fetchActionsJobs(
    target: IActionsTarget,
    id: number,
    attempt: number | null,
    page: number
  ): Promise<IActionsJobsPage>
  openInBrowser(url: string): Promise<unknown> | void
}
