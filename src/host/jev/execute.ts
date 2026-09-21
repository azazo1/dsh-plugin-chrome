/**
 * Host-side execution of one prepared action against the session's Chrome
 * page — the Jev loop's entire browser dependency, expressed through the
 * same CDP primitives the chrome_* tools use (click by backend node,
 * puppeteer keyboard, window scroll).
 */
import type { CDPSession, Page } from 'puppeteer-core'
import { cdpSession, clickUid, pressKey, waitForQuiescence } from '../actions.ts'
import type { JevAction, JevStateEntry } from './types.ts'

/** The browser surface the engine drives (a session page + its entries). */
export interface JevTab {
  page: Page
  /** Entries of the state the action was decided from (index → node). */
  entries: readonly JevStateEntry[]
}

/** Look up a state entry by its decision index. */
function entryAt(entries: readonly JevStateEntry[], index: number | undefined): JevStateEntry | undefined {
  return entries.find((entry) => entry.index === index)
}

/** Center of one entry's element, scrolled into view first. */
async function entryCenter(cdp: CDPSession, backendNodeId: number): Promise<{ x: number; y: number }> {
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
  const model = await cdp.send('DOM.getBoxModel', { backendNodeId })
  const quad = model.model?.border ?? model.model?.content
  if (quad === undefined || quad.length < 8) {
    throw new Error('无法定位该元素的屏幕位置 (元素可能已从页面移除)。')
  }
  let x = 0
  let y = 0
  for (let i = 0; i < 8; i += 2) {
    x += quad[i]
    y += quad[i + 1]
  }
  return { x: x / 4, y: y / 4 }
}

/**
 * Wheel-scroll the element under a viewport point (its nearest scrollable
 * ancestor), or the page when the point is omitted.
 */
async function wheelAt(page: Page, cdp: CDPSession, point: { x: number; y: number } | undefined, direction: 'up' | 'down', pages: number): Promise<void> {
  // One wheel "page" is approximated with the viewport height; a mouse wheel
  // of exactly 3 * viewport height is what a user's PageDown roughly does.
  const viewport = page.viewport()
  const pageHeight = viewport !== null ? Math.max(200, Math.round(viewport.height * 0.9)) : 600
  const deltaY = (direction === 'down' ? 1 : -1) * pages * pageHeight
  const target = point ?? (await centerOfScrollArea(page, cdp))
  await mouseEventWheel(cdp, target.x, target.y, deltaY)
}

/** Dispatch a wheel event at a viewport point. */
async function mouseEventWheel(cdp: CDPSession, x: number, y: number, deltaY: number): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: 0,
    deltaY,
    pointerType: 'mouse',
  })
}

/** Viewport center (the default wheel anchor when no point is given). */
async function centerOfScrollArea(page: Page, cdp: CDPSession): Promise<{ x: number; y: number }> {
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  void cdp
  return { x: Math.round(size.width / 2), y: Math.round(size.height / 2) }
}

/**
 * Execute one prepared action.
 * @throws bubbles CDP/puppeteer errors — the engine converts them into the
 *   `action_error` handoff.
 */
export async function executeAction(tab: JevTab, action: JevAction): Promise<void> {
  const { page } = tab
  if (action.op === 'click') {
    const entry = entryAt(tab.entries, action.index)
    if (entry?.backendNodeId === undefined) throw new Error(`状态条目 ${action.index} 已不可点击 (无 DOM 关联)。`)
    const cdp = await cdpSession(page)
    try {
      await clickUid(page, cdp, entry.backendNodeId, false)
    } finally {
      await cdp.detach().catch(() => {})
    }
    return
  }
  if (action.op === 'scroll') {
    const cdp = await cdpSession(page)
    try {
      const target = action.target
      if (Array.isArray(target)) {
        await wheelAt(page, cdp, { x: target[0], y: target[1] }, action.direction ?? 'down', action.amount ?? 1)
      } else if (typeof target === 'number') {
        const entry = entryAt(tab.entries, target)
        if (entry?.backendNodeId === undefined) throw new Error(`滚动目标 ${target} 已不可用 (无 DOM 关联)。`)
        const center = await entryCenter(cdp, entry.backendNodeId)
        await wheelAt(page, cdp, center, action.direction ?? 'down', action.amount ?? 1)
      } else {
        await wheelAt(page, cdp, undefined, action.direction ?? 'down', action.amount ?? 1)
      }
    } finally {
      await cdp.detach().catch(() => {})
    }
    await waitForQuiescence(page)
    return
  }
  if (action.op === 'press') {
    await pressKey(page, action.key ?? '')
    return
  }
  // reload
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForQuiescence(page)
}
