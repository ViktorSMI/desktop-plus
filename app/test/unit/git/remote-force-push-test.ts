import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { exec } from 'dugite'
import { writeFile, chmod } from 'fs/promises'
import { join } from 'path'
import { Repository } from '../../../src/models/repository'
import { IRemote } from '../../../src/models/remote'
import {
  prepareRemoteForcePush,
  pushToRemoteWithLease,
} from '../../../src/lib/git/remote-force-push'
import { push } from '../../../src/lib/git/push'
import { setupEmptyRepository } from '../../helpers/repositories'
import { createTempDirectory } from '../../helpers/temp'
import { makeCommit } from '../../helpers/repository-scaffolding'

async function command(path: string, args: string[]) {
  const result = await exec(args, path)
  assert.equal(result.exitCode, 0, result.stderr)
  return result.stdout.trim()
}

async function fixture(t: TestContext) {
  const repository = await setupEmptyRepository(t, 'main')
  await makeCommit(repository, {
    entries: [{ path: 'README.md', contents: 'base' }],
    commitMessage: 'base',
  })
  const base = await command(repository.path, ['rev-parse', 'HEAD'])
  await makeCommit(repository, {
    entries: [{ path: 'README.md', contents: 'first change' }],
    commitMessage: 'first change',
  })
  await makeCommit(repository, {
    entries: [{ path: 'README.md', contents: 'second change' }],
    commitMessage: 'second change',
  })
  const published = await command(repository.path, ['rev-parse', 'HEAD'])
  const originPath = await createTempDirectory(t)
  const secondPath = await createTempDirectory(t)
  await command(repository.path, [
    'clone',
    '--bare',
    repository.path,
    originPath,
  ])
  await command(repository.path, [
    'clone',
    '--bare',
    repository.path,
    secondPath,
  ])
  await command(repository.path, ['remote', 'add', 'origin', originPath])
  await command(repository.path, ['remote', 'add', 'gitea', secondPath])
  await command(repository.path, ['fetch', '--all'])
  await command(repository.path, [
    'branch',
    '--set-upstream-to=origin/main',
    'main',
  ])
  await command(repository.path, ['reset', '--soft', base])
  await command(repository.path, ['commit', '-m', 'squashed changes'])
  const rewritten = await command(repository.path, ['rev-parse', 'HEAD'])
  const remote: IRemote = { name: 'gitea', url: secondPath }
  return {
    repository,
    remote,
    originPath,
    secondPath,
    published,
    rewritten,
    base,
  }
}

const head = (path: string) => command(path, ['rev-parse', 'refs/heads/main'])
const config = (repository: Repository) =>
  command(repository.path, ['config', '--local', '--list'])

