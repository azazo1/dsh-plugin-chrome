import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/host/config.ts'
import { findBrowser } from '../src/host/browser.ts'

describe('resolveConfig', () => {
  it('fills every default', () => {
    const config = resolveConfig({})
    expect(config.headless).toBe(false)
    expect(config.idleTimeoutMs).toBe(600000)
    expect(config.maxTabs).toBe(16)
    expect(config.maxSnapshotText).toBe(60000)
    expect(config.screencastFrameSkip).toBe(4)
    expect(config.confirmFirstLaunch).toBe(true)
    expect(config.extensions.get()).toEqual([])
    expect(config.extraArgs.get()).toEqual([])
  })

  it('keeps explicit values', () => {
    const config = resolveConfig({ headless: true, idleTimeoutMs: 0, maxTabs: 4 })
    expect(config.headless).toBe(true)
    expect(config.idleTimeoutMs).toBe(0)
    expect(config.maxTabs).toBe(4)
  })

  it('reads the two list fields through a live value', () => {
    const config = resolveConfig({ extensions: ['/ext/one.crx'], extraArgs: ['--lang=zh-CN'] })
    expect(config.extensions.get()).toEqual(['/ext/one.crx'])
    expect(config.extraArgs.get()).toEqual(['--lang=zh-CN'])
    // Copies, so a caller cannot mutate the config through the returned array.
    expect(config.extensions.get()).not.toBe(config.extensions.get())
  })

  it('follows a volatile ref, the shape the Loader hands over', () => {
    let rows = ['/ext/one.crx']
    const ref = { get: () => rows }
    const config = resolveConfig({ extensions: ref })
    expect(config.extensions.get()).toEqual(['/ext/one.crx'])
    rows = ['/ext/two.crx']
    expect(config.extensions.get()).toEqual(['/ext/two.crx'])
  })
})

describe('findBrowser', () => {
  it('honors an explicit existing path', () => {
    const found = findBrowser(process.execPath) // node.exe exists for sure
    expect(found.path).toBe(process.execPath)
  })

  it('rejects an explicit missing path with a readable error', () => {
    expect(() => findBrowser('Z:\\definitely-not-a-browser\\chrome.exe')).toThrow(/不存在/u)
  })
})
