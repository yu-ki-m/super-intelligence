#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render the ledger (TOON) as an Excel-like HTML workbook, and check that the
HTML still matches the ledger.

  python -X utf8 render_excel.py render DIR [--out FILE]   # default DIR/report-excel.html
  python -X utf8 render_excel.py check  DIR [--out FILE]

The workbook is built with the bundled copy of the excel-html-output skill
(excel/scripts/build.py; Node.js 18+ is needed to build, not to view).
It shows only what is needed to implement (see VIEW): tasks, needs, requirements,
specs, acceptance cases, impacts and open questions, one table per sheet. Records of
the investigation (progress, sources, quality viewpoints, reviews, searches) are
not shown; they stay in the ledger and report.html. Work IDs are never shown:
references are replaced by the names they point to. `check` rebuilds the HTML from
the current TOON and compares it byte for byte.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "excel", "scripts"))
import ledger  # noqa: E402
import render_html  # noqa: E402
import build as excel_build  # noqa: E402

MAX_ROWS = 500
MAX_SHEETS = 30
HEAD_STYLE = {"bold": True, "fill": "#e2efda", "borderBottom": "1px solid #217346", "valign": "top"}
TITLE_STYLE = {"bold": True, "size": 13, "color": "#107c41"}
NOTE_STYLE = {"color": "#595959"}
CELL_STYLE = {"wrap": True, "valign": "top"}
SHEET_NAME_BAD = re.compile(r"[\\/?*\[\]:]")


