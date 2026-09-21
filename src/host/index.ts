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
import { Config, resolveConfig } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
import { resolveDataRoot } from './browser.ts'
import { LaunchConsent } from './consent.ts'
import { ChromeManager } from './manager.ts'
import { registerTools, type ToolDeps } from './tools.ts'
import { JevSessionStore } from './jev/engine.ts'
import { installApi } from './api.ts'

export const name = 'dsh-plugin-chrome'

/** Services required before this plugin mounts. */
export const inject = ['tools']

export { Config }
export type { ConfigShape }

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
    attachImage: async (data, mediaType) => {
      const attachments = ctx.get('attachments') as { saveImage(input: { data: Uint8Array; mediaType: typeof mediaType }): Promise<import('@deepseek-ai/dsh-attachment').ImageAttachmentRef> } | undefined
      if (attachments === undefined) throw new Error('attachment service unavailable')
      return attachments.saveImage({ data, mediaType })
    },
  }

  ctx.effect(() => registerTools(ctx, deps), 'dsh-plugin-chrome: tools')

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
