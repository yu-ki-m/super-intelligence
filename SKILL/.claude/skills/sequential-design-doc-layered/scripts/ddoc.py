#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sequential-design-doc-layered の補助ツール（Python 3.8 以上・標準ライブラリのみ）。

  python ddoc.py init      <作業ディレクトリ> [--procs N]
  python ddoc.py build     <部品.html|ディレクトリ>... -o <出力.html> --title T [--meta M]... [--src-root DIR] [--no-check]
  python ddoc.py check     <出力.html> [--src-root DIR] [--coverage] [--json]
  python ddoc.py rev       <作業ディレクトリ> --kind K --note N [--commit C]
  python ddoc.py gitscope  <基準のコミット> [比較先] --repo DIR
  python ddoc.py outline   <出力.html>
  python ddoc.py inventory <ファイル|ディレクトリ>... [--src-root DIR]
  python ddoc.py render    <出力.html> [--widths 1280,1600] [--no-print] [--shots DIR] [--parts N] [--focus CSSセレクタ]... [--pdf 出力.pdf] [--browser PATH] [--json]

終了コード：0 = 問題なし（警告のみ含む）、1 = エラーあり、2 = 引数・入力の誤り、3 = ブラウザが見つからない。
"""
import argparse
import datetime
import difflib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_DIR / "assets" / "template.html"

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

# ---------------------------------------------------------------------------
# 最小の DOM（HTMLParser で木を作り、そのまま書き戻す）
# ---------------------------------------------------------------------------
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
P_CLOSERS = {"address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure",
             "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre",
             "section", "table", "ul"}
CLOSE_ON = {
    "td": {"td", "th"}, "th": {"td", "th"},
    "tr": {"td", "th", "tr"},
    "thead": {"td", "th", "tr", "thead", "tbody", "tfoot"},
    "tbody": {"td", "th", "tr", "thead", "tbody", "tfoot"},
    "tfoot": {"td", "th", "tr", "thead", "tbody", "tfoot"},
    "li": {"li"}, "dt": {"dt", "dd"}, "dd": {"dt", "dd"}, "option": {"option"},
}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = list(attrs or [])
        self.children = []
        self.parent = parent

    def get(self, name, default=None):
        for k, v in self.attrs:
            if k == name:
                return "" if v is None else v
        return default

    def set(self, name, value):
        for i, (k, _) in enumerate(self.attrs):
            if k == name:
                self.attrs[i] = (k, value)
                return
        self.attrs.append((name, value))

    def classes(self):
        return (self.get("class") or "").split()

    def has_class(self, c):
        return c in self.classes()

    def add_class(self, c):
        cl = self.classes()
        if c not in cl:
            cl.append(c)
            self.set("class", " ".join(cl))

    def iter(self):
        for ch in self.children:
            if isinstance(ch, Node):
                yield ch
                yield from ch.iter()

    def find_all(self, pred):
        return [n for n in self.iter() if pred(n)]

    def elements(self):
        return [c for c in self.children if isinstance(c, Node)]

    def text(self):
        return html.unescape("".join(_raw_text(self)))

    def ancestors(self):
        p = self.parent
        while p is not None:
            yield p
            p = p.parent

    def closest(self, pred):
        for a in self.ancestors():
            if pred(a):
                return a
        return None


class Text:
    __slots__ = ("raw", "parent")

    def __init__(self, raw, parent):
        self.raw = raw
        self.parent = parent


class Other:
    __slots__ = ("raw", "parent")

    def __init__(self, raw, parent):
        self.raw = raw
        self.parent = parent


def _raw_text(node):
    out = []
    for ch in node.children:
        if isinstance(ch, Text):
            out.append(ch.raw)
        elif isinstance(ch, Node):
            if ch.tag == "br":
                out.append("\n")
            elif ch.tag not in ("script", "style"):
                out.extend(_raw_text(ch))
    return out


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.root = Node("#root")
        self.cur = self.root

    def _implicit_close(self, tag):
        if self.cur.tag == "p" and tag in P_CLOSERS:
            self.cur = self.cur.parent
        closable = CLOSE_ON.get(tag)
        while closable and self.cur is not self.root and self.cur.tag in closable:
            self.cur = self.cur.parent

    def handle_starttag(self, tag, attrs):
        self._implicit_close(tag)
        n = Node(tag, attrs, self.cur)
        self.cur.children.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self._implicit_close(tag)
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        n = self.cur
        while n is not None and n is not self.root and n.tag != tag:
            n = n.parent
        if n is None or n is self.root:
            return
        self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(Text(data, self.cur))

    def handle_entityref(self, name):
        self.cur.children.append(Text("&%s;" % name, self.cur))

    def handle_charref(self, name):
        self.cur.children.append(Text("&#%s;" % name, self.cur))

    def handle_comment(self, data):
        self.cur.children.append(Other("<!--%s-->" % data, self.cur))

    def handle_decl(self, decl):
        self.cur.children.append(Other("<!%s>" % decl, self.cur))

    def handle_pi(self, data):
        self.cur.children.append(Other("<?%s>" % data, self.cur))

    def unknown_decl(self, data):
        self.cur.children.append(Other("<![%s]>" % data, self.cur))


def parse_html(text):
    b = _Builder()
    b.feed(text)
    b.close()
    return b.root


def _start_tag(n):
    parts = [n.tag]
    for k, v in n.attrs:
        parts.append(k if v is None else '%s="%s"' % (k, html.escape(v, quote=True)))
    return "<" + " ".join(parts) + ">"


def serialize(node):
    out = []

    def emit(n):
        for ch in n.children:
            if isinstance(ch, (Text, Other)):
                out.append(ch.raw)
            else:
                out.append(_start_tag(ch))
                if ch.tag in VOID:
                    continue
                emit(ch)
                out.append("</%s>" % ch.tag)

    emit(node)
    return "".join(out)


def own_rows(table):
    """入れ子の表を除いた、この表の行。"""
    rows = []

    def walk(n):
        for ch in n.elements():
            if ch.tag == "tr":
                rows.append(ch)
            elif ch.tag in ("thead", "tbody", "tfoot"):
                walk(ch)
    walk(table)
    return rows


def cells(tr):
    return [c for c in tr.elements() if c.tag in ("td", "th")]


def in_thead(tr):
    return tr.parent is not None and tr.parent.tag == "thead"


def is_group_row(tr):
    """グループの開始の行（一番外側 tr.gt・入れ子 tr.gs）か。"""
    return tr.has_class("gt") or tr.has_class("gs")


def is_tomb(n):
    """前の版から削除され、取り消し線で残している要素か。"""
    return n.get("data-ch") == "del" or n.get("data-chl") == "del"


# ---------------------------------------------------------------------------
# 報告
# ---------------------------------------------------------------------------
class Report:
    def __init__(self):
        self.items = []

    def add(self, level, code, where, msg):
        self.items.append({"level": level, "code": code, "where": where, "msg": msg})

    def err(self, code, where, msg):
        self.add("ERROR", code, where, msg)

    def warn(self, code, where, msg):
        self.add("WARN", code, where, msg)

    def info(self, code, where, msg):
        self.add("INFO", code, where, msg)

    def count(self, level):
        return sum(1 for i in self.items if i["level"] == level)

    def dump(self, max_info=400):
        n_info = 0
        for lv in ("ERROR", "WARN", "INFO"):
            for i in self.items:
                if i["level"] != lv:
                    continue
                if lv == "INFO":
                    n_info += 1
                    if n_info > max_info:
                        continue
                where = (" " + i["where"]) if i["where"] else ""
                print("%-5s [%s]%s: %s" % (lv, i["code"], where, i["msg"]))
        if n_info > max_info:
            print("INFO  （ほか %d 件の INFO を省略）" % (n_info - max_info))
        print("---- エラー %d 件 / 警告 %d 件 / 情報 %d 件" % (self.count("ERROR"), self.count("WARN"), self.count("INFO")))


# ---------------------------------------------------------------------------
# 処理番号・参照・木の構造
# ---------------------------------------------------------------------------
STEP_NO_RE = re.compile(r"^(?:\d{2,3}[a-z]?|[EA]\d+-\d{2,3})$")
_ID = r"(?:[EA]\d+-\d{2,3}|[EA]\d+|\d{2,3}[a-z]?)"
REF_ARROW_RE = re.compile(r"(→|&rarr;)(\s*)(" + _ID + r")(?![\d\-]|\.\d)")
REF_HE_RE = re.compile(r"(?<![\d\-A-Za-z.])(" + _ID + r")(?=へ(?:進む|戻る|合流|移る))")
REF_NO_RE = re.compile(r"(?<![A-Za-z])No(?:\.\s?|(?=\d))(" + _ID + r"(?:\.\d{1,2}(?!\d))?)(?![\d\-])")
NO_LINK_PREV = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_)]}'\"`%")
BLOCK_HEADS = {"分岐", "繰返", "並列", "try", "TX", "捕捉"}
CLOSERS = {"繰返終端", "待機", "try終端"}
MAX_DEPTH = 8


def _prev_nonspace(s, i):
    j = i - 1
    while j >= 0 and s[j] in " \t　":
        j -= 1
    return s[j] if j >= 0 else ""


def find_refs(raw, arrows=True):
    """生テキストから処理番号への参照を探す。[(開始, 終了, 参照ID)]
    arrows=True：「→ 07」「07へ進む」「No.07」「No.29.3」、False：「No.07」「No.29.3」だけ。"""
    found = []
    if arrows:
        for m in REF_ARROW_RE.finditer(raw):
            if m.group(3)[0].isdigit() and _prev_nonspace(raw, m.start()) in NO_LINK_PREV:
                continue  # 「10 → 15」のような値の変化は参照とみなさない（E1・A1 は常に参照）
            found.append((m.start(3), m.end(3), m.group(3)))
        for m in REF_HE_RE.finditer(raw):
            found.append((m.start(1), m.end(1), m.group(1)))
    for m in REF_NO_RE.finditer(raw):
        found.append((m.start(1), m.end(1), m.group(1)))
    found.sort()
    dedup = []
    last_end = -1
    for f in found:
        if f[0] >= last_end:
            dedup.append(f)
            last_end = f[1]
    return dedup


def procs_of(root):
    return [n for n in root.iter() if n.tag == "section" and n.has_class("proc")]


def kinds_in(cell):
    return [k.text().strip() for k in cell.find_all(lambda n: n.has_class("k"))]


def row_depth(cell):
    for c in cell.classes():
        m = re.fullmatch(r"i(\d)", c)
        if m:
            return int(m.group(1))
    return 0


def steps_tables(proc):
    return [t for t in proc.find_all(lambda n: n.tag == "table" and n.has_class("steps"))
            if t.closest(lambda a: a.tag == "section" and a.has_class("proc")) is proc]


def table_rows(t):
    """[(種類, 行, セル, 深さ)]。種類は step（処理行）・arm（「〜のとき」行・catch など）・dt（旧形式の詳細行）。"""
    out = []
    for tr in own_rows(t):
        if in_thead(tr):
            continue
        cs = cells(tr)
        if not cs or all(c.tag == "th" for c in cs) or is_group_row(tr) or is_tomb(tr):
            continue
        kind = "arm" if tr.has_class("arm") else ("dt" if tr.has_class("dt") else "step")
        d = row_depth(cs[1]) if len(cs) >= 2 else 0
        out.append((kind, tr, cs, d))
    return out


def step_rows(proc):
    """(表, 行, セル)。処理行だけ（「〜のとき」行・詳細行・グループの行は除く）。"""
    out = []
    for t in steps_tables(proc):
        for kind, tr, cs, _d in table_rows(t):
            if kind == "step":
                out.append((t, tr, cs))
    return out


def item_list(cell):
    """処理内容の欄の、入れ子でない最初の <ol>（処理の中の項目 1. 2. …）。"""
    for ol in cell.find_all(lambda n: n.tag == "ol"):
        if ol.closest(lambda a: a.tag == "li") is None and ol.closest(lambda a: a.tag == "td") is cell:
            return ol
    return None


def items_of(cell):
    ol = item_list(cell)
    return [c for c in ol.elements() if c.tag == "li"] if ol is not None else []


def arrow_refs(cell):
    """行き先の参照（「→ 07」「07へ進む」）だけを返す。補足（span.of）の中の「No.07」は数えない。"""
    raw = serialize(cell)
    raw = re.sub(r'<span class="of">.*?</span>', "", raw, flags=re.S)
    text = html.unescape(re.sub(r"<[^>]+>", "", raw))
    out = []
    for m in REF_ARROW_RE.finditer(text):
        if m.group(3)[0].isdigit() and _prev_nonspace(text, m.start()) in NO_LINK_PREV:
            continue
        out.append(m.group(3))
    out += [m.group(1) for m in REF_HE_RE.finditer(text)]
    return out


def arm_inline(text):
    """「〜のとき」行の、条件より後ろの文（括弧書き・〔推定〕・行き先を除く）。処理を文中に書いていないかの検査に使う。"""
    t = text
    while True:
        t2 = re.sub(r"（[^（）]*）|〔[^〔〕]*〕", "", t)
        if t2 == t:
            break
        t = t2
    i = t.rfind("とき")
    if i < 0:
        return ""
    return re.sub(r"→.*$", "", t[i + 2:]).strip(" 　：:、。,.")


INLINE_COND = re.compile(r"れば|なら(?![なびず])|場合[はに]|とき[はに]|時は|たら|(?:違反|不一致|失敗|エラー|不正な値)は|(?:する|なる|無い|ない|終わる)と")
INLINE_ACT = re.compile(r"(?:記録|格納|代入|設定|上書き|追加|削除|更新|登録|送信|呼び出|計算|置き換|書き込|保存|加算|減算|発行|集計|実行)(?:し(?![たな])|する)|にする|にして|を返(?:す|し)|を使(?:う|い)")
INLINE_OK = re.compile(r"[A-Za-z]*(?:Exception|Error)\b|例外|→\s*[EA]\d")


def inline_condition(text):
    """処理の行の文で、条件の後に別の処理を続けている文を返す。無ければ空文字。
    例外の経路へ進むだけの文（「数字でない場合は NumberFormatException → E1」）と、括弧の中の補足は対象外。
    例外経路の行は失敗後の状態の説明が多く、誤検出になるので、呼び出し側で除く。"""
    t = text
    while True:
        t2 = re.sub(r"（[^（）]*）|〔[^〔〕]*〕", "", t)
        if t2 == t:
            break
        t = t2
    for sent in t.split("。"):
        m = INLINE_COND.search(sent)
        if m and not INLINE_OK.search(sent) and INLINE_ACT.search(sent[m.end():]):
            return sent.strip()
    return ""


def main_text(cell):
    """処理内容の欄の本文（項目の <ol> を除く）。"""
    out = []
    for ch in cell.children:
        if isinstance(ch, Node) and ch.tag == "ol":
            continue
        out.append(serialize_one(ch))
    raw = re.sub(r'<span class="k(?: x)?">(.*?)</span>', lambda m: "[" + m.group(1) + "] ", "".join(out))
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", raw))).strip()


def steps_row_of(n):
    """要素を含む逐次処理表の行（入れ子の表の行ではなく、table.steps 自身の行）。"""
    for anc in n.ancestors():
        if anc.tag == "tr":
            t = anc.closest(lambda a: a.tag == "table")
            if t is not None and t.has_class("steps"):
                return anc
    return None


def serialize_one(ch):
    if isinstance(ch, (Text, Other)):
        return ch.raw
    tmp = Node("#tmp")
    tmp.children = [ch]
    return serialize(tmp)


def collect_targets(proc):
    steps = {}
    for _t, tr, cs in step_rows(proc):
        if not cs:
            continue
        no = cs[0].text().strip()
        if STEP_NO_RE.match(no):
            steps.setdefault(no, tr)
            if len(cs) >= 2:
                for k, li in enumerate(items_of(cs[1]), 1):
                    steps.setdefault("%s.%d" % (no, k), li)
    paths = {}
    for s in proc.find_all(lambda n: n.tag == "section" and n.get("data-path")):
        paths.setdefault(s.get("data-path").strip(), s)
    return steps, paths


def target_id(pid, rid, steps, paths):
    if rid in steps:
        if "." in rid:
            base, k = rid.rsplit(".", 1)
            return "%s-s%s-%s" % (pid, base, k)
        return "%s-s%s" % (pid, rid)
    if rid in paths:
        return "%s-%s" % (pid, rid)
    return None


NO_LINK_TAGS = ("a", "code", "pre", "th", "script", "style", "h1", "del")


def is_nav(n):
    """「→ 07」形式の参照を解釈する要素（逐次処理表の処理内容の欄と .go）。"""
    if n.has_class("go"):
        return True
    if n.tag == "td" and n.parent is not None and n.parent.tag == "tr":
        t = n.closest(lambda a: a.tag == "table")
        if t is not None and t.has_class("steps"):
            cs = cells(n.parent)
            return len(cs) >= 2 and cs[1] is n
    return False


def proc_text_refs(proc):
    """処理の中の参照を (要素, 参照ID) で列挙する（a・code・pre・th の中は除く）。"""
    out = []

    def walk(n, nav):
        for ch in n.children:
            if isinstance(ch, Node):
                if ch.tag in NO_LINK_TAGS or is_tomb(ch) or (ch.tag == "section" and ch.has_class("proc") and ch is not proc):
                    continue
                walk(ch, nav or is_nav(ch))
            elif isinstance(ch, Text):
                for _s, _e, rid in find_refs(ch.raw, arrows=nav):
                    out.append((n, rid))
    walk(proc, False)
    return out


def _link_cell(cell, pid, steps, paths, report, where, arrows=True):
    """要素内のテキストにある参照をリンクにする（a・code・pre・th の中は除く）。"""
    def walk(n, nav):
        new_children = []
        for ch in n.children:
            if isinstance(ch, Node):
                if ch.tag not in NO_LINK_TAGS and not is_tomb(ch) and not (ch.tag == "section" and ch.has_class("proc") and ch is not cell):
                    walk(ch, nav or is_nav(ch))
                new_children.append(ch)
                continue
            if not isinstance(ch, Text):
                new_children.append(ch)
                continue
            raw = ch.raw
            refs = find_refs(raw, arrows=nav)
            if not refs:
                new_children.append(ch)
                continue
            pos = 0
            for s, e, rid in refs:
                target = target_id(pid, rid, steps, paths)
                if target is None:
                    continue  # 解決できない参照は check が報告する
                if s > pos:
                    new_children.append(Text(raw[pos:s], n))
                a = Node("a", [("href", "#" + target)], n)
                a.children.append(Text(rid, a))
                new_children.append(a)
                pos = e
            if pos < len(raw):
                new_children.append(Text(raw[pos:], n))
        n.children = new_children
    walk(cell, arrows)


# ---------------------------------------------------------------------------
# 処理のグループ（一番外側：tbody.grp の先頭の tr.gt ／ 入れ子：tr.gs）
#   処理行・「〜のとき」行の中身と字下げには触らず、帯・範囲の括弧・開閉だけを足す。
#   階層は入れ子の深さから決まる（一番外側が 1。名前で区別しない）。
# ---------------------------------------------------------------------------
GROUP_CSS = []
MAX_GROUP_LV = 4


def _g_hide(gid, lv):
    """グループ gid が閉じているときに中の行を隠す規則。表示レベルが既定を決め、帯の▼がそれを反転する。リンク先の行を含むグループは開く。"""
    closed = ",".join(".gv%d:checked" % i for i in range(1, lv + 1))
    t = 'tr[data-in~="%s"]' % gid
    tgt = ":not(:has(%s:target, %s :target))" % (t, t)
    return (".gsec:has(%s):not(:has(#%s:checked))%s %s,\n.gsec:not(:has(%s)):has(#%s:checked)%s %s"
            % (closed, gid, tgt, t, closed, gid, tgt, t))


def _g_band(td, gid, a, b):
    """グループの開始の行のセルを、開閉のラベル・共通の範囲・No. の範囲（自動）・要約・失敗時の並びに組み直す。"""
    name, badges, rest = None, [], []
    for ch in td.children:
        if isinstance(ch, Node) and ch.tag == "b" and name is None:
            name = ch
        elif isinstance(ch, Node) and ch.has_class("sc"):
            badges.append(ch)
        else:
            rest.append(ch)
    rng = "No.%s" % a if a == b else "No.%s〜%s" % (a, b)
    inner = ('<div class="gb"><label class="gl"><input type="checkbox" class="gc" id="%s" aria-label="%s を開閉する">%s</label>%s'
             '<span class="rng">%s</span>%s</div>') % (
        gid, html.escape(name.text() if name is not None else "", quote=True), serialize_one(name) if name is not None else "",
        "".join(serialize_one(x) for x in badges), rng, "".join(serialize_one(x) for x in rest))
    td.children = parse_html(inner).children
    for c in td.children:
        c.parent = td


def _live_text(n):
    """削除の印（del）の語を除いた文。"""
    out = []

    def walk(x):
        for ch in x.children:
            if isinstance(ch, Text):
                out.append(ch.raw)
            elif isinstance(ch, Node) and ch.tag != "del":
                walk(ch)
    walk(n)
    return html.unescape("".join(out))


def _group_name(cell):
    for c in cell.children:
        if isinstance(c, Node) and c.tag == "b":
            return _live_text(c).strip()
    return ""


def apply_groups(proc, pid, report):
    serial = 0
    for tno, t in enumerate(steps_tables(proc), 1):
        tbodies = [e for e in t.elements() if e.tag == "tbody" and e.has_class("grp")]
        if not tbodies:
            continue
        maxlv = 1
        for tb in tbodies:
            rows = [e for e in tb.elements() if e.tag == "tr"]
            if not rows or not rows[0].has_class("gt"):
                report.err("GROUP", pid, "tbody.grp の先頭に一番外側のグループの行（tr.gt）がない")
                continue
            body = rows[1:]
            nums = [cells(r)[0].text().strip() for r in body if not is_group_row(r) and not is_tomb(r) and not r.has_class("arm") and cells(r)]
            top_name = _group_name(cells(rows[0])[0])
            if not nums:
                report.err("GROUP", pid, "グループ「%s」の下に処理行がない" % top_name)
                continue
            first_rows = [r for r in body if not is_group_row(r) and not is_tomb(r)]
            if first_rows and len(cells(first_rows[0])) >= 2 and row_depth(cells(first_rows[0])[1]) != 0:
                report.err("GROUP", pid, "グループ「%s」の最初の行が字下げされている（一番外側のグループは字下げなしの行の間でだけ区切る。行の字下げは変えず、グループの区切りを動かす）" % top_name)
            serial += 1
            top = "%s-g%d" % (pid, serial)
            _g_band(cells(rows[0])[0], top, nums[0], nums[-1])
            rows[0].set("data-a", nums[0])
            rows[0].set("data-b", nums[-1])
            rows[0].set("data-lv", "1")
            GROUP_CSS.append(_g_hide(top, 1))
            stack = []

            def close(g):
                if not g["passed"]:
                    report.err("GROUP", pid, "グループ「%s」の終わり（No.%s）に届く前に、字下げが浅くなった（ブロックの途中でグループの範囲を切らない。行の字下げは変えず、data-to を動かす）" % (g["name"], g["to"]))
                if g["last"] is not None and g["lane"] <= MAX_GROUP_LV - 1:
                    g["last"].add_class("ge%d" % g["lane"])

            for i, tr in enumerate(body):
                cs = cells(tr)
                if is_tomb(tr):  # 削除した行：字下げで範囲を閉じない。範囲の途中なら線を引く
                    tr.set("data-in", " ".join([top] + [g["id"] for g in stack]))
                    for g in stack:
                        if not g["passed"] and len(cs) >= 2:
                            cs[1].add_class("gf")
                            cs[1].add_class("gd%d" % g["lane"])
                    continue
                d = row_depth(cs[1]) if len(cs) >= 2 else 0
                while stack and ((stack[-1]["passed"] and d <= stack[-1]["d"]) or d < stack[-1]["d"]):
                    close(stack.pop())
                tr.set("data-in", " ".join([top] + [g["id"] for g in stack]))
                # 括弧の線は親のグループの分だけ引く。グループの開始の行では、自分の線はまだ引かない（帯の下から始める）
                for g in stack:
                    cs[1].add_class("gf")
                    cs[1].add_class("gd%d" % g["lane"])
                    g["last"] = cs[1]
                    if not g.get("started"):  # 開始の▼は、グループの最初の行に置く（閉じると行と一緒に隠れる）
                        g["started"] = True
                        cs[1].add_class("gb%d" % g["lane"])
                if tr.has_class("gt"):
                    report.err("GROUP", pid, "一番外側のグループの行は tbody.grp の先頭に 1 つだけ置く（次のグループには新しい tbody.grp を作る）")
                    continue
                if tr.has_class("gs"):
                    lv = len(stack) + 2
                    maxlv = max(maxlv, lv)
                    name = _group_name(cs[1])
                    to = (tr.get("data-to") or "").strip()
                    following = [r for r in body[i + 1:] if not is_group_row(r) and not is_tomb(r)]
                    nxt = following[0] if following else None
                    first = cells(nxt)[0].text().strip() if nxt is not None else ""
                    if lv > MAX_GROUP_LV:
                        report.err("GROUP", pid, "グループ「%s」の入れ子が %d 階層ある（%d 階層まで。3 階層を目安にする）" % (name, lv, MAX_GROUP_LV))
                    if nxt is None or nxt.has_class("arm"):
                        report.err("GROUP", pid, "グループ「%s」の次の行が「〜のとき」行、または行がない（グループは処理行の前に置く。分岐の結果のまとまりなら「〜のとき」行の 1 段下に置く）" % name)
                    elif row_depth(cells(nxt)[1]) != d:
                        report.err("GROUP", pid, "グループ「%s」の字下げ（%d 段）と次の行の字下げ（%d 段）が違う（帯の字下げを次の行に合わせる。行の字下げは変えない）" % (name, d, row_depth(cells(nxt)[1])))
                    if to not in nums or (first in nums and nums.index(to) < nums.index(first)):
                        report.err("GROUP", pid, "グループ「%s」の data-to（No.%s）が、この範囲の後続の No. ではない" % (name, to or "なし"))
                    serial += 1
                    gid = "%s-g%d" % (pid, serial)
                    _g_band(cs[1], gid, first or to, to)
                    tr.set("data-a", first or to)
                    tr.set("data-b", to)
                    tr.set("data-lv", str(lv))
                    cs[1].add_class("c")
                    if d >= 1:
                        tr.add_class("n")
                    GROUP_CSS.append(_g_hide(gid, lv))
                    stack.append({"id": gid, "lv": lv, "lane": lv - 1, "d": d, "to": to, "name": name, "passed": False, "last": None})
                else:
                    no = cs[0].text().strip() if cs else ""
                    for g in stack:
                        if no and g["passed"] and not g.get("over"):
                            g["over"] = True
                            report.err("GROUP", pid, "グループ「%s」の data-to（No.%s）より後の行 No.%s が範囲に入っている（ブロックの途中で範囲を切らない。data-to はブロックの最後の No. にする）" % (g["name"], g["to"], no))
                        if no and no == g["to"]:
                            g["passed"] = True
            while stack:
                close(stack.pop())
        sec = t.closest(lambda a: a.tag == "section")
        if sec is not None:
            sec.add_class("gsec")
        name = "gv-%s-%d" % (pid, tno)
        opts = [(1, "一番外側のグループだけ")] + [(lv, "%d 階層目まで" % lv) for lv in range(2, min(maxlv, MAX_GROUP_LV) + 1)]
        radios = "".join('<label><input type="radio" name="%s" class="gv%d">%s</label>' % (name, lv, lab) for lv, lab in opts)
        bar = ('<p class="gbar"><span class="gbl">表示レベル</span>%s<label><input type="radio" name="%s" class="gva" checked>すべての行</label>'
               '</p>') % (radios, name)
        frag = parse_html(bar).children
        parent = t.parent
        idx = parent.children.index(t)
        for k, c in enumerate(frag):
            c.parent = parent
            parent.children.insert(idx + k, c)


def groups_of(proc):
    """処理のグループの一覧（build 後の文書から読む）。実行順に、階層・名前・共通の範囲・範囲の行を返す。"""
    out = []
    for t in steps_tables(proc):
        for tb in [e for e in t.elements() if e.tag == "tbody" and e.has_class("grp")]:
            rows = [e for e in tb.elements() if e.tag == "tr"]
            for tr in rows:
                if not is_group_row(tr):
                    continue
                gc = tr.find_all(lambda n: n.tag == "input" and n.has_class("gc"))
                gid = gc[0].get("id") if gc else None
                names = tr.find_all(lambda n: n.tag == "b")
                sc = tr.find_all(lambda n: n.has_class("sc"))
                gm = tr.find_all(lambda n: n.has_class("gm"))
                gx = tr.find_all(lambda n: n.has_class("gx"))
                scope = None
                if sc:
                    scope = next((c for c in ("all", "part", "own") if sc[0].has_class(c)), None)
                every = [r for r in rows if gid and gid in (r.get("data-in") or "").split()]
                inside = [r for r in every if not is_tomb(r)]
                d = row_depth(cells(tr)[1]) if len(cells(tr)) >= 2 else 0
                out.append({"lv": int(tr.get("data-lv") or 1), "id": gid, "tr": tr, "name": _live_text(names[0]).strip() if names else "",
                            "scope": scope, "label": _live_text(sc[0]).strip() if sc else "", "sc_html": serialize_one(sc[0]) if sc else "",
                            "key": (tr.get("data-key") or "").strip(), "a": tr.get("data-a") or "", "b": tr.get("data-b") or "",
                            "summary": re.sub(r"\s+", " ", _live_text(gm[0])).strip() if gm else "", "summary_html": serialize_children(gm[0]) if gm else "",
                            "gx": gx[0] if gx else None, "rows": inside, "all_rows": every, "d": d})
    return out


def serialize_children(n):
    return "".join(serialize_one(c) for c in n.children)


def _rng(a, b):
    return "No.%s" % a if a == b else "No.%s〜%s" % (a, b)


def _gx_status(h):
    if h["gx"] is None:
        return []
    out = []
    for m in re.finditer(r"(\d{3}(?:・\d{3})*)\s*→", _live_text(h["gx"])):
        out.extend(m.group(1).split("・"))
    return out


def _merge_order(seqs):
    """複数の処理のグループの並びを、どの処理の順序も崩さないように 1 列にする。同順なら最初に現れたものを先に出す。"""
    seen, nodes = {}, []
    edges = {}
    for seq in seqs:
        for k in seq:
            if k not in seen:
                seen[k] = len(nodes)
                nodes.append(k)
                edges[k] = set()
        for x, y in zip(seq, seq[1:]):
            if x != y:
                edges[x].add(y)
    indeg = {k: 0 for k in nodes}
    for x in nodes:
        for y in edges[x]:
            indeg[y] += 1
    out, ready = [], [k for k in nodes if indeg[k] == 0]
    while ready:
        ready.sort(key=lambda k: seen[k])
        k = ready.pop(0)
        out.append(k)
        for y in edges[k]:
            indeg[y] -= 1
            if indeg[y] == 0:
                ready.append(y)
    out += [k for k in nodes if k not in out]  # 順序が循環している場合は現れた順
    return out


def fill_map(root):
    """<div data-group-map></div> を、グループと処理の対応表に置き換える。"""
    holders = root.find_all(lambda n: n.get("data-group-map") is not None)
    if not holders:
        return
    procs = procs_of(root)
    by = []
    for proc in procs:
        hs = [h for h in groups_of(proc) if h["lv"] == 1]
        for i, h in enumerate(hs):
            h["k"] = h["key"] or "%s#%d" % (proc.get("id"), i)
        by.append((proc, hs))
    order = _merge_order([[h["k"] for h in hs] for _p, hs in by])
    head = "".join("<th>%s</th>" % html.escape(" ".join(_tab_label(p).split()[:2])) for p, _hs in by)
    rows = []
    for k in order:
        items = [(p, next((h for h in hs if h["k"] == k), None)) for p, hs in by]
        present = [h for _p, h in items if h is not None]
        names = []
        for h in present:
            if h["name"] not in names:
                names.append(h["name"])
        sums = []
        for h in present:
            if h["summary_html"] not in sums:
                sums.append(h["summary_html"])
        cells_html = []
        for p, h in items:
            if h is None:
                cells_html.append('<td class="none">—</td>')
                continue
            a = '<a href="#%s-s%s">%s</a>' % (p.get("id"), h["a"], _rng(h["a"], h["b"]))
            cells_html.append("<td>%s%s</td>" % (a, "<br>%s" % html.escape(h["name"]) if len(names) > 1 else ""))
        st = []
        for h in present:
            for c in _gx_status(h):
                if c not in st:
                    st.append(c)
        scope_html = present[0]["sc_html"]
        if len(present) > 1 and all(h["scope"] == "own" for h in present):
            scope_html = '<span class="sc own">処理ごとに固有</span>'
        rows.append('<tr><td class="c0">%s</td><td>%s</td><td>%s</td>%s<td>%s</td></tr>' % (
            html.escape("・".join(names)), scope_html, sums[0] if len(sums) == 1 else "処理ごとに異なる（各タブを参照）",
            "".join(cells_html), "・".join(sorted(st)) if st else "—"))
    table = ('<table class="sub gmap"><thead><tr><th>グループ</th><th>共通の範囲</th><th>内容</th>%s<th>失敗時</th></tr></thead><tbody>%s</tbody></table>') % (head, "".join(rows))
    for hd in holders:
        hd.children = parse_html(table).children
        for c in hd.children:
            c.parent = hd


# ---------------------------------------------------------------------------
# 版と差分：部品のスナップショット（versions/v1, v2, …）と今の部品を比べ、変更の印を自動で付ける。
#   印は手で付けない（付け忘れを防ぐため）。基準（v1）との差分と、前の版との差分を 1 つの文書に重ねて持ち、
#   class a（基準から）・l（前の版から）と、行の属性 data-ch（基準から）・data-chl（前の版から）で表す。
# ---------------------------------------------------------------------------
DIFF_BLOCKS = {"section", "div", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "ol", "ul", "li", "p", "pre", "h1", "h2", "h3", "h4", "caption"}
DIFF_LEAFY = {"td", "th", "li", "p", "pre", "h1", "h2", "h3", "h4", "caption"}
DIFF_SKIP_SEC = {"toc", "verification"}
_TOK = re.compile(r"[A-Za-z0-9_$#@.:/\-]+|\s+|[\u3040-\u309f]+|[\u30a0-\u30ff\u30fc]+|[\u4e00-\u9fff]+|.", re.S)


class DiffRun:
    def __init__(self):
        self.leaf = {}      # id(新しい要素) -> (要素, 古い文)
        self.added = []     # 追加された要素
        self.changed = {}   # id(行) -> 行（文中の変更がある行）
        self.deleted = []   # (直前の新しい要素, 入れ物, 古い要素)
        self.procs_del = []  # 削除された処理の名前


_CITE = re.compile(r"([\w./\-]+\.[A-Za-z]\w*):\d+(?:-\d+)?(?:, ?\d+(?:-\d+)?)*")


def _norm(t):
    return re.sub(r"\s+", " ", t).strip()


def _nocite(t):
    """根拠の行番号だけの違いを、変更として扱わないようにする（コードの行がずれただけなので）。"""
    return _CITE.sub(r"\1:#", t)


def _row_no(n):
    """逐次処理の行の No.（「〜のとき」行・グループの行は空）。"""
    if n.tag != "tr" or not _is_steps_row(n) or n.has_class("arm") or is_group_row(n):
        return ""
    cs = cells(n)
    return cs[0].text().strip() if cs else ""


def _is_steps_row(tr):
    if tr.tag != "tr":
        return False
    t = tr.closest(lambda a: a.tag == "table")
    return t is not None and t.has_class("steps")


def _units(node, top=False):
    out = []
    for ch in node.elements():
        if ch.tag in ("thead", "tbody", "tfoot"):
            out.extend(_units(ch))
        elif ch.tag in DIFF_BLOCKS:
            if top and ch.get("data-sec") in DIFF_SKIP_SEC:
                continue
            out.append(ch)
    return out


def _inline_texts(n):
    for ch in n.children:
        if isinstance(ch, Text):
            yield ch
        elif isinstance(ch, Node) and ch.tag not in DIFF_BLOCKS:
            yield from _inline_texts(ch)


def _inline_text(n):
    return "".join(html.unescape(t.raw) for t in _inline_texts(n))


def _key(n):
    if n.tag == "section":
        return n.get("id") or n.get("data-path") or n.get("data-sec")
    return None


def _sig(n):
    k = _key(n)
    if k:
        return "k:" + k
    if _is_steps_row(n):
        cs = cells(n)
        if is_group_row(n) and cs:
            return "grp:" + _group_name(cs[1] if len(cs) >= 2 else cs[0])
        return ("arm:" if n.has_class("arm") else "row:") + _norm(_nocite((cs[1] if len(cs) >= 2 else cs[0]).text() if cs else ""))
    return n.tag + ":" + _norm(_nocite(n.text()))


def _compatible(a, b):
    if a.tag != b.tag:
        return False
    if a.tag == "tr":
        if len(cells(a)) != len(cells(b)) or is_group_row(a) != is_group_row(b):
            return False
        if _is_steps_row(a) and a.has_class("arm") != b.has_class("arm"):
            return False
        # 「〜のとき」行は、同じ字下げの行どうしを対応させる（別の分岐の結果と取り違えないように）
        if _is_steps_row(a) and a.has_class("arm") and len(cells(a)) >= 2 and row_depth(cells(a)[1]) != row_depth(cells(b)[1]):
            return False
    return True


def _band_parts(td):
    parts = {}
    for ch in td.elements():
        key = "b" if ch.tag == "b" else next((c for c in ("sc", "gm", "gx") if ch.has_class(c)), None)
        if key and key not in parts:
            parts[key] = ch
    return parts


def _walk_band(old, new, run):
    """帯は、名前・共通の範囲・要約・失敗時を別々に比べる。1 つの文として比べると、語が境界をまたいで崩れる。"""
    o, n = _band_parts(old), _band_parts(new)
    changed = bool(set(o) - set(n))
    for k, nn in n.items():
        ot = _inline_text(o[k]) if k in o else ""
        if _norm(ot) != _norm(_inline_text(nn)):
            run.leaf[id(nn)] = (nn, ot)
            changed = True
    return changed


def _walk(old, new, run):
    changed = False
    if new.tag == "td" and new.parent is not None and new.parent.tag == "tr" and is_group_row(new.parent):
        return _walk_band(old, new, run)
    if new.tag == "tr":
        oc, nc = cells(old), cells(new)
        idx = [1] if _is_steps_row(new) and len(nc) == 3 else range(len(nc))  # 根拠の欄と No. の欄は比べない
        for i in idx:
            changed = _walk(oc[i], nc[i], run) or changed
        if changed:
            run.changed[id(new)] = new
        return changed
    if new.tag in DIFF_LEAFY:
        ot, nt = _inline_text(old), _inline_text(new)
        if (ot.strip("\n") != nt.strip("\n")) if new.tag == "pre" else (_norm(_nocite(ot)) != _norm(_nocite(nt))):
            run.leaf[id(new)] = (new, ot)
            changed = True
    if new.tag == "pre":
        return changed
    ou, nu = _units(old, old.tag == "#root"), _units(new, new.tag == "#root")
    if ou or nu:
        changed = _align(ou, nu, new, run) or changed
    return changed


def _align(ou, nu, container, run):
    changed = False
    # No. を振り直していなければ、行は No. で対応付ける（文が似ているだけの別の行と取り違えないように）
    no_o, no_n = {_row_no(x) for x in ou} - {""}, {_row_no(x) for x in nu} - {""}
    use_no = bool(no_o and no_n) and len(no_o & no_n) * 2 >= min(len(no_o), len(no_n))

    def sig(x):
        no = _row_no(x) if use_no else ""
        return "no:" + no if no else _sig(x)
    so, sn = [sig(x) for x in ou], [sig(x) for x in nu]
    sm = difflib.SequenceMatcher(None, so, sn, autojunk=False)
    prev = None

    def drop(o, anchor):
        if o.tag == "section" and o.has_class("proc"):
            names = o.find_all(lambda n: n.tag == "h2")
            run.procs_del.append(_norm(names[0].text()) if names else (o.get("id") or ""))
        else:
            run.deleted.append((anchor, container, o))

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for i, j in zip(range(i1, i2), range(j1, j2)):
                if _key(nu[j]) or (use_no and _row_no(nu[j])) or (_is_steps_row(nu[j]) and is_group_row(nu[j])):
                    changed = _walk(ou[i], nu[j], run) or changed
                prev = nu[j]
            continue
        changed = True
        j = j1
        for i in range(i1, i2):
            best, best_r = None, 0.0
            a = so[i][:1500]
            for k in range(j, j2):
                if not _compatible(ou[i], nu[k]) or (use_no and (_row_no(ou[i]) or _row_no(nu[k]))):
                    continue
                r = difflib.SequenceMatcher(None, a, sn[k][:1500], autojunk=False).ratio()
                if r > best_r:
                    best, best_r = k, r
            if best is not None and best_r >= 0.45:
                for k in range(j, best):
                    run.added.append(nu[k])
                    prev = nu[k]
                _walk(ou[i], nu[best], run)
                prev = nu[best]
                j = best + 1
            else:
                drop(ou[i], prev)
        for k in range(j, j2):
            run.added.append(nu[k])
            prev = nu[k]
    return changed


def diff_trees(old_root, new_root):
    run = DiffRun()
    _walk(old_root, new_root, run)
    return run


def _spans(old, new, exact):
    a = [(m.group(0), m.start(), m.end()) for m in _TOK.finditer(old)]
    b = [(m.group(0), m.start(), m.end()) for m in _TOK.finditer(new)]

    def cmp_tok(t):
        if exact:
            return t[0]
        return " " if t[0].isspace() else _nocite(t[0])
    sm = difflib.SequenceMatcher(None, [cmp_tok(t) for t in a], [cmp_tok(t) for t in b], autojunk=False)
    ins, dels = [], []
    if a and b and sm.ratio() < 0.2:
        if old.strip():
            dels.append((0, old.strip()))
        ins.append((0, len(new)))
        return ins, dels
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ("replace", "delete"):
            txt = old[a[i1][1]:a[i2 - 1][2]]
            pos = b[j1][1] if j1 < len(b) else len(new)
            if txt.strip():
                dels.append((pos, txt))
        if tag in ("replace", "insert"):
            st, en = b[j1][1], b[j2 - 1][2]
            if new[st:en].strip():
                ins.append((st, en))
    return ins, dels


def _mark_inline(node, olds):
    """要素の文に、追加（ins）と削除（del）の印を入れる。olds は [(古い文, class)]。"""
    exact = node.tag == "pre"
    new = _inline_text(node)
    flags = [set() for _ in new]
    dels = {}
    for old, cls in olds:
        ins, ds = _spans(old, new, exact)
        for st, en in ins:
            for i in range(st, en):
                flags[i].add(cls)
        for pos, txt in ds:
            bucket = dels.setdefault(pos, [])
            hit = next((d for d in bucket if d[0] == txt), None)
            if hit:
                hit[1].add(cls)
            else:
                bucket.append((txt, {cls}))
    pos = [0]

    def emit_del(p, out, parent):
        for txt, cl in dels.pop(p, []):
            d = Node("del", [("class", " ".join(sorted(cl)))], parent)
            d.children = [Text(html.escape(txt, quote=False), d)]
            out.append(d)

    def rebuild(n):
        out = []
        for ch in n.children:
            if isinstance(ch, Text):
                t = html.unescape(ch.raw)
                i = 0
                while i < len(t):
                    p = pos[0] + i
                    emit_del(p, out, n)
                    cl = flags[p]
                    k = i + 1
                    while k < len(t) and flags[pos[0] + k] == cl and (pos[0] + k) not in dels:
                        k += 1
                    seg = html.escape(t[i:k], quote=False)
                    if cl:
                        m = Node("ins", [("class", " ".join(sorted(cl)))], n)
                        m.children = [Text(seg, m)]
                        out.append(m)
                    else:
                        out.append(Text(seg, n))
                    i = k
                pos[0] += len(t)
            else:
                if isinstance(ch, Node) and ch.tag not in DIFF_BLOCKS:
                    rebuild(ch)
                out.append(ch)
        n.children = out

    rebuild(node)
    if dels:  # 文の末尾で削除された語：項目などの前に置く
        tail = []
        for p in sorted(dels):
            emit_del(p, tail, node)
        at = next((i for i, c in enumerate(node.children) if isinstance(c, Node) and c.tag in DIFF_BLOCKS), len(node.children))
        node.children[at:at] = tail


def _apply_added(n, attr):
    if n.tag in ("section", "table", "thead", "tbody", "tfoot", "ol", "ul", "div"):
        for c in n.elements():
            _apply_added(c, attr)
        if n.tag == "section" and n.get("data-path"):
            n.set(attr, "add")
    elif n.tag in DIFF_BLOCKS:
        n.set(attr, "add")


def _tomb_node(old):
    """削除された要素を、取り消し線で残すための形にする。"""
    if old.tag == "tr" and _is_steps_row(old):
        if is_group_row(old):
            cs = cells(old)
            names = old.find_all(lambda n: n.tag == "b")
            label = names[0].text() if names else ""
            d = row_depth(cs[1]) if len(cs) >= 2 else 0
            frag = parse_html('<table><tbody><tr><td></td><td class="c%s">グループ「%s」</td><td></td></tr></tbody></table>' % (
                " i%d" % d if d else "", html.escape(label)))
            tr = next(n for n in frag.iter() if n.tag == "tr")
            if d:
                tr.add_class("n")
            return tr
        cs = cells(old)
        if len(cs) == 3:
            if not old.has_class("arm"):
                cs[0].add_class("no")
                cs[2].add_class("src")
            cs[1].add_class("c")
            if row_depth(cs[1]) >= 1:
                old.add_class("n")
    if old.tag == "section" and old.get("data-path"):
        old.attrs = [(k, v) for k, v in old.attrs if k != "data-path"]
        for tr in old.find_all(lambda n: n.tag == "tr"):
            tr.set("data-ch", "del")
    return old


def annotate(new_root, base_root, prev_root):
    """今の部品のツリーに、基準・前の版との差分の印を入れる。"""
    run_all = diff_trees(base_root, new_root)
    run_last = run_all if prev_root is base_root else diff_trees(prev_root, new_root)
    pairs = [(run_all, "data-ch", "a")] + ([] if run_last is run_all else [(run_last, "data-chl", "l")])
    for run, attr, _cls in pairs:
        for n in run.added:
            _apply_added(n, attr)
        for tr in run.changed.values():
            if not tr.get(attr):
                tr.set(attr, "mod")
    if run_last is run_all:
        for n in new_root.iter():
            v = n.get("data-ch")
            if v:
                n.set("data-chl", v)
    # 文中の印
    leaves = {}
    for run, _attr, cls in pairs:
        for nid, (node, old) in run.leaf.items():
            leaves.setdefault(nid, (node, []))[1].append((old, cls if run_last is not run_all else "a l"))
    for node, olds in leaves.values():
        if len(olds) == 1 and " " in olds[0][1]:
            old, cls = olds[0]
            _mark_inline(node, [(old, "a"), (old, "l")])
        else:
            _mark_inline(node, olds)
    # 削除の行
    tombs = {}
    for run, attr, _cls in pairs:
        for anchor, container, old in run.deleted:
            key = (id(anchor) if anchor is not None else id(container), _norm(old.text()))
            hit = tombs.get(key)
            if hit is None:
                hit = (anchor, container, _tomb_node(old))
                tombs[key] = hit
            hit[2].set(attr, "del")
            if run_last is run_all:
                hit[2].set("data-chl", "del")
    for anchor, container, node in tombs.values():
        if anchor is not None:
            parent = anchor.parent
            at = parent.children.index(anchor) + 1
            while at < len(parent.children) and isinstance(parent.children[at], Node) and is_tomb(parent.children[at]):
                at += 1
        else:
            units = _units(container)
            parent = units[0].parent if units else container
            at = parent.children.index(units[0]) if units else len(parent.children)
        node.parent = parent
        parent.children.insert(at, node)
    procs_del = list(run_all.procs_del)
    return procs_del


def mark_change_context(proc):
    """「変更のある行だけ表示」でも、変更のある行の字下げの親を隠さないように印を付ける（data-ctx＝基準から、data-ctxl＝前の版から）。
    親が隠れると木の線が宙に浮き、どの条件の中の変更か読めなくなる。git の差分の前後の行と同じで、色は付けない。"""
    for t in steps_tables(proc):
        rows = [r for r in own_rows(t) if not in_thead(r) and not is_group_row(r) and len(cells(r)) >= 2]
        for attr, mark in (("data-ch", "data-ctx"), ("data-chl", "data-ctxl")):
            for i, tr in enumerate(rows):
                if not tr.get(attr):
                    continue
                d = row_depth(cells(tr)[1])
                for up in reversed(rows[:i]):
                    if d == 0:
                        break
                    if is_tomb(up) and up.get(attr) != "del":  # この表示では出ない削除の行
                        continue
                    ud = row_depth(cells(up)[1])
                    if ud < d:
                        if not up.get(attr):
                            up.set(mark, "")
                        d = ud


def mark_range_ends(proc):
    """「変更のある行だけ表示」で行が隠れても範囲の ▼ ▲ が消えないように、見えている最初と最後の行に印を付ける（gba・gea＝基準から、gbl・gel＝前の版から）。"""
    modes = (("data-ch", "data-ctx", "all", "gba", "gea"), ("data-chl", "data-ctxl", "last", "gbl", "gel"))

    def shown(tr, attr, ctx, chip):
        if tr.has_class("gs"):
            return any(n.has_class("chc") and n.has_class(chip) for n in tr.iter())
        return tr.get(attr) is not None or tr.get(ctx) is not None

    def flush(seg, lane):
        for attr, ctx, chip, b, e in modes:
            vis = [c for r, c in seg if shown(r, attr, ctx, chip)]
            if vis:
                vis[0].add_class("%s%d" % (b, lane))
                vis[-1].add_class("%s%d" % (e, lane))

    for t in steps_tables(proc):
        for tb in [x for x in t.elements() if x.tag == "tbody" and x.has_class("grp")]:
            rows = [r for r in tb.elements() if r.tag == "tr" and not r.has_class("gt")]
            for lane in (1, 2, 3):
                seg = []
                for r in rows:
                    cs = cells(r)
                    c = cs[1] if len(cs) >= 2 else None
                    if c is None or not c.has_class("gd%d" % lane):
                        flush(seg, lane)
                        seg = []
                        continue
                    seg.append((r, c))
                    if c.has_class("ge%d" % lane):
                        flush(seg, lane)
                        seg = []
                flush(seg, lane)


def add_change_chips(proc):
    """帯に、範囲の中の追加・削除の行数（+3 −1）を出す。文中の変更は +1 −1 と数える。"""
    def chip(cls, rows, attr):
        plus = sum(1 for r in rows if r.get(attr) in ("add", "mod"))
        minus = sum(1 for r in rows if r.get(attr) in ("del", "mod"))
        if not plus and not minus:
            return ""
        return '<span class="chc %s">%s%s</span>' % (cls, '<span class="cp">+%d</span>' % plus if plus else "", '<span class="cm">−%d</span>' % minus if minus else "")
    for h in groups_of(proc):
        rows = [r for r in h["all_rows"] if not is_group_row(r)]
        spans = chip("all", rows, "data-ch") + chip("last", rows, "data-chl")
        if not spans:
            continue
        gb = next(n for n in h["tr"].iter() if n.has_class("gb"))
        at = next(i for i, c in enumerate(gb.children) if isinstance(c, Node) and c.has_class("rng"))
        frag = parse_html(spans).children
        for k, c in enumerate(frag):
            c.parent = gb
            gb.children.insert(at + 1 + k, c)


# ----- 版のスナップショット -----
def versions_dir(a_parts, explicit=None):
    if explicit:
        return Path(explicit)
    first = Path(a_parts[0]) if a_parts else None
    if first is not None and first.is_dir():
        return first.resolve().parent / "versions"
    return None


def _spec_text(t):
    """版を比べるときの文。検証記録と一覧は差分の対象外なので除く（版を保存した後に書いてよい）。"""
    return re.sub(r'<section data-sec="(?:%s)"[^>]*>.*?</section>' % "|".join(sorted(DIFF_SKIP_SEC)), "", t, flags=re.S)


def read_parts_text(paths):
    return "\n".join(p.read_text(encoding="utf-8-sig").replace("\r\n", "\n") for p in paths)


def load_versions(vd):
    """history.json と、版ごとの部品の文字列を読む。"""
    if vd is None or not (vd / "history.json").exists():
        return []
    items = json.loads((vd / "history.json").read_text(encoding="utf-8"))
    for it in items:
        it["text"] = read_parts_text(_collect_parts([str(vd / ("v%d" % it["v"]))]))
    return items


def cmd_rev(a):
    """今の部品を、新しい版として保存する。"""
    parts = Path(a.parts)
    if not parts.is_dir():
        print("部品のディレクトリがありません: %s" % parts, file=sys.stderr)
        return 2
    vd = Path(a.versions) if a.versions else parts.resolve().parent / "versions"
    vd.mkdir(parents=True, exist_ok=True)
    hist = vd / "history.json"
    items = json.loads(hist.read_text(encoding="utf-8")) if hist.exists() else []
    cur = read_parts_text(_collect_parts([str(parts)]))
    if items:
        last = read_parts_text(_collect_parts([str(vd / ("v%d" % items[-1]["v"]))]))
        if _spec_text(last) == _spec_text(cur):
            print("前の版（v%d）から部品が変わっていません（検証記録と一覧は版の比較の対象外）。" % items[-1]["v"], file=sys.stderr)
            return 2
    v = len(items) + 1
    dst = vd / ("v%d" % v)
    dst.mkdir()
    for f in _collect_parts([str(parts)]):
        (dst / f.name).write_bytes(f.read_bytes())
    item = {"v": v, "date": a.date or datetime.date.today().isoformat(), "kind": a.kind, "note": a.note}
    if a.commit:
        item["commit"] = a.commit
    items.append(item)
    hist.write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("v%d を保存しました（%s）：%s" % (v, a.kind, dst))
    return 0


def _row_changes(old_text, new_text):
    """2 つの版の差分を、処理ごとの行の変更の一覧にする。"""
    old_root, new_root = parse_html(old_text), parse_html(new_text)
    run = diff_trees(old_root, new_root)
    out = []

    def label(tr):
        pr = tr.closest(lambda a: a.tag == "section" and a.has_class("proc"))
        return pr.get("id") if pr is not None else None

    def rows_of(n):
        rows = [n] if n.tag == "tr" else n.find_all(lambda x: x.tag == "tr")
        return [r for r in rows if _is_steps_row(r) and not is_group_row(r) and not in_thead(r)]

    for n in run.added:
        for tr in rows_of(n):
            out.append(("add", label(tr), tr))
    for tr in run.changed.values():
        if _is_steps_row(tr) and not is_group_row(tr):
            out.append(("mod", label(tr), tr))
    for _anchor, _cont, o in run.deleted:
        for tr in rows_of(o):
            out.append(("del", label(tr), tr))
    return out, run.procs_del


def _no_sort_key(no):
    m = re.match(r"(?:([EA]\d+)-)?(\d+)([a-z]?)", no or "")
    return (m.group(1) or "", int(m.group(2)), m.group(3)) if m else ("~", 0, "")


def history_html(root, vers, cur_text, draft):
    """変更履歴のタブ（版の一覧・変更した行の一覧・AI が補った所）を作る。"""
    procs = {p.get("id"): p for p in procs_of(root)}
    ids = {n.get("id") for n in root.iter() if n.get("id")}

    def plab(pid):
        return html.escape(" ".join(_tab_label(procs[pid]).split()[:2])) if pid in procs else html.escape(pid or "")

    seq = [(it["v"], it, it["text"]) for it in vers]
    if draft:
        seq.append((len(vers) + 1, {"date": datetime.date.today().isoformat(), "kind": "作業中", "note": "版を保存していない変更"}, cur_text))
    rows1, rows2 = [], []
    for i, (v, it, text) in enumerate(seq):
        chips = "—"
        if i > 0:
            ch, pdel = _row_changes(seq[i - 1][2], text)
            by = {}
            for kind, pid, tr in ch:
                by.setdefault(pid, []).append((kind, tr))
            lines = []
            for pid in sorted(by, key=lambda x: str(x)):
                pl = sum(1 for k, _t in by[pid] if k in ("add", "mod"))
                mi = sum(1 for k, _t in by[pid] if k in ("del", "mod"))
                lines.append('%s：<span class="chc">%s%s</span>' % (plab(pid), '<span class="cp">+%d</span>' % pl if pl else "", '<span class="cm">−%d</span>' % mi if mi else ""))
                for kind in ("add", "mod", "del"):
                    nos = [cells(t)[0].text().strip() for k, t in by[pid] if k == kind and not t.has_class("arm")]
                    nos = sorted((n for n in nos if n), key=_no_sort_key)
                    if not nos:
                        continue
                    first_tr = next(t for k, t in by[pid] if k == kind and not t.has_class("arm"))
                    txt = main_text(cells(first_tr)[1])[:46] if len(cells(first_tr)) > 1 else ""
                    links = "・".join(('<a href="#%s-s%s">%s</a>' % (pid, n, n)) if "%s-s%s" % (pid, n) in ids else n for n in nos)
                    rows2.insert(0, "<tr><td>v%d</td><td>%s</td><td>%s</td><td>%s</td><td>%s…</td></tr>" % (
                        v, plab(pid), links, {"add": "追加", "mod": "変更", "del": "削除"}[kind], html.escape(txt)))
            for name in pdel:
                lines.append("削除した処理：%s" % html.escape(name))
            chips = "<br>".join(lines) or "（処理の行の変更なし）"
        commit = html.escape(it.get("commit", ""))
        rows1.append("<tr><td>v%d</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (
            v, html.escape(it.get("date", "")), html.escape(it.get("kind", "")), commit, html.escape(it.get("note", "")).replace("\n", "<br>"), chips))
    out = ['<h2>変更履歴</h2><table class="sub"><thead><tr><th>版</th><th>日付</th><th>きっかけ</th><th>コミット</th><th>内容</th><th>変更した行</th></tr></thead><tbody>%s</tbody></table>' % "".join(rows1)]
    if rows2:
        out.append('<h2>変更した行の一覧</h2><table class="sub"><thead><tr><th>版</th><th>処理</th><th>No.</th><th>種類</th><th>内容（複数なら最初の行）</th></tr></thead><tbody>%s</tbody></table>' % "".join(rows2))
    sup_rows = []
    for pid, proc in procs.items():
        for _t, tr, cs in step_rows(proc):
            for sp in cs[1].find_all(lambda n: n.has_class("sup")) if len(cs) > 1 else []:
                no = cs[0].text().strip()
                sup_rows.append('<tr><td>%s</td><td><a href="#%s">%s</a></td><td>%s</td><td>%s</td></tr>' % (
                    plab(pid), tr.get("id") or "", no, html.escape(main_text(cs[1])[:60]), html.escape(sp.get("data-why") or "")))
    if sup_rows:
        out.append('<h2>AI が補った所（確認待ち）</h2><table class="sub"><thead><tr><th>処理</th><th>No.</th><th>内容</th><th>理由</th></tr></thead><tbody>%s</tbody></table>' % "".join(sup_rows))
    return "".join(out)


GUIDE_ROWS = [
    ("逐次処理", "No.", "実行順。行き先の書かれていない行は、次の番号の行へ進む。<code>31a</code> のような枝番は後から足した行で、既存の No. は振り直さない"),
    ("逐次処理", "→ 12", "12 へ進む"),
    ("逐次処理", "No.29.3", "No.29 の中の項目 3"),
    ("逐次処理", "字下げ・縦の線・├─・└─", "ブロック（分岐・繰り返し・try）の内側、結果ごとの始まり、ブロックの終わり"),
    ("逐次処理", "E1・A1", "例外経路・非同期経路"),
    ("グループ", "灰色の帯", "意味の近い行のまとまり。行の中身は省略していない"),
    ("グループ", "右側の線と ▼ ▲", "入れ子のグループの範囲。▼ が開始、▲ が終了"),
    ("グループ", "全API共通 など", "同じコードを同じ順で通り、行も同じ処理の範囲"),
    ("グループ", "帯の左の ▼ ▶・表示レベル", "開閉と、畳む深さの切り替え。リンクで移った先のグループは自動で開く。印刷ではすべての行が出る"),
    ("SQL", "実行SQL", "コードに書かれている SQL"),
    ("SQL", "参考SQL", "ORM・ライブラリの操作から推定した SQL。実行される SQL そのものとしては確認していない"),
    ("SQL", "設計SQL", "この設計で発行する SQL。まだ実装していない"),
    ("確かさ", '<span class="inf">〔推定〕</span>', "コードに直接書かれていない動作（フレームワークの仕様などからの推定）"),
    ("確かさ", '<span class="uv">〔未確認〕</span>', "確定できない事項・未決の事項（未確認事項を参照）"),
    ("確かさ", '<span class="sup">〔補完〕</span>', "指示に無いことを AI が補った内容。確認して問題なければ印を消す"),
    ("変更", '<ins class="a l">緑</ins>・<del class="a l">赤の取り消し線</del>', "追加・削除。文中は変えた語だけ、行ごとの追加・削除は処理内容と根拠の欄に色が付く。番号の欄の <code>+</code> <code>−</code> は行ごとの追加・削除"),
    ("変更", '<span class="chc"><span class="cp">+3</span><span class="cm">−1</span></span>', "範囲の中で追加・削除した行の数（文中の変更は +1 −1 と数える）"),
    ("変更", "v1・v2・v3", "版。指示・AI の補完・コミットごとに増える。v1 は変更の基準で、印は付かない"),
    ("変更", "変更の表示", "すべての変更（v1 から）／今回の変更だけ／隠す（確定後の姿）。「変更のある行だけ表示」は、変更の無い行・経路・節を隠す（処理の概要は残す）。変更のある行の親（分岐・「〜のとき」行など）は、字下げの関係が分かるように色なしで残す"),
    ("その他", "タブの上の小さな文字", "処理の分類"),
    ("その他", "値の例", "すべて説明用の架空の値"),
]


def guide_html(with_changes):
    rows = [r for r in GUIDE_ROWS if with_changes or r[0] != "変更"]
    out, i = [], 0
    while i < len(rows):
        j = i
        while j < len(rows) and rows[j][0] == rows[i][0]:
            j += 1
        for k in range(i, j):
            head = '<td rowspan="%d">%s</td>' % (j - i, rows[k][0]) if k == i else ""
            out.append("<tr>%s<td>%s</td><td>%s</td></tr>" % (head, rows[k][1], rows[k][2]))
        i = j
    return '<h2>見方</h2><table class="sub auto"><thead><tr><th>分類</th><th>表記</th><th>意味</th></tr></thead><tbody>%s</tbody></table>' % "".join(out)


def change_control(n_versions, last_v, only_changes):
    last = '<label><input type="radio" name="cv" id="cv-last">今回の変更だけ（v%d）</label>' % last_v if n_versions > 2 else ""
    return ('<div class="cvw noprint"><span class="cvl">変更の表示</span><label><input type="radio" name="cv" id="cv-all" checked>すべての変更（v1 から）</label>%s'
            '<label><input type="radio" name="cv" id="cv-hide">隠す（確定後の姿）</label><label><input type="checkbox" id="cv-only"%s>変更のある行だけ表示</label></div>' % (last, " checked" if only_changes else ""))


# ----- git の差分との照合 -----
def git_hunks(repo, base, head="HEAD"):
    """git diff から、変更された行の範囲を読む。{リポジトリからの相対パス: [(開始, 終了)]}"""
    r = subprocess.run(["git", "-C", str(repo), "diff", "-U0", "--no-color", base, head], capture_output=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:300])
    out, cur, hunk = {}, None, None

    def finish():
        # import・コメント・空行だけの変更は、仕様に関係しないので除く
        if hunk and cur and not all(re.match(r"^\s*(import\b|from\s+\S+\s+import\b|using\b|package\b|#include\b|//|#|/\*|\*|$)", t) for t in hunk["lines"]):
            out.setdefault(cur, []).append((hunk["st"], hunk["en"]))

    for line in r.stdout.splitlines():
        if line.startswith("+++ "):
            finish()
            hunk = None
            cur = None if line[4:].strip() == "/dev/null" else line[4:].strip()[2:]
        elif line.startswith("@@") and cur:
            finish()
            m = re.match(r"@@ -\S+ \+(\d+)(?:,(\d+))? @@", line)
            st, cnt = int(m.group(1)), int(m.group(2) or 1)
            hunk = {"st": st, "en": st + max(cnt, 1) - 1, "lines": []}
        elif hunk is not None and line[:1] in "+-" and not line.startswith(("+++", "---")):
            hunk["lines"].append(line[1:])
    finish()
    return {f: rs for f, rs in out.items() if Path(f).suffix.lower() in SRC_EXTS}


def check_git(body, src_root, base, head, rep):
    """コードの変更と、文書の行の変更を突き合わせる（コードが変わったのに仕様の行が変わっていない所を見つける）。"""
    top = subprocess.run(["git", "-C", str(src_root), "rev-parse", "--show-toplevel"], capture_output=True, encoding="utf-8", errors="replace")
    if top.returncode != 0:
        rep.err("GIT", "", "%s は git リポジトリではありません" % src_root)
        return
    repo = Path(top.stdout.strip())
    try:
        hunks = git_hunks(repo, base, head)
    except RuntimeError as e:
        rep.err("GIT", "", "git diff に失敗しました：%s" % e)
        return
    idx = SourceIndex(src_root)
    cited = []  # (リポジトリからの相対パス, 開始, 終了, 処理, No., 変更の有無)
    for proc in procs_of(body):
        for _t, tr, cs in step_rows(proc):
            if len(cs) < 3:
                continue
            for f, a, b in parse_citations(cs[-1].text()):
                for c in idx.resolve(f)[:1]:
                    try:
                        rel = c.resolve().relative_to(repo.resolve()).as_posix()
                    except ValueError:
                        continue
                    cited.append((rel, a, b, proc.get("id"), cs[0].text().strip(), bool(tr.get("data-ch") or tr.get("data-chl"))))
    for f, ranges in sorted(hunks.items()):
        for st, en in ranges:
            refs = [c for c in cited if c[0] == f and c[1] <= en and st <= c[2]]
            where = "%s:%d-%d" % (f, st, en)
            if not refs:
                rep.warn("GIT", where, "変更された行が、どの行の根拠にも無い（仕様への影響を確認し、行を足すか、影響が無い理由を確認する）")
            elif not any(c[5] for c in refs):
                rep.warn("GIT", where, "コードは変わったが、参照している行（%s）の文は変わっていない（仕様が変わらない変更か確認する）" % "・".join("%s No.%s" % (c[3], c[4]) for c in refs[:4]))
    for proc in procs_of(body):
        for _t, tr, cs in step_rows(proc):
            if len(cs) < 3 or not (tr.get("data-ch") or tr.get("data-chl")):
                continue
            mine = parse_citations(cs[-1].text())
            hit = False
            for f, a, b in mine:
                for c in idx.resolve(f)[:1]:
                    try:
                        rel = c.resolve().relative_to(repo.resolve()).as_posix()
                    except ValueError:
                        continue
                    if any(r[0] <= b and a <= r[1] for r in hunks.get(rel, [])):
                        hit = True
            if not hit:
                rep.info("GITROW", "%s No.%s" % (proc.get("id"), cs[0].text().strip()), "文は変わったが、根拠の行は git の差分に含まれていない")


def cmd_gitscope(a):
    """git の差分から、変更された行と、それを含む関数を一覧にする（影響する処理を探すため）。"""
    top = subprocess.run(["git", "-C", str(a.repo), "rev-parse", "--show-toplevel"], capture_output=True, encoding="utf-8", errors="replace")
    if top.returncode != 0:
        print("%s は git リポジトリではありません" % a.repo, file=sys.stderr)
        return 2
    repo = Path(top.stdout.strip())
    try:
        hunks = git_hunks(repo, a.base, a.head)
    except RuntimeError as e:
        print("git diff に失敗しました：%s" % e, file=sys.stderr)
        return 2
    if not hunks:
        print("ソースの変更はありません")
        return 0
    for f, ranges in sorted(hunks.items()):
        p = repo / f
        print(f)
        if not p.exists():
            print("  （対象の版に無いファイル）")
            continue
        lines = read_lines(p)
        fr = function_ranges(p, lines)
        for st, en in ranges:
            ef = enclosing_function(p, lines, fr, st) if st <= len(lines) else None
            print("  %d-%d  %s" % (st, en, ef[2].strip()[:70] if ef else "（関数の外）"))
    return 0


def _prune_deleted(root):
    """検査の対象から、削除の印と、説明のタブを除く（検査するのは今の文書の中身だけ）。"""
    def walk(n):
        kept = []
        for ch in n.children:
            if isinstance(ch, Node):
                if ch.tag == "del" or is_tomb(ch) or ch.get("id") in ("doc-history", "doc-guide"):
                    continue
                walk(ch)
            kept.append(ch)
        n.children = kept
    walk(root)


def transform(root, report):
    procs = procs_of(root)
    for i, proc in enumerate(procs, 1):
        if not proc.get("id"):
            proc.set("id", "p%d" % i)
    # 処理をまたぐ参照（p2 No.05）を先にリンクにする（処理の中の「No.05」として解決されないように）
    link_global_refs(root)
    for proc in procs:
        pid = proc.get("id")
        for s in proc.find_all(lambda n: n.tag == "section" and n.get("data-path")):
            if not s.get("id"):
                s.set("id", "%s-%s" % (pid, s.get("data-path").strip()))
        for t in steps_tables(proc):
            last_depth = 0
            for kind, tr, cs, d in table_rows(t):
                if kind == "dt":  # 旧形式：直前の行より 1 段下げる
                    if len(cs) >= 2:
                        if d == 0:
                            d = min(last_depth + 1, MAX_DEPTH)
                            cs[1].add_class("i%d" % d)
                        cs[1].add_class("c")
                    if d >= 1:
                        tr.add_class("n")
                    continue
                if len(cs) >= 2:
                    cs[1].add_class("c")
                if d >= 1:
                    tr.add_class("n")
                last_depth = d
                if kind == "arm":
                    continue
                if cs:
                    cs[0].add_class("no")
                if len(cs) >= 3:
                    cs[-1].add_class("src")
                no = cs[0].text().strip() if cs else ""
                if STEP_NO_RE.match(no):
                    if not tr.get("id"):
                        tr.set("id", "%s-s%s" % (pid, no))
                    if len(cs) >= 2:
                        for k, li in enumerate(items_of(cs[1]), 1):
                            if not li.get("id"):
                                li.set("id", "%s-s%s-%d" % (pid, no, k))
                if len(cs) >= 2 and set(kinds_in(cs[1])) & CLOSERS:
                    tr.add_class("close")
            # ブロックの先頭の行：次の行（詳細行を除く）が 1 段以上深い行
            rows_nd = [r for r in table_rows(t) if r[0] != "dt"]
            for j, (kind, tr, cs, d) in enumerate(rows_nd[:-1]):
                if rows_nd[j + 1][3] > d and not tr.has_class("close"):
                    tr.add_class("hd")
        apply_groups(proc, pid, report)
        add_change_chips(proc)
        mark_change_context(proc)
        mark_range_ends(proc)
        steps, paths = collect_targets(proc)
        # 処理の中のテキスト全体：逐次処理表の処理内容の欄と .go は「→ 07」も、それ以外は「No.07」「No.29.3」だけをリンクにする
        _link_cell(proc, pid, steps, paths, report, pid, arrows=False)
    fill_map(root)
    # SQL の見出し
    for pre in root.find_all(lambda n: n.tag == "pre" and n.has_class("sql")):
        if pre.get("data-labeled") or is_tomb(pre):
            continue
        kind = (pre.get("data-kind") or "").strip()
        src = (pre.get("data-src") or "").strip()
        note = (pre.get("data-note") or "").strip()
        if kind == "exec":
            label = "<b>実行SQL</b>" + (" %s" % html.escape(src) if src else "")
        elif kind == "design":
            label = "<b>設計SQL</b>" + (" %s" % html.escape(src) if src else "")
        elif kind == "ref":
            label = "<b>参考SQL</b>" + (" 元の操作: %s" % html.escape(src) if src else "")
        else:
            continue
        if note:
            label += " " + html.escape(note)
        div = Node("div", [("class", "sqlh")], pre.parent)
        div.children.append(Text(label, div))
        idx = pre.parent.children.index(pre)
        pre.parent.children.insert(idx, div)
        pre.set("data-labeled", "1")
    # JSON の例の見出し
    for pre in root.find_all(lambda n: n.tag == "pre" and n.has_class("json")):
        title = (pre.get("data-title") or "").strip()
        if not title or pre.get("data-labeled"):
            continue
        div = Node("div", [("class", "sqlh")], pre.parent)
        div.children.append(Text("<b>%s</b>" % html.escape(title), div))
        pre.parent.children.insert(pre.parent.children.index(pre), div)
        pre.set("data-labeled", "1")
    return root


# ---------------------------------------------------------------------------
# 処理をまたぐ参照（p2 No.05）・処理ごとのタブ
# ---------------------------------------------------------------------------
GLOBAL_REF_RE = re.compile(r"(?<![A-Za-z0-9_\-])(p\d+)\s?No(?:\.\s?|(?=\d))(" + _ID + r"(?:\.\d{1,2}(?!\d))?)(?![\d\-])")
CHAIN_REF_RE = re.compile(r"(\s?[・、,]\s?)(No(?:\.\s?|(?=\d))(" + _ID + r"(?:\.\d{1,2}(?!\d))?))(?![\d\-])")


def link_global_refs(root):
    """「p2 No.05」「p2 No.29.3」「p2 No.E3」を、その処理の行・項目・経路へのリンクにする（処理の中・外のどちらでも）。"""
    targets = {proc.get("id"): collect_targets(proc) for proc in procs_of(root) if proc.get("id")}

    def walk(n):
        new_children = []
        for ch in n.children:
            if isinstance(ch, Node):
                if ch.tag not in NO_LINK_TAGS and not is_tomb(ch):
                    walk(ch)
                new_children.append(ch)
                continue
            if not isinstance(ch, Text):
                new_children.append(ch)
                continue
            raw = ch.raw
            pos = at = 0

            def link(text, tid):
                a = Node("a", [("href", "#" + tid)], n)
                a.children.append(Text(text, a))
                new_children.append(a)
            while True:
                m = GLOBAL_REF_RE.search(raw, at)
                if not m:
                    break
                pid, rid = m.group(1), m.group(2)
                tid = target_id(pid, rid, *targets[pid]) if pid in targets else None
                at = m.end()
                if tid is None:
                    continue  # 解決できない参照は check が報告する
                if m.start() > pos:
                    new_children.append(Text(raw[pos:m.start()], n))
                link(m.group(0), tid)
                pos = m.end()
                # 続けて「・No.18」「、No.19」と書いた参照も同じ処理の行とみなす
                while True:
                    c = CHAIN_REF_RE.match(raw, pos)
                    t2 = target_id(pid, c.group(3), *targets[pid]) if c else None
                    if t2 is None:
                        break
                    new_children.append(Text(c.group(1), n))
                    link(c.group(2), t2)
                    pos = at = c.end()
            if pos == 0:
                new_children.append(ch)
            elif pos < len(raw):
                new_children.append(Text(raw[pos:], n))
        n.children = new_children
    walk(root)


def _tab_label(proc):
    lab = (proc.get("data-tab") or "").strip()
    if lab:
        return lab
    h = next((n for n in proc.iter() if n.tag == "h2"), None)
    t = re.sub(r"\s+", " ", h.text()).strip() if h is not None else proc.get("id")
    return re.sub(r"^\d+(\.\d+)*\.?\s*", "", t)


def _group_of(proc):
    return (proc.get("data-group") or "").strip() or "処理"


def make_tabs(root, extras=None, control=""):
    """本文を「一覧」・処理ごと・「変更履歴」・「未確認事項・検証記録」・「見方」のパネルに分け、関心事の分類（data-group）ごとにまとめたタブを作る。
    JavaScript は使わず、:target と :has で切り替える。extras は [(タブの名前, id, HTML)]。戻り値は (nav の HTML, 追加の CSS)。タブにしない場合は None。"""
    extras = extras or []
    procs = [n for n in root.children if isinstance(n, Node) and n.tag == "section" and n.has_class("proc")]
    if not procs or len(procs_of(root)) != len(procs):
        return None
    first = root.children.index(procs[0])
    last = root.children.index(procs[-1])
    pre = root.children[:first]
    post = [c for c in root.children[first:last + 1] if not (isinstance(c, Node) and c.has_class("proc"))]
    post += root.children[last + 1:]

    def has_content(nodes):
        return any(isinstance(c, Node) or (isinstance(c, Text) and c.raw.strip()) for c in nodes)

    def panel(pid, nodes, cls="panel"):
        d = Node("div", [("class", cls), ("id", pid)], root)
        for c in nodes:
            c.parent = d
        d.children = list(nodes)
        return d

    new_children, tabs_doc, default_id = [], [], None
    if has_content(pre) or len(procs) >= 2:
        if not has_content(pre):
            rows = "".join('<tr><td>%s</td><td><a href="#%s">%s</a></td></tr>' % (
                html.escape(_group_of(pr)), pr.get("id"), html.escape(_tab_label(pr))) for pr in procs)
            pre = parse_html('<section data-sec="toc"><h2>文書の構成</h2><table class="sub"><thead><tr><th>分類</th>'
                             '<th>処理</th></tr></thead><tbody>%s</tbody></table></section>' % rows).children
        new_children.append(panel("doc-toc", pre, "panel default"))
        tabs_doc.append(("一覧", "doc-toc"))
        default_id = "doc-toc"
    for pr in procs:
        pr.add_class("panel")
        new_children.append(pr)
    if default_id is None:
        procs[0].add_class("default")
        default_id = procs[0].get("id")
    for lab, pid, frag in [e for e in extras if e[1] == "doc-history"]:
        new_children.append(panel(pid, parse_html(frag).children))
        tabs_doc.append((lab, pid))
    if has_content(post):
        new_children.append(panel("doc-check", post))
        tabs_doc.append(("未確認事項・検証記録", "doc-check"))
    for lab, pid, frag in [e for e in extras if e[1] != "doc-history"]:
        new_children.append(panel(pid, parse_html(frag).children))
        tabs_doc.append((lab, pid))
    root.children = new_children

    order, by_group = ["文書"], {"文書": tabs_doc}
    for pr in procs:
        g = _group_of(pr)
        if g not in by_group:
            order.append(g)
            by_group[g] = []
        by_group[g].append((_tab_label(pr), pr.get("id")))
    nav = ['<nav class="tabs" aria-label="処理の切り替え">']
    for g in order:
        nav.append('<div class="tg"><div class="tgl">%s</div><div class="tgt">%s</div></div>' % (
            html.escape(g), "".join('<a class="tab%s" href="#%s">%s</a>' % (" default" if tid == default_id else "", tid, html.escape(lab))
                                     for lab, tid in by_group[g])))
    if control:
        nav.append(control)
    nav.append("</nav>")

    # タブの帯の高さの目安（1280px 幅で何段に折り返すか）。一番外側のグループの帯をタブのすぐ下に固定し、リンク先の行が隠れないようにする
    def label_w(lab):
        return sum(7.2 if ord(c) < 128 else 12.5 for c in lab) + 22
    width = int(sum(label_w(lab) for g in order for lab, _ in by_group[g]) + 14 * len(order))
    lines = max(1, -(-width // 1200))
    extra_h = 24 if control else 0
    tabs_h = "body.tabs { --tabs-h: %dpx; }\n" % (lines * 47 + 5 + extra_h)
    if lines > 1:  # 広い画面では折り返さない
        tabs_h += "@media screen and (min-width: %dpx) { body.tabs { --tabs-h: %dpx; } }\n" % (width + 60, 52 + extra_h)
    # タブが見積もりより多く折り返す幅では、帯を固定しない
    tabs_h += "@media screen and (max-width: %dpx) { table.steps > tbody > tr.gt > td { position: static; } }\n" % (min(width + 60, 1279) if lines == 1 else 1279)
    ids = [tid for g in order for _, tid in by_group[g]]
    on = ",\n".join('body.tabs:has(#%s:target, #%s :target) nav.tabs a.tab[href="#%s"]' % (i, i, i) for i in ids)
    css = (tabs_h
           + on + ",\nbody.tabs:not(:has(.panel:target, .panel :target)) nav.tabs a.tab.default "
           "{ background: #fff; border-color: #555; color: var(--fg); font-weight: 700; top: 1px; }\n")
    return "\n".join(nav), css


# ---------------------------------------------------------------------------
# SQL の解析（検査用の簡易版）
# ---------------------------------------------------------------------------
def _strip_sql(sql):
    s = re.sub(r"<!--.*?-->", " ", sql, flags=re.S)
    s = re.sub(r"<\s*set\s*>", " SET ", s, flags=re.I)
    s = re.sub(r"<\s*where\s*>", " WHERE ", s, flags=re.I)
    s = re.sub(r"</?\s*(if|choose|when|otherwise|trim|foreach|bind|include|where|set|select|insert|update|delete|sql)\b[^>]*>", " ", s, flags=re.I)
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)
    s = re.sub(r"--[^\n]*", " ", s)
    s = re.sub(r"'(?:[^']|'')*'", "''", s)
    return s


def sql_verb(sql):
    s = _strip_sql(sql)
    m = re.search(r"\b(select|with|insert|update|delete|merge|replace|upsert|call|lock|truncate)\b", s, re.I)
    if not m:
        return None
    v = m.group(1).upper()
    if v == "WITH":
        m2 = re.search(r"\)\s*(select|insert|update|delete|merge)\b", s, re.I)
        v = m2.group(1).upper() if m2 else "SELECT"
    if v == "REPLACE" or v == "UPSERT":
        v = "INSERT"
    return v


def _split_top(s, sep=","):
    out, depth, cur = [], 0, []
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == sep and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur))
    return out


def _top_level_find(s, word, start=0):
    depth = 0
    rx = re.compile(r"\b%s\b" % word, re.I)
    i = start
    while i < len(s):
        ch = s[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0:
            m = rx.match(s, i)
            if m and (i == 0 or not (s[i - 1].isalnum() or s[i - 1] == "_")):
                return i
        i += 1
    return -1


def _ident(expr):
    e = expr.strip()
    m = re.search(r"\bas\s+[\"`\[]?(\w+)[\"`\]]?\s*$", e, re.I)
    if m:
        return m.group(1)
    m = re.search(r"[\w)\"`\]]\s+[\"`\[]?([A-Za-z_]\w*)[\"`\]]?\s*$", e)
    if m and not re.search(r"\b(desc|asc|end|null)\s*$", e, re.I):
        return m.group(1)
    m = re.search(r"([A-Za-z_]\w*)[\"`\]]?\s*$", e)
    return m.group(1) if m else None


def select_columns(sql):
    s = _strip_sql(sql)
    i = _top_level_find(s, "select")
    if i < 0:
        return None
    j = _top_level_find(s, "from", i + 6)
    if j < 0:
        return None
    lst = s[i + 6:j]
    lst = re.sub(r"^\s*(distinct|all)\b", " ", lst, flags=re.I)
    cols = []
    for item in _split_top(lst):
        it = item.strip()
        if not it:
            continue
        if it == "*" or it.endswith(".*"):
            return None
        name = _ident(it)
        if name:
            cols.append(name)
    return cols


def update_columns(sql):
    s = _strip_sql(sql)
    i = _top_level_find(s, "set")
    if i < 0:
        return None
    end = len(s)
    for w in ("where", "returning", "from", "output"):
        j = _top_level_find(s, w, i + 3)
        if 0 <= j < end:
            end = j
    cols = []
    for item in _split_top(s[i + 3:end]):
        if "=" in item:
            left = item.split("=", 1)[0].strip()
            m = re.search(r"([A-Za-z_]\w*)[\"`\]]?\s*$", left)
            if m:
                cols.append(m.group(1))
    return cols


def insert_columns(sql):
    s = _strip_sql(sql)
    m = re.search(r"\binsert\s+(?:ignore\s+)?into\s+[\w.\"`\[\]]+\s*\(([^)]*)\)", s, re.I)
    if not m:
        return None
    return [c.strip().strip('"`[]') for c in m.group(1).split(",") if c.strip()]


def placeholders(sql):
    s = _strip_sql(sql)
    named = set(re.findall(r"(?<![:\w]):([A-Za-z_]\w*)", s))
    named |= set(x.split(".")[-1] for x in re.findall(r"[#$]\{\s*([\w.]+)", sql))
    named |= set(re.findall(r"%\((\w+)\)s", s))
    named |= set(re.findall(r"(?<![\w@])@([A-Za-z_]\w*)", s))
    positional = len(re.findall(r"\?", s)) + len(set(re.findall(r"\$(\d+)", s))) + len(re.findall(r"%s", s))
    return named, positional


# ---------------------------------------------------------------------------
# ソースの注目行（分岐・繰返・例外・DB など）と関数の範囲
# ---------------------------------------------------------------------------
KIND_PATTERNS = [
    ("例外", re.compile(r"\b(throw|raise|panic|rethrow)\b|orElseThrow|raise_for_status|\babort\(|\.reject\(|Promise\.reject")),
    ("捕捉", re.compile(r"\b(catch|except|finally|rescue|ensure|recover)\b|^\s*try\b|\btry\s*[{:(]|\.catch\(|onStatus\(|if\s+err\s*!=\s*nil")),
    ("分岐", re.compile(r"^\s*(\}\s*)?(else\s+)?if\b|^\s*(elif|elsif|elseif)\b|\bswitch\b|^\s*case\b|^\s*default\s*:|^\s*match\s+.+:\s*$|^\s*when\b|\bunless\b|\s\?\s[^:]+\s:\s|\?\?")),
    ("繰返", re.compile(r"^\s*(for|foreach|while|do|loop|repeat)\b|\.forEach\(|\.each\b|\.map\(|\.flatMap\(|\bfor\s*\(|\bfor\s+.+\s+(in|of)\s|\.stream\(\)|\brange\b")),
    ("戻り", re.compile(r"^\s*return\b|^\s*yield\b")),
    ("SQL", re.compile(r"\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|REPLACE\s+INTO|UPSERT)\b(?!\s*[(=.])"
                       r"|[\"'`]\s*(?i:select|insert\s+into|update|delete\s+from|with)\s|<(select|insert|update|delete)\b")),
    ("DB", re.compile(r"\.(save\w*|persist|merge|flush|remove|delete\w*|find\w*|count\w*|exists\w*|query\w*|execute\w*|exec|Exec\w*|Query\w*|update\w*|insert\w*|upsert|bulk\w*|scalar\w*|getRepository|createQueryBuilder|get_or_create|select_for_update|with_for_update|selectForUpdate|lock\w*)\(|\bsession\.(add|delete|merge|execute|get)\b")),
    ("TX", re.compile(r"@Transactional|\btransaction\b|\.begin\w*\(|\bBeginTx\b|\.Begin\(|\.Commit\(|\.commit\(|\.Rollback\(|\.rollback\(|\batomic\b|TransactionScope|SAVEPOINT", re.I)),
    ("外部", re.compile(r"\b(fetch|axios|httpx|requests|urllib|aiohttp|RestClient|RestTemplate|WebClient|HttpClient|OkHttp|Feign|Guzzle)\b|http\.(Get|Post|NewRequest\w*)\b|\.Do\(\s*req|\.(post|put|patch|get|delete|request)\(\s*(f?[\"'`]|/)|kafkaTemplate|\.send(Mail|Message)?\(|\.publish\w*\(|\.emit\(|\.enqueue\w*\(|\.add\(\s*[\"']")),
    ("非同期", re.compile(r"supplyAsync|runAsync|CompletableFuture|@Async|\bgo\s+(func\b|[\w.]+\()|Promise\.(all|allSettled|race|any)\b|asyncio\.(gather|create_task|wait|wait_for|TaskGroup)|Task\.(Run|WhenAll|WhenAny)|errgroup|ExecutorService|\.submit\(|parallelStream|setTimeout|@TransactionalEventListener|@EventListener|publishEvent|@Scheduled|@KafkaListener|@Processor|<-\s*\w+|\bchan\b|sync\.WaitGroup")),
]
SKIP_DIRS = {".git", "node_modules", "target", "build", "dist", "out", "__pycache__", ".venv", "venv", ".idea", ".vscode", ".gradle", ".next", "coverage"}
BRACE_EXTS = {".java", ".kt", ".kts", ".scala", ".groovy", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".cs",
              ".php", ".swift", ".rs", ".c", ".h", ".cc", ".cpp", ".hpp", ".dart"}
SRC_EXTS = BRACE_EXTS | {".py", ".rb", ".xml", ".sql", ".vb"}
CONTAINER_RE = re.compile(r"\b(class|interface|enum|record|object|namespace|struct|trait|module|impl|extension|companion)\b")
CONTROL_RE = re.compile(r"^\s*(\}\s*)?(if|else|for|foreach|while|switch|do|try|catch|finally|synchronized|with|using|lock|select|defer|case|default)\b")


def kinds_of(line):
    st = line.strip()
    if not st or st.startswith(("//", "#", "*", "/*", "--")) and not st.startswith("#{"):
        return []
    if re.match(r"^(import|package|using|from\s+\S+\s+import|require\(|#include|use\s)", st):
        return []
    ks =[k for k, rx in KIND_PATTERNS if rx.search(line)]
    if ks == ["分岐"] and re.match(r"^\s*(\}\s*)?else\s*(\{|:)?\s*$", line):
        return ["分岐(else)"]
    return ks


def comment_lines(path, lines):
    """複数行にまたがるコメントと docstring の行番号（1 始まり）。kinds_of は 1 行ずつ見るので、説明文の「SELECT」などをここで除く。
    Python の代入や引数の三重引用符（sql = \"\"\"SELECT…）は実行される文字列なので除かない。"""
    ext = Path(path).suffix.lower()
    skip = set()
    if ext == ".py":
        state, is_doc, prev = None, False, ""
        for no, line in enumerate(lines, 1):
            s = line.strip()
            pos = 0
            hit_doc = state is not None and is_doc
            while True:
                if state is None:
                    found = [(line.find(q, pos), q) for q in ('"""', "'''") if line.find(q, pos) >= 0]
                    if not found:
                        break
                    at, q = min(found)
                    if "#" in line[pos:at]:
                        break
                    head = line[:at].strip()
                    is_doc = (head == "" or re.fullmatch(r"[rRuUbBfF]{1,2}", head) is not None) and not re.search(r"[(\[{,=+%\\]$", prev)
                    state, pos = q, at + 3
                    hit_doc = hit_doc or is_doc
                else:
                    at = line.find(state, pos)
                    if at < 0:
                        break
                    state, pos = None, at + 3
            if hit_doc:
                skip.add(no)
            if state is None and s and not s.startswith("#"):
                prev = s
        return skip
    if ext in BRACE_EXTS or ext == ".sql":
        opener, closer = "/*", "*/"
    elif ext == ".xml":
        opener, closer = "<!--", "-->"
    else:
        return skip
    inside = False
    for no, line in enumerate(lines, 1):
        s = line.strip()
        if not inside and s.startswith(opener):
            inside = True
            s = s[len(opener):]
        if inside:
            skip.add(no)
            if closer in s:
                inside = False
    return skip


