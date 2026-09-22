import { getHTMLURL } from './api'
import { parseRemote } from './remote-parsing'
import { Account } from '../models/account'
import { IRemote } from '../models/remote'

const RemoteAccountPreferencePrefix = 'remote-account-preference:'

const preferenceKey = (repositoryPath: string, remoteName: string) =>
  `${RemoteAccountPreferencePrefix}${repositoryPath}\0${remoteName}`

export function getRemoteAccountLogin(
  repositoryPath: string,
  remoteName: string
): string | null {
  return localStorage.getItem(preferenceKey(repositoryPath, remoteName))
}

export function setRemoteAccountLogin(
  repositoryPath: string,
  remoteName: string,
  login: string
) {
  localStorage.setItem(preferenceKey(repositoryPath, remoteName), login)
}

export function clearRemoteAccountLogin(
  repositoryPath: string,
  remoteName: string
) {
  localStorage.removeItem(preferenceKey(repositoryPath, remoteName))
}

export function getAccountsForRemote(
  accounts: ReadonlyArray<Account>,
  remote: IRemote
): ReadonlyArray<Account> {
  const parsed = parseRemote(remote.url)

  // OAuth/account routing only applies to HTTPS Git operations. SSH remotes
  // continue to use the user's SSH configuration and keys.
  if (parsed?.protocol !== 'https') {
    return []
  }

  const remoteHost = parsed.hostname.toLowerCase()

  return accounts.filter(account => {
    try {
      return (
        new URL(getHTMLURL(account.endpoint)).hostname.toLowerCase() ===
        remoteHost
      )
    } catch {
      return false
    }
  })
}

export function inferRemoteAccountLogin(
  accounts: ReadonlyArray<Account>,
  remote: IRemote,
  repositoryLogin: string | null
): string | null {
  const candidates = getAccountsForRemote(accounts, remote)
  if (candidates.length === 0) {
    return null
  }

  const parsed = parseRemote(remote.url)
  const owner = parsed?.owner.toLowerCase()
  const ownerAccount = candidates.find(
    account => account.login.toLowerCase() === owner
  )
  if (ownerAccount !== undefined) {
    return ownerAccount.login
  }

  if (remote.name === 'origin' && repositoryLogin !== null) {
    const repositoryAccount = candidates.find(
      account => account.login === repositoryLogin
    )
    if (repositoryAccount !== undefined) {
      return repositoryAccount.login
    }
  }

  return candidates.length === 1 ? candidates[0].login : null
}
