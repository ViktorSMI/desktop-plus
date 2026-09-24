## One-click synchronization for two remotes

Repositories with exactly two user-configured remotes can now opt into **Sync both remotes** from **Current branch > Branches**.

When enabled, the normal toolbar network button becomes **Sync remotes**. One click:

- fetches both remotes using each remote's remembered account,
- compares the current local branch with the same-named branch on both remotes,
- fast-forwards the local branch to the newest history when one side cleanly contains the others,
- then pushes that resulting branch to both remotes.

This is deliberately non-destructive. It never force-pushes. If the two remotes contain independent divergent commits and no existing local/remote tip already contains both histories, synchronization stops before pushing and asks you to merge the divergent histories first. A failed fetch also aborts before any push, so stale tracking refs are never used to decide what to overwrite.

If the current local branch already contains commits from both diverged remotes (for example after you merged them), **Sync remotes** can safely push that merged history to both sides.

The option is stored per repository. Desktop Plus internal helper remotes are ignored; the feature requires exactly two normal user remotes.

## Selected-remote commit counts

The multi-remote panel continues to show the current branch difference against the selected remote:

- `3↑` means 3 commits to push.
- `2↓` means 2 commits to pull.
- zero/zero means **Up to date**.

The count refreshes after switching remotes and after Fetch, Pull, Push, or Force push.

## Per-remote accounts

Each HTTPS remote can remember its own signed-in account. This makes setups such as `origin -> @work` and `personal -> @personal` work without repeatedly asking which account to use. Fetch, Pull, Push, Force push, background fetches, and the new two-remote synchronization all use the saved mapping.

SSH remotes continue to use SSH keys and configuration.

## Updating

Windows users on an earlier **3.6.7 beta** can receive this release through the automatic updater, or check manually in **Help > About > Check for updates**. Restart normally or choose **Restart to update** when it is ready.

Users on **3.6.6-beta6 or earlier** still need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux continue to require manual installation or a package-manager update.

## Included features

Multi-remote Fetch/Pull/Push/Force push, per-remote account routing, responsive read-only Issues, binary hex diffs, and verified Windows auto-updates remain included. Screenshots stay in Actions artifacts only.

This is a prerelease. Windows code signing is still disabled, and current macOS builds are ad-hoc signed. Platform trust warnings may appear.
