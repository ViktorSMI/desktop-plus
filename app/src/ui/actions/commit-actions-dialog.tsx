import * as React from 'react'
import { IActionsReader, IActionsTarget } from '../../models/actions'
import { ICommitActionsRun, validateCommitSHA } from '../../lib/commit-actions'
import {
  actionsStatus,
  actionsTargetKey,
  actionsProviderName,
} from '../../lib/actions-client'
import { Dialog } from '../dialog'
import { Button } from '../lib/button'
import { ActionsRunDialog } from './actions-run-dialog'
import { useActionsData } from './use-actions-data'

export interface ICommitActionsReader extends IActionsReader {
  /** Validated, fully paginated latest runs for exactly this SHA. */
  fetchCommitActionsRuns(
    target: IActionsTarget,
    sha: string
  ): Promise<ReadonlyArray<ICommitActionsRun>>
}
interface ICommitActionsDialogProps {
  readonly target: IActionsTarget
  readonly sha: string
  readonly reader: ICommitActionsReader
  readonly onDismissed: () => void
}
const noPolling = () => false

/** Navigation is read-only and scoped independently of the branch picker. */
export function CommitActionsDialog(props: ICommitActionsDialogProps) {
  return (
    <CommitActionsForSHA
      key={`${actionsTargetKey(props.target)}:${props.sha}`}
      {...props}
    />
  )
}

function CommitActionsForSHA({
  target,
  sha,
  reader,
  onDismissed,
}: ICommitActionsDialogProps) {
  const [selected, setSelected] = React.useState<number>()
  const [showChoices, setShowChoices] = React.useState(false)
  const load = React.useCallback(
    () => reader.fetchCommitActionsRuns(target, validateCommitSHA(sha)),
    [reader, target, sha]
  )
  const result = useActionsData(
    `${actionsTargetKey(target)}:${sha}`,
    load,
    noPolling,
    target.provider
  )
  const runs = result.data ?? []
  const runId =
    selected ?? (!showChoices && runs.length === 1 ? runs[0].id : undefined)
  const choose = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const id = Number(event.currentTarget.dataset.runId)
      if (runs.some(run => run.id === id)) {
        setSelected(id)
      }
    },
    [runs]
  )
  const back = React.useCallback(() => {
    setShowChoices(true)
    setSelected(undefined)
  }, [])

  if (runId !== undefined) {
    return (
      <ActionsRunDialog
        key={runId}
        target={target}
        runId={runId}
        expectedCommitSHA={sha}
        reader={reader}
        onDismissed={onDismissed}
        onBack={back}
        backLabel="Back to commit runs"
      />
    )
  }
  return (
    <Dialog
      id="commit-actions-dialog"
      title={`Actions for commit ${sha.slice(0, 7)}`}
      onDismissed={onDismissed}
    >
      <div className="actions-toolbar">
        <span className="actions-target-name">
          {target.owner}/{target.name} · {target.login}
        </span>
        <Button onClick={result.refresh} disabled={result.loading}>
          Refresh
        </Button>
      </div>
      <p className="actions-message">
        {actionsProviderName(target.provider)} · <code>{sha}</code>
      </p>
      <div className="actions-refresh-status" role="status">
        {result.loading
          ? 'Loading Actions for this commit…'
          : 'Choose a workflow run to view its jobs and steps.'}
      </div>
      {result.error !== null && (
        <p className="actions-message" role="alert">
          {result.error}
        </p>
      )}
      <div
        className="actions-run-list"
        role="region"
        aria-label="Actions runs for this commit"
        aria-busy={result.loading}
      >
        {!result.loading && result.error === null && runs.length === 0 && (
          <p className="actions-message">
            No Actions runs for this commit. A local commit may need to be
            pushed first.
          </p>
        )}
        {runs.map(run => (
          <button
            type="button"
            className="actions-run"
            key={run.id}
            data-run-id={run.id}
            onClick={choose}
          >
            <strong>
              {run.name ?? 'Workflow'}{' '}
              {run.number === undefined
                ? `(run ID ${run.id})`
                : `#${run.number}`}
            </strong>
            <span className="actions-meta">
              {run.branch || 'Detached HEAD'} · {run.event} · {sha.slice(0, 7)}
            </span>
            <span
              className="actions-status"
              data-status={
                run.status === 'completed' ? run.conclusion : run.status
              }
            >
              {actionsStatus(
                run.status,
                run.status === 'completed' ? run.conclusion : null
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="actions-toolbar actions-footer">
        <span>Read only</span>
        <Button onClick={onDismissed}>Back to History</Button>
      </div>
    </Dialog>
  )
}
