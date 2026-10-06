import assert from 'node:assert/strict'
import { describe, it, TestContext } from 'node:test'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { exec } from 'dugite'
import { Repository } from '../../../../src/models/repository'
import { IRemote } from '../../../../src/models/remote'
import { pull } from '../../../../src/lib/git/pull'
import { push } from '../../../../src/lib/git/push'
import { setupEmptyRepository } from '../../../helpers/repositories'
import { createTempDirectory } from '../../../helpers/temp'

async function run(path: string, ...args: string[]) {
  const result = await exec(args, path)
  assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

async function commit(
  repository: Repository,
  path: string,
  contents: string,
  amend = false
) {
  await writeFile(join(repository.path, path), contents)
  await run(repository.path, 'add', '--', path)
  await run(
    repository.path,
    'commit',
    ...(amend ? ['--amend', '--no-edit'] : ['-m', `Update ${path}`])
  )
  return run(repository.path, 'rev-parse', 'HEAD')
}

// Every remote in these tests is a disposable local bare repository. Exercise
// the application's real pull and push functions, not hand-written replacements.
async function setup(t: TestContext, conflict = false) {
  const repository = await setupEmptyRepository(t, 'main')
  await run(repository.path, 'config', 'core.editor', 'true')
  await commit(repository, 'published.txt', 'base\n')
  const published = await commit(repository, 'published.txt', 'published\n')
  const remotePath = await createTempDirectory(t)
  await run(repository.path, 'clone', '--bare', repository.path, remotePath)
  await run(remotePath, 'config', 'receive.denyNonFastForwards', 'true')
  await run(repository.path, 'remote', 'add', 'origin', remotePath)
  await run(repository.path, 'fetch', 'origin')
  await run(repository.path, 'branch', '--set-upstream-to=origin/main', 'main')
  const peer = await setupEmptyRepository(t, 'main')
  await run(peer.path, 'remote', 'add', 'origin', remotePath)
  await run(peer.path, 'fetch', 'origin')
  await run(peer.path, 'checkout', '-B', 'main', 'origin/main')
  const remote: IRemote = { name: 'origin', url: remotePath }
  const localTip = await commit(
    repository,
    conflict ? 'published.txt' : 'local.txt',
    'local\n',
    true
  )
  const remoteTip = await commit(
    peer,
    conflict ? 'published.txt' : 'remote.txt',
    'remote\n'
  )
  await push(peer, remote, 'main', 'main', null)
  return {
    repository,
    remote,
    remotePath,
    published,
    localTip,
    remoteTip,
    peer,
  }
}

async function assertReadyForOrdinaryPush(
  repository: Repository,
  remoteTip: string
) {
  await run(repository.path, 'merge-base', '--is-ancestor', remoteTip, 'HEAD')
  assert.equal(await run(repository.path, 'status', '--porcelain'), '')
  assert.equal(await run(repository.path, 'show', 'HEAD:local.txt'), 'local')
  assert.equal(await run(repository.path, 'show', 'HEAD:remote.txt'), 'remote')
  assert.equal(
    await run(repository.path, 'show', 'HEAD:published.txt'),
    'published'
  )
  const counts = await run(
    repository.path,
    'rev-list',
    '--left-right',
    '--count',
    'HEAD...origin/main'
  )
  assert.equal(
    Number(counts.split(/\s+/)[1]),
    0,
    'Pull clears the behind count'
  )
}

describe('ordinary reconciliation after amending published history', () => {
  for (const strategy of [
    'default merge',
    'merge',
    'rebase',
    'branch rebase',
  ]) {
    it(`pulls with ${strategy} then pushes normally without replacing remote history`, async t => {
      const { repository, remote, remotePath, published, remoteTip } =
        await setup(t)
      if (strategy !== 'default merge') {
        await run(
          repository.path,
          'config',
          'pull.rebase',
          String(strategy === 'rebase')
        )
      }
      if (strategy === 'branch rebase') {
        await run(repository.path, 'config', 'branch.main.rebase', 'true')
      }
      await assert.rejects(push(repository, remote, 'main', 'main', null))
      assert.equal(await run(remotePath, 'rev-parse', 'main'), remoteTip)

      await pull(repository, remote)
      await assertReadyForOrdinaryPush(repository, remoteTip)
      // Pull changes only this local checkout, not the published branch.
      assert.equal(await run(remotePath, 'rev-parse', 'main'), remoteTip)
      const parents = (
        await run(repository.path, 'show', '-s', '--format=%P', 'HEAD')
      ).split(' ')
      assert.equal(parents.length, strategy.includes('rebase') ? 1 : 2)
      const integratedTip = await run(repository.path, 'rev-parse', 'HEAD')
      await push(repository, remote, 'main', 'main', null)
      assert.equal(await run(remotePath, 'rev-parse', 'main'), integratedTip)
      await run(remotePath, 'merge-base', '--is-ancestor', published, 'main')
      await run(remotePath, 'merge-base', '--is-ancestor', remoteTip, 'main')
      assert.equal(
        await run(repository.path, 'rev-parse', '--abbrev-ref', '@{upstream}'),
        'origin/main'
      )
    })
  }

  for (const rebase of [false, true]) {
    it(`leaves conflicts for review and permits abort with pull.rebase=${rebase}`, async t => {
      const { repository, remote, remotePath, localTip, remoteTip } =
        await setup(t, true)
      await run(repository.path, 'config', 'pull.rebase', String(rebase))
      await assert.rejects(pull(repository, remote))
      assert.notEqual(await run(repository.path, 'ls-files', '--unmerged'), '')
      assert.equal(await run(remotePath, 'rev-parse', 'main'), remoteTip)
      await run(repository.path, rebase ? 'rebase' : 'merge', '--abort')
      assert.equal(await run(repository.path, 'rev-parse', 'HEAD'), localTip)
      assert.equal(
        await run(repository.path, 'show', 'HEAD:published.txt'),
        'local'
      )
    })

    it(`rejects an ordinary push if the remote advances again after ${
      rebase ? 'rebase' : 'merge'
    }`, async t => {
      const { repository, remote, remotePath, peer } = await setup(t)
      await run(repository.path, 'config', 'pull.rebase', String(rebase))
      await pull(repository, remote)
      const localTip = await run(repository.path, 'rev-parse', 'HEAD')
      const newerRemoteTip = await commit(
        peer,
        'later.txt',
        'another contribution\n'
      )
      await push(peer, remote, 'main', 'main', null)
      await assert.rejects(push(repository, remote, 'main', 'main', null))
      assert.equal(await run(remotePath, 'rev-parse', 'main'), newerRemoteTip)
      assert.equal(await run(repository.path, 'rev-parse', 'HEAD'), localTip)
      assert.equal(
        await run(remotePath, 'show', 'main:later.txt'),
        'another contribution'
      )
    })
  }

  it('respects an explicit fast-forward-only policy instead of silently overriding it', async t => {
    const { repository, remote, remotePath, localTip, remoteTip } = await setup(
      t
    )
    await run(repository.path, 'config', 'pull.ff', 'only')
    await run(repository.path, 'config', 'pull.rebase', 'false')
    await assert.rejects(pull(repository, remote))
    assert.equal(await run(repository.path, 'rev-parse', 'HEAD'), localTip)
    assert.equal(await run(repository.path, 'status', '--porcelain'), '')
    assert.equal(await run(remotePath, 'rev-parse', 'main'), remoteTip)
  })
})
