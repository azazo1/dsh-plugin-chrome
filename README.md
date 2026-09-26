# dsh-plugin-chrome

> A DeepSeek Harness browser visualization plugin: opens a **real, visible Chrome window** per session, lets the agent drive the browser through the `chrome_*` tool suite, and streams the **live view** into a Chrome tab in the Web GUI — take over manually at any time.

| | |
|---|---|
| ![browsing](assets/screenshot-1-bing.jpg) | ![douyin](assets/screenshot-2-douyin.jpg) |

[![GitHub stars](https://img.shields.io/github/stars/jiaererw/dsh-plugin-chrome?style=flat-square)](https://github.com/jiaererw/dsh-plugin-chrome/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[中文文档](README.zh.md)

## Contents

- [Features](#features)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Development](#development)
- [License](#license)

## Features

- **A visible window per session**: every DSH session gets its own Chrome window (a real window, not headless). Watch every agent action as it happens; the window uses an isolated user-data-dir, so it never mixes with your daily browser.
- **Live view**: the Chrome tab in the Web GUI streams the window through Chrome screencast (smooth while pages are active). A screenshot heartbeat keeps idle pages from freezing — a forced frame about every 2 seconds once the stream has been silent for 3 seconds.
- **Complete agent tool suite** (16 tools): `chrome_open` / `chrome_status` / `chrome_close` / `chrome_navigate` / `chrome_tabs` / `chrome_snapshot` / `chrome_screenshot` / `chrome_click` / `chrome_click_at` / `chrome_fill` / `chrome_type` / `chrome_press_key` / `chrome_hover` / `chrome_scroll` / `chrome_evaluate` / `chrome_wait`. `chrome_tabs` covers list / new / close / select, and snapshots, screenshots and clicks always act on the selected tab.
- **Tool cards in plain words**: the tools whose arguments explain nothing (`chrome_evaluate` scripts, `chrome_click_at` coordinates, `chrome_type` keystrokes) require a `description` argument; the Web GUI's card summary takes the first string argument, so it reads "read the product list" or "click the login button" while the raw script or coordinates stay in the expanded card. All 16 tools also declare their card intent (title and salient argument) through `presentCall` for whichever DSH surface renders it.
- **Accessibility-tree snapshots**: `chrome_snapshot` returns a compact a11y tree with stable element uids; clicks and fills target uids directly — far lighter than DOM dumps and robust against fragile selectors.
- **Dual-channel screenshots**: `chrome_screenshot` sends the image into the model context (as an image block) AND saves it to the session's screenshot history shown in the panel — history entries keep title/URL/size metadata across restarts. (Running a text-only model? See the FAQ.)
- **Security-minded**: CDP never exposes a fixed port; the Web API rejects cross-site requests (Sec-Fetch-Site) and whitelist-validates sessionId; browser data is isolated per session.
- **First launch asks you first**: each session's first browser launch goes through one approval prompt (the native DSH approval channel, answered in the Web GUI); once allowed, every later `chrome_*` call of that session runs without asking. The prompt's text is the model's own `chrome_open.justification` (a required argument), so you never read a canned sentence instead of a reason; another tool that would launch the browser implicitly without a reason fails and is told to retry through `chrome_open`. A rejection starts nothing and the next call asks again. Deployments without an approval channel (plain CLI / headless) skip the step.
- **Configurable extensions and launch flags**: `extensions` takes `.crx` files or unpacked directories (a crx is unpacked into a config-level cache and keeps its ID), `extraArgs` takes any Chrome command-line flag; both are editable in the Web GUI's plugin config card, take effect immediately, and never interrupt open windows.
- **Resource governance**: idle windows auto-close (default 10 min, configurable), `chrome_close` closes explicitly, and plugin unload / host shutdown closes every window it opened.

## Install

> Prerequisites: DeepSeek Harness (DSH) installed, and Chrome or Edge on the machine.

```sh
# Option 1: install from GitHub (recommended)
npx -p @deepseek-ai/dsh dsh plugin --profile web add github:jiaererw/dsh-plugin-chrome

# Option 2: local path (development)
npx -p @deepseek-ai/dsh dsh plugin --profile web add D:/harness/dsh-plugin-chrome
```

Restart DSH after installing — a **Chrome** tab appears at the top of every conversation.

Desktop uses the `desktop` profile, which the Electron application owns exclusively: `dsh plugin` refuses `--profile desktop`, so install the same package (or local directory) from the application's plugin-manager page and restart the app.

The engine line requires `@deepseek-ai/dsh-*` at `>=0.1.7-rc.2 <0.2.0` (peerDependencies and devDependencies alike); earlier engine lines cannot install this version. web and desktop run the same Web application — the desktop host only adds a Host child process and a platform marker on `<html>` — so one package works on both and needs no separate build.

> If your profile's `cordis.patch.yml` still carries an old manual mount line for `dsh-plugin-chrome` (from local development), remove it before installing through the CLI to avoid double-mounting.

## Usage

### For the agent (tools)

The agent gets the `chrome_*` suite automatically. Just ask it:

> Open Chrome, go to https://example.com, take a screenshot, then click the "Login" button and fill in the username.

The agent will: `chrome_open` → `chrome_navigate` → `chrome_screenshot` (sees the image) → `chrome_snapshot` (gets uids) → `chrome_click` / `chrome_fill`.

### For you (visualization)

1. Open the **Chrome** tab at the top of the conversation:
   - **Live view**: continuously shows the window. Native screencast frames flow while the page changes; a heartbeat fallback force-captures idle pages (about one frame every 2 seconds) so the picture never freezes.
   - **Tab management**: create, switch or close tabs from the side list, in sync with the real window.
   - **Manual takeover**: click around in the Chrome window yourself at any time — the agent sees your changes on its next tool call.
2. **Screenshot history**: every `chrome_screenshot` is stored in the panel; click a thumbnail to enlarge.

### Window lifecycle & resilience

- **Lazy start**: Chrome launches only on the first `chrome_*` call (or the panel's Open button). Merely opening the **Chrome** tab in a conversation does **not** start a browser — it attaches to a window that already exists.
- **Orphan adoption**: if DSH died and left a Chrome behind (profile locked), the plugin reconnects through `DevToolsActivePort` and takes the window over instead of failing (the same autoConnect idea as chrome-devtools-mcp).
- **Idle reaping**: a window idle past `idleTimeoutMs` (default 10 min) closes automatically — never while a Web UI viewer is watching.
- **Auto tab recovery**: every operation makes sure a usable tab exists, so a window full of `chrome://` internal pages never dead-ends.
- **Approval on first launch**: any `chrome_*` call that would really start the browser (including the implicit launch of `chrome_navigate` / `chrome_snapshot` and friends) asks the user once per session before it runs; after the grant the window starts, the session is remembered as consented, and later calls pass straight through. An already open window is reused without asking. The grant lives in memory only, is scoped to one session, and dies with the host process; set `confirmFirstLaunch: false` to switch the whole thing off.
- **The reason comes from the model**: `chrome_open.justification` is a required argument, and the approval prompt shows that sentence verbatim, so what you read is "why this session needs a browser" rather than plugin boilerplate. An implicit launcher that carries no reason does not prompt at all: it fails with an error telling the model to retry through `chrome_open`, so no launch request ever reaches you without a stated purpose.

## Configuration

Override the plugin row in the profile's `cordis.patch.yml` (config is replaced wholesale):

```yaml
- id: dsh-plugin-chrome
  config:
    headless: false            # keep false — a visible window is the point
    executablePath: ''         # empty auto-detects Chrome/Edge; or set an absolute path
    idleTimeoutMs: 600000      # idle auto-close (0 disables)
    windowWidth: 1280
    windowHeight: 900
    screencastFrameSkip: 4     # live-view frame decimation (1 = smoothest)
    screencastQuality: 70      # JPEG quality 1-100
    maxSnapshotText: 60000     # max chars per snapshot
    maxTabs: 16
    confirmFirstLaunch: true   # one approval prompt before a session's first launch (false = never ask)
    extensions:                # one .crx file or unpacked extension dir per entry (may be empty)
      - ~/ext/tool.crx
      - /abs/path/to/unpacked-extension
    extraArgs:                 # one whole Chrome flag per entry (may be empty)
      - --lang=en-US
      - --proxy-server=http://127.0.0.1:7890
```

`extensions` and `extraArgs` are editable in the Web GUI too: Settings → Plugins → the `dsh-plugin-chrome` card shows an "Extension sources" and an "Extra launch flags" list. Both fields are volatile: saving does not remount the plugin and does not close open windows — the change applies to windows opened (or reopened) afterwards.

### Extensions

- Sources mix freely: `.crx` files and unpacked extension directories, each written as an absolute path or with a leading `~`. A directory is used in place; a `.crx` is unpacked once into the config-level cache (shared by every session, see below) and then loaded, so one crx is unpacked only on first use or when the file changes.
- **A crx is loaded unpacked**: neither Chrome's command line nor the DevTools protocol can install a `.crx` (`Extensions.loadUnpacked` takes unpacked directories only, and recent Chrome restricts drag-and-drop installs), so the plugin unpacks it itself and writes the public key from the CRX header into the manifest's `key` field — the extension therefore keeps the ID it was signed for, and `chrome-extension://<id>/...` plus anything the extension binds to its own ID stays the same.
- Two consequences: the extension shows up as an unpacked / developer-mode extension and does not auto-update, and an extension that inspects its own install source (say `management.getSelf().installType`) or verifies its signature may behave differently from the store build — a few refuse to run unpacked at all.
- The extension's OWN settings (whatever it keeps in `chrome.storage`, cookies, IndexedDB) live in **that session's Chrome profile**, keyed by extension ID: close and reopen a window of the same session and the plugin installs the extension again while your settings are still there. Different sessions do not share them (one isolated profile per session, see below), and a crx signed with a different key yields a different extension ID, so the old settings are no longer found.
- An unusable source (missing path, neither a crx nor a directory with a `manifest.json`) fails the launch and lists every problem at once instead of silently dropping extensions. Flags in `extraArgs` that fight the plugin's own invariants (`--user-data-dir`, `--headless`, `--remote-debugging-*`, `--disable-extensions`) are refused with the reason.

Data directory: session browser profiles and screenshots live in `~/.dsh/data/dsh-plugin-chrome/sessions/<sessionId>/`, and the crx unpack cache (config-level, shared by every session) in `~/.dsh/data/dsh-plugin-chrome/extensions/` (both overridable with `dataRoot`).

## FAQ

- **The Chrome tab shows nothing**: that is how the panel looks while no window is running — opening the tab does not start Chrome on its own (so a glance at it never spawns a browser); click Open in the panel or let the agent call `chrome_open` once. Once the window runs, check the status dot at the top. Idle pages get a forced frame about every 2 seconds via the heartbeat (after 3 seconds without a real frame); activity raises the frame rate automatically.
- **The first `chrome_open` shows an approval prompt**: that is the user confirmation for this session's first browser launch (see "Window lifecycle & resilience"). The prompt body is the reason the model wrote in `justification`, so read it before clicking Allow once; if it was rejected by mistake, no window started, so let the agent call it again — or press Open in the panel yourself. If the agent's first call was an implicit launcher such as `chrome_navigate`, it gets an error telling it to retry through `chrome_open` with a reason — that is the normal flow.
- **A tool card summary looks unhelpful**: the summary takes the first string argument, i.e. the model's own `justification` / `description` (the raw script or coordinates live in the expanded card); just ask the agent to say what it is doing if the wording tells you nothing.
- **Agent says "unknown uid"**: the page changed — have it re-run `chrome_snapshot`.
- **I closed the window myself**: the panel shows "window closed"; any next `chrome_*` call or the Open button relaunches it.
- **Login state**: each session uses an isolated profile, so logins don't carry over from your daily browser — that's by design. To log in somewhere, let the agent complete the login (it persists for the session).
- **Chrome stays open after DSH is killed**: the orphan window is adopted on the next session call (or close it by hand); a clean DSH shutdown closes its windows.
- **Screenshots stop a text-only model from responding**: `chrome_screenshot` delivers the picture as an image block into the conversation history. If the session's model does not accept images, every following turn is rejected with `UNSUPPORTED_CONTENT: does not accept image input` and the session no longer responds — retrying doesn't help. Use a vision-capable model for sessions that screenshot, or avoid `chrome_screenshot` there.
- **An extension seems to have no effect**: first make sure the window was opened (or reopened) after the config change, then check `chrome://extensions` inside that window to see whether the extension is listed and whether the browser refused it (unpacked extensions are shown as developer-mode extensions). The unpack cache is config-level: editing the crx file itself re-unpacks it on the next launch, and removing an entry prunes its cache directory the same way.
- **Can't find where to edit these two settings in the GUI**: Settings → Plugins → the `dsh-plugin-chrome` card, below its description, shows the "Extension sources" and "Extra launch flags" lists. A card page without that section means the profile serves no configuration form — `cordis.patch.yml` still works in that case.
- **Install blocked by pnpm (strict-dep-builds)**: add `dsh-plugin-chrome: true` to `allowBuilds` in the profile's `pnpm-workspace.yaml` and retry the install.

## Development

```shell
just install     # this repo uses pnpm throughout
just typecheck   # host + client programs
just test        # vitest unit tests
just test-e2e    # real-Chrome end-to-end smoke (pops a visible window)
just build       # lib/index.js + lib/index.d.ts (host), lib/client.js + lib/client.d.ts (client bundle)
just watch       # continuous build; client changes hot-reload, host changes need a DSH restart
just verify      # typecheck + build + unit tests + package content preview
```

Every recipe in `justfile` just forwards to the matching `package.json` script, so plain pnpm works too (say `pnpm typecheck`).

Architecture: the host half (cordis plugin) drives the local Chrome through puppeteer-core, registers the `chrome_*` tools and the `/dsh-chrome/*` HTTP/WS API; the client half (browser bundle) registers the Chrome tab on `conversation.view` and consumes the API and the frame stream. The picture = native Chrome screencast (active pages) + screenshot heartbeat (idle fallback). The control layer borrows proven designs from [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) (CDP control, a11y snapshots with uid lookup, wait discipline, autoConnect adoption) and [mcp-chrome](https://github.com/hangwin/mcp-chrome) (screenshot compression, CDP coordinate input, session refcounting).

## License

MIT
