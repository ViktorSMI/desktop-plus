import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile } from 'fs/promises'
import { join } from 'path'
import { exec } from 'dugite'
import { Repository } from '../../../src/models/repository'
import {
  prepareRemoteForcePush,
  forcePushToRemote,
} from '../../../src/lib/git/remote-force-push'
import { push } from '../../../src/lib/git/push'
import { setupEmptyRepository } from '../../helpers/repositories'
import { makeCommit } from '../../helpers/repository-scaffolding'
import { createTempDirectory } from '../../helpers/temp'

async function run(path: string, ...args: string[]) {
  const result = await exec(args, path)
  assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

async function setup(t: TestContext, branchName = 'main') {
  const repo = await setupEmptyRepository(t, branchName)
  await makeCommit(repo, { entries: [{ path: 'file.txt', contents: 'base' }] })
  const base = await run(repo.path, 'rev-parse', 'HEAD')
  await makeCommit(repo, { entries: [{ path: 'file.txt', contents: 'first' }] })
  await makeCommit(repo, {
    entries: [{ path: 'file.txt', contents: 'second' }],
  })
  const originPath = await createTempDirectory(t)
  const mirrorPath = await createTempDirectory(t)
  await run(repo.path, 'clone', '--bare', repo.path, originPath)
  await run(repo.path, 'clone', '--bare', repo.path, mirrorPath)
  await run(repo.path, 'remote', 'add', 'origin', originPath)
  await run(repo.path, 'remote', 'add', 'mirror', mirrorPath)
  await run(repo.path, 'fetch', 'origin')
  await run(repo.path, 'fetch', 'mirror')
  await run(
    repo.path,
    'branch',
    `--set-upstream-to=origin/${branchName}`,
    branchName
  )
  const oldTip = await run(repo.path, 'rev-parse', 'HEAD')
  await run(repo.path, 'reset', '--soft', base)
  await run(repo.path, 'commit', '-m', 'Squash the two published commits')
  const mirror = { name: 'mirror', url: mirrorPath }
  const request = await prepareRemoteForcePush(repo, mirror)
  assert.equal(request.lease.expectedRemoteTip, oldTip)
  return { repo, originPath, mirrorPath, mirror, request, oldTip }
}

describe('remote-specific force push', () => {
  it('replaces only the chosen branch after squash and preserves upstream, tags, and local edits', async t => {
    const { repo, mirror, request, originPath, mirrorPath, oldTip } =
      await setup(t)
    await assert.rejects(push(repo, mirror, 'main', 'main', null))
    await run(mirrorPath, 'update-ref', 'refs/heads/keep-me', oldTip)
    await run(repo.path, 'tag', '-a', 'local-tag', '-m', 'Do not publish me')
    await run(repo.path, 'config', 'push.followTags', 'true')
    await run(repo.path, 'config', 'remote.mirror.mirror', 'true')
    await writeFile(join(repo.path, 'file.txt'), 'uncommitted local edit')
    const progress: string[] = []
    await forcePushToRemote(repo, request, undefined, p =>
      progress.push(p.remote)
    )
    assert.equal(
      await run(mirrorPath, 'rev-parse', 'refs/heads/main'),
      request.lease.localTip
    )
    assert.equal(
      await run(mirrorPath, 'rev-parse', 'refs/heads/keep-me'),
      oldTip
    )
    assert.equal(await run(originPath, 'rev-parse', 'refs/heads/main'), oldTip)
    assert.equal(await run(mirrorPath, 'tag', '--list'), '')
    assert.equal(
      await run(repo.path, 'rev-parse', '--abbrev-ref', '@{upstream}'),
      'origin/main'
    )
    assert.equal(
      await readFile(join(repo.path, 'file.txt'), 'utf8'),
      'uncommitted local edit'
    )
    assert(progress.length > 0)
    assert(progress.every(name => name === 'mirror'))
  })

  it('rejects a stale lease even after background fetch updates the tracking ref', async t => {
    const { repo, mirrorPath, request } = await setup(t)
    const contributorPath = await createTempDirectory(t)
    await run(repo.path, 'clone', mirrorPath, contributorPath)
    const contributor = new Repository(contributorPath, -2, null, false)
    await makeCommit(contributor, {
      entries: [{ path: 'theirs.txt', contents: 'new remote work' }],
    })
    await run(contributorPath, 'push', 'origin', 'main')
    const advancedTip = await run(mirrorPath, 'rev-parse', 'refs/heads/main')
    await run(repo.path, 'fetch', 'mirror')
    assert.notEqual(request.lease.expectedRemoteTip, advancedTip)
    await assert.rejects(forcePushToRemote(repo, request))
    assert.equal(
      await run(mirrorPath, 'rev-parse', 'refs/heads/main'),
      advancedTip
    )
  })

  it('rejects remote deletion instead of recreating a branch with an old confirmation', async t => {
    const { repo, mirrorPath, request } = await setup(t)
    await run(mirrorPath, 'update-ref', '-d', 'refs/heads/main')
    await assert.rejects(forcePushToRemote(repo, request))
    assert.equal(await run(mirrorPath, 'branch', '--list'), '')
  })

  it('rejects a checkout made after the confirmation was opened', async t => {
    const { repo, request } = await setup(t)
    await run(repo.path, 'checkout', '-b', 'other-branch')
    await assert.rejects(
      forcePushToRemote(repo, request),
      /local branch changed/
    )
  })

  it('rejects a new local commit made after confirmation', async t => {
    const { repo, request } = await setup(t)
    await makeCommit(repo, {
      entries: [{ path: 'new.txt', contents: 'not approved' }],
    })
    await assert.rejects(
      forcePushToRemote(repo, request),
      /local branch changed/
    )
  })

  it('rejects a changed push URL instead of sending to another server', async t => {
    const { repo, originPath, request } = await setup(t)
    await run(repo.path, 'remote', 'set-url', '--push', 'mirror', originPath)
    await assert.rejects(
      forcePushToRemote(repo, request),
      /destination changed/
    )
  })

  it('rejects removed remotes and remotes with multiple push destinations', async t => {
    const { repo, originPath, mirrorPath, mirror, request } = await setup(t)
    await run(
      repo.path,
      'remote',
      'set-url',
      '--add',
      '--push',
      'mirror',
      mirrorPath
    )
    await run(
      repo.path,
      'remote',
      'set-url',
      '--add',
      '--push',
      'mirror',
      originPath
    )
    await assert.rejects(
      prepareRemoteForcePush(repo, mirror),
      /exactly one push URL/
    )
    await run(repo.path, 'remote', 'remove', 'mirror')
    await assert.rejects(
      forcePushToRemote(repo, request),
      /destination changed/
    )
  })

  it('requires a fetched destination and a committed local branch', async t => {
    const { repo, mirror } = await setup(t)
    await run(repo.path, 'update-ref', '-d', 'refs/remotes/mirror/main')
    await assert.rejects(prepareRemoteForcePush(repo, mirror), /Fetch mirror/)
    await run(repo.path, 'checkout', '--detach')
    await assert.rejects(
      prepareRemoteForcePush(repo, mirror),
      /Check out a local branch/
    )
    await run(repo.path, 'checkout', '--orphan', 'unborn')
    await assert.rejects(prepareRemoteForcePush(repo, mirror), /no commits/)
  })

  it('handles slash-containing branch names and an identically named tag', async t => {
    const { repo, mirrorPath, request } = await setup(t, 'feature/squashed')
    await run(
      repo.path,
      'tag',
      'feature/squashed',
      request.lease.expectedRemoteTip
    )
    await forcePushToRemote(repo, request)
    assert.equal(
      await run(mirrorPath, 'rev-parse', 'refs/heads/feature/squashed'),
      request.lease.localTip
    )
  })

  it('honors server protection and never retries with --force', async t => {
    const { repo, mirrorPath, request, oldTip } = await setup(t)
    await run(mirrorPath, 'config', 'receive.denyNonFastForwards', 'true')
    await assert.rejects(forcePushToRemote(repo, request))
    assert.equal(await run(mirrorPath, 'rev-parse', 'refs/heads/main'), oldTip)
  })

  it('the low-level refspec pins the approved source instead of a moving HEAD', async t => {
    const { repo, mirror, mirrorPath, request } = await setup(t)
    await makeCommit(repo, {
      entries: [{ path: 'later.txt', contents: 'not part of approved push' }],
    })
    await push(repo, mirror, 'main', 'main', null, {
      forceWithLease: true,
      forcePushLease: request.lease,
    })
    assert.equal(
      await run(mirrorPath, 'rev-parse', 'refs/heads/main'),
      request.lease.localTip
    )
  })

  it('rejects malformed, implicit, or multi-ref explicit force pushes before execution', async t => {
    const { repo, mirror, request } = await setup(t)
    await assert.rejects(
      push(repo, mirror, 'main', null, null, {
        forceWithLease: true,
        forcePushLease: request.lease,
      }),
      /requires two commit IDs/
    )
    await assert.rejects(
      push(repo, mirror, 'main', 'main', ['refs/tags/release'], {
        forceWithLease: true,
        forcePushLease: request.lease,
      }),
      /requires two commit IDs/
    )
    await assert.rejects(
      push(repo, mirror, 'main', 'main', null, {
        forceWithLease: true,
        forcePushLease: { ...request.lease, expectedRemoteTip: 'HEAD' },
      }),
      /requires two commit IDs/
    )
  })
})
