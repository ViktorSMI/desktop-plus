## Automatic updates for this fork

Windows installations now check only the releases of `ViktorSMI/desktop-plus`. Newer compatible releases are downloaded in the background, verified, and staged with the native Squirrel updater. The application does not restart in the middle of your work: restart normally or choose **Restart to update** when it is ready.

The first check runs about one minute after launch, then every four hours. **Help > About > Check for updates** starts a manual check. Beta versions are compared numerically, including beta9 to beta10; stable installations do not silently switch to beta releases.

### One-time installation required

Earlier betas have updating disabled in their client code. Install this release manually once. Later updater-enabled releases can then arrive automatically. The version moves to `3.6.7-beta1` to bootstrap the new Windows package version ordering without downgrading an older beta6 installation.

Windows updates preserve the existing application identity and user data. This release does not switch CPU architecture, change Git remotes, or modify repository contents during update checks.

### Other platforms

Our macOS builds are ad-hoc signed and do not support native automatic replacement until Developer ID signing is configured. macOS and Linux users receive a new-release notice with a link to this fork's release page. Linux packages should be updated through the package manager when applicable.

### Verification and release assets

Windows full update packages (`.nupkg`) and `desktop-plus-updates.json` are included alongside installers. The updater validates the repository, version, architecture, exact size, and SHA-256 before Squirrel sees a package. HTTPS and the pinned GitHub repository are the trust root; these checksums are not a separate publisher signature. Windows code signing is still disabled, so platform trust warnings may appear.

Multi-remote Fetch/Pull/Push, responsive read-only Issues, and binary hex diffs from previous betas remain included. Screenshots stay in Actions artifacts only, not in release downloads.
