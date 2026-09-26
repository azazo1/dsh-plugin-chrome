/**
 * Extension source handling: config validation, CRX unpacking into the shared
 * config-level cache, cache reuse/invalidation, and pruning.
 *
 * Everything runs on fixtures built in memory plus real temp directories, so
 * the whole path is exercised without touching a browser.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializeExtensions, resolveExtensionSources } from '../src/host/extensions.ts'
import { crx2, crx3, extensionTree, FIXTURE_PUBLIC_KEY } from './helpers/crx-fixture.ts'

describe('resolveExtensionSources', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-chrome-ext-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Write one unpacked extension directory under the scratch root. */
  function unpacked(name: string): string {
    const path = join(root, name)
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, 'manifest.json'), '{}\n')
    // Sources come back canonicalized so they match the paths Chrome reports.
    return realpathSync(path)
  }

  it('accepts a directory that holds a manifest and keeps the configured order', () => {
    const first = unpacked('one')
    const second = unpacked('two')
    const sources = resolveExtensionSources([first, second])
    expect(sources.map(source => [source.kind, source.path])).toEqual([['dir', first], ['dir', second]])
  })

  it('deduplicates repeated sources and skips blank rows', () => {
    const path = unpacked('one')
    expect(resolveExtensionSources([' ', path, path])).toHaveLength(1)
  })

  it('rejects relative paths, missing paths, plain files and manifest-less directories', () => {
    const plain = join(root, 'notes.txt')
    writeFileSync(plain, 'hi\n')
    const empty = join(root, 'empty')
    mkdirSync(empty)
    expect(() => resolveExtensionSources(['ext/foo.crx'])).toThrow(/绝对路径/u)
    expect(() => resolveExtensionSources([join(root, 'missing.crx')])).toThrow(/不存在/u)
    expect(() => resolveExtensionSources([plain])).toThrow(/只支持/u)
    expect(() => resolveExtensionSources([empty])).toThrow(/manifest\.json/u)
  })

  it('reports every problem at once', () => {
    expect(() => resolveExtensionSources(['a.crx', join(root, 'b.crx')])).toThrow(/2 项/u)
  })

  it('expands a leading ~ before validating', () => {
    // The home directory exists but is no extension, so the message proves the
    // tilde was expanded rather than treated as a relative path.
    expect(() => resolveExtensionSources(['~'])).toThrow(/manifest\.json/u)
  })
})

describe('materializeExtensions', () => {
  let root: string
  let cacheRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-chrome-ext-'))
    cacheRoot = join(root, 'extensions')
    mkdirSync(cacheRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** Write a crx fixture to disk and return its path. */
  function writeCrx(name: string, bytes: Buffer): string {
    const path = join(root, name)
    writeFileSync(path, bytes)
    return path
  }

  it('unpacks one crx into the shared cache with the publisher key in the manifest', async () => {
    const crx = writeCrx('fixture.crx', crx3(extensionTree()))
    const sources = resolveExtensionSources([crx])
    const dirs = await materializeExtensions(sources, cacheRoot)

    expect(dirs).toHaveLength(1)
    const target = dirs[0]
    expect(target.startsWith(cacheRoot)).toBe(true)
    const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')) as { key?: string; version?: string }
    expect(manifest.key).toBe(FIXTURE_PUBLIC_KEY.toString('base64'))
    expect(manifest.version).toBe('1.2.3')
    expect(existsSync(join(target, 'background.js'))).toBe(true)
    expect(existsSync(join(target, 'nested', 'asset.txt'))).toBe(true)
    expect(existsSync(join(target, '.dsh-source.json'))).toBe(true)
  })

  it('reuses the cache while the crx is unchanged and rebuilds it after an edit', async () => {
    const crx = writeCrx('fixture.crx', crx3(extensionTree()))
    const [target] = await materializeExtensions(resolveExtensionSources([crx]), cacheRoot)
    const sentinel = join(target, 'sentinel.txt')
    writeFileSync(sentinel, 'kept\n')

    await materializeExtensions(resolveExtensionSources([crx]), cacheRoot)
    expect(existsSync(sentinel)).toBe(true)

    // A different revision of the same source path must replace the cache.
    writeFileSync(crx, crx3(extensionTree({ name: 'Renamed' })))
    const future = new Date(Date.now() + 5000)
    utimesSync(crx, future, future)
    await materializeExtensions(resolveExtensionSources([crx]), cacheRoot)
    expect(existsSync(sentinel)).toBe(false)
    const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')) as { name?: string }
    expect(manifest.name).toBe('Renamed')
  })

  it('keeps an unchanged manifest key and returns directories in place', async () => {
    const tree = extensionTree({ key: 'already-there' })
    const crx = writeCrx('keyed.crx', crx3(tree))
    const [target] = await materializeExtensions(resolveExtensionSources([crx]), cacheRoot)
    expect((JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')) as { key: string }).key).toBe('already-there')

    const unpackedDir = join(root, 'unpacked')
    mkdirSync(unpackedDir)
    writeFileSync(join(unpackedDir, 'manifest.json'), '{}\n')
    const dirs = await materializeExtensions(resolveExtensionSources([unpackedDir]), cacheRoot)
    expect(dirs).toEqual([realpathSync(unpackedDir)])
  })

  it('unpacks legacy CRX2 containers', async () => {
    const crx = writeCrx('legacy.crx', crx2(extensionTree()))
    const [target] = await materializeExtensions(resolveExtensionSources([crx]), cacheRoot)
    expect(existsSync(join(target, 'manifest.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8'))).toHaveProperty('key')
  })

  it('rejects a payload whose header is not a CRX', async () => {
    const bogus = writeCrx('bogus.crx', Buffer.from('not a crx at all, just long enough to read', 'utf8'))
    const sources = resolveExtensionSources([bogus])
    await expect(materializeExtensions(sources, cacheRoot)).rejects.toThrow(/Cr24/u)
  })

  it('prunes cache directories the current configuration no longer uses', async () => {
    const stale = join(cacheRoot, 'crx-000000000000')
    mkdirSync(stale)
    writeFileSync(join(stale, 'leftover.txt'), 'x\n')

    const crx = writeCrx('fixture.crx', crx3(extensionTree()))
    const [target] = await materializeExtensions(resolveExtensionSources([crx]), cacheRoot)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(target)).toBe(true)

    // Nothing configured any more: the cache follows the configuration.
    await materializeExtensions([], cacheRoot)
    expect(existsSync(target)).toBe(false)
  })

  it('logs nothing and does nothing for an empty configuration', async () => {
    const messages: string[] = []
    const dirs = await materializeExtensions([], cacheRoot, {
      info: (message) => { messages.push(message) },
      warn: (message) => { messages.push(message) },
    })
    expect(dirs).toEqual([])
    expect(messages).toEqual([])
  })

  it('reports a crx whose payload has no manifest', async () => {
    const crx = writeCrx('nomainfest.crx', crx3({ 'background.js': extensionTree()['background.js'] }))
    await expect(materializeExtensions(resolveExtensionSources([crx]), cacheRoot)).rejects.toThrow(/manifest\.json/u)
  })
})
