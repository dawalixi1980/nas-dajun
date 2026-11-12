#!/usr/bin/env python3
"""从结构化归档生成施工日志与单价台账 Excel。

输入：<群目录>/输出/施工数据.json
      { "project": "群名", "records": [ {time,sender,text,categories,weather,places,units,prices,quantities,images} ] }
输出：<群目录>/输出/施工日志.xlsx
      <群目录>/输出/单价台账.xlsx
"""
import json
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

LOG_HEADERS = ["项目名称", "日期", "拍摄时间", "天气", "地点", "建设单位", "施工单位",
               "监理单位", "分项工程", "部位", "事项", "图片"]
LEDGER_HEADERS = ["日期", "项目名称", "事项", "单位", "数量", "单价", "金额", "依据原文", "备注"]


def style_sheet(ws, headers, widths):
    header_fill = PatternFill("solid", fgColor="1F3A5F")
    for index, title in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=index, value=title)
        cell.font = Font(bold=True, color="FFFFFF", name="宋体")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(index)].width = widths[index - 1]
    ws.freeze_panes = "A2"


def unit_of(record, role):
    for item in record.get("units") or []:
        if item.get("role") == role:
            return item.get("name", "")
    return ""


def build(group_dir: Path):
    data_path = group_dir / "输出" / "施工数据.json"
    if not data_path.exists():
        print(f"缺少 {data_path}", file=sys.stderr)
        return 1
    data = json.loads(data_path.read_text(encoding="utf-8"))
    project = data.get("project") or group_dir.name
    records = data.get("records") or []

    out_dir = group_dir / "输出"
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── 施工日志 ──
    log_wb = Workbook()
    log_ws = log_wb.active
    log_ws.title = "施工日志"
    style_sheet(log_ws, LOG_HEADERS, [18, 12, 10, 8, 14, 14, 14, 14, 14, 12, 46, 24])

    row = 2
    for record in records:
        stamp = record.get("time") or ""
        try:
            moment = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone()
            date_text = moment.strftime("%Y-%m-%d")
            time_text = moment.strftime("%H:%M")
        except Exception:
            date_text, time_text = stamp[:10], stamp[11:16]
        images = record.get("images") or []
        values = [
            project, date_text, time_text,
            "、".join(record.get("weather") or []),
            "、".join(record.get("places") or []),
            unit_of(record, "建设单位"), unit_of(record, "施工单位"), unit_of(record, "监理单位"),
            "、".join(record.get("categories") or []),
            "",
            (record.get("text") or "").strip(),
            "、".join(Path(item).name for item in images),
        ]
        if all(value == "" for value in values[10:]):
            continue
        for column, value in enumerate(values, start=1):
            cell = log_ws.cell(row=row, column=column, value=value)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.font = Font(name="宋体", size=10)
        row += 1

    # ── 单价台账 ──
    ledger_wb = Workbook()
    ledger_ws = ledger_wb.active
    ledger_ws.title = "单价台账"
    style_sheet(ledger_ws, LEDGER_HEADERS, [12, 18, 40, 8, 10, 10, 12, 46, 22])

    ledger_row = 2
    for record in records:
        prices = record.get("prices") or []
        quantities = record.get("quantities") or []
        text = (record.get("text") or "").strip()
        if not prices and not quantities:
            continue
        try:
            moment = datetime.fromisoformat((record.get("time") or "").replace("Z", "+00:00")).astimezone()
            date_text = moment.strftime("%Y-%m-%d")
        except Exception:
            date_text = (record.get("time") or "")[:10]

        # 有单价：按单价逐条记录；只有数量：数量照记并标注原文未提及单价
        if prices:
            for price in prices:
                unit = price.get("unit", "")
                matched = next((q for q in quantities if q.get("unit") == unit), None)
                quantity = matched.get("amount") if matched else None
                amount = round(quantity * price["amount"], 2) if quantity else None
                values = [date_text, project, text[:200], unit,
                          quantity if quantity is not None else "",
                          price.get("amount"), amount if amount is not None else "",
                          text, "" if quantity is not None else "原文未提及数量"]
                for column, value in enumerate(values, start=1):
                    cell = ledger_ws.cell(row=ledger_row, column=column, value=value)
                    cell.alignment = Alignment(vertical="top", wrap_text=True)
                    cell.font = Font(name="宋体", size=10)
                ledger_row += 1
        else:
            for quantity in quantities:
                values = [date_text, project, text[:200], quantity.get("unit", ""),
                          quantity.get("amount"), "", "", text, "原文未提及单价"]
                for column, value in enumerate(values, start=1):
                    cell = ledger_ws.cell(row=ledger_row, column=column, value=value)
                    cell.alignment = Alignment(vertical="top", wrap_text=True)
                    cell.font = Font(name="宋体", size=10)
                ledger_row += 1

    log_path = out_dir / "施工日志.xlsx"
    ledger_path = out_dir / "单价台账.xlsx"
    log_wb.save(log_path)
    ledger_wb.save(ledger_path)
    print(json.dumps({
        "ok": True,
        "log": str(log_path),
        "ledger": str(ledger_path),
        "logRows": row - 2,
        "ledgerRows": ledger_row - 2,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: excel.py <群目录>", file=sys.stderr)
        sys.exit(2)
    sys.exit(build(Path(sys.argv[1])))
