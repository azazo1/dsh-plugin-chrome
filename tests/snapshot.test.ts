import { describe, expect, it } from 'vitest'
import { resolveUid, snapshotPage, type UidEntry } from '../src/host/snapshot.ts'

/** A fake page whose CDP session answers with a canned AX tree (no Chrome). */
function fakePage(nodes: unknown[]): {
  target: () => { createCDPSession: () => Promise<{ send: (method: string) => Promise<unknown>; detach: () => Promise<void> }> }
} {
  const session = {
    send: async (method: string) => (method === 'Accessibility.getFullAXTree' ? { nodes } : {}),
    detach: async () => {},
  }
  return { target: () => ({ createCDPSession: async () => session }) }
}

/** Flat CDP AX tree: WebArea → heading, textbox; generic → link. */
const SAMPLE_NODES = [
  { nodeId: 'n1', ignored: false, backendDOMNodeId: 1, role: { value: 'WebArea' }, name: { value: 'Test Page' }, childIds: ['n2', 'n3', 'n4'] },
  { nodeId: 'n2', ignored: false, backendDOMNodeId: 2, parentId: 'n1', role: { value: 'heading' }, name: { value: 'Hello' } },
  { nodeId: 'n3', ignored: false, backendDOMNodeId: 3, parentId: 'n1', role: { value: 'textbox' }, name: { value: 'Search' } },
  { nodeId: 'n4', ignored: false, parentId: 'n1', role: { value: 'generic' }, childIds: ['n5'] },
  { nodeId: 'n5', ignored: false, backendDOMNodeId: 4, parentId: 'n4', role: { value: 'link' }, name: { value: 'Docs' } },
]

describe('snapshotPage', () => {
  it('prints an indented tree with stable uids and registers backend nodes', async () => {
    const page = fakePage(SAMPLE_NODES)
    const result = await snapshotPage(page as never, 0, { verbose: false, maxText: 10000 })
    expect(result.truncated).toBe(false)
    expect(result.text).toContain('[0_1]')
    expect(result.text).toContain('Hello')
    expect(result.text).toContain('Search')
    // The generic node carries no name/value: skipped in interesting-only mode,
    // but its link child still appears.
    expect(result.text).not.toContain('<generic>')
    expect(result.text).toContain('Docs')
    // uid registry: heading, textbox, link mapped (generic nodes carry no uid).
    expect(result.uids.get('0_2')).toEqual({ backendNodeId: 2, pageIndex: 0 })
    expect(result.uids.get('0_3')).toEqual({ backendNodeId: 3, pageIndex: 0 })
    const linkUid = [...result.uids.entries()].find(([, entry]) => entry.backendNodeId === 4)?.[0]
    expect(linkUid).toBe('0_4')
  })

  it('keeps uninteresting nodes in verbose mode', async () => {
    const page = fakePage(SAMPLE_NODES)
    const result = await snapshotPage(page as never, 0, { verbose: true, maxText: 10000 })
    expect(result.text).toContain('<generic>')
  })

  it('truncates long text but keeps the full uid registry', async () => {
    const page = fakePage(SAMPLE_NODES)
    const result = await snapshotPage(page as never, 0, { verbose: false, maxText: 30 })
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBeGreaterThan(30)
    expect(result.uids.size).toBeGreaterThan(0)
  })

  it('returns a readable placeholder for an empty page', async () => {
    const page = fakePage([])
    const result = await snapshotPage(page as never, 0, { verbose: false, maxText: 10000 })
    expect(result.text).toContain('无可访问性内容')
  })
})

describe('resolveUid', () => {
  const registry = new Map<string, UidEntry>([
    ['0_5', { backendNodeId: 5, pageIndex: 0 }],
  ])

  it('resolves a known uid to its backend node id', () => {
    expect(resolveUid(registry, '0_5', 0)).toBe(5)
  })

  it('rejects unknown uids with a re-snapshot hint', () => {
    expect(() => resolveUid(registry, '9_9', 0)).toThrow(/重新执行 chrome_snapshot/u)
  })

  it('rejects uids belonging to another tab', () => {
    expect(() => resolveUid(registry, '0_5', 1)).toThrow(/标签页/u)
  })
})
