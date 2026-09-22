import { git, HookCallbackOptions, IGitStringExecutionOptions } from './core'
import { Repository } from '../../models/repository'
import { IPushProgress } from '../../models/progress'
import { PushProgressParser, executionOptionsWithProgress } from '../progress'
import { IRemote } from '../../models/remote'
import { envForRemoteOperation } from './environment'
import { Branch } from '../../models/branch'
import { getRemoteAccountLogin } from '../remote-account-preference'
import { IForcePushLease } from '../../models/remote-force-push'

export type PushOptions = {
  /**
   * Force-push the branch without losing changes in the remote that
   * haven't been fetched.
   *
   * See https://git-scm.com/docs/git-push#Documentation/git-push.txt---no-force-with-lease
   */
  readonly forceWithLease?: boolean

  /** Explicit approved SHAs for a remote-specific force push. */
  readonly forcePushLease?: IForcePushLease

  /** A branch to push instead of the current branch */
  readonly branch?: Branch

  readonly noVerify?: boolean
} & HookCallbackOptions

/**
 * Push from the remote to the branch, optionally setting the upstream.
 *
 * @param repository - The repository from which to push
 *
 * @param account - The account to use when authenticating with the remote
 *
 * @param remote - The remote to push the specified branch to
 *
 * @param localBranch - The local branch to push
 *
 * @param remoteBranch - The remote branch to push to
 *
 * @param tagsToPush - The tags to push along with the branch.
 *
 * @param options - Optional customizations for the push execution.
 *                  see PushOptions for more information.
 *
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the push operation. When provided this enables
 *                           the '--progress' command line flag for
 *                           'git push'.
 */
export async function push(
  repository: Repository,
  remote: IRemote,
  localBranch: string,
  remoteBranch: string | null,
  tagsToPush: ReadonlyArray<string> | null,
  options?: PushOptions,
  progressCallback?: (progress: IPushProgress) => void
): Promise<void> {
  const lease = options?.forcePushLease
  if (
    lease !== undefined &&
    (options?.forceWithLease !== true ||
      !remoteBranch ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(lease.localTip) ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(lease.expectedRemoteTip) ||
      (tagsToPush !== null && tagsToPush.length > 0))
  ) {
    throw new Error(
      'An explicit force push requires two commit IDs, one target branch, and no tags.'
    )
  }

  const args =
    lease === undefined
      ? [
          'push',
          remote.name,
          remoteBranch ? `${localBranch}:${remoteBranch}` : localBranch,
        ]
      : [
          '-c',
          `remote.${remote.name}.mirror=false`,
          'push',
          '--no-follow-tags',
          `--force-with-lease=refs/heads/${remoteBranch}:${lease.expectedRemoteTip}`,
        ]

  if (tagsToPush !== null) {
    args.push(...tagsToPush)
  }
  if (!remoteBranch) {
    args.push('--set-upstream')
  } else if (options?.forceWithLease && lease === undefined) {
    args.push('--force-with-lease')
  }

  if (options?.noVerify) {
    args.push('--no-verify')
  }

  let opts: IGitStringExecutionOptions = {
    env: await envForRemoteOperation(
      remote.url,
      getRemoteAccountLogin(repository.path, remote.name)
    ),
    interceptHooks: ['pre-push'],
    onHookProgress: options?.onHookProgress,
    onHookFailure: options?.onHookFailure,
    onTerminalOutputAvailable: options?.onTerminalOutputAvailable,
  }

  if (progressCallback) {
    args.push('--progress')
    const title = `Pushing to ${remote.name}`
    const kind = 'push'

    opts = await executionOptionsWithProgress(
      { ...opts, trackLFSProgress: true },
      new PushProgressParser(),
      progress => {
        const description =
          progress.kind === 'progress' ? progress.details.text : progress.text
        const value = progress.percent

        progressCallback({
          kind,
          title,
          description,
          value,
          remote: remote.name,
          branch: localBranch,
        })
      }
    )

    // Initial progress
    progressCallback({
      kind: 'push',
      title,
      value: 0,
      remote: remote.name,
      branch: localBranch,
    })
  }

  if (lease !== undefined) {
    // Pin the source too: a concurrent checkout/commit cannot send different work.
    // Explicit refspec + no-follow-tags + mirror=false restrict this to one branch.
    args.push('--', remote.name, `${lease.localTip}:refs/heads/${remoteBranch}`)
  }

  await git(args, repository.path, 'push', opts)
}
