## GitHub and Gitea Actions inside Desktop Plus

Open **Current branch > Actions**, choose the repository remote and a signed-in account, and select a workflow run to inspect its jobs and steps without leaving Desktop Plus.

- GitHub, GitHub Enterprise, Gitea Cloud, and self-hosted Gitea are supported. Gitea requires **version 1.25 or later**, Actions enabled, and account access to the repository. Forgejo/Codeberg and other providers are not implicitly treated as Gitea.
- The list includes push, pull-request, scheduled, and manually triggered runs, with status filters and pagination. Details show branch, commit, actor, job/step statuses and available timing information.
- The viewer reads the **actual selected remote**, including forks, not an upstream contribution target. Self-hosted Gitea web ports and path prefixes are respected, and ambiguous SSH instances require an explicit account/server choice.
- Visible views refresh every 30 seconds. Hidden/closed views do not poll. Requests do not overlap within a view, stale responses are ignored, and network, access or rate-limit errors pause polling until an explicit retry.

This is **read-only monitoring**. The viewer does not cancel, rerun or dispatch workflows. Full logs open in the browser on the selected hosting server; large log archives are not downloaded into the app.

## Gitea compatibility

The Gitea adapter uses the application's existing authenticated API and OAuth refresh handling. Tokens are not copied into popup or viewer state. Gitea REST requests use internal run IDs, while browser links use repository run numbers. Job links are validated against the selected server, repository and run, including legacy zero-based job links and newer job-ID links.

Where Gitea reports a run attempt, jobs are requested for that attempt. Older servers that omit attempt metadata are explicitly marked as returning latest jobs. Missing dates or steps are not invented; open the run or job in the browser when the server does not expose those details. Unsupported/disabled APIs or denied access produce an error, not a misleading empty-success screen.

Regression coverage exercises GitHub and Gitea client routing, API response normalization, paging, missing metadata, failure handling and safe links. Responsive browser checks cover both viewers at four window sizes. The API fixtures are based on the Gitea 1.25 and 1.27 response shapes; they are not a live integration test against every self-hosted installation.

## Existing features retained

The faster binary-diff engine and bounded hex-viewer rendering from beta9 remain unchanged. Multi-remote operations, non-destructive **Sync both remotes**, per-remote accounts, read-only Issues, and verified Windows auto-updates remain included.

## Updating

Windows users on an earlier **3.6.7 beta** can use the automatic updater or **Help > About > Check for updates**. Users on **3.6.6-beta6 or earlier** need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux require manual installation or a package-manager update.

This is a prerelease. Windows code signing remains disabled, and macOS builds are ad-hoc signed. Platform trust warnings may appear. Validation screenshots stay in Actions artifacts, not in installer assets.
