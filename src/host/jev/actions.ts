/**
 * Control validation, name matching, candidate preparation, and policy
 * discovery — the layer between a captured state and the decision call.
 *
 * Semantics mirror the upstream bridge: clicks match one clickable entry by
 * name (tolerating a `, Value:` suffix), scroll targets must resolve to
 * exactly one entry or an explicit point, keys are whitelist-bound, and
 * discovery never exposes text fields or duplicate labels.
 */
import type { JevAction, JevControl, JevPolicy, JevStateEntry } from './types.ts'
import { CLICK_ROLES } from './state.ts'

/** Keys a Jev loop may press (navigation/commit only, never text). */
export const SAFE_KEYS: ReadonlySet<string> = new Set([
  'Enter', 'Escape', 'Tab', 'Shift+Tab', 'PageUp', 'PageDown', 'Home', 'End',
])

/** Structural check of one control; the resolver reports the rest. */
export function validateControl(control: unknown): control is JevControl {
  if (typeof control !== 'object' || control === null) return false
  const c = control as Record<string, unknown>
  if (c.op === 'click') return typeof c.name === 'string' && c.name !== ''
  if (c.op === 'scroll') {
    if (c.direction !== 'up' && c.direction !== 'down') return false
    const amount = typeof c.amount === 'number' ? c.amount : 1
    if (!Number.isInteger(amount) || amount < 1 || amount > 5) return false
    const hasTargetName = typeof c.targetName === 'string' && c.targetName !== ''
    const hasPoint = Array.isArray(c.point) && c.point.length === 2 && c.point.every(Number.isFinite)
    if (hasTargetName && hasPoint) return false
    for (const extra of [c.targetAliases, c.aliases]) {
      if (extra !== undefined && (!Array.isArray(extra) || !extra.every((item) => typeof item === 'string')))
        return false
    }
    if (c.description !== undefined && typeof c.description !== 'string') return false
    return true
  }
  if (c.op === 'press') return typeof c.key === 'string' && SAFE_KEYS.has(c.key)
  return c.op === 'reload'
}

/** Observed entry name of one state line (value suffix stripped). */
function semanticName(name: string): string {
  return name.replace(/, Value:.*$/u, '')
}

/** `observed` matches `expected` when equal or when it's the entry's value form. */
function matchesName(observed: string, expected: string): boolean {
  return observed === expected || observed.startsWith(`${expected}, Value:`)
}

/**
 * Parse a `"/pattern/flags"` literal into a RegExp. Plain strings and
 * non-regex literals return undefined and match by name instead — the tool
 * layer only transports JSON, so regexes travel as literals.
 */
export function parseNamePattern(pattern: string): RegExp | undefined {
  const match = /^\/(.*)\/([a-z]*)$/us.exec(pattern)
  if (match === null) return undefined
  try {
    return new RegExp(match[1], match[2])
  } catch {
    return undefined
  }
}

/** True when `name` matches any pattern of the list. */
function anyMatch(names: readonly string[], patterns: readonly string[]): boolean {
  return names.some((name) =>
    patterns.some((pattern) => {
      const regex = parseNamePattern(pattern)
      return regex !== undefined ? regex.test(name) : matchesName(name, pattern)
    }),
  )
}

/** All names an entry can be addressed by (bare and value display forms). */
function entryNames(entry: JevStateEntry): string[] {
  const names = [entry.name]
  if (entry.value !== '') names.push(`${entry.name}, Value: ${entry.value}`)
  return names
}

/** All names a click control is requested by. */
function controlNames(control: JevControl): string[] {
  if (control.op !== 'click') return []
  return [control.name, ...(control.aliases ?? [])].filter((name) => typeof name === 'string' && name !== '')
}

/** Human description of a scroll action. */
function scrollDescription(control: JevControl): string {
  if (control.op !== 'scroll') return ''
  const pages = (control.amount ?? 1) > 1 ? ` ${control.amount} pages` : ''
  const within = control.targetName !== undefined && control.targetName !== ''
    ? ` within ${control.targetName}`
    : control.point !== undefined ? ' within the caller-identified region' : ''
  return `Scroll ${control.direction}${pages}${within}`
}

/** Human description of any control. */
export function describeControl(control: JevControl): string {
  if (control.description !== undefined && control.description !== '') return control.description
  if (control.op === 'scroll') return scrollDescription(control)
  if (control.op === 'press') return `Press ${control.key}`
  if (control.op === 'reload') return 'Reload the current page'
  return `Click ${(control as { name: string }).name}`
}

