# Updates for ViktorSMI/desktop-plus

The updater trust root is compiled into the app. It is always
`ViktorSMI/desktop-plus`, never a Git remote, a renderer-supplied URL, or the
original GitHub Desktop/Desktop Plus update service.

## User behavior

Official fork release builds check once about a minute after launch and every
four hours thereafter. About also offers **Check for updates**. Windows x64 and
arm64 installations made with the Squirrel installer download an eligible newer
release in the background, verify its exact size and SHA-256, and give the
verified local package to Electron's native updater. The app never restarts
itself while the user is working: the update takes effect on next launch, or
when the user chooses **Restart to update**.

Beta installations accept newer beta or stable releases. Stable installations
ignore betas. Drafts, equal/older versions, test tags, and releases without the
update manifest are ignored. `beta10` is newer than `beta9`. Windows NuGet
versions use zero-padded beta numbers to preserve this order in Squirrel too.
An in-flight or ready update is shared by all windows; repeated checks do not
start parallel installers.

The current macOS builds have ad-hoc signatures, not a Developer ID identity.
macOS and Linux therefore show the newer release and a manual-install link,
not a misleading "ready to restart" button. No signature check is bypassed.
Portable Windows builds without `Update.exe` also get the manual-install path.

## One-time migration

**beta6 and older cannot bootstrap this themselves:** their update entry point
was disabled. Users must install the first updater-enabled release manually.
Use a new base version such as **3.6.7-beta1** for this bootstrap, so the new
zero-padded NuGet version also sorts above the previous 3.6.6 packages. Subsequent
releases on that installed update channel can install automatically. Keep the
`DesktopPlus` package identity, executable name, and existing application data
paths unchanged.

## Publishing

The existing Beta release workflow builds with `DESKTOP_FORK_UPDATES=1` only in
this repository, includes both architecture-specific `*-full.nupkg` files, and
runs `script/create-update-manifest.py` before calculating checksums. The
script verifies the internal NuGet package identity/version and refuses a
partial architecture set. It creates `desktop-plus-updates.json` with schema
version 1, the pinned repository, UI version, package names, lengths, SHA-256,
SHA-1, and Squirrel versions. SHA-1 is retained only for the native RELEASES
format; SHA-256 is checked before native installation.

All assets are uploaded while the release is a draft, and only then is it
published. No separate web server or GitHub token on users' computers is needed.
Unsigned Windows packages rely on HTTPS and the trusted repository for
provenance; the manifest is **not** an independent cryptographic signature.
Protect GitHub publishing access and review changes to the release workflow.
Code signing remains recommended for Windows distribution.

Development, unconfigured builds, and builds from other repositories do not
self-update. Their renderer cannot enable the updater by supplying a URL. The
existing packaged E2E fixture is the only disabled-build exception, restricted
to its compiled-in loopback URL.

## Checks

`Fork updater checks` runs policy/download/controller tests, manifest-generation
tests, the enabled production compilation, and an isolated Windows installation
test. The Windows fixture uses the real updater controller and native Squirrel,
installs beta9, verifies/stages beta10, restarts, and asserts the new installed
version. Its release responses are synthetic and nothing is published. Normal
CI also runs the new TypeScript unit tests. Release builds wait for these checks.
