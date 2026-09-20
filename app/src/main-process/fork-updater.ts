import { app, autoUpdater, net } from 'electron'
import { stat } from 'fs/promises'
import { join, resolve } from 'path'
import { ForkUpdater } from '../lib/updates/fork-updater'

let instance: ForkUpdater | undefined

/** Only the installed Windows Squirrel app can apply our unsigned native packages. */
async function manualReason() {
  if (process.platform === 'darwin') {
    return 'This macOS build is ad-hoc signed. Install the new release manually; automatic replacement requires a Developer ID signature.'
  }
  if (process.platform !== 'win32') {
    return 'Update through your package manager or install the new release manually.'
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    return 'Automatic updates are unavailable for this architecture.'
  }
  const updaterPath = resolve(process.execPath, '..', '..', 'Update.exe')
  if (!(await stat(updaterPath).catch(() => null))?.isFile()) {
    return 'Install Desktop Plus using the Windows installer to enable automatic updates.'
  }
  return null
}

function applyWindowsUpdate(directory: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      autoUpdater.removeListener('error', onError)
      autoUpdater.removeListener('update-not-available', onUnavailable)
      autoUpdater.removeListener('update-downloaded', onDownloaded)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onUnavailable = () => {
      cleanup()
      resolve(false)
    }
    const onDownloaded = () => {
      cleanup()
      resolve(true)
    }
    autoUpdater.once('error', onError)
    autoUpdater.once('update-not-available', onUnavailable)
    autoUpdater.once('update-downloaded', onDownloaded)
    try {
      // Squirrel accepts a local directory. It never downloads unchecked remote data.
      autoUpdater.setFeedURL({ url: directory })
      autoUpdater.checkForUpdates()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export function getForkUpdater(): ForkUpdater {
  if (instance === undefined) {
    instance = new ForkUpdater({
      currentVersion: __APP_VERSION__,
      arch: process.arch,
      cacheDirectory: join(app.getPath('userData'), 'fork-updates'),
      fetch: (url, options) => net.fetch(url, options),
      manualReason,
      apply: applyWindowsUpdate,
      quitAndInstall: () => autoUpdater.quitAndInstall(),
    })
    // A window may close while an asynchronous check is in flight.
    instance.on('error', error => log.warn('Fork update check failed', error))
  }
  return instance
}
