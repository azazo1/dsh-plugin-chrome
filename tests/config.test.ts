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
  })

  it('keeps explicit values', () => {
    const config = resolveConfig({ headless: true, idleTimeoutMs: 0, maxTabs: 4 })
    expect(config.headless).toBe(true)
    expect(config.idleTimeoutMs).toBe(0)
    expect(config.maxTabs).toBe(4)
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
