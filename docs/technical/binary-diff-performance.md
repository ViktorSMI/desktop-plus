# Binary diff performance

## Scope and compatibility

This optimizes `createBinaryDiff` and `findBinaryChanges`, not Git process I/O,
file reads, React mounting, or Electron scheduling. The existing one-hunk-at-a-time
UI is unchanged. Comparison limits, anchor size, first-eight FNV candidate cap,
change-region limits, hunk grouping and truncation flags are unchanged.

The frozen reference in `app/test/fixtures/binary-diff-baseline.ts` is the engine
previously inspected in source commit
`7a9d9e3fc9bd7b81725b67e71f01a9fcbd5ca86b`. The original Git blob is
`66165a8e831930a898560af28cb5f8cbd539e059`. Only its type-import path is adjusted
for the fixture location. The benchmark restores that path and verifies the blob
hash before running. Do not change the reference to make a speed test pass.

## Changes

- Native, range-based Buffer comparisons skip long identical prefixes, suffixes
  and interior runs, without allocating Buffer views.
- Aligned one-/two-byte resynchronization avoids building an index when the
  optimal score is already known. The scoring and tie-breaking rules stay intact.
- Per-comparison typed-array indexes replace per-anchor arrays and Map entries.
  Each search window reuses its own bounded scratch space. A Map overflow path
  bounds linear probing for deliberately colliding inputs.
- Candidate scores prune impossible matches before checking bytes. Previous
  offsets beyond the best score cannot improve that score and are not visited.
- Periodic-run skipping only omits anchors already discarded by the eight-candidate
  cap, or a repeated set of previous anchors proven to have no matching bucket.
- Large nonperiodic windows use a conservative eight-byte rejection pass. An
  eight-byte match never becomes a sync point; it falls back to the full FNV and
  16-byte comparison. Long probe chains also fall back, never silently reject.
- Preview bytes are copied directly into plain arrays, with no references to
  full input buffers escaping in the result.

## Correctness tests

The additional unit suite compares complete results against the frozen reference,
then independently reconstructs the new input from reported changes when the
search is not truncated. It includes 3000 seeded mixed-edit cases, empty and
short inputs, native-block/resync boundaries, periodic runs, unaligned Buffer
views, full FNV collisions, table-slot collisions, scratch reuse, truncation,
prefilter false positives, and input ownership.

```sh
yarn test app/test/unit/binary-diff-test.ts app/test/unit/binary-diff-optimized-test.ts
```

## Performance gate

```sh
node --expose-gc script/benchmark-binary-diff.mjs --verify --json binary-diff-performance.json
```

All 13 nontrivial workloads must individually reach at least 4x the reference
speed. The geometric mean is descriptive, not a substitute for the per-case
threshold. Tiny and empty inputs are reported separately without a 4x gate.
They must not be omitted from reports merely because the optimization provides
little benefit at that scale.

Inputs are generated outside timing; both engines must return exactly equal
results before a case is timed. After eight warmups, batches are calibrated toward
30 ms (at most 100000 iterations). Eleven samples alternate engine order.
Explicit garbage collection occurs before, not inside, each measured batch.
Allocation and collection caused during a batch remain part of the measurement.
The report includes raw samples, batch counts, runtime/CPU details and source
fingerprints. Medians, not the fastest sample, determine the result.

A negative control must fail, demonstrating that the gate is active:

```sh
node --expose-gc script/benchmark-binary-diff.mjs --verify --case unrelated --candidate app/test/fixtures/binary-diff-baseline.ts
```

The dedicated GitHub Actions workflow runs on matching pushes to `main`, pull
requests and manual dispatch. It uploads JSON reports even on a threshold failure.
It needs only root dependencies and skips installation scripts; existing project
CI remains responsible for the complete app build and unit test suite.

## Interpretation

A 4x engine result is not a 4x end-to-end UI result. Real-world latency also includes
reading both files, Git subprocesses and rendering. Run the matrix on the actual
CI/runtime and profile Electron before asserting an app-wide speedup. Shared CI
hardware can be noisy; inspect the raw samples and reproduce a failed threshold
rather than lowering it or rerunning until a lucky sample passes.
