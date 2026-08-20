/**
 * dsh-plugin-chrome — client entry.
 *
 * Registers one session-scoped 'conversation.view' tab (「Chrome」): the
 * Web GUI surface that visualizes the session's browser window — live
 * screencast view, tab switcher, window controls, and the screenshot
 * history. Pure consumer of the host API; it never changes model input.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { ChromeTab } from './ChromeTab.tsx'
import { CHROME_TAB_CSS, zh, en } from './styles.ts'

/** Locale namespace owned by this plugin. */
const NS = 'plugin-chrome'

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

/** Inject the stylesheet once per plugin fiber (removed on unload). */
function injectStyles(): () => void {
  const tagId = 'dsh-plugin-chrome/styles'
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) {
    return () => {}
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-chrome'
  tag.dataset.pluginCss = tagId
  tag.textContent = CHROME_TAB_CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}

/**
 * Client plugin entry: register the locale dictionaries and the Chrome tab.
 * @param ctx - client plugin context (`slots`, `locale` injected).
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS) as unknown as Translate
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-chrome: dictionaries')
  ctx.effect(() => injectStyles(), 'dsh-plugin-chrome: styles')

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'chrome-hub',
      order: 40,
      label: () => t('tab.label'),
    }, (props) => ChromeTab({ ...props, t })))
}
