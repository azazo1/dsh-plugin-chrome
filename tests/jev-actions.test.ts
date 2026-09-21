/**
 * Action resolution: explicit controls matched against captured entries and
 * policy-driven discovery (dedupe, deny/require/allow lists, regex
 * literals, text-field exclusion).
 */
import { describe, expect, it } from 'vitest'
import { discoverActions, parseNamePattern, resolveActions, validateControl } from '../src/host/jev/actions.ts'
import type { JevStateEntry } from '../src/host/jev/types.ts'

/** A tiny captured state: one settings button, two identically named rows. */
function entries(): JevStateEntry[] {
  return [
    { index: 1, role: 'button', name: 'Settings', value: '' },
    { index: 2, role: 'link', name: 'Delete all data', value: '' },
    { index: 3, role: 'link', name: 'Open item', value: '' },
    { index: 4, role: 'link', name: 'Open item', value: '' },
    { index: 5, role: 'text field', name: 'Username', value: '' },
    { index: 6, role: 'button', name: 'Amount', value: '42' },
  ]
}

describe('validateControl', () => {
  it('accepts the documented shapes', () => {
    expect(validateControl({ op: 'click', name: 'Settings' })).toBe(true)
    expect(validateControl({ op: 'scroll', direction: 'down', amount: 2 })).toBe(true)
    expect(validateControl({ op: 'press', key: 'Enter' })).toBe(true)
    expect(validateControl({ op: 'reload' })).toBe(true)
  })

  it('rejects unsafe keys, bad amounts, and ambiguous scroll targets', () => {
    expect(validateControl({ op: 'press', key: 'a' })).toBe(false)
    expect(validateControl({ op: 'scroll', direction: 'down', amount: 9 })).toBe(false)
    expect(validateControl({ op: 'scroll', direction: 'down', targetName: 'List', point: [1, 2] })).toBe(false)
    expect(validateControl({ op: 'click', name: '' })).toBe(false)
    expect(validateControl('click')).toBe(false)
  })
})

describe('parseNamePattern', () => {
  it('parses regex literals and leaves plain strings alone', () => {
    expect(parseNamePattern('/delete/i')?.test('Delete All')).toBe(true)
    expect(parseNamePattern('Settings')).toBeUndefined()
    expect(parseNamePattern('/([unclosed/')).toBeUndefined()
  })
})

describe('resolveActions', () => {
  it('resolves a unique click and skips ambiguous ones', () => {
    const actions = resolveActions(entries(), [
      { op: 'click', name: 'Settings' },
      { op: 'click', name: 'Open item' },
    ], undefined)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ op: 'click', index: 1 })
  })

  it('matches the value display form of an entry', () => {
    const actions = resolveActions(entries(), [{ op: 'click', name: 'Amount' }], undefined)
    expect(actions).toHaveLength(1)
    expect(actions[0].index).toBe(6)
  })

  it('resolves scrolls to a unique container and skips ambiguous ones', () => {
    // "Settings" matches exactly one entry -> scroll bound to its index.
    const unique = resolveActions(entries(), [
      { op: 'scroll', direction: 'down', targetName: 'Settings' },
    ], undefined)
    expect(unique).toHaveLength(1)
    expect(unique[0]).toMatchObject({ op: 'scroll', target: 1, amount: 1 })

    // "Open item" matches two entries -> dropped entirely.
    const ambiguous = resolveActions(entries(), [
      { op: 'scroll', direction: 'down', targetName: 'Open item' },
    ], undefined)
    expect(ambiguous).toHaveLength(0)

    // An explicit point scroll always resolves.
    const point = resolveActions(entries(), [
      { op: 'scroll', direction: 'up', point: [320, 240] },
    ], undefined)
    expect(point).toHaveLength(1)
    expect(point[0].target).toEqual([320, 240])
  })

  it('keeps explicit press/reload actions', () => {
    const actions = resolveActions(entries(), [
      { op: 'press', key: 'PageDown' },
      { op: 'reload' },
    ], undefined)
    expect(actions.map((action) => action.op)).toEqual(['press', 'reload'])
  })
})

describe('discoverActions', () => {
  it('discovers unique clickable roles only, never text fields or duplicates', () => {
    const actions = discoverActions(entries(), { click: true })
    const names = actions.filter((action) => action.op === 'click').map((action) => action.description)
    expect(names).toEqual(['Click Settings', 'Click Delete all data', 'Click Amount'])
  })

  it('honors deny, requireCodex and allow lists', () => {
    const denied = discoverActions(entries(), { click: true, denyNames: ['/delete/i'] })
    expect(denied.some((action) => action.description.includes('Delete'))).toBe(false)

    const allowed = discoverActions(entries(), { click: true, allowNames: ['Settings'] })
    expect(allowed.map((action) => action.description)).toEqual(['Click Settings'])

    // requireCodexNames keeps the control out of the auto set (upstream:
    // reserved controls are simply not offered to Jev).
    const reserved = discoverActions(entries(), { click: true, requireCodexNames: ['Settings'] })
    expect(reserved.some((action) => action.description.includes('Settings'))).toBe(false)
  })

  it('discovers scrolls, keys, and reload within bounds', () => {
    const actions = discoverActions(entries(), {
      scrollDirections: ['down', 'up'],
      scrollAmount: 2,
      keys: ['PageDown', 'x'],
      reload: true,
    })
    expect(actions.filter((action) => action.op === 'scroll')).toHaveLength(2)
    expect(actions.filter((action) => action.op === 'press').map((action) => action.key)).toEqual(['PageDown'])
    expect(actions.filter((action) => action.op === 'reload')).toHaveLength(1)
  })

  it('returns nothing without a policy', () => {
    expect(discoverActions(entries(), undefined)).toEqual([])
  })
})

describe('resolveActions dedupe', () => {
  it('drops discovered actions that duplicate explicit ones', () => {
    const actions = resolveActions(entries(), [{ op: 'click', name: 'Settings' }], { click: true })
    const settings = actions.filter((action) => action.index === 1)
    expect(settings).toHaveLength(1)
  })
})
