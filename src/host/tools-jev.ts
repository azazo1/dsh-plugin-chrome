/**
 * The Jev delegation tools: one call runs the whole decide/act loop on a
 * cheap model, so the main model spends no turn per click.
 *
 * Registration is gated on `config.jevEnabled` — the loop ships page
 * accessibility text to an external API, so the tools only exist when the
 * deployment opted in. Both tools carry the `chrome_` prefix, which routes
 * them through the plugin's first-launch consent gate; `justification` is a
 * required argument of `chrome_jev_run` so an implicit launch always has a
 * readable reason.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { JevSessionStore, JevAbortedError, run, waitForState } from './jev/engine.ts'
import { providerRoute } from './jev/providers.ts'
import { validateControl } from './jev/actions.ts'
import type { JevControl, JevCredentials, JevPolicy, JevRunResult } from './jev/types.ts'
import type { ResolvedConfig } from './config.ts'
import { effectiveConfig, type ToolDeps } from './tools.ts'
import { resolveTarget, sessionIdOf } from './tools.ts'

/**
 * Resolve which credentials the loop uses: an explicit `jevEnvFile` wins;
 * otherwise fall back to `<dataRoot>/jev-credentials.env` inside the
 * plugin's own data root (isolated per DSH home — a private/test instance
 * never touches the user's global ~/.config). The API key itself always
 * stays inside the referenced dotenv file.
 */
export async function resolveJevCredentials(config: ResolvedConfig): Promise<JevCredentials> {
  if (config.jevEnvFile.trim() !== '') {
    return { envFile: config.jevEnvFile, provider: config.jevProvider, model: config.jevModel }
  }
  const fallback = join(config.dataRoot, 'jev-credentials.env')
  return { envFile: fallback, provider: config.jevProvider, model: config.jevModel }
}

/** Normalize one allowlist entry into a URL origin (`example.com` works). */
function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin
  } catch {
    return `https://${origin}`.replace(/\/+$/u, '')
  }
}

/** Extract the caller's session id (shared error text with the base suite). */
function sessionOf(exec: ToolRunContext): string {
  return sessionIdOf(exec)
}

/** Map an engine abort onto the suite's shared cancellation message. */
async function withAbort<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof JevAbortedError) throw new Error('操作已取消。')
    throw error
  }
}

/** One rendered history row. */
function historyLine(index: number, entry: { choice: string; action: string; executed: boolean; confidence: number | null; reason?: string }): string {
  const mark = entry.executed ? '✓' : entry.reason !== undefined ? `✗ ${entry.reason}` : '·'
  const confidence = entry.confidence !== null ? ` (置信度 ${entry.confidence.toFixed(2)})` : ''
  return `  #${index} ${entry.action} ${mark}${confidence}`
}

/** Render one run outcome as model-facing Chinese text. */
export function formatJevRun(outcome: JevRunResult): string {
  const executed = outcome.history.filter((entry) => entry.executed).length
  const failed = outcome.history.filter((entry) => entry.reason === 'decision_error' || entry.reason === 'action_error').length
  const lines = [
    `Jev 循环结束: ${outcome.status}${outcome.handoff !== null ? ` (handoff: ${outcome.handoff})` : ''}`,
    `步骤 ${outcome.steps}, 动作执行 ${executed} 次${failed > 0 ? `, 失败 ${failed} 次` : ''}, 决策 API 耗时 ${(outcome.apiMs / 1000).toFixed(1)}s, 总耗时 ${(outcome.elapsedMs / 1000).toFixed(1)}s`,
  ]
  if (outcome.error !== undefined) lines.push(`错误: ${outcome.error}`)
  if (outcome.history.length > 0) {
    lines.push('轨迹:')
    outcome.history.forEach((entry, index) => lines.push(historyLine(index + 1, entry)))
  }
  if (outcome.status === 'needs_verification') {
    lines.push('Jev 报告目标已达成, 但这不构成验证: 请用 chrome_snapshot / chrome_screenshot 独立核验结果后再下结论。')
  } else {
    lines.push('Jev 未宣告完成: 请查看下方页面状态, 处理卡点后可用相同 goal 继续运行 (进度与历史已保留)。')
  }
  // 与上游一致: 状态原样返回, 不做截断 (上游同样只以 24000 字符为硬上限并直接报错).
  lines.push(`当前页面状态 (${outcome.state.length} 字符):`)
  lines.push(outcome.state)
  return lines.join('\n')
}

