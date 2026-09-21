/**
 * dsh-plugin-chrome — host half.
 *
 * A pure cordis function plugin (no core changes): it registers the
 * chrome_* tool suite against `ctx.tools`, lazily mounts a Web GUI API
 * (status/control endpoints + live screencast WebSocket) on `webServer`,
 * and owns one visible Chrome window per agent session through
 * {@link ChromeManager}. Everything disposes with the plugin fiber —
 * unloading the plugin closes every Chrome window it opened.
 *
 * Model experience: the tools add browser control to the model tool belt;
 * screenshots reach the model as image blocks when the attachment service
 * is mounted, otherwise as saved file paths.
 * @module dsh-plugin-chrome
 */
import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { Config, resolveConfig } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
import { resolveDataRoot } from './browser.ts'
import { LaunchConsent } from './consent.ts'
import { ChromeManager } from './manager.ts'
import { registerTools, type ToolDeps } from './tools.ts'
import { JevSessionStore } from './jev/engine.ts'
import { notifySettingsCommit } from './tools-jev.ts'
import { installApi } from './api.ts'
import { SETTINGS_NAMESPACE } from '../shared/settings-contract.ts'

export const name = 'dsh-plugin-chrome'

/** Services required before this plugin mounts. */
export const inject = ['tools']

export { Config }
export type { ConfigShape }

/**
 * Settings-namespace schema for the Web GUI configuration page. Field names
 * and defaults mirror the profile-config subset in {@link Config} that users
 * actually tweak; the profile layer (cordis.patch.yml) stays the deployment
 * fallback and the settings user layer overrides it per field.
 */
const SettingsSchema = z.object({
  jevEnabled: z.boolean().default(false).description('启用 Jev 委托工具 (chrome_jev_run / chrome_jev_wait)'),
  jevProvider: z.union(['typesafe', 'openrouter']).default('typesafe').description('Jev 决策服务提供方'),
  jevModel: z.string().default('').description('Jev 模型名, 留空 = provider 默认 (jev-latest)'),
  jevEnvFile: z.string().default('').description('存放 TYPESAFE_API_KEY / OPENROUTER_API_KEY 的 dotenv 文件绝对路径'),
  headless: z.boolean().default(false).description('无头运行窗口 (下次启动生效)'),
  idleTimeoutMs: z.number().min(0).default(600000).description('空闲自动关闭毫秒数 (0 = 禁用)'),
  maxSnapshotText: z.number().min(1000).default(60000).description('单次快照最大字符数'),
  maxTabs: z.number().min(1).default(16).description('每个会话窗口的最大标签页数'),
  confirmFirstLaunch: z.boolean().default(true).description('会话首次启动浏览器窗口前询问用户'),
})

/** Register the settings namespace; the host tools read live values from it. */
let settingsScope: SettingsScope<unknown> | undefined

function registerSettings(ctx: Context, onCommit?: () => void): () => void {
  // The settings service is optional in bare surfaces (plain CLI): the
  // configuration page then degrades and the profile config stays in charge.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsScope = settingsCtx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), SettingsSchema)
    // Settings commits reach the tool layer through this watcher.
    settingsScope.watch(() => onCommit?.())
  })
  return () => {
    settingsScope = undefined
  }
}

/** Live settings read handed to the tool layer (undefined = no settings service). */
function readSettings(): Partial<ConfigShape> | undefined {
  return settingsScope?.get() as Partial<ConfigShape> | undefined
}

/**
 * Plugin entry: register tools, Web API, and the session-Chrome manager.
 * @param ctx - plugin context (`tools` injected; `webServer`/`attachments`
 *   are optional services probed lazily).
 * @param rawConfig - cordis loader config (schema defaults already applied).
 */
export function apply(ctx: Context, rawConfig: ConfigShape): void {
  const config = resolveConfig(rawConfig)
  const dataRoot = resolveDataRoot(config.dataRoot)
  const manager = new ChromeManager(config, dataRoot)
  // One consent record for the whole plugin instance: it holds the sessions
  // whose user already approved launching a window (see ./consent.ts).
  const consent = new LaunchConsent()
  // Jev loop progress per session (history + metrics); cleared on unload.
  const jevSessions = new JevSessionStore()

  // Optional attachment service (image blocks for the model). Probed per
  // call through ctx.get so tool registration never waits on a service
  // that headless surfaces do not mount.
  const deps: ToolDeps = {
    manager,
    config,
    consent,
    jevSessions,
    readSettings,
    attachImage: async (data, mediaType) => {
      const attachments = ctx.get('attachments') as { saveImage(input: { data: Uint8Array; mediaType: typeof mediaType }): Promise<import('@deepseek-ai/dsh-attachment').ImageAttachmentRef> } | undefined
      if (attachments === undefined) throw new Error('attachment service unavailable')
      return attachments.saveImage({ data, mediaType })
    },
  }

  ctx.effect(() => registerTools(ctx, deps), 'dsh-plugin-chrome: tools')

  // Web GUI settings namespace (the configuration page's storage). Values
  // written here override the profile config per field; the Jev tools
  // re-register live when the page's jevEnabled toggle flips.
  ctx.effect(() => registerSettings(ctx, () => notifySettingsCommit()), 'dsh-plugin-chrome: settings')

  // Web GUI API rides the optional webServer service: HTTP routes plus the
  // screencast WebSocket. The effect wrapper re-registers cleanly when the
  // service fiber replays.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => installApi(webCtx, manager), 'dsh-plugin-chrome: web api')
  })

  // Plugin teardown: stop the idle reaper, close every session window, and
  // drop the Jev loop memories.
  ctx.effect(() => () => {
    manager.dispose()
    void manager.closeAll()
    jevSessions.dispose()
  }, 'dsh-plugin-chrome: chrome manager')
}
