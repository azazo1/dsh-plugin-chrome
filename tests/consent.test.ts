/**
 * Launch-consent regression: the first browser launch of a session must go
 * through the user's approval, and every later call of that session must not.
 *
 * These tests drive the registered `tools/pre-execute` gate directly with
 * fake executions, so the decision pipeline is exercised without Chrome, an
 * agent loop, or an approval answerer.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { LaunchConsent } from '../src/host/consent.ts'
import { resolveConfig } from '../src/host/config.ts'
import { consentGate, type ToolDeps } from '../src/host/tools.ts'

/** The waterfall listener signature the gate registers. */
type GateListener = (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>

/** Inputs of one gate scenario. */
interface HarnessOptions {
  /** Whether the session already has a live window. */
  hasWindow?: boolean
  /** Session id the execution carries; undefined = an execution without an agent. */
  sessionId?: string | undefined
  /** Value of the confirmFirstLaunch config. */
  confirmFirstLaunch?: boolean
  /** Whether an approval service is composed in this deployment. */
  approvalService?: boolean
}

/** One registered gate plus the means to call it. */
interface Harness {
  /** Run one chrome_* call through the gate; downstream decides `allow`. */
  call: (toolName: string, downstream?: PreToolDecision) => Promise<PreToolDecision>
  consent: LaunchConsent
}

/** Register the gate on a stub context and expose it as a callable. */
function harness(options: HarnessOptions = {}): Harness {
  const consent = new LaunchConsent()
  let listener: GateListener | undefined
  const ctx = {
    on: (_name: string, fn: GateListener): (() => void) => {
      listener = fn
      return () => {}
    },
    get: (name: string): unknown => (name === 'approval' && options.approvalService !== false ? { request: async () => 'allowed-once' } : undefined),
  } as unknown as Context
  const manager = {
    get: (): { isAlive: () => boolean } | undefined => (options.hasWindow === true ? { isAlive: () => true } : undefined),
  }
  const deps = {
    manager,
    config: resolveConfig({ confirmFirstLaunch: options.confirmFirstLaunch ?? true }),
    consent,
  } as unknown as ToolDeps
  consentGate(ctx, deps)
  return {
    consent,
    call: async (toolName, downstream = { kind: 'allow' }) => {
      if (listener === undefined) throw new Error('gate 未注册到 tools/pre-execute')
      const sessionId = 'sessionId' in options ? options.sessionId : 'sess-0001'
      const agent = sessionId === undefined ? undefined : { session: { id: sessionId } }
      const exec = { name: toolName, ...agent !== undefined ? { agent } : {} } as unknown as ToolExecution
      return listener(exec, async () => downstream)
    },
  }
}

describe('chrome 首次启动的审批', () => {
  it('首次 chrome_open 询问用户', async () => {
    const gate = harness()
    const decision = await gate.call('chrome_open')
    expect(decision.kind).toBe('ask')
    expect(decision.kind === 'ask' ? decision.reason : '').toContain('首次')
  })

  it('审批文案里带的是能认出会话的标签, 不是 session- 前缀', async () => {
    const gate = harness({ sessionId: 'session-42' })
    const decision = await gate.call('chrome_open')
    const reason = decision.kind === 'ask' ? decision.reason ?? '' : ''
    expect(reason).toContain('会话 42')
    expect(reason).not.toContain('session-')
  })

  it('同意之后本会话不再询问', async () => {
    const gate = harness()
    expect((await gate.call('chrome_open')).kind).toBe('ask')
    gate.consent.grant('sess-0001') // 用户点了"允许一次", 工具体记录了同意
    expect((await gate.call('chrome_open')).kind).toBe('allow')
    expect((await gate.call('chrome_navigate')).kind).toBe('allow')
  })

  it('窗口已存在时任何工具都不问', async () => {
    const gate = harness({ hasWindow: true })
    expect((await gate.call('chrome_open')).kind).toBe('allow')
    expect((await gate.call('chrome_snapshot')).kind).toBe('allow')
  })

  it('询问覆盖会隐式开窗的工具, 不覆盖状态查询与关闭', async () => {
    const gate = harness()
    expect((await gate.call('chrome_navigate')).kind).toBe('ask')
    expect((await gate.call('chrome_screenshot')).kind).toBe('ask')
    expect((await gate.call('chrome_status')).kind).toBe('allow')
    expect((await gate.call('chrome_close')).kind).toBe('allow')
  })

  it('授权按会话隔离', async () => {
    const gate = harness()
    gate.consent.grant('other-session')
    expect((await gate.call('chrome_open')).kind).toBe('ask')
  })

  it('confirmFirstLaunch 关闭时完全不询问', async () => {
    const gate = harness({ confirmFirstLaunch: false })
    expect((await gate.call('chrome_open')).kind).toBe('allow')
  })

  it('没有会话的执行不进入审批流程', async () => {
    const gate = harness({ sessionId: undefined })
    expect((await gate.call('chrome_open')).kind).toBe('allow')
  })

  it('部署没有审批服务时放行而不是让调用失败', async () => {
    const gate = harness({ approvalService: false })
    expect((await gate.call('chrome_open')).kind).toBe('allow')
  })

  it('保留下游监听器的拒绝决定', async () => {
    const gate = harness()
    const decision = await gate.call('chrome_open', { kind: 'deny', reason: '被其他策略拒绝' })
    expect(decision).toEqual({ kind: 'deny', reason: '被其他策略拒绝' })
  })
})
