# -*- coding: utf-8 -*-
"""レビューの最終アウトプット（「要件一覧」と「要件ごとの指摘」の HTML）を作る。

使い方:
  python build_report.py <レビューのフォルダ>                検査してから HTML を作る
  python build_report.py <レビューのフォルダ> --check-only   検査だけする（HTML は作らない）
  python build_report.py --self-test                         同梱のサンプルで動作を確かめる

読むもの（レビューのフォルダの中）:
  review.json             対象・版・資料・状態
  03_requirements.jsonl   要件（1行に1件。同じ id の行が後にあれば、後の行で置き換える）
  08_findings/*.json      指摘（1ファイルに1件）
作るもの:
  report/<名前>.data.json と report/<名前>.html（universal-html-output の render.py で描画する）

検査:
  誤り（直すまで HTML を作らない）
    - 必須の項目がない、要件への紐付けが切れている、場所が「パス:行」の形でない
    - 表示する文にレビュー内のID（REQ-001、V10、F-001 など）が残っている
    - 場所のファイルがリポジトリにない、行がファイルの範囲外
  注意（場所を開いて確かめ、直す）
    - 根拠の「」の引用が、示した場所の近くに見つからない
    - 修正例の元の行（先頭が空白か -）が、示した場所の近くに見つからない

リポジトリのルートは、レビューのフォルダが <ルート>/.ai_review_workspace/<名前>/ にあるものとして決める。
別の場所にあるときは --repo-root で指定する。
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parent
RENDER = Path(os.environ.get(
    "UNIVERSAL_HTML_RENDER",
    Path.home() / ".claude" / "skills" / "universal-html-output" / "scripts" / "render.py"))

REPORTED = ("設計欠陥", "実装の誤り", "設計未定義", "判断保留")      # HTML に載せる判定（この順に並べる）
NOT_REPORTED = ("問題なし", "対象外", "改善提案", "取り下げ")        # 記録として残すが HTML に載せない
NEEDS_WHERE = ("要求", "設計書", "コード", "共通仕様")              # 根拠でこのラベルなら場所が要る

ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]*$")
LOC_RE = re.compile(r"^(?P<path>(?:[A-Za-z]:)?[^:]+?):(?P<start>\d+)(?:-(?P<end>\d+))?$")  # パス:行 / パス:開始行-終了行
PATH_RE = re.compile(r"^(?:[A-Za-z]:)?[^:]+$")                                            # パスだけ（「記載がない」の根拠）
LINK_RE = re.compile(r"\[\[([A-Za-z][A-Za-z0-9_\-]*)\]\]")                               # [[REQ-020]] → 要件20 へのリンク
CODE_RE = re.compile(r"`[^`\n]+`")
# 最終アウトプットに出さない、レビューの中で振ったID（視点・指摘・確認待ち・ケース・資料・要件・基準ケース）と視点の丸数字
REVIEW_ID_RE = re.compile(
    r"(?<![A-Za-z0-9_\-])(?:V\d{2}|F-\d+|Q-\d+|C-V\d{2}-\d+|C-X-\d+|SRC-\d+|REQ-\d+|BASE-\d+)(?![0-9])|[①-⑲]")
OPEN, CLOSE = "（「『(【", "）」』)】"
NORM_DROP = re.compile(r"[\s　*_`#>|]")
ELISION = ("", "…", "...", "⋮", "（略）", "(略)")


# ---------------------------------------------------------------- 文字列の整形

def one_sentence_per_line(text: str) -> str:
    """括弧の外の「。」ごとに改行する（1文1行）。"""
    out, depth = [], 0
    for ch in text:
        if ch in OPEN:
            depth += 1
        elif ch in CLOSE:
            depth = max(0, depth - 1)
        out.append(ch)
        if ch == "。" and depth == 0:
            out.append("\n")
    return re.sub(r"\n+", "\n", "".join(out)).strip("\n")


def esc(text: str) -> str:
    return html.escape(text, quote=False)


def extract_quotes(text: str) -> list[str]:
    """「」で囲まれた部分を取り出す（入れ子の「」は外側でまとめる）。"""
    out, buf, depth = [], [], 0
    for ch in text:
        if ch == "「":
            if depth:
                buf.append(ch)
            depth += 1
        elif ch == "」" and depth:
            depth -= 1
            if depth:
                buf.append(ch)
            else:
                out.append("".join(buf))
                buf = []
        elif depth:
            buf.append(ch)
    return out


def drop_quotes(text: str) -> str:
    out, depth = [], 0
    for ch in text:
        if ch == "「":
            depth += 1
        elif ch == "」" and depth:
            depth -= 1
        elif not depth:
            out.append(ch)
    return "".join(out)


def norm(text: str) -> str:
    return NORM_DROP.sub("", text)


def safe_name(text: str) -> str:
    return re.sub(r'[\\/:*?"<>|\s]+', "_", text).strip("_") or "review"


# ---------------------------------------------------------------- 読み込み

def load_requirements(path: Path, errs: list, warns: list) -> list[dict]:
    if not path.exists():
        errs.append(f"{path.name} がない")
        return []
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    last = max((i for i, l in enumerate(lines, 1) if l.strip()), default=0)
    records, order = {}, []
    for i, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError as e:
            if i == last:
                warns.append(f"{path.name}:{i} 最後の行が JSON として読めない（中断で書きかけの可能性）。"
                             "この行は読み飛ばした。書き直す")
            else:
                errs.append(f"{path.name}:{i} JSON として読めない（{e.msg}）")
            continue
        if not isinstance(r, dict) or not isinstance(r.get("id"), str):
            errs.append(f"{path.name}:{i} id がない")
            continue
        if r["id"] not in records:
            order.append(r["id"])
        records[r["id"]] = {**r, "_line": i}
    reqs = [records[k] for k in order if not records[k].get("deleted")]
    rank: dict[str, int] = {}
    for r in reqs:
        rank.setdefault(r.get("group") or "", len(rank))
    reqs.sort(key=lambda r: rank[r.get("group") or ""])   # グループの初出順。グループ内は書いた順
    return reqs


def load_findings(folder: Path, errs: list) -> list[dict]:
    out = []
    if not folder.exists():
        return out
    for p in sorted(folder.glob("*.json")):
        try:
            f = json.loads(p.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as e:
            errs.append(f"08_findings/{p.name}: JSON として読めない（{e.lineno}行目：{e.msg}）")
            continue
        if not isinstance(f, dict):
            errs.append(f"08_findings/{p.name}: 1つの指摘を {{...}} で書く")
            continue
        f["_file"] = p.name
        out.append(f)
    return out


# ---------------------------------------------------------------- 書式の検査

def finding_texts(f: dict):
    """表示する文と、「」の中を原文の引用として許すか。"""
    for k in ("name", "event", "cause"):
        if isinstance(f.get(k), str):
            yield f[k], False
    for e in f.get("cause_at") or []:
        if isinstance(e, str):
            yield e, False
        elif isinstance(e, dict) and isinstance(e.get("note"), str):
            yield e["note"], True
    fix = f.get("fix") if isinstance(f.get("fix"), dict) else {}
    for k in ("label", "text", "note", "diff_label"):
        if isinstance(fix.get(k), str):
            yield fix[k], False
    for d in fix.get("diffs") or []:
        if isinstance(d, dict) and isinstance(d.get("note"), str):
            yield d["note"], True
    for s in f.get("repro") or []:
        if isinstance(s, str):
            yield s, False
    for b in f.get("basis") or []:
        if isinstance(b, dict):
            if isinstance(b.get("label"), str):
                yield b["label"], False
            if isinstance(b.get("text"), str):
                yield b["text"], True


def leaked_ids(text: str, allow_quotes: bool) -> set:
    t = LINK_RE.sub("", text)
    t = CODE_RE.sub("", t)
    if allow_quotes:
        t = drop_quotes(t)
    return set(REVIEW_ID_RE.findall(t))


def validate(reqs: list, findings: list, errs: list) -> None:
    req_ids = {r["id"] for r in reqs}
    for r in reqs:
        at = f"03_requirements.jsonl:{r['_line']}（{r['id']}）"
        if not ID_RE.match(r["id"]):
            errs.append(f"{at}: id は英字で始め、英数字と - _ だけにする")
        for k in ("context", "requirement"):
            if not isinstance(r.get(k), str) or not r[k].strip():
                errs.append(f"{at}: {k} がない")
            else:
                hits = leaked_ids(r[k], False)
                if hits:
                    errs.append(f"{at}: {k} にレビュー内のID {sorted(hits)} がある。名前や内容で書く")
        src = r.get("source", [])
        if not isinstance(src, list) or not all(isinstance(s, str) for s in src):
            errs.append(f"{at}: source は場所の文字列のリストにする")
        else:
            for s in src:
                if not (LOC_RE.match(s) or PATH_RE.match(s)):
                    errs.append(f"{at}: source の {s!r} が「パス:行」かパスの形でない")
    for f in findings:
        at = f"08_findings/{f['_file']}「{f.get('name', '?')}」"
        j = f.get("judgment")
        if j not in REPORTED + NOT_REPORTED:
            errs.append(f"{at}: judgment は {'・'.join(REPORTED + NOT_REPORTED)} のどれか（今は {j!r}）")
            continue
        if f.get("req") and f["req"] not in req_ids:
            errs.append(f"{at}: req {f['req']} が要件（03_requirements.jsonl）にない")
        if j in NOT_REPORTED:
            continue   # HTML に載せないので、書式は問わない
        for k in ("id", "req", "name", "event", "cause"):
            if not isinstance(f.get(k), str) or not f[k].strip():
                errs.append(f"{at}: {k} がない")
        cause_at = f.get("cause_at")
        if not isinstance(cause_at, list) or not cause_at:
            errs.append(f"{at}: cause_at（原因箇所）がない")
        else:
            for e in cause_at:
                if isinstance(e, dict):
                    if not LOC_RE.match(str(e.get("where", ""))):
                        errs.append(f"{at}: 原因箇所 {e.get('where')!r} が「パス:行」の形でない"
                                    "（場所のないものは文字列で書く）")
                elif not (isinstance(e, str) and e.strip()):
                    errs.append(f"{at}: 原因箇所は {{where, note}} か文字列で書く")
        fix = f.get("fix")
        if not isinstance(fix, dict) or not fix.get("label") or not fix.get("text"):
            errs.append(f"{at}: fix に label と text がない")
        else:
            for d in fix.get("diffs") or []:
                if not isinstance(d, dict):
                    errs.append(f"{at}: 修正例は {{where, note, code}} で書く")
                    continue
                w = str(d.get("where", ""))
                if not LOC_RE.match(w):
                    errs.append(f"{at}: 修正例の場所 {w!r} が「パス:行」の形でない")
                code = d.get("code")
                if not isinstance(code, str) or not code.strip():
                    errs.append(f"{at}: 修正例 {w} に code がない")
                    continue
                for n, line in enumerate(code.strip("\n").split("\n"), 1):
                    if line and line[0] not in " +-":
                        errs.append(f"{at}: 修正例 {w} の {n} 行目の先頭が、空白・+・- のどれでもない（{line[:30]!r}）")
        repro = f.get("repro")
        if not isinstance(repro, list) or not repro or not all(isinstance(s, str) and s.strip() for s in repro):
            errs.append(f"{at}: repro（再現手順）を文字列のリストで書く")
        basis = f.get("basis")
        if not isinstance(basis, list) or not basis:
            errs.append(f"{at}: basis（根拠）がない")
        else:
            for b in basis:
                if not isinstance(b, dict) or not b.get("label") or not b.get("text"):
                    errs.append(f"{at}: 根拠は {{label, where, text}} で書く")
                    continue
                wheres = b.get("where") or []
                if not isinstance(wheres, list):
                    errs.append(f"{at}: 根拠「{b['label']}」の where は場所のリストにする")
                    continue
                for w in wheres:
                    if not (isinstance(w, str) and (LOC_RE.match(w) or PATH_RE.match(w))):
                        errs.append(f"{at}: 根拠の場所 {w!r} が「パス:行」かパスの形でない")
                if b["label"] in NEEDS_WHERE and not wheres:
                    errs.append(f"{at}: 根拠「{b['label']}」に確かめる場所（where）がない")
        hits = set()
        for text, allow_quotes in finding_texts(f):
            for k in LINK_RE.findall(text):
                if k not in req_ids:
                    errs.append(f"{at}: リンク [[{k}]] の要件がない")
            hits |= leaked_ids(text, allow_quotes)
        if hits:
            errs.append(f"{at}: 表示する文にレビュー内のID {sorted(hits)} がある。名前や内容で書く"
                        "（要件を指すなら [[要件のid]]）")


# ---------------------------------------------------------------- 場所の照合

class Sources:
    """リポジトリのファイルを読み、場所・引用・修正例の元の行を照らし合わせる。"""

    def __init__(self, root: Path):
        self.root = root
        self.cache: dict[str, list | None] = {}

    def lines(self, path: str):
        if path not in self.cache:
            p = Path(path)
            p = p if p.is_absolute() else self.root / p
            if not p.is_file():
                self.cache[path] = None
            else:
                raw = p.read_bytes()
                for enc in ("utf-8-sig", "cp932"):
                    try:
                        text = raw.decode(enc)
                        break
                    except UnicodeDecodeError:
                        continue
                else:
                    text = raw.decode("utf-8", errors="replace")
                self.cache[path] = text.splitlines()
        return self.cache[path]

    def locate(self, where: str, at: str, errs: list, allow_next_line: bool = False):
        m = LOC_RE.match(where)
        path, start, end = (m["path"], int(m["start"]), int(m["end"] or m["start"])) if m else (where, None, None)
        lines = self.lines(path)
        if lines is None:
            errs.append(f"{at}: {path} がリポジトリにない（ルート：{self.root}）")
            return None
        if start is not None:
            limit = len(lines) + (1 if allow_next_line else 0)
            if start < 1 or end < start or end > limit:
                errs.append(f"{at}: {where} の行が、ファイルの範囲外か逆順（全 {len(lines)} 行）")
                return None
        return path, start, end, lines

    @staticmethod
    def window(start, end, lines, margin):
        if start is None:
            return lines
        return lines[max(0, start - 1 - margin): end + margin]

    def check_quotes(self, text: str, wheres: list, at: str, warns: list) -> None:
        quotes = [q for q in extract_quotes(text) if len(norm(q).rstrip("。")) >= 6]
        if not quotes or not wheres:
            return
        spans = []
        for w in wheres:
            hit = self.locate(w, at, [])
            if hit:
                _, s, e, lines = hit
                spans.append(norm("".join(self.window(s, e, lines, 3))))
        if not spans:
            return
        for q in quotes:
            nq = norm(q).rstrip("。")
            if not any(nq in sp for sp in spans):
                warns.append(f"{at}: 引用「{q[:40]}」が {'、'.join(wheres)} の近くに見つからない。"
                             "原文をそのまま引くか、場所を直す")

    def check_diff(self, d: dict, at: str, errs: list, warns: list) -> None:
        if d.get("new_file"):
            return
        code = str(d.get("code", "")).strip("\n").split("\n")
        pure_add = all((not l) or l[0] == "+" for l in code)
        hit = self.locate(str(d.get("where", "")), at, errs, allow_next_line=pure_add)
        if not hit:
            return
        _, s, e, lines = hit
        near = {re.sub(r"\s+", " ", l.strip()) for l in self.window(s, e, lines, 5)}
        for l in code:
            if not l or l[0] not in " -":
                continue
            body = re.sub(r"\s+", " ", l[1:].strip())
            if body in ELISION:
                continue
            if body not in near:
                warns.append(f"{at}: 修正例 {d.get('where')} の元の行「{body[:40]}」が、その場所の近くにない。"
                             "開いたファイルの行をそのまま写す")


def check_refs(reqs: list, findings: list, root: Path, errs: list, warns: list) -> None:
    src = Sources(root)
    for r in reqs:
        at = f"03_requirements.jsonl:{r['_line']}（{r['id']}）"
        for s in r.get("source") or []:
            if isinstance(s, str):
                src.locate(s, at, errs)
    for f in findings:
        if f.get("judgment") not in REPORTED:
            continue
        at = f"08_findings/{f['_file']}「{f.get('name', '?')}」"
        for e in f.get("cause_at") or []:
            if isinstance(e, dict) and LOC_RE.match(str(e.get("where", ""))):
                src.locate(e["where"], at, errs)
        fix = f.get("fix") if isinstance(f.get("fix"), dict) else {}
        for d in fix.get("diffs") or []:
            if isinstance(d, dict) and LOC_RE.match(str(d.get("where", ""))):
                src.check_diff(d, at, errs, warns)
        for b in f.get("basis") or []:
            if not isinstance(b, dict):
                continue
            wheres = [w for w in b.get("where") or [] if isinstance(w, str)]
            for w in wheres:
                src.locate(w, at, errs)
            src.check_quotes(str(b.get("text", "")), wheres, at, warns)


# ---------------------------------------------------------------- HTML の組み立て

class Builder:
    def __init__(self, reqs: list, findings: list):
        self.reqs = reqs
        self.no = {r["id"]: i for i, r in enumerate(reqs, 1)}
        rank = {j: i for i, j in enumerate(REPORTED)}
        shown = [f for f in findings if f.get("judgment") in REPORTED]
        self.by_req: dict[str, list] = {}
        for f in sorted(shown, key=lambda f: (rank[f["judgment"]], f["_file"])):
            self.by_req.setdefault(f["req"], []).append(f)
        self.with_findings = [r["id"] for r in reqs if r["id"] in self.by_req]

    def md(self, text: str) -> str:
        """1文1行にしてエスケープし、`…` をコード表記に、[[要件のid]] を要件へのリンクにする。"""
        s = esc(one_sentence_per_line(text))
        s = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", s)
        return LINK_RE.sub(lambda m: f'<a href="#rv-req-{m.group(1)}">要件{self.no[m.group(1)]}</a>', s)

    def places(self, entries) -> str:
        out = []
        for e in entries:
            if isinstance(e, dict):
                note = f"　{esc(e['note'])}" if e.get("note") else ""
                out.append(f"<div><code>{esc(e['where'])}</code>{note}</div>")
            else:
                out.append(f"<div>{self.md(e)}</div>")
        return "".join(out)

    def cause(self, f: dict) -> dict:
        return {"html": f"<div>{self.md(f['cause'])}</div><div><b>原因箇所</b>：</div>{self.places(f['cause_at'])}"}

    def fix(self, f: dict) -> dict:
        x = f["fix"]
        parts = [f"<div><b>{esc(x['label'])}</b>：{self.md(x['text'])}</div>"]
        if x.get("diffs"):
            parts.append(f"<div><b>{esc(x.get('diff_label') or '修正例：')}</b></div>")
            for d in x["diffs"]:
                note = f"　{esc(d['note'])}" if d.get("note") else ""
                parts.append(f"<div><code>{esc(d['where'])}</code>{note}</div>"
                             f"<pre><code>{esc(d['code'].strip(chr(10)))}</code></pre>")
        if x.get("note"):
            parts.append(f"<div><b>補足</b>：{self.md(x['note'])}</div>")
        return {"html": "".join(parts)}

    def repro(self, steps: list) -> dict:
        return {"html": "<ol>" + "".join(f"<li>{self.md(s)}</li>" for s in steps) + "</ol>"}

    def basis(self, items: list) -> dict:
        out = []
        for b in items:
            w = "、".join(f"<code>{esc(x)}</code>" for x in b.get("where") or [])
            out.append(f"<div><b>{esc(b['label'])}</b>" + (f"（{w}）" if w else "") + f"：{self.md(b['text'])}</div>")
        return {"html": "".join(out)}

    def requirements_html(self) -> str:
        rows = []
        for i, r in enumerate(self.reqs, 1):
            anchor = "" if r["id"] in self.by_req else f' id="rv-req-{esc(r["id"])}"'
            rows.append(f'<tr{anchor}><td class="rv-no">{i}</td><td>{esc(r["context"])}</td>'
                        f'<td>{esc(r["requirement"])}</td></tr>')
        intro = one_sentence_per_line("レビューで照らし合わせた要件。資料に書かれた要件と、設計書・共通仕様から読み取った"
                                      "暗黙の要件を含む。No は、次の表の番号と同じ。")
        return ('<section class="rv-req"><h2>要件一覧</h2>'
                f'<p>{esc(intro)}</p>'
                '<div class="rv-scroll"><table class="rv-table"><thead><tr><th>No</th><th>前提となる文脈</th>'
                '<th>要件（機能・非機能・暗黙的）</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table></div></section>')

    def findings_table(self) -> dict:
        groups = []
        for rid in self.with_findings:
            r = self.reqs[self.no[rid] - 1]
            children = [{"name": f["name"], "cells": {
                "event": {"html": self.md(f["event"])}, "cause": self.cause(f), "fix": self.fix(f),
                "repro": self.repro(f["repro"]), "basis": self.basis(f["basis"])}} for f in self.by_req[rid]]
            groups.append({"name": f"{self.no[rid]}. {r['requirement']}", "children": children})
        intro = ("指摘のある要件だけを、要件一覧の No の順に並べた。要件ごとに、指摘・事象・原因・修正案・再現手順・根拠を書いた。"
                 "場所は `パス:行`（VS Code で開ける書き方）。修正例は、赤の行（先頭が -）を消し、緑の行（先頭が +）を加える。"
                 "「前提（未確認）」は、指摘が頼っているが確かめていないこと。")
        if not groups:
            intro = "確認した範囲では、要件に対する指摘はなかった。確認していない範囲は、レビューの記録に残してある。"
        return {
            "type": "table", "id": "findings", "title": "要件ごとの指摘",
            "intro": {"html": self.md(intro)},
            "columns": [
                {"key": "name", "label": "要件・指摘"}, {"key": "event", "label": "事象"},
                {"key": "cause", "label": "原因（原因箇所）"}, {"key": "fix", "label": "修正案"},
                {"key": "repro", "label": "再現手順"}, {"key": "basis", "label": "根拠"},
            ],
            "rows": groups,
        }


HEAD = """<style>
/* このレポート用の追加。表のデザインはテンプレートのまま変えない。 */
.tree a, .rv-req a { color: var(--accent); }
.tree td ol { margin: 0; padding-left: 1.4em; }
.tree td li + li { margin-top: 3px; }
.tree td > div + div { margin-top: 2px; }
.tree td code { overflow-wrap: anywhere; }
/* 修正例（変更前後）。直す場所の見出しの下に差分を置く。- の行は削除、+ の行は追加。 */
.tree .rv-diff-path { margin: 8px 0 0; padding: 3px 8px; background: var(--surface-2); border: 1px solid var(--border); border-bottom: 0; border-radius: 4px 4px 0 0; font-size: 12px; }
.tree .rv-diff-path code { padding: 0; border: 0; background: none; font-weight: 700; }
.tree pre { margin: 0 0 6px; padding: 5px 0; background: var(--surface-2); border: 1px solid var(--border); border-radius: 0 0 4px 4px;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 12px; line-height: 1.5;
  white-space: pre-wrap; overflow-wrap: anywhere; font-weight: 400; }
