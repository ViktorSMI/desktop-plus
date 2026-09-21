import { Repository } from '../../models/repository'
import { IRemote, remoteEquals } from '../../models/remote'
import { IRemoteForcePushRequest } from '../../models/remote-force-push'
import { IPushProgress } from '../../models/progress'
import { git, HookCallbackOptions } from './core'
import { getRemotes } from './remote'
import { getSymbolicRef } from './refs'
import { push } from './push'

async function readCommit(repository: Repository, ref: string) {
  const result = await git(
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    repository.path,
    'readForcePushCommit',
    { successExitCodes: new Set([0, 128]) }
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

async function readPushURL(repository: Repository, name: string) {
  const result = await git(
    ['remote', 'get-url', '--push', '--all', '--', name],
    repository.path,
    'readForcePushURL'
  )
  const urls = result.stdout.trim().split(/\r?\n/)
  if (urls.length !== 1 || urls[0].length === 0) {
    throw new Error('Force push requires a remote with exactly one push URL.')
  }
  return urls[0]
}

/** Read local Git state only. In particular, do not fetch before taking the lease. */
export async function prepareRemoteForcePush(
  repository: Repository,
  selectedRemote: IRemote
): Promise<IRemoteForcePushRequest> {
  const remote = (await getRemotes(repository)).find(r =>
    remoteEquals(r, selectedRemote)
  )
  if (remote === undefined) {
    throw new Error('The selected remote changed. Reopen the branch picker.')
  }
  const localRef = await getSymbolicRef(repository, 'HEAD')
  if (localRef === null || !localRef.startsWith('refs/heads/')) {
    throw new Error('Check out a local branch before force pushing.')
  }
  const branchName = localRef.slice('refs/heads/'.length)
  const localTip = await readCommit(repository, localRef)
  const expectedRemoteTip = await readCommit(
    repository,
    `refs/remotes/${remote.name}/${branchName}`
  )
  if (localTip === null) {
    throw new Error('The current branch has no commits to push.')
  }
  if (expectedRemoteTip === null) {
    throw new Error(
      `Fetch ${remote.name} and review ${remote.name}/${branchName} before force pushing. Use normal Push to create a new remote branch.`
    )
  }
  return {
    remote: { ...remote },
    pushURL: await readPushURL(repository, remote.name),
    branchName,
    lease: { localTip, expectedRemoteTip },
  }
}

/**
 * Recheck local state, but deliberately retain the approved remote SHA even if a
 * background fetch has moved the remote-tracking ref. The server checks the lease.
 */
export async function forcePushToRemote(
  repository: Repository,
  request: IRemoteForcePushRequest,
  hooks?: HookCallbackOptions,
  onProgress?: (progress: IPushProgress) => void
): Promise<void> {
  const remote = (await getRemotes(repository)).find(r =>
    remoteEquals(r, request.remote)
  )
  if (
    remote === undefined ||
    (await readPushURL(repository, remote.name)) !== request.pushURL
  ) {
    throw new Error(
      'The remote destination changed. Confirm the force push again.'
    )
  }
  const localRef = `refs/heads/${request.branchName}`
  if (
    (await getSymbolicRef(repository, 'HEAD')) !== localRef ||
    (await readCommit(repository, localRef)) !== request.lease.localTip
  ) {
    throw new Error(
      'The local branch changed. Review and confirm the force push again.'
    )
  }
  await push(
    repository,
    { name: remote.name, url: request.pushURL },
    request.branchName,
    request.branchName,
    null,
    { ...hooks, forceWithLease: true, forcePushLease: request.lease },
    onProgress
  )
}
