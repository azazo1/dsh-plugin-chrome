import { Context } from "@deepseek-ai/cordis";
import "react";
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
};
//#endregion
//#region src/client/settings-i18n.d.ts
/** Chinese copy for the settings page. */
declare const settingsZh: {
  readonly 'settings.title': "Chrome 浏览器";
  readonly 'settings.intro': "浏览器窗口与 Jev 委托的配置. 修改即保存并即时生效 (窗口形态字段在下次开窗时生效).";
  readonly 'settings.jevEnabled.label': "启用 Jev 委托";
  readonly 'settings.jevEnabled.desc': "注册 chrome_jev_run / chrome_jev_wait 工具: 把机械点击流程交给廉价的 Jev 模型批量执行";
  readonly 'settings.jevProvider.label': "Jev 提供方";
  readonly 'settings.jevProvider.desc': "typesafe = TypeSafe 官方端点; openrouter = OpenRouter Decisions 端点";
  readonly 'settings.jevModel.label': "Jev 模型";
  readonly 'settings.jevModel.desc': "模型标识, 留空使用提供方默认 (jev-latest)";
  readonly 'settings.jevEnvFile.label': "凭据文件路径";
  readonly 'settings.jevEnvFile.desc': "存放 TYPESAFE_API_KEY / OPENROUTER_API_KEY 的本地 dotenv 文件绝对路径; 密钥不进配置和聊天";
  readonly 'settings.headless.label': "无头模式";
  readonly 'settings.headless.desc': "不显示窗口 (可视化面板将失去实时画面); 下次开窗生效";
  readonly 'settings.idleTimeoutMs.label': "空闲自动关闭 (ms)";
  readonly 'settings.idleTimeoutMs.desc': "窗口空闲该时长后自动关闭, 0 = 不自动关闭";
  readonly 'settings.maxSnapshotText.label': "快照字符上限";
  readonly 'settings.maxSnapshotText.desc': "单次 chrome_snapshot 返回给模型的最大字符数";
  readonly 'settings.maxTabs.label': "标签页上限";
  readonly 'settings.maxTabs.desc': "每个会话窗口可打开的最大标签页数";
  readonly 'settings.confirmFirstLaunch.label': "首次开窗询问";
  readonly 'settings.confirmFirstLaunch.desc': "每个会话第一次启动浏览器窗口前向用户请求一次审批";
  readonly 'settings.hint': "未填写的字段沿用 profile 配置 (cordis.patch.yml) 中的值; Jev 的 API key 只放在凭据文件里, 不要粘贴到任何配置或聊天中.";
};
/** English copy for the settings page. */
declare const settingsEn: {
  readonly 'settings.title': "Chrome browser";
  readonly 'settings.intro': "Browser window and Jev delegation settings. Changes save and apply immediately (window-shape fields apply on the next launch).";
  readonly 'settings.jevEnabled.label': "Enable Jev delegation";
  readonly 'settings.jevEnabled.desc': "Register chrome_jev_run / chrome_jev_wait: hand mechanical click flows to the cheap Jev model";
  readonly 'settings.jevProvider.label': "Jev provider";
  readonly 'settings.jevProvider.desc': "typesafe = the official TypeSafe endpoint; openrouter = the OpenRouter Decisions endpoint";
  readonly 'settings.jevModel.label': "Jev model";
  readonly 'settings.jevModel.desc': "Model identifier; empty uses the provider default (jev-latest)";
  readonly 'settings.jevEnvFile.label': "Credential file path";
  readonly 'settings.jevEnvFile.desc': "Absolute path of the local dotenv file holding TYPESAFE_API_KEY / OPENROUTER_API_KEY; keys never go into config or chat";
  readonly 'settings.headless.label': "Headless mode";
  readonly 'settings.headless.desc': "Run without a visible window (the live panel shows nothing); applies on the next launch";
  readonly 'settings.idleTimeoutMs.label': "Idle auto-close (ms)";
  readonly 'settings.idleTimeoutMs.desc': "Close the window after this much idle time; 0 disables auto-close";
  readonly 'settings.maxSnapshotText.label': "Snapshot char limit";
  readonly 'settings.maxSnapshotText.desc': "Maximum characters one chrome_snapshot returns to the model";
  readonly 'settings.maxTabs.label': "Tab limit";
  readonly 'settings.maxTabs.desc': "Maximum tabs one session window may open";
  readonly 'settings.confirmFirstLaunch.label': "Ask before first launch";
  readonly 'settings.confirmFirstLaunch.desc': "Ask the user once before a session starts its first browser window";
  readonly 'settings.hint': "Unset fields inherit the profile config (cordis.patch.yml). The Jev API key lives only in the credential file — never paste it into any config or chat.";
};
//#endregion
//#region src/client/index.d.ts
/** Dictionary key set for the plugin-chrome namespace. */
type PluginChromeKey = keyof typeof zh | keyof typeof settingsZh;
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'plugin-chrome': PluginChromeKey;
  }
}
/** Client services this plugin reads. */
declare const inject: string[];
/**
 * Client plugin entry: register the locale dictionaries, the Chrome tab,
 * and the settings page.
 * @param ctx - client plugin context (`slots`, `locale`, `settingsScope`
 *   injected).
 */
declare function apply(ctx: Context): void;
//#endregion
export { PluginChromeKey, apply, en, inject, settingsEn, settingsZh, zh };