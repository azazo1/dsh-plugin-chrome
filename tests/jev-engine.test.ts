/**
 * The decision/action loop, exercised against a scripted fake page (no
 * Chrome, no network): every terminal status, origin enforcement, stale
 * state, no-progress, WAIT handling, budget, and cooperative cancellation.
 */
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Page } from 'puppeteer-core'
import { checkOrigin, JevAbortedError, JevSessionStore, run, validateTask, waitForState } from '../src/host/jev/engine.ts'
import type { JevHistoryEntry } from '../src/host/jev/types.ts'
import type { JevTask } from '../src/host/jev/engine.ts'

/** vi.mock hoisting carrier. */
const mocks = vi.hoisted(() => ({ decide: vi.fn(), execute: vi.fn() }))

vi.mock('../src/host/jev/decide.ts', () => ({ decide: mocks.decide }))
vi.mock('../src/host/jev/execute.ts', () => ({ executeAction: mocks.execute }))

const decideMock = mocks.decide as Mock
const executeMock = mocks.execute as Mock

const ORIGINS = ['https://example.com']

/** Scripted state provider replacing captureJevState. */
const captureMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/host/jev/state.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/jev/state.ts')>()
  return { ...actual, captureJevState: captureMock.fn }
})

/** Helper: one decision answer object (as decide() would return). */
function answer(choice: string, action: unknown = null, confidence = 0.9) {
  return { provider: 'typesafe', choice, confidence, model: 'jev-latest', apiMs: 5, action }
}

/** A state text whose origin and content are `text`. */
function stateText(text: string, url = 'https://example.com/page'): string {
  return `Browser tab: T URL: "${url}".\n${text}`
}

const CREDENTIALS = { envFile: '/tmp/none.env', provider: 'typesafe' as const, model: 'jev-latest' }

const BASE_TASK: JevTask = {
  goal: 'Open settings',
  controls: [{ op: 'click', name: 'Settings' }],
  allowedOrigins: ORIGINS,
}

describe('validateTask', () => {
  it('accepts a controls-only or policy-only task', () => {
    validateTask({ ...BASE_TASK })
    validateTask({ ...BASE_TASK, controls: [], policy: { click: true } })
  })

  it('rejects empty goals, missing actions, and bound violations', () => {
    expect(() => validateTask({ ...BASE_TASK, goal: '' })).toThrow(/goal/u)
    expect(() => validateTask({ ...BASE_TASK, controls: [] })).toThrow(/policy/u)
    expect(() => validateTask({ ...BASE_TASK, allowedOrigins: [] })).toThrow(/allowedOrigins/u)
    expect(() => validateTask({ ...BASE_TASK, maxSteps: 99 })).toThrow(/maxSteps/u)
    expect(() => validateTask({ ...BASE_TASK, maxMs: 60000 })).toThrow(/maxMs/u)
    expect(() => validateTask({ ...BASE_TASK, minConfidence: 0.1 })).toThrow(/minConfidence/u)
    expect(() => validateTask({ ...BASE_TASK, controls: [{ op: 'press', key: 'a' }] })).toThrow(/controls/u)
  })
})

describe('checkOrigin', () => {
  it('passes inside the allowlist and throws outside it', () => {
    const state = { text: stateText('1 button Settings'), entries: [] }
    expect(() => checkOrigin(state, ORIGINS)).not.toThrow()
    expect(() => checkOrigin(state, ['https://other.com'])).toThrow(/白名单/u)
  })

  it('rejects an unparsable URL', () => {
    const state = { text: 'Browser tab: T URL: "not a url".', entries: [] }
    expect(() => checkOrigin(state, ORIGINS)).toThrow(/白名单/u)
  })
})

