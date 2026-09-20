## Multi-remote workflow

- Added a remote selector to the Branches tab for repositories with multiple remotes.
- Switch between GitHub, Gitea, upstream/origin, or any other configured Git remote.
- Fetch only the selected remote, or fetch all remotes.
- Pull the current branch from the same-named branch on the selected remote.
- Push the current branch to the same-named branch on the selected remote.
- Switching remotes does not rewrite the branch's configured Git upstream.
- Pull is disabled when the selected remote does not have the current branch; Push can create it there.
- Local branches remain visible while remote-tracking branches are filtered to the selected remote.
- The selected remote is remembered per local repository.
- Existing Manage Remotes remains available from the selector.

The normal toolbar Push/Pull behavior is unchanged and continues to follow the branch's configured upstream. The new controls in the Branches tab are the explicit multi-remote workflow.

## Included from previous betas

- Read-only issue browsing with responsive in-app issue details and comments.
- HxD/WinMerge-style binary diff improvements.

## Beta build

This is a prerelease. Windows code signing is disabled for these builds. Platform trust warnings may appear when installing an unsigned build.