/** Dedup key of one prepared action. */
function actionKey(action: JevAction): string {
  return [
    action.op,
    action.index ?? '',
    action.direction ?? '',
    action.amount ?? '',
    action.key ?? '',
    action.target === undefined ? '' : String(Array.isArray(action.target) ? action.target.join(',') : action.target),
  ].join(':')
}

/**
 * Build the decision candidates: explicit controls resolved against the
 * current entries (skipping anything that doesn't resolve to exactly one
 * observable match), plus the policy-discovered actions.
 */
export function resolveActions(entries: readonly JevStateEntry[], controls: readonly JevControl[], policy: JevPolicy | undefined): JevAction[] {
  const actions: JevAction[] = []
  for (const control of controls) {
    if (control.op === 'scroll') {
      const names = [control.targetName ?? '', ...(control.targetAliases ?? [])].filter((name) => name !== '')
      const matches = names.length === 0
        ? []
        : entries.filter((entry) => names.some((name) => matchesName(entry.name, name)))
      if (names.length > 0 && matches.length !== 1) continue
      actions.push({
        op: 'scroll',
        direction: control.direction,
        amount: control.amount ?? 1,
        target: control.point ?? matches[0]?.index,
        description: describeControl(control),
        control,
      })
      continue
    }
    if (control.op === 'press' || control.op === 'reload') {
      actions.push({ op: control.op, key: control.op === 'press' ? control.key : undefined, description: describeControl(control), control })
      continue
    }
    const names = controlNames(control)
    const matches = entries.filter((entry) =>
      CLICK_ROLES.has(entry.role) && names.some((name) => matchesName(entry.name, name)),
    )
    if (matches.length !== 1) continue
    actions.push({ op: 'click', index: matches[0].index, description: describeControl(control), control })
  }
  return dedupe([...actions, ...discoverActions(entries, policy)])
}

/** Drop duplicate candidates (first occurrence wins, explicit before discovered). */
function dedupe(actions: JevAction[]): JevAction[] {
  const seen = new Set<string>()
  const result: JevAction[] = []
  for (const action of actions) {
    const key = actionKey(action)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(action)
  }
  return result
}

/**
 * Discover currently observed low-risk mechanical actions from the policy.
 * Only unique-named clickable roles are discovered — text fields never are;
 * duplicate labels stay out because the click would be ambiguous.
 */
export function discoverActions(entries: readonly JevStateEntry[], policy: JevPolicy | undefined): JevAction[] {
  if (policy === undefined) return []
  const denied = policy.denyNames ?? []
  const requireCodex = policy.requireCodexNames ?? []
  const allowed = policy.allowNames ?? []
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const key = semanticName(entry.name)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const actions: JevAction[] = []
  if (policy.click === true) {
    for (const entry of entries) {
      if (!CLICK_ROLES.has(entry.role)) continue
      if (counts.get(semanticName(entry.name)) !== 1) continue
      const names = entryNames(entry)
      if (anyMatch(names, denied) || anyMatch(names, requireCodex)) continue
      if (allowed.length > 0 && !anyMatch(names, allowed)) continue
      actions.push({ op: 'click', index: entry.index, description: `Click ${entry.name}` })
    }
  }
  const amount = typeof policy.scrollAmount === 'number' && Number.isInteger(policy.scrollAmount) &&
      policy.scrollAmount >= 1 && policy.scrollAmount <= 5
    ? policy.scrollAmount
    : 1
  const scrollNames = [policy.scrollTargetName ?? '', ...(policy.scrollTargetAliases ?? [])].filter((name) => name !== '')
  const scrollMatches = scrollNames.length === 0
    ? []
    : entries.filter((entry) => scrollNames.some((name) => matchesName(entry.name, name)))
  const point = Array.isArray(policy.scrollPoint) && policy.scrollPoint.length === 2 &&
      policy.scrollPoint.every(Number.isFinite)
    ? policy.scrollPoint as [number, number]
    : undefined
  const scrollTarget = point ?? (scrollMatches.length === 1 ? scrollMatches[0].index : undefined)
  const canScroll = scrollNames.length === 0 || scrollMatches.length === 1
  for (const direction of policy.scrollDirections ?? []) {
    if ((direction === 'up' || direction === 'down') && canScroll) {
      actions.push({ op: 'scroll', direction, amount, target: scrollTarget, description: scrollNames.length > 0 ? `Scroll ${direction} within ${policy.scrollTargetName}` : `Scroll ${direction}` })
    }
  }
  for (const key of policy.keys ?? []) {
    if (SAFE_KEYS.has(key)) actions.push({ op: 'press', key, description: `Press ${key}` })
  }
  if (policy.reload === true) actions.push({ op: 'reload', description: 'Reload the current page' })
  return actions
}
