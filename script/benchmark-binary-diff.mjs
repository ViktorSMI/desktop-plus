#!/usr/bin/env node
// Standalone engine benchmark: no Electron, network, app globals or disk reads
// inside timed sections. Run with --expose-gc so paired samples start cleanly.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { arch, cpus, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'app/test/fixtures/binary-diff-baseline.ts')
const baselineBlob = '66165a8e831930a898560af28cb5f8cbd539e059'
const args = process.argv.slice(2)
const options = {
  verify: false,
  samples: 11,
  minimumSpeedup: 4,
  sampleMilliseconds: 30,
  candidate: join(root, 'app/src/lib/binary-diff.ts'),
  json: undefined,
  filter: '',
}
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--verify') {
    options.verify = true
    continue
  }
  const value = args[++i]
  if (value === undefined) throw new Error(`Missing value for ${arg}`)
  switch (arg) {
    case '--samples': options.samples = Number(value); break
    case '--minimum-speedup': options.minimumSpeedup = Number(value); break
    case '--sample-ms': options.sampleMilliseconds = Number(value); break
    case '--candidate': options.candidate = resolve(value); break
    case '--json': options.json = resolve(value); break
    case '--case': options.filter = value; break
    default: throw new Error(`Unknown argument: ${arg}`)
  }
}
assert.ok(Number.isInteger(options.samples) && options.samples >= 5 && options.samples <= 101)
assert.ok(Number.isFinite(options.minimumSpeedup) && options.minimumSpeedup > 0)
assert.ok(Number.isFinite(options.sampleMilliseconds) && options.sampleMilliseconds >= 10 && options.sampleMilliseconds <= 1000)
if (options.verify && typeof global.gc !== 'function') {
  throw new Error('Verification requires: node --expose-gc script/benchmark-binary-diff.mjs --verify')
}

