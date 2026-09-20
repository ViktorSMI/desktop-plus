// Installed-app smoke test on an isolated Windows runner. Nothing is published.
import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  readdir,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const packager = require('@electron/packager')
const installer = require('electron-winstaller')
const ts = require('typescript')
if (process.platform !== 'win32') {
  throw new Error('This smoke test requires an isolated Windows runner')
}
const root = await mkdtemp(join(tmpdir(), 'desktop-plus-updater-smoke-'))
const source = resolve(import.meta.dirname, '..')
const before = '3.6.7-beta9'
const after = '3.6.7-beta10'
const beforeNuget = '3.6.7-beta000000009'
const afterNuget = '3.6.7-beta000000010'
const resultPath = join(root, 'result.json')
console.log(`Updater smoke workspace: ${root}`)

async function run(exe, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Process timed out: ' + exe))
    }, 120000)
    child.on('error', reject)
    child.on('exit', code => {
      clearTimeout(timeout)
      code === 0 ? resolve() : reject(new Error(`Exit code ${code}: ${exe}`))
    })
  })
}

const main = `
const {app, autoUpdater} = require('electron')
const {readFile, writeFile} = require('fs/promises')
const {join} = require('path')
const {ForkUpdater} = require('./updates/fork-updater')
const {ForkReleasesAPI, ForkManifestName} = require('./updates/fork-release')
const root = process.env.DESKTOP_UPDATE_SMOKE_ROOT
if (process.argv.some(a=>a.startsWith('--squirrel-'))) {
  app.quit()
} else {
  app.whenReady().then(async()=>{
    if (app.getVersion() === '${after}') {
      await writeFile(join(root,'result.json'),JSON.stringify({version:app.getVersion(),exe:process.execPath}))
      app.quit()
      return
    }
    if (app.getVersion() !== '${before}') throw new Error('Wrong installed version')
    const metadata = JSON.parse(await readFile(join(root,'server.json'),'utf8'))
    const updater = new ForkUpdater({
      currentVersion: '${before}', arch:'x64', cacheDirectory:join(root,'cache'),
      manualReason:async()=>null,
      fetch:async(url)=>{
        if (url === ForkReleasesAPI) return new Response(JSON.stringify(metadata.releases))
        if (url.endsWith('/'+ForkManifestName)) return new Response(JSON.stringify(metadata.manifest))
        if (url.endsWith('/'+metadata.packageName)) return new Response(await readFile(join(root,metadata.packageName)))
        throw new Error('Unexpected update network request '+url)
      },
      apply:(directory)=>new Promise((resolve,reject)=>{
        autoUpdater.once('error',reject)
        autoUpdater.once('update-not-available',()=>reject(new Error('Expected a newer NuGet version')))
        autoUpdater.once('update-downloaded',()=>resolve(true))
        autoUpdater.setFeedURL({url:directory})
        autoUpdater.checkForUpdates()
      }),
      quitAndInstall:()=>autoUpdater.quitAndInstall(),
    })
    updater.on('error',async(error)=>{await writeFile(join(root,'error.txt'),error.stack);app.exit(1)})
    updater.on('update-downloaded',()=>updater.quitAndInstall())
    await updater.checkForUpdates()
  }).catch(async(error)=>{await writeFile(join(root,'error.txt'),error.stack);app.exit(1)})
}
`

async function build(version, nugetVersion) {
  const input = join(root, `app-${version}`)
  await mkdir(join(input, 'updates'), { recursive: true })
  await writeFile(
    join(input, 'package.json'),
    JSON.stringify({
      name: 'DesktopPlus',
      productName: 'Desktop Plus',
      version,
      main: 'main.js',
      description: 'Isolated updater smoke test',
      author: 'Desktop Plus tests',
    })
  )
  await writeFile(join(input, 'main.js'), main)
  for (const file of ['fork-release', 'update-download', 'fork-updater']) {
    const text = await readFile(
      join(source, 'app/src/lib/updates', file + '.ts'),
      'utf8'
    )
    const result = ts.transpileModule(text, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    })
    await writeFile(join(input, 'updates', file + '.js'), result.outputText)
  }
  const output = join(root, `dist-${version}`)
  const [appDirectory] = await packager({
    dir: input,
    name: 'DesktopPlus',
    out: output,
    platform: 'win32',
    arch: 'x64',
    electronVersion: require('electron/package.json').version,
    overwrite: true,
    asar: false,
  })
  const releases = join(root, `releases-${version}`)
  await installer.createWindowsInstaller({
    appDirectory,
    outputDirectory: releases,
    name: 'DesktopPlus',
    exe: 'DesktopPlus.exe',
    version: nugetVersion,
    authors: 'Desktop Plus tests',
    noMsi: true,
    setupExe: 'Setup.exe',
    iconUrl: 'https://desktop.githubusercontent.com/app-icon.ico',
  })
  return releases
}

const oldDirectory = await build(before, beforeNuget)
const newDirectory = await build(after, afterNuget)
const packageName = `DesktopPlus-v${after}-x64-full.nupkg`
const packagePath = join(root, packageName)
await copyFile(
  join(newDirectory, `DesktopPlus-${afterNuget}-full.nupkg`),
  packagePath
)
const packageData = await readFile(packagePath)
const manifest = {
  schemaVersion: 1,
  repository: 'ViktorSMI/desktop-plus',
  version: after,
  windows: {
    x64: {
      name: packageName,
      size: packageData.length,
      sha256: createHash('sha256').update(packageData).digest('hex'),
      sha1: createHash('sha1').update(packageData).digest('hex'),
      squirrelVersion: afterNuget,
    },
  },
}
await writeFile(
  join(root, 'server.json'),
  JSON.stringify({
    manifest,
    packageName,
    releases: [
      {
        tag_name: 'v' + after,
        draft: false,
        prerelease: true,
        assets: [packageName, 'desktop-plus-updates.json'].map(name => ({
          name,
          state: 'uploaded',
        })),
      },
    ],
  })
)
await run(join(oldDirectory, 'Setup.exe'), ['--silent'], {
  DESKTOP_UPDATE_SMOKE_ROOT: root,
})
// Installer launches are squirrel lifecycle events; allow its file lock to clear.
await new Promise(resolve => setTimeout(resolve, 15000))
const installedRoot = join(process.env.LOCALAPPDATA, 'DesktopPlus')
const installed = (await readdir(installedRoot)).find(name =>
  name.startsWith('app-')
)
assert(installed, 'Squirrel installation missing')
const child = spawn(join(installedRoot, installed, 'DesktopPlus.exe'), [], {
  env: { ...process.env, DESKTOP_UPDATE_SMOKE_ROOT: root },
  stdio: 'inherit',
})
const deadline = Date.now() + 180000
let result
while (Date.now() < deadline) {
  const error = await readFile(join(root, 'error.txt'), 'utf8').catch(
    () => null
  )
  if (error !== null) throw new Error(error)
  result = await readFile(resultPath, 'utf8')
    .then(JSON.parse)
    .catch(() => null)
  if (result !== null) break
  await new Promise(resolve => setTimeout(resolve, 1000))
}
child.kill()
assert.equal(
  result?.version,
  after,
  'Installed application did not restart into beta10'
)
assert(
  result.exe.includes(afterNuget),
  'The new Squirrel application directory was not used'
)
console.log(
  'PASS: installed beta9 -> SHA-256 verification -> native Squirrel update -> restart into beta10'
)
