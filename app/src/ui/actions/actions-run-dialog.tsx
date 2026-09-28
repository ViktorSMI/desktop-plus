import * as React from 'react'
import {
  IActionsReader,
  IActionsTarget,
  IActionsRun,
  IActionsJobsPage,
} from '../../models/actions'
import {
  actionsDuration,
  actionsStatus,
  actionsTargetKey,
  actionsWebURL,
  ActionsJobsPerPage,
} from '../../lib/actions-client'
import { Dialog, DialogPreferredFocusClassName } from '../dialog'
import { Button } from '../lib/button'
import { useActionsData } from './use-actions-data'

interface IActionsRunDialogProps {
  readonly target: IActionsTarget
  readonly runId: number
  readonly reader: IActionsReader
  readonly onDismissed: () => void
  readonly onBack: () => void
}

interface IRunDetails {
  readonly run: IActionsRun
  readonly page: IActionsJobsPage
}

const pollRun = (details: IRunDetails) => details.run.status !== 'completed'

/** Viewport-bounded run reader. Never downloads or retains large log archives. */
export function ActionsRunDialog({
  target,
  runId,
  reader,
  onDismissed,
  onBack,
}: IActionsRunDialogProps) {
  const [page, setPage] = React.useState(1)
  const load = React.useCallback(async () => {
    const run = await reader.fetchActionsRun(target, runId)
    const jobs = await reader.fetchActionsJobs(
      target,
      runId,
      run.run_attempt,
      page
    )
    return { run, page: jobs }
  }, [reader, target, runId, page])
  const result = useActionsData(
    `${actionsTargetKey(target)}:${runId}:${page}`,
    load,
    pollRun
  )
  const previousPage = React.useCallback(
    () => setPage(p => Math.max(1, p - 1)),
    []
  )
  const nextPage = React.useCallback(() => setPage(p => p + 1), [])
  const openRun = React.useCallback(() => {
    reader.openInBrowser(actionsWebURL(target, runId))
  }, [reader, target, runId])
  const openJob = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = Number(event.currentTarget.dataset.jobId)
      if (result.data?.page.jobs.some(job => job.id === id)) {
        reader.openInBrowser(actionsWebURL(target, runId, id))
      }
    },
    [reader, target, runId, result.data]
  )
  const run = result.data?.run
  const jobs = result.data?.page.jobs ?? []
  const total = result.data?.page.total_count ?? 0

  return (
    <Dialog
      id="actions-run-dialog"
      title={
        run === undefined
          ? 'GitHub Actions'
          : `${run.name ?? 'Workflow'} #${run.run_number}`
      }
      onDismissed={onDismissed}
    >
      <div className="actions-toolbar">
        <span className="actions-target-name">
          {target.owner}/{target.name} · {target.login}
        </span>
        <Button onClick={result.refresh} disabled={result.loading}>
          Refresh
        </Button>
        <Button onClick={openRun}>Open run in browser</Button>
      </div>
      <div
        className={`dialog-content actions-run-content ${DialogPreferredFocusClassName}`}
        role="region"
        aria-label="Workflow run jobs and steps"
        aria-busy={result.loading}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <div role="status" className="actions-refresh-status">
          {result.loading
            ? 'Refreshing run…'
            : result.error !== null
            ? 'Auto-refresh paused.'
            : run?.status === 'completed'
            ? 'Run completed. Refresh to check for a new attempt.'
            : 'Refreshes every 30 seconds while visible.'}
          {result.updatedAt !== null &&
            ` Last updated ${new Date(result.updatedAt).toLocaleTimeString()}.`}
        </div>
        {result.error !== null && (
          <p className="actions-message" role="alert">
            {result.error}{' '}
            {run !== undefined && 'Showing the last successful response.'}
          </p>
        )}
        {run !== undefined && (
          <>
            <h2 className="actions-run-title">{run.display_title}</h2>
            <p className="actions-meta">
              {run.head_branch ?? 'Detached HEAD'} ·{' '}
              <code>{run.head_sha.slice(0, 7)}</code> · {run.event} ·{' '}
              {run.actor?.login ?? 'Unknown actor'} · Attempt {run.run_attempt}
            </p>
            <p>
              <span
                className="actions-status"
                data-status={run.conclusion ?? run.status}
              >
                {actionsStatus(run.status, run.conclusion)}
              </span>{' '}
              · Created{' '}
              <time dateTime={run.created_at}>
                {new Date(run.created_at).toLocaleString()}
              </time>
            </p>
            <h3>Jobs ({total})</h3>
            {jobs.length === 0 && (
              <p>
                No jobs on this page. The run may be waiting for a runner or
                approval.
              </p>
            )}
            <div className="actions-jobs" key={`${run.id}:${run.run_attempt}`}>
              {jobs.map(job => (
                <details
                  className="actions-job"
                  key={job.id}
                  open={job.conclusion === 'failure'}
                >
                  <summary>
                    <strong>{job.name}</strong>
                    <span
                      className="actions-status"
                      data-status={job.conclusion ?? job.status}
                    >
                      {actionsStatus(job.status, job.conclusion)}
                    </span>
                    <span className="actions-meta">
                      {actionsDuration(job.started_at, job.completed_at)}
                    </span>
                  </summary>
                  <button
                    type="button"
                    className="actions-log-link"
                    data-job-id={job.id}
                    onClick={openJob}
                  >
                    Open job logs in browser
                  </button>
                  {(job.steps?.length ?? 0) === 0 ? (
                    <p>Steps are not available yet.</p>
                  ) : (
                    <ol className="actions-steps">
                      {job.steps?.map(step => (
                        <li key={step.number}>
                          <span>
                            {step.number}. {step.name}
                          </span>
                          <span
                            className="actions-status"
                            data-status={step.conclusion ?? step.status}
                          >
                            {actionsStatus(step.status, step.conclusion)}
                          </span>
                          <span className="actions-meta">
                            {actionsDuration(
                              step.started_at,
                              step.completed_at
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </details>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="actions-toolbar actions-pagination">
        <Button disabled={page <= 1 || result.loading} onClick={previousPage}>
          Previous jobs
        </Button>
        <span>Page {page}</span>
        <Button
          disabled={
            result.loading ||
            result.error !== null ||
            jobs.length === 0 ||
            page * ActionsJobsPerPage >= total
          }
          onClick={nextPage}
        >
          Next jobs
        </Button>
      </div>
      <div className="actions-toolbar actions-footer">
        <span>Read only · Logs open on GitHub</span>
        <Button onClick={onBack}>Back to Actions</Button>
      </div>
    </Dialog>
  )
}
