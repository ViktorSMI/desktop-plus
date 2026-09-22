## Remember an account for each remote

Repositories with multiple HTTPS remotes can now use a different signed-in account for each remote without repeatedly asking you which Git account to use.

Open **Current branch > Branches**, select a remote, then choose its **Account** once. Desktop Plus remembers that choice separately for the local repository and remote. Fetch, Pull, Push, Force push, remote-HEAD refreshes, and background fetches route credentials through that remembered account.

When the account can be inferred safely, Desktop Plus selects it automatically: for example, a remote owned by `@bob` prefers the signed-in `@bob` account, and `origin` prefers the account already associated with the repository. Ambiguous same-host remotes with multiple accounts require a one-time explicit choice instead of opening the sign-in flow over and over.

Changing a remote URL or removing the remote clears its saved account mapping. SSH remotes continue to use SSH keys/configuration and are not affected by the account picker.

## Force push to the selected remote

After squashing or rebasing commits from a second remote, you can send the rewritten history back from inside Desktop Plus.

Open **Current branch > Branches**, select the destination remote, and choose **Force push...**. Ordinary **Push** remains a non-forcing operation.

The confirmation shows the repository, destination remote and branch, sanitized push URL, expected remote commit, and local commit to send. **Cancel** is the default. The operation uses an explicit `--force-with-lease` tied to the approved remote commit and sends only the approved local commit. If the destination changed after confirmation, the push is rejected instead of silently overwriting newer history.

**Force push rewrites the destination branch's history.** Server-side branch protection and pre-push hooks still apply. Configured upstream, other remotes, queued tags, and uncommitted files are not changed.

## Updating

Windows users on **3.6.7-beta1 or beta2** can receive this release through the fork's automatic updater, or check manually in **Help > About > Check for updates**. Once the update is ready, restart normally or choose **Restart to update**.

Users on **3.6.6-beta6 or earlier** still need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux continue to show a release notice and require manual installation or a package-manager update as appropriate.

## Validation and included features

The account-routing change passed repository lint and changelog validation before release. The release workflow again gates publication on UI checks, updater checks, production builds, unit/script tests, and packaging for Windows, macOS, and Linux.

Multi-remote Fetch/Pull/Push/Force push, responsive read-only Issues, binary hex diffs, and verified Windows auto-updates remain included. Screenshots stay in Actions artifacts only, not in release downloads.

This is a prerelease. Windows code signing is still disabled, and current macOS builds are ad-hoc signed. Platform trust warnings may appear. Windows update packages and `desktop-plus-updates.json` are published alongside installers and checksums; their integrity checks use HTTPS and this GitHub repository as the trust root, not a separate publisher signature.
