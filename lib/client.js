window.__ModuleLoader__.load({
	id: "dsh-messaging-gateway",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region node_modules/.pnpm/@deepseek-ai+dsh-brand@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2/node_modules/@deepseek-ai/dsh-brand/lib/index.js
		/**
		* Duplicate-install-safe nominal primitive helpers.
		*
		* A brand makes structurally identical strings or numbers non-interchangeable
		* at the type level: a `SessionId` cannot be passed where a `ToolCallId` is
		* expected, and an event sequence cannot be passed as a log offset. Comparison,
		* logging, and serialization retain the underlying primitive behavior.
		*
		* This package owns no concrete domain value and keeps no runtime identity or mutable
		* state, so independently installed copies produce interchangeable values.
		*
		* @module @deepseek-ai/dsh-brand
		*/
		/**
		* Apply a compile-time string brand without changing the value.
		* @param value - string admitted by the domain that owns the target brand.
		* @returns the same string with the requested compile-time brand.
		*/
		function brandString(value) {
			return value;
		}
		//#endregion
		//#region node_modules/.pnpm/@deepseek-ai+dsh-session@0.1.2-rc.1_@deepseek-ai+cordis@4.0.2_@deepseek-ai+dsh-scope@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/types.js
		/**
		* Brand a string as a {@link SessionId}.
		* @param id - the raw session id string.
		* @returns the same string with the session-id brand.
		*/
		function SessionId(id) {
			return brandString(id);
		}
		//#endregion
		//#region src/config.ts
		const SETTINGS_NAMESPACE = "dsh-messaging-gateway";
		const SLACK_CREATE_APP_URL = "https://api.slack.com/apps?new_app=1";
		const FEISHU_OPEN_APP_URL = "https://open.feishu.cn/app";
		//#endregion
		//#region src/gateway/title.ts
		function platformLabel(platform) {
			if (platform.length === 0) return "Chat";
			return `${platform.charAt(0).toUpperCase()}${platform.slice(1)}`;
		}
		/** Feishu open_id / chat_id are not a name. Do not put them in the Computer list. */
		function isOpaquePeerLabel(value) {
			return /^(ou_|oc_|on_)[A-Za-z0-9_-]{8,}$/.test(value.trim());
		}
		//#endregion
		//#region \0dshx-css-module:/Users/wu/Documents/Codex/2026-08-24/dshx-users-wu-documents-codex-2026/work/rc1-plugin-repos/dsh-messaging-gateway/src/client/MessagingSection.module.css.mjs
		const css$1 = ".I3m2Ja_root{flex-direction:column;flex:none;width:100%;min-width:0;padding:4px 0 0;display:flex}.I3m2Ja_header{width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;letter-spacing:.02em;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:4px;margin:0;padding:6px 8px;font-size:12px;font-weight:500;display:flex}.I3m2Ja_header:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.I3m2Ja_mark{background:var(--dsw-alias-interactive-bg-hover);width:16px;height:16px;color:var(--dsw-alias-label-primary);letter-spacing:0;text-transform:none;border-radius:4px;flex:none;justify-content:center;align-items:center;font-size:9px;font-weight:600;display:inline-flex}.I3m2Ja_rows{flex-direction:column;max-height:9.5rem;padding:0 0 4px;display:flex;overflow-y:auto}.I3m2Ja_row{width:100%;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;margin:0;padding:6px 8px 6px 28px;font-size:13px;line-height:18px;display:block}.I3m2Ja_row:hover{background:var(--dsw-alias-interactive-bg-hover)}.I3m2Ja_empty{color:var(--dsw-alias-label-tertiary);padding:6px 8px 6px 28px;font-size:12px;line-height:18px}.I3m2Ja_rail{width:36px;padding:0}.I3m2Ja_rail .I3m2Ja_header{text-transform:none;border-radius:50%;justify-content:center;width:36px;height:36px;padding:0}.I3m2Ja_rail .I3m2Ja_rows{display:none}";
		const tagId$1 = "dsh-messaging-gateway/MessagingSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-messaging-gateway";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var MessagingSection_module_css_default = {
			"empty": "I3m2Ja_empty",
			"header": "I3m2Ja_header",
			"mark": "I3m2Ja_mark",
			"rail": "I3m2Ja_rail",
			"root": "I3m2Ja_root",
			"row": "I3m2Ja_row",
			"rows": "I3m2Ja_rows"
		};
		//#endregion
		//#region src/client/MessagingSection.tsx
		const STORAGE_KEY = "dsh-messaging-gateway.platforms-open";
		function readOpen() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				if (!raw) return {};
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) return {};
				return parsed;
			} catch {
				return {};
			}
		}
		function writeOpen(open) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
			} catch {}
		}
		function MessagingSection({ wide, openSession }) {
			const [groups, setGroups] = (0, react.useState)([]);
			const [open, setOpen] = (0, react.useState)(readOpen);
			(0, react.useEffect)(() => {
				let cancelled = false;
				const tick = () => {
					fetch("/plugins/dsh-messaging-gateway/list").then((r) => r.json()).then((body) => {
						if (!cancelled && Array.isArray(body.groups)) setGroups(body.groups);
					}).catch(() => {});
				};
				tick();
				const id = window.setInterval(tick, 2e3);
				return () => {
					cancelled = true;
					window.clearInterval(id);
				};
			}, []);
			(0, react.useEffect)(() => {
				writeOpen(open);
			}, [open]);
			if (groups.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `${MessagingSection_module_css_default.root}${wide ? "" : ` ${MessagingSection_module_css_default.rail}`}`,
				"data-mgw": "dock",
				children: groups.map((group) => {
					const expanded = open[group.platform] === true;
					const letter = group.platform.slice(0, 1).toUpperCase();
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: MessagingSection_module_css_default.header,
						"data-mgw": "group",
						"data-platform": group.platform,
						"aria-expanded": expanded,
						"aria-label": group.label ?? platformLabel(group.platform),
						onClick: () => {
							setOpen((s) => ({
								...s,
								[group.platform]: !expanded
							}));
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MessagingSection_module_css_default.mark,
							"aria-hidden": true,
							children: letter
						}), wide ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							expanded ? "▾" : "▸",
							" ",
							group.label ?? platformLabel(group.platform)
						] }) : null]
					}), wide && expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MessagingSection_module_css_default.rows,
						children: group.rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MessagingSection_module_css_default.empty,
							"data-mgw": "empty",
							children: "还没有对话"
						}) : group.rows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: MessagingSection_module_css_default.row,
							"data-mgw": "row",
							"data-session-key": row.sessionKey,
							onClick: () => {
								if (row.hostSessionId) openSession(row.hostSessionId);
							},
							children: [row.title, row.turn === "inFlight" ? " …" : ""]
						}, row.sessionKey))
					}) : null] }, group.platform);
				})
			});
		}
		//#endregion
		//#region src/client/open-session.ts
		async function openListedSession(sessions, id) {
			const attempt = () => {
				try {
					sessions.open(id);
					return "opened";
				} catch {
					return "threw";
				}
			};
			if (attempt() === "opened") return "opened";
			if (sessions.refresh) try {
				await sessions.refresh();
			} catch {}
			return attempt() === "opened" ? "opened" : "missing";
		}
		//#endregion
		//#region src/client/nav-icon.ts
		/** Settings shell hardcodes unknown section ids to a gear. Swap the 消息 row. */
		const BUBBLE = "M3.15 1.7h9.7c1.13 0 2.05.92 2.05 2.05v5.9c0 1.13-.92 2.05-2.05 2.05H7.58L4.55 14.35c-.48.32-1.12-.03-1.12-.6v-1.95h-.28c-1.13 0-2.05-.92-2.05-2.05v-5.9c0-1.13.92-2.05 2.05-2.05zm0 1.4c-.36 0-.65.29-.65.65v5.9c0 .36.29.65.65.65h1.55v1.72l2.12-1.72h6.03c.36 0 .65-.29.65-.65v-5.9c0-.36-.29-.65-.65-.65H3.15z";
		function paintMessagingNavIcon(root) {
			let painted = 0;
			for (const dialog of root.querySelectorAll("[role=\"dialog\"]")) for (const button of dialog.querySelectorAll("nav button")) {
				if (button.querySelector("span")?.textContent?.trim() !== "消息") continue;
				const svg = button.querySelector("svg");
				if (!svg || svg.querySelector("path[data-mgw=\"nav-icon\"]")) continue;
				svg.setAttribute("viewBox", "0 0 16 16");
				svg.setAttribute("fill", "none");
				while (svg.firstChild) svg.removeChild(svg.firstChild);
				const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
				path.setAttribute("fill", "currentColor");
				path.setAttribute("fill-rule", "evenodd");
				path.setAttribute("clip-rule", "evenodd");
				path.setAttribute("d", BUBBLE);
				path.setAttribute("data-mgw", "nav-icon");
				svg.appendChild(path);
				painted += 1;
			}
			return painted;
		}
		function watchMessagingNavIcon() {
			if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
			let frame = 0;
			const paint = () => {
				paintMessagingNavIcon(document);
			};
			const schedule = () => {
				if (frame !== 0) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					paint();
				});
			};
			const observer = new MutationObserver(schedule);
			observer.observe(document.documentElement, {
				childList: true,
				subtree: true
			});
			paint();
			return () => {
				observer.disconnect();
				if (frame !== 0) cancelAnimationFrame(frame);
			};
		}
		//#endregion
		//#region src/client/bind-status.ts
		function platformBind(args) {
			const row = args.access?.find((item) => item.platform === args.platform);
			if (row?.bound === true) return {
				bound: true,
				owner: row.owner
			};
			const settingsOwner = args.settingsOwner?.trim() ?? "";
			if (settingsOwner.length > 0) return {
				bound: true,
				owner: settingsOwner
			};
			if (args.groups?.find((item) => item.platform === args.platform)) return {
				bound: true,
				owner: null
			};
			return {
				bound: false,
				owner: null
			};
		}
		function bindLabel(name, bound, owner) {
			if (!bound) return `${name} 未绑定`;
			if (owner && !isOpaquePeerLabel(owner)) return `${name} 已绑定 ${owner}`;
			return `${name} 已绑定`;
		}
		function saveActionLabel(args) {
			if (args.writing) return "正在保存…";
			if (!args.bound) return "保存并连接";
			if (!args.dirty) return "已连接";
			return "保存";
		}
		//#endregion
		//#region \0dshx-css-module:/Users/wu/Documents/Codex/2026-08-24/dshx-users-wu-documents-codex-2026/work/rc1-plugin-repos/dsh-messaging-gateway/src/client/SettingsPage.module.css.mjs
		const css = ".jjzOLa_page{max-width:640px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:8px;display:flex}.jjzOLa_heading{margin:0;font-size:18px;font-weight:600;line-height:26px}.jjzOLa_intro{color:var(--dsw-alias-label-tertiary);margin:0 0 8px;font-size:13px;line-height:1.5}.jjzOLa_status{flex-wrap:wrap;gap:8px;padding:4px 0 8px;display:flex}.jjzOLa_badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;align-items:center;gap:6px;padding:3px 10px;font-size:12px;font-weight:500;line-height:18px;display:inline-flex}.jjzOLa_dot{background:var(--dsw-alias-label-tertiary);border-radius:50%;width:6px;height:6px}.jjzOLa_dotOn{background:var(--dsw-alias-state-success,#3d9a5f)}.jjzOLa_block{border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:4px;padding:16px 0;display:flex}.jjzOLa_block:last-child{border-bottom:none}.jjzOLa_blockTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}.jjzOLa_blockHint{color:var(--dsw-alias-label-tertiary);margin:0 0 8px;font-size:13px;line-height:1.5}.jjzOLa_howto{border:0;margin:0 0 8px}.jjzOLa_howto summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:22px;list-style:none}.jjzOLa_howto summary::-webkit-details-marker{display:none}.jjzOLa_howto summary:hover{color:var(--dsw-alias-label-primary)}.jjzOLa_steps{color:var(--dsw-alias-label-secondary);gap:6px;margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.5;display:grid}.jjzOLa_steps a{color:var(--dsw-alias-label-primary)}.jjzOLa_field{flex-direction:column;gap:6px;padding:12px 0 0;display:flex}.jjzOLa_label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}.jjzOLa_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}.jjzOLa_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}.jjzOLa_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}.jjzOLa_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.jjzOLa_actions{justify-content:flex-end;align-items:center;gap:8px;padding:16px 0 4px;display:flex}.jjzOLa_ghost,.jjzOLa_primary{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.jjzOLa_ghost{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.jjzOLa_ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.jjzOLa_primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.jjzOLa_ghost:disabled,.jjzOLa_primary:disabled{opacity:.4;cursor:default}.jjzOLa_ghost:focus-visible,.jjzOLa_primary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.jjzOLa_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.jjzOLa_warn{color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:13px;line-height:1.5}";
		const tagId = "dsh-messaging-gateway/SettingsPage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-messaging-gateway";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SettingsPage_module_css_default = {
			"actions": "jjzOLa_actions",
			"badge": "jjzOLa_badge",
			"block": "jjzOLa_block",
			"blockHint": "jjzOLa_blockHint",
			"blockTitle": "jjzOLa_blockTitle",
			"dot": "jjzOLa_dot",
			"dotOn": "jjzOLa_dotOn",
			"field": "jjzOLa_field",
			"ghost": "jjzOLa_ghost",
			"heading": "jjzOLa_heading",
			"hint": "jjzOLa_hint",
			"howto": "jjzOLa_howto",
			"input": "jjzOLa_input",
			"intro": "jjzOLa_intro",
			"label": "jjzOLa_label",
			"note": "jjzOLa_note",
			"page": "jjzOLa_page",
			"primary": "jjzOLa_primary",
			"status": "jjzOLa_status",
			"steps": "jjzOLa_steps",
			"warn": "jjzOLa_warn"
		};
		//#endregion
		//#region src/client/SettingsPage.tsx
		function MessagingSettings(props) {
			if (props.scope === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoadedPage, { scope: props.scope });
		}
		function LoadedPage({ scope }) {
			const snapshot = (0, react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot());
			const [writing, setWriting] = (0, react.useState)(false);
			const [bot, setBot] = (0, react.useState)("");
			const [app, setApp] = (0, react.useState)("");
			const [owner, setOwner] = (0, react.useState)("");
			const [feishuAppId, setFeishuAppId] = (0, react.useState)("");
			const [feishuSecret, setFeishuSecret] = (0, react.useState)("");
			const [feishuOwner, setFeishuOwner] = (0, react.useState)("");
			const [copied, setCopied] = (0, react.useState)(false);
			const [live, setLive] = (0, react.useState)({});
			const settings = snapshot.value;
			(0, react.useEffect)(() => {
				let cancelled = false;
				const tick = () => {
					fetch("/plugins/dsh-messaging-gateway/list").then((r) => r.json()).then((body) => {
						if (!cancelled) setLive(body);
					}).catch(() => {});
				};
				tick();
				const id = window.setInterval(tick, 4e3);
				return () => {
					cancelled = true;
					window.clearInterval(id);
				};
			}, []);
			if (snapshot.status === "loading" || settings === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SettingsPage_module_css_default.warn,
				children: "正在读取 Messaging 设置…"
			});
			if (snapshot.status === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: SettingsPage_module_css_default.warn,
				children: "当前连接写不了 Host 设置。用本机 DSH Web 打开设置。"
			});
			const slack = platformBind({
				platform: "slack",
				...settings.slackOwner ? { settingsOwner: settings.slackOwner } : {},
				...live.access ? { access: live.access } : {},
				...live.groups ? { groups: live.groups } : {}
			});
			const feishu = platformBind({
				platform: "feishu",
				...settings.feishuOwner ? { settingsOwner: settings.feishuOwner } : {},
				...live.access ? { access: live.access } : {},
				...live.groups ? { groups: live.groups } : {}
			});
			const writable = snapshot.writable && !writing;
			const slackDirty = owner.length > 0 || bot.length > 0 || app.length > 0;
			const feishuDirty = feishuOwner.length > 0 || feishuAppId.length > 0 || feishuSecret.length > 0;
			const save = (patch) => {
				setWriting(true);
				const jobs = [];
				for (const [key, value] of Object.entries(patch)) {
					if (typeof value === "string" && value.length === 0) continue;
					jobs.push(scope.set(key, value));
				}
				Promise.all(jobs).finally(() => setWriting(false));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: SettingsPage_module_css_default.page,
				"data-mgw": "settings",
				"aria-busy": writing,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: SettingsPage_module_css_default.heading,
						children: "消息"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: SettingsPage_module_css_default.intro,
						children: "Slack 和飞书绑在这台 DSH 上。Computer 只挂主私信；频道 @ 在后台分房间，不进 Recents。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsPage_module_css_default.status,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: SettingsPage_module_css_default.badge,
							"data-mgw": "bind-status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${SettingsPage_module_css_default.dot}${slack.bound ? ` ${SettingsPage_module_css_default.dotOn}` : ""}` }), bindLabel("Slack", slack.bound, slack.owner)]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: SettingsPage_module_css_default.badge,
							"data-mgw": "feishu-bind-status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${SettingsPage_module_css_default.dot}${feishu.bound ? ` ${SettingsPage_module_css_default.dotOn}` : ""}` }), bindLabel("飞书", feishu.bound, feishu.owner)]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsPage_module_css_default.block,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: SettingsPage_module_css_default.blockTitle,
								children: "Slack"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SettingsPage_module_css_default.blockHint,
								children: "没有官方共用 bot。在你自己的 workspace 建 Socket Mode 应用，把 token 贴回来。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: SettingsPage_module_css_default.howto,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "怎么创建 Slack 应用" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ol", {
									className: SettingsPage_module_css_default.steps,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
											"打开",
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
												href: SLACK_CREATE_APP_URL,
												target: "_blank",
												rel: "noreferrer",
												children: "Slack 创建应用（从 Manifest）"
											})
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "粘贴清单，Create，再 Install to workspace。" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "Basic Information 复制 Bot Token（xoxb-）和 App-Level Token（xapp-，scope 含 connections:write）。" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "点自己的头像 → Copy member ID。" })
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: SettingsPage_module_css_default.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.label,
										children: "Member ID"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: SettingsPage_module_css_default.input,
										"data-mgw": "field-owner",
										value: owner || settings.slackOwner || "",
										onChange: (event) => setOwner(event.target.value),
										placeholder: "U0123456789",
										autoComplete: "off"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.hint,
										children: "你自己的 U…，不是 bot 的。"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: SettingsPage_module_css_default.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.label,
										children: "Bot token"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: SettingsPage_module_css_default.input,
										"data-mgw": "field-bot",
										type: "password",
										value: bot,
										onChange: (event) => setBot(event.target.value),
										placeholder: "xoxb-…",
										autoComplete: "off"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.hint,
										children: "密钥不会回显。留空则保留已保存的值。"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: SettingsPage_module_css_default.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.label,
										children: "App token"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: SettingsPage_module_css_default.input,
										"data-mgw": "field-app",
										type: "password",
										value: app,
										onChange: (event) => setApp(event.target.value),
										placeholder: "xapp-…",
										autoComplete: "off"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.hint,
										children: "Socket Mode 的 xapp- token。"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: SettingsPage_module_css_default.actions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SettingsPage_module_css_default.ghost,
									onClick: () => {
										fetch("/plugins/dsh-messaging-gateway/slack-manifest").then((r) => r.text()).then((text) => navigator.clipboard.writeText(text)).then(() => setCopied(true));
									},
									children: copied ? "已复制 Manifest" : "复制 Manifest"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SettingsPage_module_css_default.primary,
									"data-mgw": "save-bind",
									disabled: !writable || slack.bound && !slackDirty,
									onClick: () => {
										const patch = { enabled: true };
										const nextOwner = owner || settings.slackOwner;
										if (nextOwner) patch.slackOwner = nextOwner;
										if (bot) patch.slackBotToken = bot;
										if (app) patch.slackAppToken = app;
										save(patch);
									},
									children: saveActionLabel({
										bound: slack.bound,
										dirty: slackDirty,
										writing
									})
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SettingsPage_module_css_default.block,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: SettingsPage_module_css_default.blockTitle,
								children: "飞书"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SettingsPage_module_css_default.blockHint,
								children: "输入 / 弹出的指令来自同一份 DSH 命令目录，注册到你自己的企业自建应用。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: SettingsPage_module_css_default.howto,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "怎么创建飞书应用" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ol", {
									className: SettingsPage_module_css_default.steps,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
											"打开",
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
												href: FEISHU_OPEN_APP_URL,
												target: "_blank",
												rel: "noreferrer",
												children: "飞书开放平台"
											}),
											"，建企业自建应用，启用机器人。"
										] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "权限：application:app_slash_command:write / read、im:message.p2p_msg:readonly、im:message.group_at_msg:readonly、im:message:send_as_bot。发布一个新版本。" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "事件订阅选「使用长连接接收事件」，订阅「接收消息 v2.0」。" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: "复制 App ID、App Secret，以及自己的 open_id。" })
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: SettingsPage_module_css_default.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.label,
										children: "open_id"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: SettingsPage_module_css_default.input,
										"data-mgw": "field-feishu-owner",
										value: feishuOwner || settings.feishuOwner || feishu.owner || "",
										onChange: (event) => setFeishuOwner(event.target.value),
										placeholder: "ou_…",
										autoComplete: "off"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.hint,
										children: "你自己的 ou_…，不是机器人的。"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: SettingsPage_module_css_default.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: SettingsPage_module_css_default.label,
									children: "App ID"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: SettingsPage_module_css_default.input,
									"data-mgw": "field-feishu-appid",
									value: feishuAppId || settings.feishuAppId || "",
									onChange: (event) => setFeishuAppId(event.target.value),
									placeholder: "cli_…",
									autoComplete: "off"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: SettingsPage_module_css_default.field,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.label,
										children: "App Secret"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: SettingsPage_module_css_default.input,
										"data-mgw": "field-feishu-secret",
										type: "password",
										value: feishuSecret,
										onChange: (event) => setFeishuSecret(event.target.value),
										placeholder: "…",
										autoComplete: "off"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: SettingsPage_module_css_default.hint,
										children: "密钥不会回显。留空则保留已保存的值。"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: SettingsPage_module_css_default.actions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: SettingsPage_module_css_default.primary,
									"data-mgw": "save-feishu",
									disabled: !writable || feishu.bound && !feishuDirty,
									onClick: () => {
										const patch = { enabled: true };
										const nextOwner = feishuOwner || settings.feishuOwner || feishu.owner;
										const nextId = feishuAppId || settings.feishuAppId;
										if (nextOwner) patch.feishuOwner = nextOwner;
										if (nextId) patch.feishuAppId = nextId;
										if (feishuSecret) patch.feishuAppSecret = feishuSecret;
										save(patch);
									},
									children: saveActionLabel({
										bound: feishu.bound,
										dirty: feishuDirty,
										writing
									})
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: SettingsPage_module_css_default.note,
								children: feishu.bound ? "飞书已经在回消息。指令面板大约 5 分钟后出现，可重启飞书客户端加速。" : "保存后会拉长连接，并把 /help /model /new 等写进指令面板。"
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-messaging-gateway-client";
		const inject = [
			"slots",
			"settingsScope",
			"sessions"
		];
		function sessionsFace(ctx) {
			return {
				open: (id) => {
					ctx.sessions.open(SessionId(id));
				},
				list: ctx.sessions.list,
				refresh: () => ctx.sessions.refresh()
			};
		}
		function openSessionOf(ctx) {
			const sessions = sessionsFace(ctx);
			return (id) => {
				openListedSession(sessions, id).then((result) => {
					if (result === "missing") console.warn("[dsh-messaging-gateway] Computer has no session", id);
				});
			};
		}
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE });
			const openSession = openSessionOf(ctx);
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-messaging-gateway",
				order: 20,
				label: "Messaging",
				inject: () => ({ openSession })
			}, MessagingSection));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "messaging",
				order: 14,
				label: "消息",
				inject: () => ({ scope })
			}, MessagingSettings));
			ctx.effect(() => watchMessagingNavIcon(), "dsh-messaging-gateway: nav icon");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map