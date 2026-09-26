import { Context } from "@deepseek-ai/cordis";
//#region src/client/styles.d.ts
/** 面板文案（zh/en 字典，通过 locale 系统注入）。 */
declare const zh: {
  'tab.label': string;
  'state.running': string;
  'state.stopped': string;
  'state.streaming': string;
  'state.shots': string;
  'action.open': string;
  'action.close': string;
  'action.reload': string;
  'action.newTab': string;
  'action.select': string;
  'action.closeTab': string;
  'hint.empty': string;
  'hint.stream': string;
  'hint.shots': string;
  'hint.idle': string;
  'hint.busy': string;
  'err.action': string;
  'meta.started': string;
  'meta.lastUsed': string;
  'meta.tabs': string;
  'meta.shotCount': string;
  'config.extensions': string;
  'config.extensionsHint': string;
  'config.extensionsPlaceholder': string;
  'config.extraArgs': string;
  'config.extraArgsHint': string;
  'config.extraArgsPlaceholder': string;
  'config.add': string;
  'config.remove': string;
  'config.invalidRow': string;
  'config.save': string;
  'config.saving': string;
  'config.saveFailed': string;
  'config.unavailable': string;
  'config.readOnly': string;
  'config.appliesNextLaunch': string;
};
declare const en: {
  'tab.label': string;
  'state.running': string;
  'state.stopped': string;
  'state.streaming': string;
  'state.shots': string;
  'action.open': string;
  'action.close': string;
  'action.reload': string;
  'action.newTab': string;
  'action.select': string;
  'action.closeTab': string;
  'hint.empty': string;
  'hint.stream': string;
  'hint.shots': string;
  'hint.idle': string;
  'hint.busy': string;
  'err.action': string;
  'meta.started': string;
  'meta.lastUsed': string;
  'meta.tabs': string;
  'meta.shotCount': string;
  'config.extensions': string;
  'config.extensionsHint': string;
  'config.extensionsPlaceholder': string;
  'config.extraArgs': string;
  'config.extraArgsHint': string;
  'config.extraArgsPlaceholder': string;
  'config.add': string;
  'config.remove': string;
  'config.invalidRow': string;
  'config.save': string;
  'config.saving': string;
  'config.saveFailed': string;
  'config.unavailable': string;
  'config.readOnly': string;
  'config.appliesNextLaunch': string;
};
//#endregion
//#region src/client/index.d.ts
/** Dictionary key set for the plugin-chrome namespace. */
type PluginChromeKey = keyof typeof zh;
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugin-chrome': PluginChromeKey;
  }
}
/** Client services this plugin reads. */
declare const inject: string[];
/**
 * Client plugin entry: register the locale dictionaries, the Chrome tab, and
 * the launch-configuration card.
 * @param ctx - client plugin context (`slots`, `locale` injected).
 */
declare function apply(ctx: Context): void;
//#endregion
export { PluginChromeKey, apply, en, inject, zh };