## Issue reader improvements

- Open issues in a dedicated, viewport-sized reader instead of the narrow branch dropdown.
- Scroll the description and comments without losing the close button or navigation controls.
- Reflow long titles and Markdown when the window is resized.
- Jump to comments, refresh the issue, retry loading, and return to the Issues list.
- Fetch all comment pages and display long discussions in batches of 20.
- Ignore outdated responses after switching issues or repositories.

Issue browsing remains read-only. Binary hex diff support from beta3 is included.

## UI screenshots

The release includes an `issue-reader-screenshots.zip` archive. Extract it and open `index.html` to browse the screenshots. The same pictures are available in the release workflow's `issue-reader-layout` artifact.

These are automated Chromium screenshots of the real issue reader components and compiled application stylesheet using a synthetic issue with 45 comments. Electron bridges and some supporting controls are mocked. They are not screenshots of a signed Windows/macOS installation or tests against live hosting providers.

## Beta build

This is a prerelease. Windows code signing is disabled for these builds. Platform trust warnings may appear when installing an unsigned build.
