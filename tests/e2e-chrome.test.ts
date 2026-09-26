/**
 * Real-Chrome end-to-end smoke: launches a visible Chrome, drives a tiny
 * page through the actual plugin modules (browser/manager/snapshot/actions),
 * and closes it. Not part of the default test run (it pops a real window).
 *
 * Run with: npm run test:e2e
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Browser } from 'puppeteer-core'
import { captureScreenshot, cdpSession, clickUid, navigate } from '../src/host/actions.ts'
import { findBrowser, launchBrowser, launchOptions } from '../src/host/browser.ts'
import { SessionChrome } from '../src/host/manager.ts'
import { resolveConfig } from '../src/host/config.ts'
import { resolveUid, snapshotPage } from '../src/host/snapshot.ts'
import { extensionTree } from './helpers/crx-fixture.ts'

/** Write one minimal MV3 extension tree to disk. */
function writeExtensionTree(dir: string): void {
  for (const [name, bytes] of Object.entries(extensionTree())) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }
}

/**
 * Launch the visible Chrome every extension case shares: one profile under the
 * scratch root, extensions allowed (`--disable-extensions` left out).
 */
async function openExtensionWindow(extensionDir: string): Promise<Browser> {
  const exec = findBrowser(resolveConfig({ idleTimeoutMs: 0 }).executablePath)
  const { browser } = await launchBrowser(exec.path, launchOptions(join(dirname(extensionDir), 'profile-ext'), {
    headless: false,
    windowWidth: 900,
    windowHeight: 640,
    extraArgs: [],
    enableExtensions: true,
  }))
  return browser
}

/**
 * Evaluate an expression in the extension's service worker, waiting for it to
 * start (MV3 workers are started on demand).
 */
async function extensionStorage(browser: Browser, extensionId: string, expression: string): Promise<unknown> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const extension = (await browser.extensions()).get(extensionId)
    const workers = extension === undefined ? [] : await extension.workers()
    if (workers.length > 0) return await workers[0].evaluate(expression)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('扩展的 service worker 没有启动')
}

const TEST_PAGE = `data:text/html,<html><body>
  <h1 id="greeting">Smoke</h1>
  <button id="btn" onclick="document.getElementById('greeting').textContent='Clicked'">Go</button>
  <input id="box" value="">
</body></html>`

