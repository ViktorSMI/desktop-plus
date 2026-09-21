import { IRemote } from './remote'

/** Both ends of the history replacement approved in the confirmation dialog. */
export interface IForcePushLease {
  readonly localTip: string
  readonly expectedRemoteTip: string
}

/** Immutable operation target; never re-resolve it from the selected remote. */
export interface IRemoteForcePushRequest {
  readonly remote: IRemote
  readonly pushURL: string
  readonly branchName: string
  readonly lease: IForcePushLease
}