/** Build a run() invocation with mocked decide/execute/state. */
function makeRun(initialState: string, statesAfterActions: string[] = []) {
  const produced: string[] = [initialState, ...statesAfterActions]
  let producedIndex = 0
  captureMock.fn.mockImplementation(() => {
    const text = produced[Math.min(producedIndex, produced.length - 1)]
    producedIndex += 1
    return { text, entries: [] }
  })
  const prior: JevHistoryEntry[] = []
  return {
    runOnce(task: JevTask = BASE_TASK) {
      return run({ tab: { page: {} as Page, entries: [] }, credentials: CREDENTIALS }, task, prior)
    },
  }
}

describe('run', () => {
  it('returns needs_verification when Jev answers DONE', async () => {
    decideMock.mockResolvedValueOnce(answer('DONE'))
    const { runOnce } = makeRun(stateText('1 button Settings'))
    const outcome = await runOnce()
    expect(outcome.status).toBe('needs_verification')
    expect(outcome.handoff).toBe('needs_verification')
    expect(outcome.steps).toBe(0)
  })

  it('executes an action and finishes on the next DONE', async () => {
    decideMock
      .mockResolvedValueOnce(answer('a0', { op: 'click', index: 1, description: 'Click Settings' }))
      .mockResolvedValueOnce(answer('DONE'))
    executeMock.mockResolvedValue(undefined)
    // capture 顺序: 初始 s0 → 决策后新鲜复查 s0 (未变) → 执行后 s1 → DONE 前 s1.
    const { runOnce } = makeRun(stateText('1 button Settings'), [stateText('1 button Settings'), stateText('1 heading Settings page'), stateText('1 heading Settings page')])
    const outcome = await runOnce()
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe('needs_verification')
    expect(outcome.history.filter((entry) => entry.executed)).toHaveLength(1)
  })

  it('stops at low_confidence', async () => {
    decideMock.mockResolvedValueOnce(answer('a0', { op: 'click', index: 1, description: 'Click Settings' }, 0.3))
    const { runOnce } = makeRun(stateText('1 button Settings'))
    const outcome = await runOnce()
    expect(outcome.status).toBe('low_confidence')
    expect(outcome.handoff).toBe('low_confidence')
  })

  it('returns blocked for a BLOCKED choice', async () => {
    decideMock.mockResolvedValueOnce(answer('BLOCKED'))
    const { runOnce } = makeRun(stateText('1 button Settings'))
    const outcome = await runOnce()
    expect(outcome.status).toBe('blocked')
    expect(outcome.handoff).toBe('model_blocked')
  })

  it('discards a decision made on a stale state', async () => {
    decideMock.mockResolvedValue(answer('DONE'))
    const { runOnce } = makeRun(stateText('1 button Settings'), [stateText('1 button Settings changed')])
    const outcome = await runOnce()
    expect(outcome.history[0].reason).toBe('stale_state')
    expect(outcome.status).toBe('needs_verification')
  })

  it('maps a failed decision to decision_error', async () => {
    decideMock.mockRejectedValue(new Error('typesafe HTTP 401'))
    const { runOnce } = makeRun(stateText('1 button Settings'))
    const outcome = await runOnce()
    expect(outcome.status).toBe('decision_error')
    expect(outcome.error).toMatch(/401/u)
  })

  it('maps a failed action to action_error', async () => {
    decideMock.mockResolvedValueOnce(answer('a0', { op: 'click', index: 1, description: 'Click Settings' }))
    executeMock.mockRejectedValue(new Error('node gone'))
    const { runOnce } = makeRun(stateText('1 button Settings'))
    const outcome = await runOnce()
    expect(outcome.status).toBe('action_error')
    expect(outcome.error).toMatch(/node gone/u)
  })

  it('detects no progress when the same action leaves the state unchanged', async () => {
    decideMock.mockResolvedValue(answer('a0', { op: 'click', index: 1, description: 'Click Same' }))
    executeMock.mockResolvedValue(undefined)
    const { runOnce } = makeRun(stateText('1 button Settings'))
    const outcome = await runOnce()
    expect(outcome.status).toBe('no_progress')
    expect(outcome.history[0].noEffect).toBe(true)
  })

  it('returns loading_timeout after three WAITs', async () => {
    decideMock.mockResolvedValue(answer('WAIT'))
    const { runOnce } = makeRun(stateText('1 button Loading'))
    const outcome = await runOnce()
    expect(outcome.status).toBe('loading_timeout')
  })

  it('respects the step limit', async () => {
    decideMock.mockResolvedValue(answer('a0', { op: 'click', index: 1, description: 'Click Settings' }))
    executeMock.mockResolvedValue(undefined)
    // 每步: 状态 X → 复查 X → 执行后变化. 两步后到达 step_limit.
    const s0 = stateText('1 button Settings')
    const s1 = stateText('2 buttons Settings X')
    const s2 = stateText('3 buttons Settings X Y')
    const { runOnce } = makeRun(s0, [s0, s1, s1, s2])
    const outcome = await runOnce({ ...BASE_TASK, maxSteps: 2 })
    expect(outcome.status).toBe('step_limit')
    expect(outcome.steps).toBe(2)
  })

  it('throws when the page leaves the origin allowlist', async () => {
    decideMock.mockResolvedValueOnce(answer('a0', { op: 'click', index: 1, description: 'Click Settings' }))
    executeMock.mockResolvedValue(undefined)
    const { runOnce } = makeRun(stateText('1 button Settings'), [stateText('1 button Settings'), stateText('1 button Evil', 'https://evil.example/page')])
    await expect(runOnce()).rejects.toThrow(/白名单/u)
  })

  it('propagates cancellation from the signal', async () => {
    const controller = new AbortController()
    decideMock.mockImplementation(async () => {
      controller.abort()
      return answer('DONE')
    })
    captureMock.fn.mockReturnValue({ text: stateText('1 button Settings'), entries: [] })
    await expect(
      run({ tab: { page: {} as Page, entries: [] }, credentials: CREDENTIALS, signal: controller.signal }, BASE_TASK),
    ).rejects.toThrow(JevAbortedError)
  })
})

