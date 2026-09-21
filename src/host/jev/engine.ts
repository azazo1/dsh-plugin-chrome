/**
 * The Jev decision/action loop: observe → decide → execute → repeat, bounded
 * by steps, wall-clock budget, confidence, and an origin allowlist.
 *
 * Control flow mirrors the upstream bridge (origin checks, stale-state
 * rejection, WAIT loading handling, transport retry, no-progress detection);
 * the DSH-specific additions are cooperative cancellation through an
 * AbortSignal and the session store that keeps history/metrics across runs.
 */
import { resolveActions, validateControl } from './actions.ts'
import { decide } from './decide.ts'
import { captureJevState } from './state.ts'
import type {
  JevControl, JevCredentials, JevDecision, JevHistoryEntry, JevPageState,
  JevPolicy, JevRunResult, JevRunStatus, JevSessionMetrics, JevStateEntry,
} from './types.ts'
import { executeAction, type JevTab } from './execute.ts'

/** Contract bounds of one bounded run. */
export const RUN_BOUNDS = {
  maxSteps: { min: 1, max: 30, default: 12 },
  maxMs: { min: 1, max: 45000, default: 45000 },
  decisionTimeoutMs: { min: 1000, max: 30000, default: 20000 },
  maxDecisionRetries: { min: 0, max: 2, default: 1 },
  minConfidence: { min: 0.55, max: 1, default: 0.55 },
  waitPollMs: { min: 100, max: 5000, default: 750 },
} as const

/** Thrown when the caller's signal aborts mid-loop (tool maps it to a message). */
export class JevAbortedError extends Error {
  constructor() {
    super('Jev 循环已被取消。')
    this.name = 'JevAbortedError'
  }
}

/** One bounded task handed to the loop. */
export interface JevTask {
  goal: string
  controls: JevControl[]
  policy?: JevPolicy
  allowedOrigins: string[]
  maxSteps?: number
  maxMs?: number
  minConfidence?: number
  decisionTimeoutMs?: number
  maxDecisionRetries?: number
  waitPollMs?: number
}

/** Validate the task contract (bounds mirror the upstream bridge). */
export function validateTask(task: JevTask): void {
  if (typeof task.goal !== 'string' || task.goal.trim() === '') throw new Error('goal 不能为空。')
  if (!Array.isArray(task.controls)) throw new Error('controls 必须是数组。')
  if (task.controls.some((control) => !validateControl(control))) {
    throw new Error('controls 中存在不合法的动作 (press 仅允许安全按键, scroll amount 为 1-5, click 需要非空 name)。')
  }
  const hasPolicy = task.policy !== undefined && task.policy !== null &&
    typeof task.policy === 'object' && Object.keys(task.policy).length > 0
  if (task.controls.length === 0 && !hasPolicy) {
    throw new Error('controls 与 policy 至少需要提供一个。')
  }
  if (!Array.isArray(task.allowedOrigins) || task.allowedOrigins.length === 0 ||
    task.allowedOrigins.some((origin) => typeof origin !== 'string' || origin === '')) {
    throw new Error('allowedOrigins 必须是非空的 origin 字符串数组。')
  }
  const bounds = (value: number | undefined, bound: { min: number; max: number }, name: string): void => {
    if (value === undefined) return
    if (!Number.isFinite(value) || value < bound.min || value > bound.max) {
      throw new Error(`${name} 超出范围 [${bound.min}, ${bound.max}]。`)
    }
  }
  bounds(task.maxSteps, RUN_BOUNDS.maxSteps, 'maxSteps')
  bounds(task.maxMs, RUN_BOUNDS.maxMs, 'maxMs')
  bounds(task.minConfidence, RUN_BOUNDS.minConfidence, 'minConfidence')
  bounds(task.decisionTimeoutMs, RUN_BOUNDS.decisionTimeoutMs, 'decisionTimeoutMs')
  bounds(task.maxDecisionRetries, RUN_BOUNDS.maxDecisionRetries, 'maxDecisionRetries')
  bounds(task.waitPollMs, RUN_BOUNDS.waitPollMs, 'waitPollMs')
}

