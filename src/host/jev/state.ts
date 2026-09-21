/**
 * Model-facing page state for the Jev loop.
 *
 * Reuses the uid snapshot's raw AX tree, then formats it the way Jev reads
 * it: one `Browser tab:` header and numbered `N role name` lines. The same
 * numbering feeds action resolution, so a decision's `a3` maps back to the
 * entry (and its backend node) captured here.
 */
import type { Page } from 'puppeteer-core'
import { axValueText, buildAxTree, fetchAxNodes, type AxTree } from '../snapshot.ts'
import type { JevPageState, JevStateEntry } from './types.ts'

/** Roles Jev may click (mirrors the upstream clickable set). */
export const CLICK_ROLES: ReadonlySet<string> = new Set([
  'button', 'link', 'checkBox', 'checkbox', 'radio button', 'radioButton',
  'menu item', 'menuItem', 'tab',
])

/** Maximum characters of one state text sent to the decision API. */
export const MAX_STATE_CHARS = 24000

/**
 * Collect the state entries: every non-ignored node carrying a name or a
 * value (the same interestingness rule as the uid snapshot), in tree order.
 */
function collectEntries(roots: readonly AxTree[], entries: JevStateEntry[]): void {
  for (const node of roots) {
    if (node.ignored) {
      collectEntries(node.children, entries)
      continue
    }
    const name = axValueText(node.name).trim()
    const value = axValueText(node.value)
    const role = node.role?.value ?? ''
    if (name === '' && value === '' && (role === 'generic' || role === 'unknown' || role === '')) {
      collectEntries(node.children, entries)
      continue
    }
    const index = entries.length + 1
    entries.push({
      index,
      role: role === '' ? 'unknown' : role,
      name,
      value,
      backendNodeId: node.backendDOMNodeId,
    })
    collectEntries(node.children, entries)
  }
}

/**
 * Capture the page state: header + numbered lines for Jev, entries for the
 * action resolver.
 * @throws when the state text exceeds {@link MAX_STATE_CHARS} (the task must
 *   be narrowed — the same contract as the upstream bridge).
 */
export async function captureJevState(page: Page): Promise<JevPageState> {
  const nodes = await fetchAxNodes(page)
  const byId = buildAxTree(nodes)
  const roots = nodes
    .filter((node) => node.parentId === undefined || !byId.has(node.parentId))
    .map((node) => byId.get(node.nodeId))
    .filter((node): node is AxTree => node !== undefined)
  const entries: JevStateEntry[] = []
  collectEntries(roots, entries)
  let title = ''
  let url = ''
  try {
    title = await page.title()
    url = page.url()
  } catch {
    // A navigating page may briefly reject evaluation; the header then
    // carries empty fields and the loop's stale-state check recovers.
  }
  const header = `Browser tab: ${title} URL: "${url}".`
  const lines = entries.map((entry) => {
    const value = entry.value === '' ? '' : `, Value: ${entry.value}`
    return `${entry.index} ${entry.role} ${entry.name}${value}`
  })
  const text = [header, ...lines].join('\n')
  if (text.length > MAX_STATE_CHARS) {
    throw new Error(`页面状态过大 (${text.length} 字符, 上限 ${MAX_STATE_CHARS}), 请缩小任务范围 (例如先导航到更具体的页面).`)
  }
  return { text, entries }
}
