import * as React from 'react'
import {
  ActionsRunFilter,
  IActionsReader,
  IActionsRun,
  IActionsTarget,
} from '../../models/actions'
import {
  actionsStatus,
  actionsTargetKey,
  ActionsRunsPerPage,
} from '../../lib/actions-client'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { useActionsData } from './use-actions-data'

interface IActionsRunsProps {
  readonly target: IActionsTarget
  readonly reader: IActionsReader
  readonly onSelect: (run: IActionsRun) => void
}

const pollRuns = () => true

export function ActionsRuns({ target, reader, onSelect }: IActionsRunsProps) {
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<ActionsRunFilter>('')
  const load = React.useCallback(
    () => reader.fetchActionsRuns(target, page, status),
    [reader, target, page, status]
  )
  const result = useActionsData(
    `${actionsTargetKey(target)}:${page}:${status}`,
    load,
    pollRuns
  )
  const onStatusChanged = React.useCallback(
    (event: React.FormEvent<HTMLSelectElement>) => {
      setPage(1)
      setStatus(event.currentTarget.value as ActionsRunFilter)
    },
    []
  )
  const previousPage = React.useCallback(
    () => setPage(p => Math.max(1, p - 1)),
    []
  )
  const nextPage = React.useCallback(() => setPage(p => p + 1), [])
  const onRunClicked = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const run = result.data?.workflow_runs.find(
        r => r.id === Number(event.currentTarget.dataset.runId)
      )
      if (run !== undefined) {
        onSelect(run)
      }
    },
    [result.data, onSelect]
  )
  const runs = result.data?.workflow_runs ?? []
  // GitHub caps filtered searches at 1,000 results. Do not offer unreachable pages.
  const count = Math.min(
    result.data?.total_count ?? 0,
    status === '' ? Infinity : 1000
  )

  return (
    <div className="actions-runs">
      <div className="actions-toolbar">
        <Select label="Run status" value={status} onChange={onStatusChanged}>
          <option value="">All runs</option>
          <option value="in_progress">In progress</option>
          <option value="queued">Queued</option>
          <option value="failure">Failed</option>
          <option value="completed">Completed</option>
        </Select>
        <Button
          onClick={result.refresh}
          disabled={result.loading}
          ariaLabel="Refresh Actions"
        >
          Refresh
        </Button>
      </div>
      <div className="actions-refresh-status" role="status">
        {result.loading
          ? 'Refreshing Actions…'
          : result.error !== null
          ? 'Auto-refresh paused.'
          : 'Refreshes every 30 seconds while visible.'}
      </div>
      {result.error !== null && (
        <p className="actions-message" role="alert">
          {result.error}{' '}
          {runs.length > 0 && 'Showing the last successful response.'}
        </p>
      )}
      <div
        className="actions-run-list"
        role="region"
        aria-label="Workflow runs"
        aria-busy={result.loading}
      >
        {runs.length === 0 && !result.loading && result.error === null && (
          <p className="actions-message">No workflow runs match this view.</p>
        )}
        {runs.map(run => (
          <button
            type="button"
            className="actions-run"
            key={run.id}
            data-run-id={run.id}
            onClick={onRunClicked}
          >
            <strong>
              {run.name ?? 'Workflow'} #{run.run_number}
            </strong>
            <span className="actions-run-title">{run.display_title}</span>
            <span className="actions-meta">
              {run.head_branch ?? 'Detached HEAD'} · {run.event} ·{' '}
              {run.head_sha.slice(0, 7)}
            </span>
            <span
              className="actions-status"
              data-status={run.conclusion ?? run.status}
            >
              {actionsStatus(run.status, run.conclusion)}
            </span>
          </button>
        ))}
      </div>
      <div className="actions-toolbar actions-pagination">
        <Button disabled={page <= 1 || result.loading} onClick={previousPage}>
          Previous page
        </Button>
        <span>Page {page}</span>
        <Button
          disabled={
            result.loading ||
            result.error !== null ||
            runs.length === 0 ||
            page * ActionsRunsPerPage >= count
          }
          onClick={nextPage}
        >
          Next page
        </Button>
      </div>
    </div>
  )
}