/** Verify the state's URL origin stays inside the allowlist. */
export function checkOrigin(state: JevPageState, allowedOrigins: readonly string[]): void {
  const match = /^Browser tab:.* URL: "([^"]*)"\./u.exec(state.text)
  let origin = ''
  try {
    origin = match !== null ? new URL(match[1]).origin : '(unparsable)'
  } catch {
    origin = '(unparsable)'
  }
  if (!allowedOrigins.includes(origin)) {
    throw new Error(`页面已离开授权 origin 白名单 (当前 ${origin})。如确属任务需要, 请把该 origin 加入 allowedOrigins 后重新运行。`)
  }
}

/** Handback names shared with the upstream cross-runtime contract. */
const HANDOFFS: Record<JevRunStatus, string | null> = {
  needs_verification: 'needs_verification',
  low_confidence: 'low_confidence',
  blocked: 'model_blocked',
  no_progress: 'no_progress',
  loading_timeout: 'loading_timeout',
  decision_error: 'decision_error',
  action_error: 'action_error',
  budget: 'budget',
  step_limit: 'step_limit',
}

/** Outcome assembly helper. */
function result(status: JevRunStatus, history: JevHistoryEntry[], state: JevPageState, startedAt: number, decisionMs: number, steps: number, error?: string): JevRunResult {
  return {
    status,
    handoff: HANDOFFS[status],
    history,
    state: state.text,
    elapsedMs: Math.round(performance.now() - startedAt),
    apiMs: Math.round(decisionMs),
    steps,
    error,
  }
}

/** Throw when the caller cancelled the run. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new JevAbortedError()
}

/** Browser surface + credentials the loop needs. */
export interface JevRunContext {
  tab: JevTab
  credentials: JevCredentials
  signal?: AbortSignal
}

/**
 * Run one bounded decision/action loop on the current page state.
 * @param prior - history of previous chunks (session continuity).
 */
