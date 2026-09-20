import { EventEmitter } from 'events'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  ForkManifestName,
  ForkReleasesAPI,
  IManualForkUpdate,
  parseWindowsPackage,
  releaseAssetURL,
  selectForkRelease,
} from './fork-release'
import { downloadUpdate, readUpdateJSON, UpdateFetch } from './update-download'

export interface IForkUpdaterOptions {
  readonly currentVersion: string
  readonly arch: string
  readonly cacheDirectory: string
  readonly fetch: UpdateFetch
  /** Null means native installation is supported, otherwise explains manual installation. */
  readonly manualReason: () => Promise<string | null>
  readonly apply: (directory: string) => Promise<boolean>
  readonly quitAndInstall: () => void
}

/** One main-process instance, shared by all windows. Never forces a restart. */
export class ForkUpdater extends EventEmitter {
  private inFlight: Promise<void> | null = null
  private ready = false

  public constructor(private readonly options: IForkUpdaterOptions) {
    super()
  }

  public checkForUpdates(): Promise<void> {
    if (this.ready) {
      this.emit('update-downloaded')
      return Promise.resolve()
    }
    if (this.inFlight !== null) {
      return this.inFlight
    }
    this.inFlight = this.check()
      .catch(error => {
        this.emit(
          'error',
          error instanceof Error ? error : new Error(String(error))
        )
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  private async check() {
    this.emit('checking-for-update')
    const data = await readUpdateJSON(this.options.fetch, ForkReleasesAPI)
    const release = selectForkRelease(data, this.options.currentVersion)
    if (release === null) {
      this.emit('update-not-available')
      return
    }
    const reason = await this.options.manualReason()
    if (reason !== null) {
      const update: IManualForkUpdate = {
        version: release.version,
        url: release.url,
        reason,
      }
      this.emit('manual-update-available', update)
      return
    }
    const manifest = await readUpdateJSON(
      this.options.fetch,
      releaseAssetURL(release, ForkManifestName),
      64 * 1024
    )
    const packageInfo = parseWindowsPackage(
      manifest,
      release,
      this.options.arch
    )
    await mkdir(this.options.cacheDirectory, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(this.options.cacheDirectory, 'stage-'))
    try {
      this.emit('update-available')
      const name = `DesktopPlus-${packageInfo.squirrelVersion}-full.nupkg`
      await downloadUpdate(
        this.options.fetch,
        releaseAssetURL(release, packageInfo.name),
        join(directory, name),
        packageInfo
      )
      // Use the canonical NuGet filename, not the architecture-suffixed release asset.
      await writeFile(
        join(directory, 'RELEASES'),
        `${packageInfo.sha1.toUpperCase()} ${name} ${packageInfo.size}\n`,
        { mode: 0o600 }
      )
      if (!(await this.options.apply(directory))) {
        throw new Error('The Windows updater did not accept the newer package')
      }
      this.ready = true
      this.emit('update-downloaded')
    } finally {
      // Squirrel has copied/applied the package before emitting update-downloaded.
      await rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }

  public quitAndInstall() {
    if (this.ready) {
      this.options.quitAndInstall()
    }
  }
}