def _brace_blocks(text):
    """波かっこのブロック（開始行, 終了行）を返す。文字列・コメントは読み飛ばす（簡易）。"""
    blocks, stack = [], []
    i, n, line = 0, len(text), 1
    state = None
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "\n":
            line += 1
            if state == "line":
                state = None
            i += 1
            continue
        if state == "line":
            i += 1
            continue
        if state == "block":
            if ch == "*" and nxt == "/":
                state = None
                i += 2
                continue
            i += 1
            continue
        if state in ("'", '"', "`"):
            if ch == "\\":
                if i + 1 < n and text[i + 1] == "\n":
                    line += 1
                i += 2
                continue
            if ch == state:
                state = None
            i += 1
            continue
        if state == '"""':
            if text.startswith('"""', i):
                state = None
                i += 3
                continue
            i += 1
            continue
        if ch == "/" and nxt == "/":
            state = "line"
            i += 2
            continue
        if ch == "/" and nxt == "*":
            state = "block"
            i += 2
            continue
        if text.startswith('"""', i):
            state = '"""'
            i += 3
            continue
        if ch in ("'", '"', "`"):
            state = ch
            i += 1
            continue
        if ch == "{":
            stack.append(line)
        elif ch == "}" and stack:
            blocks.append((stack.pop(), line))
        i += 1
    return blocks


