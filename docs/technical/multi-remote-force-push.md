# Force push to a selected remote

In **Current branch > Branches**, choose one remote and use **Force push…**
under its Fetch/Pull/Push controls. This replaces the same-named remote branch
with the current local branch after a squash, rebase, or amended commit.
Normal Push remains a non-forcing operation.

The confirmation always names the repository, destination, expected remote
commit, and local commit to send. Cancel is the default action. The existing
“Do not show again” preference for upstream force pushes does not bypass this
confirmation.

Only the selected remote branch is updated. The branch's configured upstream,
other remotes, tags, and uncommitted local work are left alone. The request
records the two commit IDs before confirmation; it does not fetch first or
refresh the lease on retry. An intervening background fetch cannot silently
approve someone else's commits. Git rejects the push when the server's branch
no longer matches that recorded commit. Fetch, review the changed history, and
confirm again rather than retrying with plain `--force`.

Changing the local branch, committing again, removing the remote, or changing
its push URL invalidates the confirmation. Remotes with multiple push URLs are
rejected so one confirmation cannot overwrite several servers. Server branch
protection and pre-push hooks are respected. A missing/unfetched remote branch
must be fetched and reviewed first; normal Push can create a new branch.

The actual forced operation pins both source and destination:

```text
git -c remote.<remote>.mirror=false push --no-follow-tags \
  --force-with-lease=refs/heads/<branch>:<approved-remote-sha> \
  -- <remote> <approved-local-sha>:refs/heads/<branch>
```

Tests use isolated temporary repositories and two local bare remotes. They cover
rewritten history, concurrent remote commits even after fetch, deleted refs,
changed local state and destinations, slash-containing branches, tag/ref
ambiguity, restricted servers, progress reporting, and preservation of unrelated
refs and local work. Dialog tests cover the destination, safe default, Cancel,
once-only submission, and the existing upstream force-push path.
