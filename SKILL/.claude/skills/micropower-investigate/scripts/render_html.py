#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render the TOON ledger as one human-readable HTML file, and check that an
existing HTML still matches the ledger.

  python -X utf8 render_html.py render DIR [--out DIR/report.html]
  python -X utf8 render_html.py check  DIR [--out DIR/report.html]

The HTML is a pure function of the TOON files: no clock, no randomness. It
embeds the SHA-256 of every ledger file. `check` re-renders in memory and
compares byte for byte, and reports which ledger files changed since the HTML
was written. Exit code 0 = consistent.
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import toon  # noqa: E402
import ledger  # noqa: E402
import html_tables  # noqa: E402

MANIFEST_RE = re.compile(r'<script type="application/json" id="ledger-manifest">(.*?)</script>', re.S)

JA = {
    "in_progress": "作業中", "provisional": "暫定（未確認・保留あり）", "complete": "完了",
    "new": "新規", "change": "既存の改修", "mixed": "新規と改修",
    "fact": "事実", "claim": "申告", "hypothesis": "推測", "decided": "決定", "unconfirmed": "未確認",
    "adopted": "採用", "out_of_scope": "対象外", "pending": "未決", "proposed": "提案", "deferred": "保留", "rejected": "不採用",
    "keep": "維持", "remove": "廃止", "must_change": "要変更", "keep_regression": "維持・回帰確認", "no_impact": "影響なし",
    "function": "機能", "data": "データ", "quality": "品質", "operation": "運用", "migration": "移行", "constraint": "制約",
    "requirement": "要件あり", "not_needed": "不要", "need": "要求あり", "none": "なし",
    "applicable": "適用あり", "not_applicable": "適用なし", "unknown": "不明", "unreviewed": "未選別", "reflected": "反映済み",
    "needed": "実装が要る", "already_satisfied": "既存で満たす",
    "existing_ok": "既存のまま", "not_handled": "扱わない",
    "existing": "既存", "changed": "変更", "existing_code": "既存コード",
    "responsibility": "責務単位", "property": "1プロパティ単位", "non_property": "プロパティ以外",
    "open": "未対処", "fixed": "修正済み", "escalated": "確認事項へ", "answered": "回答済み",
    "critical": "致命的", "high": "高", "medium": "中", "low": "低",
    "omission": "漏れ", "error": "誤り", "contradiction": "矛盾", "ambiguity": "曖昧", "unsupported": "根拠なし", "granularity": "粒度", "other": "その他",
    "determined": "一意に決まる", "undetermined": "決まらない",
    "builder": "作り手", "tester": "テスト担当", "operator": "運用担当", "end_user": "利用者", "adversary": "反証役",
    "evidence_auditor": "根拠の検証役", "trace_auditor": "追跡の検証役", "impact_auditor": "影響範囲の検証役",
    "unclassified": "未判断", "same_change": "変更する箇所の中", "definition": "定義そのもの", "irrelevant": "関係なし",
    "checked_no_impact": "確かめて影響なし",
    "done": "済み", "failed": "失敗", "skipped": "省略",
    "normal": "正常", "reject": "拒否", "boundary": "境界値", "existing_data": "既存データ", "concurrent": "同時操作",
    "partial_failure": "途中の失敗", "permission": "権限", "retry": "再試行",
    "transition": "遷移", "ignore": "無視",
    "user": "利用者", "requester": "依頼者", "claude_provisional": "Claude の仮置き",
    "input": "入力", "send": "送信", "receive": "受け取り", "validate": "検証", "convert": "変換", "save": "保存",
    "load": "読み込み", "return": "返却", "display": "表示",
    "same": "同じ", "merged": "まとめられた", "split": "分けられた", "missing": "落ちた", "extra": "道具だけにある", "changed_rel": "変わった",
    "screen": "画面", "api": "API", "batch": "一括処理", "csv": "CSV", "event": "イベント", "cli": "コマンド", "admin": "管理", "external": "外部",
    "static": "静的に読んだ", "run": "動かした", "test": "テスト", "history": "履歴", "partial": "一部", "not_done": "未調査",
    "direct": "直接", "caller": "呼び出し元", "callee": "呼び出し先", "downstream": "後続処理", "shared_data": "共有データ",
    "shared_component": "共通部品", "indirect": "間接",
    "direct_user": "直接の利用者", "support": "サポート", "auditor": "監査", "external_system": "外部システム",
    "data_owner": "データの持ち主", "developer": "開発者",
    "request": "依頼", "stakeholder": "関係者", "current": "現状", "inferred": "推定",
    "scope": "範囲", "spec": "仕様", "design": "経路の設計", "impact": "影響範囲", "task": "タスク", "evidence": "根拠", "verify": "検証",
    "yes": "必須", "no": "任意", "conditional": "条件付き",
}
STYLE = {
    "fact": "j-ok", "decided": "st-done", "claim": "d-light", "hypothesis": "j-pending", "unconfirmed": "j-undef",
    "adopted": "st-done", "out_of_scope": "j-na", "pending": "j-undef", "proposed": "j-pending", "deferred": "j-undef", "rejected": "j-na",
    "open": "j-defect", "fixed": "st-done", "escalated": "j-undef",
    "critical": "j-defect", "high": "j-defect", "medium": "j-undef", "low": "d-light",
    "applicable": "j-pending", "not_applicable": "j-na", "unknown": "j-undef", "unreviewed": "j-defect",
    "reflected": "st-done", "not_needed": "j-na",
    "needed": "j-pending", "already_satisfied": "j-ok", "answered": "st-done",
    "done": "st-done", "failed": "j-defect", "skipped": "j-na", "determined": "st-done", "undetermined": "j-defect",
}
CELL_RESULT = {"change": "作業が要る", "existing_ok": "既存のまま", "not_handled": "扱わない", "unconfirmed": "未確認"}
PATH_KIND = {"new": "新しい経路", "change": "既存の経路の変更"}
BRACKET_OPEN = "（(「『【[〔"
BRACKET_CLOSE = "）)」』】]〕"


def ja(v):
    if v is True:
        return "はい"
    if v is False:
        return "いいえ"
    if v is None:
        return ""
    return JA.get(str(v), str(v))


def sentences(s):
    """Break after 。 outside brackets so each sentence gets its own line."""
    if not isinstance(s, str):
        return "" if s is None else str(s)
    out = []
    depth = 0
    n = len(s)
    for i, ch in enumerate(s):
        out.append(ch)
        if ch in BRACKET_OPEN:
            depth += 1
        elif ch in BRACKET_CLOSE and depth > 0:
            depth -= 1
        elif ch == "。" and depth == 0 and i + 1 < n and s[i + 1] not in "\n" + BRACKET_CLOSE + "」":
            out.append("\n")
    return "".join(out)


def badge(v):
    return {"text": ja(v) or "—", "style": STYLE.get(str(v), "d-light")}


def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def esc_lines(s):
    return esc(sentences(s)).replace("\n", "<br>")