def _header(lines, open_line):
    """ブロック開始行（1始まり）の直前の文を含む見出しテキスト。"""
    out = []
    k = open_line - 1
    first = True
    while k >= 0 and len(out) < 6:
        s = lines[k]
        if not first and re.search(r"[;{}]\s*$", s.rstrip()):
            break
        out.insert(0, s.strip())
        first = False
        k -= 1
    return " ".join(out)


def function_ranges(path, lines):
    ext = path.suffix.lower()
    res = []
    if ext == ".py":
        for idx, s in enumerate(lines):
            m = re.match(r"^(\s*)(async\s+)?def\s+(\w+)", s)
            if not m:
                continue
            ind = len(m.group(1))
            end = idx
            paren = 0
            for j in range(idx, len(lines)):
                t = lines[j]
                if j > idx and t.strip() and not t.strip().startswith("#") and paren <= 0:
                    if len(t) - len(t.lstrip()) <= ind:
                        break
                paren += t.count("(") - t.count(")")
                if t.strip():
                    end = j
            res.append((idx + 1, end + 1, "def " + m.group(3)))
        return res
    if ext == ".xml":
        cur = None
        for idx, s in enumerate(lines):
            m = re.search(r"<(select|insert|update|delete|sql)\b[^>]*\bid=\"([^\"]+)\"", s)
            if m:
                cur = (idx + 1, m.group(1) + " " + m.group(2))
            m2 = re.search(r"</(select|insert|update|delete|sql)>", s)
            if m2 and cur:
                res.append((cur[0], idx + 1, cur[1]))
                cur = None
        return res
    if ext in BRACE_EXTS:
        text = "\n".join(lines)
        for a, b in _brace_blocks(text):
            head = _header(lines, a)
            if CONTAINER_RE.search(head.split("(")[0]) and not head.strip().startswith(("if", "for", "while")):
                kind = "container"
            elif CONTROL_RE.match(head) or re.match(r"^\s*\}?\s*else\b", lines[a - 1]):
                kind = "control"
            else:
                kind = "func"
            res.append((a, b, kind, head[:80]))
        return res
    return []


