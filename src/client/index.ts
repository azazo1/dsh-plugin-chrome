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
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { ChromeTab } from './ChromeTab.tsx'
import { CHROME_TAB_CSS, CHROME_SETTINGS_CSS, zh, en } from './styles.ts'
import { settingsZh, settingsEn } from './settings-i18n.ts'
import { SettingsPage } from './SettingsPage.tsx'
import { SETTINGS_NAMESPACE } from '../shared/settings-contract.ts'
import { decodeChromeSettings } from '../shared/settings-contract.ts'

/** Locale namespace owned by this plugin. */
const NS = 'plugin-chrome'

/** Dictionary key set for the plugin-chrome namespace. */
export type PluginChromeKey = keyof typeof zh | keyof typeof settingsZh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugin-chrome': PluginChromeKey
  }
}

export { zh, en, settingsZh, settingsEn }

/** Client services this plugin reads. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Inject the stylesheets once per plugin fiber (removed on unload). */
function injectStyles(): () => void {
  const sheets: Array<[string, string]> = [
    ['dsh-plugin-chrome/styles', CHROME_TAB_CSS],
    ['dsh-plugin-chrome/settings-styles', CHROME_SETTINGS_CSS],
  ]
  const added: HTMLStyleElement[] = []
  for (const [tagId, css] of sheets) {
    if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) continue
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-plugin-chrome'
    tag.dataset.pluginCss = tagId
    tag.textContent = css
    document.head.appendChild(tag)
    added.push(tag)
  }
  return () => {
    for (const tag of added) tag.remove()
  }
}

/**
 * Client plugin entry: register the locale dictionaries, the Chrome tab,
 * and the settings page.
 * @param ctx - client plugin context (`slots`, `locale`, `settingsScope`
 *   injected).
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS) as unknown as Translate
  ctx.effect(() => ctx.locale.register(NS, { zh: { ...zh, ...settingsZh }, en: { ...en, ...settingsEn } }), 'dsh-plugin-chrome: dictionaries')
  ctx.effect(() => injectStyles(), 'dsh-plugin-chrome: styles')

  // Bind the settings namespace once; the Chrome tools' host half merges the
  // same namespace over the profile config, and the settings page edits it.
  const scope = ctx.settingsScope.bind({
    namespace: SETTINGS_NAMESPACE,
    decode: decodeChromeSettings,
  })

  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: 'chrome-hub',
      order: 40,
      label: () => t('tab.label'),
    }, (props) => ChromeTab({ ...props, t })))

  // The dedicated settings page (Settings panel → Chrome 浏览器).
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-plugin-chrome',
      order: 60,
      label: () => t('settings.title'),
    }, () => SettingsPage({ scope, t })))
}
