/**
 * Settings page copy, keyed through the plugin's locale namespace so both
 * the Chrome tab and the settings page share one registry.
 */
export type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** Chinese copy for the settings page. */
export const settingsZh = {
  'settings.title': 'Chrome 浏览器',
  'settings.intro': '浏览器窗口与 Jev 委托的配置. 修改即保存并即时生效 (窗口形态字段在下次开窗时生效).',
  'settings.jevEnabled.label': '启用 Jev 委托',
  'settings.jevEnabled.desc': '注册 chrome_jev_run / chrome_jev_wait 工具: 把机械点击流程交给廉价的 Jev 模型批量执行',
  'settings.jevProvider.label': 'Jev 提供方',
  'settings.jevProvider.desc': 'typesafe = TypeSafe 官方端点; openrouter = OpenRouter Decisions 端点',
  'settings.jevModel.label': 'Jev 模型',
  'settings.jevModel.desc': '模型标识, 留空使用提供方默认 (jev-latest)',
  'settings.jevEnvFile.label': '凭据文件路径',
  'settings.jevEnvFile.desc': '存放 TYPESAFE_API_KEY / OPENROUTER_API_KEY 的本地 dotenv 文件绝对路径; 密钥不进配置和聊天',
  'settings.headless.label': '无头模式',
  'settings.headless.desc': '不显示窗口 (可视化面板将失去实时画面); 下次开窗生效',
  'settings.idleTimeoutMs.label': '空闲自动关闭 (ms)',
  'settings.idleTimeoutMs.desc': '窗口空闲该时长后自动关闭, 0 = 不自动关闭',
  'settings.maxSnapshotText.label': '快照字符上限',
  'settings.maxSnapshotText.desc': '单次 chrome_snapshot 返回给模型的最大字符数',
  'settings.maxTabs.label': '标签页上限',
  'settings.maxTabs.desc': '每个会话窗口可打开的最大标签页数',
  'settings.confirmFirstLaunch.label': '首次开窗询问',
  'settings.confirmFirstLaunch.desc': '每个会话第一次启动浏览器窗口前向用户请求一次审批',
  'settings.hint': '未填写的字段沿用 profile 配置 (cordis.patch.yml) 中的值; Jev 的 API key 只放在凭据文件里, 不要粘贴到任何配置或聊天中.',
} as const

/** English copy for the settings page. */
export const settingsEn = {
  'settings.title': 'Chrome browser',
  'settings.intro': 'Browser window and Jev delegation settings. Changes save and apply immediately (window-shape fields apply on the next launch).',
  'settings.jevEnabled.label': 'Enable Jev delegation',
  'settings.jevEnabled.desc': 'Register chrome_jev_run / chrome_jev_wait: hand mechanical click flows to the cheap Jev model',
  'settings.jevProvider.label': 'Jev provider',
  'settings.jevProvider.desc': 'typesafe = the official TypeSafe endpoint; openrouter = the OpenRouter Decisions endpoint',
  'settings.jevModel.label': 'Jev model',
  'settings.jevModel.desc': 'Model identifier; empty uses the provider default (jev-latest)',
  'settings.jevEnvFile.label': 'Credential file path',
  'settings.jevEnvFile.desc': 'Absolute path of the local dotenv file holding TYPESAFE_API_KEY / OPENROUTER_API_KEY; keys never go into config or chat',
  'settings.headless.label': 'Headless mode',
  'settings.headless.desc': 'Run without a visible window (the live panel shows nothing); applies on the next launch',
  'settings.idleTimeoutMs.label': 'Idle auto-close (ms)',
  'settings.idleTimeoutMs.desc': 'Close the window after this much idle time; 0 disables auto-close',
  'settings.maxSnapshotText.label': 'Snapshot char limit',
  'settings.maxSnapshotText.desc': 'Maximum characters one chrome_snapshot returns to the model',
  'settings.maxTabs.label': 'Tab limit',
  'settings.maxTabs.desc': 'Maximum tabs one session window may open',
  'settings.confirmFirstLaunch.label': 'Ask before first launch',
  'settings.confirmFirstLaunch.desc': 'Ask the user once before a session starts its first browser window',
  'settings.hint': 'Unset fields inherit the profile config (cordis.patch.yml). The Jev API key lives only in the credential file — never paste it into any config or chat.',
} as const
