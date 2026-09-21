/**
 * Jev state capture: raw AX nodes → numbered state text + entries, with the
 * 24000-char contract bound.
 */
import { describe, expect, it, vi } from 'vitest'
import { captureJevState, MAX_STATE_CHARS } from '../src/host/jev/state.ts'
import type { AxNode } from '../src/host/snapshot.ts'
import type { Page } from 'puppeteer-core'

/** Build a minimal flat AX node list: root → button + generic container. */
function axNodes(): AxNode[] {
  return [
    { nodeId: '1', ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Settings page' }, childIds: ['2', '3'] },
    { nodeId: '2', ignored: false, parentId: '1', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 11 },
    { nodeId: '3', ignored: false, parentId: '1', role: { value: 'generic' }, name: { value: '' }, childIds: ['4'] },
    { nodeId: '4', ignored: false, parentId: '3', role: { value: 'textbox' }, name: { value: 'Username' }, value: { value: 'alice' }, backendDOMNodeId: 12 },
  ]
}

function fakePage(url: string): Page {
  return {
    title: async () => 'Settings page',
    url: () => url,
  } as unknown as Page
}

describe('captureJevState', () => {
  it('produces the header and numbered entries in tree order', async () => {
    const original = await import('../src/host/snapshot.ts')
    const spy = vi.spyOn(original, 'fetchAxNodes').mockResolvedValue(axNodes())
    const state = await captureJevState(fakePage('https://example.com/settings'))
    expect(state.text.split('\n')[0]).toBe('Browser tab: Settings page URL: "https://example.com/settings".')
    expect(state.entries).toHaveLength(3)
    expect(state.entries[0]).toMatchObject({ index: 1, role: 'RootWebArea', name: 'Settings page' })
    expect(state.entries[1]).toMatchObject({ index: 2, role: 'button', name: 'Save', backendNodeId: 11 })
    expect(state.entries[2]).toMatchObject({ index: 3, role: 'textbox', name: 'Username', value: 'alice' })
    expect(state.text).toContain('3 textbox Username, Value: alice')
    spy.mockRestore()
  })

  it('throws when the state text exceeds the bound', async () => {
    const original = await import('../src/host/snapshot.ts')
    const big: AxNode[] = [
      { nodeId: '1', ignored: false, role: { value: 'RootWebArea' }, name: { value: 'x'.repeat(MAX_STATE_CHARS) }, childIds: [] },
    ]
    const spy = vi.spyOn(original, 'fetchAxNodes').mockResolvedValue(big)
    await expect(captureJevState(fakePage('https://example.com/'))).rejects.toThrow(/状态过大/u)
    spy.mockRestore()
  })
})

describe('MAX_STATE_CHARS', () => {
  it('matches the upstream 24000 bound', () => {
    expect(MAX_STATE_CHARS).toBe(24000)
  })
})
