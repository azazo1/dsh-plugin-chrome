/**
 * dsh-plugin-chrome — client entry.
 *
 * Registers two surfaces:
 *   - one session-scoped 'conversation.view' tab (「Chrome」): the Web GUI
 *     surface that visualizes the session's browser window — live screencast
 *     view, tab switcher, window controls, and the screenshot history. Pure
 *     consumer of the host API; it never changes model input.
 *   - one 'plugins.bundle.config' card: the launch configuration (extension
 *     sources and extra Chrome flags) of this plugin's profile entry, kept
 *     live through the shared configuration form because both fields are
 *     volatile host-side.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// 类型引用: 引入 ctx.slots 的 Context merge (rc.2 起由 ui-renderer 提供).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 类型引用: 'plugins.bundle.config' 的 SlotMap merge 由插件管理器声明.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// 类型引用: ctx.configForms 的 Context merge 由 ui-settings 声明.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { ChromeTab, type ChromeTabProps } from './ChromeTab.tsx'
import { ChromeLaunchCard } from './config/ChromeLaunchCard.tsx'
import { ChromeLaunchCardController, type ChromeLaunchSettings } from './config/chrome-launch-form.ts'
import { CHROME_CONFIG_CSS } from './config/styles.ts'
import { CHROME_TAB_CSS, zh, en } from './styles.ts'

/** Locale namespace owned by this plugin. */
const NS = 'plugin-chrome'

/** This plugin's package name: the key of its `plugins.bundle.config` entry. */
const PACKAGE_NAME = 'dsh-plugin-chrome'

/**
 * This plugin's profile entry id (`cordis.patch.yml` insert row), which is
 * also the namespace its configuration form is addressed by.
 */
const ENTRY_ID = 'dsh-plugin-chrome'

/** Dictionary key set for the plugin-chrome namespace. */
export type PluginChromeKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugin-chrome': PluginChromeKey
  }
}

export { zh, en }

/** Client services this plugin reads. */
export const inject = ['slots', 'locale']

/** Inject one stylesheet tag per plugin fiber (both removed on unload). */
function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const tags: HTMLStyleElement[] = []
  for (const [id, css] of [['dsh-plugin-chrome/styles', CHROME_TAB_CSS], ['dsh-plugin-chrome/config-styles', CHROME_CONFIG_CSS]]) {
    if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) continue
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-plugin-chrome'
    tag.dataset.pluginCss = id
    tag.textContent = css
    document.head.appendChild(tag)
    tags.push(tag)
  }
  return () => {
    for (const tag of tags) tag.remove()
  }
}

/** Register the session Chrome tab (independent of the settings surface). */
function registerTab(ctx: Context, t: Translate): void {
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'chrome-hub',
      order: 40,
      label: () => t('tab.label'),
      locale: NS,
      // rc.2 起会话作用域的 inject 回调按会话调用并收到 sessionId, owner props 不再携带它.
      inject: (sessionId: string): ChromeTabProps => ({ t, sessionId }),
    }, ChromeTab))
}

/**
 * Register the launch-configuration card.
 *
 * Gated on the shared configuration form service and on the Host actually
 * serving this plugin's entry: a deployment without the settings surface (or
 * with the plugin mounted outside a profile) simply shows no card, and the
 * Chrome tab above is never affected.
 */
function registerConfigCard(ctx: Context): void {
  ctx.inject(['configForms'], (configCtx) => {
    configCtx.effect(() => configCtx.configForms.whileServed([ENTRY_ID], () => {
      const card = new ChromeLaunchCardController(configCtx.configForms.get<ChromeLaunchSettings>(ENTRY_ID))
      const unregister = configCtx.slots.inject('plugins.bundle.config', () =>
        configCtx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE_NAME,
          locale: NS,
          inject: () => card.inject(),
        }, ChromeLaunchCard))
      return () => {
        unregister()
        card.dispose()
      }
    }), 'dsh-plugin-chrome: launch config card')
  })
}

/**
 * Client plugin entry: register the locale dictionaries, the Chrome tab, and
 * the launch-configuration card.
 * @param ctx - client plugin context (`slots`, `locale` injected).
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS) as unknown as Translate
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-chrome: dictionaries')
  ctx.effect(() => injectStyles(), 'dsh-plugin-chrome: styles')

  registerTab(ctx, t)
  registerConfigCard(ctx)
}
