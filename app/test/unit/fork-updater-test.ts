import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'crypto'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  compareForkVersions,
  ForkManifestName,
  ForkReleasesAPI,
  ForkRepository,
  getWindowsUpdateVersion,
  parseForkVersion,
  parseWindowsPackage,
  releaseAssetURL,
  selectForkRelease,
} from '../../src/lib/updates/fork-release'
import {
  downloadUpdate,
  isTrustedUpdateURL,
  readUpdateJSON,
  UpdateFetch,
} from '../../src/lib/updates/update-download'
import { ForkUpdater } from '../../src/lib/updates/fork-updater'

const bytes = Buffer.from('verified package fixture')
const version = '3.6.7-beta10'
const packageName = `DesktopPlus-v${version}-x64-full.nupkg`
const packageInfo = {
  name: packageName,
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sha1: createHash('sha1').update(bytes).digest('hex'),
  squirrelVersion: getWindowsUpdateVersion(version),
}
const manifest = {
  schemaVersion: 1,
  repository: ForkRepository,
  version,
  windows: { x64: packageInfo },
}
function releaseEntry(v = version, extra = {}) {
  return {
    tag_name: `v${v}`,
    draft: false,
    prerelease: v.includes('beta'),
    assets: [ForkManifestName, packageName].map(name => ({
      name,
      state: 'uploaded',
    })),
    ...extra,
  }
}
const release = selectForkRelease([releaseEntry()], '3.6.7-beta9')!
function json(data: unknown) {
  return new Response(JSON.stringify(data))
}

async function directory(t: import('node:test').TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'fork-update-test-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

function server(requests: string[], corrupt = false): UpdateFetch {
  return async (url, options) => {
    requests.push(url)
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'manual')
    assert.equal(
      (options.headers as Record<string, string>).Authorization,
      undefined
    )
    if (url === ForkReleasesAPI) {
      return json([releaseEntry()])
    }
    if (url.endsWith(`/${ForkManifestName}`)) {
      return json(manifest)
    }
    if (url.endsWith(`/${packageName}`)) {
      return new Response(corrupt ? Buffer.from('tampered') : bytes)
    }
    throw new Error(`Unexpected endpoint ${url}`)
  }
}

describe('fork update release policy', () => {
  it('orders beta9 before beta10 in the app and NuGet', () => {
    assert(compareForkVersions('3.6.7-beta10', '3.6.7-beta9') > 0)
    assert(
      getWindowsUpdateVersion('3.6.7-beta10') >
        getWindowsUpdateVersion('3.6.7-beta9')
    )
    assert(compareForkVersions('3.6.7', '3.6.7-beta999') > 0)
    assert(compareForkVersions('3.6.8-beta1', '3.6.7') > 0)
  })
  it('rejects unsafe and unsupported tags', () => {
    for (const value of [
      '',
      '../../x',
      'v3.6.7',
      '3.6.7-beta0',
      '3.6.7-rc1',
      '3.6.7+build',
      '3.6.7-beta01',
    ]) {
      assert.equal(parseForkVersion(value), null)
    }
  })
  it('never downgrades or updates to the same version', () => {
    assert.equal(selectForkRelease([releaseEntry()], version), null)
    assert.equal(selectForkRelease([releaseEntry()], '3.6.8-beta1'), null)
  })
  it('keeps stable users out of beta releases', () => {
    assert.equal(
      selectForkRelease([releaseEntry('3.6.8-beta1')], '3.6.7'),
      null
    )
    assert.equal(
      selectForkRelease([releaseEntry('3.6.8')], '3.6.7-beta1')?.version,
      '3.6.8'
    )
  })
  it('sorts by version, not API order or release publication time', () => {
    assert.equal(
      selectForkRelease(
        [releaseEntry('3.6.7-beta11'), releaseEntry()],
        '3.6.7-beta9'
      )?.version,
      '3.6.7-beta11'
    )
  })
  it('ignores drafts, incomplete uploads and mismatched prerelease flags', () => {
    for (const extra of [
      { draft: true },
      { assets: [] },
      { prerelease: false },
      { assets: [{ name: ForkManifestName, state: 'new' }] },
    ]) {
      assert.equal(
        selectForkRelease([releaseEntry(version, extra)], '3.6.7-beta9'),
        null
      )
    }
  })
  it('constructs download URLs only inside the pinned fork', () => {
    assert.equal(
      releaseAssetURL(release, packageName),
      `https://github.com/ViktorSMI/desktop-plus/releases/download/v${version}/${packageName}`
    )
    assert.throws(() => releaseAssetURL(release, '../bad.nupkg'))
    assert.throws(() =>
      releaseAssetURL({ ...release, tag: '../../bad' }, packageName)
    )
  })
  it('requires matching fork, tag, architecture, package, size and hashes', () => {
    assert.deepEqual(parseWindowsPackage(manifest, release, 'x64'), packageInfo)
    assert.throws(() => parseWindowsPackage(manifest, release, 'arm64'))
    assert.throws(() => parseWindowsPackage(manifest, release, 'ia32'))
    for (const extra of [
      { repository: 'desktop/desktop' },
      { version: '3.6.7-beta9' },
      { schemaVersion: 2 },
    ]) {
      assert.throws(() =>
        parseWindowsPackage({ ...manifest, ...extra }, release, 'x64')
      )
    }
    for (const extra of [
      { name: 'evil.exe' },
      { sha256: 'bad' },
      { sha1: 'bad' },
      { size: -1 },
      { size: 2 ** 40 },
      { squirrelVersion: version },
    ]) {
      assert.throws(() =>
        parseWindowsPackage(
          { ...manifest, windows: { x64: { ...packageInfo, ...extra } } },
          release,
          'x64'
        )
      )
    }
  })
})

