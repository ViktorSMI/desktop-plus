# Force push to an explicit remote

In the branch picker's remote selector, **Force push…** rewrites the current
branch on the selected remote. It does not change the branch's Git upstream.
For example, select `gitea`, force push `main`, then select `origin` and repeat.
This is useful after squashing or rebasing commits that were already published.
The ordinary toolbar Push/Force push behavior remains unchanged.

The explicit action always requires confirmation, even when ordinary force-push
confirmations are disabled. It shows the remote, branch, last-fetched remote tip,
and local commit to be sent. Cancel is the default action. No implicit fetch,
plain `--force`, fallback to the upstream, or automatic retry is performed.

The lease uses `--force-with-lease=refs/heads/<branch>:<reviewed-remote-sha>`.
Background fetch cannot silently change this expectation while the dialog is
open. A moved/deleted remote branch rejects the operation. Fetch, review the
changes, and confirm again. This is not a guarantee that all remote work is
preserved: the reviewed remote history is intentionally being replaced.

Before the push, the repository, local branch/tip, remote identity and resolved
single push URL are checked again. The source is the exact confirmed commit,
not a mutable HEAD reference. Pre-push hooks and server branch protections still
apply. Pending tags are neither sent nor cleared, and `push.followTags` is
overridden with `--no-follow-tags` for this action.

A cached remote ref is required: fetch first, or use normal Push for a new branch.
Mirror remotes, multiple push URLs, and different fetch/push endpoints are refused
because one fetched remote ref cannot protect multiple/different destinations.
Use a dedicated fetched remote for each such destination.

Regression tests exercise real temporary local Git repositories and two bare
remotes, including a background-fetch race, squashed history, unchanged upstream,
remote deletion, branch/config changes, hooks, tag isolation, and protected refs.
Dialog tests cover explicit confirmation, cancellation, and duplicate submissions.
