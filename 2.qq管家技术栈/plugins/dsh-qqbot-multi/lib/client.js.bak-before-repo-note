window.__ModuleLoader__.load({
	id: "dsh-qqbot-multi",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/shared/bind-protocol.ts
		/**
		* 端内绑定协议 —— 宿主路由与客户端面板的共享契约
		*
		* 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
		* （client/bind-page.ts）各自 import，杜绝两端协议漂移。
		* 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
		* 客户端 tsdown 构建会将其内联进 bundle。
		*/
		/** 状态查询（绑定页轮询） */
		const BIND_STATE_PATH = "/qqbot/im-qqbot/bind";
		/** 刷新二维码（绑定页按钮） */
		const BIND_REFRESH_PATH = "/qqbot/im-qqbot/bind/refresh";
		/** 手动填写/编辑凭据（绑定页表单） */
		const BIND_MANUAL_PATH = "/qqbot/im-qqbot/bind/manual";
		/** 解绑：移除已保存凭据，回到绑定流程 */
		const BIND_UNBIND_PATH = "/qqbot/im-qqbot/bind/unbind";
		/** 配置读写（设置面板表单） */
		const BIND_CONFIG_PATH = "/qqbot/im-qqbot/config";
		//#endregion
		//#region src/client/bind-page.ts
		/**
		* 端内绑定面板 — 扫码 / 手动填写 / 已绑定编辑
		*
		* 宿主插件注册 /qqbot/im-qqbot/bind 路由（待绑定与已绑定 fiber 均常驻）：
		* - 未绑定：waiting（二维码）/ starting / saving / failed 相位 + manual 提交
		* - 已绑定：bound 相位（回显脱敏 appId，secret 不回传）+ manual 更换 + 解绑
		* 扫码成功或手动保存均写入 profile patch 并经 HMR 重载生效。
		*
		* 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
		* hover/过渡/focus 样式无法用 inline style 表达，统一走类；
		* 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
		*
		* 同一组件复用于两种展示位（侧栏绑定页 / 设置页 QQ Bot 栏目）。
		* 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
		* Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
		*/
		/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 */
		const ACTIVE_POLL_MS = 2e3;
		const RETRY_POLL_MS = 3e3;
		/** 样式注入标记（幂等） */
		const STYLE_ID$1 = "im-qqbot-bind-panel-styles";
		/**
		* 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
		* style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
		* 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
		* 安装后不再随挂载移除，避免多个展示位互相清掉样式。
		*/
		function installPanelStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID$1) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID$1;
			style.textContent = `
.imqb-panel {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 24px; min-height: 320px; text-align: center; font-size: 14px;
}
.imqb-title { margin: 0; font-size: 16px; font-weight: 600; }
.imqb-hint { margin: 0; opacity: 0.75; line-height: 1.6; }
.imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.imqb-link { font-size: 13px; opacity: 0.85; color: var(--dsw-alias-brand, #4d6bfe); text-decoration: none; }
.imqb-link:hover { text-decoration: underline; }
.imqb-icon { font-size: 32px; line-height: 1; }
.imqb-qr { border-radius: 10px; background: #fff; padding: 10px; max-width: 100%; }
.imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.imqb-btn, .imqb-pill {
  font: inherit; cursor: pointer; color: inherit;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease;
}
.imqb-btn:disabled, .imqb-pill:disabled { opacity: 0.5; cursor: default; }
.imqb-btn {
  padding: 7px 18px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  background: transparent;
}
.imqb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-brand, #4d6bfe); color: #fff; font-weight: 500;
}
.imqb-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-strong, #3b5cf0); }
.imqb-btn--danger { color: var(--dsw-alias-danger, #f26d6d); border-color: var(--dsw-alias-danger, rgba(242, 109, 109, 0.5)); }
.imqb-btn--danger:hover:not(:disabled) { background: var(--dsw-alias-danger, rgba(242, 109, 109, 0.12)); }
.imqb-ghost {
  border: none; background: transparent; opacity: 0.65; padding: 4px 8px;
  font: inherit; font-size: 13px; cursor: pointer; color: inherit;
}
.imqb-ghost:hover { opacity: 1; text-decoration: underline; }
/* 插件详情「设置」按钮：30px，略高于旁边的 sm 次要按钮 */
.imqb-pluginOpen {
  display: inline-flex; align-items: center; justify-content: center;
  box-sizing: border-box; height: 30px; padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit); font: inherit;
  font-size: 13px; line-height: 20px; cursor: pointer;
}
.imqb-pluginOpen:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-pluginOpen:focus-visible { outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 3px; }
@media (pointer: coarse) { .imqb-pluginOpen { height: 44px; } }
/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */
.imqb-pluginPage {
  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px;
  color: var(--dsw-alias-label-primary, #1f2329);
}
.imqb-pluginPageContent { max-width: 1080px; margin: 0 auto; }
.imqb-pill {
  padding: 5px 16px; border-radius: 999px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)); background: transparent;
}
.imqb-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }
.imqb-btn:focus-visible, .imqb-pill:focus-visible, .imqb-input:focus-visible, .imqb-ghost:focus-visible {
  outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 1px;
}
.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }
.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }
.imqb-input {
  padding: 8px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));
  background: var(--dsw-alias-bg-input, rgba(128, 128, 128, 0.08));
  color: inherit; font: inherit; font-size: 13px; outline: none;
}
.imqb-input:focus { border-color: var(--dsw-alias-brand, #4d6bfe); }
.imqb-error { margin: 0; font-size: 12px; color: var(--dsw-alias-danger, #f26d6d); }
/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */
.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 14px; }
.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }
.imqb-qqicon {
  flex: none; display: block; border-radius: 8px; /* 透明底，QQ 蓝徽标在明暗主题下均清晰 */
}
.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); opacity: .85; }
.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }
/* 扫码成功后的连接过渡：二维码模糊变暗 + 覆盖层 */
.imqb-scanned { position: relative; display: inline-block; }
.imqb-scanned-qr {
  display: block; border-radius: 10px; background: #fff; padding: 10px;
  filter: blur(6px) saturate(0.6); opacity: 0.55;
}
.imqb-scanned-veil {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; text-align: center;
}
.imqb-scanned-title { margin: 0; font-size: 15px; font-weight: 600; }
.imqb-scanned-sub { margin: 0; font-size: 12px; opacity: 0.75; line-height: 1.6; }
    `;
			document.head.appendChild(style);
		}
		function usePanelStyles() {
			(0, react.useEffect)(() => {
				installPanelStyles();
			}, []);
		}
		/**
		* 绑定状态轮询 hook。
		*
		* 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
		* 曾经拿到过 = HMR 重载窗口期（manual/unbind 保存后路由短暂消失），
		* 低频等待恢复而不是判定终态——否则保存成功提示会被
		* 「插件未启用」覆盖且无法自愈。
		*
		* bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
		* 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到
		* 新相位（如解绑后的 waiting 二维码）。
		*
		* @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
		*          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
		*          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
		*/
		function useBindState(enabled = true) {
			const [state, setState] = (0, react.useState)(null);
			const [gone, setGone] = (0, react.useState)(false);
			const recheckRef = (0, react.useRef)(() => {});
			(0, react.useEffect)(() => {
				if (!enabled) return;
				let stopped = false;
				let sawRoute = false;
				let generation = 0;
				let running = false;
				let restartAfterFlight = false;
				let urgentUntil = 0;
				let timer;
				const schedule = (ms) => {
					timer = setTimeout(() => {
						tick();
					}, ms);
				};
				const intervalFor = (phase) => {
					const base = phase === "saving" ? 500 : phase === "bound" ? 3e4 : ACTIVE_POLL_MS;
					return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
				};
				const tick = async () => {
					if (stopped || running) return;
					running = true;
					const myGeneration = generation;
					const alive = () => myGeneration === generation && !stopped;
					try {
						const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
						if (res.status === 404) {
							if (!stopped && !sawRoute) setGone(true);
							else if (alive()) schedule(Date.now() < urgentUntil ? 1e3 : 3e3);
							return;
						}
						if (!res.ok) {
							if (alive()) schedule(RETRY_POLL_MS);
							return;
						}
						sawRoute = true;
						const body = await res.json();
						if (!alive()) return;
						setState(body);
						schedule(intervalFor(body.phase));
						return;
					} catch {} finally {
						running = false;
						if (restartAfterFlight && !stopped) {
							restartAfterFlight = false;
							tick();
						}
					}
					if (alive()) schedule(RETRY_POLL_MS);
				};
				recheckRef.current = () => {
					generation += 1;
					urgentUntil = Date.now() + 15e3;
					if (timer !== void 0) clearTimeout(timer);
					if (running) {
						restartAfterFlight = true;
						return;
					}
					tick();
				};
				tick();
				return () => {
					stopped = true;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, []);
			return {
				state,
				gone,
				recheck: (0, react.useCallback)(() => {
					recheckRef.current();
				}, [])
			};
		}
		/** 手动提交凭据（填写 / 更换共用） */
		async function submitManualCredentials(appId, appSecret) {
			try {
				const res = await fetch(BIND_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						appId,
						appSecret
					})
				});
				const body = await res.json().catch(() => ({}));
				if (res.ok && body.ok) return {
					ok: true,
					message: body.message
				};
				return {
					ok: false,
					error: body.error ?? `保存失败（HTTP ${res.status}）`
				};
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		/**
		* 手动凭据表单（填写 / 更换共用）。
		*
		* appSecret 永不回显（占位符提示），提交成功后展示保存结果；
		* 宿主写入 profile patch 并经 HMR 重载，状态轮询随后收敛为 bound。
		*/
		function ManualForm({ initialAppId }) {
			const [appId, setAppId] = (0, react.useState)(initialAppId ?? "");
			const [appSecret, setAppSecret] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy) return;
				const trimmedId = appId.trim();
				const trimmedSecret = appSecret.trim();
				if (trimmedId.length === 0 || trimmedSecret.length === 0) {
					setResult({
						ok: false,
						error: "appId 与 appSecret 均为必填"
					});
					return;
				}
				setBusy(true);
				submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
					setResult(outcome);
					setBusy(false);
				});
			}, [
				appId,
				appSecret,
				busy
			]);
			if (result !== null && result.ok) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "✅"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "插件将自动重载；稍后即可开始对话"))));
			return (0, react.createElement)("form", {
				className: "imqb-form",
				onSubmit: submit
			}, (0, react.createElement)("label", { className: "imqb-field" }, "AppID", (0, react.createElement)("input", {
				className: "imqb-input",
				value: appId,
				placeholder: "QQ 机器人 AppID",
				onChange: (event) => {
					setAppId(event.currentTarget.value);
				},
				autoComplete: "off",
				spellCheck: false
			})), (0, react.createElement)("label", { className: "imqb-field" }, "AppSecret", (0, react.createElement)("input", {
				className: "imqb-input",
				type: "password",
				value: appSecret,
				placeholder: initialAppId === void 0 ? "QQ 机器人 AppSecret" : "输入新的 AppSecret（不回显）",
				onChange: (event) => {
					setAppSecret(event.currentTarget.value);
				},
				autoComplete: "new-password"
			})), result !== null && !result.ok ? (0, react.createElement)("p", { className: "imqb-error" }, result.error) : null, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				type: "submit",
				disabled: busy
			}, busy ? "正在保存…" : "保存"));
		}
		/** QQ 机器人 logo 路径（assets/icons/qqbot_logo.svg，内嵌以保持 bundle 自包含） */
		const QQ_BOT_LOGO_PATH = "M19.3862 15.5001C19.3861 11.4203 16.0789 8.11296 11.999 8.11292C7.91915 8.11292 4.61203 11.4203 4.61182 15.5001V17.0001C4.61182 18.5949 5.90429 19.8873 7.49902 19.8873H16.499C18.0937 19.8873 19.3862 18.5949 19.3862 17.0001V15.5001ZM10.6118 14.0001C10.6118 14.6145 10.1129 15.1134 9.49853 15.1134C8.8843 15.1132 8.38672 14.6144 8.38672 14.0001V12.0006C8.38672 11.3863 8.8843 10.8875 9.49853 10.8873C10.1129 10.8873 10.6118 11.3862 10.6118 12.0006V14.0001ZM15.6113 14.0001C15.6113 14.6143 15.1136 15.1131 14.4995 15.1134C13.8851 15.1134 13.3862 14.6145 13.3862 14.0001V12.0006C13.3862 11.3862 13.8851 10.8873 14.4995 10.8873C15.1136 10.8876 15.6113 11.3864 15.6113 12.0006V14.0001ZM14.2607 3.04895C14.2607 3.89351 13.7957 4.62474 13.1108 5.0133V5.95374C17.8958 6.50514 21.6112 10.5676 21.6113 15.5001V17.0001C21.6113 19.8237 19.3225 22.1124 16.499 22.1124H7.49902C4.67546 22.1124 2.38672 19.8237 2.38672 17.0001V15.5001C2.38691 10.568 6.10139 6.50571 10.8857 5.95374V5.01185C10.2017 4.62305 9.73583 3.89286 9.73583 3.04895C9.73609 1.79961 10.7496 0.787231 11.999 0.787231C13.2484 0.787297 14.2605 1.79966 14.2607 3.04895Z";
		/** QQ 机器人图标（logo 矢量渲染，透明底，随 size 缩放） */
		function QqBotIcon({ size = 28 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true,
				className: "imqb-qqicon"
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "#0085FF"
			}));
		}
		/** 已绑定视图：回显 appId + 更换凭据 / 解绑入口 */
		function BoundView({ appId, recheck }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [unbindResult, setUnbindResult] = (0, react.useState)(null);
			const unbind = (0, react.useCallback)(() => {
				if (!window.confirm("确定解绑吗？\n解绑后机器人立即下线，插件将重新进入扫码绑定流程。")) return;
				fetch(BIND_UNBIND_PATH, { method: "POST" }).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setUnbindResult({
							ok: true,
							message: body.message ?? "已解绑，插件将重载并重新进入绑定流程"
						});
						recheck();
						return;
					}
					setUnbindResult({
						ok: false,
						message: body.error ?? `解绑失败（HTTP ${res.status}）`
					});
				}).catch((err) => {
					setUnbindResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				});
			}, [recheck]);
			if (unbindResult !== null) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, unbindResult.ok ? "👋" : "⚠️"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, unbindResult.message)), unbindResult.ok ? (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: recheck
			}, "刷新状态") : (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setUnbindResult(null);
				}
			}, "返回")));
			if (editing) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "更换凭据")), (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setEditing(false);
				}
			}, "返回")), (0, react.createElement)(ManualForm, { initialAppId: appId }));
			return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)(QqBotIcon, { size: 28 }), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "已绑定"), (0, react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, `AppID ${appId} · 私聊与群聊已接入`))), (0, react.createElement)("div", { className: "imqb-status-actions" }, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				onClick: () => {
					setEditing(true);
				}
			}, "更换凭据"), (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--danger",
				onClick: unbind
			}, "解绑")));
		}
		/** 未绑定视图：扫码 / 手动填写切换 */
		function UnboundView({ state }) {
			const [mode, setMode] = (0, react.useState)("qr");
			const refresh = (0, react.useCallback)(() => {
				fetch(BIND_REFRESH_PATH, { method: "POST" }).catch(() => {});
			}, []);
			const [imgFailed, setImgFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setImgFailed(false);
			}, [state.qrSvg]);
			if (mode === "manual") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "手动填写凭据"), (0, react.createElement)(ManualForm, {}), (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setMode("qr");
				}
			}, "改用扫码绑定"));
			if (state.qrSvg === void 0 || imgFailed) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "⚠️"), (0, react.createElement)("p", { className: "imqb-title" }, "二维码暂时无法显示"), (0, react.createElement)("p", { className: "imqb-hint" }, "可重启应用后重试，或任选下面一种方式继续"), (0, react.createElement)("a", {
				href: state.url,
				target: "_blank",
				rel: "noreferrer noopener",
				className: "imqb-link"
			}, "在浏览器中打开链接扫码"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: () => {
					setMode("manual");
				}
			}, "手动填写凭据")));
			return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("img", {
				src: state.qrSvg,
				alt: "QQ 扫码二维码",
				width: 220,
				height: 220,
				className: "imqb-qr",
				onError: () => {
					setImgFailed(true);
				}
			}), (0, react.createElement)("p", { className: "imqb-title" }, "扫码绑定 QQ 机器人"), (0, react.createElement)("p", { className: "imqb-hint" }, "使用手机 QQ 扫描二维码完成绑定"), (0, react.createElement)("a", {
				href: state.url,
				target: "_blank",
				rel: "noreferrer noopener",
				className: "imqb-link"
			}, "二维码显示异常？在浏览器中打开"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: refresh
			}, "刷新二维码"), (0, react.createElement)("button", {
				className: "imqb-pill",
				onClick: () => {
					setMode("manual");
				}
			}, "手动填写")));
		}
		/** 依据宿主相位渲染面板主体（可注入共享轮询结果避免双计时器） */
		function BindPanelBody(props) {
			usePanelStyles();
			const injected = props?.state !== void 0;
			const internal = useBindState(!injected);
			const state = injected ? props.state : internal.state;
			const gone = injected ? props.gone ?? false : internal.gone;
			const recheck = injected ? props.recheck ?? (() => {}) : internal.recheck;
			const [lastQr, setLastQr] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (state === null) return;
				if (state.phase === "waiting") {
					if (state.qrSvg !== void 0) setLastQr(state.qrSvg);
				} else if (state.phase === "bound") setLastQr(null);
			}, [state]);
			if (gone) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "❔"), (0, react.createElement)("p", { className: "imqb-hint" }, "插件未启用，或当前版本不支持端内配置"));
			if (state === null || state.phase === "starting") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-hint" }, "正在获取绑定状态…"));
			if (state.phase === "saving") {
				if (lastQr !== null) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-scanned" }, (0, react.createElement)("img", {
					src: lastQr,
					alt: "QQ 扫码二维码",
					width: 220,
					height: 220,
					className: "imqb-scanned-qr"
				}), (0, react.createElement)("div", { className: "imqb-scanned-veil" }, (0, react.createElement)("p", { className: "imqb-scanned-title" }, "✅ 扫码成功"), (0, react.createElement)("p", { className: "imqb-scanned-sub" }, "正在连接机器人，稍候…"))));
				return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "🎉"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "扫码成功"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "凭据已保存，插件正在重载，稍后即可开始对话"))));
			}
			if (state.phase === "failed") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "⚠️"), (0, react.createElement)("p", { className: "imqb-title" }, "绑定失败"), (0, react.createElement)("p", { className: "imqb-hint" }, state.reason), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				onClick: () => {
					window.location.reload();
				}
			}, "重试")));
			if (state.phase === "bound") return (0, react.createElement)(BoundView, {
				appId: state.appId,
				recheck
			});
			return (0, react.createElement)(UnboundView, { state });
		}
		//#endregion
		//#region src/client/config-panel.ts
		/**
		* QQ 机器人配置面板 — 必要配置的 UI 编辑
		*
		* UI 复刻 DSW 通用设置（settings-form 原语）的视觉风格：
		* 左对齐设置列、0.5px 行分隔、label 13px/500、控件右置；
		* Switch 为 36×20 aria-checked 结构（thumb translateX 动画）；
		* 三值选择用分段控件（滑动指示器按段数/索引的 CSS 变量定位）；
		* 保存按钮为 DSW 反色主按钮（label-primary 底 + bg-layer-3 字）。
		*
		* 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
		* 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
		* 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
		*
		* 字段策略：只开放用户必要的配置；cwd 只读展示；超时与性能调优
		* 类字段走 profile patch / 环境变量。
		*/
		/** 样式注入标记（幂等） */
		const STYLE_ID = "im-qqbot-config-panel-styles";
		/** DSW 通用设置风格（settings-form / Switch / SegmentedControl 原语复刻） */
		function useConfigPanelStyles() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				if (document.getElementById(STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em;
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
/* Switch（aria-checked 驱动，视觉态与无障碍态同源） */
.imqb2-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;
}
.imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.imqb2-switch:disabled { cursor: default; opacity: 0.5; }
.imqb2-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.imqb2-switch-thumb {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #ffffff);
  transition: transform 120ms ease;
}
.imqb2-switch[aria-checked='true'] .imqb2-switch-thumb {
  background: var(--dsw-alias-label-primary-foreground, #ffffff);
  transform: translateX(16px);
}
/* 输入（官方 fields.input 复刻） */
.imqb2-input {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none;
}
.imqb2-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.imqb2-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.imqb2-textarea { height: auto; min-height: 68px; padding: 8px 12px; resize: vertical; line-height: 1.5; }
/* 分段控件（官方 SegmentedControl 复刻：指示器按段数/索引定位） */
.imqb2-seg {
  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-seg-indicator {
  position: absolute; top: 4px; left: 4px;
  width: calc((100% - 8px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));
  height: calc(100% - 8px);
  border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));
  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));
  transition: transform 160ms ease;
  pointer-events: none;
}
.imqb2-seg-tab {
  box-sizing: border-box; position: relative; z-index: 1; height: 28px; padding: 0 16px;
  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;
  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;
}
.imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.imqb2-seg-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
/* 底栏（官方 SettingsForm.footer 复刻） */
.imqb2-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
.imqb2-save {
  appearance: none; flex: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px;
  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);
}
.imqb2-save:disabled { opacity: 0.4; cursor: default; }
.imqb2-save:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
    `;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, []);
		}
		/** 开关（官方 Switch 原语结构：aria-checked 驱动视觉态） */
		function Switch({ checked, label, onChange }) {
			return (0, react.createElement)("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked,
				"aria-label": label,
				className: "imqb2-switch",
				onClick: () => {
					onChange(!checked);
				}
			}, (0, react.createElement)("span", { className: "imqb2-switch-thumb" }));
		}
		/** 访问模式分段选择（官方 SegmentedControl 结构：CSS 变量定位滑动指示器） */
		function Segmented({ value, options, onChange, label }) {
			const index = Math.max(0, options.findIndex((o) => o.value === value));
			const trackStyle = {
				"--imqb2-seg-count": options.length,
				"--imqb2-seg-index": index
			};
			return (0, react.createElement)("div", {
				className: "imqb2-seg",
				role: "tablist",
				"aria-label": label,
				style: trackStyle
			}, (0, react.createElement)("span", { className: "imqb2-seg-indicator" }), options.map((o) => (0, react.createElement)("button", {
				key: o.value,
				type: "button",
				role: "tab",
				"aria-selected": o.value === value,
				className: "imqb2-seg-tab",
				onClick: () => {
					onChange(o.value);
				}
			}, o.label)));
		}
		/** 开关行（label 左 + Switch 右 + 可选 help） */
		function SwitchRow({ label, help, checked, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Switch, {
				checked,
				label,
				onChange
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-help" }, help));
		}
		/** 文本行（label 上 + 输入下，与官方 fields 布局一致） */
		function FieldRow({ label, help, value, placeholder, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("input", {
				className: "imqb2-input",
				value,
				placeholder,
				spellCheck: false,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 多行文本行 */
		function AreaRow({ label, help, value, rows, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("textarea", {
				className: "imqb2-input imqb2-textarea",
				value,
				rows: rows ?? 3,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 访问模式分段选择行 */
		function SegmentedRow({ label, help, value, options, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Segmented, {
				value,
				options,
				onChange,
				label
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		const MODE_OPTIONS = [
			{
				value: "open",
				label: "所有人"
			},
			{
				value: "allowlist",
				label: "白名单"
			},
			{
				value: "disabled",
				label: "禁用"
			}
		];
		/** 深比较（表单值与初始回显值的 dirty 判断） */
		function shallowEqual(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		/**
		* 配置面板主体。
		*
		* 保存仅提交变更键（服务端按白名单合并），保存成功后提示
		* HMR 重载语义（进行中的机器人会话将重置）。
		*/
		function ConfigPanel(props) {
			useConfigPanelStyles();
			const [initial, setInitial] = (0, react.useState)(null);
			const [form, setForm] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const bindPhase = props?.bindPhase;
			(0, react.useEffect)(() => {
				let stopped = false;
				fetch(BIND_CONFIG_PATH, { cache: "no-store" }).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const body = await res.json();
					if (stopped) return;
					setInitial(body.config);
					setForm(body.config);
				}).catch((err) => {
					if (!stopped) setLoadError(err instanceof Error ? err.message : String(err));
				});
				return () => {
					stopped = true;
				};
			}, [bindPhase]);
			const patch = (0, react.useCallback)((key, value) => {
				setForm((current) => current === null ? current : {
					...current,
					[key]: value
				});
				setResult(null);
			}, []);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy || initial === null || form === null) return;
				const changed = {};
				for (const key of Object.keys(form)) if (!shallowEqual(form[key], initial[key])) changed[key] = form[key];
				if (Object.keys(changed).length === 0) return;
				if (changed.access !== void 0) {
					const a = changed.access;
					changed.access = {
						...a,
						c2cAllow: a.c2cAllow.map((s) => s.trim()).filter(Boolean),
						groupAllow: a.groupAllow.map((s) => s.trim()).filter(Boolean)
					};
				}
				setBusy(true);
				fetch(BIND_CONFIG_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(changed)
				}).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setResult({
							ok: true,
							message: body.message ?? "配置已保存，插件将自动重载"
						});
						setInitial(form);
						return;
					}
					setResult({
						ok: false,
						message: body.error ?? `保存失败（HTTP ${res.status}）`
					});
				}).catch((err) => {
					setResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				}).finally(() => {
					setBusy(false);
				});
			}, [
				busy,
				form,
				initial
			]);
			if (loadError !== null) return (0, react.createElement)("p", {
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, `配置加载失败：${loadError}`);
			if (initial === null || form === null) return (0, react.createElement)("p", {
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, "正在加载配置…");
			const dirty = Object.keys(form).some((key) => !shallowEqual(form[key], initial[key]));
			const access = form.access ?? {
				c2cMode: "open",
				c2cAllow: [],
				groupMode: "open",
				groupAllow: []
			};
			return (0, react.createElement)("form", {
				className: "imqb2-form",
				onSubmit: submit
			}, (0, react.createElement)("div", { className: "imqb2-group-title" }, "工作目录"),
(0, react.createElement)("div", { className: "imqb2-field" },
  (0, react.createElement)("div", { className: "imqb2-head" },
    (0, react.createElement)("span", { className: "imqb2-label" }, "Agent 工作目录"),
    (0, react.createElement)("button", {
      type: "button",
      className: "imqb2-save",
      onClick: async () => {
        try {
          const picked = await fetch("/qq-archive/v18/pick", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json());
          if (!picked || !picked.path) return;
          const saved = await fetch("/qq-archive/v18/qqbot/cwd", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: picked.path }) }).then((r) => r.json());
          window.alert(saved && saved.ok ? "已设置：" + picked.path + "\n重启 DSH 后，下一条消息起生效" : "失败：" + ((saved && saved.error) || "未知错误"));
        } catch (e) { window.alert("失败：" + e); }
      },
    }, "选择目录…"),
  ),
  (0, react.createElement)("p", { className: "imqb2-hint" }, "默认 ~/.dsh-qqbot/workspace；改完需重启 DSH。"),
),
(0, react.createElement)("div", { className: "imqb2-group-title" }, "服务范围"), (0, react.createElement)(SegmentedRow, {
				label: "私聊",
				value: access.c2cMode,
				options: MODE_OPTIONS,
				onChange: (v) => {
					patch("access", {
						...access,
						c2cMode: v
					});
				}
			}), access.c2cMode === "allowlist" ? (0, react.createElement)(AreaRow, {
				label: "私聊白名单",
				help: "请输入用户 openid，多个请换行输入",
				rows: 3,
				value: access.c2cAllow.join("\n"),
				onChange: (v) => {
					patch("access", {
						...access,
						c2cAllow: v.split("\n").map((s) => s.trim())
					});
				}
			}) : null, (0, react.createElement)(SegmentedRow, {
				label: "群聊",
				value: access.groupMode,
				options: MODE_OPTIONS,
				onChange: (v) => {
					patch("access", {
						...access,
						groupMode: v
					});
				}
			}), access.groupMode === "allowlist" ? (0, react.createElement)(AreaRow, {
				label: "群聊白名单",
				help: "请输入群 openid，多个请换行输入",
				rows: 3,
				value: access.groupAllow.join("\n"),
				onChange: (v) => {
					patch("access", {
						...access,
						groupAllow: v.split("\n").map((s) => s.trim())
					});
				}
			}) : null, (0, react.createElement)("div", { className: "imqb2-group-title" }, "基础设置"), (0, react.createElement)(SwitchRow, {
				label: "群聊仅回复 @机器人的消息",
				checked: form.requireMention ?? true,
				help: "开启后，机器人仅可回复 @机器人的群聊消息",
				onChange: (v) => {
					patch("requireMention", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "流式输出",
				checked: form.streaming ?? true,
				help: "回复内容分段实时推送到聊天",
				onChange: (v) => {
					patch("streaming", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "显示工具调用结果",
				checked: form.showToolResults ?? false,
				help: "在聊天中展示 agent 工具调用的结构化结果",
				onChange: (v) => {
					patch("showToolResults", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "模型"), (0, react.createElement)(FieldRow, {
				label: "Provider",
				value: form.provider ?? "",
				placeholder: "留空继承宿主默认",
				onChange: (v) => {
					patch("provider", v);
				}
			}), (0, react.createElement)(FieldRow, {
				label: "Model",
				value: form.model ?? "",
				placeholder: "留空继承宿主默认",
				onChange: (v) => {
					patch("model", v);
				}
			}), (0, react.createElement)(FieldRow, {
				label: "Preset",
				value: form.preset ?? "",
				placeholder: "Agent preset id",
				onChange: (v) => {
					patch("preset", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "个性化提示词"), (0, react.createElement)(AreaRow, {
				label: "群聊额外 system prompt",
				value: form.groupPrompt ?? "",
				onChange: (v) => {
					patch("groupPrompt", v);
				}
			}), (0, react.createElement)(AreaRow, {
				label: "私聊额外 system prompt",
				value: form.directPrompt ?? "",
				onChange: (v) => {
					patch("directPrompt", v);
				}
			}), form.cwd !== void 0 ? (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, "Agent 工作目录"), (0, react.createElement)("span", { className: "imqb2-hint" }, "只读")), (0, react.createElement)("p", { className: "imqb2-readonly" }, form.cwd)) : null, (0, react.createElement)("div", { className: "imqb2-footer" }, result !== null ? (0, react.createElement)("p", { className: `imqb2-note${result.ok ? " imqb2-note--ok" : " imqb2-note--error"}` }, (result.ok ? "" : "⚠️ ") + result.message) : dirty ? (0, react.createElement)("p", { className: "imqb2-note" }, "保存后插件将重载，进行中的机器人会话将重置") : (0, react.createElement)("p", { className: "imqb2-note" }), (0, react.createElement)("button", {
				className: "imqb2-save",
				type: "submit",
				disabled: busy || !dirty
			}, busy ? "正在保存…" : "保存")));
		}
		//#endregion
		//#region src/client/index.ts
		const name = "im-qqbot-client";
		const inject = [
			"slots",
			"sidebarRight",
			"sidebarRightTabs"
		];
		/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
		const TAB_KIND = "qqbot-bind";
		/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
		const TAB_ID = "im-qqbot/bind";
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "dsh-qqbot-multi";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-qqbot";
		/** 绑定入口图标（QQ 机器人，跟随主题图标色变量） */
		function BindGuideIcon() {
			return (0, react.createElement)("svg", {
				width: 24,
				height: 24,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: "M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				d: "M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}));
		}
		//#region src/client/bots-panel.ts（多机器人 + 模型选择）
		/**
		 * 机器人列表面板：列出所有已连接的官方机器人，每个可单独选择大模型。
		 * 数据来自宿主 /qqbot/bots；保存写 profile patch 并触发 HMR 重载。
		 */
		const BOTS_PATH = "/qqbot/bots";
		const BIND_PATH = "/qqbot/bots/bind";
		const PICK_DIR_PATH = "/qqbot/bots/pick-dir";
		const WX_PATH = "/qqbot/bots/weixin";
		const BOTS_STYLE_ID = "im-qqbot-bots-styles";
		function useBotsPanelStyles() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				if (document.getElementById(BOTS_STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = BOTS_STYLE_ID;
				style.textContent = `