def enclosing_function(path, lines, fr, line_no):
    ext = path.suffix.lower()
    if ext in (".py", ".xml"):
        best = None
        for r in fr:
            if r[0] <= line_no <= r[1]:
                if best is None or (r[0] <= best[0] and r[1] >= best[1]):
                    best = r
        if best:
            return best[0], best[1], best[2]
        return None
    chain = [r for r in fr if r[0] <= line_no <= r[1] and r[2] != "control"]
    chain = [r for r in chain if r[2] != "container"]
    if not chain:
        return None
    chain.sort(key=lambda r: (r[0], -r[1]))
    outer = chain[0]
    return outer[0], outer[1], outer[3]


def list_source_files(root):
    files = []
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith(".")]
        for f in fns:
            p = Path(dp) / f
            if p.suffix.lower() in SRC_EXTS or p.suffix.lower() in (".yml", ".yaml", ".properties", ".json", ".toml", ".env"):
                files.append(p)
    return files


def read_lines(p):
    try:
        return p.read_text(encoding="utf-8-sig").splitlines()
    except UnicodeDecodeError:
        return p.read_text(encoding="cp932", errors="replace").splitlines()


# ---------------------------------------------------------------------------
# 根拠（ファイル:行）の解析
# ---------------------------------------------------------------------------
CITE_RE = re.compile(
    r"([A-Za-z0-9_.\-/\\]*[A-Za-z0-9_\-]\.[A-Za-z][A-Za-z0-9]{0,6})\s*[:：]\s*[Ll]?(\d+)(?:\s*[-–~〜]\s*[Ll]?(\d+))?"
    r"((?:\s*[,、]\s*[Ll]?\d+(?:\s*[-–~〜]\s*[Ll]?\d+)?)+)?")


