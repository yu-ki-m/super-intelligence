#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""レポートの取りこぼしと、書き方のルールの違反を確認する。

使い方:
  python check_report.py <分析の出力.md> <レポート.html>
  python check_report.py --report-only <レポート.html>

結果の区分:
  要修正 … 直さなければならない問題。1件でもあれば、終了コード1を返す。
  要確認 … 問題かどうかを、書き手が1件ずつ見て判断する項目
           （例: 数値の表記を変えただけか、数値を削ったのか）。

標準ライブラリだけで動く。手順は references/report-generation.md の 7.1 を参照。
"""
import argparse
import re
import sys
from html.parser import HTMLParser

LABELS = [
    ("事実", re.compile(r"\[事実[:：]")),
    ("推定", re.compile(r"\[推定")),
    ("仮説", re.compile(r"\[仮説")),
    ("不在確認", re.compile(r"\[不在確認")),
]
BANNED = ["柔軟", "高度", "効率", "最適", "革新", "画期", "次世代", "シームレス", "強力",
          "大幅", "飛躍", "スケーラブル", "包括", "戦略的", "効果的", "高品質", "高性能", "スマート"]
LOCAL_PATH = re.compile(r"[A-Za-z]:[\\/]|/Users/|/home/|\\\\|Desktop|AppData|ナレッジストック|_v\d")
DIAGRAM = {"chain", "flow", "contrast", "cards", "tree", "house", "loop", "timeline",
           "funnel", "branch", "levels", "range", "calc", "scroll"}
PROSE_MIN = 40          # 図の説明の文章として数える段落の最小の文字数
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
        "source", "track", "wbr"}


# ---------------------------------------------------------------- HTML の木
class Node:
    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = dict(attrs)
        self.cls = set((self.attrs.get("class") or "").split())
        self.id = self.attrs.get("id")
        self.parent = parent
        self.children = []

    def elems(self):
        return [c for c in self.children if isinstance(c, Node)]

    def walk(self):
        for c in self.elems():
            yield c
            yield from c.walk()

    def own_walk(self):
        """入れ子の section の中には入らずに、子孫をたどる。"""
        for c in self.elems():
            yield c
            if c.tag != "section":
                yield from c.own_walk()


class Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root", [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        if self.cur.tag in ("style", "script", "title"):
            return
        self.cur.children.append(data)


def text(node, skip=lambda n: False):
    out = []
    for c in node.children:
        if isinstance(c, str):
            out.append(c)
        elif not skip(c):
            out.append(text(c, skip))
    return "".join(out)


def plain(node):
    """証拠ラベル（.badge）と、ツリーの小見出し（.tk）を除いた文字列。"""
    return re.sub(r"\s+", " ", text(node, lambda n: bool(n.cls & {"badge", "tk"}))).strip()


def has_ancestor(node, pred, stop=None):
    p = node.parent
    while p is not None and p is not stop:
        if pred(p):
            return True
        p = p.parent
    return False


def is_diagram(n):
    return bool(n.cls & DIAGRAM) or n.tag == "table"


def heading_of(sec):
    for n in sec.own_walk():
        if n.tag in ("h2", "h3"):
            return plain(n)
    return sec.id or "(見出しなし)"


# ---------------------------------------------------------------- 分析の出力
def read_analysis(md):
    lines = [l for l in md.splitlines() if not l.strip().startswith("証拠ラベル")]
    body = "\n".join(lines)
    labels = {name: len(rx.findall(body)) for name, rx in LABELS}
    phases = []
    for l in lines:
        m = re.match(r"\|\s*(P\d+(?:\.5)?)(?![\d.])", l.strip())
        if m and m.group(1) not in phases:
            phases.append(m.group(1))
    nums = []
    for l in lines:
        s = re.sub(r"^\s*#+\s*\d*\.?\s*", "", l)
        for m in re.finditer(r"(?<![0-9A-Za-z.#])(\d[\d,]*(?:\.\d+)?)", s):
            tok = m.group(1).replace(",", "").rstrip(".")
            if len(tok) == 1:
                continue
            if tok not in nums:
                nums.append(tok)
    return labels, phases, nums, len(re.sub(r"\s", "", body))


# ---------------------------------------------------------------- 確認
def check(report_html, analysis_md=None):
    errs, warns, info = [], [], []
    b = Builder()
    b.feed(report_html)
    root = b.root
    body_nodes = [n for n in root.walk() if n.tag == "body"]
    body = body_nodes[0] if body_nodes else root
    full = text(body)
    flat = re.sub(r"\s+", " ", full)

    # 1. テンプレートの残り・骨組み
    if "【" in flat:
        i = flat.index("【")
        errs.append(f"テンプレートの【】が残っている（例: …{flat[max(0, i - 10):i + 20]}…）")
    if any(n.id == "parts" for n in body.walk()):
        errs.append("テンプレートの「部品の見本」の節（id=parts）が残っている")
    for n in body.walk():
        if "skeleton" in n.cls:
            sec = n
            while sec is not None and sec.tag != "section":
                sec = sec.parent
            errs.append(f"骨組みのままの節がある（.box.skeleton）: {heading_of(sec) if sec else '?'}")

    # 2. 使わない形容・ローカルの情報
    for w in BANNED:
        for m in re.finditer(w, flat):
            errs.append(f"使わない形容「{w}」がある: …{flat[max(0, m.start() - 15):m.end() + 15]}…")
    for m in LOCAL_PATH.finditer(flat):
        errs.append(f"ローカルのパスや作業フォルダの名前がある: …{flat[max(0, m.start() - 10):m.end() + 20]}…")

    # 3. 冒頭の「結論」
    if not any(n.id == "gist" for n in body.walk()):
        errs.append("レポート全体の「結論」（id=gist）がない")

    # 4. 章・節ごとの確認
    sections = [n for n in body.walk() if n.tag == "section" and n.id not in ("gist", "appendix", "parts")
                and any("sec-head" in c.cls for c in n.elems())]
    for sec in sections:
        name = heading_of(sec)
        own = list(sec.own_walk())
        gists = [n for n in own if "gist" in n.cls]
        if not gists:
            errs.append(f"「結論」がない: {name}")
        else:
            g = plain(gists[0]).replace("結論", "", 1)
            if g.count("。") > 2:
                errs.append(f"「結論」が3文以上ある（{g.count('。')}文）: {name}")
        if not any("grain" in n.cls for n in own):
            warns.append(f"説明の粒度の表示がない: {name}")
        diagrams = [n for n in own if is_diagram(n) and not has_ancestor(n, is_diagram, stop=sec)]
        if not diagrams:
            errs.append(f"関係（全体像・因果・順序・比較・階層）を表す図がない: {name}")
        for d in diagrams:
            if d.parent is None:
                continue
            sib = d.parent.elems()
            i = sib.index(d)
            before = sib[i - 1] if i > 0 else None
            j = i + 1
            while j < len(sib) and "result" in sib[j].cls:
                j += 1
            after = sib[j] if j < len(sib) else None

            def prose(n):
                return (n is not None and n.tag == "p"
                        and not (n.cls & {"small", "next", "phase-tag"})
                        and len(plain(n)) >= PROSE_MIN)
            if not (prose(before) or prose(after)):
                kind = sorted(d.cls & DIAGRAM)[0] if d.cls & DIAGRAM else d.tag
                errs.append(f"図（{kind}）の直前か直後に、図を説明する文章（{PROSE_MIN}字以上の段落）がない: {name}")

    # 5. 図の中の文・箇条書きが、文になっているか
    def targets():
        for n in body.walk():
            if n.tag == "p" and not (n.cls & {"small", "next", "phase-tag"}):
                if has_ancestor(n, lambda a: bool(a.cls & {"chain", "flow", "branch", "lv", "card", "contrast", "house"})):
                    if not has_ancestor(n, lambda a: bool(a.cls & {"cond"})):
                        yield n
            elif n.tag == "span" and "tn" in n.cls:
                yield n
            elif n.tag == "li" and n.parent is not None and (
                    "sentences" in n.parent.cls or has_ancestor(n, lambda a: "lv" in a.cls)):
                yield n
    for n in targets():
        s = plain(n)
        if s and not s.endswith(("。", "？")):
            sec = n
            while sec is not None and sec.tag != "section":
                sec = sec.parent
            errs.append(f"図や箇条書きの中の文が、句点で終わる文になっていない: 「{s[:30]}」（{heading_of(sec) if sec else '?'}）")

    # 6. 分析の出力との比較
    rep_labels = {}
    counted = text(body, lambda n: "legend" in n.cls)
    for name, rx in LABELS:
        rep_labels[name] = len(rx.findall(counted))
    if analysis_md is not None:
        labels, phases, nums, alen = read_analysis(analysis_md)
        for name, _ in LABELS:
            a, r = labels[name], rep_labels[name]
            info.append(f"[{name}] 分析 {a} → レポート {r}")
            if r < a:
                errs.append(f"レポートの [{name}] が、分析の出力より少ない（分析 {a}、レポート {r}）。削った主張がないか確認する")
        norm = flat.replace(",", "")
        for p in phases:
            if not re.search(re.escape(p) + r"(?![\d.])", flat):
                errs.append(f"分析で実行したPhase（{p}）が、レポートのどこにも出てこない")
        missing = [x for x in nums if not re.search(r"(?<![0-9.])" + re.escape(x) + r"(?![0-9])", norm)]
        if missing:
            warns.append("分析の出力にある次の数値が、同じ表記ではレポートに見つからない。表記を変えただけなら問題ない。"
                         "削っていないかを1つずつ確認する: " + "、".join(missing))
        rlen = len(re.sub(r"\s", "", text(body, lambda n: n.id == "appendix")))
        info.append(f"本文の文字数: 分析 {alen} → レポート {rlen}（付録を除く）")
        if rlen < alen:
            warns.append(f"レポートの本文（付録を除く）が、分析の出力より短い（分析 {alen}字、レポート {rlen}字）。"
                         "前提・用語・具体例を足すレポートが短いのは、省略の兆候である")
    else:
        for name, _ in LABELS:
            info.append(f"[{name}] レポート {rep_labels[name]}")
    return errs, warns, info


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="レポートの取りこぼしと、書き方のルールの違反を確認する")
    ap.add_argument("--report-only", action="store_true", help="分析の出力との比較をしない")
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    if a.report_only:
        if len(a.files) != 1:
            ap.error("--report-only のときは、レポートのファイルを1つだけ渡す")
        md, html_path = None, a.files[0]
    else:
        if len(a.files) != 2:
            ap.error("分析の出力.md と レポート.html の2つを渡す")
        md = open(a.files[0], encoding="utf-8").read()
        html_path = a.files[1]
    html = open(html_path, encoding="utf-8").read()
    errs, warns, info = check(html, md)
    print("== レポートの確認 ==")
    for line in info:
        print("  " + line)
    print(f"\n[要修正] {len(errs)}件")
    for e in errs:
        print("  - " + e)
    print(f"\n[要確認] {len(warns)}件")
    for w in warns:
        print("  - " + w)
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
