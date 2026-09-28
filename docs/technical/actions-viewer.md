# GitHub Actions viewer

Open **Current branch > Actions**, choose a GitHub remote and account, then select
any workflow run to inspect its jobs and steps. Unlike the Issues contribution
target, this view reads the **actual selected remote**, including forks. Push,
pull-request, scheduled and manually dispatched runs are included. GitHub and
GitHub Enterprise accounts use the application's existing authenticated API path.
Other hosting providers are not supported by this view.

The list has server-side status filters and pagination (30 runs per page). Run
details show branch, commit, event, actor, attempt, job/step status and elapsed
job/step time. Jobs are paginated at 100 per page and fetched for the observed run
attempt, so a rerun cannot mix attempts. Job logs and the full workflow run open
in the browser on the selected GitHub host. The view is **read only**: it never
cancels, reruns or dispatches a workflow, and does not download log archives.

The list refreshes every 30 seconds while visible. Run details refresh while a
run is incomplete; a completed run can be refreshed manually to detect a rerun.
Requests never overlap within one mounted view, and responses from an old
repository, account, page or unmounted component are ignored. Hidden windows do
not poll. Access, rate-limit and connection failures pause automatic updates;
the last successful response is explicitly marked stale and **Refresh** retries.
Account tokens are resolved by the dispatcher and are never copied into the
monitor or popup state. Multiple ambiguous accounts require an explicit choice rather than
silently trying a different account.

## Validation

```sh
node script/test.mjs app/test/unit/actions-client-test.ts app/test/unit/actions-viewer-test.tsx
yarn lint
yarn compile:prod
npx --no-install playwright install --with-deps chromium
node script/check-actions-viewer-layout.mjs
```

The normal unit suite discovers the new tests. The existing UI screenshot
workflow also runs the responsive Actions regression and uploads screenshots.
The browser harness uses real Actions components, the real Dialog, compiled app
CSS and synthetic API data, with Electron bridges and shared button/header
substitutes. It is not a packaged Electron test or a live GitHub integration test.
