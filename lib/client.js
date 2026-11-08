window.__ModuleLoader__.load({
  id: "dsh-construction-wiki",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;

    const API = "/construction-wiki/api";

    const css = {
      wrap: { display: "flex", flexDirection: "column", gap: 12, fontSize: 13, padding: "4px 2px" },
      card: { border: "0.5px solid var(--dsw-alias-border-l2)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 },
      title: { fontSize: 14, fontWeight: 600, margin: 0 },
      sub: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: 0, lineHeight: "18px" },
      row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
      path: { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, background: "rgba(127,127,127,.12)", padding: "5px 8px", borderRadius: 6, wordBreak: "break-all", flex: 1, minWidth: 220 },
      btn: { background: "var(--dsw-alias-brand-primary)", color: "#fff", border: "none", borderRadius: 6, height: 28, padding: "0 10px", cursor: "pointer", fontSize: 12 },
      ghost: { background: "transparent", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, height: 28, padding: "0 10px", cursor: "pointer", fontSize: 12 },
      kv: { display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5 },
      k: { color: "var(--dsw-alias-label-tertiary)", minWidth: 92 },
      item: { display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: "0.5px solid var(--dsw-alias-border-l2)", fontSize: 12.5 },
      msg: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", minHeight: 16 },
      ok: { color: "#2ea043" },
      warn: { color: "#d29922" },
    };

    function Panel() {
      const [state, setState] = useState(null);
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState("");

      const load = useCallback(async () => {
        try {
          const r = await fetch(API + "/state", { credentials: "same-origin" });
          setState(await r.json());
        } catch (e) { setNote("读取失败：" + String((e && e.message) || e)); }
      }, []);

      useEffect(() => { load(); }, [load]);

      const post = useCallback(async (path, body) => {
        const r = await fetch(API + path, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        return r.json();
      }, []);

      const pick = useCallback(async () => {
        setBusy(true); setNote("等待选择目录…");
        try {
          const p = await post("/pick", {});
          if (!p || !p.path) { setNote("已取消"); return; }
          const r = await post("/root", { path: p.path });
          if (r && r.ok) { setNote("已设置根目录：" + p.path); await load(); }
          else setNote("保存失败：" + String((r && r.error) || ""));
        } catch (e) { setNote("失败：" + String((e && e.message) || e)); }
        finally { setBusy(false); }
      }, [post, load]);

      const build = useCallback(async () => {
        setBusy(true); setNote("正在生成结构层和 Excel…");
        try {
          const r = await post("/build", {});
          if (r && r.ok) { setNote("完成：\n" + (r.structure || "") + "\n" + (r.excel || "")); await load(); }
          else setNote("失败：" + String((r && r.error) || ""));
        } catch (e) { setNote("失败：" + String((e && e.message) || e)); }
        finally { setBusy(false); }
      }, [post, load]);

      const check = useCallback(async () => {
        setBusy(true); setNote("检查更新…");
        try {
          const r = await post("/check-update", {});
          if (r && r.ok) {
            setNote(r.error ? ("检查失败：" + r.error)
              : r.empty ? "仓库还是空的，先把插件推上去"
                : r.upToDate ? ("已是最新（" + (r.latest && r.latest.short) + "）")
                  : ("有新版本：" + (r.latest && r.latest.short) + " " + (r.latest && r.latest.message)));
            await load();
          }
        } catch (e) { setNote("失败：" + String((e && e.message) || e)); }
        finally { setBusy(false); }
      }, [post, load]);

      const open = useCallback(async () => { try { await post("/open", {}); } catch { /* 忽略 */ } }, [post]);

      const updateSkill = useCallback(async () => {
        setBusy(true); setNote("正在从仓库拉取技能…");
        try {
          const r = await post("/update-skill", {});
          if (r && r.ok) {
            setNote("技能已更新：" + (r.written || []).join("、") + "\n保存到 " + r.dst
              + "\n\n提示：技能变化可能影响结构层格式。需要重建请点「生成结构 + Excel」。");
            await load();
          } else setNote("更新失败：" + String((r && r.error) || ""));
        } catch (e) { setNote("失败：" + String((e && e.message) || e)); }
        finally { setBusy(false); }
      }, [post, load]);

      const root = (state && state.root) || "(未设置)";
      const projects = (state && state.projects) || [];
      const update = (state && state.update) || {};

      return h("div", { style: css.wrap },

        h("div", { style: css.card },
          h("h2", { style: css.title }, "施工 Wiki"),
          h("p", { style: css.sub }, "把 QQ 群聊归档整理成按天递进的结构层，并生成施工日志与单价台账 Excel。全程规则处理，不调用模型。"),
          h("div", { style: css.row }, h("code", { style: css.path }, root)),
          h("div", { style: css.row },
            h("button", { style: css.btn, disabled: busy, onClick: pick }, "选择根目录"),
            h("button", { style: css.ghost, disabled: busy, onClick: open }, "在 Finder 打开"),
            h("button", { style: css.btn, disabled: busy, onClick: build }, "生成结构 + Excel"),
          ),
          note ? h("div", { style: css.msg }, note) : null,
        ),

        h("div", { style: css.card },
          h("h2", { style: css.title }, "技能版本"),
          h("div", { style: css.kv }, h("span", { style: css.k }, "仓库"), h("span", null, (state && state.repo) || "-")),
          h("div", { style: css.kv }, h("span", { style: css.k }, "本地版本"),
            h("span", null, String(update.localVersion || "0.1.0") + " / " + (update.localSha || "未同步"))),
          h("div", { style: css.kv }, h("span", { style: css.k }, "远端最新"), h("span", { style: update.upToDate ? css.ok : css.warn },
            update.empty ? "仓库还是空的（还没有提交）"
              : update.latest ? (update.latest.short + "  " + (update.latest.message || ""))
                : (update.error || "未检查"))),
          h("div", { style: css.row },
            h("button", { style: css.ghost, disabled: busy, onClick: check }, "检查更新"),
            h("button", { style: css.btn, disabled: busy, onClick: updateSkill }, "更新技能"),
          ),
          h("p", { style: css.sub }, "只监听仓库的 dajunskill/ 目录。更新后技能定义写入本机 ~/.dsh/skills/construction-wiki/；若技能规则变化，需重建结构层。"),
        ),

        h("div", { style: css.card },
          h("h2", { style: css.title }, "项目 (" + projects.length + ")"),
          projects.length === 0
            ? h("p", { style: css.sub }, "还没有结构层。点「生成结构 + Excel」开始。")
            : projects.map((p) => h("div", { key: p, style: css.item }, h("span", null, p), h("span", { style: css.sub }, "raw / 结构 / 输出"))),
        ),
      );
    }

    const inject = ["slots"];
    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject("settings.section", () => ctx.slots.register(
          { name: "settings.section", id: "construction-wiki", order: 8, label: () => "施工 Wiki" },
          Panel,
        ), "construction-wiki: settings section"),
        "construction-wiki: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.ConstructionWikiPanel = Panel;
    return module.exports;
  },
});
