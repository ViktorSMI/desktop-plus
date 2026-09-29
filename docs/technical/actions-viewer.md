# Actions viewer

Open **Current branch > Actions**, choose a GitHub or Gitea remote and account, then select
any workflow run to inspect its jobs and steps. Unlike the Issues contribution
target, this view reads the **actual selected remote**, including forks. Push,
pull-request, scheduled and manually dispatched runs are included. GitHub and
GitHub Enterprise accounts use the application's existing authenticated API path.
Gitea support and its API version requirements are described below. Other hosting
providers are not supported by this view.

The list has server-side status filters and pagination (30 runs per page). Run
details show branch, commit, event, actor, attempt, job/step status and elapsed
job/step time. GitHub jobs are paginated at 100 per page and fetched for the observed run
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

## Gitea Actions

Gitea Cloud and self-hosted Gitea **1.25 or later** are supported when the server
and repository have Actions enabled and the selected account can read them.
Choose the Gitea remote and its signed-in account in **Current branch > Actions**.
Other providers, including Forgejo/Codeberg, are not implicitly treated as Gitea.

The Gitea adapter reuses the application's existing Gitea API instance, including
its OAuth token-refresh lock. HTTPS instance ports and path prefixes are matched
exactly; SSH ports are not confused with web ports. Ambiguous SSH instances
require an explicit account/server selection. No credentials enter UI state.

Gitea REST calls use the internal run ID; browser links use the repository's run
number. Legacy zero-based job links and newer database-ID job links are accepted
only after validating the origin, repository and run against the trusted target.
Invalid/missing job links fall back to the selected run page. API-provided links
are never followed with credentials, and no log archives are downloaded.

Gitea uses `limit` pagination (30 runs / 50 jobs); pagination links can indicate a
server-imposed lower page limit. Empty conclusions and unset/epoch timestamps
are normalized. Gitea step numbering is converted to one-based display. Servers
that omit run attempts display that limitation and use the latest-jobs endpoint;
servers exposing attempts use attempt-specific job requests. Missing dates,
attempts or steps are not invented. A 404 is an explicit compatibility/access
error, not a successful empty list. Logs remain available in the browser.

Compatibility fixtures cover the Gitea 1.25 and 1.27 API response shapes. They are
based on the tagged upstream conversion and API code, not fabricated GitHub
responses. These tests do not substitute for testing a user's live Gitea server.
Run them with `node script/test.mjs app/test/unit/gitea-actions-client-test.ts`.
