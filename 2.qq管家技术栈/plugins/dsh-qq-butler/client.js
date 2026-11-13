window.__ModuleLoader__.load({
  id: "dsh-qq-butler",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;

    let clientCtx = null;
    let clientRemote = null;
    const API = "/archive2";
    const BOTS_API = "/qqbot/bots";

    const css = {
      wrap: { display: "flex", flexDirection: "column", gap: 14, fontSize: 13, padding: "4px 2px" },
      card: {
        border: "0.5px solid var(--dsw-alias-border-l2)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      },
      title: { fontSize: 14, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 },
      sub: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: 0, lineHeight: "18px" },
      path: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        background: "rgba(127,127,127,.12)",
        padding: "5px 8px",
        borderRadius: 6,
        wordBreak: "break-all",
      },
      row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
      botRow: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "10px 0",
        borderTop: "0.5px solid var(--dsw-alias-border-l2)",
      },
      name: { fontWeight: 600, fontSize: 13.5 },
      meta: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11.5 },
      dot: { width: 7, height: 7, borderRadius: 99, display: "inline-block" },
      seg: { display: "inline-flex", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 7, overflow: "hidden" },
      segBtn: {
        border: "none",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary)",
        fontSize: 12,
        padding: "5px 10px",
        cursor: "pointer",
      },
      segOn: { background: "var(--dsw-alias-brand-primary)", color: "#fff" },
      btn: {
        background: "var(--dsw-alias-brand-primary)",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        height: 28,
        padding: "0 12px",
        cursor: "pointer",
        fontSize: 12,
      },
      ghost: {
        background: "transparent",
        color: "var(--dsw-alias-label-primary)",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: 6,
        height: 28,
        padding: "0 12px",
        cursor: "pointer",
        fontSize: 12,
      },
      err: { color: "#c0392b", fontSize: 12 },
    };

    const MODES = [
      { id: "collect", label: "静默收集", hint: "收全部消息（含图片），只在 @ 时回复" },
      { id: "off", label: "不收集", hint: "不保存任何消息，只在 @ 时回复" },
      { id: "active", label: "活跃", hint: "收全部消息，并且每条都回复" },
    ];

    function Segmented({ value, onChange, disabled }) {
      return h(
        "div",
        { style: css.seg },
        MODES.map((m) =>
          h(
            "button",
            {
              key: m.id,
              title: m.hint,
              style: Object.assign({}, css.segBtn, value === m.id ? css.segOn : {}),
              disabled,
              onClick: () => onChange(m.id),
            },
            m.label,
          ),
        ),
      );
    }

    function Panel() {
      const [data, setData] = useState(null);
      const [bots, setBots] = useState([]);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [flash, setFlash] = useState("");
      const [rootDraft, setRootDraft] = useState("");
      const [commands, setCommands] = useState([]);
      const [updating, setUpdating] = useState(false);
      const [browser, setBrowser] = useState({ open: false, path: "", parent: "", entries: [], error: "", loading: false });

      const load = useCallback(async () => {
        try {
          const [archiveRes, botsRes] = await Promise.all([
            fetch(API, { headers: { accept: "application/json" } }),
            fetch(BOTS_API, { headers: { accept: "application/json" } }).catch(() => null),
          ]);
          if (!archiveRes.ok) throw new Error("HTTP " + archiveRes.status);
          const snapshot = await archiveRes.json();
          setData(snapshot);
          setRootDraft(snapshot.root || "");
          if (botsRes && botsRes.ok) {
            const payload = await botsRes.json();
            setBots(Array.isArray(payload.bots) ? payload.bots : []);
          }
          try {
            const cmdRes = await fetch(API, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "commands" }),
            });
            const cmdPayload = await cmdRes.json();
            setCommands(Array.isArray(cmdPayload.commands) ? cmdPayload.commands : []);
          } catch { /* 命令库拿不到不影响主流程 */ }
          setError("");
        } catch (err) {
          setError("读取状态失败：" + (err && err.message ? err.message : String(err)));
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const post = useCallback(async (body, okText) => {
        setBusy(true);
        setError("");
        try {
          const res = await fetch(API, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const payload = await res.json();
          if (!res.ok || payload.ok === false) throw new Error(payload.error || "HTTP " + res.status);
          setData(payload);
          setFlash(okText);
          setTimeout(() => setFlash(""), 2000);
        } catch (err) {
          setError("操作失败：" + (err && err.message ? err.message : String(err)));
        } finally {
          setBusy(false);
        }
      }, []);

      const listDir = useCallback(async (path) => {
        try {
          const res = await fetch(API, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "listDir", path }),
          });
          const payload = await res.json();
          if (!res.ok || payload.ok === false) throw new Error(payload.error || "HTTP " + res.status);
          setBrowser({ open: true, path: payload.path, parent: payload.parent, entries: payload.entries || [], error: "", loading: false });
        } catch (err) {
          setBrowser((prev) => ({
            ...prev,
            open: true,
            error: "读取目录失败：" + (err && err.message ? err.message : String(err)),
            loading: false,
          }));
        }
      }, []);

      const nativePick = useCallback(async () => {
        setBusy(true);
        setError("");
        try {
          const res = await fetch("/qqbot/bots/pick-dir", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const payload = await res.json();
          if (!res.ok || payload.ok === false) throw new Error(payload.error || "HTTP " + res.status);
          if (payload.cancelled) {
            setFlash("已取消选择");
            setTimeout(() => setFlash(""), 2000);
            return;
          }
          const picked = String(payload.path || "");
          if (!picked) throw new Error("选择器没有返回路径");
          setRootDraft(picked);
          await post({ action: "setRoot", root: picked }, "已选择：" + picked);
        } catch (err) {
          setError("选择文件夹失败：" + (err && err.message ? err.message : String(err)));
        } finally {
          setBusy(false);
        }
      }, [post]);

      if (data === null) {
        return h("div", { style: css.wrap }, h("p", { style: css.sub }, error || "加载中…"));
      }

      const defaultMode = (data.modes && data.modes.default) || "collect";
      const botModes = (data.modes && data.modes.bots) || {};
      const groups = Array.isArray(data.groups) ? data.groups : [];
      const countOf = (botId) => groups.filter((g) => g.botId === botId).length;

      const rows = bots.length > 0
        ? bots
        : Object.keys(botModes).map((id) => ({ id, name: id, ready: false }));

      return h(
        "div",
        { style: css.wrap },

        h(
          "div",
          { style: css.card },
          h("p", { style: css.title }, "QQ 管家"),
          h("p", { style: css.sub }, "策略按机器人设置，作用于它的所有群聊。"),
          h(
            "div",
            { style: css.row },
            h("button", { style: css.ghost, disabled: busy, onClick: () => post({ action: "organize" }, "已整理") }, "立即整理"),
            h("button", { style: css.ghost, disabled: busy, onClick: load }, "刷新"),
            h("button", {
              style: css.ghost,
              disabled: updating,
              onClick: async () => {
                setUpdating(true);
                setError("");
                setFlash("正在连接 GitHub…");
                try {
                  const res = await fetch(API, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ action: "update" }),
                  });
                  const payload = await res.json();
                  if (payload.ok === false) throw new Error(payload.error || "更新失败");
                  setFlash(payload.changed
                    ? `已更新到 ${payload.version}${payload.restart ? "（需重启桌面端）" : ""}`
                    : `已是最新版本 ${payload.version}`);
                  setTimeout(() => setFlash(""), 6000);
                  await load();
                } catch (err) {
                  setError("更新失败：" + (err && err.message ? err.message : String(err)));
                } finally {
                  setUpdating(false);
                }
              },
            }, updating ? "更新中…" : "检查更新"),
            flash ? h("span", { style: css.meta }, flash) : null,
          ),
          h(
            "p",
            { style: Object.assign({}, css.meta, { margin: 0, opacity: 0.75 }) },
            "仓库 github.com/dawalixi1980/nas-dajun · 目录 2.qq管家技术栈 · © 2026 dawalixi1980",
          ),
          error ? h("p", { style: css.err }, error) : null,
        ),

        h(
          "div",
          { style: css.card },
          h("p", { style: css.title }, "归档目录"),
          h("input", {
            style: Object.assign({}, css.path, {
              border: "1px solid var(--dsw-alias-border-l2)",
              width: "100%",
              boxSizing: "border-box",
              color: "var(--dsw-alias-label-primary)",
              outline: "none",
            }),
            value: rootDraft,
            placeholder: "例如 /Users/dada/项目文件/QQ归档2",
            onChange: (e) => setRootDraft(e.target.value),
          }),
          h(
            "div",
            { style: css.row },
            h("button", {
              style: css.btn,
              disabled: busy,
              onClick: () => post({ action: "setRoot", root: rootDraft.trim() }, "归档目录已更新"),
            }, "保存目录"),
            h("button", {
              style: css.ghost,
              disabled: busy,
              onClick: nativePick,
            }, "选择文件夹…"),
            h("button", {
              style: css.ghost,
              onClick: () => {
                if (browser.open) {
                  setBrowser({ open: false, path: "", parent: "", entries: [], error: "", loading: false });
                  return;
                }
                const start = rootDraft.trim() || data.root || "";
                setBrowser({ open: true, path: start, parent: "", entries: [], error: "", loading: true });
                listDir(start);
              },
            }, browser.open ? "收起" : "浏览文件夹"),
            h("button", {
              style: css.ghost,
              onClick: () => {
                setBrowser({ open: true, path: "/Users/dada", parent: "/Users", entries: [], error: "", loading: true });
                listDir("/Users/dada");
              },
            }, "主目录"),
            browser.open
              ? h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: 6, width: "100%" } },
                  h("div", { style: css.row },
                    h("button", { style: css.ghost, onClick: () => listDir(browser.parent || browser.path) }, "上一级"),
                    h("span", { style: css.meta }, browser.path),
                  ),
                  browser.loading ? h("p", { style: css.sub }, "读取中…") : null,
                  browser.error ? h("p", { style: css.err }, browser.error) : null,
                  browser.entries.length === 0 && !browser.error
                    ? h("p", { style: css.sub }, "（没有子目录）")
                    : h(
                        "div",
                        { style: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 180, overflowY: "auto", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: "4px 6px" } },
                        browser.entries.map((entry) =>
                          h(
                            "button",
                            {
                              key: entry.path,
                              style: Object.assign({}, css.segBtn, { textAlign: "left", width: "100%", padding: "4px 6px" }),
                              onClick: () => listDir(entry.path),
                            },
                            "📁 " + entry.name,
                          ),
                        ),
                      ),
                  h("button", {
                    style: css.btn,
                    disabled: busy,
                    onClick: async () => {
                      setRootDraft(browser.path);
                      await post({ action: "setRoot", root: browser.path }, "归档目录已更新");
                      setBrowser({ open: false, path: "", parent: "", entries: [], error: "" });
                    },
                  }, "使用这个目录"),
                )
              : null,
          ),
          h(
            "p",
            { style: css.sub },
            "机器人进群后，第一次收到消息就会在这里建「机器人名/群文件夹」，按天保存消息，图片放在「媒体/日期」下。",
          ),
        ),

        h(
          "div",
          { style: css.card },
          h("p", { style: css.title }, "桥接归档"),
          h("p", { style: css.sub }, "选中的机器人会在归档目录旁额外生成「<机器人>工程信息」，按 年.月/日 结构整理，含聊天记录、events.jsonl 和图片。"),
          (bots.length > 0 ? bots : Object.keys(botModes).map((id) => ({ id, name: id }))).map((bot) => {
            const on = Array.isArray(data.bridgeBots) && data.bridgeBots.includes(bot.id);
            return h(
              "div",
              { key: "bridge-" + bot.id, style: css.row },
              h("span", { style: Object.assign({}, css.dot, { background: on ? "#2ecc71" : "#bbb" }) }),
              h("span", { style: css.name }, bot.name || bot.id),
              h("button", {
                style: Object.assign({}, on ? css.btn : css.ghost, { height: 24, padding: "0 10px", fontSize: 11.5 }),
                disabled: busy,
                onClick: () => post({ action: "setBridge", bot: bot.id, enabled: !on }, on ? "已取消桥接" : "已加入桥接"),
              }, on ? "桥接中" : "设为桥接对象"),
            );
          }),
          h(
            "div",
            { style: css.row },
            h("button", { style: css.ghost, disabled: busy, onClick: () => post({ action: "organize" }, "已重新生成") }, "立即生成"),
          ),
        ),

        h(
          "div",
          { style: css.card },
          h("p", { style: css.title }, "工程信息"),
          (Array.isArray(data.bridged) && data.bridged.length > 0)
            ? data.bridged.map((item) =>
                h("div", { key: "info-" + item.botId, style: css.groupRow },
                  h("div", { style: css.row },
                    h("span", { style: css.name }, item.botName + "工程信息"),
                    h("span", { style: css.meta }, (item.groups || []).length + " 个群"),
                  ),
                  h("div", { style: css.path }, item.outDir),
                  (item.groups || []).map((group) =>
                    h("div", { key: group.label, style: css.row },
                      h("span", { style: css.meta }, group.label),
                      h("span", { style: css.meta }, group.hasLog ? "✅ 施工日志" : "⏳ 施工日志"),
                      h("span", { style: css.meta }, group.hasLedger ? "✅ 单价台账" : "⏳ 单价台账"),
                    ),
                  ),
                ),
              )
            : h("p", { style: css.sub }, "还没有桥接任何机器人。在上面的「桥接归档」里选一个。"),
        ),

        h(
          "div",
          { style: css.card },
          h("p", { style: css.title }, "新机器人的默认策略"),
          h(Segmented, {
            value: defaultMode,
            disabled: busy,
            onChange: (mode) => post({ action: "setDefaultMode", mode }, "默认策略已更新"),
          }),
        ),

        h(
          "div",
          { style: css.card },
          h("p", { style: css.title }, "机器人（" + rows.length + "）"),
          rows.length === 0
            ? h("p", { style: css.sub }, "没有已连接的机器人。")
            : rows.map((bot) => {
                const mode = botModes[bot.id] || defaultMode;
                const current = MODES.find((m) => m.id === mode) || MODES[0];
                return h(
                  "div",
                  { key: bot.id, style: css.botRow },
                  h(
                    "div",
                    { style: css.row },
                    h("span", {
                      style: Object.assign({}, css.dot, { background: bot.ready ? "#2ecc71" : "#bbb" }),
                    }),
                    h("span", { style: css.name }, bot.name || bot.id),
                    h("span", { style: css.meta }, "已归档 " + countOf(bot.id) + " 个群"),
                  ),
                  h(
                    "div",
                    { style: css.row },
                    h(Segmented, {
                      value: mode,
                      disabled: busy,
                      onChange: (next) => post({ action: "setMode", bot: bot.id, mode: next }, "已切换"),
                    }),
                    h("span", { style: css.meta }, current.hint),
                  ),
                );
              }),
        ),
        h(
          "div",
          { style: css.card },
          h("p", { style: css.title }, "命令库"),
          h("p", { style: css.sub }, "群聊里可用的命令"),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 4 } },
            commands.filter((item) => item.scope !== "c2c").map((item) =>
              h("div", { key: "g-" + item.name, style: css.row },
                h("code", { style: Object.assign({}, css.meta, { color: "var(--dsw-alias-label-primary)" }) }, item.name),
                h("span", { style: css.meta }, item.desc),
              ),
            ),
          ),
          h("p", { style: css.sub }, "私聊里可用的命令"),
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 4 } },
            commands.filter((item) => item.scope !== "group").map((item) =>
              h("div", { key: "c-" + item.name, style: css.row },
                h("code", { style: Object.assign({}, css.meta, { color: "var(--dsw-alias-label-primary)" }) }, item.name),
                h("span", { style: css.meta }, item.desc),
              ),
            ),
          ),
        ),

      );
    }

    const inject = ["slots", "remote", "remote.directoryPicker"];

    function apply(ctx) {
      clientCtx = ctx;
      clientRemote = ctx.remote;
      ctx.effect(
        () =>
          ctx.slots.inject(
            "settings.section",
            () =>
              ctx.slots.register(
                { name: "settings.section", id: "qq-butler", order: 8, label: () => "QQ 管家" },
                Panel,
              ),
            "qq-butler: settings section",
          ),
        "qq-butler: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.QqButlerPanel = Panel;
    return module.exports;
  },
});