def parse_citations(text):
    out = []
    for m in CITE_RE.finditer(text):
        f = m.group(1).replace("\\", "/")
        a = int(m.group(2))
        b = int(m.group(3)) if m.group(3) else a
        out.append((f, a, max(a, b)))
        if m.group(4):
            for part in re.findall(r"[Ll]?(\d+)(?:\s*[-–~〜]\s*[Ll]?(\d+))?", m.group(4)):
                x = int(part[0])
                y = int(part[1]) if part[1] else x
                out.append((f, x, max(x, y)))
    return out


def reversed_ranges(text):
    """根拠の行番号で、範囲が逆（47-42 など）になっているもの。"""
    out = []
    for m in CITE_RE.finditer(text):
        if m.group(3) and int(m.group(2)) > int(m.group(3)):
            out.append((int(m.group(2)), int(m.group(3))))
        if m.group(4):
            for x, y in re.findall(r"[Ll]?(\d+)\s*[-–~〜]\s*[Ll]?(\d+)", m.group(4)):
                if int(x) > int(y):
                    out.append((int(x), int(y)))
    return out


class SourceIndex:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.files = list_source_files(self.root)
        self.rel = {p.relative_to(self.root).as_posix(): p for p in self.files}
        self.cache = {}

    def resolve(self, cited):
        c = cited.lstrip("./")
        if c in self.rel:
            return [self.rel[c]]
        cands = [p for r, p in self.rel.items() if r.endswith("/" + c) or r == c]
        if not cands and "/" in c:
            base = c.rsplit("/", 1)[1]
            cands = [p for r, p in self.rel.items() if r.endswith("/" + base) or r == base]
        return cands

    def lines(self, p):
        if p not in self.cache:
            self.cache[p] = read_lines(p)
        return self.cache[p]


# ---------------------------------------------------------------------------
# 検査
# ---------------------------------------------------------------------------
REQUIRED_VIEWS = ["処理網羅性", "実行順序", "分岐網羅性", "終了条件", "データ整合性", "SQL整合性", "例外処理",
                  "トランザクション", "共通化の排除", "グループの整合", "視認性", "根拠"]
ABSTRACT_RULES = [
    (re.compile(r"(共通|汎用)[^。、\s]{0,10}(処理|関数|メソッド|ロジック|ルーチン)(を|で)?(呼び出|呼ぶ|実行|行う|使用|利用)"), "共通処理の呼び出しだけを書いている"),
    (re.compile(r"(サービス|Service|リポジトリ|Repository|DAO|Dao|Mapper|マッパー|ユーティリティ|Util|ヘルパー|Helper|Manager|マネージャー|Controller|コントローラー|UseCase|ユースケース)\s*(クラス)?\s*(を|に|で|経由で)\s*(呼び出|使用|使っ|利用|委譲|依頼)"), "クラス・レイヤーの呼び出しとして書いている"),
    (re.compile(r"(入力|妥当性|バリデーション|権限|認証|認可|業務|整合性)(の)?(チェック|検証|確認)?(処理)?を(実行|行)"), "中身を書かずに「〜チェックを行う」と書いている"),
    (re.compile(r"(各種|所定の|必要な|適切な|一連の|諸々の)(処理|チェック|検証|更新|設定|変換)"), "あいまいな語で処理をまとめている"),
    (re.compile(r"(など|等)(を|の)(処理|実行|行|更新|登録)"), "「など」で処理をぼかしている"),
]
EXTERNAL_HINT = re.compile(r"API|HTTP|https?://|エンドポイント|外部|Webhook|SMTP|キュー|ストアド|プロシージャ|Slack|メール|WMS|決済")


