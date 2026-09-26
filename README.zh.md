# dsh-plugin-chrome

> DeepSeek Harness 浏览器可视化插件：为每个会话打开一个**真实可见的 Chrome 窗口**，Agent 通过 `chrome_*` 工具集操作浏览器，你在 Web GUI 的「Chrome」标签页里**实时观看画面流**，随时可以手动接管。

| | |
|---|---|
| ![browsing](assets/screenshot-1-bing.jpg) | ![douyin](assets/screenshot-2-douyin.jpg) |

[![GitHub stars](https://img.shields.io/github/stars/azazo1/dsh-plugin-chrome?style=flat-square)](https://github.com/azazo1/dsh-plugin-chrome/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[English](README.md)

## 目录

- [特性](#特性)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [常见问题](#常见问题)
- [开发](#开发)
- [License](#license)

## 特性

- **独立可见窗口**：每个 DSH 会话拥有一个独立 Chrome 窗口（真实窗口、非 headless），用户在旁边就能看到 Agent 的每一步操作；窗口使用隔离的 user-data-dir，与你的日常浏览器互不干扰。
- **实时画面流**：Web GUI「Chrome」标签页通过 Chrome screencast 实时显示页面画面（页面活跃时秒级流畅）；页面静止时由心跳兜底强制截帧（约 2 秒一帧：3 秒无真实帧即触发），画面不会冻结。
- **完整的 Agent 工具集**（16 个工具）：`chrome_open` / `chrome_status` / `chrome_close` / `chrome_navigate` / `chrome_tabs` / `chrome_snapshot` / `chrome_screenshot` / `chrome_click` / `chrome_click_at` / `chrome_fill` / `chrome_type` / `chrome_press_key` / `chrome_hover` / `chrome_scroll` / `chrome_evaluate` / `chrome_wait`。其中 `chrome_tabs` 支持 list / new / close / select；快照、截图与点击始终作用于「当前选中」的标签页。
- **工具卡片会说人话**: 参数不直观的工具 (`chrome_evaluate` 的脚本, `chrome_click_at` 的坐标, `chrome_type` 的按键输入) 额外要求一个必填的 `description` 参数; Web GUI 的工具卡片摘要取参数里的第一个字符串, 于是显示的是「读取商品列表」「点击登录按钮」这类话, 脚本和坐标退到卡片的展开详情里. 16 个工具另外都通过 `presentCall` 声明了自己的卡片意图 (标题与关键参数), 供会渲染它的 DSH 界面使用.
- **无障碍树快照**：`chrome_snapshot` 输出紧凑的 a11y 树 + 稳定元素 uid，点击/填充直接按 uid 定位，比裸 DOM 省 token、抗脆弱选择器。
- **截图双通道**：`chrome_screenshot` 的图片既进模型上下文（图片块），也保存到会话截图目录并展示在面板里；历史记录带标题/URL/尺寸元数据，重启后仍在。（会话用纯文本模型？请看常见问题。）
- **安全设计**：CDP 不暴露固定端口；Web API 拒绝跨站请求（Sec-Fetch-Site）+ sessionId 白名单校验；浏览器数据按会话隔离。
- **首次启动先经你同意**: 每个会话第一次启动浏览器窗口前会弹一次审批 (走 DSH 原生审批通道, 在 Web GUI 里点「允许一次」), 同意之后该会话内所有 `chrome_*` 调用都不再询问; 拒绝则不启动浏览器, 下次调用会再问一次. 审批弹窗里的理由就是模型写的 `chrome_open.justification` 原文 (该参数必填), 弹窗不会出现插件写死的模板句子; 会隐式开窗的其他工具没带理由时直接失败并提示改用 `chrome_open`. 没有审批通道的部署 (纯 CLI / headless) 自动跳过这一步.
- **扩展与启动参数可配置**：`extensions` 收 `.crx` 文件或未打包目录（crx 解包进配置级缓存，扩展 ID 与原文件一致），`extraArgs` 收任意 Chrome 命令行参数；两者都能在 Web GUI 的插件配置卡片里改，改动即时生效且不打断已打开的窗口。
- **资源治理**：空闲自动关闭（默认 10 分钟，可配置），`chrome_close` 显式关闭，插件卸载/宿主退出时全部收尾。

## 安装

> 前置：已安装 DeepSeek Harness（DSH），本机装有 Chrome 或 Edge。

```sh
# 方式一：从 GitHub 安装（推荐）
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:azazo1/dsh-plugin-chrome

# 方式二：本地路径（开发调试）
npx -p @deepseek-ai/dsh dsh plugin --profile web add D:/harness/dsh-plugin-chrome
```

安装后**重启 DSH**，Web GUI 的会话顶部会出现「Chrome」标签页。

桌面端装进 `desktop` profile, 它由 Electron 应用独占管理: `dsh plugin` 会拒绝 `--profile desktop`, 所以要在应用内的插件管理器页面填同一个包名或本地目录, 装上后重启应用.

引擎版本线要求 `@deepseek-ai/dsh-*` 不低于 `0.1.7-rc.2`, 且仍在 `0.1.x` 上 (peerDependencies 与 devDependencies 都写作 `>=0.1.7-rc.2 <0.2.0`); 更早的引擎线装不上这个版本. web 与 desktop 跑的是同一套 Web 应用, 桌面端只是多起一个 Host 子进程并给 `<html>` 打上平台标记, 所以同一份包在两边通用, 不需要分别构建.

> 若你的 profile 的 `cordis.patch.yml` 里还留着早期本地开发时手动挂载的 `dsh-plugin-chrome` 行，请先删掉再走 CLI 安装，避免双挂载（两个 host 半、两个 Chrome 管理器）。

## 使用

### 给 Agent 用（工具）

安装后 Agent 自动获得 `chrome_*` 工具集。直接对 Agent 说：

> 打开 Chrome，访问 https://example.com，截个图，然后点页面里的「登录」按钮并填写用户名。

Agent 会：`chrome_open` → `chrome_navigate` → `chrome_screenshot`（看图）→ `chrome_snapshot`（拿 uid）→ `chrome_click` / `chrome_fill`。

### 给你看（可视化）

1. 打开会话顶部的「Chrome」标签页：
   - **实时画面**：Live 视图持续显示 Chrome 窗口画面。页面有活动时走 Chrome 原生 screencast 帧流（秒级流畅）；页面静止时由心跳兜底强制截帧（约 2 秒一帧），画面不会冻结。
   - **标签页管理**：右侧列表新建/切换/关闭标签页，与窗口同步。
   - **手动接管**：你随时可以在 Chrome 窗口里自己点几下——Agent 的下一次工具调用会看到你的改动。
2. **截图历史**：每次 `chrome_screenshot` 的产物都在「截图历史」里，点击缩略图放大。

### 窗口生命周期与容错

- **惰性启动**：首次调用任意 `chrome_*` 工具（或点击面板「打开窗口」）时才拉起 Chrome。单纯打开会话里的「Chrome」标签页**不会**启动浏览器，它只附着到已经存在的窗口。
- **接管遗留实例**：若 DSH 进程异常退出留下了孤儿 Chrome（profile 被锁），插件下次启动会通过 `DevToolsActivePort` 自动连接并接管该窗口（借鉴 chrome-devtools-mcp 的 autoConnect 机制），而不是报错。
- **空闲回收**：窗口空闲超过 `idleTimeoutMs`（默认 10 分钟）自动关闭；有 Web UI 观看实时画面时不回收。
- **无可用标签页时自动补页**：所有操作都会先确保存在一个可用的普通标签页，避免「窗口开着但全是 chrome:// 内部页」时的死锁。
- **首次启动的审批**: 任何会真正拉起浏览器的 `chrome_*` 调用 (包括隐式开窗的 `chrome_navigate` / `chrome_snapshot` 等) 在本会话内第一次执行前都会向用户请求一次审批; 同意后窗口启动, 该会话的授权被记住, 之后的调用直接通过. 窗口已经打开时不会询问 (复用窗口无需新授权). 授权只存在内存里, 按会话隔离, 宿主进程退出即失效; 用 `confirmFirstLaunch: false` 可整体关闭.
- **审批理由由模型给**: `chrome_open` 的 `justification` 是必填参数, 审批弹窗直接展示这句话, 所以弹在你面前的是"为什么这个会话需要浏览器"而不是一句插件模板. 会隐式开窗的其他工具 (如 `chrome_navigate`) 没带理由时不会弹审批, 而是返回错误并提示模型改用 `chrome_open` 重试——用户不会遇到一个说不清来意的开窗请求.

## 配置

在 profile 的 `cordis.patch.yml` 中覆盖插件行配置（整段 config 替换）：

```yaml
- id: dsh-plugin-chrome
  config:
    headless: false            # 保持 false：可见窗口是本插件的核心
    executablePath: ''         # 留空自动探测 Chrome/Edge；也可指定绝对路径
    idleTimeoutMs: 600000      # 空闲自动关闭（0=禁用）
    windowWidth: 1280
    windowHeight: 900
    screencastFrameSkip: 4     # 实时画面抽帧（1=最流畅）
    screencastQuality: 70      # JPEG 质量 1-100
    maxSnapshotText: 60000     # 单次快照最大字符数
    maxTabs: 16
    confirmFirstLaunch: true   # 会话首次启动浏览器窗口前弹一次审批（false=从不询问）
    extensions:                # 每项一个 .crx 文件或未打包扩展目录（可留空）
      - ~/ext/tool.crx
      - /abs/path/to/unpacked-extension
    extraArgs:                 # 每项一条完整的 Chrome 启动参数（可留空）
      - --lang=zh-CN
      - --proxy-server=http://127.0.0.1:7890
```

`extensions` 与 `extraArgs` 也可以在 Web GUI 里直接改：设置 → Plugins → `dsh-plugin-chrome` 卡片页的「扩展来源」「额外启动参数」两个列表。这两个字段是 volatile 的，保存不会重挂插件、也不会关掉已经打开的窗口，改动对之后打开（或重开）的窗口生效。

### 扩展

- 两种来源混用：`.crx` 文件与未打包扩展目录；都写绝对路径或 `~` 开头。目录来源原地使用，`.crx` 会解包一次到配置级缓存目录（所有会话共享，见下）后装入，因此同一个 crx 只在首次使用或文件变动时解包。
- **crx 是解包装入**：Chrome 命令行与 DevTools 协议都不能直接安装 `.crx`（`Extensions.loadUnpacked` 只收未打包目录，新版 Chrome 也限制了拖拽安装），所以插件自己解包，并把 CRX 头里的公钥写进 `manifest.json` 的 `key`，让扩展 ID 与签名版本一致（`chrome-extension://<id>/...` 与扩展自身按 ID 绑定的逻辑都照旧）。
- 由此带来两点差异：扩展在浏览器里显示为「未打包 / 开发模式」扩展，不会自动更新；如果扩展自己检查安装来源（例如 `management.getSelf().installType`）或校验签名，行为可能与商店版本不同。另外个别扩展会因为签名校验而拒绝在未打包状态下运行。
- 扩展自身的设置（扩展自己写在 `chrome.storage`、cookies、IndexedDB 里的内容）保存在**该会话 Chrome profile** 里，按扩展 ID 索引：同一个会话关窗再开，插件会重新装入扩展，而设置原样还在；不同会话之间不共享（每会话一个隔离 profile，见下）。也因此，换一个不同密钥签名的 crx 会得到新的扩展 ID，旧设置就读不到了。
- 来源无效（路径不存在、不是 crx 也不是带 `manifest.json` 的目录）会让开窗直接失败，并把所有问题一次列出来；不会静默跳过。`extraArgs` 里与插件自身不变量冲突的参数（`--user-data-dir`、`--headless`、`--remote-debugging-*`、`--disable-extensions`）同样会被拒绝并说明原因。

数据目录：会话浏览器配置与截图在 `~/.dsh/data/dsh-plugin-chrome/sessions/<sessionId>/`，crx 解包缓存（配置级、所有会话共享）在 `~/.dsh/data/dsh-plugin-chrome/extensions/`（均可用 `dataRoot` 覆盖）。

## 常见问题

- **点开 Chrome 标签页没画面**：窗口没在运行时面板就是这个样子——打开标签页本身不会启动 Chrome（避免无意间拉起浏览器），点面板里的「打开窗口」或让 Agent 调用一次 `chrome_open`。窗口运行后确认面板顶部状态点亮起；静止页面由心跳兜底刷新（约 2 秒一帧，3 秒无真实帧即触发），有内容变化时帧率自动提升。
- **第一次调用 `chrome_open` 弹出审批**: 这是本会话首次启动浏览器窗口的用户确认 (详见「窗口生命周期与容错」), 弹窗正文就是模型在 `justification` 里写的理由, 看完再决定点不点「允许一次」; 误点拒绝时窗口不会启动, 让 Agent 再调一次就会重新询问, 或者你自己点面板里的「打开窗口」. 如果 Agent 第一次走的是 `chrome_navigate` 这类隐式开窗的工具, 它会先收到一个"请改用 chrome_open 并给出理由"的错误, 属正常流程.
- **工具卡片摘要看不懂**: 卡片摘要取参数里的第一个字符串, 也就是模型写的 `justification` / `description` (展开卡片能看到脚本或坐标这类裸参数); 描述不理想时直接要求 Agent 把话说清楚即可.
- **Agent 报"未知元素 uid"**：页面已变化，让它重新 `chrome_snapshot`。
- **窗口被我自己关了**：面板状态会显示"窗口未打开"，下次任意 `chrome_*` 工具调用或点击「打开窗口」即可重启。
- **登录态问题**：每个会话的浏览器是独立 profile，登录态不复用日常浏览器；这是隔离设计，如需登录某网站请让 Agent 完成一次登录（session 期间保持）。
- **杀 DSH 后 Chrome 还开着**：孤儿窗口会在下次会话调用时被自动接管，或手动关闭即可；正常关闭 DSH（插件卸载）会连带关闭窗口。
- **截图后纯文本模型不再回复**：`chrome_screenshot` 会把图片作为图片块写入会话历史。如果当前会话的模型不支持图片输入，之后每一轮请求都会以 `UNSUPPORTED_CONTENT: does not accept image input` 被整体拒绝，会话不再响应，重试无效。请给会截图的会话使用支持视觉的模型，或避免在其中调用 `chrome_screenshot`。
- **扩展装了但看起来没生效**：先确认窗口是在改完配置之后打开（或重开）的，再在窗口里打开 `chrome://extensions` 看它是否在列表里、是否被浏览器拒绝（未打包扩展会显示为开发模式扩展）。crx 解包缓存是配置级的，改 crx 文件本身会在下一次开窗时自动重解包；把某项从配置里删掉，缓存目录也会在下一次开窗时清理。
- **在 GUI 里改这两项找不到位置**：设置 → Plugins → `dsh-plugin-chrome` 卡片，往下是「扩展来源」与「额外启动参数」两张列表；如果卡片页没有这段，说明当前 profile 没提供配置表单服务（此时仍可用 `cordis.patch.yml` 配置）。
- **安装被 pnpm strict-dep-builds 拦截**：在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 中加入 `dsh-plugin-chrome: true` 后重试安装。

## 开发

```shell
just install     # 本仓库统一使用 pnpm
just typecheck   # host + client 两个 program
just test        # vitest 单测
just test-e2e    # 真实 Chrome 端到端冒烟 (会弹出可见窗口)
just build       # lib/index.js + lib/index.d.ts (host), lib/client.js + lib/client.d.ts (client bundle)
just watch       # 开发时持续构建; client 变更经 HMR 热更, host 变更需重启 DSH
just verify      # 类型检查 + 构建 + 单测 + 打包内容预览
```

`justfile` 里每个 recipe 只是对应 `package.json` 脚本的转发, 想直接用 pnpm 也可以 (例如 `pnpm typecheck`)。

架构：host 半（cordis 插件）用 puppeteer-core 驱动本机 Chrome，注册 `chrome_*` 工具与 `/dsh-chrome/*` HTTP/WS API；client 半（浏览器 bundle）注册 `conversation.view` 的「Chrome」标签页，消费 API 与帧流。画面流 = Chrome 原生 screencast（活动页）+ 截图心跳（静止页兜底）。控制层借鉴 [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)（CDP 控制、a11y 快照+uid 反查、等待机制、autoConnect 接管）与 [mcp-chrome](https://github.com/hangwin/mcp-chrome)（截图压缩、CDP 坐标输入、会话引用计数）的成熟设计。

## License

MIT