def col_name(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def label(desc):
    return re.split(r"[（(]", desc, maxsplit=1)[0].strip() or desc


def text_width(s):
    return sum(8 if ord(ch) < 0x2E80 else 15 for ch in s)


def quality_texts():
    with open(os.path.join(HERE, "..", "references", "quality", "catalog.json"), encoding="utf-8") as f:
        cat = json.load(f)
    out = {}
    for g in cat["groups"]:
        for s in g["subcharacteristics"]:
            for v in s["viewpoints"]:
                out[v["id"]] = v.get("text", "")
                for c in v.get("checks", []):
                    out[c["id"]] = c.get("text", "")
    return out


# What the workbook shows: only what is needed to implement. One table per sheet.
# (sheet name, file, table, [(column, header)], row filter)
VIEW = [
    ("タスク", "tasks.toon", "tasks",
     [("order", "順番"), ("message", "コミットメッセージ"), ("content", "内容"), ("files", "変更するファイル"), ("tests", "テスト")], None),
    ("要求", "needs.toon", "needs",
     [("who", "誰が"), ("want", "何をしたいか"), ("why", "なぜ")], lambda r: r.get("adoption") != "rejected"),
    ("要件", "requirements.toon", "requirements",
     [("statement", "満たすべき条件"), ("acceptance", "受入条件")], lambda r: r.get("status") != "rejected"),
    ("仕様", "specs.toon", "specs",
     [("requirement", "要件"), ("statement", "振る舞い")], None),
    ("受入ケース", "specs.toon", "acceptance",
     [("spec", "仕様"), ("given", "前提"), ("when", "操作"), ("then", "結果")], None),
    ("影響範囲", "current.toon", "impacts",
     [("target", "影響先"), ("classification", "対応"), ("reason", "理由")], lambda r: r.get("classification") != "no_impact"),
    ("確認事項", "decisions.toon", "questions",
     [("question", "問い"), ("recommendation", "推奨"), ("answer", "答え"), ("status", "状態")], None),
]


class Book:
    def __init__(self, folder):
        self.dir = folder
        self.rep = render_html.Report(folder)  # loads, refuses broken ledgers, builds the name index
        self.L = self.rep.L
        self.sheets = []

    def value(self, col, v):
        kind = col["kind"]
        if v is None or v == "":
            return ""
        if kind == "ref":
            return self.rep.name(v)
        if kind == "refs":
            return "\n".join(self.rep.name(x) for x in ledger.split_refs(v))
        if kind == "enum":
            return render_html.ja(v)
        if isinstance(v, bool):
            return "はい" if v else "いいえ"
        if isinstance(v, (int, float)):
            return v
        return self.rep.unid(str(v))

    def sheet(self, name, heads, body):
        cells = {}
        widths = [min(text_width(h) + 16, 240) for h in heads]
        for c, h in enumerate(heads):
            cells[f"{col_name(c)}1"] = {"t": "s", "v": h, "s": HEAD_STYLE}
        for r, line in enumerate(body, 2):
            for c, v in enumerate(line):
                if v == "":
                    continue
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    cells[f"{col_name(c)}{r}"] = {"t": "n", "v": v, "s": {"valign": "top"}}
                else:
                    cells[f"{col_name(c)}{r}"] = {"t": "s", "v": str(v), "s": CELL_STYLE}
                longest = max((text_width(x) for x in str(v).split("\n")), default=0)
                widths[c] = max(widths[c], min(longest + 16, 480))
        widths = [max(60, w) for w in widths]
        heights = {}
        for key, cell in cells.items():
            if cell.get("t") != "s" or cell.get("s") is not CELL_STYLE:
                continue
            m = re.fullmatch(r"([A-Z]+)(\d+)", key)
            ci = sum((ord(ch) - 64) * 26 ** i for i, ch in enumerate(reversed(m.group(1)))) - 1
            ri = int(m.group(2)) - 1
            lines = sum(max(1, math.ceil(text_width(x) / max(widths[ci] - 12, 20))) for x in cell["v"].split("\n"))
            heights[ri] = max(heights.get(ri, 22), min(lines * 19 + 6, 600))
        rows = len(body) + 1
        self.sheets.append({
            "id": f"s{len(self.sheets) + 1}", "name": name, "rows": min(max(rows, 20), MAX_ROWS), "cols": len(heads),
            "colWidths": widths, "rowHeights": [heights.get(i) for i in range(rows)],
            "freeze": {"rows": 1, "cols": 0}, "merges": [], "cells": cells})

    def build(self):
        for name, fname, tname, cols, keep in VIEW:
            spec = ledger.SCHEMA[fname]["tables"][tname]["cols"]
            rows = [r for r in ledger.rows(self.L, fname, tname) if keep is None or keep(r)]
            if not rows:
                continue
            if len(rows) > MAX_ROWS - 1:
                raise SystemExit(f"{name} が {len(rows)} 行あり、1シートの上限を超える")
            self.sheet(name, [h for _, h in cols], [[self.value(spec[k], r.get(k)) for k, _ in cols] for r in rows])
        topic = self.L.scalar("scope.toon", "topic") or "調査"
        book_id = "micropower-investigate-" + hashlib.sha256(os.path.abspath(self.dir).replace("\\", "/").encode("utf-8")).hexdigest()[:16]
        wb = {"schema": "excel-html-workbook/v1", "id": book_id, "revision": "draft",
              "title": topic, "activeSheet": "s1",
              "defaultStyle": {"font": "Yu Gothic", "size": 11}, "view": {"zoom": 100}, "sheets": self.sheets}
        return excel_build.build(wb)


def main(argv):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["render", "check"])
    ap.add_argument("dir")
    ap.add_argument("--out")
    a = ap.parse_args(argv[1:])
    out = a.out or os.path.join(a.dir, "report-excel.html")
    try:
        text = Book(a.dir).build()
    except ValueError as e:
        print(f"ERROR: Excel 風の HTML の組み立てに失敗: {e}", file=sys.stderr)
        return 2
    if a.cmd == "render":
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"作成しました：{out}")
        return 0
    if not os.path.exists(out):
        print(f"不整合：Excel 風の HTML がない（{out}）")
        return 1
    with open(out, encoding="utf-8") as f:
        if f.read() == text:
            print("整合：Excel 風の HTML は今の TOON から作ったものと一致する")
            return 0
    print("不整合：Excel 風の HTML が今の TOON と一致しない（TOON が変わったか、HTML が手で直された）。render で作り直してください")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