class Report:
    def __init__(self, folder):
        self.dir = folder
        self.L = ledger.Ledger(folder).load()
        if not self.L.errors:
            ledger.check_structure(self.L)
        if self.L.errors:
            msgs = "\n".join(f"  {e['file']} {e['target']}: {e['message']}" for e in self.L.errors[:30])
            raise SystemExit(f"台帳の TOON が読めないか、形が壊れているため HTML を作れません（ledger.py validate で確かめる）:\n{msgs}")
        self.names = {}
        self._index()
        self.blocks = []

    def rows(self, f, t):
        return ledger.rows(self.L, f, t)

    def _index(self):
        def put(rows, key, label):
            for r in rows:
                if r.get("id"):
                    self.names[r["id"]] = label(r)
        put(self.rows("needs.toon", "stakeholders"), "id", lambda r: r.get("name"))
        put(self.rows("needs.toon", "scenes"), "id", lambda r: r.get("name"))
        put(self.rows("needs.toon", "needs"), "id", lambda r: r.get("want"))
        put(self.rows("requirements.toon", "requirements"), "id", lambda r: r.get("statement"))
        put(self.rows("specs.toon", "specs"), "id", lambda r: r.get("statement"))
        put(self.rows("specs.toon", "paths"), "id", lambda r: r.get("name"))
        put(self.rows("specs.toon", "properties"), "id", lambda r: r.get("name"))
        put(self.rows("specs.toon", "acceptance"), "id", lambda r: r.get("then"))
        put(self.rows("specs.toon", "machines"), "id", lambda r: r.get("name"))
        put(self.rows("specs.toon", "decision_tables"), "id", lambda r: r.get("name"))
        put(self.rows("specs.toon", "errors"), "id", lambda r: r.get("failure"))
        put(self.rows("design.toon", "steps"), "id", lambda r: r.get("name"))
        put(self.rows("tasks.toon", "tasks"), "id", lambda r: r.get("token"))
        put(self.rows("current.toon", "entrypoints"), "id", lambda r: r.get("name"))
        put(self.rows("current.toon", "behaviors"), "id", lambda r: r.get("statement"))
        put(self.rows("current.toon", "impacts"), "id", lambda r: r.get("target"))
        put(self.rows("current.toon", "investigations"), "id", lambda r: r.get("area"))
        put(self.rows("impact.toon", "changes"), "id", lambda r: r.get("name"))
        put(self.rows("impact.toon", "searches"), "id", lambda r: r.get("term"))
        put(self.rows("reviews.toon", "findings"), "id", lambda r: r.get("statement"))
        put(self.rows("reviews.toon", "reviewers"), "id", lambda r: ja(r.get("role")))
        put(self.rows("decisions.toon", "questions"), "id", lambda r: r.get("question"))
        put(self.rows("sources.toon", "sources"), "id", lambda r: r.get("path"))

    def name(self, i):
        return self.names.get(i, i)

    def unid(self, text):
        """Replace every ledger ID inside free text with its display name."""
        if not isinstance(text, str):
            return text
        return re.sub(r"[A-Za-z]+[0-9]+(?:\.[0-9]+)*", lambda m: f"「{self.names[m.group(0)]}」" if m.group(0) in self.names else m.group(0), text)

    def names_of(self, refs):
        return "\n".join(f"・{self.name(x)}" for x in ledger.split_refs(refs))

    # -- block helpers --
    def html(self, fragment):
        self.blocks.append({"type": "html", "html": fragment})

    def table(self, tid, title, columns, rows, intro=None):
        if not rows:
            self.html(f'<section class="lg-empty"><h2>{esc(title)}</h2><p>記録なし</p></section>')
            return
        self._unid_rows(rows)
        b = {"type": "table", "id": tid, "title": title, "columns": columns, "rows": rows}
        if intro:
            b["intro"] = intro
        self.blocks.append(b)

    def cells(self, d):
        return {k: (v if isinstance(v, dict) else sentences(self.unid(v))) for k, v in d.items()}

    def el(self, s):
        return esc_lines(self.unid(s))

    def _unid_rows(self, rows):
        for r in rows:
            r["name"] = self.unid(r.get("name"))
            if r.get("children"):
                self._unid_rows(r["children"])

    # -- sections --
    def summary(self):
        L = self.L
        status = L.scalar("progress.toon", "status")
        needs = self.rows("needs.toon", "needs")
        reqs = self.rows("requirements.toon", "requirements")
        specs = self.rows("specs.toon", "specs")
        tasks = self.rows("tasks.toon", "tasks")
        findings = self.rows("reviews.toon", "findings")
        qs = self.rows("decisions.toon", "questions")
        cards = [
            ("要求", f"{sum(1 for n in needs if n.get('adoption') == 'adopted')} / {len(needs)}", "採用 / 全体"),
            ("要件", f"{sum(1 for r in reqs if r.get('status') == 'adopted')} / {len(reqs)}", "採用 / 全体"),
            ("仕様", f"{len(specs)}", f"実装が要る {sum(1 for s in specs if s.get('implementation') == 'needed')}"),
            ("経路", f"{len(self.rows('specs.toon', 'paths'))}", f"プロパティ {len(self.rows('specs.toon', 'properties'))}"),
            ("タスク", f"{len(tasks)}", "1タスク＝1コミット"),
            ("指摘", f"{sum(1 for f in findings if f.get('status') == 'open')} / {len(findings)}", "未対処 / 全体"),
            ("確認事項", f"{sum(1 for q in qs if q.get('status') in ('open', 'deferred', 'provisional'))} / {len(qs)}", "未回答・保留 / 全体"),
        ]
        v = self.validation_state()
        card_html = "".join(f'<div class="lg-card"><div class="lg-card-k">{esc(k)}</div><div class="lg-card-v">{esc(val)}</div><div class="lg-card-n">{esc(note)}</div></div>' for k, val, note in cards)
        req = L.scalar("scope.toon", "request") or ""
        self.html(
            '<section class="lg-summary">'
            f'<div class="lg-status lg-status-{esc(status)}">状態：{esc(ja(status))}</div>'
            f'<div class="lg-valid lg-valid-{esc(v[0])}">{esc(v[1])}</div>'
            f'<div class="lg-cards">{card_html}</div>'
            f'<h2>依頼の原文</h2><blockquote class="lg-request">{esc(req).replace(chr(10), "<br>")}</blockquote>'
            '</section>')
        cov = [{"name": r.get("area"), "cells": self.cells({"checked": r.get("checked"), "not_checked": r.get("not_checked")})}
               for r in self.rows("reviews.toon", "coverage")]
        self.table("coverage", "確かめた範囲と確かめていない範囲",
                   [{"key": "name", "label": "領域"}, {"key": "checked", "label": "確かめたこと"}, {"key": "not_checked", "label": "確かめていないこと"}], cov)
        rows = []
        for r in self.rows("scope.toon", "in_scope"):
            rows.append({"name": r.get("item"), "cells": {"kind": "範囲に入れる", "reason": sentences(r.get("reason"))}})
        for r in self.rows("scope.toon", "out_of_scope"):
            rows.append({"name": r.get("item"), "cells": {"kind": "範囲に入れない", "reason": sentences(r.get("reason"))}})
        self.table("scope", "範囲", [{"key": "name", "label": "対象"}, {"key": "kind", "label": "扱い"}, {"key": "reason", "label": "理由"}], rows)

    def validation_state(self):
        vp = os.path.join(self.dir, "validation.toon")
        if not os.path.exists(vp):
            return ("none", "機械検査：未実施")
        with open(vp, "rb") as f:
            v = toon.decode(f.read())
        current = ledger_hashes(self.dir)
        recorded = {r["file"]: r["sha256"] for r in v.get("files", []) if isinstance(r, dict)}
        stale = recorded != current
        label = f"機械検査（{v.get('mode')}、{v.get('validated_at')}）：エラー {v.get('error_count')} 件、警告 {v.get('warning_count')} 件"
        if stale:
            return ("stale", label + "。検査の後に台帳が変わっている")
        return ("ok" if v.get("error_count") == 0 else "ng", label)

    def trace(self):
        needs = [n for n in self.rows("needs.toon", "needs")]
        reqs = {r["id"]: r for r in self.rows("requirements.toon", "requirements")}
        n2r = {}
        for l in self.rows("requirements.toon", "need_links"):
            n2r.setdefault(l.get("need"), []).append(l.get("requirement"))
        specs = self.rows("specs.toon", "specs")
        tasks = {t["id"]: t for t in self.rows("tasks.toon", "tasks")}
        s2t = {}
        for l in self.rows("tasks.toon", "task_specs"):
            s2t.setdefault(l.get("spec"), []).append(l)
        steps = {s["id"]: s for s in self.rows("design.toon", "steps")}
        out = []
        for n in needs:
            req_rows = []
            for rid in n2r.get(n.get("id"), []):
                r = reqs.get(rid)
                if not r:
                    continue
                spec_rows = []
                for s in [s for s in specs if s.get("requirement") == rid]:
                    leaves = []
                    links = sorted(s2t.get(s.get("id"), []), key=lambda l: tasks.get(l.get("task"), {}).get("order", 0))
                    for l in links:
                        t = tasks.get(l.get("task"), {})
                        leaves.append({"name": t.get("token") or "—", "cells": self.cells({
                            "unit": ja(t.get("unit")), "content": l.get("content"),
                            "path": self.name(t.get("path")) if t.get("path") else "—",
                            "step": self.name(t.get("step")) if t.get("step") else ("全段" if t.get("unit") == "property" else "—")})})
                    if not leaves:
                        why = "既存のままで満たす" if s.get("implementation") == "already_satisfied" else "タスクなし"
                        leaves.append({"name": "—", "cells": {"unit": "—", "content": why, "path": self.name(s.get("path")) if s.get("path") else "—", "step": "—"}})
                    spec_rows.append({"name": "仕様：" + (s.get("statement") or ""), "children": leaves})
                if not spec_rows:
                    spec_rows.append({"name": "仕様：（なし）", "children": [{"name": "—", "cells": {"unit": "—", "content": "仕様がない", "path": "—", "step": "—"}}]})
                req_rows.append({"name": "要件：" + (r.get("statement") or ""), "children": spec_rows})
            if not req_rows:
                req_rows.append({"name": "要件：（なし）", "children": [{"name": "—", "cells": {"unit": "—", "content": ja(n.get("adoption")) + "：" + (n.get("reason") or ""), "path": "—", "step": "—"}}]})
            label = f"要求：{self.name(n.get('who'))}が、{self.name(n.get('scene'))}で、{n.get('want')}（{n.get('why')}）"
            out.append({"name": label, "children": req_rows})
        self.table("trace", "要求から要件・仕様・タスクまでの追跡",
                   [{"key": "name", "label": "要求・要件・仕様／タスクの文言"}, {"key": "unit", "label": "概念単位"},
                    {"key": "content", "label": "その仕様でのタスクの内容"}, {"key": "path", "label": "経路"}, {"key": "step", "label": "段"}],
                   out, intro="1つのタスクが複数の仕様に関わるときは、それぞれの仕様の下に、その仕様に合わせた内容で現れる。")

    def tasks(self):
        tasks = sorted(self.rows("tasks.toon", "tasks"), key=lambda t: t.get("order", 0))
        groups = {}
        order = []
        for t in tasks:
            g = self.name(t.get("path")) if t.get("path") else "経路に属さないタスク"
            if g not in groups:
                groups[g] = []
                order.append(g)
            groups[g].append({"name": t.get("token") or "—", "cells": self.cells({
                "unit": ja(t.get("unit")), "property": self.name(t.get("property")) if t.get("property") else "—",
                "step": self.name(t.get("step")) if t.get("step") else ("全段" if t.get("unit") == "property" else "—"),
                "content": t.get("content"), "files": t.get("files"), "tests": t.get("tests"), "message": t.get("message")})})
        rows = [{"name": g, "children": groups[g]} for g in order]
        fmt = self.L.scalar("scope.toon", "commit_format") or ""
        src = self.L.scalar("scope.toon", "commit_format_source") or ""
        intro = "実装の順に並べた。\n1タスクを1コミットにする。"
        if fmt:
            intro += f"\nコミットメッセージの形：{fmt}（出所：{src}）"
        self.table("tasks", "タスク（実装の順）",
                   [{"key": "name", "label": "文言"}, {"key": "unit", "label": "概念単位"}, {"key": "property", "label": "プロパティ"},
                    {"key": "step", "label": "段"}, {"key": "content", "label": "内容"}, {"key": "files", "label": "変更するファイル"},
                    {"key": "tests", "label": "テスト"}, {"key": "message", "label": "コミットメッセージ"}], rows, intro=intro)

    def design(self):
        paths = self.rows("specs.toon", "paths")
        steps = self.rows("design.toon", "steps")
        pp = self.rows("specs.toon", "path_properties")
        cells = {(c.get("path"), c.get("property"), c.get("step")): c for c in self.rows("design.toon", "matrix")}
        parts = ['<section class="lg-design"><h2>経路の設計（段×プロパティ）</h2>'
                 '<p class="lg-note">行がプロパティ、列が経路の段。<br>欄には、その段がそのプロパティに行うことと、要る作業（作業が要る・既存のまま・扱わない）を書いた。<br>作業が要る欄が、タスク（コミット）になる。</p>']
        if not paths:
            parts.append("<p>記録なし</p>")
        for p in paths:
            ps = sorted([s for s in steps if s.get("path") == p.get("id")], key=lambda s: s.get("order", 0))
            props = [x for x in pp if x.get("path") == p.get("id")]
            props = sorted(props, key=lambda x: 0 if x.get("first") else 1)
            parts.append(f'<h3>{esc(p.get("name"))}（{esc(PATH_KIND.get(p.get("kind"), ja(p.get("kind"))))}）</h3>')
            parts.append(f'<p class="lg-note">始まり：{self.el(p.get("trigger"))}<br>終わり：{self.el(p.get("end"))}</p>')
            parts.append('<div class="lg-scroll"><table class="lg-matrix"><thead><tr><th>プロパティ＼段</th>')
            for s in ps:
                parts.append(f'<th>{esc(s.get("order"))}. {esc(s.get("name"))}<div class="lg-sub">{esc(ja(s.get("origin")))}</div></th>')
            parts.append("</tr></thead><tbody>")
            for x in props:
                label = esc(self.name(x.get("property"))) + ('<div class="lg-sub">最初のプロパティ</div>' if x.get("first") else "")
                parts.append(f"<tr><th>{label}</th>")
                for s in ps:
                    c = cells.get((p.get("id"), x.get("property"), s.get("id")))
                    if not c:
                        parts.append('<td class="lg-cell-missing">（欄なし）</td>')
                        continue
                    res = c.get("result")
                    specs_txt = "".join(f"<li>{esc(self.name(i))}</li>" for i in ledger.split_refs(c.get("specs")))
                    reason = f'<div class="lg-sub">{self.el(c.get("reason"))}</div>' if c.get("reason") else ""
                    parts.append(f'<td class="lg-cell-{esc(res)}"><div class="lg-act">{esc(ja(c.get("action")))}・{esc(CELL_RESULT.get(res, ja(res)))}</div>'
                                 f'{"<ul>" + specs_txt + "</ul>" if specs_txt else ""}{reason}</td>')
                parts.append("</tr>")
            parts.append("</tbody></table></div>")
            parts.append('<table class="lg-plain"><thead><tr><th>段</th><th>責務</th><th>根拠</th></tr></thead><tbody>')
            for s in ps:
                ev = f'{esc(s.get("ev_path"))}:{esc(s.get("ev_line"))}' if s.get("ev_path") not in ("", "none", None) else "—"
                parts.append(f'<tr><td>{esc(s.get("order"))}. {esc(s.get("name"))}</td><td>{self.el(s.get("responsibility"))}</td><td>{ev}</td></tr>')
            parts.append("</tbody></table>")
        parts.append("</section>")
        self.html("".join(parts))

    def impact(self):
        changes = self.rows("impact.toon", "changes")
        searches = self.rows("impact.toon", "searches")
        hits = self.rows("impact.toon", "hits")
        rows = []
        for c in changes:
            ss = [x for x in searches if x.get("change") == c.get("id")]
            ch = []
            for x in ss:
                hs = [h for h in hits if h.get("search") == x.get("id")]
                tally = {}
                for h in hs:
                    tally[h.get("disposition")] = tally.get(h.get("disposition"), 0) + 1
                ch.append({"name": f"検索：{x.get('term')}", "cells": self.cells({
                    "count": str(x.get("hit_count")),
                    "tally": "\n".join(f"{ja(k)}：{v}" for k, v in sorted(tally.items())) or "—",
                    "impacts": "\n".join(sorted({f"・{self.name(h.get('impact'))}" for h in hs if h.get("impact")})) or "—",
                    "tool": x.get("tool")})})
            if not ch:
                ch.append({"name": "（検索なし）" if c.get("origin") == "existing" else "（新しく作るため検索なし）",
                           "cells": {"count": "—", "tally": "—", "impacts": "—", "tool": "—"}})
            label = f"{c.get('name')}（{ja(c.get('kind'))}、{ja(c.get('origin'))}）"
            rows.append({"name": label, "children": ch})
        self.table("changes", "影響範囲：変更する箇所と逆引きの検索",
                   [{"key": "name", "label": "変更する箇所／検索"}, {"key": "count", "label": "当たり"},
                    {"key": "tally", "label": "判断の内訳"}, {"key": "impacts", "label": "見つかった影響先"}, {"key": "tool", "label": "道具"}],
                   rows, intro="変更する箇所ごとに、リポジトリ全体を逆引きし、当たった行をすべて判断した。")
        imp_rows = []
        for i in self.rows("current.toon", "impacts"):
            imp_rows.append({"name": i.get("target"), "cells": self.cells({
                "relation": ja(i.get("relation")), "cls": ja(i.get("classification")), "reason": i.get("reason"),
                "specs": self.names_of(i.get("specs")) or "—", "ev": evtext(i)})})
        self.table("impacts-to-specs", "影響範囲：影響先と、つながる仕様",
                   [{"key": "name", "label": "影響先"}, {"key": "relation", "label": "関係"}, {"key": "cls", "label": "分類"},
                    {"key": "reason", "label": "理由"}, {"key": "specs", "label": "つながる仕様"}, {"key": "ev", "label": "根拠"}], imp_rows)
        co = {}
        for r in self.rows("impact.toon", "cochanges"):
            co.setdefault(r.get("file"), []).append({"name": r.get("partner"), "cells": self.cells({
                "count": f"{r.get('count')} 回（{r.get('percent')}%）", "disp": ja(r.get("disposition")),
                "impact": self.name(r.get("impact")) if r.get("impact") else "—", "reason": r.get("reason") or "—"})})
        self.table("cochanges", "影響範囲：一緒に変更されてきたファイル（git の履歴）",
                   [{"key": "name", "label": "変更するファイル／一緒に変更されてきたファイル"}, {"key": "count", "label": "回数"},
                    {"key": "disp", "label": "判断"}, {"key": "impact", "label": "影響先"}, {"key": "reason", "label": "理由"}],
                   [{"name": f, "children": ch} for f, ch in co.items()])

    def specs(self):
        props = self.rows("specs.toon", "properties")
        self.table("properties", "プロパティの定義",
                   [{"key": "name", "label": "名前（文言に使う）"}, {"key": "code", "label": "コード上の名前"}, {"key": "type", "label": "型"},
                    {"key": "req", "label": "必須"}, {"key": "constraint", "label": "桁・範囲・形式"}, {"key": "default", "label": "初期値"},
                    {"key": "display", "label": "表示"}, {"key": "existing", "label": "既存データ"}, {"key": "ev", "label": "根拠"},
                    {"key": "origin", "label": "出所", "kind": "badge"}, {"key": "conf", "label": "確からしさ", "kind": "badge"}],
                   [{"name": p.get("name"), "cells": self.cells({
                       "code": p.get("code_name") or "—", "type": p.get("type"), "req": ja(p.get("required")),
                       "constraint": p.get("constraint"), "default": p.get("default_value") or "—", "display": p.get("display") or "—",
                       "existing": p.get("existing_data") or "—", "ev": evtext(p),
                       "origin": badge(p.get("origin")), "conf": badge(p.get("confidence"))})} for p in props])
        specs = self.rows("specs.toon", "specs")
        self.table("specs", "仕様の一覧",
                   [{"key": "name", "label": "仕様"}, {"key": "req", "label": "親の要件"}, {"key": "path", "label": "経路"},
                    {"key": "prop", "label": "プロパティ"}, {"key": "kind", "label": "種類"}, {"key": "reason", "label": "理由"},
                    {"key": "impl", "label": "実装", "kind": "badge"}, {"key": "conf", "label": "確からしさ", "kind": "badge"}],
                   [{"name": s.get("statement"), "cells": self.cells({
                       "req": self.name(s.get("requirement")), "path": self.name(s.get("path")) if s.get("path") else "横断",
                       "prop": self.name(s.get("property")) if s.get("property") else "—", "kind": s.get("kind"), "reason": s.get("reason"),
                       "impl": badge(s.get("implementation")), "conf": badge(s.get("confidence"))})} for s in specs])
        acc = {}
        for a in self.rows("specs.toon", "acceptance"):
            acc.setdefault(a.get("spec"), []).append(a)
        rows = []
        for s in specs:
            ch = [{"name": f"前提：{a.get('given')}", "cells": self.cells({"when": a.get("when"), "then": a.get("then")})} for a in acc.get(s.get("id"), [])]
            if ch:
                rows.append({"name": s.get("statement"), "children": ch})
        self.table("acceptance", "受入ケース", [{"key": "name", "label": "仕様／前提"}, {"key": "when", "label": "操作"}, {"key": "then", "label": "結果"}], rows)
        self.state_tables()
        rows = []
        for t in self.rows("specs.toon", "decision_tables"):
            conds = [c for c in self.rows("specs.toon", "conditions") if c.get("table") == t.get("id")]
            cond_txt = "、".join(f"{c.get('condition')}（{c.get('values')}）" for c in conds)
            ch = [{"name": r.get("when"), "cells": self.cells({"outcome": r.get("outcome"), "specs": self.names_of(r.get("specs"))})}
                  for r in self.rows("specs.toon", "rules") if r.get("table") == t.get("id")]
            if ch:
                rows.append({"name": f"{t.get('name')}（条件：{cond_txt}）", "children": ch})
        self.table("decisions-tables", "決定表", [{"key": "name", "label": "条件"}, {"key": "outcome", "label": "結果"}, {"key": "specs", "label": "仕様"}], rows)
        ents = {}
        for r in self.rows("specs.toon", "crud"):
            ents.setdefault(r.get("entity"), []).append({"name": self.name(r.get("path")), "cells": self.cells({
                "c": r.get("create"), "r": r.get("read"), "u": r.get("update"), "d": r.get("delete"), "reason": r.get("reason") or "—"})})
        self.table("crud", "CRUD", [{"key": "name", "label": "エンティティ／経路"}, {"key": "c", "label": "作る"}, {"key": "r", "label": "読む"},
                                    {"key": "u", "label": "更新"}, {"key": "d", "label": "削除"}, {"key": "reason", "label": "メモ"}],
                   [{"name": e, "children": ch} for e, ch in ents.items()])
        errs = {}
        for e in self.rows("specs.toon", "errors"):
            errs.setdefault(self.name(e.get("path")), []).append({"name": e.get("failure"), "cells": self.cells({
                "step": self.name(e.get("detect_step")), "response": e.get("response"), "display": e.get("display"),
                "record": e.get("record"), "specs": self.names_of(e.get("specs"))})})
        self.table("errors", "エラー", [{"key": "name", "label": "経路／失敗の種類"}, {"key": "step", "label": "検出する段"},
                                       {"key": "response", "label": "返す内容"}, {"key": "display", "label": "画面の表示"},
                                       {"key": "record", "label": "記録"}, {"key": "specs", "label": "仕様"}],
                   [{"name": p, "children": ch} for p, ch in errs.items()])

    def state_tables(self):
        machines = self.rows("specs.toon", "machines")
        parts = ['<section class="lg-design"><h2>状態遷移</h2>']
        if not machines:
            parts.append("<p>記録なし</p>")
        for m in machines:
            states = [s.get("state") for s in self.rows("specs.toon", "states") if s.get("machine") == m.get("id")]
            events = [e.get("event") for e in self.rows("specs.toon", "events") if e.get("machine") == m.get("id")]
            tr = {(t.get("state"), t.get("event")): t for t in self.rows("specs.toon", "transitions") if t.get("machine") == m.get("id")}
            parts.append(f'<h3>{esc(m.get("name"))}（{esc(m.get("entity"))}）</h3><div class="lg-scroll"><table class="lg-matrix"><thead><tr><th>状態＼出来事</th>')
            parts += [f"<th>{esc(e)}</th>" for e in events]
            parts.append("</tr></thead><tbody>")
            for s in states:
                parts.append(f"<tr><th>{esc(s)}</th>")
                for e in events:
                    t = tr.get((s, e))
                    if not t:
                        parts.append('<td class="lg-cell-missing">（欄なし）</td>')
                        continue
                    res = t.get("result")
                    body = esc(ja(res)) + (f" → {esc(t.get('to_state'))}" if res == "transition" else "")
                    extra = f'<div class="lg-sub">{self.el(t.get("reason"))}</div>' if t.get("reason") else ""
                    parts.append(f'<td class="lg-tr-{esc(res)}"><div class="lg-act">{body}</div>{extra}</td>')
                parts.append("</tr>")
            parts.append("</tbody></table></div>")
        parts.append("</section>")
        self.html("".join(parts))

    def frames(self):
        sh = self.rows("needs.toon", "stakeholders")
        sc = self.rows("needs.toon", "scenes")
        fr = {(f.get("stakeholder"), f.get("scene")): f for f in self.rows("needs.toon", "frame")}
        parts = ['<section class="lg-design"><h2>関係者×場面</h2><div class="lg-scroll"><table class="lg-matrix"><thead><tr><th>関係者＼場面</th>']
        parts += [f"<th>{esc(s.get('name'))}</th>" for s in sc]
        parts.append("</tr></thead><tbody>")
        for h in sh:
            parts.append(f"<tr><th>{esc(h.get('name'))}<div class='lg-sub'>{esc(ja(h.get('kind')))}</div></th>")
            for s in sc:
                f = fr.get((h.get("id"), s.get("id")))
                if not f:
                    parts.append('<td class="lg-cell-missing">（欄なし）</td>')
                    continue
                items = "".join(f"<li>{esc(self.name(n))}</li>" for n in ledger.split_refs(f.get("needs")))
                reason = f'<div class="lg-sub">{self.el(f.get("reason"))}</div>' if f.get("reason") else ""
                parts.append(f'<td class="lg-fr-{esc(f.get("result"))}"><div class="lg-act">{esc(ja(f.get("result")))}</div>{"<ul>" + items + "</ul>" if items else ""}{reason}</td>')
            parts.append("</tr>")
        parts.append("</tbody></table></div>")
        needs = [n for n in self.rows("needs.toon", "needs") if n.get("adoption") == "adopted"]
        rf = {(f.get("need"), f.get("viewpoint")): f for f in self.rows("requirements.toon", "frame")}
        parts.append('<h2>要求×観点</h2><div class="lg-scroll"><table class="lg-matrix"><thead><tr><th>要求＼観点</th>')
        parts += [f"<th>{esc(ja(v))}</th>" for v in ledger.VIEWPOINTS]
        parts.append("</tr></thead><tbody>")
        for n in needs:
            parts.append(f"<tr><th>{esc(n.get('want'))}</th>")
            for v in ledger.VIEWPOINTS:
                f = rf.get((n.get("id"), v))
                if not f:
                    parts.append('<td class="lg-cell-missing">（欄なし）</td>')
                    continue
                items = "".join(f"<li>{esc(self.name(r))}</li>" for r in ledger.split_refs(f.get("requirements")))
                reason = f'<div class="lg-sub">{self.el(f.get("reason"))}</div>' if f.get("reason") else ""
                parts.append(f'<td class="lg-fr-{esc(f.get("result"))}"><div class="lg-act">{esc(ja(f.get("result")))}</div>{"<ul>" + items + "</ul>" if items else ""}{reason}</td>')
            parts.append("</tr>")
        parts.append("</tbody></table></div></section>")
        self.html("".join(parts))

    def needs_requirements(self):
        self.table("needs", "要求の一覧",
                   [{"key": "name", "label": "何をしたいか"}, {"key": "who", "label": "誰が"}, {"key": "scene", "label": "場面"},
                    {"key": "why", "label": "なぜ"}, {"key": "obstacle", "label": "妨げ"}, {"key": "origin", "label": "由来"},
                    {"key": "reason", "label": "扱いの理由"}, {"key": "adoption", "label": "扱い", "kind": "badge"},
                    {"key": "conf", "label": "確からしさ", "kind": "badge"}],
                   [{"name": n.get("want"), "cells": self.cells({
                       "who": self.name(n.get("who")), "scene": self.name(n.get("scene")), "why": n.get("why"),
                       "obstacle": n.get("obstacle") or "—", "origin": ja(n.get("origin")), "reason": n.get("reason") or "—",
                       "adoption": badge(n.get("adoption")), "conf": badge(n.get("confidence"))})} for n in self.rows("needs.toon", "needs")])
        r2n = {}
        for l in self.rows("requirements.toon", "need_links"):
            r2n.setdefault(l.get("requirement"), []).append(l.get("need"))
        self.table("requirements", "要件の一覧",
                   [{"key": "name", "label": "満たすべき条件"}, {"key": "kind", "label": "種類"}, {"key": "reason", "label": "理由"},
                    {"key": "acceptance", "label": "受入条件"}, {"key": "needs", "label": "親の要求"},
                    {"key": "status", "label": "採否", "kind": "badge"}, {"key": "conf", "label": "確からしさ", "kind": "badge"}],
                   [{"name": r.get("statement"), "cells": self.cells({
                       "kind": ja(r.get("kind")), "reason": r.get("reason"), "acceptance": r.get("acceptance"),
                       "needs": "\n".join(f"・{self.name(n)}" for n in r2n.get(r.get("id"), [])) or "—",
                       "status": badge(r.get("status")), "conf": badge(r.get("confidence"))})} for r in self.rows("requirements.toon", "requirements")])

    def current(self):
        self.table("entrypoints", "現状の入口", [{"key": "name", "label": "入口"}, {"key": "kind", "label": "種類"}, {"key": "ev", "label": "根拠"}],
                   [{"name": e.get("name"), "cells": self.cells({"kind": ja(e.get("kind")), "ev": evtext(e)})} for e in self.rows("current.toon", "entrypoints")])
        self.table("behaviors", "現行の仕様と処遇",
                   [{"key": "name", "label": "振る舞い"}, {"key": "entry", "label": "入口"}, {"key": "purpose", "label": "目的"},
                    {"key": "treat", "label": "処遇"}, {"key": "reason", "label": "処遇の理由"}, {"key": "ev", "label": "根拠"},
                    {"key": "conf", "label": "確からしさ", "kind": "badge"}],
                   [{"name": b.get("statement"), "cells": self.cells({
                       "entry": self.name(b.get("entry")) if b.get("entry") else "—", "purpose": b.get("purpose") or "—",
                       "treat": ja(b.get("treatment")), "reason": b.get("reason") or "—", "ev": evtext(b),
                       "conf": badge(b.get("confidence"))})} for b in self.rows("current.toon", "behaviors")])
        self.table("impacts", "影響先", [{"key": "name", "label": "影響先"}, {"key": "relation", "label": "関係"}, {"key": "condition", "label": "条件"},
                                       {"key": "cls", "label": "分類"}, {"key": "reason", "label": "理由"}, {"key": "ev", "label": "根拠"}],
                   [{"name": i.get("target"), "cells": self.cells({
                       "relation": ja(i.get("relation")), "condition": i.get("condition") or "—", "cls": ja(i.get("classification")),
                       "reason": i.get("reason"), "ev": evtext(i)})} for i in self.rows("current.toon", "impacts")])
        self.table("investigations", "調査台帳", [{"key": "name", "label": "調べた範囲"}, {"key": "method", "label": "方法"},
                                               {"key": "status", "label": "状態"}, {"key": "boundary", "label": "止めた境界と理由"}, {"key": "note", "label": "メモ"}],
                   [{"name": r.get("area"), "cells": self.cells({
                       "method": ja(r.get("method")), "status": ja(r.get("status")), "boundary": r.get("boundary_reason") or "—",
                       "note": r.get("note") or "—"})} for r in self.rows("current.toon", "investigations")])

    def quality(self):
        import json as _json
        with open(os.path.join(HERE, "..", "references", "quality", "catalog.json"), encoding="utf-8") as f:
            cat = _json.load(f)
        vps = {r.get("id"): r for r in self.rows("quality.toon", "viewpoints")}
        checks = {r.get("id"): r for r in self.rows("quality.toon", "checks")}
        counts = []
        rows = []
        for g in cat["groups"]:
            for s in g["subcharacteristics"]:
                tally = {}
                vrows = []
                for v in s["viewpoints"]:
                    j = vps.get(v["id"], {}).get("judgement", "unreviewed")
                    tally[j] = tally.get(j, 0) + 1
                    ch = []
                    for cid, ctext in [(c["id"], c["text"]) for c in v["checks"]]:
                        c = checks.get(cid)
                        if c:
                            ch.append({"name": ctext, "cells": self.cells({
                                "reqs": self.names_of(c.get("requirements")) or "—", "reason": c.get("reason") or "—",
                                "j": badge(c.get("judgement"))})})
                    if j in ("applicable", "unknown") or ch:
                        vrows.append({"name": f"{v['text']}（{ja(j)}）", "children": ch or [{"name": "（確認項目の判定なし）", "cells": {"reqs": "—", "reason": "—", "j": badge("unreviewed")}}]})
                counts.append(f"<tr><td>{esc(s['name'])}</td>" + "".join(f"<td>{tally.get(k, 0)}</td>" for k in ("applicable", "unknown", "not_applicable", "out_of_scope", "unreviewed")) + "</tr>")
                if vrows:
                    rows.append({"name": s["name"], "children": vrows})
        self.html('<section class="lg-design"><h2>品質の観点の一次選別</h2>'
                  f'<p class="lg-note">カタログ {esc(cat.get("catalog_version"))}（9品質特性・40副特性・605観点・1,833確認項目）。</p>'
                  '<table class="lg-plain"><thead><tr><th>副特性</th><th>適用あり</th><th>不明</th><th>適用なし</th><th>対象外</th><th>未選別</th></tr></thead><tbody>'
                  + "".join(counts) + "</tbody></table></section>")
        self.table("quality", "適用あり・不明の観点の確認項目",
                   [{"key": "name", "label": "副特性／観点／確認項目"}, {"key": "reqs", "label": "反映した要件"}, {"key": "reason", "label": "理由"},
                    {"key": "j", "label": "判定", "kind": "badge"}], rows)

    def verify(self):
        rounds = {r.get("round"): r for r in self.rows("reviews.toon", "rounds")}
        rv = {}
        for r in self.rows("reviews.toon", "reviewers"):
            rv.setdefault(r.get("round"), []).append({"name": ja(r.get("role")), "cells": self.cells({
                "scope": r.get("scope"), "status": badge(r.get("status"))})})
        self.table("reviewers", "検証の回と役割", [{"key": "name", "label": "回／役割"}, {"key": "scope", "label": "見た範囲"},
                                                {"key": "status", "label": "状態", "kind": "badge"}],
                   [{"name": f"{k}回目（{ja(rounds.get(k, {}).get('kind'))}、{rounds.get(k, {}).get('date', '')}）", "children": v} for k, v in sorted(rv.items(), key=lambda x: x[0] or 0)])
        groups = {}
        for f in self.rows("reviews.toon", "findings"):
            groups.setdefault(ja(f.get("layer")), []).append({"name": f.get("statement"), "cells": self.cells({
                "targets": self.names_of(f.get("targets")) or "—", "scenario": f.get("scenario") or "—",
                "evidence": f.get("evidence") or "—", "resolution": f.get("resolution") or "—",
                "by": self.name(f.get("reviewer")) if f.get("reviewer") != "main" else "本体",
                "kind": badge(f.get("kind")), "sev": badge(f.get("severity")), "status": badge(f.get("status"))})})
        self.table("findings", "検証の指摘",
                   [{"key": "name", "label": "層／指摘"}, {"key": "targets", "label": "対象"}, {"key": "scenario", "label": "具体的な場面"},
                    {"key": "evidence", "label": "根拠"}, {"key": "resolution", "label": "対処"}, {"key": "by", "label": "指摘した役割"},
                    {"key": "kind", "label": "種類", "kind": "badge"}, {"key": "sev", "label": "重さ", "kind": "badge"},
                    {"key": "status", "label": "状態", "kind": "badge"}],
                   [{"name": k, "children": v} for k, v in groups.items()])
        paths = self.rows("specs.toon", "paths")
        dc = {(d.get("path"), d.get("scenario")): d for d in self.rows("reviews.toon", "desk_checks")}
        parts = ['<section class="lg-design"><h2>机上実行（経路×場面）</h2><div class="lg-scroll"><table class="lg-matrix"><thead><tr><th>経路＼場面</th>']
        parts += [f"<th>{esc(ja(s))}</th>" for s in ledger.DESK_SCENARIOS]
        parts.append("</tr></thead><tbody>")
        for p in paths:
            parts.append(f"<tr><th>{esc(p.get('name'))}</th>")
            for s in ledger.DESK_SCENARIOS:
                d = dc.get((p.get("id"), s))
                if not d:
                    parts.append('<td class="lg-cell-missing">（未実施）</td>')
                    continue
                extra = f'<div class="lg-sub">{self.el(d.get("reason"))}</div>' if d.get("reason") else ""
                parts.append(f'<td class="lg-dc-{esc(d.get("result"))}"><div class="lg-act">{esc(ja(d.get("result")))}</div><div>{self.el(d.get("walk"))}</div>{extra}</td>')
            parts.append("</tr>")
        parts.append("</tbody></table></div></section>")
        self.html("".join(parts))

    def decisions(self):
        self.table("questions", "確認事項と決定",
                   [{"key": "name", "label": "問い"}, {"key": "why", "label": "答えで変わること"}, {"key": "options", "label": "選択肢"},
                    {"key": "rec", "label": "推奨と理由"}, {"key": "answer", "label": "答え"}, {"key": "by", "label": "答えた人"},
                    {"key": "status", "label": "状態", "kind": "badge"}],
                   [{"name": q.get("question"), "cells": self.cells({
                       "why": q.get("why"), "options": q.get("options"), "rec": q.get("recommendation"),
                       "answer": q.get("answer") or "—", "by": ja(q.get("answered_by")), "status": badge(q.get("status"))})}
                    for q in self.rows("decisions.toon", "questions")])

    def sources(self):
        self.table("sources", "情報源", [{"key": "name", "label": "場所"}, {"key": "kind", "label": "種類"}, {"key": "version", "label": "版"},
                                        {"key": "rel", "label": "信頼の扱い"}, {"key": "note", "label": "メモ"}],
                   [{"name": s.get("path"), "cells": self.cells({
                       "kind": s.get("kind"), "version": s.get("version") or "—",
                       "rel": {"fact": "事実（コード等）", "unreliable_doc": "保守されていない文書", "claim": "申告", "other": "その他"}.get(s.get("reliability"), s.get("reliability")),
                       "note": s.get("note") or "—"})} for s in self.rows("sources.toon", "sources")])

    def reconcile(self):
        if self.L.data.get("reconcile.toon") is None:
            return
        tool = self.L.scalar("reconcile.toon", "tool")
        rows = [{"name": self.name(r.get("ledger_task")) if r.get("ledger_task") else "（台帳になし）", "cells": self.cells({
            "tool": r.get("tool_item") or "（道具になし）", "rel": JA.get(r.get("relation"), r.get("relation")) if r.get("relation") != "changed" else "変わった",
            "note": r.get("note") or "—"})} for r in self.rows("reconcile.toon", "task_map")]
        self.table("reconcile-tasks", f"道具（{tool}）のタスクとの突き合わせ",
                   [{"key": "name", "label": "台帳のタスク"}, {"key": "tool", "label": "道具の項目"}, {"key": "rel", "label": "関係"}, {"key": "note", "label": "メモ"}], rows)
        rows = [{"name": self.name(r.get("ledger_requirement")) if r.get("ledger_requirement") else "（台帳になし）", "cells": self.cells({
            "tool": r.get("tool_item") or "（道具になし）", "rel": JA.get(r.get("relation"), r.get("relation")) if r.get("relation") != "changed" else "変わった",
            "note": r.get("note") or "—"})} for r in self.rows("reconcile.toon", "requirement_map")]
        self.table("reconcile-reqs", f"道具（{tool}）の要件との突き合わせ",
                   [{"key": "name", "label": "台帳の要件"}, {"key": "tool", "label": "道具の項目"}, {"key": "rel", "label": "関係"}, {"key": "note", "label": "メモ"}], rows)

    def validation(self):
        vp = os.path.join(self.dir, "validation.toon")
        if not os.path.exists(vp):
            return
        with open(vp, "rb") as f:
            v = toon.decode(f.read())
        rows = [{"name": self.unid(m.get("message")), "cells": self.cells({"file": m.get("file"), "target": self.unid(m.get("target")), "level": "エラー"})} for m in v.get("errors", [])]
        rows += [{"name": self.unid(m.get("message")), "cells": self.cells({"file": m.get("file"), "target": self.unid(m.get("target")), "level": "警告"})} for m in v.get("warnings", [])]
        self.table("validation", "機械検査の結果", [{"key": "name", "label": "内容"}, {"key": "file", "label": "ファイル"}, {"key": "target", "label": "対象"}, {"key": "level", "label": "区分"}], rows)

    def build(self):
        self.summary()
        self.trace()
        self.tasks()
        self.design()
        self.impact()
        self.specs()
        self.frames()
        self.needs_requirements()
        self.current()
        self.quality()
        self.verify()
        self.decisions()
        self.reconcile()
        self.sources()
        self.validation()
        topic = self.L.scalar("progress.toon", "topic") or ""
        commit = self.L.scalar("scope.toon", "git_commit") or "（記録なし）"
        data = {
            "title": f"実装タスクの徹底調査：{topic}",
            "meta": [
                {"label": "状態", "value": ja(self.L.scalar("progress.toon", "status"))},
                {"label": "種類", "value": ja(self.L.scalar("scope.toon", "kind"))},
                {"label": "調べた版", "value": commit + ("（未コミットの変更あり）" if self.L.scalar("scope.toon", "git_dirty") else "")},
                {"label": "作成日", "value": self.L.scalar("scope.toon", "created") or ""},
                {"label": "最終更新", "value": self.L.scalar("progress.toon", "updated") or ""},
            ],
            "head_html": HEAD,
            "blocks": self.blocks,
            "tail_html": TAIL + manifest_script(self.dir),
        }
        doc, tables, _ = html_tables.normalize_document(data, HERE)
        with open(html_tables.TEMPLATE, encoding="utf-8") as f:
            template = f.read()
        return html_tables.embed(template, doc, tables)


