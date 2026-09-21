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
    expect(config.jevEnabled).toBe(false)
    expect(config.jevProvider).toBe('typesafe')
    expect(config.jevModel).toBe('')
    expect(config.jevEnvFile).toBe('')
  })

  it('keeps explicit values', () => {
    const config = resolveConfig({ headless: true, idleTimeoutMs: 0, maxTabs: 4 })
    expect(config.headless).toBe(true)
    expect(config.idleTimeoutMs).toBe(0)
    expect(config.maxTabs).toBe(4)
  })

  it('keeps explicit Jev settings', () => {
    const config = resolveConfig({
      jevEnabled: true,
      jevProvider: 'openrouter',
      jevModel: '~typesafe/jev-latest',
      jevEnvFile: '/tmp/creds.env',
    })
    expect(config.jevEnabled).toBe(true)
    expect(config.jevProvider).toBe('openrouter')
    expect(config.jevModel).toBe('~typesafe/jev-latest')
    expect(config.jevEnvFile).toBe('/tmp/creds.env')
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
