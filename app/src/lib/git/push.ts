import { git, HookCallbackOptions, IGitStringExecutionOptions } from './core'
import { Repository } from '../../models/repository'
import { IPushProgress } from '../../models/progress'
import { PushProgressParser, executionOptionsWithProgress } from '../progress'
import { IRemote } from '../../models/remote'
import { envForRemoteOperation } from './environment'
import { Branch } from '../../models/branch'

export type PushOptions = {
  /**
   * Force-push the branch without losing changes in the remote that
   * haven't been fetched.
   *
   * See https://git-scm.com/docs/git-push#Documentation/git-push.txt---no-force-with-lease
   */
  readonly forceWithLease?: boolean

  /** Pin the lease to the tip reviewed by the user, rather than a mutable ref. */
  readonly expectedRemoteTip?: string

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
  if (
    options?.expectedRemoteTip !== undefined &&
    (!options.forceWithLease ||
      !remoteBranch?.startsWith('refs/heads/') ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(options.expectedRemoteTip) ||
      (tagsToPush !== null && tagsToPush.length > 0))
  ) {
    throw new Error(
      'An explicit force-push lease requires a branch ref and a valid expected commit, without tags.'
    )
  }

  const args = [
    'push',
    remote.name,
    remoteBranch ? `${localBranch}:${remoteBranch}` : localBranch,
  ]

  if (tagsToPush !== null) {
    args.push(...tagsToPush)
  }
  if (!remoteBranch) {
    args.push('--set-upstream')
  } else if (options?.forceWithLease) {
    args.push(
      options.expectedRemoteTip === undefined
        ? '--force-with-lease'
        : `--force-with-lease=${remoteBranch}:${options.expectedRemoteTip}`
    )
  }

  if (options?.expectedRemoteTip !== undefined) {
    // Also override push.followTags=true for a confirmed single-branch push.
    args.push('--no-follow-tags')
  }

  if (options?.noVerify) {
    args.push('--no-verify')
  }

  let opts: IGitStringExecutionOptions = {
    env: await envForRemoteOperation(remote.url),
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

  await git(args, repository.path, 'push', opts)
}