/** chrome_jev_run — one bounded decide/act loop. */
function jevRunTool(deps: ToolDeps): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'chrome_jev_run',
    description: '把一串机械浏览器操作 (点击/切换/滚动/安全按键/刷新) 委托给廉价的 Jev 决策模型: 一次调用内部循环 "读页面无障碍状态 → Jev 选择动作 → 浏览器执行", 最多 maxSteps 步, 不消耗主模型回合。适用: 仪表盘/设置页/报表等动作密集的重复操作; 不适用: 输入文本, 看图判断, 上传等 (那些请用 chrome_fill/chrome_screenshot 完成, 然后可再次调用本工具续跑)。goal 写出可判定的最终状态; allowedOrigins 是允许停留的 origin 白名单, 页面一旦越界立即终止; controls 指定显式动作 (点击按名称), policy 开启低风险动作自动发现。返回 needs_verification 表示 Jev 认为已完成但必须由你独立核验; low_confidence/blocked/no_progress 等状态表示需你接管处理后继续。跨调用保留执行历史 (reset=true 清空)。需要插件配置 jevEnabled=true 且已配置凭据。',
    parameters: {
      goal: {
        type: 'string',
        required: true,
        description: '本次机械流程的目标, 写出可从页面状态判定的最终结果, 例如 "打开 Settings 并展开 Notification preferences, 不修改任何设置"。',
      },
      justification: {
        type: 'string',
        required: true,
        description: '给用户看的一句话理由: 为什么需要 Jev 委托执行 (首次开窗审批弹窗会展示这句话)。',
      },
      allowedOrigins: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'origin 白名单, 如 ["https://example.com"]; 循环每步都强制复核, 越界立即终止。',
      },
      controls: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: '显式动作数组, 每项形如 {op:"click", name:"Settings"} / {op:"scroll", direction:"down", amount?:1-5, targetName?|point?:[x,y]} / {op:"press", key:"Enter"} / {op:"reload"}; 与 policy 至少提供一个。',
      },
      policy: {
        type: 'object',
        additionalProperties: true,
        description: '自动发现策略: {click?:true, scrollDirections?:["up","down"], scrollAmount?:1-5, keys?:["PageDown"], reload?:true, denyNames?:[] 拒绝名单, requireCodexNames?:[] 保留给主模型, allowNames?:[] 仅允许名单}; 名称支持 "/正则/" 字面量。',
      },
      maxSteps: { type: 'integer', description: '最多决策步数 1-30 (默认 12)' },
      maxMs: { type: 'integer', description: '总时间预算毫秒 ≤45000 (默认 45000)' },
      minConfidence: { type: 'number', description: '最低置信度 0.55-1 (默认 0.55), 低于即交还主模型' },
      reset: { type: 'boolean', description: 'true=清空本会话的 Jev 执行历史后再运行' },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Jev 委托: ${args.goal}`,
      rawInput: `origins: ${(args.allowedOrigins as string[] | undefined)?.join(', ') ?? ''}`,
    }),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: {
            type: 'string',
            required: true,
            enum: ['needs_verification', 'low_confidence', 'blocked', 'no_progress', 'loading_timeout', 'decision_error', 'action_error', 'budget', 'step_limit'],
            description: '循环结束状态',
          },
          executed: { type: 'integer', required: true, description: '已执行的动作数' },
          text: { type: 'string', required: true, description: '给模型的结果摘要 (含轨迹与页面状态)' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: async (args, exec) => {
      if (exec.signal.aborted) throw new Error('操作已取消。')
      const sessionId = sessionOf(exec)
      const { session } = await resolveTarget(deps, sessionId)
      const credentials = await resolveJevCredentials(effectiveConfig(deps))
      const controls = (args.controls ?? []) as unknown as JevControl[]
      for (const control of controls) {
        if (!validateControl(control)) throw new Error('controls 中存在不合法的动作 (press 仅允许 Enter/Escape/Tab/Shift+Tab/PageUp/PageDown/Home/End, scroll amount 为 1-5, click 需要非空 name)。')
      }
      const policy = (args.policy ?? undefined) as JevPolicy | undefined
      const origins = (args.allowedOrigins as string[]).map(normalizeOrigin)
      const prior = args.reset === true ? (deps.jevSessions.reset(sessionId), []) : deps.jevSessions.historyOf(sessionId)
      return session.run(async () => {
        const page = await session.selected()
        if (page === undefined) throw new Error('没有可用的标签页。')
        const outcome = await withAbort(() => run({
          tab: { page, entries: [] },
          credentials,
          signal: exec.signal,
        }, {
          goal: args.goal,
          controls,
          policy,
          allowedOrigins: origins,
          maxSteps: args.maxSteps,
          maxMs: args.maxMs,
          minConfidence: args.minConfidence,
        }, prior))
        const metrics = deps.jevSessions.commit(sessionId, outcome)
        void metrics
        return {
          status: outcome.status,
          executed: outcome.history.filter((entry) => entry.executed).length,
          text: formatJevRun(outcome),
        }
      })
    },
  })
}

/** chrome_jev_wait — bounded deterministic state wait (no decision calls). */
function jevWaitTool(deps: ToolDeps): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'chrome_jev_wait',
    description: '确定性等待页面状态: 轮询当前标签页的无障碍状态, 直到所有 includes 文本出现且 excludes 文本都不出现, 或超时。不消耗 Jev 决策调用, 适合放在 chrome_jev_run 之前等待加载, 或两次委托之间确认页面就绪。需要插件配置 jevEnabled=true。',
    parameters: {
      allowedOrigins: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'origin 白名单 (等待期间页面停留在这些 origin 内)。',
      },
      includes: {
        type: 'array',
        items: { type: 'string' },
        description: '等待全部出现的文本 (页面状态子串匹配)。',
      },
      excludes: {
        type: 'array',
        items: { type: 'string' },
        description: '等待全部消失的文本 (例如加载指示)。',
      },
      timeoutMs: { type: 'integer', description: '超时毫秒数 1-60000 (默认 45000)' },
    },
    presentCall: (args) => ({
      card: 'generic',
      title: (args.includes as string[] | undefined)?.length
        ? `等待页面出现: ${(args.includes as string[]).join(' & ')}`
        : '等待页面状态就绪',
    }),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matched: { type: 'boolean', required: true, description: '超时前条件是否满足' },
          text: { type: 'string', required: true, description: '给模型的结果说明 (含当前完整页面状态)' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: async (args, exec) => {
      if (exec.signal.aborted) throw new Error('操作已取消。')
      const sessionId = sessionOf(exec)
      const { session } = await resolveTarget(deps, sessionId)
      const origins = (args.allowedOrigins as string[]).map(normalizeOrigin)
      return session.run(async () => {
        const page = await session.selected()
        if (page === undefined) throw new Error('没有可用的标签页。')
        const outcome = await withAbort(() => waitForState(page, {
          allowedOrigins: origins,
          includes: (args.includes ?? []) as string[],
          excludes: (args.excludes ?? []) as string[],
          timeoutMs: args.timeoutMs,
        }, exec.signal))
        return {
          matched: outcome.status === 'matched',
          text: outcome.status === 'matched'
            ? `页面状态已满足 (${(outcome.elapsedMs / 1000).toFixed(1)}s)。当前状态 (${outcome.state.length} 字符):\n${outcome.state}`
            : `等待超时 (${((args.timeoutMs ?? 45000) / 1000).toFixed(0)}s), 条件未满足。当前状态 (${outcome.state.length} 字符):\n${outcome.state}`,
        }
      })
    },
  })
}

/** Register the Jev tools. Visibility follows the live settings toggle
 * (falling back to the profile config), checked on every model tool listing
 * and call through the registry's own evaluation. */
export function registerJevTools(ctx: Context, deps: ToolDeps): () => void {
  const runTool = jevRunTool(deps)
  const waitTool = jevWaitTool(deps)
  const registrations = new Map<ReturnType<typeof defineTool>, () => void>()
  const sync = (): void => {
    const enabled = deps.readSettings?.()?.jevEnabled ?? deps.config.jevEnabled
    if (enabled === true && registrations.size === 0) {
      registrations.set(runTool, ctx.tools.register(runTool))
      registrations.set(waitTool, ctx.tools.register(waitTool))
    } else if (enabled !== true && registrations.size > 0) {
      for (const dispose of registrations.values()) dispose()
      registrations.clear()
    }
  }
  sync()
  // Re-evaluate on any settings commit so the toggle takes effect live.
  const stopWatch = deps.readSettings === undefined ? () => {} : watchSettings(sync)
  return () => {
    stopWatch()
    for (const dispose of registrations.values()) dispose()
    registrations.clear()
  }
}

/**
 * Observe the settings scope for changes to `jevEnabled`. The host plugin
 * exposes the watcher through a per-plugin callback registered by index.ts.
 */
const settingsWatchers = new Set<() => void>()

/** Subscribe to settings commits (no-op when the settings service is absent). */
export function onSettingsCommit(callback: () => void): () => void {
  settingsWatchers.add(callback)
  return () => settingsWatchers.delete(callback)
}

/** Fire the watcher set from index.ts's settings registration. */
export function notifySettingsCommit(): void {
  for (const watcher of [...settingsWatchers]) watcher()
}

/** Watch settings commits and invoke `onChange` when one arrives. */
function watchSettings(onChange: () => void): () => void {
  return onSettingsCommit(onChange)
}

/** Exposed for tests/docs: provider default endpoints. */
export const JEV_ENDPOINTS = {
  typesafe: providerRoute('typesafe').endpoint,
  openrouter: providerRoute('openrouter').endpoint,
}

/** Shared store type re-export (wired by index.ts). */
export type { JevSessionStore }
