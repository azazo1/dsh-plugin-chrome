window.__ModuleLoader__.load({
	id: "dsh-plugin-chrome",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/ChromeTab.tsx
		/**
		* Chrome 控制面板（conversation.view 会话 Tab）。
		*
		* 左侧实时画面（screencast WebSocket 帧 → canvas），右侧标签页列表，
		* 顶部控制条（打开/关闭/刷新/新建标签/截图）+「截图历史」子视图。
		* 状态以 5s 轮询兜底、WebSocket 事件即时刷新；所有写操作走同源
		* POST API，会话 id 来自槽位 kit 的 sessionId。
		*/
		/** Host endpoints (relative — same origin as the DSH GUI). */
		const API = {
			status: (sessionId) => `/dsh-chrome/api/status?sessionId=${encodeURIComponent(sessionId)}`,
			open: "/dsh-chrome/api/open",
			close: "/dsh-chrome/api/close",
			reload: "/dsh-chrome/api/reload",
			tabs: "/dsh-chrome/api/tabs",
			screenshot: "/dsh-chrome/api/screenshot-file",
			history: (sessionId) => `/dsh-chrome/api/screenshots?sessionId=${encodeURIComponent(sessionId)}`,
			ws: (sessionId) => {
				return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/dsh-chrome/ws?sessionId=${encodeURIComponent(sessionId)}`;
			}
		};
		/** POST a JSON control message; throws with the server's error text. */
		async function post(path, body) {
			const res = await fetch(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				let message = `HTTP ${res.status}`;
				try {
					const payload = await res.json();
					if (payload.error !== void 0) message = payload.error;
				} catch {}
				throw new Error(message);
			}
			return res.json();
		}
		/** Format an epoch-ms timestamp for the meta line. */
		function formatTime(epoch) {
			if (epoch === null || epoch === 0) return "—";
			return new Date(epoch).toLocaleTimeString();
		}
		/** Countdown label for the idle auto-close deadline. */
		function idleLabel(deadline, t) {
			if (deadline === null) return "";
			const seconds = Math.max(0, Math.round((deadline - Date.now()) / 1e3));
			const minutes = Math.floor(seconds / 60);
			const rest = seconds % 60;
			return ` · ${t("hint.idle")} ${minutes}:${String(rest).padStart(2, "0")}`;
		}
		/** The Chrome session tab. */
		function ChromeTab(props) {
			const { sessionId, t } = props;
			const [status, setStatus] = (0, react.useState)(null);
			const [shots, setShots] = (0, react.useState)([]);
			const [view, setView] = (0, react.useState)("live");
			const [enlarged, setEnlarged] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const canvasRef = (0, react.useRef)(null);
			const statusRef = (0, react.useRef)(null);
			statusRef.current = status;
			/** Poll status + history (WebSocket covers instant updates; this is the fallback). */
			const refresh = (0, react.useCallback)(async () => {
				try {
					const res = await fetch(API.status(String(sessionId)), { cache: "no-store" });
					if (!res.ok) throw new Error(String(res.status));
					setStatus(await res.json());
					const historyRes = await fetch(API.history(String(sessionId)), { cache: "no-store" });
					if (historyRes.ok) {
						const payload = await historyRes.json();
						setShots(payload.entries ?? []);
					}
					setError(null);
				} catch {}
			}, [sessionId]);
			(0, react.useEffect)(() => {
				refresh();
				const timer = setInterval(() => void refresh(), 5e3);
				return () => clearInterval(timer);
			}, [refresh]);
			/** Live stream: WebSocket welcome/status/event/frame handling. */
			(0, react.useEffect)(() => {
				let socket = null;
				let closed = false;
				const drawFrame = (data, width, height) => {
					const canvas = canvasRef.current;
					if (canvas === null || closed) return;
					const image = new Image();
					image.onload = () => {
						if (closed || canvasRef.current !== canvas) return;
						const scale = Math.min(1, (canvas.clientWidth || canvas.width) / Math.max(1, width));
						const targetWidth = Math.max(1, Math.round(width * scale));
						const targetHeight = Math.max(1, Math.round(height * scale));
						if (canvas.width !== targetWidth) canvas.width = targetWidth;
						if (canvas.height !== targetHeight) canvas.height = targetHeight;
						canvas.getContext("2d")?.drawImage(image, 0, 0, targetWidth, targetHeight);
					};
					image.src = `data:image/jpeg;base64,${data}`;
				};
				const connect = () => {
					if (closed) return;
					try {
						socket = new WebSocket(API.ws(String(sessionId)));
					} catch {
						return;
					}
					socket.onopen = () => {
						socket?.send(JSON.stringify({ type: "ping" }));
					};
					socket.onmessage = (event) => {
						let message;
						try {
							message = JSON.parse(String(event.data));
						} catch {
							return;
						}
						if (message.type === "welcome" || message.type === "status") setStatus(message.status);
						else if (message.type === "frame") drawFrame(message.data, message.width, message.height);
						else if (message.type === "event" && message.detail.kind === "screenshot") {
							const entry = message.detail.entry;
							setShots((current) => [entry, ...current].slice(0, 50));
						}
					};
					socket.onclose = () => {
						if (!closed) setTimeout(connect, 3e3);
					};
					socket.onerror = () => {};
				};
				connect();
				return () => {
					closed = true;
					socket?.close();
				};
			}, [sessionId]);
			/** Run one control action with busy feedback and error surfacing. */
			const runAction = (0, react.useCallback)(async (fn) => {
				setBusy(true);
				setError(null);
				try {
					await fn();
					await refresh();
				} catch (caught) {
					setError(`${t("err.action")}：${caught instanceof Error ? caught.message : String(caught)}`);
				} finally {
					setBusy(false);
				}
			}, [refresh, t]);
			const openWindow = (0, react.useCallback)(() => {
				runAction(() => post(API.open, { sessionId: String(sessionId) }));
			}, [runAction, sessionId]);
			const closeWindow = (0, react.useCallback)(() => {
				runAction(() => post(API.close, { sessionId: String(sessionId) }));
			}, [runAction, sessionId]);
			const reloadPage = (0, react.useCallback)(() => {
				runAction(() => post(API.reload, { sessionId: String(sessionId) }));
			}, [runAction, sessionId]);
			const newTab = (0, react.useCallback)(() => {
				runAction(() => post(API.tabs, {
					sessionId: String(sessionId),
					action: "new"
				}));
			}, [runAction, sessionId]);
			const selectTab = (0, react.useCallback)((index) => {
				runAction(() => post(API.tabs, {
					sessionId: String(sessionId),
					action: "select",
					index
				}));
			}, [runAction, sessionId]);
			const closeTab = (0, react.useCallback)((index) => {
				runAction(() => post(API.tabs, {
					sessionId: String(sessionId),
					action: "close",
					index
				}));
			}, [runAction, sessionId]);
			const running = status?.running === true;
			const streaming = status?.screencastActive === true;
			const currentShot = shots[0]?.name ?? null;
			const activeIndex = status?.pages.find((page) => page.selected)?.index ?? 0;
			const hint = (0, react.useMemo)(() => {
				if (!running) return t("hint.empty");
				return view === "live" ? t("hint.stream") : t("hint.shots");
			}, [
				running,
				view,
				t
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-chrome-tab",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-chrome-tab__bar",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-chrome-tab__state",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `dsh-chrome-tab__dot ${running ? "dsh-chrome-tab__dot--on" : "dsh-chrome-tab__dot--off"}` }),
									running ? t("state.running") : t("state.stopped"),
									busy ? ` · ${t("hint.busy")}` : ""
								]
							}),
							running ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: reloadPage,
									disabled: busy,
									children: t("action.reload")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: newTab,
									disabled: busy,
									children: t("action.newTab")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: closeWindow,
									disabled: busy,
									className: "dsh-chrome-tab__danger",
									children: t("action.close")
								})
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: openWindow,
								disabled: busy,
								className: "dsh-chrome-tab__primary",
								children: t("action.open")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => setView("live"),
								disabled: view === "live",
								children: t("state.streaming")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => setView("shots"),
								disabled: view === "shots",
								children: t("state.shots")
							})
						]
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-chrome-tab__error",
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-chrome-tab__hint",
						children: hint
					}),
					running && view === "live" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-chrome-tab__panel",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-chrome-tab__stage",
							children: [streaming && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-chrome-tab__badge",
								children: "LIVE"
							}), streaming ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
								ref: canvasRef,
								width: 640,
								height: 360,
								"aria-label": t("state.streaming")
							}) : currentShot !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: `${API.screenshot}?sessionId=${encodeURIComponent(String(sessionId))}&name=${encodeURIComponent(currentShot)}`,
								alt: "screenshot"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-chrome-tab__empty",
								children: "…"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-chrome-tab__tabs",
							children: (status?.pages ?? []).map((page) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-chrome-tab__row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									className: `dsh-chrome-tab__tab ${page.selected ? "dsh-chrome-tab__tab--active" : ""}`,
									onClick: () => selectTab(page.index),
									title: `${t("action.select")} [${page.index}] ${page.title || page.url || ""}`,
									children: [page.index === activeIndex ? "▶ " : "", page.title || page.url || `[${page.index}]`]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-chrome-tab__tab dsh-chrome-tab__tabClose",
									onClick: () => closeTab(page.index),
									title: `${t("action.closeTab")} [${page.index}]`,
									children: "✕"
								})]
							}, page.index))
						})]
					}),
					running && view === "shots" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-chrome-tab__shots",
						children: [shots.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-chrome-tab__hint",
							children: "—"
						}), shots.map((shot) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							className: "dsh-chrome-tab__shot",
							onClick: () => setEnlarged(shot.name),
							title: shot.url || shot.name,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: `${API.screenshot}?sessionId=${encodeURIComponent(String(sessionId))}&name=${encodeURIComponent(shot.name)}`,
								alt: shot.pageTitle || shot.name,
								loading: "lazy"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: shot.pageTitle || new Date(shot.createdAt).toLocaleString() })]
						}, shot.name))]
					}),
					enlarged !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-chrome-tab__stage",
						onClick: () => setEnlarged(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: `${API.screenshot}?sessionId=${encodeURIComponent(String(sessionId))}&name=${encodeURIComponent(enlarged)}`,
							alt: enlarged
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-chrome-tab__meta",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("meta.started"),
								" ",
								formatTime(status?.startedAt ?? null)
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("meta.lastUsed"),
								" ",
								formatTime(status?.lastUsedAt ?? null),
								idleLabel(status?.idleDeadline ?? null, t)
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("meta.tabs"),
								" ",
								status?.pages.length ?? 0
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("meta.shotCount"),
								" ",
								shots.length
							] })
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Chrome 面板样式（作为字符串内联注入, style[data-plugin] 可被 HMR 追踪）.
		*
		* 全部颜色只走 ui-theme 在 body / body[data-ds-dark-theme] 上定义的
		* --dsw-alias-* 语义 token, 明暗主题自动切换, 不写任何固定色值.
		* 注意 --dsw-alias-fill-* 系列在主题表中并未定义, 不要使用.
		*/
		const CHROME_TAB_CSS = `
.dsh-chrome-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  font-family: inherit;
  color: var(--dsw-alias-label-primary);
}
.dsh-chrome-tab__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dsh-chrome-tab__state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.dsh-chrome-tab__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}
.dsh-chrome-tab__dot--on {
  background: var(--dsw-alias-state-success-primary);
  box-shadow: 0 0 6px var(--dsw-alias-state-success-primary);
}
.dsh-chrome-tab__dot--off { background: var(--dsw-alias-label-tertiary); }
.dsh-chrome-tab button {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  padding: 5px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.dsh-chrome-tab button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-chrome-tab button:disabled { opacity: .45; cursor: default; }
.dsh-chrome-tab button.dsh-chrome-tab__primary {
  background: var(--dsw-alias-button-primary-fill);
  border-color: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dsh-chrome-tab button.dsh-chrome-tab__primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover);
  border-color: var(--dsw-alias-button-primary-hover);
  color: var(--dsw-alias-label-primary-foreground);
}
.dsh-chrome-tab button.dsh-chrome-tab__danger {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-chrome-tab button.dsh-chrome-tab__danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.dsh-chrome-tab__error {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  border: 1px solid var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
  font-size: 13px;
  white-space: pre-wrap;
}
.dsh-chrome-tab__hint {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  line-height: 1.6;
}
.dsh-chrome-tab__panel {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-height: 260px;
}
.dsh-chrome-tab__stage {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dsh-chrome-tab__stage canvas {
  display: block;
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
}
.dsh-chrome-tab__stage img {
  display: block;
  max-width: 100%;
  max-height: 420px;
  object-fit: contain;
}
.dsh-chrome-tab__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  text-align: center;
  padding: 16px;
}
.dsh-chrome-tab__badge {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.dsh-chrome-tab__tabs {
  flex: 0 1 240px;
  min-width: 120px;
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  padding: 4px;
}
/* 一行 = 标题按钮 + 关闭按钮. 标题必须 flex:1 1 auto 且 min-width:0,
   否则被同行的关闭按钮挤到 min-content, 一个字母一行. */
.dsh-chrome-tab__row {
  display: flex;
  align-items: stretch;
  gap: 2px;
}
.dsh-chrome-tab__tab {
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  display: block;
  text-align: left;
  border: none !important;
  background: transparent !important;
  color: var(--dsw-alias-label-secondary) !important;
  padding: 6px 8px !important;
  border-radius: 6px !important;
  font-size: 12px !important;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-chrome-tab__tab:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover) !important;
  color: var(--dsw-alias-label-primary) !important;
}
.dsh-chrome-tab__tab--active,
.dsh-chrome-tab__tab--active:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active) !important;
  color: var(--dsw-alias-label-primary) !important;
}
/* 关闭按钮必须固定宽度, 不能继承 .dsh-chrome-tab__tab 的宽度策略. */
.dsh-chrome-tab__tabClose {
  flex: 0 0 auto;
  width: auto;
  padding: 6px 8px !important;
  font-size: 11px !important;
  color: var(--dsw-alias-label-tertiary) !important;
}
.dsh-chrome-tab__tabClose:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger) !important;
  color: var(--dsw-alias-state-error-primary) !important;
}
.dsh-chrome-tab__shots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dsh-chrome-tab__shot {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  width: 120px;
  background: var(--dsw-alias-button-elevated-fill);
  padding: 0 !important;
}
.dsh-chrome-tab__shot:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-chrome-tab__shot img { width: 120px; height: 75px; object-fit: cover; display: block; }
.dsh-chrome-tab__shot div {
  font-size: 10px;
  padding: 3px 6px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-chrome-tab__meta {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
`;
		const CHROME_SETTINGS_CSS = `
.dsh-chrome-settings {
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: inherit;
  color: var(--dsw-alias-label-primary);
}
.dsh-chrome-settings__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-chrome-settings__intro {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  line-height: 1.6;
}
.dsh-chrome-settings__card {
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-layer-3);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 4px 16px;
}
.dsh-chrome-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
}
.dsh-chrome-settings__row + .dsh-chrome-settings__row {
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh-chrome-settings__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dsh-chrome-settings__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-chrome-settings__desc {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  line-height: 1.5;
}
.dsh-chrome-settings__control {
  flex: none;
  display: flex;
  align-items: center;
}
.dsh-chrome-settings__control input[type="text"],
.dsh-chrome-settings__control input[type="number"],
.dsh-chrome-settings__control select {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-family: inherit;
  min-width: 200px;
}
.dsh-chrome-settings__control input[type="number"] { min-width: 120px; }
.dsh-chrome-settings__control input:focus-visible,
.dsh-chrome-settings__control select:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-chrome-settings__control input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-brand-primary);
}
.dsh-chrome-settings__control input:disabled,
.dsh-chrome-settings__control select:disabled { opacity: .45; cursor: default; }
.dsh-chrome-settings__hint {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  line-height: 1.6;
}
@media (max-width: 640px) {
  .dsh-chrome-settings__row { flex-direction: column; align-items: stretch; }
  .dsh-chrome-settings__control input[type="text"],
  .dsh-chrome-settings__control input[type="number"],
  .dsh-chrome-settings__control select { width: 100%; min-width: 0; }
}
`;
		/** 面板文案（zh/en 字典，通过 locale 系统注入）。 */
		const zh = {
			"tab.label": "Chrome",
			"state.running": "窗口运行中",
			"state.stopped": "窗口未打开",
			"state.streaming": "实时画面",
			"state.shots": "截图历史",
			"action.open": "打开窗口",
			"action.close": "关闭窗口",
			"action.reload": "刷新页面",
			"action.newTab": "新建标签页",
			"action.select": "切换标签",
			"action.closeTab": "关闭标签",
			"hint.empty": "Chrome 窗口尚未打开。点击「打开窗口」，或让 Agent 使用 chrome_open 工具——窗口会以独立可视窗口出现，Agent 的每一步操作你都能实时看到。",
			"hint.stream": "实时画面来自 Chrome screencast（约数帧/秒）。你随时可以直接在 Chrome 窗口里手动操作，Agent 会在下一个工具调用时看到你的改动。",
			"hint.shots": "Agent 每次 chrome_screenshot 的产物都保存在这里（含标题/URL/尺寸，重启后仍在），点击缩略图放大查看。",
			"hint.idle": "空闲自动关闭",
			"hint.busy": "操作中…",
			"err.action": "操作失败",
			"meta.started": "启动于",
			"meta.lastUsed": "最近活动",
			"meta.tabs": "标签页",
			"meta.shotCount": "截图"
		};
		const en = {
			"tab.label": "Chrome",
			"state.running": "Window running",
			"state.stopped": "Window closed",
			"state.streaming": "Live view",
			"state.shots": "Screenshots",
			"action.open": "Open window",
			"action.close": "Close window",
			"action.reload": "Reload page",
			"action.newTab": "New tab",
			"action.select": "Switch tab",
			"action.closeTab": "Close tab",
			"hint.empty": "The Chrome window is not open yet. Click \"Open window\" or let the agent call the chrome_open tool — the window appears as a separate visible browser and you can watch every agent action live.",
			"hint.stream": "The live view streams from Chrome screencast (a few frames per second). You can operate the window yourself at any time; the agent sees your changes on its next tool call.",
			"hint.shots": "Every chrome_screenshot the agent takes is kept here (title/URL/size metadata survives restarts). Click a thumbnail to enlarge.",
			"hint.idle": "auto-close when idle",
			"hint.busy": "working…",
			"err.action": "action failed",
			"meta.started": "started",
			"meta.lastUsed": "last activity",
			"meta.tabs": "tabs",
			"meta.shotCount": "screenshots"
		};
		//#endregion
		//#region src/client/settings-i18n.ts
		/** Chinese copy for the settings page. */
		const settingsZh = {
			"settings.title": "Chrome 浏览器",
			"settings.intro": "浏览器窗口与 Jev 委托的配置. 修改即保存并即时生效 (窗口形态字段在下次开窗时生效).",
			"settings.jevEnabled.label": "启用 Jev 委托",
			"settings.jevEnabled.desc": "注册 chrome_jev_run / chrome_jev_wait 工具: 把机械点击流程交给廉价的 Jev 模型批量执行",
			"settings.jevProvider.label": "Jev 提供方",
			"settings.jevProvider.desc": "typesafe = TypeSafe 官方端点; openrouter = OpenRouter Decisions 端点",
			"settings.jevModel.label": "Jev 模型",
			"settings.jevModel.desc": "模型标识, 留空使用提供方默认 (jev-latest)",
			"settings.jevEnvFile.label": "凭据文件路径",
			"settings.jevEnvFile.desc": "存放 TYPESAFE_API_KEY / OPENROUTER_API_KEY 的本地 dotenv 文件绝对路径; 密钥不进配置和聊天",
			"settings.headless.label": "无头模式",
			"settings.headless.desc": "不显示窗口 (可视化面板将失去实时画面); 下次开窗生效",
			"settings.idleTimeoutMs.label": "空闲自动关闭 (ms)",
			"settings.idleTimeoutMs.desc": "窗口空闲该时长后自动关闭, 0 = 不自动关闭",
			"settings.maxSnapshotText.label": "快照字符上限",
			"settings.maxSnapshotText.desc": "单次 chrome_snapshot 返回给模型的最大字符数",
			"settings.maxTabs.label": "标签页上限",
			"settings.maxTabs.desc": "每个会话窗口可打开的最大标签页数",
			"settings.confirmFirstLaunch.label": "首次开窗询问",
			"settings.confirmFirstLaunch.desc": "每个会话第一次启动浏览器窗口前向用户请求一次审批",
			"settings.hint": "未填写的字段沿用 profile 配置 (cordis.patch.yml) 中的值; Jev 的 API key 只放在凭据文件里, 不要粘贴到任何配置或聊天中."
		};
		/** English copy for the settings page. */
		const settingsEn = {
			"settings.title": "Chrome browser",
			"settings.intro": "Browser window and Jev delegation settings. Changes save and apply immediately (window-shape fields apply on the next launch).",
			"settings.jevEnabled.label": "Enable Jev delegation",
			"settings.jevEnabled.desc": "Register chrome_jev_run / chrome_jev_wait: hand mechanical click flows to the cheap Jev model",
			"settings.jevProvider.label": "Jev provider",
			"settings.jevProvider.desc": "typesafe = the official TypeSafe endpoint; openrouter = the OpenRouter Decisions endpoint",
			"settings.jevModel.label": "Jev model",
			"settings.jevModel.desc": "Model identifier; empty uses the provider default (jev-latest)",
			"settings.jevEnvFile.label": "Credential file path",
			"settings.jevEnvFile.desc": "Absolute path of the local dotenv file holding TYPESAFE_API_KEY / OPENROUTER_API_KEY; keys never go into config or chat",
			"settings.headless.label": "Headless mode",
			"settings.headless.desc": "Run without a visible window (the live panel shows nothing); applies on the next launch",
			"settings.idleTimeoutMs.label": "Idle auto-close (ms)",
			"settings.idleTimeoutMs.desc": "Close the window after this much idle time; 0 disables auto-close",
			"settings.maxSnapshotText.label": "Snapshot char limit",
			"settings.maxSnapshotText.desc": "Maximum characters one chrome_snapshot returns to the model",
			"settings.maxTabs.label": "Tab limit",
			"settings.maxTabs.desc": "Maximum tabs one session window may open",
			"settings.confirmFirstLaunch.label": "Ask before first launch",
			"settings.confirmFirstLaunch.desc": "Ask the user once before a session starts its first browser window",
			"settings.hint": "Unset fields inherit the profile config (cordis.patch.yml). The Jev API key lives only in the credential file — never paste it into any config or chat."
		};
		//#endregion
		//#region src/shared/settings-contract.ts
		/**
		* Shared settings contract between the host and client halves: the
		* settings namespace, its field names, defaults, and the wire shape.
		*
		* The settings namespace carries the user-facing knobs (Jev delegation and
		* window behavior); the profile's cordis.patch.yml plugin `config` stays the
		* deployment-level layer and acts as the fallback when a settings field was
		* never written. Pure types and JSON-safe constants only — imported by both
		* build faces.
		*/
		/** Settings namespace registered on the host's `settings` service. */
		const SETTINGS_NAMESPACE = "dsh-plugin-chrome";
		/** Settings field names (single source of truth for host and client). */
		const SETTINGS_FIELDS = {
			jevEnabled: "jevEnabled",
			jevProvider: "jevProvider",
			jevModel: "jevModel",
			jevEnvFile: "jevEnvFile",
			headless: "headless",
			idleTimeoutMs: "idleTimeoutMs",
			maxSnapshotText: "maxSnapshotText",
			maxTabs: "maxTabs",
			confirmFirstLaunch: "confirmFirstLaunch"
		};
		/** Jev providers the settings page offers. */
		const JEV_PROVIDERS = ["typesafe", "openrouter"];
		/** Decode an unknown wire section into {@link ChromeSettings}. */
		function decodeChromeSettings(section) {
			if (typeof section !== "object" || section === null) return {};
			const raw = section;
			const decoded = {};
			if (typeof raw.jevEnabled === "boolean") decoded.jevEnabled = raw.jevEnabled;
			if (raw.jevProvider === "typesafe" || raw.jevProvider === "openrouter") decoded.jevProvider = raw.jevProvider;
			if (typeof raw.jevModel === "string") decoded.jevModel = raw.jevModel;
			if (typeof raw.jevEnvFile === "string") decoded.jevEnvFile = raw.jevEnvFile;
			if (typeof raw.headless === "boolean") decoded.headless = raw.headless;
			if (typeof raw.idleTimeoutMs === "number" && Number.isFinite(raw.idleTimeoutMs)) decoded.idleTimeoutMs = raw.idleTimeoutMs;
			if (typeof raw.maxSnapshotText === "number" && Number.isFinite(raw.maxSnapshotText)) decoded.maxSnapshotText = raw.maxSnapshotText;
			if (typeof raw.maxTabs === "number" && Number.isFinite(raw.maxTabs)) decoded.maxTabs = raw.maxTabs;
			if (typeof raw.confirmFirstLaunch === "boolean") decoded.confirmFirstLaunch = raw.confirmFirstLaunch;
			return decoded;
		}
		//#endregion
		//#region src/client/SettingsPage.tsx
		/**
		* The plugin's settings page, rendered inside the DSH settings panel as a
		* `settings.section` entry.
		*
		* All values flow through the bound settings scope: the snapshot drives the
		* form, `scope.set` persists field writes, and the Host merges them over the
		* profile config live. Styling uses only DSH theme tokens.
		*/
		/** Read one field off the latest scope snapshot. */
		function useField(scope, field) {
			return (0, react.useSyncExternalStore)((onChange) => scope.subscribe(onChange), () => (scope.getSnapshot().value ?? {})[field]);
		}
		/** One labeled settings row (label + control + description). */
		function Row(props) {
			return (0, react.createElement)("div", { className: "dsh-chrome-settings__row" }, (0, react.createElement)("div", { className: "dsh-chrome-settings__text" }, (0, react.createElement)("div", { className: "dsh-chrome-settings__label" }, props.label), (0, react.createElement)("div", { className: "dsh-chrome-settings__desc" }, props.description)), (0, react.createElement)("div", { className: "dsh-chrome-settings__control" }, props.children));
		}
		/** The settings page. */
		function SettingsPage(props) {
			const { scope, t } = props;
			const writable = scope.getSnapshot().writable;
			const jevEnabled = useField(scope, "jevEnabled");
			const jevProvider = useField(scope, "jevProvider");
			const jevModel = useField(scope, "jevModel");
			const jevEnvFile = useField(scope, "jevEnvFile");
			const headless = useField(scope, "headless");
			const idleTimeoutMs = useField(scope, "idleTimeoutMs");
			const maxSnapshotText = useField(scope, "maxSnapshotText");
			const maxTabs = useField(scope, "maxTabs");
			const confirmFirstLaunch = useField(scope, "confirmFirstLaunch");
			return (0, react.createElement)("section", { className: "dsh-chrome-settings" }, (0, react.createElement)("h2", { className: "dsh-chrome-settings__title" }, t("settings.title")), (0, react.createElement)("p", { className: "dsh-chrome-settings__intro" }, t("settings.intro")), (0, react.createElement)("div", { className: "dsh-chrome-settings__card" }, (0, react.createElement)(Row, {
				label: t("settings.jevEnabled.label"),
				description: t("settings.jevEnabled.desc")
			}, (0, react.createElement)("input", {
				type: "checkbox",
				checked: jevEnabled === true,
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.jevEnabled, event.currentTarget.checked);
				}
			})), (0, react.createElement)(Row, {
				label: t("settings.jevProvider.label"),
				description: t("settings.jevProvider.desc")
			}, (0, react.createElement)("select", {
				value: jevProvider ?? "typesafe",
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.jevProvider, event.currentTarget.value);
				}
			}, JEV_PROVIDERS.map((provider) => (0, react.createElement)("option", {
				key: provider,
				value: provider
			}, provider)))), (0, react.createElement)(Row, {
				label: t("settings.jevModel.label"),
				description: t("settings.jevModel.desc")
			}, (0, react.createElement)("input", {
				type: "text",
				value: jevModel ?? "",
				placeholder: "jev-latest",
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.jevModel, event.currentTarget.value);
				}
			})), (0, react.createElement)(Row, {
				label: t("settings.jevEnvFile.label"),
				description: t("settings.jevEnvFile.desc")
			}, (0, react.createElement)("input", {
				type: "text",
				value: jevEnvFile ?? "",
				placeholder: "~/.dsh/data/dsh-plugin-chrome/jev-credentials.env",
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.jevEnvFile, event.currentTarget.value);
				}
			}))), (0, react.createElement)("div", { className: "dsh-chrome-settings__card" }, (0, react.createElement)(Row, {
				label: t("settings.headless.label"),
				description: t("settings.headless.desc")
			}, (0, react.createElement)("input", {
				type: "checkbox",
				checked: headless === true,
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.headless, event.currentTarget.checked);
				}
			})), (0, react.createElement)(Row, {
				label: t("settings.idleTimeoutMs.label"),
				description: t("settings.idleTimeoutMs.desc")
			}, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				value: idleTimeoutMs ?? 6e5,
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.idleTimeoutMs, Number(event.currentTarget.value));
				}
			})), (0, react.createElement)(Row, {
				label: t("settings.maxSnapshotText.label"),
				description: t("settings.maxSnapshotText.desc")
			}, (0, react.createElement)("input", {
				type: "number",
				min: 1e3,
				value: maxSnapshotText ?? 6e4,
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.maxSnapshotText, Number(event.currentTarget.value));
				}
			})), (0, react.createElement)(Row, {
				label: t("settings.maxTabs.label"),
				description: t("settings.maxTabs.desc")
			}, (0, react.createElement)("input", {
				type: "number",
				min: 1,
				value: maxTabs ?? 16,
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.maxTabs, Number(event.currentTarget.value));
				}
			})), (0, react.createElement)(Row, {
				label: t("settings.confirmFirstLaunch.label"),
				description: t("settings.confirmFirstLaunch.desc")
			}, (0, react.createElement)("input", {
				type: "checkbox",
				checked: confirmFirstLaunch !== false,
				disabled: !writable,
				onChange: (event) => {
					scope.set(SETTINGS_FIELDS.confirmFirstLaunch, event.currentTarget.checked);
				}
			}))), (0, react.createElement)("p", { className: "dsh-chrome-settings__hint" }, t("settings.hint")));
		}
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace owned by this plugin. */
		const NS = "plugin-chrome";
		/** Client services this plugin reads. */
		const inject = [
			"slots",
			"locale",
			"settingsScope"
		];
		/** Inject the stylesheets once per plugin fiber (removed on unload). */
		function injectStyles() {
			const sheets = [["dsh-plugin-chrome/styles", CHROME_TAB_CSS], ["dsh-plugin-chrome/settings-styles", CHROME_SETTINGS_CSS]];
			const added = [];
			for (const [tagId, css] of sheets) {
				if (typeof document === "undefined" || document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) continue;
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-plugin-chrome";
				tag.dataset.pluginCss = tagId;
				tag.textContent = css;
				document.head.appendChild(tag);
				added.push(tag);
			}
			return () => {
				for (const tag of added) tag.remove();
			};
		}
		/**
		* Client plugin entry: register the locale dictionaries, the Chrome tab,
		* and the settings page.
		* @param ctx - client plugin context (`slots`, `locale`, `settingsScope`
		*   injected).
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh: {
					...zh,
					...settingsZh
				},
				en: {
					...en,
					...settingsEn
				}
			}), "dsh-plugin-chrome: dictionaries");
			ctx.effect(() => injectStyles(), "dsh-plugin-chrome: styles");
			const scope = ctx.settingsScope.bind({
				namespace: SETTINGS_NAMESPACE,
				decode: decodeChromeSettings
			});
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "chrome-hub",
				order: 40,
				label: () => t("tab.label")
			}, (props) => ChromeTab({
				...props,
				t
			})));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-plugin-chrome",
				order: 60,
				label: () => t("settings.title")
			}, () => SettingsPage({
				scope,
				t
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.en = en;
		exports.inject = inject;
		exports.settingsEn = settingsEn;
		exports.settingsZh = settingsZh;
		exports.zh = zh;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map