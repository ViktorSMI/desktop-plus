## Remembered Actions status while moving the interface

Moving or resizing the window, scrolling History, and briefly hiding and restoring commit rows no longer discard their Actions status. A returning row immediately displays its cached circle instead of clearing it and starting the same request again. Equivalent account/profile objects also reuse the existing cache.

The last known result stays visible while a due refresh is in flight. Results and unfinished requests are shared by account, hosting server, repository and full commit SHA; a recycled row never displays another commit's or account's result. Signing out or replacing credentials invalidates matching retained data.

Polling still stops as soon as rows or the window are hidden. Active and failed runs refresh on the existing 30-second schedule; finished/no-run results use a two-minute freshness window. Idle repository caches are retained for up to five minutes, with at most eight idle targets and least-recently-used eviction of inactive commit snapshots. This is an in-memory cache, not permanent storage across application restarts.

## Actions status beside commits

The History commit list keeps the status indicators introduced in beta11:

- Red with a cross: a workflow failed, timed out, or requires attention.
- Orange with a clock: workflows are queued, waiting, or running.
- Green with a check: the latest relevant workflow runs passed.

Cancelled, stale, unknown, and all-skipped results remain gray. A commit without Actions runs has no colored badge. Hover for status, workflow count, and repository name. Push arrows and tags are unchanged; network errors are not displayed as successful checks.

## Existing features retained

The embedded GitHub/Gitea Actions monitor, faster binary-diff engine and bounded hex rendering, multi-remote operations, non-destructive **Sync both remotes**, per-remote accounts, read-only Issues, and verified Windows updates are unchanged.

## Updating

Windows users on an earlier **3.6.7 beta** can use the automatic updater or **Help > About > Check for updates**. Users on **3.6.6-beta6 or earlier** need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux require manual installation or a package-manager update.

This is a prerelease. Windows code signing remains disabled, and macOS builds are ad-hoc signed. Platform trust warnings may appear.
