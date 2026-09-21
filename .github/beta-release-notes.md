## Force push to the selected remote

After squashing or rebasing commits from a second remote, you can now send the rewritten history back from inside Desktop Plus.

Open **Current branch > Branches**, select the destination remote, and choose **Force push...**. Ordinary **Push** remains a non-forcing operation.

### Confirm exactly what will be replaced

The confirmation shows the repository, destination remote and branch, sanitized push URL, expected remote commit, and local commit to send. **Cancel** is the default, and this confirmation cannot be skipped by the existing preference.

The operation uses an explicit `--force-with-lease` tied to the approved remote commit and sends only the approved local commit. A later background Fetch cannot weaken that check. If the remote history changes, the local branch or commit changes, or the push destination changes, the operation is rejected rather than silently retargeted.

**Force push rewrites the destination branch's history.** Review the confirmation and coordinate with other contributors before proceeding. Server-side branch protection and pre-push hooks still apply; the client never falls back to plain force.

Only the selected branch is sent. Configured upstream, other remotes, queued tags, and uncommitted files are not changed by this operation. Multiple push destinations and missing or unfetched targets are rejected.

## Updating

Windows users who installed **3.6.7-beta1** through the installer can receive this release through the fork's automatic updater, or check manually in **Help > About > Check for updates**. Once the update is ready, restart normally or choose **Restart to update**. No forced restart interrupts your work.

Users on **3.6.6-beta6 or earlier** need to install this release manually once to enable future Windows updates. macOS and Linux continue to show a release notice and require manual installation or a package-manager update as appropriate.

## Validation and included features

Before merging PR #8, the full platform CI, UI regression checks, and fork updater checks passed. Targeted coverage includes rewritten-history pushes, exact lease rejection after a background fetch, and the confirmation dialog.

Multi-remote Fetch/Pull/Push, responsive read-only Issues, binary hex diffs, and verified Windows auto-updates remain included. Screenshots stay in Actions artifacts only, not in release downloads.

This is a prerelease. Windows code signing is still disabled, and current macOS builds are ad-hoc signed. Platform trust warnings may appear. Windows update packages and `desktop-plus-updates.json` are published alongside installers and checksums; their integrity checks use HTTPS and this GitHub repository as the trust root, not a separate publisher signature.