.imqb3 { display: flex; flex-direction: column; gap: 10px; }
.imqb3-head { display: flex; align-items: baseline; gap: 8px; }
.imqb3-title { font-size: 14px; font-weight: 600; }
.imqb3-card {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  border-radius: var(--dsw-radius-md, 10px);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
}
.imqb3-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.imqb3-name { font-weight: 600; font-size: 13px; }
.imqb3-meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; opacity: .7; }
.imqb3-dot { width: 7px; height: 7px; border-radius: 50%; background: #9aa0a6; }
.imqb3-dot--on { background: #2eb872; }
.imqb3-select, .imqb3-input {
  font: inherit; font-size: 12px; padding: 4px 8px;
  border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.45));
  background: transparent; color: inherit; min-width: 0;
}
.imqb3-select { max-width: 320px; }
.imqb3-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 999px; line-height: 1.5;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.45)); opacity: .85;
}
.imqb3-tag--wx { color: #07c160; border-color: rgba(7,193,96,.5); }
.imqb3-tag--qq { color: #12b7f5; border-color: rgba(18,183,245,.5); }
.imqb3-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  opacity: .75; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.imqb3-input { flex: 1 1 120px; }
.imqb3-textarea { flex: 1 1 100%; min-height: 76px; resize: vertical; font-family: inherit; }
.imqb3-btn {
  font: inherit; font-size: 12px; cursor: pointer; padding: 4px 10px;
  border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.45));
  background: transparent; color: inherit;
}
.imqb3-btn:disabled { opacity: .45; cursor: default; }
.imqb3-btn--primary { border-color: transparent; background: var(--dsw-alias-brand, #4d6bfe); color: #fff; }
.imqb3-btn--danger { color: var(--dsw-alias-danger, #f26d6d); }
.imqb3-note { font-size: 12px; margin: 0; opacity: .8; }
.imqb3-hint { font-size: 12px; margin: 0; opacity: .7; line-height: 1.5; }
.imqb3-link { font-size: 12px; color: var(--dsw-alias-brand, #4d6bfe); text-decoration: none; }
.imqb3-link:hover { text-decoration: underline; }
.imqb3-bind {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 14px; border-radius: var(--dsw-radius-md, 10px);
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.45));
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06));
}
.imqb3-bind-title { margin: 0; font-size: 13px; font-weight: 600; }
.imqb3-qr { border-radius: 10px; background: #fff; padding: 8px; }
.imqb3-note--error { color: var(--dsw-alias-state-error-primary, #d8483f); opacity: 1; }
.imqb3-add { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
`;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, []);
		}
		/** "provider/model" → { provider, model }（模型 id 可能含 /，只切第一个） */
		function splitRoute(value) {
			const idx = value.indexOf("/");
			if (idx <= 0) return null;
			return { provider: value.slice(0, idx), model: value.slice(idx + 1) };
		}
		function ModelSelect({ value, models, onChange }) {
			const groups = new Map();
			for (const m of models ?? []) {
				const list = groups.get(m.provider) ?? [];
				list.push(m);
				groups.set(m.provider, list);
			}
			const options = [(0, react.createElement)("option", { value: "", key: "__default" }, "跟随宿主默认模型")];
			for (const [provider, list] of groups) options.push((0, react.createElement)("optgroup", { key: provider, label: provider }, list.map((m) => (0, react.createElement)("option", {
				key: `${provider}/${m.id}`,
				value: `${provider}/${m.id}`
			}, m.name ? `${m.name}（${m.id}）` : m.id))));
			return (0, react.createElement)("select", {
				className: "imqb3-select",
				value: value ?? "",
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}, options);
		}
		function BotsPanel() {
			useBotsPanelStyles();
			const [data, setData] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)({
				id: "",
				name: "",
				appId: "",
				appSecret: ""
			});
			const [bind, setBind] = (0, react.useState)(null);
			const [bindOpen, setBindOpen] = (0, react.useState)(false);
			const [wx, setWx] = (0, react.useState)(null);
			const [wxOpen, setWxOpen] = (0, react.useState)(false);
			const [wxCode, setWxCode] = (0, react.useState)("");
			const load = (0, react.useCallback)(() => {
				fetch(BOTS_PATH, { cache: "no-store" }).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					return res.json();
				}).then((body) => {
					setData(body);
				}).catch((err) => {
					setNote({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				});
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			// 扫码会话进行中：每 2 秒取一次宿主状态（二维码只会在这里刷新）
			(0, react.useEffect)(() => {
				if (!bindOpen) return;
				let stopped = false;
				const tick = async () => {
					try {
						const res = await fetch(BIND_PATH, { cache: "no-store" });
						const body = await res.json();
						if (stopped) return;
						setBind(body);
						if (body.savedBot !== null && body.savedBot !== void 0) load();
					}
					catch { /* 宿主重载窗口：下一轮再取 */ }
				};
				tick();
				const timer = setInterval(tick, 2e3);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [bindOpen, load]);
			(0, react.useEffect)(() => {
				if (!wxOpen) return;
				let stopped = false;
				const tick = async () => {
					try {
						const res = await fetch(WX_PATH, { cache: "no-store" });
						const body = await res.json();
						if (stopped) return;
						setWx(body);
						if (body.phase === "bound" || body.phase === "saved") load();
					}
					catch { /* 宿主重载窗口 */ }
				};
				tick();
				const timer = setInterval(tick, 2500);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [wxOpen, load]);
			const startBind = (id) => {
				setBindOpen(true);
				setBind({ phase: "starting" });
				fetch(BIND_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						action: "start",
						...(id === void 0 ? {} : { id })
					})
				}).then((res) => res.json()).then(setBind).catch((err) => {
					setBind({
						phase: "failed",
						error: err instanceof Error ? err.message : String(err)
					});
				});
			};
			const bindAction = (action) => {
				fetch(BIND_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ action })
				}).catch(() => {});
			};
			const closeBind = () => {
				bindAction(bind?.phase === "saved" ? "dismiss" : "cancel");
				setBindOpen(false);
				setBind(null);
			};
			const wxPost = (action, extra) => fetch(WX_PATH, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action, ...(extra ?? {}) })
			}).then((res) => res.json()).then(setWx).catch((err) => {
				setWx({
					phase: "error",
					message: err instanceof Error ? err.message : String(err)
				});
			});
			const startWx = (targetId) => {
				setWxOpen(true);
				setWx({ phase: "starting" });
				setWxCode("");
				wxPost("start", targetId ? { id: targetId } : undefined);
			};
			const closeWx = () => {
				wxPost(wx?.phase === "saved" || wx?.phase === "bound" ? "dismiss" : "cancel");
				setWxOpen(false);
				setWx(null);
			};
			const submit = (0, react.useCallback)(async (payload) => {
				setBusy(true);
				setNote(null);
				try {
					const res = await fetch(BOTS_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload)
					});
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok) setNote({ ok: true, message: body.message ?? "已保存" });
					else setNote({ ok: false, message: body.error ?? `HTTP ${res.status}` });
				}
				catch (err) {
					setNote({ ok: false, message: err instanceof Error ? err.message : String(err) });
				}
				finally {
					setBusy(false);
				}
			}, []);
			const pickDir = (0, react.useCallback)(async (bot) => {
				setBusy(true);
				try {
					const res = await fetch(PICK_DIR_PATH, { method: "POST" });
					const body = await res.json().catch(() => ({}));
					if (!res.ok || !body.ok) {
						setNote({
							ok: false,
							message: body.error ?? `HTTP ${res.status}`
						});
						return;
					}
					if (body.cancelled) return;
					await submit({
						action: "update",
						id: bot.id,
						bot: { cwd: body.path }
					});
				}
				catch (err) {
					setNote({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				}
				finally {
					setBusy(false);
				}
			}, [submit]);
			const bots = data?.bots ?? [];
			const models = data?.models ?? [];
			const configured = new Map((data?.configured ?? []).map((b) => [String(b.id ?? ""), b]));
			const bindPanel = !bindOpen ? null : bind?.savedBot ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-bind-title" }, "✅ 扫码成功"), (0, react.createElement)("p", { className: "imqb3-hint" }, `AppID ${bind.savedBot.appId} 已${bind.savedBot.updated ? "更新" : "添加"}（${bind.savedBot.id}），插件重载后自动连接。`), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeBind
			}, "完成")) : bind?.phase === "waiting" && bind.qrSvg !== void 0 ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("img", {
				className: "imqb3-qr",
				src: bind.qrSvg,
				alt: "QQ 机器人绑定二维码",
				width: 200,
				height: 200
			}), (0, react.createElement)("p", { className: "imqb3-hint" }, "用手机 QQ 扫描二维码完成绑定"), bind.url === void 0 ? null : (0, react.createElement)("a", {
				className: "imqb3-link",
				href: bind.url,
				target: "_blank",
				rel: "noreferrer noopener"
			}, "在浏览器中打开链接"), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: () => bindAction("refresh")
			}, "刷新二维码"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeBind
			}, "取消"))) : bind?.phase === "failed" || bind?.error !== void 0 ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-note imqb3-note--error" }, `⚠️ ${bind.error ?? bind.reason ?? "扫码失败"}`), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--primary",
				onClick: () => startBind(bind.target || void 0)
			}, "重试"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeBind
			}, "取消"))) : (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-hint" }, "正在生成二维码…"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeBind
			}, "取消"));
			const wxBody = !wxOpen ? null : wx?.phase === "saved" || wx?.phase === "bound" ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-bind-title" }, "✅ 微信机器人已绑定"), (0, react.createElement)("p", { className: "imqb3-hint" }, `机器人 ${wx?.bot?.id ?? ""} 已写入配置，插件重载后开始收发微信消息。`), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeWx
			}, "完成")) : wx?.phase === "verify" ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-bind-title" }, "输入手机上的配对数字"), (0, react.createElement)("p", { className: "imqb3-hint" }, wx.message ?? ""), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "配对数字",
				value: wxCode,
				onChange: (e) => {
					setWxCode(e.currentTarget.value);
				}
			}), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--primary",
				disabled: wxCode.trim() === "",
				onClick: () => wxPost("verify", { code: wxCode.trim() })
			}, "提交")), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeWx
			}, "取消")) : wx?.phase === "qr" ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("img", {
				className: "imqb3-qr",
				src: wx.qrDataUrl,
				alt: "微信扫码绑定二维码",
				width: 200,
				height: 200
			}), (0, react.createElement)("p", { className: "imqb3-hint" }, "用手机微信扫码，并在手机上确认绑定"), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: () => wxPost("start")
			}, "刷新二维码"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeWx
			}, "取消"))) : wx?.phase === "scaned" ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-bind-title" }, "已扫码"), (0, react.createElement)("p", { className: "imqb3-hint" }, wx.message ?? "请在手机上确认"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeWx
			}, "取消")) : wx?.phase === "error" || wx?.phase === "expired" ? (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-note imqb3-note--error" }, `⚠️ ${wx.message ?? "扫码失败"}`), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--primary",
				onClick: () => wxPost("start")
			}, "重试"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeWx
			}, "取消"))) : (0, react.createElement)("div", { className: "imqb3-bind" }, (0, react.createElement)("p", { className: "imqb3-hint" }, "正在向微信申请二维码…"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				onClick: closeWx
			}, "取消"));
			return (0, react.createElement)("div", { className: "imqb3" }, (0, react.createElement)("div", { className: "imqb3-head" }, (0, react.createElement)("span", { className: "imqb3-title" }, "机器人"), (0, react.createElement)("span", { className: "imqb3-hint" }, "多个 AppID 可同时在线，每个机器人单独选模型"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--primary",
				onClick: () => startBind()
			}, "扫码添加机器人"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				disabled: busy,
				onClick: () => submit({ action: "sync-names" })
			}, "同步名称"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--primary",
				onClick: startWx
			}, "微信扫码添加")), bindPanel, wxBody, bots.length === 0 ? (0, react.createElement)("p", { className: "imqb3-note" }, "还没有已连接的机器人。点右上角扫码，或在下方手动填 AppID / AppSecret。") : bots.map((bot) => {
				const current = `${bot.provider ?? ""}/${bot.model ?? ""}`;
				const routeValue = bot.provider && bot.model ? current : "";
				return (0, react.createElement)("div", { className: "imqb3-card", key: bot.id }, (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("span", { className: `imqb3-dot${bot.ready ? " imqb3-dot--on" : ""}` }), (0, react.createElement)("span", { className: "imqb3-name" }, bot.name || bot.id), (0, react.createElement)("span", { className: `imqb3-tag imqb3-tag--${bot.platform === "weixin" ? "wx" : "qq"}` }, bot.platform === "weixin" ? "微信" : "QQ"), (0, react.createElement)("span", { className: "imqb3-meta" }, `AppID ${bot.appId || "-"}`), (0, react.createElement)("span", { className: "imqb3-meta" }, `${bot.sessions} 个会话`)), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("span", { className: "imqb3-meta" }, "模型"), (0, react.createElement)(ModelSelect, {
					value: routeValue,
					models,
					onChange: (value) => {
						const route = splitRoute(value);
						submit({
							action: "update",
							id: bot.id,
							bot: route === null ? { provider: "", model: "" } : route
						});
					}
				}), (0, react.createElement)("button", {
					type: "button",
					className: "imqb3-btn",
					onClick: () => bot.platform === "weixin" ? startWx(bot.id) : startBind(bot.id)
				}, bot.platform === "weixin" ? "微信重扫" : "扫码重绑"), (0, react.createElement)("button", {
					type: "button",
					className: "imqb3-btn",
					disabled: busy,
					onClick: () => {
						const name = window.prompt?.("机器人名称", bot.name || "");
						if (name !== null && name !== void 0 && name.trim() !== "" && name.trim() !== bot.name) submit({
							action: "rename",
							id: bot.id,
							name: name.trim()
						});
					}
				}, "重命名"), (0, react.createElement)("button", {
					type: "button",
					className: "imqb3-btn imqb3-btn--danger",
					disabled: busy || bots.length <= 1,
					onClick: () => {
						if (window.confirm?.(`删除机器人「${bot.name || bot.id}」？`)) submit({ action: "remove", id: bot.id });
					}
				}, "删除")), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("span", { className: "imqb3-meta" }, "工作目录"), (0, react.createElement)("span", { className: "imqb3-path", title: bot.cwd || "" }, bot.cwd || "(默认 ~/.dsh-qqbot/workspace)"), (0, react.createElement)("button", {
					type: "button",
					className: "imqb3-btn",
					disabled: busy,
					onClick: () => pickDir(bot)
				}, "选择目录")));
			}), (0, react.createElement)("div", { className: "imqb3-add" }, (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "AppID（必填）",
				value: draft.appId,
				onChange: (e) => {
					setDraft({ ...draft, appId: e.currentTarget.value });
				}
			}), (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "AppSecret（必填）",
				type: "password",
				value: draft.appSecret,
				onChange: (e) => {
					setDraft({ ...draft, appSecret: e.currentTarget.value });
				}
			})), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "名称（可选，如 光明）",
				value: draft.name,
				onChange: (e) => {
					setDraft({ ...draft, name: e.currentTarget.value });
				}
			}), (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "标识 id（可选，工具参数用）",
				value: draft.id,
				onChange: (e) => {
					setDraft({ ...draft, id: e.currentTarget.value });
				}
			}), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--primary",
				disabled: busy || draft.appId.trim() === "" || draft.appSecret.trim() === "",
				onClick: () => {
					submit({
						action: "add",
						bot: {
							id: draft.id,
							name: draft.name,
							appId: draft.appId,
							appSecret: draft.appSecret
						}
					});
				}
			}, busy ? "保存中…" : "添加机器人"))), note === null ? null : (0, react.createElement)("p", { className: `imqb3-note${note.ok ? "" : " imqb3-note--error"}` }, (note.ok ? "" : "⚠️ ") + note.message), (0, react.createElement)("p", { className: "imqb3-hint" }, "扫码或填写后写入 cordis.patch.yml，插件自动重载生效；同一 AppID 不会重复添加。"), configured.size > 0 && bots.length === 0 ? (0, react.createElement)("p", { className: "imqb3-note" }, `已配置 ${configured.size} 个机器人，但当前都未成功连接：检查 AppSecret 或额外配置里的 enabled: false。`) : null);
		}
		//#endregion
		//#region src/client/automation-panel.ts（自动化任务：时间 + 事件）
		const AUTOMATION_PATH = "/qqbot/automation";
		const TRIGGER_LABEL = {
			time: "时间",
			event: "事件"
		};
		function automationTask(draft) {
			return {
				name: draft.name,
				enabled: true,
				trigger: draft.triggerType === "event" ? {
					type: "event",
					...(draft.eventBot ? { botId: draft.eventBot } : {}),
					...(draft.keyword ? { keyword: draft.keyword } : {}),
					cron: draft.cron
				} : {
					type: "time",
					cron: draft.cron
				},
				action: {
					botId: draft.botId,
					prompt: draft.prompt,
					target: {
						kind: draft.targetKind,
						id: draft.targetId
					}
				}
			};
		}
		function AutomationPanel() {
			useBotsPanelStyles();
			const [data, setData] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [note, setNote] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)({
				name: "",
				triggerType: "time",
				cron: "0 9 * * *",
				eventBot: "",
				keyword: "",
				botId: "",
				targetKind: "source",
				targetId: "",
				prompt: ""
			});
			const load = (0, react.useCallback)(() => {
				fetch(AUTOMATION_PATH, { cache: "no-store" }).then(async (res) => {
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					return res.json();
				}).then(setData).catch((err) => {
					setNote({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				});
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const post = (0, react.useCallback)(async (payload) => {
				setBusy(true);
				setNote(null);
				try {
					const res = await fetch(AUTOMATION_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload)
					});
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok) {
						if (body.tasks !== void 0) setData(body);
						setNote({ ok: true, message: body.message ?? "已保存" });
					}
					else setNote({ ok: false, message: body.error ?? `HTTP ${res.status}` });
				}
				catch (err) {
					setNote({ ok: false, message: err instanceof Error ? err.message : String(err) });
				}
				finally {
					setBusy(false);
				}
			}, []);
			const bots = data?.bots ?? [];
			const tasks = data?.tasks ?? [];
			const patch = (key, value) => {
				setDraft(current => ({ ...current, [key]: value }));
				setNote(null);
			};
			const botSelect = (value, onChange, allowEmpty, emptyLabel) => (0, react.createElement)("select", {
				className: "imqb3-select",
				value,
				onChange: (e) => onChange(e.currentTarget.value)
			}, allowEmpty ? (0, react.createElement)("option", { value: "" }, emptyLabel ?? "任意机器人") : null, bots.map(bot => (0, react.createElement)("option", {
				key: bot.id,
				value: bot.id
			}, `${bot.platform === "weixin" ? "微信" : "QQ"} · ${bot.name || bot.id}`)));
			return (0, react.createElement)("div", { className: "imqb3" }, (0, react.createElement)("div", { className: "imqb3-head" }, (0, react.createElement)("span", { className: "imqb3-title" }, "自动化任务"), (0, react.createElement)("span", { className: "imqb3-hint" }, "时间触发用 cron（分 时 日 月 周），事件触发在收到消息时跑")), tasks.length === 0 ? (0, react.createElement)("p", { className: "imqb3-note" }, "还没有任务。下面新增一个。") : tasks.map(task => (0, react.createElement)("div", { className: "imqb3-card", key: task.id }, (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("span", { className: `imqb3-dot${task.enabled ? " imqb3-dot--on" : ""}` }), (0, react.createElement)("span", { className: "imqb3-name" }, task.name), (0, react.createElement)("span", { className: "imqb3-meta" }, TRIGGER_LABEL[task.trigger?.type] ?? "时间"), (0, react.createElement)("span", { className: "imqb3-meta" }, task.trigger?.type === "event" ? (task.trigger?.keyword ? `含「${task.trigger.keyword}」` : "任意消息") : task.trigger?.cron ?? ""), (0, react.createElement)("span", { className: "imqb3-meta" }, task.actionText ?? "")), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("span", { className: "imqb3-hint" }, task.lastResult || "尚未运行"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				disabled: busy,
				onClick: () => post({
					action: "toggle",
					id: task.id,
					enabled: !task.enabled
				})
			}, task.enabled ? "停用" : "启用"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn",
				disabled: busy,
				onClick: () => post({
					action: "run",
					id: task.id
				})
			}, "立即运行"), (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--danger",
				disabled: busy,
				onClick: () => {
					if (window.confirm?.(`删除任务「${task.name}」？`)) post({
						action: "remove",
						id: task.id
					});
				}
			}, "删除")))), (0, react.createElement)("div", { className: "imqb3-add" }, (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "任务名称",
				value: draft.name,
				onChange: (e) => patch("name", e.currentTarget.value)
			}), (0, react.createElement)("select", {
				className: "imqb3-select",
				value: draft.triggerType,
				onChange: (e) => patch("triggerType", e.currentTarget.value)
			}, (0, react.createElement)("option", { value: "time" }, "时间触发"), (0, react.createElement)("option", { value: "event" }, "事件触发（收到消息）"))), draft.triggerType === "time" ? (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "cron：分 时 日 月 周（如 0 9 * * * = 每天 9:00）",
				value: draft.cron,
				onChange: (e) => patch("cron", e.currentTarget.value)
			})) : (0, react.createElement)("div", { className: "imqb3-row" }, botSelect(draft.eventBot, v => patch("eventBot", v), true, "任意机器人"), (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: "关键词（可选，留空=任何消息）",
				value: draft.keyword,
				onChange: (e) => patch("keyword", e.currentTarget.value)
			})), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("span", { className: "imqb3-meta" }, "用哪个机器人"), botSelect(draft.botId, v => patch("botId", v), false)), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("span", { className: "imqb3-meta" }, "发到"), (0, react.createElement)("select", {
				className: "imqb3-select",
				value: draft.targetKind,
				onChange: (e) => patch("targetKind", e.currentTarget.value)
			}, (0, react.createElement)("option", { value: "source" }, "事件来源（仅事件触发）"), (0, react.createElement)("option", { value: "group" }, "QQ 群号"), (0, react.createElement)("option", { value: "private" }, "QQ 私聊 openid / 微信 userId")), draft.targetKind === "source" ? null : (0, react.createElement)("input", {
				className: "imqb3-input",
				placeholder: draft.targetKind === "group" ? "群号，如 768840065" : "QQ openid 或微信 userId",
				value: draft.targetId,
				onChange: (e) => patch("targetId", e.currentTarget.value)
			})), (0, react.createElement)("textarea", {
				className: "imqb3-input imqb3-textarea",
				rows: 4,
				placeholder: "提示词：让机器人做什么（事件触发时会自动附上消息内容和时间）",
				value: draft.prompt,
				onChange: (e) => patch("prompt", e.currentTarget.value)
			}), (0, react.createElement)("div", { className: "imqb3-row" }, (0, react.createElement)("button", {
				type: "button",
				className: "imqb3-btn imqb3-btn--primary",
				disabled: busy || draft.name.trim() === "" || draft.prompt.trim() === "" || (draft.triggerType === "time" && draft.cron.trim() === ""),
				onClick: () => {
					post({
						action: "add",
						task: automationTask(draft)
					}).then(() => {
						setDraft({ ...draft, name: "", prompt: "", targetId: "", keyword: "" });
					});
				}
			}, busy ? "保存中…" : "添加任务"))), note === null ? null : (0, react.createElement)("p", { className: `imqb3-note${note.ok ? "" : " imqb3-note--error"}` }, (note.ok ? "" : "⚠️ ") + note.message), (0, react.createElement)("p", { className: "imqb3-hint" }, "cron 示例：0 9 * * * 每天 9:00；*/30 * * * * 每 30 分钟；0 20 * * 0 每周日 20:00。事件触发只对已连接的机器人生效。"));
		}
		//#endregion
		/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
		/** 插件更新条：从仓库拉取最新的 qq 管家技术栈 */
		function PluginUpdateBar() {
			const [busy, setBusy] = react.useState(false);
			const [note, setNote] = react.useState("");
			const run = async () => {
				setBusy(true);
				setNote("");
				try {
					const res = await fetch("/archive2", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ action: "update" })
					});
					const body = await res.json().catch(() => ({}));
					if (body.ok === false) throw new Error(body.error || "更新失败");
					setNote(body.changed
						? "✅ 已更新到 " + body.version + (body.restart ? "，重启桌面端后生效" : "")
						: "✅ 已是最新版本 " + body.version);
				}
				catch (err) {
					setNote("⚠️ " + (err && err.message ? err.message : String(err)));
				}
				finally {
					setBusy(false);
				}
			};
			return react.createElement("div", {
				style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }
			},
				react.createElement("button", { className: "imqb3-btn", type: "button", disabled: busy, onClick: run }, busy ? "更新中…" : "检查更新"),
				note === "" ? null : react.createElement("span", { className: "imqb3-hint" }, note));
		}
		function QQBotSettingsSection() {
			const { state, gone, recheck } = useBindState();
			const [hasBots, setHasBots] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let stopped = false;
				fetch(BOTS_PATH, { cache: "no-store" }).then((res) => res.ok ? res.json() : null).then((body) => {
					if (!stopped) setHasBots(((body?.bots ?? []).length) > 0);
				}).catch(() => {
					if (!stopped) setHasBots(false);
				});
				return () => {
					stopped = true;
				};
			}, []);
			// 有已连接的机器人时只显示多机器人面板；扫码绑定/单机器人配置仅在没有机器人时出现
			const showLegacy = hasBots !== true;
			return (0, react.createElement)("div", null, (0, react.createElement)(PluginUpdateBar, null), (0, react.createElement)(BotsPanel, null), showLegacy ? (0, react.createElement)(BindPanelBody, {
				state,
				gone,
				recheck
			}) : null, showLegacy ? (0, react.createElement)(ConfigPanel, { bindPhase: state?.phase }) : null);
		}
		/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
		function QQBotPage() {
			return (0, react.createElement)("div", { className: "imqb-pluginPage" }, (0, react.createElement)("div", { className: "imqb-pluginPageContent" }, (0, react.createElement)(QQBotSettingsSection)));
		}
		/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
		function QqBotSidebarIcon({ size = 16 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			}));
		}
		/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
		function OpenQqBotAction({ subject, packageName, onOpen }) {
			if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
			if (subject.pkg?.name !== packageName) return null;
			if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
			return (0, react.createElement)("button", {
				type: "button",
				className: "imqb-pluginOpen",
				onClick: onOpen
			}, "设置");
		}
		function apply(ctx) {
			installPanelStyles();
			const tabs = ctx.sidebarRightTabs;
			const right = ctx.sidebarRight;
			const slots = ctx.slots;
			const disposers = [];
			if (slots !== void 0) disposers.push(slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "qqbot",
				order: 7,
				label: "QQ 机器人"
			}, QQBotSettingsSection)));
			if (tabs !== void 0 && slots !== void 0) {
				disposers.push(tabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					title: () => "QQ 机器人绑定",
					guide: [{
						id: "bind",
						order: 90,
						title: () => "QQ 机器人绑定",
						description: () => "扫码或手动填写，绑定 QQ 机器人",
						icon: BindGuideIcon
					}]
				}));
				disposers.push(slots.inject("sidebar.right.pane.tab", () => slots.register({
					name: "sidebar.right.pane.tab",
					key: TAB_ID
				}, BindPanelBody)));
				disposers.push(watchAndPrompt(right));
			}
			const ctxInject = ctx.inject;
			if (typeof ctxInject === "function") ctxInject.call(ctx, ["layout"], (pageCtx) => {
				const pageSlots = pageCtx.slots;
				const layout = pageCtx.layout;
				if (pageSlots === void 0 || layout === void 0) return void 0;
				const stopMain = pageSlots.inject("main", () => pageSlots.register({
					name: "main",
					key: IM_MAIN_PANEL_ID
				}, QQBotPage));
				const stopActions = pageSlots.inject("plugins.detail.actions", () => pageSlots.register({
					name: "plugins.detail.actions",
					id: "im-qqbot-open",
					order: 20,
					inject: () => ({
						packageName: PACKAGE_NAME,
						onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID)
					})
				}, OpenQqBotAction));
				const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register({
					name: "sidebar.panellist",
					id: IM_MAIN_PANEL_ID,
					order: 10,
					label: "QQ 机器人"
				}, QqBotSidebarIcon));
				return () => {
					stopActions();
					stopSidebar();
					stopMain();
				};
			});
			ctx.effect(() => () => {
				for (const dispose of disposers.reverse()) dispose();
			}, "im-qqbot-client.binding");
		}
		/**
		* 轮询绑定状态：待绑定时自动打开绑定页。
		*
		* - 页面隐藏时降频轮询（可见时立即恢复节拍）
		* - 404（已绑定/未安装）时退避到 30s，保持低成本常驻探测
		* - 每次页面加载至多打开一次（用户手动关闭后不打扰）；
		*   打开失败（如启动早期 Session surface 尚未挂载）不消费机会，
		*   由下一轮轮询（3s）自动重试
		*/
		function watchAndPrompt(right) {
			let stopped = false;
			let opened = right === void 0;
			let timer;
			const schedule = (ms) => {
				timer = setTimeout(() => {
					tick();
				}, ms);
			};
			const tick = async () => {
				if (stopped) return;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") {
					schedule(5e3);
					return;
				}
				try {
					const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
					if (res.ok) {
						if ((await res.json()).phase === "waiting" && !opened && right !== void 0) try {
							right.openTab(TAB_KIND);
							opened = true;
						} catch (err) {
							console.error("[im-qqbot] 打开绑定页失败，稍后重试", err);
						}
						schedule(3e3);
						return;
					}
					schedule(3e4);
					return;
				} catch {}
				schedule(1e4);
			};
			tick();
			return () => {
				stopped = true;
				if (timer !== void 0) clearTimeout(timer);
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map