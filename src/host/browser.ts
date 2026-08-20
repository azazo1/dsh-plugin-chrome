/**
 * Chrome executable discovery and puppeteer launch.
 *
 * We drive the user's ALREADY-INSTALLED Chrome/Edge through puppeteer-core
 * (no browser download, ~zero install weight). The window is headed by
 * default and gets an isolated per-session user-data-dir, so the harness's
 * browser never mixes with the user's daily profile and the user can watch
 * every action in a real window.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import puppeteer, { type Browser, type LaunchOptions } from 'puppeteer-core'

/** One candidate browser location. */
interface BrowserCandidate {
  name: string
  paths: string[]
}

/** Platform-specific candidates, ordered by preference. */
const CANDIDATES: BrowserCandidate[] = [
  {
    name: 'Google Chrome',
    paths: (() => {
      if (process.platform === 'win32') {
        return [
          join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          join(process.env['LOCALAPPDATA'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      }
      if (process.platform === 'darwin') {
        return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      }
      return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
    })(),
  },
  {
    name: 'Microsoft Edge',
    paths: (() => {
      if (process.platform === 'win32') {
        return [
          join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      }
      if (process.platform === 'darwin') {
        return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      }
      return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
    })(),
  },
  {
    name: 'Chromium',
    paths: (() => {
      if (process.platform === 'win32') {
        return [join(process.env['LOCALAPPDATA'] ?? '', 'Chromium', 'Application', 'chrome.exe')]
      }
      if (process.platform === 'darwin') {
        return ['/Applications/Chromium.app/Contents/MacOS/Chromium']
      }
      return ['/usr/bin/chromium-browser']
    })(),
  },
]

/** Probe a directory that may exist but be a broken legacy path (like /snap). */
function usable(path: string): boolean {
  if (path === '' || path.endsWith('\\')) return false
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * Locate an installed Chrome-family browser.
 * @param explicit - user-configured absolute path, validated first.
 * @returns the first usable executable.
 * @throws when nothing is installed and no explicit path works.
 */
export function findBrowser(explicit: string): { path: string; name: string } {
  if (explicit !== '') {
    if (usable(explicit)) return { path: explicit, name: 'configured browser' }
    throw new Error(`配置的浏览器路径不存在: ${explicit}`)
  }
  for (const candidate of CANDIDATES) {
    for (const path of candidate.paths) {
      if (usable(path)) return { path, name: candidate.name }
    }
  }
  throw new Error('未找到可用的 Chrome / Edge / Chromium。请安装其中之一，或在插件配置里设置 executablePath。')
}

/**
 * Build the puppeteer launch options for one session window.
 * @param userDataDir - isolated profile dir for this session.
 * @param headless - false keeps the window visible (the plugin's point).
 * @param windowWidth/Height - initial window size; 0 = Chrome default.
 * @param extraArgs - additional command-line flags.
 */
export function launchOptions(userDataDir: string, opts: {
  headless: boolean
  windowWidth: number
  windowHeight: number
  extraArgs: string
}): LaunchOptions {
  const args: string[] = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--hide-crash-restore-bubble',
  ]
  if (opts.windowWidth > 0 && opts.windowHeight > 0) {
    args.push(`--window-size=${opts.windowWidth},${opts.windowHeight}`)
  }
  if (opts.extraArgs.trim() !== '') {
    args.push(...opts.extraArgs.trim().split(/\s+/))
  }
  return {
    headless: opts.headless,
    // null viewport = the viewport follows the real window size, which is
    // what "a visible browser the user can resize" requires.
    defaultViewport: null,
    userDataDir,
    args,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  }
}

/**
 * Launch one session browser; falls back to adopting a still-running Chrome
 * that owns the same user-data-dir (the previous DSH process left it behind
 * when it was killed — the profile lock makes a fresh launch fail).
 *
 * Adoption reads the `DevToolsActivePort` file Chrome writes into the
 * profile dir (the same auto-connect mechanism chrome-devtools-mcp uses)
 * and connects over the localhost debugging endpoint.
 * @returns the browser plus whether it was adopted (adopted instances need
 *   CDP Browser.close instead of a plain close()).
 * @throws with a readable message when Chrome refuses to start.
 */
export async function launchBrowser(executablePath: string, options: LaunchOptions): Promise<{ browser: Browser; adopted: boolean }> {
  try {
    return { browser: await puppeteer.launch({ ...options, executablePath }), adopted: false }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (!/already running|profile is in use|DevToolsActivePort/iu.test(detail)) {
      throw new Error(`Chrome 启动失败: ${detail}`)
    }
    // The profile is locked by a live Chrome (leftover from a killed DSH
    // host). Adopt it instead of failing the whole plugin.
    const endpoint = await readDevToolsEndpoint(options.userDataDir ?? '')
    if (endpoint === null) {
      throw new Error(`Chrome 启动失败: ${detail}（且无法接管遗留实例——请手动关闭残留的 Chrome 窗口后重试）`)
    }
    const browser = await puppeteer.connect({ browserURL: endpoint, defaultViewport: null })
    return { browser, adopted: true }
  }
}

/** Read the localhost debugging endpoint from DevToolsActivePort. */
async function readDevToolsEndpoint(userDataDir: string): Promise<string | null> {
  try {
    const file = join(userDataDir, 'DevToolsActivePort')
    const raw = await readFile(file, 'utf8')
    const lines = raw.trim().split(/\r?\n/u)
    const port = lines[0]
    if (port === undefined || !/^\d+$/u.test(port)) return null
    return `http://127.0.0.1:${port}`
  } catch {
    return null
  }
}

/**
 * Close a browser instance: CDP Browser.close kills the Chrome process even
 * for adopted (connected) instances, then plain close() releases the client.
 */
export async function closeBrowserHard(browser: Browser): Promise<void> {
  try {
    const session = await browser.target().createCDPSession()
    await session.send('Browser.close')
    await session.detach().catch(() => {})
  } catch {
    // The process may already be gone; the regular close below still cleans up.
  }
  await browser.close().catch(() => {})
}

/**
 * Force the window visible. Chrome spawned by a hidden parent (a DSH host
 * started with SW_HIDE — a shortcut, task scheduler, or service) inherits
 * the hidden window state: the window exists, reports windowState 'normal'
 * over CDP, yet the user never sees it. A minimized → normal bounds cycle
 * through CDP re-shows the window on the desktop.
 */
export async function forceWindowVisible(browser: Browser): Promise<void> {
  try {
    const session = await browser.target().createCDPSession()
    const targets = await session.send('Target.getTargets')
    const pageTarget = targets.targetInfos.find((target) =>
      target.type === 'page'
      && !target.url.startsWith('chrome://')
      && !target.url.startsWith('devtools://'))
    if (pageTarget === undefined) return
    const info = await session.send('Browser.getWindowForTarget', { targetId: pageTarget.targetId })
    if (info.windowId === undefined) return
    await session.send('Browser.setWindowBounds', { windowId: info.windowId, bounds: { windowState: 'minimized' } })
    await new Promise((resolve) => setTimeout(resolve, 500))
    await session.send('Browser.setWindowBounds', { windowId: info.windowId, bounds: { windowState: 'normal' } })
    await session.detach().catch(() => {})
  } catch {
    // Best-effort: on healthy hosts the window is already visible.
  }
}

/** Resolve the plugin data root (explicit config or <DSH_HOME>/data/dsh-plugin-chrome). */
export function resolveDataRoot(explicit: string): string {
  if (explicit !== '') return explicit
  const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(dshHome, 'data', 'dsh-plugin-chrome')
}