.tree pre code { display: block; padding: 0; border: 0; background: none; font-size: inherit; }
.tree pre code > span { display: block; padding: 0 8px; min-height: 1.5em; }
.tree pre .rv-add { color: var(--green); background: var(--green-bg); }
.tree pre .rv-del { color: var(--red); background: var(--red-bg); }
/* 場所（パス:行）は途中で折り返さない。場所でない長いコード（JSON・SQL など）は折り返し、列を広げない */
.tree .rv-diff-path code, .tree td code.rv-loc { white-space: nowrap; overflow-wrap: normal; }
/* 要件一覧（普通の表） */
.rv-req { margin: 0 0 22px; }
.rv-req h2 { margin: 0 0 9px; font-size: 16px; line-height: 1.5; }
.rv-req p { margin: 0 0 10px; color: var(--muted); white-space: pre-line; }
.rv-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rv-table th, .rv-table td { text-align: left; vertical-align: top; padding: 6px 10px; border-bottom: 1px solid var(--border); }
.rv-table th { position: sticky; top: 0; z-index: 1; background: var(--surface-2); color: var(--muted); font-weight: 600; font-size: 12px; white-space: nowrap; }
.rv-table td.rv-no { width: 3.5em; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rv-table td:nth-child(2) { width: 36%; }
.rv-table tr.flash { outline: 2px solid var(--accent); outline-offset: -2px; }
/* 高さの上限：要件一覧は 449px、要件ごとの指摘はその3倍。超える分は表の中でスクロールし、見出しの行は固定する。 */
.rv-scroll { max-height: 449px; overflow: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
[data-table-id="findings"] .panel { max-height: 1347px; overflow: auto; }
[data-table-id="findings"] .tree thead th { position: sticky; top: 0; z-index: 2; }
[data-table-id="findings"] tr.t-group { scroll-margin-top: 36px; }
/* 要件の見出しは要件一覧の No を名前に含めるため、自動の番号は出さない */
[data-table-id="findings"] tr.t-group > td > span:first-child { display: none; }
/* 右端の列の幅変更つまみが表の外へはみ出し、横スクロールバーが出るのを防ぐ */
.tree thead th:last-child .resize-handle { right: 0; }
</style>"""

TAIL = """<script>
/* このレポート用の追加処理。テンプレートの描画の後に実行する。
   1. 要件の見出しの行に、ページ内リンクの移動先を付ける。
   2. 場所（パス:行）の code に印を付け（折り返さない）、修正例の直す場所の見出しと、- と + の行に色を付ける。
   3. 先頭の見出しの字下げをそろえ、列の自動幅に下限を付ける（70px 未満の列があると保存した列幅が消えるため）。 */
(() => {
  "use strict";
  const KEYS = __KEYS__;
  [...document.querySelectorAll('[data-table-id="findings"] tbody tr.t-group')].forEach((tr, i) => { if (KEYS[i]) tr.id = `rv-req-${KEYS[i]}`; });
  document.addEventListener("click", e => {
    const a = e.target.closest('a[href^="#rv-req-"]');
    const t = a && document.getElementById(a.getAttribute("href").slice(1));
    if (!t) return;
    t.classList.add("flash");
    setTimeout(() => t.classList.remove("flash"), 1600);
  });
  const LOC = /^(?:[A-Za-z]:)?[^\\s:]*[\\/.][^\\s:]*(?::\\d+(?:-\\d+)?)?$/;
  for (const c of document.querySelectorAll(".tree td code")) if (!c.closest("pre") && LOC.test(c.textContent)) c.classList.add("rv-loc");
  for (const code of document.querySelectorAll(".tree pre > code")) {
    const head = code.parentElement.previousElementSibling;
    if (head && head.tagName === "DIV" && head.firstElementChild?.tagName === "CODE") head.classList.add("rv-diff-path");
    code.replaceChildren(...code.textContent.split("\\n").map(line => {
      const span = document.createElement("span");
      if (line.startsWith("+")) span.className = "rv-add";
      else if (line.startsWith("-")) span.className = "rv-del";
      span.textContent = line;
      return span;
    }));
  }
  // 列の下限。広い画面では自動で広がる。合計を 1920px の画面の表示幅（約1820px）より小さくしておく。
  const MIN = { name: 160, event: 210, cause: 290, fix: 370, repro: 250, basis: 330 };
  for (const entry of TABLES_DATA) {
    const table = document.querySelector(`[data-table-id="${CSS.escape(entry.id)}"] table.tree`);
    if (!table) continue;
    const head = table.tHead.rows[0];
    const full = [...table.tBodies[0].rows].filter(tr => tr.cells.length === entry.columns.length);
    if (full.length) head.cells[0].style.paddingLeft = `${Math.min(...full.map(tr => parseFloat(getComputedStyle(tr.cells[0]).paddingLeft) || 0))}px`;
    entry.columns.forEach((col, i) => { head.cells[i].style.minWidth = `${Math.max(COLUMN_MIN_WIDTH, MIN[col.key] || 0)}px`; });
  }
})();
</script>"""


# ---------------------------------------------------------------- 全体の流れ

def repo_root_of(review_dir: Path, given: str | None) -> Path | None:
    if given:
        return Path(given).resolve()
    if review_dir.parent.name == ".ai_review_workspace":
        return review_dir.parent.parent
    return None


def check(review_dir: Path, repo_root: Path | None, ref_check: bool = True):
    errs: list[str] = []
    warns: list[str] = []
    meta = {}
    if (review_dir / "review.json").exists():
        try:
            meta = json.loads((review_dir / "review.json").read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as e:
            errs.append(f"review.json が JSON として読めない（{e.msg}）")
    else:
        errs.append("review.json がない")
    reqs = load_requirements(review_dir / "03_requirements.jsonl", errs, warns)
    findings = load_findings(review_dir / "08_findings", errs)
    validate(reqs, findings, errs)
    if ref_check:
        if repo_root is None:
            errs.append("リポジトリのルートが分からない。--repo-root で指定する")
        else:
            check_refs(reqs, findings, repo_root, errs, warns)
    return meta, reqs, findings, errs, warns


def summary(reqs: list, findings: list) -> str:
    def count(names):
        parts = [f"{j} {sum(1 for f in findings if f.get('judgment') == j)}" for j in names]
        return "、".join(p for p in parts if not p.endswith(" 0")) or "なし"
    shown = sum(1 for f in findings if f.get("judgment") in REPORTED)
    hidden = sum(1 for f in findings if f.get("judgment") in NOT_REPORTED)
    return (f"要件 {len(reqs)} 件／HTML に載せる指摘 {shown} 件（{count(REPORTED)}）"
            f"／載せない記録 {hidden} 件（{count(NOT_REPORTED)}）")


def build(review_dir: Path, meta: dict, reqs: list, findings: list) -> Path:
    b = Builder(reqs, findings)
    target = meta.get("target") or "対象未記入"
    items = [("対象", target), ("資料", meta.get("materials")), ("版", meta.get("version")), ("作成日", meta.get("created"))]
    doc = {
        "title": meta.get("title") or f"機能設計レビュー結果：{target}",
        "meta": [{"label": k, "value": v} for k, v in items if v],
        "head_html": HEAD,
        "blocks": [{"type": "html", "html": b.requirements_html()}, b.findings_table()],
        "tail_html": TAIL.replace("__KEYS__", json.dumps(b.with_findings)),
    }
    status = meta.get("status") or "進行中"
    banner = meta.get("banner")
    if not banner and status != "記録完了":
        banner = f"このレビューは「{status}」の状態で、確認していない範囲が残っている。"
    if banner:
        doc["banner"] = one_sentence_per_line(banner)
    out = review_dir / "report"
    out.mkdir(parents=True, exist_ok=True)
    # 対象名はレビューのフォルダ名に入っている。ファイル名に重ねると、Windows のパスの上限（260文字）を超えやすい。
    data, page = out / "機能設計レビュー結果.data.json", out / "機能設計レビュー結果.html"
    try:
        data.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        raise SystemExit(f"{data} を書けない（{e}）。パスが {len(str(data))} 文字あり、"
                         "Windows の上限（260文字）を超えている可能性がある。リポジトリを浅い場所に置くか、"
                         "Windows の長いパスを有効にする")
    if not RENDER.exists():
        raise SystemExit(f"universal-html-output の render.py が見つからない：{RENDER}\n"
                         "環境変数 UNIVERSAL_HTML_RENDER で場所を指定できる。data.json は書き出した。")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    res = subprocess.run([sys.executable, str(RENDER), "--input", str(data), "--output", str(page), "--overwrite"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    if res.returncode != 0:
        raise SystemExit(f"HTML の描画に失敗した：\n{res.stdout}\n{res.stderr}")
    return page


def print_problems(errs: list, warns: list) -> None:
    if errs:
        print(f"誤り {len(errs)} 件（直すまで HTML を作らない）:")
        for e in errs:
            print(f"  - {e}")
    if warns:
        print(f"注意 {len(warns)} 件（場所を開いて確かめ、直す）:")
        for w in warns:
            print(f"  - {w}")


def run(args) -> int:
    review_dir = Path(args.review_dir).resolve()
    if not review_dir.is_dir():
        print(f"レビューのフォルダがない：{review_dir}")
        return 2
    root = repo_root_of(review_dir, args.repo_root)
    meta, reqs, findings, errs, warns = check(review_dir, root, not args.no_ref_check)
    print_problems(errs, warns)
    print(summary(reqs, findings))
    if errs:
        return 1
    if args.check_only:
        print("検査を通った（HTML は作っていない）" + ("。注意を確かめること" if warns else ""))
        return 0
    page = build(review_dir, meta, reqs, findings)
    print(f"HTML を作った：{page}")
    return 0


# ---------------------------------------------------------------- 動作確認

def visible_text(page_html: str) -> str:
    """表示されない部分（スクリプト・タグの属性）を除いた文字列。"""
    page_html = re.sub(r"<script[\s\S]*?</script>", "", page_html)
    return re.sub(r"<[^>]+>", "", page_html)


def self_test() -> int:
    sample = SKILL_DIR / "assets" / "sample_review"
    with tempfile.TemporaryDirectory() as tmp:
        # 1. 同梱のサンプル（出力イメージと同じ内容）を描画できる
        ws = Path(tmp) / "repo" / ".ai_review_workspace" / "sample"
        shutil.copytree(sample, ws)
        meta, reqs, findings, errs, warns = check(ws, None, ref_check=False)
        assert not errs, errs
        page = build(ws, meta, reqs, findings)
        text = page.read_text(encoding="utf-8")
        assert "要件一覧" in text and "要件ごとの指摘" in text, "見出しがない"
        assert text.count('class="rv-no"') == len(reqs), "要件一覧の行の数が合わない"
        assert all(f["name"] in text for f in findings if f["judgment"] in REPORTED), "指摘が HTML に入っていない"
        assert "REQ-" not in visible_text(text), "要件一覧の表示にレビュー内のIDが残っている"

        # 2. 場所の照合：正しい場所は通り、誤った場所・引用・修正例を見つける
        repo = Path(tmp) / "mini"
        (repo / "src").mkdir(parents=True)
        (repo / "docs").mkdir()
        (repo / "src" / "a.ts").write_text(
            "export function canUpdate(user, ticket) {\n"
            "  return user.role === \"admin\" || ticket.assigneeId === user.id;\n"
            "}\n", encoding="utf-8")
        (repo / "docs" / "req.md").write_text("# 要求\n\n- 完了状態のチケットは更新できない。\n", encoding="utf-8")
        ws2 = repo / ".ai_review_workspace" / "t"
        (ws2 / "08_findings").mkdir(parents=True)
        (ws2 / "review.json").write_text(json.dumps({"target": "試験", "status": "記録完了"}), encoding="utf-8")
        (ws2 / "03_requirements.jsonl").write_text(json.dumps(
            {"id": "REQ-001", "context": "完了したチケットは記録として残す", "requirement": "完了したチケットは更新できない。",
             "source": ["docs/req.md:3"]}, ensure_ascii=False) + "\n", encoding="utf-8")
        good = {
            "id": "F-001", "req": "REQ-001", "judgment": "設計欠陥",
            "name": "完了したチケットを更新できる", "event": "完了したチケットが更新される。",
            "cause": "判定で状態を見ていない。", "cause_at": [{"where": "src/a.ts:1-3", "note": "canUpdate()"}],
            "fix": {"label": "直した後の動き", "text": "完了したチケットの更新を拒否する。", "diffs": [
                {"where": "src/a.ts:1-3", "note": "canUpdate()",
                 "code": " export function canUpdate(user, ticket) {\n+  if (ticket.status === \"done\") return false;\n"
                         "   return user.role === \"admin\" || ticket.assigneeId === user.id;\n }"}]},
            "repro": ["完了したチケットを用意する。", "更新する。結果：更新される。期待：拒否される。"],
            "basis": [{"label": "要求", "where": ["docs/req.md:3"], "text": "「完了状態のチケットは更新できない」"},
                      {"label": "コード", "where": ["src/a.ts:2"], "text": "`canUpdate()` は状態を見ない。"}],
        }
        (ws2 / "08_findings" / "F-001.json").write_text(json.dumps(good, ensure_ascii=False), encoding="utf-8")
        _, _, _, errs, warns = check(ws2, repo_root_of(ws2, None))
        assert not errs and not warns, (errs, warns)

        bad = json.loads(json.dumps(good))
        bad["cause_at"][0]["where"] = "src/a.ts:41-43"                                                  # 範囲外
        bad["fix"]["diffs"][0]["code"] = bad["fix"]["diffs"][0]["code"].replace("user.id", "user.userId")  # 元の行が違う
        bad["basis"][0]["text"] = "「完了状態のチケットは編集できない」"                                 # 引用が原文と違う
        bad["basis"].append({"label": "設計書", "where": ["docs/none.md:1"], "text": "ない資料。"})        # ない資料
        bad["event"] += "V10 と Q-003 で見つけた。"                                                      # IDの漏れ
        (ws2 / "08_findings" / "F-001.json").write_text(json.dumps(bad, ensure_ascii=False), encoding="utf-8")
        _, _, _, errs, warns = check(ws2, repo_root_of(ws2, None))
        joined = "\n".join(errs + warns)
        for expect in ("範囲外", "docs/none.md がリポジトリにない", "V10", "Q-003", "元の行", "引用"):
            assert expect in joined, (expect, joined)

        # 3. 中断で書きかけになった最後の行は、読み飛ばして注意を出す
        with open(ws2 / "03_requirements.jsonl", "a", encoding="utf-8") as fp:
            fp.write('{"id": "REQ-002", "context": "書きかけ')
        e3, w3 = [], []
        assert len(load_requirements(ws2 / "03_requirements.jsonl", e3, w3)) == 1 and not e3 and w3, (e3, w3)
    print("self-test ok")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="レビューの最終アウトプット（HTML）を作る")
    ap.add_argument("review_dir", nargs="?", help="レビューのフォルダ（.ai_review_workspace/<名前>）")
    ap.add_argument("--check-only", action="store_true", help="検査だけする")
    ap.add_argument("--repo-root", help="リポジトリのルート（既定：.ai_review_workspace の親）")
    ap.add_argument("--no-ref-check", action="store_true", help="場所の照合をしない（通常は使わない）")
    ap.add_argument("--self-test", action="store_true", help="同梱のサンプルで動作を確かめる")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.review_dir:
        ap.print_help()
        return 2
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
