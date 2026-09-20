import { Repository } from '../../models/repository'
import { IRemote } from '../../models/remote'
import { IRemoteForcePushTarget } from '../../models/remote-force-push'
import { IPushProgress } from '../../models/progress'
import { git, HookCallbackOptions, isGitError } from './core'
import { getBooleanConfigValue } from './config'
import { getRemotes } from './remote'
import { getSymbolicRef } from './refs'
import { push } from './push'

async function readCommit(repository: Repository, ref: string) {
  const result = await git(
    ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
    repository.path,
    'readForcePushCommit',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

async function resolveDestination(repository: Repository, remote: IRemote) {
  const configured = (await getRemotes(repository)).find(
    r => r.name === remote.name
  )
  if (configured === undefined || configured.url !== remote.url) {
    throw new Error(
      'The selected remote changed or was removed. Reopen the remote selector.'
    )
  }
  if (await getBooleanConfigValue(repository, `remote.${remote.name}.mirror`)) {
    throw new Error(
      'Force push is unavailable for mirror remotes. Use a dedicated single-destination remote.'
    )
  }
  const result = await git(
    ['remote', 'get-url', '--push', '--all', remote.name],
    repository.path,
    'getForcePushDestination'
  )
  const urls = result.stdout.trim().split(/\r?\n/)
  if (urls.length !== 1 || urls[0].length === 0 || urls[0] !== configured.url) {
    // The fetched remote-tracking ref is not a valid lease for a different server.
    throw new Error(
      'Force push requires one matching fetch/push URL. Add a separate remote for this push destination and fetch it first.'
    )
  }
  return urls[0]
}

/** Capture last-fetched remote and local commits. Never fetch implicitly here. */
export async function prepareRemoteForcePush(
  repository: Repository,
  remote: IRemote
): Promise<IRemoteForcePushTarget> {
  const pushURL = await resolveDestination(repository, remote)
  const ref = await getSymbolicRef(repository, 'HEAD')
  if (ref === null || !ref.startsWith('refs/heads/')) {
    throw new Error('Check out a local branch before force pushing.')
  }
  const branchName = ref.substring('refs/heads/'.length)
  const localTip = await readCommit(repository, ref)
  if (localTip === null) {
    throw new Error('Commit to the local branch before force pushing.')
  }
  const remoteTip = await readCommit(
    repository,
    `refs/remotes/${remote.name}/${branchName}`
  )
  if (remoteTip === null) {
    throw new Error(
      'Fetch this remote first. Use normal Push to publish a new branch.'
    )
  }
  return Object.freeze({
    repositoryPath: repository.path,
    remote: Object.freeze({ ...remote }),
    pushURL,
    branchName,
    localTip,
    remoteTip,
  })
}

/** Push exactly the reviewed commit to exactly one ref using a frozen lease. */
export async function pushToRemoteWithLease(
  repository: Repository,
  target: IRemoteForcePushTarget,
  hooks?: HookCallbackOptions,
  progressCallback?: (progress: IPushProgress) => void
): Promise<void> {
  if (repository.path !== target.repositoryPath) {
    throw new Error('The repository changed. Review the force push again.')
  }
  const pushURL = await resolveDestination(repository, target.remote)
  if (pushURL !== target.pushURL) {
    throw new Error(
      'The push destination changed. Review the force push again.'
    )
  }
  const ref = `refs/heads/${target.branchName}`
  if (
    (await getSymbolicRef(repository, 'HEAD')) !== ref ||
    (await readCommit(repository, ref)) !== target.localTip
  ) {
    throw new Error(
      'The current branch or its commits changed. Review the force push again.'
    )
  }

  try {
    await push(
      repository,
      // Keep the selected remote name for credential settings and pre-push
      // hooks. Its destination was revalidated above; never use the upstream.
      target.remote,
      target.localTip,
      ref,
      null,
      { ...hooks, forceWithLease: true, expectedRemoteTip: target.remoteTip },
      progress =>
        progressCallback?.({
          ...progress,
          title: `Force pushing to ${target.remote.name}`,
          remote: target.remote.name,
          branch: target.branchName,
        })
    )
  } catch (error) {
    if (
      isGitError(error) &&
      /stale info/.test(error.result.stderr.toString())
    ) {
      throw new Error(
        'The remote branch changed since it was reviewed. Fetch it, inspect the new commits, and confirm again. Nothing was force pushed.'
      )
    }
    throw error
  }
}