function blobHash(source) {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(source)}\0`)
    .update(source)
    .digest('hex')
}

function bytes(length, seed = 0x12345678) {
  const data = Buffer.alloc(length)
  let state = seed
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    data[i] = state & 255
  }
  return data
}

// Each yield prepares inputs before timing. Equal sides are distinct buffers.
function* cases() {
  const data = bytes(16 * 1024 * 1024)
  yield ['identical-16MiB', data, Buffer.from(data), true]
  const single = Buffer.from(data)
  single[single.length >>> 1] ^= 255
  yield ['single-replacement-16MiB', data, single, true]
  const sparse = Buffer.from(data)
  for (let i = 8192; i < sparse.length; i += 32768) sparse[i] ^= 255
  yield ['sparse-512-changes-16MiB', data, sparse, true]
  const repeatedBefore = Buffer.alloc(1024 * 1024)
  const repeatedAfter = Buffer.from(repeatedBefore)
  for (let i = 64; i < repeatedAfter.length - 64; i += 2048) {
    repeatedAfter.fill(1, i, i + 16)
  }
  yield ['repeated-blocks-1MiB', repeatedBefore, repeatedAfter, true]
  const denseBefore = bytes(512 * 1024, 1)
  const denseAfter = Buffer.from(denseBefore)
  for (let i = 32; i < denseAfter.length - 32; i += 60) denseAfter[i] ^= 255
  yield ['dense-changes-512KiB', denseBefore, denseAfter, true]
  for (const length of [1024, 32 * 1024]) {
    const inserted = Buffer.concat([
      data.subarray(0, 1000), bytes(length, 2), data.subarray(1000),
    ])
    // A later change prevents common-suffix trimming from hiding the resync.
    inserted[8 * 1024 * 1024 + length] ^= 255
    yield [`insert-${length / 1024}KiB-16MiB`, data, inserted, true]
  }
  yield ['unrelated-256KiB', bytes(256 * 1024, 4), bytes(256 * 1024, 5), true]
  yield ['uniform-rewrite-1MiB', Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024, 255), true]
  yield ['periodic-rewrite-1MiB', Buffer.alloc(1024 * 1024, 'abcd'), Buffer.alloc(1024 * 1024, 'efgh'), true]
  const large = bytes(64 * 1024 * 1024, 13)
  const largeChanged = Buffer.from(large)
  largeChanged[largeChanged.length >>> 1] ^= 255
  yield ['single-replacement-64MiB', large, largeChanged, true]
  const deleted = Buffer.concat([large.subarray(0, 1024), large.subarray(2048)])
  deleted[8 * 1024 * 1024] ^= 255
  yield ['delete-1KiB-64MiB', large, deleted, true]
  yield ['unaligned-identical-16MiB', large.subarray(3, data.length + 3), Buffer.from(large.subarray(3, data.length + 3)), true]
  const small = Buffer.from(data.subarray(0, 128))
  small[64] ^= 255
  // Report tiny-input overhead too, but a 4x target is not meaningful for a
  // microsecond-sized diff or an empty fast return.
  yield ['small-single-replacement-128B', data.subarray(0, 128), small, false]
  yield ['empty', Buffer.alloc(0), Buffer.alloc(0), false]
}

const median = values => [...values].sort((a, b) => a - b)[values.length >> 1]
let sink = 0
function elapsed(fn, previous, current, iterations) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    const result = fn(previous, current)
    sink += result.changeCount + result.hunks.length
  }
  return performance.now() - start
}
function calibrate(fn, previous, current) {
  let iterations = 1
  while (iterations < 100000) {
    global.gc?.()
    const duration = elapsed(fn, previous, current, iterations)
    if (duration >= options.sampleMilliseconds) return iterations
    iterations = Math.min(100000, iterations * 2)
  }
  return iterations
}
function sample(fn, previous, current, iterations) {
  global.gc?.() // Outside timing; avoids charging a peer for leftover garbage.
  return elapsed(fn, previous, current, iterations) / iterations
}

const temporary = await mkdtemp(join(tmpdir(), 'binary-diff-bench-'))
const require = createRequire(import.meta.url)
async function loadEngine(source, name) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  })
  const errors = output.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? []
  assert.equal(errors.length, 0, `${name} must transpile`)
  const path = join(temporary, `${name}.cjs`)
  await writeFile(path, output.outputText)
  const engine = require(path)
  assert.equal(typeof engine.createBinaryDiff, 'function')
  return engine.createBinaryDiff
}

try {
  const referenceSource = (await readFile(baselinePath, 'utf8')).replace(/\r\n/g, '\n')
  // The only change in the fixture is its type-import path. Pin the original
  // Git blob so a "faster" result cannot be obtained by changing the baseline.
  assert.equal(blobHash(referenceSource.replace("from '../../src/models/diff'", "from '../models/diff'")), baselineBlob)
  const candidateSource = await readFile(options.candidate, 'utf8')
  const baseline = await loadEngine(referenceSource, 'baseline')
  const candidate = await loadEngine(candidateSource, 'candidate')
  const results = []
  for (const [name, previous, current, gate] of cases()) {
    if (options.filter && !name.includes(options.filter)) continue
    assert.deepEqual(candidate(previous, current), baseline(previous, current), `${name}: full result parity`)
    for (let i = 0; i < 8; i++) {
      baseline(previous, current)
      candidate(previous, current)
    }
    const beforeIterations = calibrate(baseline, previous, current)
    const afterIterations = calibrate(candidate, previous, current)
    const before = [], after = []
    for (let i = 0; i < options.samples; i++) {
      // Alternate order to reduce warm-cache and CPU-frequency bias.
      if ((i & 1) === 0) {
        before.push(sample(baseline, previous, current, beforeIterations))
        after.push(sample(candidate, previous, current, afterIterations))
      } else {
        after.push(sample(candidate, previous, current, afterIterations))
        before.push(sample(baseline, previous, current, beforeIterations))
      }
    }
    const speedup = median(before) / median(after)
    const result = {
      name, previousBytes: previous.length, currentBytes: current.length,
      beforeMs: median(before), afterMs: median(after), speedup,
      gated: gate, passed: !gate || speedup >= options.minimumSpeedup,
      beforeIterations, afterIterations, beforeSamplesMs: before, afterSamplesMs: after,
    }
    results.push(result)
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${name}: ${result.beforeMs.toFixed(4)} -> ${result.afterMs.toFixed(4)} ms (${speedup.toFixed(2)}x)${gate ? '' : ' [report only]'}`)
  }
  assert.ok(results.length > 0, 'No benchmark cases selected')
  const gated = results.filter(r => r.gated)
  assert.ok(!options.verify || gated.length > 0, 'Verification needs a gated case')
  const report = {
    scope: 'createBinaryDiff CPU/allocations only; excludes Git I/O, Electron and React rendering',
    generatedAt: new Date().toISOString(),
    node: process.version, v8: process.versions.v8, typescript: ts.version,
    platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
    samples: options.samples, sampleMilliseconds: options.sampleMilliseconds,
    explicitGC: typeof global.gc === 'function', minimumSpeedup: options.minimumSpeedup,
    baselineOriginalGitBlob: baselineBlob, candidateGitBlob: blobHash(candidateSource),
    geometricMeanSpeedup: Math.exp(gated.reduce((s, r) => s + Math.log(r.speedup), 0) / gated.length),
    passed: gated.every(r => r.passed), results, sink,
  }
  if (options.json) {
    await mkdir(dirname(options.json), { recursive: true })
    await writeFile(options.json, JSON.stringify(report, null, 2) + '\n')
  }
  console.log(`Geometric mean (gated cases): ${report.geometricMeanSpeedup.toFixed(2)}x`)
  if (options.verify && !report.passed) process.exitCode = 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