def evtext(r):
    p = r.get("ev_path")
    if p in (None, "", "none"):
        return "—"
    if p == "conversation":
        return f"会話：「{r.get('ev_quote')}」"
    return f"{p}:{r.get('ev_line')}\n「{r.get('ev_quote')}」"


def ledger_hashes(folder):
    out = {}
    for fname in ledger.LEDGER_FILES:
        p = os.path.join(folder, fname)
        if os.path.exists(p):
            with open(p, "rb") as f:
                out[fname] = hashlib.sha256(f.read()).hexdigest()
    return out


def manifest_script(folder):
    m = {"generator": "micropower-investigate/render_html.py", "toon_spec": toon.TOON_SPEC_VERSION,
         "files": ledger_hashes(folder)}
    vp = os.path.join(folder, "validation.toon")
    if os.path.exists(vp):
        with open(vp, "rb") as f:
            m["files"]["validation.toon"] = hashlib.sha256(f.read()).hexdigest()
    payload = json.dumps(m, ensure_ascii=False, sort_keys=True).replace("<", "\\u003c")
    return f'\n<script type="application/json" id="ledger-manifest">{payload}</script>'


HEAD = """<style>
.tree thead th:last-child .resize-handle { right: 0; }
.lg-summary { margin: 8px 0 4px; }
.lg-status, .lg-valid { display: inline-block; font-weight: 700; padding: 4px 10px; border-radius: 6px; margin: 0 8px 8px 0; border: 1px solid var(--border-strong); }
.lg-status-complete, .lg-valid-ok { color: var(--green); background: var(--green-bg); }
.lg-status-provisional, .lg-valid-stale, .lg-valid-none { color: var(--amber); background: var(--amber-bg); }
.lg-status-in_progress { color: var(--muted); }
.lg-valid-ng { color: var(--red); background: var(--red-bg); }
.lg-cards { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
.lg-card { flex: 1 1 140px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.lg-card-k { font-size: 12px; color: var(--muted); }
.lg-card-v { font-size: 20px; font-weight: 700; }
.lg-card-n { font-size: 11px; color: var(--faint); }
.lg-request { margin: 4px 0 12px; padding: 8px 12px; border-left: 4px solid var(--border-strong); background: var(--surface); white-space: normal; }
.lg-summary h2, .lg-design h2, .lg-empty h2 { font-size: 17px; margin: 22px 0 6px; }
.lg-design h3 { font-size: 15px; margin: 16px 0 4px; }
.lg-note { font-size: 12px; color: var(--muted); margin: 2px 0 8px; }
.lg-scroll { overflow-x: auto; }
.lg-matrix, .lg-plain { border-collapse: collapse; width: 100%; font-size: 12.5px; background: var(--surface); margin-bottom: 8px; }
.lg-matrix th, .lg-matrix td, .lg-plain th, .lg-plain td { border: 1px solid var(--border); padding: 5px 7px; vertical-align: top; text-align: left; }
.lg-matrix thead th, .lg-plain thead th { background: var(--surface-2); }
.lg-matrix tbody th { background: var(--surface-2); min-width: 120px; }
.lg-matrix ul { margin: 3px 0 0; padding-left: 16px; }
.lg-act { font-weight: 600; }
.lg-sub { font-size: 11px; color: var(--muted); font-weight: 400; }
.lg-cell-change, .lg-fr-need, .lg-fr-requirement, .lg-tr-transition, .lg-dc-determined { background: var(--green-bg); }
.lg-cell-existing_ok { background: var(--surface-2); }
.lg-cell-not_handled, .lg-fr-none, .lg-fr-not_needed, .lg-tr-ignore, .lg-tr-not_applicable, .lg-dc-not_applicable { color: var(--muted); }
.lg-cell-unconfirmed, .lg-fr-unconfirmed, .lg-tr-unconfirmed, .lg-cell-missing, .lg-dc-undetermined { background: var(--red-bg); color: var(--red); }
.lg-tr-reject { background: var(--amber-bg); }
</style>"""

