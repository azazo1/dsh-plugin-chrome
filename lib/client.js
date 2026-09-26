window.__ModuleLoader__.load({
	id: "dsh-plugin-chrome",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region src/client/ChromeTab.tsx
		/**
		* Chrome 控制面板（conversation.view 会话 Tab）。
		*
		* 左侧实时画面（screencast WebSocket 帧 → canvas），右侧标签页列表，
		* 顶部控制条（打开/关闭/刷新/新建标签/截图）+「截图历史」子视图。
		* 状态以 5s 轮询兜底、WebSocket 事件即时刷新；所有写操作走同源
		* POST API，会话 id 由会话作用域槽位的 inject 回调传入（rc.2 起 owner props 不再携带 sessionId）。
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
		//#region src/client/config/ChromeLaunchCard.tsx
		/** One editable string list. */
		function RowList(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-chrome-config__group",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						className: "dsh-chrome-config__label",
						children: props.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-chrome-config__hint",
						children: props.hint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dsh-chrome-config__rows",
						children: props.rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: "dsh-chrome-config__row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									value: row,
									placeholder: props.placeholder,
									disabled: props.disabled,
									"aria-label": `${props.title} ${index + 1}`,
									"aria-invalid": props.invalidRows[index] === true,
									onChange: (event) => {
										props.onEdit(index, event.target.value);
									}
								}),
								props.invalidRows[index] === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-chrome-config__invalid",
									role: "status",
									children: props.t("config.invalidRow")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: props.disabled,
									onClick: () => {
										props.onRemove(index);
									},
									children: props.t("config.remove")
								})
							]
						}, index))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						size: "sm",
						disabled: props.disabled,
						onClick: props.onAdd,
						children: props.t("config.add")
					})
				]
			});
		}
		/**
		* Render the launch-configuration card.
		* @param props - composed slot props: owner view, locale seat, and the controller's face.
		* @returns the card body, or null for the summary view this slot never uses.
		*/
		function ChromeLaunchCard(props) {
			if (props.view !== "page") return null;
			const t = props.t;
			const state = props.useChromeLaunch((snapshot) => snapshot);
			const labels = {
				unavailable: t("config.unavailable"),
				readOnly: t("config.readOnly"),
				saveFailed: t("config.saveFailed"),
				save: t("config.save"),
				saving: t("config.saving")
			};
			const lists = [{
				field: "extensions",
				title: t("config.extensions"),
				hint: t("config.extensionsHint"),
				placeholder: t("config.extensionsPlaceholder")
			}, {
				field: "extraArgs",
				title: t("config.extraArgs"),
				hint: t("config.extraArgsHint"),
				placeholder: t("config.extraArgsPlaceholder")
			}];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels,
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [lists.map((list) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RowList, {
					t,
					title: list.title,
					hint: list.hint,
					placeholder: list.placeholder,
					rows: list.field === "extensions" ? state.extensions : state.extraArgs,
					invalidRows: list.field === "extensions" ? state.extensionsInvalid : state.extraArgsInvalid,
					disabled: !state.writable,
					onEdit: (index, value) => {
						props.editRow(list.field, index, value);
					},
					onRemove: (index) => {
						props.removeRow(list.field, index);
					},
					onAdd: () => {
						props.addRow(list.field);
					}
				}, list.field)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-chrome-config__note",
					children: t("config.appliesNextLaunch")
				})]
			});
		}
		//#endregion
		//#region src/client/config/chrome-launch-form.ts
		/**
		* Staged form behind the plugin's configuration card.
		*
		* The Host side declares `extensions` and `extraArgs` as volatile string
		* lists, so editing them never remounts the plugin (a remount would dispose
		* the manager and close every open window). This controller reads those
		* values through the shared entry form, stages a local draft for the card's
		* list editors, and writes both fields back in one revision-fenced mutation.
		*/
		/** Whether one extension row is a usable source (mirrors the host-side rule). */
		function extensionRowValid(value) {
			const trimmed = value.trim();
			if (trimmed === "") return true;
			return trimmed.startsWith("~") || trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(trimmed);
		}
		/** Whether one argument row is a usable flag (mirrors the host-side rule). */
		function argRowValid(value) {
			const trimmed = value.trim();
			return trimmed === "" || trimmed.startsWith("-");
		}
		/** Copy a Host list value, tolerating anything the wire hands over. */
		function rowsOf(value) {
			return Array.isArray(value) ? value.map((row) => typeof row === "string" ? row : String(row)) : [];
		}
		/** The Host's current lists. */
		function hostLists(value) {
			return {
				extensions: rowsOf(value?.extensions),
				extraArgs: rowsOf(value?.extraArgs)
			};
		}
		/** Whether two row lists are equal as staged. */
		function sameRows(left, right) {
			return left.length === right.length && left.every((row, index) => row === right[index]);
		}
		/** Drop blank rows and trim the rest, as the Host stores them. */
		function cleanRows(rows) {
			return rows.map((row) => row.trim()).filter((row) => row !== "");
		}
		/**
		* Stage the two launch-config lists over one shared entry form.
		*
		* Drafts follow the Host value until the user edits a row; a save clears the
		* draft so the card tracks the Host again, and a refused save keeps it so the
		* edit is not lost.
		*/
		var ChromeLaunchCardController = class {
			scope;
			store;
			unsubscribe;
			/** ``null`` while the card follows the Host value. */
			draft = null;
			saving = false;
			failed = false;
			/** @param scope - shared configuration form of this plugin's profile entry. */
			constructor(scope) {
				this.scope = scope;
				this.store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(this.project());
				this.unsubscribe = this.scope.subscribe(() => {
					this.publish();
				});
			}
			/**
			* Build the face the card's slot registration injects.
			* @returns the card snapshot hook plus its edit actions.
			*/
			inject() {
				return {
					hooks: { chromeLaunch: this.store },
					addRow: (field) => {
						this.edit(field, (rows) => [...rows, ""]);
					},
					editRow: (field, index, value) => {
						this.edit(field, (rows) => rows.map((row, at) => at === index ? value : row));
					},
					removeRow: (field, index) => {
						this.edit(field, (rows) => rows.filter((_, at) => at !== index));
					},
					save: () => {
						this.save();
					},
					discard: () => {
						this.failed = false;
						this.draft = null;
						this.publish();
					}
				};
			}
			/** Release the form subscription (card unmount). */
			dispose() {
				this.unsubscribe();
			}
			/** Apply one edit to a staged row list. */
			edit(field, change) {
				const current = this.draft ?? hostLists(this.scope.getSnapshot().value);
				this.failed = false;
				this.draft = {
					...current,
					[field]: change([...current[field]])
				};
				this.publish();
			}
			/** Write both lists as one fenced mutation. */
			async save() {
				const state = this.project();
				if (!state.dirty || state.invalid || this.saving) return;
				this.saving = true;
				this.store.set(this.project());
				let accepted = false;
				try {
					accepted = await this.scope.mutate([{
						op: "set",
						path: ["extensions"],
						value: cleanRows(state.extensions)
					}, {
						op: "set",
						path: ["extraArgs"],
						value: cleanRows(state.extraArgs)
					}], this.scope.getSnapshot().revision);
				} finally {
					this.saving = false;
					this.failed = !accepted;
					if (accepted) this.draft = null;
					this.store.set(this.project());
				}
			}
			/** Recompute and publish the card snapshot. */
			publish() {
				const state = this.project();
				if (!state.dirty) this.draft = null;
				this.store.set(state);
			}
			/** Project the current draft and Host value into the rendered state. */
			project() {
				const snapshot = this.scope.getSnapshot();
				const host = hostLists(snapshot.value);
				const rows = this.draft ?? host;
				const extensionsInvalid = rows.extensions.map((row) => !extensionRowValid(row));
				const extraArgsInvalid = rows.extraArgs.map((row) => !argRowValid(row));
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: !sameRows(rows.extensions, host.extensions) || !sameRows(rows.extraArgs, host.extraArgs),
					invalid: extensionsInvalid.includes(true) || extraArgsInvalid.includes(true),
					saving: this.saving,
					failed: this.failed,
					extensions: rows.extensions,
					extraArgs: rows.extraArgs,
					extensionsInvalid,
					extraArgsInvalid
				};
			}
		};
		//#endregion
		//#region src/client/config/styles.ts
		/**
		* 配置卡片样式 (与面板样式一样作为字符串内联注入).
		*
		* 只走 ui-theme 的 --dsw-alias-* 语义 token, 不写字面色值; 字段行的节奏
		* 复刻官方设置页: 标签 13px/500, 说明 12px tertiary, 行内 padding 12px 0,
		* 行间 0.5px hairline.
		*/
		const CHROME_CONFIG_CSS = `
.dsh-chrome-config__group {
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-chrome-config__group:last-of-type {
  border-bottom: none;
}
.dsh-chrome-config__label {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-chrome-config__hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-chrome-config__rows {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.dsh-chrome-config__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}
.dsh-chrome-config__row > span:first-child {
  flex: 1 1 auto;
  min-width: 0;
}
.dsh-chrome-config__row input {
  width: 100%;
}
.dsh-chrome-config__invalid {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-chrome-config__note {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
`;
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
			"meta.shotCount": "截图",
			"config.extensions": "扩展来源",
			"config.extensionsHint": "每个条目一个 .crx 文件或未打包扩展目录, 写绝对路径或以 ~ 开头. crx 先解包进插件的共享缓存目录再装入, 扩展 ID 与原文件一致.",
			"config.extensionsPlaceholder": "~/ext/foo.crx 或 /abs/path/to/unpacked",
			"config.extraArgs": "额外启动参数",
			"config.extraArgsHint": "每个条目一条完整的 Chrome 命令行参数, 例如 --lang=zh-CN. 与插件自身不变量冲突的参数 (user-data-dir / headless / 远程调试 / disable-extensions) 会在开窗时被拒绝.",
			"config.extraArgsPlaceholder": "--lang=zh-CN",
			"config.add": "添加",
			"config.remove": "删除",
			"config.invalidRow": "格式不对",
			"config.save": "保存",
			"config.saving": "保存中",
			"config.saveFailed": "保存失败, 请重试",
			"config.unavailable": "当前组合没有提供这一项的配置表单.",
			"config.readOnly": "当前部署的配置是只读的.",
			"config.appliesNextLaunch": "改动对之后打开或重开的浏览器窗口生效, 已打开的窗口不受影响."
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
			"meta.shotCount": "screenshots",
			"config.extensions": "Extension sources",
			"config.extensionsHint": "One .crx file or unpacked extension directory per row: an absolute path or one starting with ~. A crx is unpacked into the plugin shared cache first, so the extension keeps its original ID.",
			"config.extensionsPlaceholder": "~/ext/foo.crx or /abs/path/to/unpacked",
			"config.extraArgs": "Extra launch flags",
			"config.extraArgsHint": "One whole Chrome command-line flag per row, for example --lang=zh-CN. Flags fighting the plugin's own invariants (user-data-dir, headless, remote debugging, disable-extensions) are refused when a window launches.",
			"config.extraArgsPlaceholder": "--lang=zh-CN",
			"config.add": "Add",
			"config.remove": "Remove",
			"config.invalidRow": "wrong shape",
			"config.save": "Save",
			"config.saving": "Saving",
			"config.saveFailed": "Save failed, please retry",
			"config.unavailable": "This composition serves no configuration form for this entry.",
			"config.readOnly": "Configuration is read-only in this deployment.",
			"config.appliesNextLaunch": "Changes apply to browser windows opened (or reopened) afterwards; open windows keep their set."
		};
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace owned by this plugin. */
		const NS = "plugin-chrome";
		/** This plugin's package name: the key of its `plugins.bundle.config` entry. */
		const PACKAGE_NAME = "dsh-plugin-chrome";
		/**
		* This plugin's profile entry id (`cordis.patch.yml` insert row), which is
		* also the namespace its configuration form is addressed by.
		*/
		const ENTRY_ID = "dsh-plugin-chrome";
		/** Client services this plugin reads. */
		const inject = ["slots", "locale"];
		/** Inject one stylesheet tag per plugin fiber (both removed on unload). */
		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			const tags = [];
			for (const [id, css] of [["dsh-plugin-chrome/styles", CHROME_TAB_CSS], ["dsh-plugin-chrome/config-styles", CHROME_CONFIG_CSS]]) {
				if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) continue;
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-plugin-chrome";
				tag.dataset.pluginCss = id;
				tag.textContent = css;
				document.head.appendChild(tag);
				tags.push(tag);
			}
			return () => {
				for (const tag of tags) tag.remove();
			};
		}
		/** Register the session Chrome tab (independent of the settings surface). */
		function registerTab(ctx, t) {
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "chrome-hub",
				order: 40,
				label: () => t("tab.label"),
				locale: NS,
				inject: (sessionId) => ({
					t,
					sessionId
				})
			}, ChromeTab));
		}
		/**
		* Register the launch-configuration card.
		*
		* Gated on the shared configuration form service and on the Host actually
		* serving this plugin's entry: a deployment without the settings surface (or
		* with the plugin mounted outside a profile) simply shows no card, and the
		* Chrome tab above is never affected.
		*/
		function registerConfigCard(ctx) {
			ctx.inject(["configForms"], (configCtx) => {
				configCtx.effect(() => configCtx.configForms.whileServed([ENTRY_ID], () => {
					const card = new ChromeLaunchCardController(configCtx.configForms.get(ENTRY_ID));
					const unregister = configCtx.slots.inject("plugins.bundle.config", () => configCtx.slots.register({
						name: "plugins.bundle.config",
						key: PACKAGE_NAME,
						locale: NS,
						inject: () => card.inject()
					}, ChromeLaunchCard));
					return () => {
						unregister();
						card.dispose();
					};
				}), "dsh-plugin-chrome: launch config card");
			});
		}
		/**
		* Client plugin entry: register the locale dictionaries, the Chrome tab, and
		* the launch-configuration card.
		* @param ctx - client plugin context (`slots`, `locale` injected).
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-plugin-chrome: dictionaries");
			ctx.effect(() => injectStyles(), "dsh-plugin-chrome: styles");
			registerTab(ctx, t);
			registerConfigCard(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.en = en;
		exports.inject = inject;
		exports.zh = zh;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map