describe('chrome e2e smoke', () => {
  let session: SessionChrome | undefined
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-chrome-smoke-'))
  const config = resolveConfig({ idleTimeoutMs: 0 })

  afterAll(async () => {
    await session?.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('launches a visible Chrome window and drives it', { timeout: 120000 }, async () => {
    const exec = findBrowser(config.executablePath)
    const { browser, adopted } = await launchBrowser(exec.path, launchOptions(join(scratch, 'profile'), {
      headless: false,
      windowWidth: 1000,
      windowHeight: 700,
      extraArgs: [],
      enableExtensions: false,
    }))
    session = new SessionChrome('session-smoke-e2e', browser, scratch, config, adopted)
    const page = (await browser.pages())[0]
    expect(page).toBeDefined()
    await navigate(page, TEST_PAGE, 20000)

    // a11y snapshot with uid registry
    const snap = await snapshotPage(page, 0, { maxText: 20000 })
    expect(snap.text).toContain('Smoke')
    expect(snap.text).toContain('Go')
    session.uidRegistry = snap.uids
    // Locate the button through its visible label "Go".
    const buttonLine = snap.text.split('\n').find((line) => line.includes('Go'))
    expect(buttonLine).toBeDefined()
    const buttonUid = /\[(\d+_\d+)\]/u.exec(buttonLine ?? '')?.[1]
    expect(buttonUid).toBeDefined()
    const nodeId = resolveUid(snap.uids, buttonUid ?? '', 0)

    // CDP coordinate click on the button
    const cdp = await cdpSession(page)
    await clickUid(page, cdp, nodeId, false)
    await cdp.detach()
    const after = await page.evaluate(() => document.getElementById('greeting')?.textContent)
    expect(after).toBe('Clicked')

    // screenshot round-trips a real buffer
    const shot = await captureScreenshot(page, { fullPage: false, format: 'png' })
    expect(shot.buffer.length).toBeGreaterThan(1000)
    expect(shot.width).toBeGreaterThan(0)

    // screencast: subscribe once and expect at least one JPEG frame.
    // Chrome only emits frames when the page repaints, so keep a gentle
    // repaint heartbeat running during the wait (a real agent session is
    // never static for long).
    const frames: string[] = []
    session.onFrame = (frame) => frames.push(frame.data)
    await session.addScreencastWatcher({ e2e: true })
    const heartbeat = setInterval(() => {
      void page.evaluate(() => {
        const el = document.getElementById('greeting')
        if (el !== null) el.style.opacity = String(Math.random())
      }).catch(() => {})
    }, 300)
    const deadline = Date.now() + 20000
    while (frames.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    clearInterval(heartbeat)
    // eslint-disable-next-line no-console
    console.log('[e2e] plugin screencast frames:', frames.length)
    expect(frames.length).toBeGreaterThan(0)
    await session.removeScreencastWatcher({ e2e: true })

    // Cross-check with a raw CDP session (same mechanism, no plugin wrapper).
    const diagSession = await page.target().createCDPSession()
    const rawFrames: unknown[] = []
    diagSession.on('Page.screencastFrame', (frame) => rawFrames.push(frame))
    await diagSession.send('Page.enable')
    await diagSession.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 })
    const diagDeadline = Date.now() + 10000
    while (rawFrames.length === 0 && Date.now() < diagDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    // eslint-disable-next-line no-console
    console.log('[e2e] direct CDP screencast frames:', rawFrames.length)
    await diagSession.send('Page.stopScreencast').catch(() => {})
    await diagSession.detach().catch(() => {})
    expect(rawFrames.length).toBeGreaterThan(0)
  })

  it('loads an unpacked extension into a session window', { timeout: 120000 }, async () => {
    const extensionDir = join(scratch, 'fixture-extension')
    writeExtensionTree(extensionDir)
    const browser = await openExtensionWindow(extensionDir)
    try {
      const id = await browser.installExtension(extensionDir)
      const extensions = await browser.extensions()
      const installed = extensions.get(id)
      expect(installed).toBeDefined()
      expect(installed?.name).toBe('Fixture extension')
      // Chrome reports resolved paths (macOS /var -> /private/var).
      expect(installed?.path).toBe(realpathSync(extensionDir))
    } finally {
      await browser.close()
    }
  })

  /**
   * The extension story the plugin relies on: Chrome drops extensions
   * installed over CDP when the browser restarts (so a window has to install
   * them again), while the extension's OWN data stays in the session profile
   * keyed by extension ID (so the user's settings inside the extension are
   * still there after a relaunch).
   */
  it('keeps the extension settings across a window relaunch, re-installing it each time', { timeout: 180000 }, async () => {
    const extensionDir = join(scratch, 'persist-extension')
    writeExtensionTree(extensionDir)

    const first = await openExtensionWindow(extensionDir)
    const firstId = await first.installExtension(extensionDir)
    // The user's edit inside the extension, as it would happen in the window.
    const wrote = await extensionStorage(first, firstId, `(async () => {
      await chrome.storage.local.set({ marker: 'edited-in-instance' })
      return chrome.storage.local.get('marker')
    })()`)
    expect(wrote).toMatchObject({ marker: 'edited-in-instance' })
    await first.close()

    // A fresh launch no longer knows the extension: this is why the plugin
    // installs the configured directories on every launch.
    const second = await openExtensionWindow(extensionDir)
    expect((await second.extensions()).size).toBe(0)
    const secondId = await second.installExtension(extensionDir)
    expect(secondId).toBe(firstId)
    const readBack = await extensionStorage(second, secondId, `chrome.storage.local.get(['marker', 'startups'])`)
    // eslint-disable-next-line no-console
    console.log('[e2e] extension storage after relaunch:', JSON.stringify(readBack))
    expect(readBack).toMatchObject({ marker: 'edited-in-instance' })
    await second.close()
  })
})
