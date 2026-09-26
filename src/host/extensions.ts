/**
 * Extension sources: config validation plus the shared unpack cache.
 *
 * Two source kinds are accepted, in one list:
 *
 *   - an unpacked extension directory, used in place (so a developer's edit is
 *     picked up by the next window without a copy step), and
 *   - a `.crx` file, unpacked once into the plugin's CONFIG-level cache
 *     (<dataRoot>/extensions/), shared by every session window, with the CRX
 *     public key written into the manifest so the extension keeps its ID.
 *
 * The cache is keyed by the source's absolute path and invalidated by the
 * CRX's size + mtime, and entries the current configuration no longer uses are
 * pruned so the persistent session profiles do not accumulate broken
 * registrations pointing at deleted directories.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { unzipSync } from 'fflate'
import { parseCrx } from './crx.ts'

/** One configured extension source. */
export interface ExtensionSource {
  /** The configured text, kept for error messages. */
  raw: string
  /** `.crx` files are unpacked into the cache; directories are used in place. */
  kind: 'crx' | 'dir'
  /** Absolute path of the source. */
  path: string
}

/** Progress reporting seam (the plugin's cordis logger). */
export interface ExtensionLog {
  info(message: string): void
  warn(message: string): void
}

/** Logger used when the caller provides none. */
export const SILENT_LOG: ExtensionLog = { info: () => {}, warn: () => {} }

/** Cache subdirectory prefix: one directory per crx source. */
const CRX_CACHE_PREFIX = 'crx-'

/** Cache marker file inside one unpacked crx directory. */
const MARKER_FILE = '.dsh-source.json'

/** What one cache directory was built from. */
interface CacheMarker {
  path: string
  size: number
  mtimeMs: number
  version: string
}

/** Expand a leading `~` into the user's home directory. */
function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/**
 * Canonical path of one directory Chrome will report back.
 *
 * Symlinks (`/var` → `/private/var` on macOS, a symlinked home directory)
 * make Chrome answer with the resolved path, so every comparison against
 * installed extensions has to happen on canonical paths. A path that cannot
 * be resolved (say a deleted cache directory) stays as configured.
 * @param path - configured or reported path.
 * @returns the canonical path when resolvable.
 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Validate the configured extension list.
 *
 * Every problem is reported at once: a list with one typo should not have to
 * be fixed one launch at a time.
 * @param entries - raw config values, in configured order.
 * @returns the deduplicated usable sources.
 * @throws when any entry is unusable, listing them all.
 */
export function resolveExtensionSources(entries: readonly string[]): ExtensionSource[] {
  const sources: ExtensionSource[] = []
  const seen = new Set<string>()
  const problems: string[] = []
  for (const entry of entries) {
    const raw = entry.trim()
    if (raw === '') continue
    const expanded = expandHome(raw)
    if (!isAbsolute(expanded)) {
      problems.push(`${raw}: 请写绝对路径或以 ~ 开头`)
      continue
    }
    const path = canonicalPath(normalize(expanded))
    if (seen.has(path)) continue
    let stats
    try {
      stats = statSync(path)
    } catch {
      problems.push(`${raw}: 路径不存在`)
      continue
    }
    if (stats.isDirectory()) {
      if (!existsSync(join(path, 'manifest.json'))) {
        problems.push(`${raw}: 目录里没有 manifest.json, 不是未打包扩展`)
        continue
      }
      seen.add(path)
      sources.push({ raw, kind: 'dir', path })
      continue
    }
    if (!stats.isFile() || !/\.crx$/iu.test(path)) {
      problems.push(`${raw}: 只支持 .crx 文件或未打包扩展目录`)
      continue
    }
    seen.add(path)
    sources.push({ raw, kind: 'crx', path })
  }
  if (problems.length > 0) {
    throw new Error(`扩展配置有问题 (${problems.length} 项):\n${problems.map(problem => `- ${problem}`).join('\n')}`)
  }
  return sources
}

/**
 * Turn the configured sources into directories Chrome can load.
 * @param sources - validated sources.
 * @param cacheRoot - config-level cache directory (<dataRoot>/extensions).
 * @param log - progress sink.
 * @returns directories to install, in configured order.
 */
