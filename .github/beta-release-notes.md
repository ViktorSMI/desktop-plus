## Ordinary Pull then Push, including rewritten local history

The main Fetch / Pull / Push control no longer stops at a fetch-only "History rewritten" state. A branch with incoming commits offers the normal **Pull** action, including after amend, rebase, squash or reorder. Pull integrates using the repository's existing merge/rebase configuration and conflict-resolution flow. Once reconciled, the next ordinary action is **Push**; when up to date it is **Fetch**. There is no automatic push after a pull.

The main button, its dropdown, **Repository > Push** and **Ctrl/Cmd+P** do not turn into Force push. No automatic force push or hard reset is introduced. Explicit fast-forward-only policies are not overridden; conflicts and rejected pushes still require review. Merge preserves the old published commits as well as the integrated work; this flow does not replace published history with a rewritten local copy.

Intentional remote-history replacement remains a separate advanced action under **Current branch > More remote actions (⋯)** with typed destination confirmation and the existing explicit lease safeguards. The Actions badges, cache, navigation and binary diff are unchanged.

## Open Actions from History

Click a commit's Actions circle or right-click a single commit and choose **View Actions for commit…**. Both entry points open the built-in read-only Actions viewer for the full commit SHA and the same account/repository as History, independently of the remote selected in the Actions tab.

A single matching workflow opens directly to its jobs and steps. Multiple workflows show a chooser containing the latest run/attempt for each workflow, event and branch, with **Back to commit runs** and **Back to History** navigation. No-run, access and network errors are shown explicitly rather than opening an unrelated latest run. Run details are checked against the requested SHA and run ID before jobs or browser links are enabled.

The existing **Open run in browser** and job-log links remain available. Gitea uses its REST database ID for requests and its repository run number in browser URLs. Workflow names are rendered as text; provider-supplied URLs are not used for navigation.

The circle is keyboard-accessible with Enter or Space. Clicking it does not select, drag, squash, or check out a commit, and right-click still opens the commit menu. The aligned status column, bounded in-memory badge cache, refresh policy, and force-push safeguards introduced in beta12/beta13 are retained. A deliberate navigation loads the current list of runs; merely rerendering or reopening fresh cached History rows does not trigger it.

## Aligned History indicators

Actions circles and unpushed arrows now share the same right-hand alignment and vertical center in the History list. An empty Actions slot no longer shifts the push arrow left. When a commit has both indicators, both remain visible side by side. Tags, selected rows, long titles, and narrow History panels keep their layout.

## Safer access to remote force push

The prominent red Force push button has been removed from the branch picker's remote controls. Use the neutral **More remote actions (⋯)** menu, then **Force push <remote>/<branch>…**. Manage remotes is available in the same menu. Ordinary Fetch, Pull, and Push remain directly available.

Choosing Force push only opens the existing destination/commit confirmation. For a selected remote, the final button is disabled until the exact **remote/branch** is typed. Cancel remains the safe default. A changed confirmation snapshot invalidates the typed consent, and callbacks from an obsolete or closed remote menu cannot act on a different selection.

The existing explicit `--force-with-lease=<ref>:<expected commit>` safeguard is retained: unexpected remote commits reject the push, and the approved local commit and destination are checked again before execution. Other remotes, tags, and upstream configuration are not rewritten. Force push still deliberately replaces the reviewed branch history; the extra confirmation does not make it a non-destructive operation.

## Cache behavior

The beta12 in-memory status cache is retained. Reopening History within its retained lifetime immediately restores remembered circles and shares unfinished requests. Resizing or scrolling does not invalidate fresh results. Active/failed runs refresh every 30 seconds; finished/no-run results have a two-minute freshness window. A due refresh keeps the last circle visible while requesting the current status.

Hidden rows are not polled. Idle repository caches expire after five minutes, with at most eight idle targets and bounded commit snapshots. Signing out, replacing credentials, or restarting the application invalidates the corresponding in-memory data. This release does not add persistent disk caching.

## Updating

Windows users on an earlier **3.6.7 beta** can use **Help > About > Check for updates**. Users on **3.6.6-beta6 or earlier** need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux require manual installation or a package-manager update.

This is a prerelease. Windows code signing remains disabled, and macOS builds are ad-hoc signed. Platform trust warnings may appear.