TAIL = """<script>
(function () {
  document.querySelectorAll('table.tree').forEach(function (table) {
    var heads = table.querySelectorAll('thead th');
    heads.forEach(function (th, i) {
      th.style.minWidth = '70px';
      var badge = table.querySelector('tbody tr td:nth-child(' + (i + 1) + ') .b');
      if (badge) { th.style.minWidth = '108px'; }
    });
  });
})();
</script>"""


def render(folder):
    return Report(folder).build()


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
    out = a.out or os.path.join(a.dir, "report.html")
    try:
        html_text = render(a.dir)
    except html_tables.ValidationError as e:
        print(f"ERROR: HTML の組み立てに失敗: {e}", file=sys.stderr)
        return 2
    if a.cmd == "render":
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write(html_text)
        print(f"作成しました：{out}")
        return 0
    if not os.path.exists(out):
        print(f"不整合：HTML がない（{out}）")
        return 1
    with open(out, encoding="utf-8") as f:
        existing = f.read()
    if existing == html_text:
        print("整合：HTML は今の TOON から作ったものと一致する")
        return 0
    m = MANIFEST_RE.search(existing)
    changed = []
    if m:
        try:
            old = json.loads(m.group(1)).get("files", {})
            cur = json.loads(MANIFEST_RE.search(html_text).group(1)).get("files", {})
            changed = sorted(k for k in set(old) | set(cur) if old.get(k) != cur.get(k))
        except ValueError:
            pass
    print("不整合：HTML が今の TOON と一致しない" + (f"（HTML を作った後に変わったファイル：{', '.join(changed)}）" if changed else "（HTML が手で直されたか、生成の処理が変わった）"))
    print("render で作り直してください")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