export async function materializeExtensions(
  sources: readonly ExtensionSource[],
  cacheRoot: string,
  log: ExtensionLog = SILENT_LOG,
): Promise<string[]> {
  const dirs: string[] = []
  const keep = new Set<string>()
  for (const source of sources) {
    if (source.kind === 'dir') {
      dirs.push(source.path)
      continue
    }
    const target = join(cacheRoot, `${CRX_CACHE_PREFIX}${hashPath(source.path)}`)
    keep.add(target)
    const stats = statSync(source.path)
    if (!isFresh(target, source.path, stats.size, stats.mtimeMs)) {
      log.info(`解包扩展 ${source.raw}`)
      unpackCrx(source.path, target, log)
    }
    dirs.push(target)
  }
  pruneCache(cacheRoot, keep, log)
  return dirs
}

/** Cache directory name for one crx path. */
function hashPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12)
}

/** Whether a cache directory already holds exactly this crx revision. */
function isFresh(target: string, path: string, size: number, mtimeMs: number): boolean {
  const marker = readMarker(target)
  return marker !== null && marker.path === path && marker.size === size && marker.mtimeMs === mtimeMs
}

/** Read one cache marker, treating anything unreadable as a cache miss. */
function readMarker(target: string): CacheMarker | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(target, MARKER_FILE), 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const marker = parsed as Partial<CacheMarker>
    if (typeof marker.path !== 'string' || typeof marker.size !== 'number' || typeof marker.mtimeMs !== 'number') return null
    return { path: marker.path, size: marker.size, mtimeMs: marker.mtimeMs, version: typeof marker.version === 'string' ? marker.version : '' }
  } catch {
    return null
  }
}

/**
 * Unpack one crx into its cache directory, replacing whatever was there.
 * @param source - absolute path of the crx file.
 * @param target - cache directory to (re)build.
 * @param log - progress sink.
 * @throws when the container, the payload, or the manifest is unusable.
 */
function unpackCrx(source: string, target: string, log: ExtensionLog): void {
  const archive = parseCrx(readFileSync(source))
  const files = unzipSync(new Uint8Array(archive.payload))
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const [name, bytes] of Object.entries(files)) {
    const relative = safeRelativePath(name)
    if (relative === null) throw new Error(`CRX 里的路径不安全: ${name}`)
    const file = join(target, relative)
    if (name.endsWith('/')) {
      mkdirSync(file, { recursive: true })
      continue
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  const version = injectManifestKey(target, archive.publicKeyBase64, log)
  const stats = statSync(source)
  const marker: CacheMarker = { path: source, size: stats.size, mtimeMs: stats.mtimeMs, version }
  writeFileSync(join(target, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`)
}

/**
 * Reject archive entry names that would escape the cache directory.
 * @param name - ZIP entry name.
 * @returns the normalized relative path, or null when unsafe.
 */
function safeRelativePath(name: string): string | null {
  const normalized = normalize(name).replace(/^[/\\]+/u, '')
  if (normalized === '' || normalized === '.' || normalized.startsWith('..')) return null
  if (isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized)) return null
  return normalized
}

/**
 * Write the CRX publisher key into the unpacked manifest.
 *
 * Chrome derives an unpacked extension's ID from `manifest.key` when present,
 * so this is what keeps `chrome-extension://<id>` (and anything the extension
 * bound to its own ID) identical to the signed build.
 * @param target - unpacked extension directory.
 * @param publicKeyBase64 - publisher key from the CRX header, if any.
 * @param log - progress sink.
 * @returns the manifest version, for the cache marker.
 * @throws when the payload has no readable manifest.
 */
function injectManifestKey(target: string, publicKeyBase64: string | null, log: ExtensionLog): string {
  const manifestPath = join(target, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error('CRX 里没有 manifest.json')
  let manifest: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') throw new Error('not an object')
    manifest = parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`CRX 里的 manifest.json 无法解析: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (publicKeyBase64 === null) {
    log.warn('CRX 头里没有公钥, 该扩展的 ID 会与签名版本不同')
  } else if (typeof manifest.key !== 'string' || manifest.key === '') {
    manifest.key = publicKeyBase64
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return typeof manifest.version === 'string' ? manifest.version : ''
}

/** Drop cache directories the current configuration no longer uses. */
function pruneCache(cacheRoot: string, keep: ReadonlySet<string>, log: ExtensionLog): void {
  let entries: string[]
  try {
    entries = readdirSync(cacheRoot)
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.startsWith(CRX_CACHE_PREFIX)) continue
    const path = join(cacheRoot, entry)
    if (keep.has(path)) continue
    log.info(`清理不再使用的扩展缓存 ${entry}`)
    rmSync(path, { recursive: true, force: true })
  }
}
