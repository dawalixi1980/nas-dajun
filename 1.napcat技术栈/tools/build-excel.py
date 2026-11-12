#!/usr/bin/env python3
"""
施工日志 / 单价台账 Excel 生成器（规则提取版，不调用模型）

输入：<目标根>/<项目>/结构/<年.月>/<日>/events.jsonl
输出：<目标根>/<项目>/输出/施工日志与单价台账.xlsx

设计原则：
  - 能从文本里用规则抽到的就抽（天气/桩号/单位/分项/单价/数量）
  - 抽不到就留空，绝不编造
  - 台账只记录原文里明确出现的数字与单价
"""
import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# ---------- 道路工程分项体系 ----------
DIVISIONS = {
    "路基": ["路基", "清表", "土方", "填筑", "压实", "路床", "边坡", "换填", "软基"],
    "路面": ["路面", "底基层", "基层", "面层", "沥青", "水稳", "水泥稳定", "碎石垫层"],
    "挡土墙": ["挡土墙", "挡墙", "墙身", "泄水孔", "墙背回填"],
    "桥涵": ["桥", "涵", "桩基", "承台", "台身", "梁板", "盖梁", "桥面", "涵洞", "墩柱"],
    "排渠": ["排渠", "沟槽", "管道", "检查井", "雨水管", "污水管", "箱涵", "盖板"],
}

WEATHER = ["晴", "多云", "阴", "小雨", "中雨", "大雨", "阵雨", "雷阵雨", "雪", "雾", "大风", "阴天"]

# 单价：480元/方、单价480、480 元每方
PRICE_PATTERNS = [
    re.compile(r"(?:单价|价格为|价格)[:：]?\s*(\d+(?:\.\d+)?)"),
    re.compile(r"(\d+(?:\.\d+)?)\s*元\s*/\s*(方|m3|m³|吨|平方|m2|m²|米|个|根|立方|车)"),
    re.compile(r"(\d+(?:\.\d+)?)\s*元每\s*(方|吨|平方|米|个|根|立方)"),
]

UNIT_NORMAL = {
    "方": "m³", "m3": "m³", "m³": "m³", "立方": "m³",
    "平方": "m²", "m2": "m²", "m²": "m²",
    "吨": "吨", "米": "米", "个": "个", "根": "根", "车": "车",
}

# 数量：120方、30吨
QTY_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(方|m3|m³|吨|平方|m2|m²|米|个|根|立方|车)")
# 桩号 / 部位
LOC_PATTERNS = [
    re.compile(r"([Kk]\d+\s*[+＋]\s*\d+(?:\.\d+)?)"),
    re.compile(r"(\d+号(?:路|桥|涵|渠|楼|井|段))"),
    re.compile(r"([一二三四五六七八九十]+标段)"),
]
ORG_PATTERN = re.compile(r"(建设|施工|监理)单位[:：]?\s*([^\s，,。；;]{2,20})")


def norm_unit(u: str) -> str:
    return UNIT_NORMAL.get(u, u)


def classify_division(text: str):
    for div, kws in DIVISIONS.items():
        for kw in kws:
            if kw in text:
                return div
    return None


def extract_weather(text: str):
    for w in WEATHER:
        if w in text:
            return w
    return None


def extract_location(text: str):
    for pat in LOC_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1).replace(" ", "").replace("＋", "+")
    return None


def extract_orgs(text: str):
    out = {}
    for m in ORG_PATTERN.finditer(text):
        out[f"{m.group(1)}单位"] = m.group(2)
    return out


def extract_price(text: str):
    """返回 (单价, 单位) —— 只认明确的「元/单位」写法。"""
    for pat in PRICE_PATTERNS:
        m = pat.search(text)
        if m:
            val = float(m.group(1))
            unit = norm_unit(m.group(2)) if pat.groups >= 2 and m.group(2) else None
            return val, unit
    return None, None


def extract_qty(text: str):
    """返回 (数量, 单位)。

    先把「N元/单位」整体挖掉，避免把单价里的数字当成数量；
    挖掉之后，同一条消息里剩下的「N单位」就是真实数量
    （例如「480元/方，今天浇了 35方」→ 35方）。
    """
    cleaned = re.sub(r"\d+(?:\.\d+)?\s*元\s*/\s*(?:方|m3|m³|吨|平方|m2|m²|米|个|根|立方|车)", " ", text)
    for m in QTY_PATTERN.finditer(cleaned):
        return float(m.group(1)), norm_unit(m.group(2))
    return None, None


def fmt_time(ts):
    try:
        return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def load_events(structure_root: Path):
    """按项目聚合 events.jsonl。"""
    # 布局：<root>/<项目>/结构/<年.月>/<日>/events.jsonl
    projects = defaultdict(list)
    for ev_file in structure_root.glob("*/结构/*/*/events.jsonl"):
        project = ev_file.parts[-5]
        for line in ev_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            ev["_project"] = project
            projects[project].append(ev)
    return projects


