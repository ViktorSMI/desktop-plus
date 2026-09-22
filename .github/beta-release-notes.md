## Commit counts for the selected remote

The multi-remote panel now shows how the current local branch differs from the same-named branch on the selected remote, using the same ahead/behind semantics as the normal Push/Pull control.

For example:

`3↑ 2↓` means **3 commits to push** to the selected remote and **2 commits to pull** from it. When both counts are zero the panel shows **Up to date**.

The comparison is against the currently selected remote, not merely the branch's configured Git upstream. It refreshes when you switch remotes, change branches, Fetch, Pull, Push, or Force push.

## Remember an account for each remote

Repositories with multiple HTTPS remotes can use a different signed-in account for each remote without repeatedly asking which Git account to use.

Open **Current branch > Branches**, select a remote, then choose its **Account** once. Desktop Plus remembers that choice separately for the local repository and remote. Fetch, Pull, Push, Force push, remote-HEAD refreshes, and background fetches route credentials through that remembered account.

When the account can be inferred safely, Desktop Plus selects it automatically. Ambiguous same-host remotes with multiple accounts require a one-time explicit choice instead of reopening the sign-in flow. Changing or removing a remote clears its saved mapping. SSH remotes continue to use SSH keys/configuration.

## Force push to the selected remote

After squashing or rebasing commits from a second remote, choose **Force push...** for that remote. Ordinary Push remains non-forcing.

The confirmation pins both the expected remote commit and the local commit to send and uses an explicit `--force-with-lease`. If the destination changed after confirmation, the operation is rejected instead of silently overwriting newer history. Server-side branch protection and pre-push hooks still apply.

## Updating

Windows users on a previous **3.6.7 beta** can receive this release through the fork's automatic updater, or check manually in **Help > About > Check for updates**. Once ready, restart normally or choose **Restart to update**.

Users on **3.6.6-beta6 or earlier** still need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux continue to require manual installation or a package-manager update.

## Included features

Multi-remote Fetch/Pull/Push/Force push, per-remote account routing, responsive read-only Issues, binary hex diffs, and verified Windows auto-updates remain included. Screenshots stay in Actions artifacts only.

This is a prerelease. Windows code signing is still disabled, and current macOS builds are ad-hoc signed. Platform trust warnings may appear.