describe('verified update transport', () => {
  it('rejects foreign repos, HTTP, credentials, custom ports, and untrusted CDNs', () => {
    for (const url of [
      'http://github.com/ViktorSMI/desktop-plus/releases/download/v1/a',
      'https://github.com/desktop/desktop/releases/download/v1/a',
      'https://github.com:444/ViktorSMI/desktop-plus/releases/download/v1/a',
      'https://token@api.github.com/repos/ViktorSMI/desktop-plus/releases',
      'https://evil.test/a',
      'file:///tmp/a',
    ]) {
      assert.equal(isTrustedUpdateURL(url, true), false)
    }
    assert.equal(
      isTrustedUpdateURL('https://release-assets.githubusercontent.com/a'),
      false
    )
    assert.equal(
      isTrustedUpdateURL(
        'https://release-assets.githubusercontent.com/a',
        true
      ),
      true
    )
  })
  it('rejects redirects outside the allowlist', async () => {
    await assert.rejects(
      readUpdateJSON(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://evil.test/feed' },
          }),
        ForkReleasesAPI
      ),
      /untrusted/
    )
  })
  it('bounds metadata and reports rate limiting, not up-to-date', async () => {
    await assert.rejects(
      readUpdateJSON(
        async () => json({ x: 'x'.repeat(100) }),
        ForkReleasesAPI,
        12
      ),
      /size limit/
    )
    await assert.rejects(
      readUpdateJSON(
        async () => new Response('', { status: 403 }),
        ForkReleasesAPI
      ),
      /HTTP 403/
    )
  })
  it('writes verified content, removes partial files, and rejects corruption', async t => {
    const root = await directory(t)
    const target = join(root, 'update.nupkg')
    await downloadUpdate(
      async () => new Response(bytes),
      releaseAssetURL(release, packageName),
      target,
      packageInfo
    )
    assert.deepEqual(await readFile(target), bytes)
    for (const bad of [
      Buffer.from('tampered'),
      Buffer.concat([bytes, bytes]),
      Buffer.alloc(bytes.length),
    ]) {
      const dest = join(root, 'bad.nupkg')
      await assert.rejects(
        downloadUpdate(
          async () => new Response(bad),
          releaseAssetURL(release, packageName),
          dest,
          packageInfo
        )
      )
      assert.deepEqual(await readdir(root), ['update.nupkg'])
    }
  })
  it('cleans up truncated network streams', async t => {
    const root = await directory(t)
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
        controller.error(new Error('disconnected'))
      },
    })
    await assert.rejects(
      downloadUpdate(
        async () => new Response(body),
        releaseAssetURL(release, packageName),
        join(root, 'bad.nupkg'),
        packageInfo
      )
    )
    assert.deepEqual(await readdir(root), [])
  })
})