def style_header(ws, widths):
    fill = PatternFill("solid", fgColor="1F4E78")
    font = Font(color="FFFFFF", bold=True, size=11)
    for i, w in enumerate(widths, start=1):
        c = ws.cell(row=1, column=i)
        c.fill = fill
        c.font = font
        c.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def build_log_sheet(wb, project, events):
    """施工日志：一行一条有内容的消息（图片单独成行）。"""
    ws = wb.create_sheet("施工日志")
    headers = ["项目名称", "日期", "拍摄时间", "天气", "地点",
               "建设单位", "施工单位", "监理单位", "分项工程", "部位", "事项", "图片"]
    ws.append(headers)
    style_header(ws, [18, 12, 16, 8, 14, 16, 16, 16, 12, 14, 60, 24])

    # 汇总天气/单位：一天内任何一条提到就用它
    day_weather = {}
    day_orgs = {}
    for ev in events:
        raw = ev.get("raw") or {}
        text = (raw.get("text") or "").strip()
        day = ev.get("date") or ""
        if not day:
            continue
        w = extract_weather(text)
        if w and day not in day_weather:
            day_weather[day] = w
        for k, v in extract_orgs(text).items():
            day_orgs.setdefault(day, {}).setdefault(k, v)

    rows = 0
    for ev in sorted(events, key=lambda e: (e.get("date") or "", (e.get("raw") or {}).get("time") or 0)):
        raw = ev.get("raw") or {}
        text = (raw.get("text") or "").strip()
        day = ev.get("date") or ""
        # 跳过纯占位与极短噪音
        if text in ("", "[图片]", "[表情]", "[语音]", "[视频]") or len(text) < 2:
            continue
        orgs = day_orgs.get(day, {})
        ws.append([
            project, day, fmt_time(raw.get("time")),
            day_weather.get(day) or "",
            extract_location(text) or "",
            orgs.get("建设单位", ""), orgs.get("施工单位", ""), orgs.get("监理单位", ""),
            classify_division(text) or "",
            "", text, "",
        ])
        rows += 1
    return rows


def build_price_sheet(wb, project, events):
    """单价台账：只记录原文里出现数字+单位的行。"""
    ws = wb.create_sheet("单价台账")
    headers = ["日期", "项目名称", "事项", "单位", "数量", "单价", "金额", "依据原文", "备注"]
    ws.append(headers)
    style_header(ws, [12, 18, 40, 8, 10, 10, 12, 50, 20])

    rows = 0
    for ev in sorted(events, key=lambda e: (e.get("date") or "", (e.get("raw") or {}).get("time") or 0)):
        raw = ev.get("raw") or {}
        text = (raw.get("text") or "").strip()
        if not text:
            continue
        price, punit = extract_price(text)
        qty, qunit = extract_qty(text)
        if price is None and qty is None:
            continue
        amount = round(price * qty, 2) if (price is not None and qty is not None) else None
        ws.append([
            ev.get("date") or "", project, text[:120],
            punit or qunit or "", qty if qty is not None else "",
            price if price is not None else "", amount if amount is not None else "",
            text[:200],
            "" if price is not None else "原文未提及单价",
        ])
        rows += 1
    return rows


def find_project_info_dirs(roots):
    """在给定目录下找名为「项目信息」的子目录（最多两层）。"""
    found = []
    for r in roots:
        p = Path(r).expanduser()
        if not p.is_dir():
            continue
        if p.name == "项目信息":
            found.append(p)
            continue
        for child in p.iterdir():
            if child.is_dir() and child.name == "项目信息":
                found.append(child)
    return found


def default_roots():
    home = Path.home()
    return [home / "项目文件", home / "Documents", home / "Desktop"]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--scan" in sys.argv or not args:
        targets = find_project_info_dirs(default_roots())
        if not targets:
            print("没有找到名为「项目信息」的目录。")
            return
    else:
        targets = [Path(args[0]).expanduser()]

    grand_total = 0
    for root in targets:
        if not root.is_dir():
            print(f"跳过（不存在）：{root}")
            continue
        print(f"源：{root}")
        grand_total += build_one(root)
    print(f"\n完成：{grand_total} 个项目")


def build_one(root):
    structure = root  # 项目目录直接位于根下
    projects = load_events(structure)
    if not projects:
        print("  （结构层里没有 events.jsonl，先跑 build-structure）")
        return 0

    total = 0
    for project, events in sorted(projects.items()):
        out_dir = root / project / "输出"
        out_dir.mkdir(parents=True, exist_ok=True)

        wb = Workbook()
        wb.remove(wb.active)
        n_log = build_log_sheet(wb, project, events)
        n_price = build_price_sheet(wb, project, events)
        wb.save(out_dir / "施工日志与单价台账.xlsx")

        print(f"  {project}: 日志 {n_log} 行 / 台账 {n_price} 行 → {out_dir}/施工日志与单价台账.xlsx")
        total += 1
    return total


if __name__ == "__main__":
    main()
