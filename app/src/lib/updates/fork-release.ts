/** Update trust root. Never derive this from a checked-out repository/remote. */
export const ForkRepository = 'ViktorSMI/desktop-plus'
export const ForkReleasesURL = `https://github.com/${ForkRepository}/releases`
export const ForkReleasesAPI = `https://api.github.com/repos/${ForkRepository}/releases?per_page=100`
export const ForkManifestName = 'desktop-plus-updates.json'
export const MaxUpdateBytes = 2 * 1024 * 1024 * 1024

export interface IForkRelease {
  readonly version: string
  readonly tag: string
  readonly url: string
  readonly assets: ReadonlyArray<string>
}

export interface IWindowsUpdatePackage {
  readonly name: string
  readonly size: number
  readonly sha256: string
  readonly sha1: string
  readonly squirrelVersion: string
}

export interface IManualForkUpdate {
  readonly version: string
  readonly url: string
  readonly reason: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Also accepts our historical betaN tags, comparing N numerically. */
export function parseForkVersion(value: string) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta([1-9]\d{0,8}))?$/.exec(
      value
    )
  if (match === null) {
    return null
  }
  const parts = match.slice(1, 4).map(Number)
  if (parts.some(part => !Number.isSafeInteger(part))) {
    return null
  }
  return { parts, beta: match[4] === undefined ? null : Number(match[4]) }
}

export function compareForkVersions(left: string, right: string): number {
  const a = parseForkVersion(left)
  const b = parseForkVersion(right)
  if (a === null || b === null) {
    throw new Error('Invalid fork release version')
  }
  for (let index = 0; index < 3; index++) {
    const difference = a.parts[index] - b.parts[index]
    if (difference !== 0) {
      return difference
    }
  }
  if (a.beta === b.beta) {
    return 0
  }
  if (a.beta === null) {
    return 1
  }
  if (b.beta === null) {
    return -1
  }
  return a.beta - b.beta
}

/** NuGet/Squirrel compares prerelease labels lexically, unlike our betaN UI. */
export function getWindowsUpdateVersion(version: string): string {
  const parsed = parseForkVersion(version)
  if (parsed === null) {
    throw new Error('Invalid fork release version')
  }
  const base = parsed.parts.join('.')
  return parsed.beta === null
    ? base
    : `${base}-beta${parsed.beta.toString().padStart(9, '0')}`
}

export function releaseAssetURL(release: IForkRelease, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error('Invalid update asset name')
  }
  if (
    release.tag !== `v${release.version}` ||
    parseForkVersion(release.version) === null
  ) {
    throw new Error('Invalid update release tag')
  }
  return `${ForkReleasesURL}/download/${release.tag}/${name}`
}

/** Stable users never get betas; beta users may graduate to a stable release. */
export function selectForkRelease(
  data: unknown,
  currentVersion: string
): IForkRelease | null {
  const current = parseForkVersion(currentVersion)
  if (current === null || !Array.isArray(data)) {
    throw new Error('Invalid current version or release response')
  }
  let selected: IForkRelease | null = null
  for (const entry of data) {
    if (
      !isRecord(entry) ||
      entry.draft !== false ||
      typeof entry.tag_name !== 'string' ||
      !Array.isArray(entry.assets)
    ) {
      continue
    }
    const version = entry.tag_name.startsWith('v')
      ? entry.tag_name.slice(1)
      : ''
    const parsed = parseForkVersion(version)
    if (parsed === null || entry.prerelease !== (parsed.beta !== null)) {
      continue
    }
    if (current.beta === null && parsed.beta !== null) {
      continue
    }
    if (
      compareForkVersions(version, currentVersion) <= 0 ||
      (selected !== null && compareForkVersions(version, selected.version) <= 0)
    ) {
      continue
    }
    const assets = entry.assets.flatMap(asset =>
      isRecord(asset) &&
      typeof asset.name === 'string' &&
      asset.state === 'uploaded'
        ? [asset.name]
        : []
    )
    // No partial/in-progress releases or releases from before updater support.
    if (!assets.includes(ForkManifestName)) {
      continue
    }
    selected = {
      version,
      tag: entry.tag_name,
      url: `${ForkReleasesURL}/tag/${entry.tag_name}`,
      assets,
    }
  }
  return selected
}

export function parseWindowsPackage(
  data: unknown,
  release: IForkRelease,
  arch: string
): IWindowsUpdatePackage {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error('Unsupported update architecture')
  }
  if (
    !isRecord(data) ||
    data.schemaVersion !== 1 ||
    data.repository !== ForkRepository ||
    data.version !== release.version ||
    !isRecord(data.windows)
  ) {
    throw new Error('Update manifest does not match this fork/release')
  }
  const entry = data.windows[arch]
  const expectedName = `DesktopPlus-v${release.version}-${arch}-full.nupkg`
  if (
    !isRecord(entry) ||
    entry.name !== expectedName ||
    !release.assets.includes(expectedName) ||
    typeof entry.size !== 'number' ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 1 ||
    entry.size > MaxUpdateBytes ||
    typeof entry.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    typeof entry.sha1 !== 'string' ||
    !/^[a-f0-9]{40}$/.test(entry.sha1) ||
    entry.squirrelVersion !== getWindowsUpdateVersion(release.version)
  ) {
    throw new Error('Invalid or incomplete Windows update package')
  }
  return {
    name: expectedName,
    size: entry.size,
    sha256: entry.sha256,
    sha1: entry.sha1,
    squirrelVersion: entry.squirrelVersion,
  }
}
