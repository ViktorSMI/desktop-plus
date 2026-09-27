## Faster binary diffs

This release includes the optimized binary diff engine from commits `62c7173` and `60673de`, which were not part of beta8. Long unchanged ranges are compared using native Buffer operations, and bounded anchor searches reuse typed-array indexes instead of allocating many small candidate arrays.

The dedicated GitHub Actions benchmark on Node 24.19.0 passed the 4x target on all 13 nontrivial workloads: minimum **4.13x**, geometric mean **13.72x**. For example, a replacement in a 64 MiB file took **4.81 ms instead of 75.39 ms**, and 512 separated changes in a 16 MiB file took **4.47 ms instead of 38.08 ms**. These are median measurements from run https://github.com/ViktorSMI/desktop-plus/actions/runs/36276156017, not a guarantee for every file or machine.

The measurements cover `createBinaryDiff`, including creation of preview hunks. They exclude Git operations, disk reads, and Electron/React rendering. Full-window latency has not been measured. Tiny and empty inputs are reported separately rather than subjected to the 4x threshold.

Comparison limits, anchor selection rules, preview bytes, and truncation warnings are preserved. Regression coverage compares the complete output against the pinned previous implementation and independently reconstructs edited files, including 3000 deterministic mixed-edit cases. A type-inference error in this new test has also been corrected so it can pass production type checking without changing its runtime behavior.

## Binary diff memory hotfix retained

The hex viewer still mounts only the selected change group, avoiding the excessive DOM allocation caused by displaying every group at once. Use **Previous** and **Next** to navigate all available groups. Switching files resets the selection before rendering, and scroll resets stay inside the current viewer.

This addresses the eager-rendering allocation hotspot. It is not a claim that every possible retained-memory leak has been ruled out by Electron heap profiling.

## Existing features retained

One-click **Sync both remotes**, multi-remote Fetch/Pull/Push/Force push, selected-remote commit counts, per-remote HTTPS accounts, responsive read-only Issues, and verified Windows auto-updates remain included.

Two-remote synchronization remains non-destructive: it never force-pushes, and divergent histories must be merged before synchronization can continue. SSH remotes continue to use SSH keys and configuration.

## Updating

Windows users on an earlier **3.6.7 beta** can receive this release through the automatic updater, or check manually in **Help > About > Check for updates**. Restart normally or choose **Restart to update** when it is ready.

Users on **3.6.6-beta6 or earlier** still need one manual installation of a 3.6.7 beta to enable future Windows updates. macOS and Linux continue to require manual installation or a package-manager update.

This is a prerelease. Windows code signing is still disabled, and current macOS builds are ad-hoc signed. Platform trust warnings may appear. Screenshots stay in Actions artifacts only.
