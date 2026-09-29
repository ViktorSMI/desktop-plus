import * as React from 'react'
import { Repository } from '../../models/repository'
import { ForkedRemotePrefix, IRemote } from '../../models/remote'
import { IActionsRun } from '../../models/actions'
import {
  ActionsAccount,
  getActionsAccounts,
  getActionsTarget,
  actionsTargetKey,
} from '../../lib/actions-client'
import {
  getRemoteAccountLogin,
  setRemoteAccountLogin,
} from '../../lib/remote-account-preference'
import { FoldoutType } from '../../lib/app-state'
import { PopupType } from '../../models/popup'
import { Dispatcher } from '../dispatcher'
import { Select } from '../lib/select'
import { Button } from '../lib/button'
import { ActionsRuns } from './actions-runs'

interface IActionsTabProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
}

/** Scoped to the local repository so late remote lookups cannot cross projects. */
export function ActionsTab(props: IActionsTabProps) {
  return <RepositoryActionsTab key={props.repository.path} {...props} />
}

function RepositoryActionsTab({ repository, dispatcher }: IActionsTabProps) {
  const [remotes, setRemotes] = React.useState<ReadonlyArray<IRemote>>([])
  const [accounts, setAccounts] = React.useState<ReadonlyArray<ActionsAccount>>(
    []
  )
  const [remoteName, setRemoteName] = React.useState('')
  const [accountLogin, setAccountLogin] = React.useState<string | null>(null)
  const [accountEndpoint, setAccountEndpoint] = React.useState<string | null>(
    null
  )
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const retry = React.useCallback(() => setRevision(value => value + 1), [])
  React.useEffect(() => {
    let disposed = false
    setLoading(true)
    setFailed(false)
    dispatcher
      .getRemotes(repository)
      .then(all => {
        if (disposed) {
          return
        }
        const normal = all.filter(r => !r.name.startsWith(ForkedRemotePrefix))
        const remembered = localStorage.getItem(
          `branches-selected-remote:${repository.path}`
        )
        const selected =
          normal.find(r => r.name === remembered) ??
          normal.find(r => r.name === 'origin') ??
          normal[0]
        setRemotes(normal)
        setAccounts(
          dispatcher.getAccounts().map(({ endpoint, login, apiType }) => ({
            endpoint,
            login,
            apiType,
          }))
        )
        setRemoteName(selected?.name ?? '')
        setAccountEndpoint(null)
        setAccountLogin(
          selected === undefined
            ? null
            : getRemoteAccountLogin(repository.path, selected.name)
        )
        setLoading(false)
      })
      .catch(() => {
        if (!disposed) {
          setLoading(false)
          setFailed(true)
        }
      })
    return () => {
      disposed = true
    }
  }, [repository, dispatcher, revision])
  const remote = remotes.find(r => r.name === remoteName)
  const candidates = React.useMemo(
    () => (remote === undefined ? [] : getActionsAccounts(accounts, remote)),
    [remote, accounts]
  )
  const target = React.useMemo(
    () =>
      remote === undefined
        ? null
        : getActionsTarget(
            repository,
            remote,
            accounts,
            accountLogin,
            accountEndpoint
          ),
    [repository, remote, accounts, accountLogin, accountEndpoint]
  )
  const onRemoteChanged = React.useCallback(
    (event: React.FormEvent<HTMLSelectElement>) => {
      const name = event.currentTarget.value
      setRemoteName(name)
      setAccountEndpoint(null)
      setAccountLogin(getRemoteAccountLogin(repository.path, name))
    },
    [repository.path]
  )
  const onAccountChanged = React.useCallback(
    (event: React.FormEvent<HTMLSelectElement>) => {
      const selected = candidates.find(
        a => JSON.stringify([a.endpoint, a.login]) === event.currentTarget.value
      )
      if (selected !== undefined) {
        setAccountLogin(selected.login)
        setAccountEndpoint(selected.endpoint)
        setRemoteAccountLogin(repository.path, remoteName, selected.login)
      }
    },
    [repository.path, remoteName, candidates]
  )
  const onSelect = React.useCallback(
    (run: IActionsRun) => {
      if (target === null) {
        return
      }
      dispatcher.closeFoldout(FoldoutType.Branch)
      dispatcher.showPopup({
        type: PopupType.ActionsRun,
        target,
        runId: run.id,
      })
    },
    [dispatcher, target]
  )

  return (
    <div className="actions-tab">
      {loading ? (
        <p className="actions-message" role="status">
          Loading remotes…
        </p>
      ) : failed ? (
        <div className="actions-message" role="alert">
          Unable to load remotes. <Button onClick={retry}>Retry</Button>
        </div>
      ) : (
        <>
          <div className="actions-target">
            <Select
              label="Actions remote"
              value={remoteName}
              onChange={onRemoteChanged}
            >
              {remotes.map(r => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </Select>
            {candidates.length > 0 && (
              <Select
                label="Actions account"
                value={
                  target === null
                    ? ''
                    : JSON.stringify([target.endpoint, target.login])
                }
                onChange={onAccountChanged}
              >
                <option value="" disabled={true}>
                  Choose an account
                </option>
                {candidates.map(a => (
                  <option
                    key={`${a.endpoint}:${a.login}`}
                    value={JSON.stringify([a.endpoint, a.login])}
                  >
                    {a.login} · {a.endpoint}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {target === null ? (
            <p className="actions-message">
              {remote === undefined
                ? 'Add a GitHub or Gitea remote to view Actions.'
                : candidates.length === 0
                ? 'Select a GitHub or Gitea remote and sign in to its account. Gitea Actions requires Gitea 1.25 or later; other hosting providers are not supported.'
                : 'Choose an account and server for this remote.'}
            </p>
          ) : (
            <>
              <div className="actions-target-name">
                {target.owner}/{target.name}
              </div>
              <ActionsRuns
                key={actionsTargetKey(target)}
                target={target}
                reader={dispatcher}
                onSelect={onSelect}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
