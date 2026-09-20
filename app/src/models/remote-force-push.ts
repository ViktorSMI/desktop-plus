import { IRemote } from './remote'

/** An immutable, single-branch force-push plan approved by the user. */
export interface IRemoteForcePushTarget {
  readonly repositoryPath: string
  readonly remote: IRemote
  /** Resolved, single push destination, revalidated against this value before push. */
  readonly pushURL: string
  readonly branchName: string
  readonly localTip: string
  /** Last fetched tip, captured before confirmation, not after background fetch. */
  readonly remoteTip: string
}
