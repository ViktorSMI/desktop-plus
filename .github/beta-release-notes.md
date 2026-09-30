## Actions status beside commits

The History commit list now shows a small Actions status circle beside the existing tag and unpushed-commit indicators:

- Red with a cross: a workflow failed, timed out, or requires attention.
- Orange with a clock: workflows are queued, waiting, or running.
- Green with a check: the latest relevant workflow runs passed.

Hover the circle for its status, workflow count, and repository name. Cancelled, stale, unknown, or all-skipped results are gray; a commit with no Actions runs has no colored badge. Loading is not reported as a running workflow. Existing push arrows and tags are preserved.

Results are requested by the full commit SHA from the repository associated with History, not a fork's upstream. The badge does not change when choosing another remote only in the separate Actions dialog. GitHub, GitHub Enterprise, and supported Gitea Actions endpoints use the already signed-in account; unsupported providers are not queried.

Repeated runs use the latest run/attempt for each workflow, event, and branch. Failures take precedence over other running workflows. Every result page is checked, and a missing, mismatched, or incomplete response never becomes a green check.

Only visible commit rows in a visible window are polled. Requests for the same commit are shared, concurrency is limited to two per account/repository, active and failed results refresh on a 30-second schedule, and finished/no-run results are cached for two minutes. Access, network, and rate-limit errors show an unavailable status and back off for five minutes. Closing the view releases its polling and cache.

## Existing features retained

The embedded GitHub/Gitea Actions monitor, faster binary-diff engine and bounded hex rendering, multi-remote operations, non-destructive **Sync both remotes**, per-remote accounts, read-only Issues, and verified Windows updates are unchanged.

## Updating

Windows users on an earlier **3.6.7 beta** can use the automatic updater or **Help > About > Check for updates**. Users on **3.6.6-beta6 or earlier** need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux require manual installation or a package-manager update.

This is a prerelease. Windows code signing remains disabled, and macOS builds are ad-hoc signed. Platform trust warnings may appear.
