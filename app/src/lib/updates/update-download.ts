import { createHash } from 'crypto'
import { open, rename, rm } from 'fs/promises'
import { ForkRepository, IWindowsUpdatePackage } from './fork-release'

export type UpdateFetch = (
  url: string,
  options: RequestInit
) => Promise<Response>
const DownloadHosts = new Set([
  'github.com',
  'api.github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
])

export function isTrustedUpdateURL(value: string, redirect = false): boolean {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !DownloadHosts.has(url.hostname)
    ) {
      return false
    }
    if (url.hostname === 'github.com') {
      return url.pathname.startsWith(`/${ForkRepository}/releases/download/`)
    }
    if (url.hostname === 'api.github.com') {
      return url.pathname === `/repos/${ForkRepository}/releases`
    }
    return redirect
  } catch {
    return false
  }
}

/** No GitHub login tokens/cookies; only the pinned API/release paths and CDN redirects. */
async function request(
  fetcher: UpdateFetch,
  url: string,
  signal: AbortSignal
): Promise<Response> {
  let target = url
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!isTrustedUpdateURL(target, redirects > 0)) {
      throw new Error('Refusing untrusted update URL')
    }
    const response = await fetcher(target, {
      signal,
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        'User-Agent': 'DesktopPlus-Fork-Updater',
        Accept: 'application/vnd.github+json',
      },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (location === null) {
        throw new Error('Invalid update redirect')
      }
      target = new URL(location, target).toString()
      continue
    }
    if (!response.ok || response.body === null) {
      await response.body?.cancel()
      throw new Error(
        `Update server returned HTTP ${response.status}. Try again later.`
      )
    }
    return response
  }
  throw new Error('Too many update redirects')
}

export async function readUpdateJSON(
  fetcher: UpdateFetch,
  url: string,
  maximumBytes = 16 * 1024 * 1024
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)
  try {
    const response = await request(fetcher, url, controller.signal)
    const reader = response.body!.getReader()
    const parts: Buffer[] = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        bytes += value.length
        if (bytes > maximumBytes) {
          throw new Error('Update metadata exceeds its size limit')
        }
        parts.push(Buffer.from(value))
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } finally {
    clearTimeout(timeout)
  }
}

/** Write to a private temporary file; expose it to Squirrel only after verification. */
export async function downloadUpdate(
  fetcher: UpdateFetch,
  url: string,
  destination: string,
  expected: IWindowsUpdatePackage
): Promise<void> {
  const partial = `${destination}.partial`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000)
  try {
    const response = await request(fetcher, url, controller.signal)
    const handle = await open(partial, 'wx', 0o600)
    const sha256 = createHash('sha256')
    const sha1 = createHash('sha1')
    let bytes = 0
    const reader = response.body!.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        bytes += value.length
        if (bytes > expected.size) {
          throw new Error('Update package exceeds its declared size')
        }
        sha256.update(value)
        sha1.update(value)
        let offset = 0
        while (offset < value.length) {
          const result = await handle.write(
            value,
            offset,
            value.length - offset
          )
          if (result.bytesWritten === 0) {
            throw new Error('Unable to write update package')
          }
          offset += result.bytesWritten
        }
      }
      if (
        bytes !== expected.size ||
        sha256.digest('hex') !== expected.sha256 ||
        sha1.digest('hex') !== expected.sha1
      ) {
        throw new Error(
          'Update package checksum or size mismatch; installation was blocked'
        )
      }
      await handle.sync()
    } finally {
      await reader.cancel().catch(() => {})
      await handle.close()
    }
    await rename(partial, destination)
  } finally {
    clearTimeout(timeout)
    await rm(partial, { force: true })
  }
}
