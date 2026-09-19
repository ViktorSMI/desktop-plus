## Binary comparison improvements

- Reworked binary diffs into an HxD/WinMerge-style side-by-side comparer.
- Compare up to 64 MiB per side instead of only the first 64 KiB.
- Resynchronize after inserted or deleted bytes so shifted data does not mark the whole remaining file as changed.
- Keep stable same-offset alignment for repetitive binary data and fixed-offset DAT-style changes.
- Show Before/After offsets, hex bytes, and ASCII together.
- Navigate between changed regions with Previous and Next controls.
- Collapse long unchanged ranges and bound very large changed regions to keep the UI responsive.
- Clearly report partial comparisons for oversized files instead of showing a misleading empty diff.

## Beta build

This is a prerelease. Windows code signing is disabled for these builds. Platform trust warnings may appear when installing an unsigned build.
