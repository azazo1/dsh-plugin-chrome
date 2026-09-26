/**
 * Window-lifecycle and extension-sync regressions.
 *
 * The first group covers a window the user closed by hand: closing it makes
 * the browser emit `disconnected`, which marks the mapped SessionChrome dead,
 * and only the manager's call sites can act on that. If `getOrLaunch`
 * returned the dead instance, every later chrome_* call would fail with a raw
 * puppeteer "browser disconnected" error instead of reopening the window.
 *
 * The second group covers the extension sync performed on every launch with a
 * fake browser, so the install / skip / prune decisions are exercised without
 * spawning Chrome.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, Extension } from 'puppeteer-core'
import { EXTENSIONS_DIR } from '../src/shared/contract.ts'
import { resolveConfig } from '../src/host/config.ts'
import { ChromeManager } from '../src/host/manager.ts'

/** A fake browser plus the actions the tests need. */
interface FakeBrowser {
  browser: Browser
  /** Reproduce a user closing the window: disconnect, then emit the event. */
  closeByUser: () => void
  /** Installed extensions as id → directory path, updated by the fake. */
  installed: Map<string, string>
  /** Directories the plugin asked to install, in order. */
  installCalls: string[]
  /** Extension ids the plugin asked to remove, in order. */
  uninstallCalls: string[]
  /** Make the next install fail, as a Chrome refusal would. */
  failInstall: boolean
}

/**
 * Build a puppeteer Browser stand-in with the surface `ChromeManager` and
 * `SessionChrome` touch: event wiring, `pages()`, a CDP session factory, the
 * `connected` flag `isAlive()` reads, and the extension commands.
 */
function fakeBrowser(): FakeBrowser {
  const handlers = new Map<string, Array<() => void>>()
  const installed = new Map<string, string>()
  const fake: FakeBrowser = {
    installed,
    installCalls: [],
    uninstallCalls: [],
    failInstall: false,
    browser: undefined as unknown as Browser,
    closeByUser: () => {},
  }
  const browser = {
    connected: true,
    on: (event: string, handler: () => void): void => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    pages: async (): Promise<never[]> => [],
    target: () => ({
      createCDPSession: async () => ({ send: async (): Promise<unknown> => ({}), detach: async (): Promise<void> => {} }),
    }),
    extensions: async (): Promise<Map<string, Extension>> => {
      const map = new Map<string, Extension>()
      for (const [id, path] of installed) map.set(id, { id, path } as unknown as Extension)
      return map
    },
    installExtension: async (path: string): Promise<string> => {
      if (fake.failInstall) throw new Error('refused by the browser')
      const id = `id-${installed.size}`
      installed.set(id, path)
      fake.installCalls.push(path)
      return id
    },
    uninstallExtension: async (id: string): Promise<void> => {
      fake.uninstallCalls.push(id)
      installed.delete(id)
    },
    close: async (): Promise<void> => {},
  } as unknown as Browser
  fake.browser = browser
  fake.closeByUser = () => {
    ;(browser as { connected: boolean }).connected = false
    for (const handler of handlers.get('disconnected') ?? []) handler()
  }
  return fake
}

