/**
 * Window-lifecycle regression: a Chrome window the user closed by hand must
 * not be handed back to later calls.
 *
 * Closing the window makes the browser emit `disconnected`, which marks the
 * mapped SessionChrome dead — but only the manager's call sites can act on
 * that. If `getOrLaunch` returned the dead instance, every later chrome_*
 * call would fail with a raw puppeteer "browser disconnected" error instead
 * of reopening the window. These tests drive that path with a fake browser,
 * so no real Chrome is launched.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Browser } from 'puppeteer-core'
import { resolveConfig } from '../src/host/config.ts'
import { ChromeManager } from '../src/host/manager.ts'

/** A fake browser plus the one action the tests need: the user closing it. */
interface FakeBrowser {
  browser: Browser
  /** Reproduce a user closing the window: disconnect, then emit the event. */
  closeByUser: () => void
}

/**
 * Build a puppeteer Browser stand-in with just the surface `ChromeManager`
 * and `SessionChrome` touch: event wiring, `pages()`, a CDP session factory,
 * and the `connected` flag `isAlive()` reads.
 */
function fakeBrowser(): FakeBrowser {
  const handlers = new Map<string, Array<() => void>>()
  const browser = {
    connected: true,
    on: (event: string, handler: () => void): void => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
    },
    pages: async (): Promise<never[]> => [],
    target: () => ({
      createCDPSession: async () => ({ send: async (): Promise<unknown> => ({}), detach: async (): Promise<void> => {} }),
    }),
    close: async (): Promise<void> => {},
  } as unknown as Browser
  return {
    browser,
    closeByUser: () => {
      ;(browser as { connected: boolean }).connected = false
      for (const handler of handlers.get('disconnected') ?? []) handler()
    },
  }
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
  function makeManager(): ChromeManager {
    return new ChromeManager(resolveConfig({}), dataRoot, async () => {
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