describe('explicit remote force push', () => {
  it('replaces squashed history on gitea, then origin, without changing tracking or tags', async t => {
    const f = await fixture(t)
    await assert.rejects(push(f.repository, f.remote, 'main', 'main', null))
    await command(f.repository.path, [
      'tag',
      '-a',
      'keep-local',
      '-m',
      'local tag',
    ])
    await command(f.repository.path, ['config', 'push.followTags', 'true'])
    const beforeConfig = await config(f.repository)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    assert.equal(target.remoteTip, f.published)
    assert.equal(target.localTip, f.rewritten)
    await pushToRemoteWithLease(f.repository, target)
    assert.equal(await head(f.secondPath), f.rewritten)
    assert.equal(await head(f.originPath), f.published)
    assert.equal(await command(f.secondPath, ['tag', '--list']), '')
    assert.equal(await config(f.repository), beforeConfig)
    assert.equal(
      await command(f.repository.path, [
        'rev-parse',
        '--abbrev-ref',
        '@{upstream}',
      ]),
      'origin/main'
    )
    const origin: IRemote = { name: 'origin', url: f.originPath }
    await pushToRemoteWithLease(
      f.repository,
      await prepareRemoteForcePush(f.repository, origin)
    )
    assert.equal(await head(f.originPath), f.rewritten)
    assert.equal(await config(f.repository), beforeConfig)
  })

  it('rejects a stale lease even when background fetch updated the tracking ref', async t => {
    const f = await fixture(t)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    // Simulate a collaborator advancing the remote without changing local HEAD.
    const tree = await command(f.secondPath, [
      'rev-parse',
      `${f.published}^{tree}`,
    ])
    const collaborator = await command(f.secondPath, [
      'commit-tree',
      tree,
      '-p',
      f.published,
      '-m',
      'collaborator',
    ])
    await command(f.secondPath, ['update-ref', 'refs/heads/main', collaborator])
    await command(f.repository.path, ['fetch', 'gitea'])
    assert.equal(
      await command(f.repository.path, [
        'rev-parse',
        'refs/remotes/gitea/main',
      ]),
      collaborator
    )
    await assert.rejects(
      pushToRemoteWithLease(f.repository, target),
      /remote branch changed/
    )
    assert.equal(await head(f.secondPath), collaborator)
    assert.equal(await head(f.originPath), f.published)
  })

  it('rejects remote deletion after confirmation instead of recreating the branch', async t => {
    const f = await fixture(t)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    await command(f.secondPath, ['update-ref', '-d', 'refs/heads/main'])
    await assert.rejects(
      pushToRemoteWithLease(f.repository, target),
      /remote branch changed/
    )
    assert.equal(
      (await exec(['show-ref', '--verify', 'refs/heads/main'], f.secondPath))
        .exitCode,
      128
    )
  })

  it('does not push when the local branch changed after confirmation', async t => {
    const f = await fixture(t)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    await command(f.repository.path, ['switch', '-c', 'other'])
    await assert.rejects(
      pushToRemoteWithLease(f.repository, target),
      /current branch or its commits changed/
    )
    assert.equal(await head(f.secondPath), f.published)
  })

  it('does not push when the local tip changed after confirmation', async t => {
    const f = await fixture(t)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    await command(f.repository.path, [
      'commit',
      '--allow-empty',
      '-m',
      'new work',
    ])
    await assert.rejects(
      pushToRemoteWithLease(f.repository, target),
      /current branch or its commits changed/
    )
    assert.equal(await head(f.secondPath), f.published)
  })

  it('rejects a changed remote URL without touching either server', async t => {
    const f = await fixture(t)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    await command(f.repository.path, [
      'remote',
      'set-url',
      'gitea',
      f.originPath,
    ])
    await assert.rejects(
      pushToRemoteWithLease(f.repository, target),
      /selected remote changed/
    )
    assert.equal(await head(f.originPath), f.published)
    assert.equal(await head(f.secondPath), f.published)
  })

  it('rejects removed remotes and plans for another repository', async t => {
    const f = await fixture(t)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    const other = await setupEmptyRepository(t)
    await assert.rejects(
      pushToRemoteWithLease(other, target),
      /repository changed/
    )
    await command(f.repository.path, ['remote', 'remove', 'gitea'])
    await assert.rejects(
      pushToRemoteWithLease(f.repository, target),
      /selected remote changed/
    )
  })

  it('requires a fetched branch and rejects detached HEAD', async t => {
    const f = await fixture(t)
    await command(f.repository.path, [
      'update-ref',
      '-d',
      'refs/remotes/gitea/main',
    ])
    await assert.rejects(
      prepareRemoteForcePush(f.repository, f.remote),
      /Fetch this remote first/
    )
    await command(f.repository.path, ['checkout', '--detach'])
    await assert.rejects(
      prepareRemoteForcePush(f.repository, f.remote),
      /Check out a local branch/
    )
  })

  it('rejects an unborn branch without creating a remote branch', async t => {
    const f = await fixture(t)
    await command(f.repository.path, ['checkout', '--orphan', 'unborn'])
    await assert.rejects(
      prepareRemoteForcePush(f.repository, f.remote),
      /Commit to the local branch/
    )
  })

  it('rejects mirror remotes, multiple push URLs and a different push URL', async t => {
    const f = await fixture(t)
    await command(f.repository.path, ['config', 'remote.gitea.mirror', 'true'])
    await assert.rejects(
      prepareRemoteForcePush(f.repository, f.remote),
      /mirror remotes/
    )
    await command(f.repository.path, [
      'config',
      '--unset',
      'remote.gitea.mirror',
    ])
    await command(f.repository.path, [
      'remote',
      'set-url',
      '--push',
      'gitea',
      f.originPath,
    ])
    await assert.rejects(
      prepareRemoteForcePush(f.repository, f.remote),
      /matching fetch\/push URL/
    )
    await command(f.repository.path, [
      'remote',
      'set-url',
      '--push',
      '--add',
      'gitea',
      f.secondPath,
    ])
    await assert.rejects(
      prepareRemoteForcePush(f.repository, f.remote),
      /matching fetch\/push URL/
    )
  })

  it('preserves branch protection and pre-push hooks', async t => {
    const f = await fixture(t)
    const target = await prepareRemoteForcePush(f.repository, f.remote)
    await command(f.secondPath, [
      'config',
      'receive.denyNonFastForwards',
      'true',
    ])
    await assert.rejects(pushToRemoteWithLease(f.repository, target))
    assert.equal(await head(f.secondPath), f.published)
    await command(f.secondPath, [
      'config',
      'receive.denyNonFastForwards',
      'false',
    ])
    const hook = join(f.repository.path, '.git', 'hooks', 'pre-push')
    const { mkdir } = await import('fs/promises')
    await mkdir(join(f.repository.path, '.git', 'hooks'), { recursive: true })
    await writeFile(
      hook,
      '#!/bin/sh\necho "blocked by test hook" >&2\nexit 1\n'
    )
    await chmod(hook, 0o755)
    await assert.rejects(pushToRemoteWithLease(f.repository, target))
    assert.equal(await head(f.secondPath), f.published)
  })

  it('rejects an empty lease rather than silently weakening force push', async t => {
    const f = await fixture(t)
    await assert.rejects(
      push(f.repository, f.remote, 'main', 'refs/heads/main', null, {
        forceWithLease: true,
        expectedRemoteTip: '',
      }),
      /valid expected commit/
    )
    assert.equal(await head(f.secondPath), f.published)
  })
})