def _json_keys(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.append(k)
            _json_keys(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _json_keys(v, out)
    return out


def check_json(body, procs, rep):
    """JSON の例（pre.json）：JSON として正しいか、各項目が周りの表で説明されているか。
    HTTP の処理では、ボディを受け取るメソッドの入力項目と、レスポンスに JSON の例があるか。処理をまたぐ参照の解決。"""
    for pre in body.find_all(lambda n: n.tag == "pre" and n.has_class("json")):
        proc = pre.closest(lambda a: a.tag == "section" and a.has_class("proc"))
        where = proc.get("id") if proc is not None else ""
        try:
            obj = json.loads(pre.text())
        except ValueError as e:
            rep.warn("JSON", where, "pre.json が JSON として解析できない（%s）。値の例は実際の形で書き、補足は表・注記に書く" % e)
            continue
        scope = (pre.closest(lambda a: a.tag == "ol") or pre.closest(lambda a: a.tag == "section" and a.get("data-sec"))
                 or proc or body)
        others = " ".join(t.text() for t in scope.find_all(lambda n: n.tag in ("table", "p", "b")))
        missing = sorted({k for k in _json_keys(obj, []) if k not in others})
        if missing:
            rep.warn("JSON", where, "JSON の例の項目 %s が、同じ節（項目）の表に無い（項目の表で型・値の取得元を説明する）" % ", ".join(missing[:8]))
    for proc in procs:
        pid = proc.get("id") or ""
        kv = " ".join(t.text() for t in proc.find_all(lambda n: n.tag == "table" and n.has_class("kv")))
        m = re.search(r"HTTP\s*メソッド\s*(GET|POST|PUT|PATCH|DELETE)", kv)
        if not m:
            continue

        def jsons(sec):
            return [x for s2 in proc.find_all(lambda n: n.tag == "section" and n.get("data-sec") == sec)
                    for x in s2.find_all(lambda n: n.tag == "pre" and n.has_class("json"))]
        inp = " ".join(s2.text() for s2 in proc.find_all(lambda n: n.tag == "section" and n.get("data-sec") == "input"))
        if m.group(1) in ("POST", "PUT", "PATCH") and not jsons("input") and not re.search(r"multipart|x-www-form-urlencoded|ボディなし", inp):
            rep.warn("JSON", pid, "入力項目の節に、リクエストボディの JSON の例（pre.json）が無い")
        if not jsons("response"):
            rep.warn("JSON", pid, "レスポンスの節に、応答ボディの JSON の例（pre.json）が無い（正常時・異常時の形ごとに置く）")
    # 処理をまたぐ参照（build で解決できたものはリンクになっている）
    ids = {p.get("id") for p in procs}

    def walk(n):
        for ch in n.children:
            if isinstance(ch, Node):
                if ch.tag not in NO_LINK_TAGS:
                    walk(ch)
            elif isinstance(ch, Text):
                for g in GLOBAL_REF_RE.finditer(html.unescape(ch.raw)):
                    if g.group(1) not in ids:
                        rep.err("REF", "", "「%s」：処理 %s が無い" % (g.group(0), g.group(1)))
                    else:
                        rep.err("REF", g.group(1), "「%s」：参照先の行・項目・経路が無い" % g.group(0))
    walk(body)


def _text_without_examples(cell):
    """値の例を除いた文。シナリオの値は処理ごとに違ってよいので、共通のグループの比較に入れない。"""
    out = []

    def walk(x):
        for ch in x.children:
            if isinstance(ch, Text):
                out.append(ch.raw)
            elif isinstance(ch, Node):
                if ch.tag == "table":
                    table(ch)
                else:
                    walk(ch)

    def table(t):
        rows = own_rows(t)
        head = next((r for r in rows if in_thead(r)), None)
        skip = {i for i, c in enumerate(cells(head)) if "例" in c.text()} if head is not None else set()
        for r in rows:
            for i, c in enumerate(cells(r)):
                if i not in skip:
                    walk(c)
                    out.append(" ")
    walk(cell)
    t = html.unescape("".join(out))
    return re.sub(r"（([^（）]*)）", lambda m: "（%s）" % re.sub(r"例\s[^。）]*", "例", m.group(1)), t)


def _norm_row(tr, base):
    """行の文を、No. の違いを除いて比べられる形にする（共通のグループの行が同じかを確かめるため）。"""
    cs = cells(tr)
    if is_group_row(tr):
        names = tr.find_all(lambda n: n.tag == "b")
        return ("グループ", row_depth(cs[1]) - base if len(cs) >= 2 else 0, names[0].text().strip() if names else "")
    d = row_depth(cs[1]) - base if len(cs) >= 2 else 0
    t = re.sub(r"\s+", " ", _text_without_examples(cs[1]) if len(cs) >= 2 else "").strip()
    t = re.sub(r"No\.?\s?\d{2,3}(\.\d+)?", "No.#", t)
    t = re.sub(r"(→\s*)\d{2,3}(?![\d.])", r"\1#", t)
    t = re.sub(r"\b\d{2,3}へ", "#へ", t)
    t = re.sub(r"\b\d{2,3}〜\d{2,3}\b", "#〜#", t)
    return ("〜のとき" if tr.has_class("arm") else "処理", d, t)


CONTROL_LINE = re.compile(
    r"^\s*(?:\}\s*)?(?:(?:async|await)\s+)?"
    r"(?:(?:else|elif|elsif|elseif|if|unless|for|foreach|while|until|do|loop|repeat|try|begin|catch|except|rescue|finally|ensure"
    r"|switch|case|default|when|with|match)\b"
    r"|(?:using|lock|synchronized)\s*\(|select\s*\{)")
BLOCK_END = re.compile(r"(?:[{(\[]|=>|->|\bdo(?:\s*\|[^|]*\|)?)\s*$")
_CONT_HEAD = re.compile(r"^\s*(?:\}\s*)?(?:else|elif|elsif|elseif|except|catch|rescue|finally|ensure|case|default)\b")


def is_block_head(line):
    """中に処理を持つブロックの先頭の行か。if などのキーワードのほか、繰り返し・トランザクション・非同期を引数で書く形
    （items.forEach(x => {、ds.transaction(async (m) => {、await asyncio.gather(）も含める。
    関数の定義やルーターへの登録は、中の行を字下げしない書き方なので含めない。"""
    if CONTROL_LINE.match(line):
        return True
    return bool(BLOCK_END.search(line)) and bool(set(kinds_of(line)) & {"繰返", "TX", "非同期"})


def enclosing_heads(lines, ln):
    """ln の行を囲むブロックの先頭の行番号を、内側から順に返す。ソースの字下げを上へたどって決める。
    except・else の中の行は、対応する try・if の中でもあるので、続けて探す。"""
    out = []
    limit = _src_indent(lines[ln - 1])
    for k in range(ln - 1, 0, -1):
        s = lines[k - 1].strip()
        if not s or s.startswith(("#", "//", "/*", "*")):
            continue
        if re.match(r"[)\]}]", s) and not _CONT_HEAD.match(lines[k - 1]):
            continue
        y = _src_indent(lines[k - 1])
        if y < limit:
            if is_block_head(lines[k - 1]):
                out.append(k)
            limit = y + 1 if _CONT_HEAD.match(lines[k - 1]) else y
            if limit == 0:
                break
    return out


def _src_indent(line):
    t = line.expandtabs(4)
    return len(t) - len(t.lstrip())


def check_nest_src(procs, idx, rep):
    """文書の字下げとソースの構造を突き合わせる。字下げだけで構造を読めることが、この文書の前提なので確かめる。
    - ソースで if・for・try・with などの中にある行が、そのブロックの行より深く字下げされていない（ツリーの外に出ている）
    - ソースでは前の行と同じ深さに戻っているのに、文書で深いまま（枝の中に入っている）
    囲むブロックはソースの字下げから決めるので、同じファイルのヘルパーを先に展開した行があっても見失わない。
    根拠が無い行（設計だけの行など）と、別のファイルへ展開した行と展開元のブロックの関係は対象外。
    ブロックの終わりの行（繰返終端・try終端・待機）は、根拠がブロックの中を指すのが正しいので比べない。
    例外経路の行（E1-01 など）も比べない。例外経路は本体の途中から続く流れを字下げ 0 から書くので、
    ソースでは with・try の中にある行でも字下げ 0 が正しい。
    比べた行数を INFO で示す。比べられなかった行の字下げは目視する。"""
    for proc in procs:
        pid = proc.get("id")
        n_inside = n_block = 0
        for t in steps_tables(proc):
            hist = []
            seen, seen2 = {}, {}  # (ファイル, 行) → その行を主な根拠にした文書の行／ついでに挙げた最初の行（コミットの行が with の行を挙げるなど）
            for kind, _tr, cs, d in table_rows(t):
                if kind != "step" or len(cs) < 3 or set(kinds_in(cs[1])) & CLOSERS:
                    continue
                if cs[0].text().strip().startswith("E"):
                    continue
                cites = parse_citations(cs[-1].text())
                if not cites:
                    continue
                cands = idx.resolve(cites[0][0])
                if len(cands) != 1:
                    continue
                path = cands[0]
                lines = idx.lines(path)
                # 同じファイルの根拠が複数あるときは、一番深い行を使う（定数・関数の定義の行は浅く、実行される行は深い）
                usable = [(_src_indent(lines[x - 1]), x) for f, x, _b in cites if f == cites[0][0] and 1 <= x <= len(lines) and lines[x - 1].strip()]
                if not usable:
                    continue
                ind, ln = max(usable)
                text = lines[ln - 1]
                no = cs[0].text().strip()
                where = "%s No.%s" % (pid, no)
                me = {"path": path, "ln": ln, "ind": ind, "d": d, "no": no, "text": text}
                repeated = any(h["path"] == path and h["ln"] == ln for h in hist)  # 同じ文を分解した行（フレームワークが行う判定と、その結果など）
                if not repeated:
                    heads = enclosing_heads(lines, ln)
                    if heads:
                        n_inside += 1
                    parent = next((seen.get((path, k)) or seen2[(path, k)] for k in heads if (path, k) in seen or (path, k) in seen2), None)
                    if parent is not None:
                        n_block += 1

                    def closed(frm):
                        """frm の行より後、ln より前に ind より浅い行があるか。あればブロックが閉じている。"""
                        for k in range(frm, ln - 1):
                            x = lines[k]
                            if x.strip() and not x.strip().startswith(")") and _src_indent(x) < ind:
                                return True
                        return False

                    sibs = [h for h in hist if h["path"] == path and h["ln"] < ln and h["ind"] == ind and not closed(h["ln"])]
                    sib = max(sibs, key=lambda h: h["ln"]) if sibs else None
                    if parent is not None and d <= parent["d"]:
                        rep.warn("NESTSRC", where, "ソースでは No.%s（%s）の中にある行が、文書で字下げされていない（ツリーの外に出ている）" % (parent["no"], parent["text"].strip()[:40]))
                    elif sib is not None and d > sib["d"] and not re.match(r"\s*(?:\}|\)|else\b|elif\b|except\b|catch\b|finally\b)", text):
                        rep.warn("NESTSRC", where, "ソースでは No.%s と同じ深さの行が、文書で深くなっている（ソースでは枝の外にある。→ NN で進め、分岐と同じ字下げに書く）" % sib["no"])
                hist.append(me)
                seen[(path, ln)] = me
                for f, x, _b in cites:
                    if f == cites[0][0]:
                        seen2.setdefault((path, x), me)
        if n_inside:
            rep.info("NESTSRC", pid, "字下げの照合：ソースのブロックの中の行 %d 行のうち、%d 行をブロックの行と比べた（残りはブロックの行が文書に無く比べていない。別のファイルへ展開した行は、展開元のブロックと比べない。比べていない行は目視する）" % (n_inside, n_block))


def check_groups(procs, rep):
    allh = []
    for proc in procs:
        pid = proc.get("id") or "(id なし)"
        for t in steps_tables(proc):
            sec = t.closest(lambda a: a.tag == "section" and a.get("data-sec"))
            if sec is None or sec.get("data-sec") != "steps":
                continue
            for e in t.elements():
                if e.tag == "tr":
                    rep.err("GROUP", pid, "逐次処理表の行が tbody の外にある（すべての行を一番外側のグループの tbody.grp の中に置く）")
                elif e.tag == "tbody" and not e.has_class("grp") and any(c.tag == "tr" for c in e.elements()):
                    rep.err("GROUP", pid, "逐次処理表にグループに入っていない行がある（すべての行を一番外側のグループの tbody.grp の中に置く）")
        hs = groups_of(proc)
        for h in hs:
            lab = "%s グループ「%s」" % (pid, h["name"][:24])
            if not h["name"]:
                rep.err("GROUP", pid, "グループ（%s）に名前（<b>…</b>）がない" % _rng(h["a"], h["b"]))
            if h["lv"] == 1 and h["scope"] is None:
                rep.warn("GROUP", lab, "一番外側のグループに共通の範囲（span.sc の all・part・own）がない")
            if h["lv"] == 1 and not h["summary"]:
                rep.warn("GROUP", lab, "一番外側のグループに要約（span.gm）がない")
            if h["scope"] in ("all", "part") and not h["key"]:
                rep.err("GROUP", lab, "共通と書いたグループに data-key（同じ処理であることを示す名前）がない")
            steps_in = [r for r in h["rows"] if not is_group_row(r) and not r.has_class("arm")]
            if h["lv"] >= 2 and len(steps_in) == 1 and not any(item_list(cells(r)[1]) is not None for r in steps_in if len(cells(r)) >= 2):
                rep.warn("GROUP", lab, "処理行が 1 行だけの入れ子のグループ（SQL・外部 API のように項目を持つ行を除き、グループにせず行のままにする）")
            # 失敗時と、範囲の中の行の行き先（E 経路）の照合
            inner = set()
            for r in h["rows"]:
                if not is_group_row(r) and len(cells(r)) >= 2:
                    inner.update(x for x in arrow_refs(cells(r)[1]) if x[0] == "E")
            if h["gx"] is not None or h["lv"] == 1:
                listed = set(x for x in arrow_refs(h["gx"]) if x[0] == "E") if h["gx"] is not None else set()
                inner_paths = set(x.split("-")[0] for x in inner)
                miss = sorted(inner_paths - listed)
                extra = sorted(listed - inner_paths)
                if miss:
                    rep.warn("GROUPX", lab, "範囲の中の行から出る経路 %s が、失敗時（span.gx）に書かれていない" % "・".join(miss))
                if extra:
                    rep.warn("GROUPX", lab, "失敗時（span.gx）の経路 %s は、範囲の中の行から出ていない" % "・".join(extra))
            allh.append((proc, h))
    if len(procs) < 2:
        return
    # 共通の範囲：書いたとおりの処理に現れ、行が同じか
    keys = {}
    for proc, h in allh:
        if h["key"] and h["scope"] in ("all", "part"):
            keys.setdefault(h["key"], []).append((proc, h))
    for key, items in keys.items():
        name = items[0][1]["name"]
        pids = [p.get("id") for p, _h in items]
        if any(h["scope"] == "all" for _p, h in items) and set(pids) != set(p.get("id") for p in procs):
            rep.err("GROUPSAME", "「%s」" % name, "全処理共通と書いているが、このグループの無い処理がある（あるのは %s）" % "・".join(pids))
        if len(items) == 1:
            rep.warn("GROUPSAME", "%s「%s」" % (pids[0], name), "一部共通と書いているが、同じ data-key（%s）のグループが他の処理に無い" % key)
            continue
        base = [_norm_row(r, items[0][1]["d"]) for r in items[0][1]["rows"]]
        for p, h in items[1:]:
            cur = [_norm_row(r, h["d"]) for r in h["rows"]]
            if cur == base:
                continue
            k = next((i for i, (x, y) in enumerate(zip(base, cur)) if x != y), min(len(base), len(cur)))
            a = base[k][2][:60] if k < len(base) else "（行なし）"
            b = cur[k][2][:60] if k < len(cur) else "（行なし）"
            rep.err("GROUPSAME", "「%s」" % name, "共通と書いているが %s と %s で行が違う（%d 行目：「%s」と「%s」）。行を同じにするか、グループを分ける" % (pids[0], p.get("id"), k + 1, a, b))
    # 固有と書いたのに、他の処理に同じ行のグループがある
    sig = {}
    for proc, h in allh:
        if h["rows"]:
            sig.setdefault(tuple(_norm_row(r, h["d"]) for r in h["rows"]), []).append((proc, h))
    for items in sig.values():
        pids = {p.get("id") for p, _h in items}
        if len(pids) < 2:
            continue
        for p, h in items:
            if h["scope"] == "own":
                others = "・".join(sorted(pids - {p.get("id")}))
                rep.warn("GROUPOWN", "%s「%s」" % (p.get("id"), h["name"]), "固有と書いているが、%s に同じ行のグループがある（共通と書く）" % others)


def check_doc(text, src_root=None, coverage=False, refs=False, git_base=None, git_head="HEAD"):
    rep = Report()
    root = parse_html(text)
    _prune_deleted(root)
    body = next((n for n in root.iter() if n.tag == "body"), root)

    # 外部資源・スクリプト
    for n in root.iter():
        if n.tag == "link" and "stylesheet" in (n.get("rel") or "") and n.get("href"):
            rep.err("SELF", "", "外部スタイルシートを読み込んでいる（%s）。単一ファイルにする" % n.get("href"))
        if n.tag == "script":
            if n.get("src"):
                rep.err("SELF", "", "外部スクリプトを読み込んでいる（%s）" % n.get("src"))
            else:
                rep.warn("JS", "", "JavaScript を含む。必要な場合に限る")
        if n.tag == "img" and re.match(r"https?:", n.get("src") or ""):
            rep.warn("SELF", "", "外部の画像を参照している（%s）" % n.get("src"))

    procs = procs_of(body)
    if not procs:
        rep.err("STRUCT", "", "section.proc（処理ごとの節）がない")
    if len(procs) >= 2:
        for proc in procs:
            if not (proc.get("data-group") or "").strip() or not (proc.get("data-tab") or "").strip():
                rep.warn("TAB", proc.get("id") or "", "処理が複数ある文書では、section.proc に data-group（関心事の分類名）と data-tab（タブの短い名前）を付ける")
    check_json(body, procs, rep)
    check_groups(procs, rep)
    for proc in procs:
        pid = proc.get("id") or "(id なし)"
        secs = {s.get("data-sec") for s in proc.find_all(lambda n: n.tag == "section" and n.get("data-sec"))}
        for need, label in (("overview", "概要"), ("steps", "逐次処理"), ("response", "レスポンス／処理結果")):
            if need not in secs:
                rep.err("STRUCT", pid, "data-sec=\"%s\"（%s）の節がない" % (need, label))
        rows = step_rows(proc)
        if not rows:
            rep.err("STRUCT", pid, "table.steps の処理行がない")
        steps, paths = collect_targets(proc)
        seen = {}
        for t in steps_tables(proc):
            heads = [r for r in own_rows(t) if in_thead(r)]
            if heads and len(cells(heads[0])) != 3:
                rep.err("STEP", pid, "逐次処理表の列が %d 列（No.・処理内容・根拠の 3 列にする。行き先・結果は処理内容に書く）" % len(cells(heads[0])))
            trs = table_rows(t)
            nondt = [r for r in trs if r[0] != "dt"]
            prev_no = None
            loops = ends = 0
            prev = None
            for kind, tr, cs, d in trs:
                if kind == "dt":
                    rep.warn("DT", pid, "詳細行（tr.dt）は使わず、処理の中の項目（<ol> の 1. 2. …）にする")
                    continue
                if kind == "arm":
                    lab = cs[1].text().strip()[:28] if len(cs) > 1 else ""
                    where = "%s「%s」" % (pid, lab)
                    if len(cs) != 3:
                        rep.err("STEP", where, "「〜のとき」行のセルが %d 個（<td></td><td class=\"iN\">…</td><td></td> の 3 セルにする）" % len(cs))
                    elif not lab:
                        rep.err("ARM", where, "「〜のとき」行が空")
                    else:
                        inline = arm_inline(main_text(cs[1]))
                        if inline:
                            rep.err("ARM", where, "「〜のとき」行の文中に処理を書いている：「%s」（処理は 1 段下の行に書く。字下げだけで構造が読めるようにするため）" % inline[:40])
                else:
                    no = cs[0].text().strip() if cs else ""
                    where = "%s No.%s" % (pid, no or "?")
                    if len(cs) != 3:
                        rep.err("STEP", where, "処理行の列数が %d（No.・処理内容・根拠の 3 列にする）" % len(cs))
                    elif not no.startswith("E") and not set(kinds_in(cs[1])) & (CLOSERS | {"例外"}):
                        inline = inline_condition(main_text(cs[1]))
                        if inline:
                            rep.warn("INLINECOND", where, "処理の行の文中に条件と処理を書いている：「%s」（判定の行と「〜のとき」行に分け、処理は 1 段下の行に書く。補足なら括弧の中に書く）" % inline[:50])
                    if not STEP_NO_RE.match(no):
                        rep.err("STEP", where, "No. の形式が不正（01・001・E1-01・A1-01 の形）")
                    else:
                        if no in seen:
                            rep.err("STEP", where, "No. が重複している")
                        seen[no] = tr
                        _m = re.match(r"(\d+)([a-z]?)", no.split("-")[-1])
                        key = (no.split("-")[0] if "-" in no else "", (int(_m.group(1)), _m.group(2)))
                        if prev_no and key[0] == prev_no[0] and key[1] <= prev_no[1]:
                            rep.err("ORDER", where, "No. が表の中で昇順になっていない（直前 %s）" % prev_no[2])
                        prev_no = (key[0], key[1], no)
                    if len(cs) >= 3 and not cs[-1].text().strip():
                        rep.warn("SRC", where, "根拠（ファイル:行）が空")
                    if len(cs) >= 2:
                        content = cs[1].text()
                        for rx, why in ABSTRACT_RULES:
                            m = rx.search(content)
                            if m:
                                rep.warn("ABSTRACT", where, "%s：「%s」" % (why, m.group(0)))
                        if re.search(r"(を|の)(呼び出す|コールする|委譲する)。?\s*$", main_text(cs[1])) and not EXTERNAL_HINT.search(content):
                            rep.warn("ABSTRACT", where, "「〜を呼び出す」で終わっている。呼び出し先で実行される処理を展開する")
                        ks = kinds_in(cs[1])
                        loops += ks.count("繰返")
                        ends += ks.count("繰返終端")
                # 字下げ（木）の検査
                if len(cs) >= 2 and prev is not None:
                    pk, pd, pks = prev
                    if d > pd + 1:
                        rep.warn("TREE", where, "字下げが 2 段以上深くなっている（直前は %d 段、この行は %d 段）" % (pd, d))
                    elif d == pd + 1 and pk == "step" and not (set(pks) & BLOCK_HEADS):
                        rep.warn("TREE", where, "字下げが深くなっているが、直前の行が分岐・繰返・並列・try などのブロックの先頭の行ではない")
                prev = (kind, d, kinds_in(cs[1]) if len(cs) >= 2 else [])
            if loops != ends:
                rep.warn("LOOP", pid, "表の中で「繰返」%d 件と「繰返終端」%d 件が対応していない" % (loops, ends))
            # 分岐：結果ごとの「〜のとき」行
            for i, (kind, tr, cs, d) in enumerate(nondt):
                if kind != "step" or len(cs) < 2 or "分岐" not in kinds_in(cs[1]):
                    continue
                where = "%s No.%s" % (pid, cs[0].text().strip())
                arms, others = [], []
                for k2, _tr2, cs2, d2 in nondt[i + 1:]:
                    if d2 <= d:
                        break
                    if d2 == d + 1 and len(cs2) >= 2:
                        (arms if k2 == "arm" else others).append(cs2[1])
                if len(arms) < 2:
                    rep.err("ARM", where, "分岐の結果ごとの「〜のとき」行が %d 個（すべての結果について、分岐の 1 段下に「〜のとき」行を置く）" % len(arms))
                if others:
                    rep.err("ARM", where, "分岐の 1 段下に「〜のとき」行以外の行がある（結果ごとの処理は「〜のとき」行の下に、さらに 1 段下げて書く）")
                for c in arms:
                    if "とき" not in main_text(c):
                        rep.err("ARM", where, "分岐の結果の行は「〜のとき」の形で書く：「%s」" % main_text(c)[:30])
            # 「〜のとき」行：親と、処理が無いときの行き先
            for i, (kind, tr, cs, d) in enumerate(nondt):
                if kind != "arm" or len(cs) < 2:
                    continue
                lab = main_text(cs[1])[:28]
                parent = None
                for k2, _tr2, cs2, d2 in reversed(nondt[:i]):
                    if d2 < d:
                        parent = (k2, cs2, d2)
                        break
                if parent is None or parent[2] != d - 1 or parent[0] != "step" or not (set(kinds_in(parent[1][1])) & BLOCK_HEADS):
                    rep.warn("TREE", "%s「%s」" % (pid, lab), "「〜のとき」行の 1 段上に、分岐・try・並列などのブロックの先頭の行がない")
                nxt = nondt[i + 1] if i + 1 < len(nondt) else None
                if nxt is None or nxt[3] <= d:
                    if not arrow_refs(cs[1]) and not re.search(r"終了|応答|return|exit|発生しない|起きない|到達しない", main_text(cs[1])):
                        rep.err("ARM", "%s「%s」" % (pid, lab), "「〜のとき」行の下に処理が無く、行き先（→ NN）も書かれていない（→ の直前が数字・英字・引用符だと値の変化とみなすので、「（例 5012） → 17」のように括弧で区切る）")
        # 項目（1. 2. …）
        for _t, tr, cs in rows:
            if len(cs) >= 2:
                lists = [ol for ol in cs[1].find_all(lambda n: n.tag == "ol")
                         if ol.closest(lambda a: a.tag == "li") is None and ol.closest(lambda a: a.tag == "td") is cs[1]]
                if len(lists) > 1:
                    rep.warn("ITEM", "%s No.%s" % (pid, cs[0].text().strip()), "処理の中の項目の <ol> が %d 個ある（1 つにまとめる。No.NN.k で参照できるのは最初の 1 つだけ）" % len(lists))
        # 参照の解決（build 後はリンク、build 前はテキスト）
        ids = {n.get("id") for n in body.iter() if n.get("id")}
        for a in proc.find_all(lambda n: n.tag == "a"):
            href = (a.get("href") or "")
            if href.startswith("#") and href[1:] not in ids:
                rep.err("REF", pid, "リンク先 %s が存在しない（「%s」）" % (href, a.text().strip()))
        refs_in_proc = proc_text_refs(proc)
        for el, rid in refs_in_proc:
            if rid not in steps and rid not in paths:
                row = steps_row_of(el) if el.tag != "tr" else el
                label = (cells(row)[0].text().strip() or main_text(cells(row)[1])[:20]) if row is not None and len(cells(row)) > 1 else el.text().strip()[:30]
                rep.err("REF", "%s（%s）" % (pid, label), "参照先「%s」がこの処理の中にない" % rid)
        main_sec = [s for s in proc.find_all(lambda n: n.tag == "section" and n.get("data-sec") == "steps")]
        if main_sec:
            mrows = [r for r in rows if r[0].closest(lambda a: a is main_sec[0])]
            if mrows:
                last = mrows[-1][2]
                if not re.search(r"終了|応答|レスポンス|返す|return|exit|終える", " ".join(c.text() for c in last)):
                    rep.warn("END", pid, "逐次処理の最後の行に終了・応答の記述がない（No.%s）" % last[0].text().strip())
        for p_id in paths:
            used = any(rid == p_id or rid.startswith(p_id + "-") for _el, rid in refs_in_proc)
            linked = any((a.get("href") or "").endswith("-" + p_id) or ("-s%s-" % p_id) in (a.get("href") or "")
                         for a in proc.find_all(lambda n: n.tag == "a"))
            if not used and not linked:
                rep.warn("PATH", pid, "経路 %s はどこからも参照されていない" % p_id)
        if refs:
            id_map = {n.get("id"): n for n in body.iter() if n.get("id")}
            for a in proc.find_all(lambda n: n.tag == "a" and (n.get("href") or "").startswith("#")):
                tgt = id_map.get(a.get("href")[1:])
                if tgt is None:
                    continue
                row = steps_row_of(a)
                if row is not None and cells(row):
                    rc = cells(row)
                    src_label = ("No." + rc[0].text().strip()) if rc[0].text().strip() else "「%s」" % main_text(rc[1])[:16] if len(rc) > 1 else ""
                else:
                    sec = a.closest(lambda x: x.tag == "section" and x.get("data-sec"))
                    src_label = "節 %s" % (sec.get("data-sec") if sec is not None else "?")
                if tgt.tag == "tr":
                    tc = cells(tgt)
                    ttext = main_text(tc[1]) if len(tc) > 1 else tgt.text()
                elif tgt.tag == "section":
                    hd = tgt.find_all(lambda x: x.tag in ("h3", "h4"))
                    ttext = hd[0].text().strip() if hd else tgt.get("data-path", "")
                else:
                    part = []
                    for ch in tgt.children:
                        if isinstance(ch, Node) and ch.tag in ("table", "pre", "ol", "ul"):
                            break
                        part.append(serialize_one(ch))
                    ttext = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", "".join(part)))).strip() or re.sub(r"\s+", " ", tgt.text()).strip()
                rep.info("REFMAP", "%s %s" % (pid, src_label), "%s → 「%s」" % (a.text().strip(), ttext[:70]))

    # SQL
    for idx, pre in enumerate(body.find_all(lambda n: n.tag == "pre" and n.has_class("sql")), 1):
        sql = pre.text()
        head = re.sub(r"\s+", " ", sql.strip())[:60]
        where = "SQL#%d「%s」" % (idx, head)
        kind = (pre.get("data-kind") or "").strip()
        if kind not in ("exec", "ref", "design"):
            rep.err("SQLKIND", where, "data-kind=\"exec\"（実行SQL）・\"ref\"（参考SQL）・\"design\"（設計SQL）のどれかを付ける")
        cont = pre.closest(lambda a: a.has_class("db")) or pre.closest(lambda a: a.tag in ("td", "section"))
        if pre.closest(lambda a: a.has_class("db")) is None:
            rep.warn("SQLBOX", where, "SQL を ol.db（処理の中の項目）に入れていない（SQL と対応する表の範囲が分からない）")
        if cont is None:
            continue
        tabs = cont.find_all(lambda n: n.tag == "table")

        def has(cls):
            return [t for t in tabs if t.has_class(cls)]
        verb = sql_verb(sql)
        need = {"SELECT": ["rows", "cnt"], "UPDATE": ["upd", "cnt"], "INSERT": ["ins"], "DELETE": ["del", "cnt"],
                "MERGE": ["ins"]}.get(verb, [])
        names = {"rows": "取得データ表（table.rows）", "cnt": "件数ごとの処理表（table.cnt）", "upd": "更新列の表（table.upd）",
                 "ins": "登録データ表（table.ins）", "del": "削除対象の表（table.del）"}
        for c in need:
            if not has(c):
                rep.err("SQLDATA", where, "%s 文に%sがない" % (verb, names[c]))
        named, positional = placeholders(sql)
        bind = has("bind")
        if (named or positional) and not bind:
            rep.err("SQLBIND", where, "バインド変数の表（table.bind）がない")
        if bind:
            btext = " ".join(t.text() for t in bind)
            miss = [x for x in sorted(named) if x not in btext]
            if miss:
                rep.warn("SQLBIND", where, "バインド変数の表に無い名前: %s" % ", ".join(miss))
            nrows = sum(len([r for r in own_rows(t) if not in_thead(r) and not all(c.tag == "th" for c in cells(r))]) for t in bind)
            if positional and nrows < positional and not named:
                rep.warn("SQLBIND", where, "位置指定のバインド変数 %d 個に対して表の行が %d 行" % (positional, nrows))
        col_checks = []
        if verb == "SELECT" and has("rows"):
            col_checks.append((select_columns(sql), has("rows"), "取得列"))
        if verb == "UPDATE" and has("upd"):
            col_checks.append((update_columns(sql), has("upd"), "更新列"))
        if verb == "INSERT" and has("ins"):
            col_checks.append((insert_columns(sql), has("ins"), "登録列"))
        for cols, ts, label in col_checks:
            if not cols:
                continue
            ttext = " ".join(t.text() for t in ts).lower()
            miss = [c for c in cols if c.lower() not in ttext]
            if miss:
                rep.warn("SQLCOL", where, "%sが表に無い: %s" % (label, ", ".join(miss)))
    for api in body.find_all(lambda n: n.has_class("api")):
        tabs = api.find_all(lambda n: n.tag == "table")
        if not any(t.has_class("req") for t in tabs):
            rep.warn("API", "", "ol.api に送信データの表（table.req）がない（送信データが無い場合は「なし」と書いた表を置く）")
        if not any(t.has_class("cnt") for t in tabs):
            rep.warn("API", "", "ol.api に応答ごとの処理の表（table.cnt）がない")

    # 未確認事項・検証記録
    content_root = next((n for n in body.iter() if n.tag == "main"), body)
    uv_marks = len(content_root.find_all(lambda n: n.has_class("uv")))
    uv_sec = [s for s in body.find_all(lambda n: n.tag == "section" and n.get("data-sec") == "unconfirmed")]
    uv_items = 0
    if not uv_sec:
        rep.err("STRUCT", "", "data-sec=\"unconfirmed\"（未確認事項）の節がない（無い場合も「なし」と書く）")
    else:
        for t in uv_sec[0].find_all(lambda n: n.tag == "table"):
            rs = [r for r in own_rows(t) if not in_thead(r) and not all(c.tag == "th" for c in cells(r))]
            if len(rs) == 1 and re.fullmatch(r"\s*(なし|無し|該当なし|-)\s*", rs[0].text()):
                continue
            uv_items += len(rs)
    if uv_marks and not uv_items:
        rep.err("UV", "", "本文に〔未確認〕が %d 箇所あるのに未確認事項の表が空" % uv_marks)
    vsec = [s for s in body.find_all(lambda n: n.tag == "section" and n.get("data-sec") == "verification")]
    if not vsec:
        rep.err("STRUCT", "", "data-sec=\"verification\"（検証記録）の節がない")
    else:
        vs = vsec[0].find_all(lambda n: n.has_class("vstatus"))
        status = vs[0].get("data-status") if vs else None
        if status not in ("done", "open"):
            rep.err("VERIFY", "", "p.vstatus に data-status=\"done\" か \"open\" を付ける")
        if status == "done" and uv_items:
            rep.err("VERIFY", "", "未確認事項が %d 件あるのに検証状態が完了（done）になっている" % uv_items)
        vt = [t for t in vsec[0].find_all(lambda n: n.tag == "table" and n.has_class("verify"))]
        vtext = " ".join(t.text() for t in vt)
        for v in REQUIRED_VIEWS:
            if v not in vtext:
                rep.warn("VERIFY", "", "検証記録に観点「%s」がない" % v)
        for t in vt:
            for r in own_rows(t):
                cs = cells(r)
                if len(cs) >= 2 and re.search(r"\bNG\b", cs[1].text()):
                    rep.err("VERIFY", "", "検証結果が NG のまま残っている（%s）。直してから出力する" % cs[0].text().strip())
                if len(cs) >= 3 and all(c.tag == "td" for c in cs) and (not cs[1].text().strip() or not cs[2].text().strip()):
                    rep.warn("VERIFY", "", "検証記録の観点「%s」の結果か確認した内容が空（手順 5 でソースと照合して埋める）" % cs[0].text().strip())

    # 根拠の照合
    for proc in procs:
        for _t, _tr, cs in step_rows(proc):
            if len(cs) >= 3:
                for x, y in reversed_ranges(cs[-1].text()):
                    rep.err("SRCRANGE", "%s No.%s" % (proc.get("id"), cs[0].text().strip()), "根拠の行番号の範囲が逆になっている（%d-%d）" % (x, y))
    if src_root:
        idx = SourceIndex(src_root)
        check_nest_src(procs, idx, rep)
        cited = {}
        texts = []
        for proc in procs:
            for _t, _tr, cs in step_rows(proc):
                if len(cs) >= 3:
                    texts.append(("%s No.%s" % (proc.get("id"), cs[0].text().strip()), cs[-1].text()))
        for n in body.iter():
            if n.get("data-src"):
                texts.append(("data-src", n.get("data-src")))
            if n.has_class("src") and n.tag != "td":
                texts.append(("src", n.text()))
        for where, t in texts:
            for f, a, b in parse_citations(t):
                cands = idx.resolve(f)
                if not cands:
                    rep.warn("SRCFILE", where, "根拠のファイル「%s」が %s の下に見つからない" % (f, src_root))
                    continue
                if len(cands) > 1:
                    rep.warn("SRCFILE", where, "根拠のファイル「%s」に該当するファイルが複数ある: %s" % (f, ", ".join(str(c.relative_to(idx.root)) for c in cands[:4])))
                p = cands[0]
                n_lines = len(idx.lines(p))
                if b > n_lines:
                    rep.err("SRCLINE", where, "%s の %d 行目は存在しない（%d 行まで）" % (f, b, n_lines))
                    continue
                cited.setdefault(p, set()).update(range(a, b + 1))
        if coverage:
            for p, lines_cited in sorted(cited.items(), key=lambda x: str(x[0])):
                lines = idx.lines(p)
                fr = function_ranges(p, lines)
                funcs = {}
                for ln in lines_cited:
                    ef = enclosing_function(p, lines, fr, ln)
                    if ef:
                        funcs[(ef[0], ef[1])] = ef[2]
                rel = p.relative_to(idx.root).as_posix()
                not_code = comment_lines(p, lines)
                for (a, b), name in sorted(funcs.items()):
                    for ln in range(a, b + 1):
                        if ln in lines_cited or ln in not_code:
                            continue
                        ks = [k for k in kinds_of(lines[ln - 1]) if k not in ("分岐(else)",)]
                        if not ks:
                            continue
                        rep.info("UNCITED", "%s:%d" % (rel, ln), "〔%s〕%s  （%s 内。根拠欄から参照されていない）" % ("・".join(ks), lines[ln - 1].strip()[:100], name.strip()[:40]))
    if git_base:
        if not src_root:
            rep.err("GIT", "", "--git-base には --src-root が必要です")
        else:
            check_git(body, src_root, git_base, git_head, rep)
    return rep, root


# ---------------------------------------------------------------------------
# サブコマンド
# ---------------------------------------------------------------------------
INIT_FILES = {
    "{i:02d}-{p}-1-overview.html": """<!-- 処理が複数ある文書では data-group（関心事の分類名：タブの上に出る）と data-tab（タブの名前：処理名とメソッド・パス）を書く -->
<section class="proc" id="{p}" data-group="（分類名）" data-tab="（処理名） GET /path">
<h2>{n}. （処理名）</h2>

<section data-sec="overview">
<h3>{n}.1 処理概要</h3>
<table class="kv"><tbody>
<tr><th>文書の種類</th><td>現行の書き起こし／変更設計／新規設計／仕様差分（コードレビュー用）のどれか。基準も書く</td></tr>
<tr><th>対象処理</th><td></td></tr>
<tr><th>種別</th><td>API / バッチ / イベント処理</td></tr>
<tr><th>HTTPメソッド</th><td></td></tr>
<tr><th>エンドポイント</th><td><code></code></td></tr>
<tr><th>入力</th><td></td></tr>
<tr><th>出力</th><td></td></tr>
<tr><th>認証</th><td></td></tr>
<tr><th>トランザクション</th><td></td></tr>
<tr><th>使用テーブル</th><td></td></tr>
<tr><th>外部システム</th><td></td></tr>
<tr><th>起点（根拠）</th><td class="src"></td></tr>
</tbody></table>
</section>

<section data-sec="input">
<h3>{n}.2 入力項目</h3>
<!-- ボディが JSON なら、表の前に例を置く（値はシナリオの値。JSON として正しく書く）：
<pre class="json" data-title="リクエストボディの例（Content-Type: application/json）">{{
  "title": "見積書を送る"
}}</pre> -->
<table class="sub"><thead><tr><th>項目</th><th>受け取り位置</th><th>型</th><th>必須</th><th>検証内容（コード上の条件）</th><th>値の例</th></tr></thead><tbody>
</tbody></table>
</section>
""",
    "{i:02d}-{p}-2-steps.html": """<section data-sec="steps">
<h3>{n}.3 逐次処理</h3>
<table class="steps"><thead><tr><th>No.</th><th>処理内容</th><th>根拠</th></tr></thead>
<!-- すべての行を、一番外側のグループの下に置く。一番外側のグループごとに <tbody class="grp"> を 1 つ作る（No. の範囲は build が書く）。
     一番外側のグループ：下の tr.gt。data-key は同じ処理で共通の短い名前（共通と書くグループでは必須）。span.sc は all（全API共通）・part（一部共通）・own（固有）。
     入れ子のグループ：<tr class="gs" data-key="（任意）" data-to="最後の No."><td></td><td class="iN"><b>名前</b><span class="gm">要約</span><span class="gx">失敗時：<span class="go">400 → E3</span></span></td><td></td></tr>
                      iN は次の処理行と同じ字下げ。階層は入れ子の深さから決まる。
     処理行：<tr><td>01</td><td>処理内容（結果・行き先「→ 05」もここに書く）</td><td>ファイル:行</td></tr>
     字下げ：<td class="i1">（深さ 1）…<td class="i8">。分岐・繰返・try などのブロックの先頭の行の内側を 1 段下げる。
     分岐の結果：先頭の行の 1 段下に <tr class="arm"><td></td><td class="iN">〜のとき<span class="of">（No.NN が成立）</span></td><td></td></tr>、
                 その結果の処理はさらに 1 段下げる。処理が無い結果は「〜のとき … → NN」と行き先を書く。
     try：先頭の行に <span class="k">try</span>、catch・finally は <tr class="arm">…<span class="kw">catch (X e)</span>…</tr>。
     ブロックの終わり：<span class="k">繰返終端</span>・<span class="k">待機</span>・<span class="k">try終端</span> の行（先頭の行の 1 段下）。
     処理の中の項目：処理内容の文の後に <ol><li>…</li></ol>（No.NN.1 で参照）。SQL は <ol class="db">、外部 API は <ol class="api">。 -->
<tbody class="grp">
<tr class="gt" data-key="（短い名前）"><td colspan="3"><b>（グループの名前）</b><span class="sc own">このAPI固有</span><span class="gm">（何をするかを 1 文で）</span><span class="gx">失敗時：<span class="go">（400 → E3）</span></span></td></tr>
</tbody>
</table>
</section>
""",
    "{i:02d}-{p}-3-paths.html": """<section data-sec="exceptions">
<h3>{n}.4 例外発生時の処理</h3>
<!-- 経路ごとに 1 つ。<section data-path="E1"><h4>E1：（どの No. で何が起きたとき）</h4>
     <table class="steps"><thead><tr><th>No.</th><th>処理内容</th><th>根拠</th></tr></thead><tbody>…E1-01…</tbody></table></section> -->
</section>
""",
    "{i:02d}-{p}-5-response.html": """<section data-sec="response">
<h3>{n}.5 レスポンス</h3>
<!-- 正常時のボディの JSON の例：<pre class="json" data-title="正常時のボディ（200 OK）">{{ … }}</pre>
     異常時は形ごとに 1 つ（横に並べる）：<div class="jsons"><div><pre class="json" data-title="異常時のボディ：入力検証の違反（400）">…</pre></div>
     <div><pre class="json" data-title="異常時のボディ：それ以外">…</pre></div></div>。ボディが無い応答は「ボディなし」と書く -->
<table class="sub resp"><caption>正常時（ステータス）</caption><thead><tr><th>項目</th><th>型</th><th>設定する値（例）</th><th>値の取得元</th></tr></thead><tbody>
</tbody></table>
<table class="sub errs"><caption>異常時</caption><thead><tr><th>発生条件（No.）</th><th>ステータス</th><th>応答ボディ</th><th>その時点のデータの状態</th></tr></thead><tbody>
</tbody></table>
</section>

<section data-sec="data">
<h3>{n}.6 データ変更とトランザクション</h3>
<table class="sub"><thead><tr><th>トランザクション</th><th>範囲（No.）</th><th>含まれる操作（No.）</th><th>正常終了時</th><th>例外発生時</th></tr></thead><tbody>
</tbody></table>
</section>
</section>
""",
}
INIT_TAIL = {
    "90-unconfirmed.html": """<section data-sec="unconfirmed">
<h2>未確認事項</h2>
<table class="sub uvlist"><thead><tr><th>ID</th><th>内容</th><th>影響する処理（No.）</th><th>確認方法</th></tr></thead><tbody>
<tr><td colspan="4">なし</td></tr>
</tbody></table>
</section>
""",
    "95-verification.html": """<section data-sec="verification">
<h2>検証記録</h2>
<p class="vstatus" data-status="open">検証状態：未完了</p>
<table class="sub verify"><thead><tr><th>検証観点</th><th>結果</th><th>確認した内容</th></tr></thead><tbody>
""" + "".join("<tr><td>%s</td><td></td><td></td></tr>\n" % v for v in REQUIRED_VIEWS) + """</tbody></table>
</section>
""",
}


INIT_TOC = """<!-- 一覧のタブの中身（処理が 2 つ以上あると、build が処理ごとのタブを作る） -->
<section data-sec="toc">
<h2>文書の構成</h2>
<table class="sub"><thead><tr><th>分類</th><th>No.</th><th>処理</th><th>メソッド・パス</th><th>使用テーブル</th><th>起点（根拠）</th></tr></thead><tbody>
%s</tbody></table>
<h2>グループと処理の対応表</h2>
<div data-group-map></div><!-- build が、グループと処理の対応表に置き換える -->
<!-- 処理に共通する前提（ミドルウェアの順・DB の扱い・テーブル定義など）があればここに書く -->
</section>
"""


def cmd_init(a):
    d = Path(a.workdir)
    d.mkdir(parents=True, exist_ok=True)
    made = []
    if a.procs >= 2 and not (d / "00-toc.html").exists():
        rows = "".join('<tr><td>（分類名）</td><td>%d</td><td><a href="#p%d">（処理名）</a></td><td><code></code></td><td></td><td></td></tr>\n' % (i, i)
                       for i in range(1, a.procs + 1))
        (d / "00-toc.html").write_text(INIT_TOC % rows, encoding="utf-8")
        made.append("00-toc.html")
    for i in range(1, a.procs + 1):
        for name, body in INIT_FILES.items():
            p = d / name.format(i=i, p="p%d" % i)
            if p.exists():
                continue
            p.write_text(body.format(p="p%d" % i, n=i), encoding="utf-8")
            made.append(p.name)
    for name, body in INIT_TAIL.items():
        p = d / name
        if not p.exists():
            p.write_text(body, encoding="utf-8")
            made.append(p.name)
    print("作成: " + (", ".join(made) if made else "（既存のため作成なし）"))
    print("部品はファイル名の順に連結される。build: python ddoc.py build %s -o <出力.html> --title \"…\"" % d)
    return 0


def _collect_parts(paths):
    parts = []
    for s in paths:
        p = Path(s)
        if p.is_dir():
            parts.extend(sorted(x for x in p.iterdir() if x.suffix.lower() in (".html", ".htm") and x.is_file()))
        elif p.is_file():
            parts.append(p)
        else:
            raise FileNotFoundError(s)
    return parts


def cmd_build(a):
    try:
        parts = _collect_parts(a.parts)
    except FileNotFoundError as e:
        print("部品が見つかりません: %s" % e, file=sys.stderr)
        return 2
    if not parts:
        print("部品がありません", file=sys.stderr)
        return 2
    body = read_parts_text(parts)
    rep = Report()
    vd = versions_dir(a.parts, a.versions)
    vers = load_versions(vd)
    if re.search(r"<(ins|del)[\s>]", body):
        rep.warn("CHANGE", "", "部品に ins・del を書かない（変更の印は build が版と比べて自動で付ける）")
    root = parse_html(body)
    procs_deleted, draft, marked = [], False, False
    if vers:
        draft = _spec_text(vers[-1]["text"]) != _spec_text(body)
        seq = [v["text"] for v in vers]
        base_text = seq[0]
        prev_text = seq[-1] if draft else (seq[-2] if len(seq) >= 2 else seq[0])
        if len(seq) >= 2 or draft:
            base_root = parse_html(base_text)
            prev_root = base_root if prev_text == base_text else parse_html(prev_text)
            procs_deleted = annotate(root, base_root, prev_root)
            marked = True
    root = transform(root, rep)
    extras = []
    n_versions = len(vers) + (1 if draft else 0)
    if vers:
        extras.append(("変更履歴", "doc-history", history_html(root, vers, body, draft)))
    extras.append(("見方", "doc-guide", guide_html(bool(vers))))
    control = change_control(n_versions, n_versions, a.only_changes) if marked else ""
    tabs = None if a.no_tabs else make_tabs(root, extras, control)
    if not tabs:
        for lab, pid, frag in extras:
            d = Node("div", [("id", pid)], root)
            d.children = parse_html(frag).children
            for c in d.children:
                c.parent = d
            root.children.append(d)
    tpl = TEMPLATE.read_text(encoding="utf-8")
    meta = " ／ ".join(html.escape(m) for m in (a.meta or []))
    if vers:
        tag = "版 v%d" % n_versions + ("（作業中）" if draft else "")
        meta = (tag + " ／ " + meta) if meta else tag
    body_html = serialize(root)
    if tabs:
        nav, css = tabs
        body_html = nav + "\n" + body_html
        tpl = tpl.replace("</style>", "/* 処理ごとのタブ（build が生成） */\n" + css + "</style>", 1).replace("<body>", '<body class="tabs">', 1)
    if GROUP_CSS:
        tpl = tpl.replace("</style>", "/* 処理のグループの開閉（build が生成） */\n@media screen {\n" + ",\n".join(GROUP_CSS) + " { display: none; }\n}\n</style>", 1)
    out_html = tpl.replace("{{TITLE}}", html.escape(a.title)).replace("{{META}}", meta).replace("{{BODY}}", body_html)
    out = Path(a.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(out_html, encoding="utf-8", newline="\n")
    print("出力: %s（部品 %d 個: %s）" % (out, len(parts), ", ".join(p.name for p in parts)))
    if vers:
        print("版: v%d%s。変更の印：%s" % (n_versions, "（作業中：部品が最後の版と違う）" if draft else "", "あり（基準 v1）" if marked else "なし（基準の版だけ）"))
    if a.no_check:
        rep.dump()
        return 1 if rep.count("ERROR") else 0
    rep2, _ = check_doc(out_html, a.src_root, coverage=False)
    rep.items.extend(rep2.items)
    rep.dump()
    return 1 if rep.count("ERROR") else 0


def cmd_check(a):
    text = Path(a.html).read_text(encoding="utf-8-sig")
    rep, _ = check_doc(text, a.src_root, coverage=a.coverage, refs=a.refs, git_base=a.git_base, git_head=a.git_head)
    if a.json:
        print(json.dumps(rep.items, ensure_ascii=False, indent=1))
    else:
        rep.dump(max_info=a.max_info)
    return 1 if rep.count("ERROR") else 0


def cmd_outline(a):
    """処理のグループだけを、入れ子どおりに書き出す（グループだけで処理の筋が通るかを読むため）。"""
    root = parse_html(Path(a.html).read_text(encoding="utf-8-sig"))
    body = next((n for n in root.iter() if n.tag == "body"), root)
    for proc in procs_of(body):
        print("[%s] %s" % (proc.get("id"), _tab_label(proc)))
        hs = groups_of(proc)
        for h in hs:
            parts = ["  " * h["lv"] + h["name"]]
            if h["label"]:
                parts.append("〔%s〕" % h["label"])
            parts.append(" %s" % _rng(h["a"], h["b"]))
            if h["summary"]:
                parts.append(" ： %s" % h["summary"])
            if h["gx"] is not None:
                parts.append(" ／ %s" % re.sub(r"\s+", " ", _live_text(h["gx"])).strip())
            print("".join(parts))
        if not hs:
            print("  （グループがない）")
    return 0


def cmd_inventory(a):
    root = Path(a.src_root).resolve() if a.src_root else None
    files = []
    for s in a.paths:
        p = Path(s)
        if p.is_dir():
            files.extend(sorted(x for x in list_source_files(p) if x.suffix.lower() in SRC_EXTS))
        elif p.is_file():
            files.append(p)
        else:
            print("見つかりません: %s" % s, file=sys.stderr)
            return 2
    total = 0
    for p in files:
        lines = read_lines(p)
        fr = function_ranges(p, lines)
        rel = p.resolve().relative_to(root).as_posix() if root and str(p.resolve()).startswith(str(root)) else p.as_posix()
        not_code = comment_lines(p, lines)
        hits = [(i + 1, kinds_of(s), s) for i, s in enumerate(lines) if i + 1 not in not_code]
        hits = [h for h in hits if h[1]]
        if not hits:
            continue
        print("== %s（%d 行）" % (rel, len(lines)))
        cur = None
        for ln, ks, s in hits:
            ef = enclosing_function(p, lines, fr, ln)
            label = ("[%s %d-%d]" % (ef[2].strip()[:70], ef[0], ef[1])) if ef else "[関数外]"
            if label != cur:
                print("  " + label)
                cur = label
            print("    %5d  %-10s %s" % (ln, "・".join(ks), s.strip()[:110]))
            total += 1
    print("---- 注目行 %d 件（分岐・繰返・例外・捕捉・戻り・SQL・DB・TX・外部・非同期）" % total)
    return 0


MEASURE_JS = r"""
(function(){
 function sel(el){var parts=[],e=el,d=0;while(e&&e.nodeType===1&&e!==document.body&&d<5){var s=e.tagName.toLowerCase();
  if(e.id){parts.unshift(s+'#'+e.id);break;} if(e.classList.length)s+='.'+Array.from(e.classList).join('.');
  var p=e.parentElement; if(p){var sib=Array.from(p.children).filter(function(c){return c.tagName===e.tagName;}); if(sib.length>1)s+=':nth-of-type('+(sib.indexOf(e)+1)+')';}
  parts.unshift(s); e=p; d++;} return parts.join(' > ');}
 function run(){
  var de=document.documentElement, vw=de.clientWidth;
  var r={viewport:vw, scrollWidth:Math.max(de.scrollWidth, document.body.scrollWidth), height:de.scrollHeight, overflow:[], offscreen:[], fonts:{}, pads:null, h2:null, decorated:0, focus:[]};
  var all=document.body.querySelectorAll('*');
  for(var i=0;i<all.length;i++){var el=all[i]; var cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden')continue;
   var b=el.getBoundingClientRect();
   if(b.width>0&&b.right>vw+1&&r.offscreen.length<30){r.offscreen.push({sel:sel(el),right:Math.round(b.right),width:Math.round(b.width),text:(el.textContent||'').trim().slice(0,50)});}
   if(/^(PRE|TD|TH|TABLE|DIV|P|CODE|SECTION|LI|MAIN|SPAN)$/.test(el.tagName)&&cs.overflowX==='visible'&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+2&&r.overflow.length<30){
     r.overflow.push({sel:sel(el),scroll:el.scrollWidth,client:el.clientWidth,text:(el.textContent||'').trim().slice(0,50)});}
   if(el.tagName!=='INPUT'&&((cs.boxShadow&&cs.boxShadow!=='none')||parseFloat(cs.borderTopLeftRadius)>4))r.decorated++;
  }
  function fs(q){var e=document.querySelector(q);return e?parseFloat(getComputedStyle(e).fontSize):null;}
  r.fonts={body:fs('body'),td:fs('td'),th:fs('th'),pre:fs('pre'),h1:fs('h1'),h2:fs('h2')};
  var mn=99,ms='',tx=document.querySelectorAll('td,th,p,li,pre,code,span,div,caption,a,b');
  for(var j=0;j<tx.length;j++){var t=tx[j]; var own=Array.from(t.childNodes).some(function(c){return c.nodeType===3&&c.textContent.trim();}); if(!own)continue;
   var f=parseFloat(getComputedStyle(t).fontSize); if(f<mn){mn=f;ms=sel(t);}}
  r.fonts.min=mn; r.fonts.minSel=ms;
  var td=document.querySelector('table.steps td')||document.querySelector('td'); if(td){var c=getComputedStyle(td); r.pads={top:parseFloat(c.paddingTop),right:parseFloat(c.paddingRight),bottom:parseFloat(c.paddingBottom),left:parseFloat(c.paddingLeft)};}
  var h2=document.querySelector('h2'); if(h2){var c2=getComputedStyle(h2); r.h2={top:parseFloat(c2.marginTop),bottom:parseFloat(c2.marginBottom)};}
  (window.__DDOC_FOCUS||[]).forEach(function(q){var e=null;try{e=document.querySelector(q);}catch(x){} r.focus.push({q:q,top:e?Math.round(e.getBoundingClientRect().top+window.scrollY):null});});
  var o=document.createElement('pre'); o.id='__ddoc_m'; o.style.display='none'; o.textContent=JSON.stringify(r); document.body.appendChild(o);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run); else run();
})();
"""


def find_browser(explicit=None):
    cands = []
    for c in (explicit, os.environ.get("DDOC_BROWSER"), os.environ.get("CHROME_PATH")):
        if c:
            cands.append(c)
    if sys.platform.startswith("win"):
        for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
            if base:
                cands += [os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
                          os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
                          os.path.join(base, "Chromium", "Application", "chrome.exe")]
    elif sys.platform == "darwin":
        cands += ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
                  "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "msedge", "chrome"):
        p = shutil.which(name)
        if p:
            cands.append(p)
    for base in (Path.home() / ".cache" / "ms-playwright", Path(os.environ.get("LOCALAPPDATA", "~")) / "ms-playwright",
                 Path.home() / "Library" / "Caches" / "ms-playwright"):
        if base.is_dir():
            for d in sorted(base.glob("chromium*"), reverse=True):
                for rel in ("chrome-linux/chrome", "chrome-linux64/chrome", "chrome-win/chrome.exe", "chrome-win64/chrome.exe",
                            "chrome-mac/Chromium.app/Contents/MacOS/Chromium"):
                    if (d / rel).exists():
                        cands.append(str(d / rel))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def _chrome(browser, url, width, height, mode, out=None, timeout=120):
    prof = tempfile.mkdtemp(prefix="ddoc-prof-")
    args = [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio", "--user-data-dir=" + prof,
            "--window-size=%d,%d" % (width, height)]
    if sys.platform.startswith("linux") and hasattr(os, "geteuid") and os.geteuid() == 0:
        args.append("--no-sandbox")
    if mode == "dom":
        args += ["--virtual-time-budget=3000", "--dump-dom", url]
    elif mode == "shot":
        args += ["--virtual-time-budget=2000", "--screenshot=" + str(out), url]
    elif mode == "pdf":
        args += ["--no-pdf-header-footer", "--print-to-pdf=" + str(out), url]
    try:
        r = subprocess.run(args, capture_output=True, timeout=timeout)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    return r


def _variant(src_html, base_dir, extra_head="", extra_body="", print_mode=False):
    h = src_html
    if print_mode:
        h = re.sub(r"@media\s+print", "@media all", h)
    base = '<base href="%s/">' % Path(base_dir).resolve().as_uri()
    inject_head = base + extra_head
    if re.search(r"<head[^>]*>", h, re.I):
        h = re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + inject_head, h, count=1, flags=re.I)
    else:
        h = inject_head + h
    if re.search(r"</body>", h, re.I):
        idx = [m.start() for m in re.finditer(r"</body>", h, re.I)][-1]
        h = h[:idx] + extra_body + h[idx:]
    else:
        h = h + extra_body
    return h


SHOW_ALL_PANELS = "<style>body.tabs .panel{display:block!important}</style>"


def _tab_style(tab):
    """スクリーンショット用：タブのある文書で、指定したタブだけ（省略時はすべてのパネル）を表示する。"""
    if not tab:
        return SHOW_ALL_PANELS
    return ("<style>body.tabs .panel{display:none!important}body.tabs #%s{display:block!important}"
            "body.tabs nav.tabs a.tab{background:var(--th)!important;font-weight:400!important;border-color:var(--line)!important;top:0!important}"
            "body.tabs nav.tabs a.tab[href=\"#%s\"]{background:#fff!important;border-color:#555!important;font-weight:700!important;top:1px!important}</style>" % (tab, tab))


def _level_js(level):
    """スクリーンショット用：表示レベルを切り替える（1＝一番外側のグループだけ、2＝2 階層目まで…）。"""
    return "<script>document.querySelectorAll('.gv%s').forEach(function(i){i.checked=true;});</script>" % level if level else ""


def _measure(browser, src_html, base_dir, width, tmpdir, focus, print_mode=False, panels=SHOW_ALL_PANELS, level=None):
    js = _level_js(level) + "<script>window.__DDOC_FOCUS=%s;%s</script>" % (json.dumps(focus or []), MEASURE_JS)
    p = Path(tmpdir) / ("m%d%s%s.html" % (width, "p" if print_mode else "", "t" if panels != SHOW_ALL_PANELS else ""))
    p.write_text(_variant(src_html, base_dir, extra_head=panels, extra_body=js, print_mode=print_mode), encoding="utf-8")
    r = _chrome(browser, p.resolve().as_uri(), width, 900, "dom")
    out = r.stdout.decode("utf-8", errors="replace")
    m = re.search(r'<pre id="__ddoc_m"[^>]*>(.*?)</pre>', out, re.S)
    if not m:
        raise RuntimeError("ブラウザから計測結果を得られませんでした（%s）" % r.stderr.decode("utf-8", "replace")[-300:])
    return json.loads(html.unescape(m.group(1)))


def cmd_render(a):
    browser = find_browser(a.browser)
    if not browser:
        print("Chrome / Edge / Chromium が見つかりません。--browser か環境変数 DDOC_BROWSER で指定してください。", file=sys.stderr)
        return 3
    src = Path(a.html)
    src_html = src.read_text(encoding="utf-8-sig")
    base_dir = src.resolve().parent
    widths = [int(w) for w in a.widths.split(",") if w.strip()]
    tmp = tempfile.mkdtemp(prefix="ddoc-render-")
    results, problems, warns = [], [], []
    try:
        targets = [(w, False) for w in widths]
        if not a.no_print:
            targets.append((a.print_width, True))
        for w, pm in targets:
            m = _measure(browser, src_html, base_dir, w, tmp, a.focus, print_mode=pm)
            label = ("印刷相当 %dpx" % w) if pm else ("%dpx" % w)
            m["label"] = label
            results.append(m)
            if m["scrollWidth"] > m["viewport"] + 2:
                problems.append("%s：横スクロールが発生（ページ幅 %d > 表示幅 %d）" % (label, m["scrollWidth"], m["viewport"]))
            for o in m["overflow"]:
                problems.append("%s：要素の中身がはみ出している %s（%d > %d）「%s」" % (label, o["sel"], o["scroll"], o["client"], o["text"]))
            for o in m["offscreen"][:10]:
                problems.append("%s：表示幅の外にはみ出した要素 %s（右端 %d）「%s」" % (label, o["sel"], o["right"], o["text"]))
            if not pm:
                f = m["fonts"]
                if f.get("body") and not (12 <= f["body"] <= 14):
                    warns.append("%s：本文の文字サイズが %spx（12〜14px が目安）" % (label, f["body"]))
                if f.get("min") is not None and f["min"] < 10.5:
                    warns.append("%s：最小の文字サイズが %spx（%s）" % (label, f["min"], f.get("minSel")))
                pd = m.get("pads")
                if pd and not (2 <= pd["left"] <= 8 and 2 <= pd["top"] <= 8):
                    warns.append("%s：表のセル余白が 上%spx 左%spx（4〜8px 程度が目安）" % (label, pd["top"], pd["left"]))
                h2 = m.get("h2")
                if h2 and h2["top"] > 20:
                    warns.append("%s：h2 の上余白が %spx と大きい" % (label, h2["top"]))
                if m.get("decorated"):
                    warns.append("%s：影・大きな角丸の装飾が %d 要素にある" % (label, m["decorated"]))
        shots, ranges = [], []
        if a.shots:
            sd = Path(a.shots)
            sd.mkdir(parents=True, exist_ok=True)
            for w, pm in targets:
                if pm:
                    continue
                m = next(x for x in results if x["label"] == "%dpx" % w)
                if a.tab or a.level:  # 1 つのタブ・表示レベルで表示したときの高さ・位置で撮る
                    m = _measure(browser, src_html, base_dir, w, tmp, a.focus, panels=_tab_style(a.tab), level=a.level)
                tops = [i * a.seg for i in range(max(1, min(a.parts, (m["height"] + a.seg - 1) // a.seg)))]
                ranges.append({"width": w, "screens": len(tops), "need": (m["height"] + a.seg - 1) // a.seg, "height": m["height"], "seg": a.seg})
                for f in m.get("focus") or []:
                    if f["top"] is not None:
                        tops.append(max(0, f["top"] - 40))
                for k, top in enumerate(tops, 1):
                    style = _tab_style(a.tab) + ("<style>html,body{overflow:hidden!important}body{position:relative!important;top:-%dpx!important}"
                                                 "nav.tabs{position:static!important}</style>" % top)
                    vp = Path(tmp) / ("s%d_%d.html" % (w, k))
                    vp.write_text(_variant(src_html, base_dir, extra_head=style, extra_body=_level_js(a.level)), encoding="utf-8")
                    outp = sd / ("w%d-%02d.png" % (w, k))
                    _chrome(browser, vp.resolve().as_uri(), w, a.seg, "shot", out=outp.resolve())
                    if outp.exists():
                        shots.append(str(outp))
        if a.pdf:
            pdfp = Path(a.pdf).resolve()
            vp = Path(tmp) / "pdf.html"
            vp.write_text(_variant(src_html, base_dir), encoding="utf-8")
            _chrome(browser, vp.resolve().as_uri(), 1280, 900, "pdf", out=pdfp)
            if pdfp.exists():
                shots.append(str(pdfp))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if a.json:
        print(json.dumps({"browser": browser, "results": results, "problems": problems, "warnings": warns, "files": shots, "ranges": ranges}, ensure_ascii=False, indent=1))
    else:
        print("ブラウザ: %s" % browser)
        for m in results:
            f = m["fonts"]
            print("[%s] 表示幅 %d / ページ幅 %d / 高さ %d / 文字 本文%s 表%s SQL%s 最小%s / セル余白 %s / 装飾 %d" % (
                m["label"], m["viewport"], m["scrollWidth"], m["height"], f.get("body"), f.get("td"), f.get("pre"), f.get("min"),
                ("%s×%s" % (m["pads"]["top"], m["pads"]["left"])) if m.get("pads") else "-", m.get("decorated", 0)))
        for p in problems:
            print("ERROR " + p)
        for w in warns:
            print("WARN  " + w)
        if shots:
            print("出力: " + ", ".join(shots))
        for r in ranges:
            if r["screens"] < r["need"]:
                print("撮影範囲: %dpx は上から %d 画面だけ（高さ %dpx のうち %dpx）。残りを見るには --parts %d（全体）か --focus \"#p1-s22\"（その行の位置）" % (
                    r["width"], r["screens"], r["height"], r["screens"] * r["seg"], r["need"]))
        print("---- 問題 %d 件 / 警告 %d 件" % (len(problems), len(warns)))
    return 1 if problems else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="ddoc.py", description="逐次処理の詳細設計書（HTML）の組み立て・検査")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init", help="部品ファイルの雛形を作る")
    p.add_argument("workdir")
    p.add_argument("--procs", type=int, default=1)
    p = sub.add_parser("build", help="部品を連結して HTML を作り、検査する")
    p.add_argument("parts", nargs="+")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--meta", action="append")
    p.add_argument("--src-root")
    p.add_argument("--no-check", action="store_true")
    p.add_argument("--no-tabs", action="store_true", help="タブにせず、すべてを縦に並べる")
    p.add_argument("--versions", help="版のディレクトリ（省略時は部品のディレクトリの隣の versions）")
    p.add_argument("--only-changes", action="store_true", help="「変更のある行だけ表示」を最初から有効にする。既定は無効（行が隠れていることに気づけないため、利用者が頼んだときだけ使う）")
    p = sub.add_parser("check", help="HTML を検査する")
    p.add_argument("html")
    p.add_argument("--src-root")
    p.add_argument("--coverage", action="store_true", help="根拠で参照した関数の中で、根拠から参照されていない注目行を列挙する")
    p.add_argument("--refs", action="store_true", help="処理番号への参照（No.29.3 など）を、参照先の文と並べて一覧にする（整合の確認用）")
    p.add_argument("--git-base", help="このコミットからの git の差分と、文書の変更を突き合わせる（--src-root が必要）")
    p.add_argument("--git-head", default="HEAD", help="--git-base の比較先（省略時は HEAD）")
    p.add_argument("--json", action="store_true")
    p.add_argument("--max-info", type=int, default=600)
    p = sub.add_parser("rev", help="今の部品を新しい版として保存する")
    p.add_argument("parts")
    p.add_argument("--kind", required=True, help="きっかけ（基準・指示・補完・指示＋補完・コミットなど）")
    p.add_argument("--note", required=True, help="内容（利用者の指示の文、コミットの件名など）")
    p.add_argument("--commit", help="コードレビュー用：この版が対応するコミット")
    p.add_argument("--date")
    p.add_argument("--versions")
    p = sub.add_parser("gitscope", help="git の差分から、変更された行とそれを含む関数を一覧にする")
    p.add_argument("base")
    p.add_argument("head", nargs="?", default="HEAD")
    p.add_argument("--repo", default=".")
    p = sub.add_parser("outline", help="処理のグループだけを入れ子どおりに書き出す")
    p.add_argument("html")
    p = sub.add_parser("inventory", help="ソースの注目行（分岐・繰返・例外・SQL など）を関数ごとに列挙する")
    p.add_argument("paths", nargs="+")
    p.add_argument("--src-root")
    p = sub.add_parser("render", help="ヘッドレスブラウザで表示を検査し、スクリーンショットを撮る")
    p.add_argument("html")
    p.add_argument("--widths", default="1280,1600")
    p.add_argument("--print-width", type=int, default=1054, help="印刷相当の幅（A4 横・余白 9mm で約 1054px）")
    p.add_argument("--no-print", action="store_true")
    p.add_argument("--shots")
    p.add_argument("--parts", type=int, default=2, help="幅ごとに撮る画面数（上から順に）")
    p.add_argument("--seg", type=int, default=1300, help="1 枚の高さ（px）")
    p.add_argument("--focus", action="append", help="この CSS セレクタの位置も撮る（複数可）")
    p.add_argument("--tab", help="タブのある文書で、この id のパネル（p2・doc-toc・doc-check など）だけを表示して撮る。省略時はすべてのパネルを縦に並べて撮る")
    p.add_argument("--level", type=int, choices=[1, 2, 3, 4], help="表示レベルを切り替えて撮る（1＝一番外側のグループだけ、2＝2 階層目まで…）")
    p.add_argument("--pdf")
    p.add_argument("--browser")
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    return {"init": cmd_init, "build": cmd_build, "check": cmd_check, "rev": cmd_rev, "gitscope": cmd_gitscope, "outline": cmd_outline, "inventory": cmd_inventory, "render": cmd_render}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