describe('ChromeManager window revival', () => {
  let dataRoot: string
  let created: FakeBrowser[]

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'dsh-chrome-manager-'))
    created = []
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  /** Manager whose launches are faked and counted. */
  function makeManager(extensions: string[] = []): ChromeManager {
    return new ChromeManager(resolveConfig({ idleTimeoutMs: 0, extensions }), dataRoot, async () => {
      const fake = fakeBrowser()
      created.push(fake)
      return { browser: fake.browser, adopted: false }
    })
  }

  it('reuses a live window instead of launching again', async () => {
    const manager = makeManager()
    const first = await manager.getOrLaunch('session-aaa')
    expect(created).toHaveLength(1)

    await expect(manager.getOrLaunch('session-aaa')).resolves.toBe(first)
    expect(created).toHaveLength(1)

    await manager.closeAll()
    manager.dispose()
  })

  it('starts a fresh window after the user closes the old one', async () => {
    const manager = makeManager()
    const first = await manager.getOrLaunch('session-bbb')
    expect(created).toHaveLength(1)

    created[0].closeByUser()
    expect(first.isAlive()).toBe(false)

    // The stale instance must be dropped, not returned: this is the fix.
    const second = await manager.getOrLaunch('session-bbb')
    expect(second).not.toBe(first)
    expect(second.isAlive()).toBe(true)
    expect(created).toHaveLength(2)
    expect(manager.get('session-bbb')).toBe(second)

    await manager.closeAll()
    manager.dispose()
  })

  it('keeps a hand-closed window out of the reuse path across later calls', async () => {
    const manager = makeManager()
    const first = await manager.getOrLaunch('session-ccc')
    created[0].closeByUser()

    const second = await manager.getOrLaunch('session-ccc')
    expect(second).not.toBe(first)
    // The replacement behaves like any live window: reused, not relaunched.
    await expect(manager.getOrLaunch('session-ccc')).resolves.toBe(second)
    expect(created).toHaveLength(2)

    await manager.closeAll()
    manager.dispose()
  })
})

describe('ChromeManager extension sync', () => {
  let dataRoot: string
  let extensionDir: string
  let fake: FakeBrowser
  /** Extension directories the manager resolved for the launch. */
  let launchedWith: readonly string[]

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'dsh-chrome-ext-'))
    extensionDir = join(dataRoot, 'my-extension')
    mkdirSync(extensionDir)
    writeFileSync(join(extensionDir, 'manifest.json'), '{}\n')
    launchedWith = []
  })

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true })
  })

  /** Manager whose launch yields one shared fake browser. */
  function makeManager(extensions: string[]): ChromeManager {
    fake = fakeBrowser()
    return new ChromeManager(resolveConfig({ idleTimeoutMs: 0, extensions }), dataRoot, async (_sessionId, dirs) => {
      launchedWith = dirs
      return { browser: fake.browser, adopted: false }
    })
  }

  it('installs a configured extension directory into a fresh window', async () => {
    const manager = makeManager([extensionDir])
    await manager.getOrLaunch('session-ext')
    expect(launchedWith).toEqual([realpathSync(extensionDir)])
    expect(fake.installCalls).toEqual([realpathSync(extensionDir)])
    await manager.closeAll()
    manager.dispose()
  })

  it('skips an extension the window already has, comparing canonical paths', async () => {
    fake = fakeBrowser()
    fake.installed.set('already-there', realpathSync(extensionDir))
    const manager = new ChromeManager(resolveConfig({ idleTimeoutMs: 0, extensions: [extensionDir] }), dataRoot, async () => ({
      browser: fake.browser,
      adopted: false,
    }))
    await manager.getOrLaunch('session-ext')
    expect(fake.installCalls).toEqual([])
    expect(fake.uninstallCalls).toEqual([])
    await manager.closeAll()
    manager.dispose()
  })

  it('removes a cached extension the configuration no longer asks for', async () => {
    fake = fakeBrowser()
    const cacheRoot = join(dataRoot, EXTENSIONS_DIR)
    const stale = join(cacheRoot, 'crx-0123456789ab')
    mkdirSync(stale, { recursive: true })
    fake.installed.set('stale-id', realpathSync(stale))
    const manager = new ChromeManager(resolveConfig({ idleTimeoutMs: 0, extensions: [] }), dataRoot, async () => ({
      browser: fake.browser,
      adopted: false,
    }))
    await manager.getOrLaunch('session-ext')
    expect(fake.uninstallCalls).toEqual(['stale-id'])
    await manager.closeAll()
    manager.dispose()
  })

  it('fails the launch, and closes the window, when an extension cannot be installed', async () => {
    const manager = makeManager([extensionDir])
    fake.failInstall = true
    await expect(manager.getOrLaunch('session-ext')).rejects.toThrow(/扩展装入失败/u)
    expect(manager.get('session-ext')).toBeUndefined()
    manager.dispose()
  })
})
