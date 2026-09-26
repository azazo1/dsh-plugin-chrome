/**
 * Launch-flag policy: the configured extra flags reach Chrome verbatim, and
 * the ones that would fight an invariant the plugin owns are refused with an
 * actionable message rather than producing a browser nothing like the config.
 */
import { describe, expect, it } from 'vitest'
import { extraLaunchArgs, launchOptions } from '../src/host/browser.ts'

/** Base options every case starts from. */
const BASE = { headless: false, windowWidth: 0, windowHeight: 0, extraArgs: [] as readonly string[], enableExtensions: false }

describe('extraLaunchArgs', () => {
  it('keeps one whole flag per row and drops blank rows', () => {
    expect(extraLaunchArgs(['--lang=zh-CN', '   ', ' --proxy-server=http://127.0.0.1:7890 '])).toEqual([
      '--lang=zh-CN',
      '--proxy-server=http://127.0.0.1:7890',
    ])
  })

  it('keeps a flag whose value contains spaces in one argv entry', () => {
    expect(extraLaunchArgs(['--user-agent=Foo Bar'])).toEqual(['--user-agent=Foo Bar'])
  })

  it('refuses a row that is not a flag', () => {
    expect(() => extraLaunchArgs(['https://example.com'])).toThrow(/以 - 开头/u)
  })

  it.each([
    '--user-data-dir=/tmp/other',
    '--headless',
    '--headless=new',
    '--remote-debugging-port=9222',
    '--remote-debugging-pipe',
    '--disable-extensions',
  ])('refuses %s', (flag) => {
    expect(() => extraLaunchArgs([flag])).toThrow(/不被允许/u)
  })
})

describe('launchOptions', () => {
  it('appends the configured flags after the plugin defaults', () => {
    const options = launchOptions('/tmp/profile', { ...BASE, extraArgs: ['--lang=zh-CN'] })
    const args = options.args ?? []
    expect(args).toContain('--no-first-run')
    expect(args).toContain('--lang=zh-CN')
    expect(args).not.toContain('--window-size=0,0')
  })

  it('carries a window size when one is configured', () => {
    const options = launchOptions('/tmp/profile', { ...BASE, windowWidth: 1280, windowHeight: 900 })
    expect(options.args).toContain('--window-size=1280,900')
  })

  it('passes the extension switch through to puppeteer', () => {
    expect(launchOptions('/tmp/profile', { ...BASE, extraArgs: [] }).enableExtensions).toBe(false)
    expect(launchOptions('/tmp/profile', { ...BASE, extraArgs: [], enableExtensions: true }).enableExtensions).toBe(true)
  })

  it('keeps the plugin-owned invariants', () => {
    const options = launchOptions('/tmp/profile', { ...BASE, extraArgs: [] })
    expect(options.userDataDir).toBe('/tmp/profile')
    expect(options.defaultViewport).toBeNull()
    expect(options.handleSIGINT).toBe(false)
  })
})