describe('waitForState', () => {
  it('matches when all includes appear and no exclude does', async () => {
    captureMock.fn.mockReturnValue({ text: stateText('1 heading Report'), entries: [] })
    const outcome = await waitForState({} as never, {
      allowedOrigins: ORIGINS,
      includes: ['Report'],
      excludes: ['Loading'],
    })
    expect(outcome.status).toBe('matched')
  })

  it('times out without matching', async () => {
    captureMock.fn.mockReturnValue({ text: stateText('1 heading Loading'), entries: [] })
    const outcome = await waitForState({} as never, {
      allowedOrigins: ORIGINS,
      includes: ['Report'],
      timeoutMs: 300,
      pollMs: 100,
    })
    expect(outcome.status).toBe('timeout')
  })

  it('rejects wait contracts outside the bounds', async () => {
    await expect(waitForState({} as never, { allowedOrigins: ORIGINS, timeoutMs: 99999999 })).rejects.toThrow(/timeoutMs/u)
    await expect(waitForState({} as never, { allowedOrigins: [] })).rejects.toThrow(/allowedOrigins/u)
  })
})

describe('JevSessionStore', () => {
  it('remembers history across commits and resets on demand', () => {
    const store = new JevSessionStore()
    expect(store.historyOf('s1')).toEqual([])
    const outcome = {
      status: 'needs_verification' as const,
      handoff: 'needs_verification',
      history: [
        { provider: 'typesafe', choice: 'a0', confidence: 0.9, model: 'jev-latest', apiMs: 10, action: 'Click Settings', executed: true },
      ],
      state: 'x',
      elapsedMs: 100,
      steps: 1,
      apiMs: 10,
    }
    const metrics = store.commit('s1', outcome)
    expect(metrics.runs).toBe(1)
    expect(metrics.executedActions).toBe(1)
    expect(store.historyOf('s1')).toHaveLength(1)
    store.reset('s1')
    expect(store.historyOf('s1')).toEqual([])
  })
})