describe('main-process fork updater', () => {
  it('coalesces checks across windows, stages only verified packages, never restarts automatically', async t => {
    const root = await directory(t)
    const requests: string[] = []
    let applications = 0
    let restarts = 0
    const events: string[] = []
    const updater = new ForkUpdater({
      currentVersion: '3.6.7-beta9',
      arch: 'x64',
      cacheDirectory: root,
      fetch: server(requests),
      manualReason: async () => null,
      apply: async path => {
        applications++
        const name = `DesktopPlus-${packageInfo.squirrelVersion}-full.nupkg`
        assert.equal(
          await readFile(join(path, 'RELEASES'), 'utf8'),
          `${packageInfo.sha1.toUpperCase()} ${name} ${bytes.length}\n`
        )
        assert.deepEqual(await readFile(join(path, name)), bytes)
        return true
      },
      quitAndInstall: () => {
        restarts++
      },
    })
    updater.on('error', assert.fail)
    for (const event of [
      'checking-for-update',
      'update-available',
      'update-downloaded',
    ]) {
      updater.on(event, () => events.push(event))
    }
    updater.quitAndInstall()
    assert.equal(restarts, 0)
    const first = updater.checkForUpdates()
    assert.equal(updater.checkForUpdates(), first)
    await first
    assert.equal(applications, 1)
    assert.equal(restarts, 0)
    assert.deepEqual(events, [
      'checking-for-update',
      'update-available',
      'update-downloaded',
    ])
    assert.deepEqual(await readdir(root), [])
    await updater.checkForUpdates()
    assert.equal(requests.length, 3)
    updater.quitAndInstall()
    assert.equal(restarts, 1)
  })
  it('never passes a tampered package to Squirrel', async t => {
    const root = await directory(t)
    const errors: Error[] = []
    let applied = false
    const updater = new ForkUpdater({
      currentVersion: '3.6.7-beta9',
      arch: 'x64',
      cacheDirectory: root,
      fetch: server([], true),
      manualReason: async () => null,
      apply: async () => {
        applied = true
        return true
      },
      quitAndInstall: () => assert.fail('must not restart'),
    })
    updater.on('error', error => errors.push(error))
    await updater.checkForUpdates()
    assert.equal(applied, false)
    assert.equal(errors.length, 1)
    assert.deepEqual(await readdir(root), [])
  })
  it('reports manual availability without downloading or applying on unsupported platforms', async t => {
    const requests: string[] = []
    const updater = new ForkUpdater({
      currentVersion: '3.6.7-beta9',
      arch: 'arm64',
      cacheDirectory: await directory(t),
      fetch: server(requests),
      manualReason: async () => 'Developer ID required',
      apply: async () => assert.fail(),
      quitAndInstall: () => assert.fail(),
    })
    let received: unknown
    updater.on('manual-update-available', update => {
      received = update
    })
    updater.on('error', assert.fail)
    await updater.checkForUpdates()
    assert.deepEqual(received, {
      version,
      url: release.url,
      reason: 'Developer ID required',
    })
    assert.equal(requests.length, 1)
  })
  it('leaves the installation alone when no newer release exists', async t => {
    let unavailable = 0
    const updater = new ForkUpdater({
      currentVersion: version,
      arch: 'x64',
      cacheDirectory: await directory(t),
      fetch: server([]),
      manualReason: async () => null,
      apply: async () => assert.fail(),
      quitAndInstall: () => assert.fail(),
    })
    updater.on('update-not-available', () => unavailable++)
    updater.on('error', assert.fail)
    await updater.checkForUpdates()
    assert.equal(unavailable, 1)
  })
})
