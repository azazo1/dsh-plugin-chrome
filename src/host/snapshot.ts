/**
 * Accessibility-tree page snapshot (the model-facing "see the page" channel).
 *
 * Talks CDP Accessibility.getFullAXTree directly (the same source
 * chrome-devtools-mcp builds its TextSnapshot on): puppeteer's own a11y
 * snapshot strips the backendDOMNodeId linkage we need for uid → element
 * resolution, while the raw AX tree keeps it. We print a compact indented
 * text tree and mint stable element uids (`<pageIndex>_<n>`) that later
 * input tools resolve back to backend DOM node ids through
 * DOM.scrollIntoViewIfNeeded + DOM.getBoxModel + Input.dispatchMouseEvent.
 */
import type { Page } from 'puppeteer-core'

/** One resolved element: page-local uid → backend DOM node. */
export interface UidEntry {
  backendNodeId: number
  pageIndex: number
}

/** Snapshot products: model text plus the uid registry for follow-up actions. */
export interface SnapshotResult {
  text: string
  uids: Map<string, UidEntry>
  truncated: boolean
}

/** Raw CDP AX node subset shared by the uid snapshot and the Jev state. */
export interface AxNode {
  nodeId: string
  ignored: boolean
  backendDOMNodeId?: number
  parentId?: string
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string | number }
  childIds?: string[]
}

/** Textual value of an AX value field (form fields, links, headings). */
export function axValueText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value !== undefined && value !== null && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    const inner = (value as Record<string, unknown>).value
    return typeof inner === 'string' || typeof inner === 'number' ? String(inner) : ''
  }
  return ''
}

/** Compact name for the tree line; quoted when it contains spaces. */
function displayName(name: string): string {
  if (name === '') return ''
  return /[\s"]/u.test(name) ? `"${name}"` : name
}

/** Tree-shaped AX node (children materialized from the flat CDP list). */
export interface AxTree extends AxNode {
  children: AxTree[]
}

/**
 * Build the tree from the flat AX node list and walk it into text lines,
 * minting uids along the way.
 */
export function buildAxTree(nodes: readonly AxNode[]): Map<string, AxTree> {
  const byId = new Map<string, AxTree>()
  for (const node of nodes) {
    byId.set(node.nodeId, { ...node, children: [] })
  }
  for (const node of byId.values()) {
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child !== undefined) node.children.push(child)
    }
  }
  return byId
}

/** True when the node carries nothing a user or model would care about. */
export function isUninteresting(node: AxTree): boolean {
  const name = axValueText(node.name).trim()
  const value = axValueText(node.value)
  const role = node.role?.value ?? ''
  return name === '' && value === '' && (role === 'generic' || role === 'unknown')
}

/** Walk one subtree (depth-first), emitting lines and uids. */
function walkTree(
  roots: readonly AxTree[],
  pageIndex: number,
  depth: number,
  interestingOnly: boolean,
  uids: Map<string, UidEntry>,
  lines: string[],
  counter: { value: number },
): void {
  for (const node of roots) {
    if (node.ignored) {
      walkTree(node.children, pageIndex, depth, interestingOnly, uids, lines, counter)
      continue
    }
    const uninteresting = isUninteresting(node)
    if (interestingOnly && uninteresting) {
      walkTree(node.children, pageIndex, depth, interestingOnly, uids, lines, counter)
      continue
    }
    counter.value += 1
    const uid = `${pageIndex}_${counter.value}`
    if (node.backendDOMNodeId !== undefined) {
      uids.set(uid, { backendNodeId: node.backendDOMNodeId, pageIndex })
    }
    const indent = '  '.repeat(depth)
    const role = node.role?.value ?? 'unknown'
    const name = axValueText(node.name).trim()
    const value = axValueText(node.value)
    const label = [displayName(name), value !== '' ? displayName(value) : ''].filter((part) => part !== '').join(' ')
    const roleSuffix = name === '' && value === '' ? ` <${role}>` : ''
    lines.push(`${indent}[${uid}] ${role}${roleSuffix}${label !== '' ? ` ${label}` : ''}`)
    walkTree(node.children, pageIndex, depth + 1, interestingOnly, uids, lines, counter)
  }
}

/**
 * Read the page's raw accessibility tree through CDP (the same source
 * chrome-devtools-mcp builds its TextSnapshot on).
 */
export async function fetchAxNodes(page: Page): Promise<AxNode[]> {
  const session = await page.target().createCDPSession()
  try {
    await session.send('Accessibility.enable')
    const result = await session.send('Accessibility.getFullAXTree')
    return result.nodes as AxNode[]
  } finally {
    await session.detach().catch(() => {})
  }
}

/**
 * Capture the current page's a11y snapshot.
 * @param page - the control target.
 * @param pageIndex - tab index (uid prefix, keeps multi-tab uids distinct).
 * @param options - verbose keeps uninteresting nodes; maxText truncates the
 *   model-facing result (the uid registry always stays complete).
 */
export async function snapshotPage(page: Page, pageIndex: number, options: {
  verbose?: boolean
  maxText: number
}): Promise<SnapshotResult> {
  const nodes = await fetchAxNodes(page)
  const byId = buildAxTree(nodes)
  const roots = nodes
    .filter((node) => node.parentId === undefined || !byId.has(node.parentId))
    .map((node) => byId.get(node.nodeId))
    .filter((node): node is AxTree => node !== undefined)
  const uids = new Map<string, UidEntry>()
  const lines: string[] = []
  const counter = { value: 0 }
  walkTree(roots, pageIndex, 0, !options.verbose, uids, lines, counter)
  let text = lines.join('\n')
  let truncated = false
  if (text.length > options.maxText) {
    text = `${text.slice(0, options.maxText)}\n… (快照已截断：共 ${lines.length} 行。可先用 chrome_evaluate 精确定位，或改用非 verbose 快照)`
    truncated = true
  }
  if (text === '') text = '(页面无可访问性内容 — 可能是空白页或尚未加载完成)'
  return { text, uids, truncated }
}

/**
 * Resolve a uid into a backend node id using the most recent snapshot
 * registry of the session.
 * @throws when the uid is unknown (stale snapshot) or points to another tab.
 */
export function resolveUid(registry: ReadonlyMap<string, UidEntry>, uid: string, pageIndex: number): number {
  const entry = registry.get(uid)
  if (entry === undefined) {
    throw new Error(`未知元素 uid "${uid}"：页面可能已变化，请先重新执行 chrome_snapshot 获取最新 uid。`)
  }
  if (entry.pageIndex !== pageIndex) {
    throw new Error(`元素 uid "${uid}" 属于标签页 ${entry.pageIndex}，当前控制的是标签页 ${pageIndex}。请先 chrome_tabs select 切换，或重新快照。`)
  }
  return entry.backendNodeId
}