export async function run(ctx: JevRunContext, task: JevTask, prior: JevHistoryEntry[] = []): Promise<JevRunResult> {
  validateTask(task)
  const maxSteps = task.maxSteps ?? RUN_BOUNDS.maxSteps.default
  const maxMs = task.maxMs ?? RUN_BOUNDS.maxMs.default
  const minConfidence = task.minConfidence ?? RUN_BOUNDS.minConfidence.default
  const decisionTimeoutMs = task.decisionTimeoutMs ?? RUN_BOUNDS.decisionTimeoutMs.default
  const maxDecisionRetries = task.maxDecisionRetries ?? RUN_BOUNDS.maxDecisionRetries.default
  const waitPollMs = task.waitPollMs ?? RUN_BOUNDS.waitPollMs.default

  const startedAt = performance.now()
  let decisionMs = 0
  let waits = 0
  let decisionRetries = 0
  const history: JevHistoryEntry[] = [...prior]
  const signal = ctx.signal

  let state = await captureJevState(ctx.tab.page)
  throwIfAborted(signal)
  checkOrigin(state, task.allowedOrigins)

  const stepOf = (entries: readonly JevStateEntry[]): JevTab => ({ ...ctx.tab, entries })

  for (let step = 0; step < maxSteps; step++) {
    throwIfAborted(signal)
    checkOrigin(state, task.allowedOrigins)
    if (performance.now() - startedAt > maxMs) return result('budget', history, state, startedAt, decisionMs, step)

    const actions = resolveActions(state.entries, task.controls, task.policy)
    let decision: JevDecision
    const decisionStartedAt = performance.now()
    try {
      decision = await decide({
        credentials: ctx.credentials,
        goal: task.goal,
        state: state.text,
        actions,
        history,
        timeoutMs: Math.max(1, Math.min(decisionTimeoutMs, Math.floor(maxMs - (performance.now() - startedAt)))),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '决策失败'
      const transport = /传输失败或超时/u.test(message)
      const canRetry = transport && decisionRetries < maxDecisionRetries && maxMs - (performance.now() - startedAt) >= 1000
      history.push({
        provider: ctx.credentials.provider, choice: 'ERROR', confidence: null,
        model: null, apiMs: Math.round(performance.now() - decisionStartedAt),
        action: 'Decision request', executed: false,
        reason: canRetry ? 'decision_retry' : 'decision_error',
      })
      if (canRetry) {
        decisionRetries += 1
        state = await captureJevState(ctx.tab.page)
        throwIfAborted(signal)
        checkOrigin(state, task.allowedOrigins)
        step -= 1
        continue
      }
      return result('decision_error', history, state, startedAt, decisionMs, step, message)
    }
    decisionMs += performance.now() - decisionStartedAt
    decisionRetries = 0
    const record: JevHistoryEntry = {
      provider: decision.provider,
      choice: decision.choice,
      confidence: decision.confidence,
      model: decision.model,
      apiMs: decision.apiMs,
      action: decision.action?.description ?? decision.choice,
      executed: false,
    }

    // Fresh state check: a decision made on a stale page is discarded.
    const fresh = await captureJevState(ctx.tab.page)
    throwIfAborted(signal)
    checkOrigin(fresh, task.allowedOrigins)
    if (performance.now() - startedAt >= maxMs) return result('budget', history, fresh, startedAt, decisionMs, step)
    if (fresh.text !== state.text) {
      history.push({ ...record, executed: false, reason: 'stale_state' })
      state = fresh
      continue
    }
    if (decision.confidence < minConfidence) {
      history.push(record)
      return result('low_confidence', history, state, startedAt, decisionMs, step)
    }
    if (decision.choice === 'WAIT') {
      history.push({ ...record, executed: false, reason: 'wait' })
      waits += 1
      if (waits >= 3) return result('loading_timeout', history, state, startedAt, decisionMs, step)
      const remaining = maxMs - (performance.now() - startedAt)
      if (remaining <= 0) return result('budget', history, state, startedAt, decisionMs, step)
      await sleep(Math.min(waitPollMs, remaining), signal)
      state = await captureJevState(ctx.tab.page)
      throwIfAborted(signal)
      continue
    }
    waits = 0
    if (decision.action === null) {
      history.push(record)
      return result(decision.choice === 'DONE' ? 'needs_verification' : 'blocked', history, state, startedAt, decisionMs, step)
    }
    const last = history.at(-1)
    if (last?.noEffect === true && last.action === record.action) {
      return result('no_progress', history, state, startedAt, decisionMs, step)
    }
    try {
      await executeAction(stepOf(state.entries), decision.action)
    } catch (error) {
      history.push({ ...record, executed: false, reason: 'action_error' })
      return result('action_error', history, state, startedAt, decisionMs, step, error instanceof Error ? error.message : '动作执行失败')
    }
    history.push({ ...record, executed: true })
    const next = await captureJevState(ctx.tab.page)
    throwIfAborted(signal)
    checkOrigin(next, task.allowedOrigins)
    if (next.text === state.text) {
      if (decision.action.op === 'scroll') history[history.length - 1].effectNeedsVisualVerification = true
      else history[history.length - 1].noEffect = true
    }
    state = next
  }
  return result('step_limit', history, state, startedAt, decisionMs, maxSteps)
}

/** Sleep bounded, abort-aware. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms)
    const onAbort = () => finish()
    function finish(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted === true) reject(new JevAbortedError())
      else resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Memory of one session's loop progress (history + aggregate metrics). */
interface JevSessionMemory {
  history: JevHistoryEntry[]
  metrics: JevSessionMetrics
}

/**
 * Session-scoped store of loop progress: keyed by the DSH session id,
 * memory-only, cleared when the plugin unloads.
 */
export class JevSessionStore {
  private readonly sessions = new Map<string, JevSessionMemory>()

  private memoryOf(sessionId: string): JevSessionMemory {
    let memory = this.sessions.get(sessionId)
    if (memory === undefined) {
      memory = {
        history: [],
        metrics: { runs: 0, decisions: 0, executedActions: 0, failedDecisions: 0, apiMs: 0, elapsedMs: 0 },
      }
      this.sessions.set(sessionId, memory)
    }
    return memory
  }

  /** History to seed the next chunk with (defensive copy). */
  historyOf(sessionId: string): JevHistoryEntry[] {
    return [...this.memoryOf(sessionId).history]
  }

  /** Drop one session's loop progress. */
  reset(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Fold one run outcome into the session memory. */
  commit(sessionId: string, outcome: JevRunResult): JevSessionMetrics {
    const memory = this.memoryOf(sessionId)
    memory.history = outcome.history
    memory.metrics.runs += 1
    memory.metrics.decisions += outcome.history.filter((entry) => entry.choice !== 'ERROR' && entry.reason === undefined).length
    memory.metrics.executedActions += outcome.history.filter((entry) => entry.executed).length
    memory.metrics.failedDecisions += outcome.history.filter((entry) => entry.reason === 'decision_error').length
    memory.metrics.apiMs += outcome.apiMs
    memory.metrics.elapsedMs += outcome.elapsedMs
    return { ...memory.metrics }
  }

  /** Drop everything (plugin teardown). */
  dispose(): void {
    this.sessions.clear()
  }
}

/** Contract of one deterministic state wait. */
export interface JevWaitTask {
  allowedOrigins: string[]
  includes?: string[]
  excludes?: string[]
  timeoutMs?: number
  pollMs?: number
}

/** Bounds of {@link waitForState}. */
export const WAIT_BOUNDS = {
  timeoutMs: { min: 1, max: 60000, default: 45000 },
  pollMs: { min: 100, max: 5000, default: 1000 },
} as const

/**
 * Poll the page state until every include appears and no exclude does —
 * a bounded deterministic wait that spends no decision calls.
 */
export async function waitForState(page: JevTab['page'], task: JevWaitTask, signal?: AbortSignal): Promise<{ status: 'matched' | 'timeout'; state: string; elapsedMs: number }> {
  const timeoutMs = task.timeoutMs ?? WAIT_BOUNDS.timeoutMs.default
  const pollMs = task.pollMs ?? WAIT_BOUNDS.pollMs.default
  if (!Number.isFinite(timeoutMs) || timeoutMs < WAIT_BOUNDS.timeoutMs.min || timeoutMs > WAIT_BOUNDS.timeoutMs.max) {
    throw new Error(`timeoutMs 超出范围 [${WAIT_BOUNDS.timeoutMs.min}, ${WAIT_BOUNDS.timeoutMs.max}]。`)
  }
  if (!Number.isFinite(pollMs) || pollMs < WAIT_BOUNDS.pollMs.min || pollMs > WAIT_BOUNDS.pollMs.max) {
    throw new Error(`pollMs 超出范围 [${WAIT_BOUNDS.pollMs.min}, ${WAIT_BOUNDS.pollMs.max}]。`)
  }
  const includes = task.includes ?? []
  const excludes = task.excludes ?? []
  if (!Array.isArray(task.allowedOrigins) || task.allowedOrigins.length === 0) {
    throw new Error('allowedOrigins 必须是非空的 origin 字符串数组。')
  }
  const startedAt = performance.now()
  let state = await captureJevState(page)
  throwIfAborted(signal)
  checkOrigin(state, task.allowedOrigins)
  while (performance.now() - startedAt < timeoutMs) {
    if (includes.every((needle) => state.text.includes(needle)) && excludes.every((needle) => !state.text.includes(needle))) {
      return { status: 'matched', state: state.text, elapsedMs: Math.round(performance.now() - startedAt) }
    }
    const remaining = timeoutMs - (performance.now() - startedAt)
    if (remaining > 0) await sleep(Math.min(pollMs, remaining), signal)
    state = await captureJevState(page)
    throwIfAborted(signal)
    checkOrigin(state, task.allowedOrigins)
  }
  return { status: 'timeout', state: state.text, elapsedMs: Math.round(performance.now() - startedAt) }
}
