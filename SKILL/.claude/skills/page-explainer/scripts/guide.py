#!/usr/bin/env python3
"""page-explainer の道具。

ページを解説する案内のデータ（JSON）を検査し、HTML に埋め込み、外し、取り出し、読み物の文章に直す。

  python guide.py validate GUIDE.json|PAGE.html
  python guide.py inject PAGE.html --guide GUIDE.json [--out OUT.html]
  python guide.py remove PAGE.html [--out OUT.html]
  python guide.py extract PAGE.html [--out GUIDE.json]
  python guide.py text GUIDE.json|PAGE.html [--out GUIDE.txt]

start_url がある案内（ライブの案内）は、URL のページを scripts/live-tour.mjs で開いて解説するための台本なので、
validate と text だけに使う。HTML には埋め込まない。

inject は、案内を </body> の直前に、始まりと終わりの印（HTML のコメント）で囲んで入れる。
印の外側のバイトは 1 バイトも変えないので、remove で外すと、付ける前のファイルと同じになる。
もう案内が付いているファイルに inject すると、前の案内を新しい案内に置き換える。

終了コード: 0 成功 / 1 直すべき問題がある / 2 使い方の誤り・ファイルを読めない
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"
SCHEMA = "page-explainer/1"
DATA_ID = "page-explainer-data"
BEGIN = b"<!-- page-explainer:begin"
END = b"<!-- page-explainer:end -->"
# スキルの古い名前（html-operation-guide）で付けた案内も、取り出し・外し・付け直しができるようにする
OLD_SCHEMA = "html-operation-guide/1"
MARKERS = [(BEGIN, END), (b"<!-- html-operation-guide:begin", b"<!-- html-operation-guide:end -->")]
DATA_IDS = [DATA_ID, "html-operation-guide-data"]

BLOCK_TYPES = ("summary", "premise", "term", "text", "example", "cause", "do", "note")
BLOCK_KEYS = {
    "summary": {"type", "text"}, "premise": {"type", "text"}, "term": {"type", "term", "text"},
    "text": {"type", "text"}, "example": {"type", "text"}, "cause": {"type", "title", "steps"},
    "do": {"type", "action", "result"}, "note": {"type", "text"},
}
TOP_KEYS = {"schema", "id", "title", "summary", "reader", "style", "start", "launcher", "chapters", "steps", "start_url"}
STEP_KEYS = {"id", "title", "chapter", "target", "targetAll", "placement", "reveal", "missing", "levels",
             "interactive", "url", "actions"}

# ライブの案内の操作（actions）。どれも、手順を出す前に live-tour.mjs が Playwright で行う
ACTION_KINDS = {
    # 操作: (target が要るか, 読み手に見せる文 say が要るか, ほかに要る項目)
    "click": ("must", True, ()), "fill": ("must", True, ("value",)), "select": ("must", True, ("value",)),
    "check": ("must", True, ()), "uncheck": ("must", True, ()), "press": ("may", True, ("key",)),
    "goto": ("no", True, ("url",)), "hover": ("must", False, ()), "scroll": ("must", False, ()),
    "wait": ("may", False, ()),
}
ACTION_KEYS = {"do", "target", "value", "key", "url", "say", "text", "ms", "timeout", "allow_change"}
# データを送る・変える操作に使われる言葉（live-tour.mjs の歯止めと同じ考え）
CHANGE_RE = re.compile(r"送信|保存|削除|購入|登録|申し込|申込|確定|支払|決済|注文|送る|投稿|発行|承認|却下|差し戻|取り消|解約|退会|"
                       r"submit|save|delete|remove|buy|purchase|order|checkout|pay|send|post|publish|confirm|approve|reject", re.I)
PASSWORD_RE = re.compile(r"password|passwd|パスワード|暗証", re.I)
LEVEL_KEYS = {"added", "blocks"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

# 具体的な意味が分からない形容（利用者の決まり）。「」『』`` の中（画面の文字の引用）は数えない
VAGUE_ERR = ["柔軟", "高度", "効率", "最適", "シームレス", "直感的", "スムーズ"]
VAGUE_WARN = ["簡単", "手軽", "便利", "強力", "スマート", "適切", "適宜", "うまく", "しっかり", "きちんと",
              "さまざま", "様々", "いろいろ", "色々", "各種", "豊富", "快適"]
# 対象や動作があいまいになりやすい比喩の動詞（CLAUDE.md の決まり）
METAPHOR_WARN = ["叩く", "叩い", "叩け", "走らせ", "回す", "回して", "噛ませ", "刺さ", "効く", "効い", "拾う", "拾っ", "倒す", "倒し"]
ENABLE_RE = re.compile(r"(によって|により|ことで|おかげで|を使えば|を使うと)[^。！？]*?(可能|できる|できます|実現)")
DECLARE_RE = re.compile(r"(説明する|説明します|紹介する|紹介します|解説する|解説します|見ていく|見ていきます|について述べ)")
POLITE_END = re.compile(r"(です|ます|ません|でした|ました|ましょう|ください)$")
QUOTE_RE = re.compile(r"「[^「」]*」|『[^『』]*』|`[^`]*`")
SENT_SPLIT = re.compile(r"[。！？!?]+")
LIST_RE = re.compile(r"(?:[^、。・\s「」]{1,14}[、・]){3,}[^、。・\s「」]{1,14}")
TERMISH = re.compile(r"[ァ-ヶーA-Za-z]")
GENERIC_SELECTORS = {"*", "div", "span", "p", "section", "li", "a", "button", "input", "td", "tr", "table", "img", "svg"}


class Problem(Exception):
    """直すべき問題（終了コード 1）。"""


class Usage(Exception):
    """使い方の誤り・ファイルを読めない（終了コード 2）。"""


# ---------------------------------------------------------------- 文の道具

def unquoted(text: str) -> str:
    return QUOTE_RE.sub("", text or "")


def sentences(text: str) -> list[str]:
    return [s for s in (p.strip() for p in SENT_SPLIT.split(unquoted(text))) if s]


def raw_sentences(text: str) -> list[str]:
    """引用を消さずに、。で区切った文（文体の判定用）。"""
    out, buf, depth = [], "", 0
    for ch in text or "":
        buf += ch
        if ch in "「『":
            depth += 1
        elif ch in "」』" and depth:
            depth -= 1
        elif ch in "。！？!?" and depth == 0:
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out


def block_texts(b: dict) -> list[tuple[str, str]]:
    """ブロックの中の文字を (部分の名前, 文字) で返す。"""
    t = b.get("type")
    if t == "cause":
        out = [("title", b.get("title") or "")] if b.get("title") else []
        return out + [(f"steps[{k}]", s) for k, s in enumerate(b.get("steps") or []) if isinstance(s, str)]
    if t == "do":
        return [("action", b.get("action") or ""), ("result", b.get("result") or "")]
    if t == "term":
        return [("text", b.get("text") or "")]
    return [("text", b.get("text") or "")]


def count_sentences(level: dict) -> int:
    n = 0
    for b in level.get("blocks") or []:
        if not isinstance(b, dict):
            continue
        for _, s in block_texts(b):
            if s:
                n += max(1, len(sentences(s)))
    return n


def count_chars(level: dict) -> int:
    return sum(len(s) for b in (level.get("blocks") or []) if isinstance(b, dict) for _, s in block_texts(b))


# ---------------------------------------------------------------- 検査

class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.capped: dict[str, int] = {}

    def err(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}" if where else msg)

    def warn(self, where: str, msg: str, cap: str | None = None, limit: int = 12) -> None:
        if cap:
            self.capped[cap] = self.capped.get(cap, 0) + 1
            if self.capped[cap] > limit:
                return
        self.warnings.append(f"{where}: {msg}" if where else msg)

    def finish(self) -> None:
        names = {"subject": "主語の確認", "vague": "あいまいな言葉", "style": "文体", "list": "言葉の並べ方", "enable": "「〜によって〜できる」"}
        for k, n in self.capped.items():
            if n > 12:
                self.warnings.append(f"（{names.get(k, k)}の注意は、ほかに {n - 12} 件ある。上の例と同じ箇所を、全体で探して直す）")


def check_target(rep: Report, where: str, t, name: str = "target") -> None:
    if t is None:
        return
    if isinstance(t, str):
        if not t.strip():
            rep.err(where, f"{name} が空の文字列である。部品を指さない手順なら null にする。")
        elif t.strip().lower() in GENERIC_SELECTORS:
            rep.warn(where, f"{name} の「{t}」は、ページの中の多くの要素に当てはまる。id・属性・クラスを組み合わせて、1つに絞る。")
        if ":nth-child" in t or ":nth-of-type" in t:
            rep.warn(where, f"{name} に番号の指定（{t}）がある。ページの並びが変わると別の部品を指すので、id・属性・文字での指定を先に考える。")
        return
    if isinstance(t, dict):
        extra = set(t) - {"selector", "text", "nth"}
        if extra:
            rep.warn(where, f"{name} に知らない項目がある: {', '.join(sorted(extra))}")
        sel = t.get("selector")
        if not isinstance(sel, str) or not sel.strip():
            rep.err(where, f"{name} の selector が無い。文字で探すときも、探す要素の種類（例: \"button\"）を selector に書く。")
        elif sel.strip() == "*" and t.get("text"):
            rep.warn(where, f"{name} の selector が \"*\" である。ページ全体の要素の文字を調べるので遅く、外れやすい。要素の種類を書く。")
        if "text" in t and (not isinstance(t["text"], str) or not t["text"].strip()):
            rep.err(where, f"{name} の text が空である。")
        if "nth" in t and (not isinstance(t["nth"], int) or t["nth"] < 0):
            rep.err(where, f"{name} の nth は 0 以上の整数にする。")
        return
    rep.err(where, f"{name} は null・CSS セレクターの文字列・{{\"selector\", \"text\", \"nth\"}} のどれかにする。")


def check_actions(rep: Report, sw: str, acts) -> None:
    """ライブの案内の操作（actions）の形と、データを変える操作・パスワードの入力が無いかを調べる。"""
    if not isinstance(acts, list) or not acts:
        rep.err(sw, "actions は、操作の配列（[{\"do\": \"click\", \"target\": …, \"say\": …}, …]）にする。")
        return
    for k, a in enumerate(acts):
        aw = f"{sw} / 操作 {k + 1}"
        if not isinstance(a, dict):
            rep.err(aw, "オブジェクト（{\"do\": …}）にする。")
            continue
        do = a.get("do")
        if do not in ACTION_KINDS:
            rep.err(aw, f"do は {' / '.join(ACTION_KINDS)} のどれかにする（今は {do!r}）。")
            continue
        extra = set(a) - ACTION_KEYS
        if extra:
            rep.warn(aw, f"知らない項目がある（書き間違いでないか）: {', '.join(sorted(extra))}")
        need_target, need_say, need = ACTION_KINDS[do]
        if need_target == "must" and a.get("target") is None:
            rep.err(aw, f"{do} には、操作する部品（target）が要る。")
        if need_target == "no" and a.get("target") is not None:
            rep.warn(aw, f"{do} では target を使わない。")
        if a.get("target") is not None:
            check_target(rep, aw, a["target"])
        for key in need:
            v = a.get(key)
            ok = isinstance(v, str) and v != "" if key != "value" else (isinstance(v, (str, int, float)) or (do == "select" and isinstance(v, list) and v))
            if not ok:
                rep.err(aw, f"{do} には {key} が要る。")
        say = a.get("say")
        if need_say and (not isinstance(say, str) or not say.strip()):
            rep.err(aw, "say（読み手に見せる、この操作の中身。例: 「検索」の欄に「プリンター」と入れる）が無い。"
                        "案内は、操作する部品を枠で囲み、say を画面の下に出してから操作する。")
        elif isinstance(say, str) and say.strip():
            check_words(rep, aw, say, "action")
        if "allow_change" in a and a["allow_change"] is not True:
            rep.err(aw, "allow_change は、依頼者が明示して許したデータを変える操作にだけ、true と書く（false なら書かない）。")
        tdesc = describe_target(a.get("target")) if a.get("target") is not None else ""
        words = " ".join(x for x in (say if isinstance(say, str) else "", tdesc) if x)
        if do == "click" and CHANGE_RE.search(words) and not a.get("allow_change"):
            rep.err(aw, f"データを送る・変える操作（「{CHANGE_RE.search(words).group(0)}」）の可能性がある。案内のために、依頼者のデータを変えてはいけない。"
                        "その操作の手前までを見せ、押した結果は文で説明する。依頼者が、この操作をしてよいと明示したときだけ allow_change: true を付ける。")
        if do == "press" and str(a.get("key", "")).lower() == "enter":
            rep.warn(aw, "Enter キーは、フォームを送ることがある。送るとデータが変わるフォームでないか確かめる（live-tour.mjs は、POST のフォームなら止める）。")
        if a.get("allow_change"):
            rep.warn(aw, "データを変える操作（allow_change）がある。依頼者が、この操作を案内で行ってよいと明示したか、もう一度確かめる。")
        if do == "fill" and (PASSWORD_RE.search(tdesc) or PASSWORD_RE.search(say or "")):
            rep.err(aw, "パスワードの欄に入れる操作は、台本に書かない。ログインは、読み手が自分で行う手順（interactive: true）にする。")
        if do == "goto" and isinstance(a.get("url"), str) and re.match(r"^\s*javascript:", a["url"], re.I):
            rep.err(aw, "goto の url に javascript: は使えない。")


def check_words(rep: Report, where: str, text: str, kind: str) -> None:
    plain = unquoted(text)
    if "つまり" in plain:
        rep.err(where, "「つまり」を使っている。依頼者の指示で、案内の文には使わない。前置きをせず、言いたいことをそのまま書く。")
    for w in ("要するに", "言い換えると"):
        if w in plain:
            rep.warn(where, f"「{w}」を使っている。前置きをせず、言いたいことをそのまま書けないか確かめる。", cap="vague")
    for w in VAGUE_ERR:
        if w in plain:
            rep.err(where, f"「{w}」を使っている。何が・どのように変わるのかを、画面の部品・数・操作で書き直す。")
    for w in VAGUE_WARN:
        if w in plain:
            rep.warn(where, f"「{w}」は具体的な意味が伝わりにくい。何をどうすることかを書けないか確かめる。", cap="vague")
    for w in METAPHOR_WARN:
        if w in plain:
            rep.warn(where, f"「{w}」は比喩の動詞になっていないか確かめる（例: 「API を叩く」→「API を呼び出す」）。", cap="vague")
    if "!" in plain or "！" in plain:
        rep.warn(where, "感嘆符を使っている。説明の文では使わない。", cap="vague")
    m = ENABLE_RE.search(plain)
    if m:
        rep.warn(where, f"「{m.group(0)[:40]}…」の形の文がある。何の・どの性質や働きが、それを可能にするのかを、同じまとまりの中に書いたか確かめる。", cap="enable")
    for lm in LIST_RE.finditer(plain):
        items = re.split(r"[、・]", lm.group(0))
        if sum(1 for it in items if TERMISH.search(it)) >= 3:
            rep.warn(where, f"「{lm.group(0)[:40]}」のように、言葉を並べている。1つずつ、何をするものかを文で説明できないか確かめる。", cap="list")
            break
    if kind != "action":
        for s in sentences(text):
            if len(s) >= 14 and not re.search(r"[はがも]", s):
                rep.warn(where, f"「{s[:30]}…」に、誰・何が（主語）が書かれていない可能性がある。", cap="subject")


def validate_guide(g) -> Report:
    rep = Report()
    if not isinstance(g, dict):
        rep.err("", "案内のデータは JSON のオブジェクト（{ … }）にする。")
        return rep
    extra = set(g) - TOP_KEYS
    if extra:
        rep.warn("全体", f"知らない項目がある（書き間違いでないか）: {', '.join(sorted(extra))}")
    if g.get("schema") != SCHEMA:
        rep.err("全体", f"schema は \"{SCHEMA}\" にする（今は {g.get('schema')!r}）。")
    gid = g.get("id")
    if not isinstance(gid, str) or not ID_RE.match(gid):
        rep.err("全体", "id は英小文字・数字・ハイフンで、ページごとに違う名前にする（例: \"triage-workbench\"）。ブラウザーに進み具合を残すときの名前に使う。")
    for k in ("title", "summary", "reader"):
        if not isinstance(g.get(k), str) or not g.get(k, "").strip():
            rep.err("全体", f"{k} が無い。")
    if isinstance(g.get("summary"), str) and g["summary"].strip():
        n = len(sentences(g["summary"]))
        if n > 2:
            rep.err("全体の summary", f"{n} 文ある。案内への誘いの最初に出す文なので、1〜2文にする。")
        check_words(rep, "全体の summary", g["summary"], "summary")
    if isinstance(g.get("reader"), str) and g["reader"].strip().endswith("。"):
        rep.warn("全体の reader", "「この案内は、〈reader〉に向けて書いている。」と表示するので、句点で終わらない名詞の形にする（例: \"このページを初めて開く人\"）。")
    style = g.get("style", "plain")
    if style not in ("plain", "polite"):
        rep.err("全体", "style は \"plain\"（だ・である）か \"polite\"（です・ます）にする。")
    if g.get("start", "welcome") not in ("welcome", "manual"):
        rep.err("全体", "start は \"welcome\"（初めて開いたときに誘いを出す）か \"manual\"（出さない）にする。")
    la = g.get("launcher", {})
    if la is not False:
        if not isinstance(la, dict):
            rep.err("全体", "launcher は false か {\"label\", \"position\"} にする。")
        else:
            if set(la) - {"label", "position"}:
                rep.warn("全体の launcher", f"知らない項目がある: {', '.join(sorted(set(la) - {'label', 'position'}))}")
            if "label" in la and (not isinstance(la["label"], str) or not 1 <= len(la["label"]) <= 10):
                rep.err("全体の launcher", "label は 1〜10 文字にする。")
            elif "label" in la and la["label"] != "解説":
                rep.warn("全体の launcher", f"ボタンの文字（label）が「{la['label']}」になっている。依頼者の指示で、ボタンの文字はどのページでも「解説」にする"
                                            "（使い方の説明だけでなく、記載内容の解説にも使うため）。依頼者が別の文字を指定したのでなければ、label を消す。")
            if la.get("position", "bottom-right") not in ("bottom-right", "bottom-left", "top-right", "top-left"):
                rep.err("全体の launcher", "position は bottom-right / bottom-left / top-right / top-left のどれかにする。")
    chapters = g.get("chapters", [])
    chap_ids: set[str] = set()
    if chapters:
        if not isinstance(chapters, list):
            rep.err("全体", "chapters は配列にする。")
            chapters = []
        for k, c in enumerate(chapters):
            if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not isinstance(c.get("title"), str):
                rep.err(f"章 {k + 1}", "{\"id\", \"title\"} にする。")
                continue
            if c["id"] in chap_ids:
                rep.err(f"章 {k + 1}", f"id「{c['id']}」が重なっている。")
            chap_ids.add(c["id"])
    live = "start_url" in g
    if live:
        su = g.get("start_url")
        if not isinstance(su, str) or not re.match(r"^(https?|file)://", su.strip(), re.I):
            rep.err("全体", "start_url は、最初に開くページの URL（http://・https://・file:// で始まる）にする。")
        if g.get("start", "manual") == "welcome" and "start" in g:
            rep.warn("全体", "ライブの案内では、start は使わない（live-tour.mjs が、ブラウザーを開いてすぐ手順 1 を出す）。")
    steps = g.get("steps")
    if not isinstance(steps, list) or not steps:
        rep.err("全体", "steps（手順の配列）が無い。")
        rep.finish()
        return rep
    if len(steps) > 25:
        rep.warn("全体", f"手順が {len(steps)} ある。長い案内は途中でやめられやすい。ページを理解するのに要らない手順を外せないか、章に分けて目次から選べるようにする。")
    if len(steps) > 8 and not chap_ids:
        rep.warn("全体", "手順が 8 より多い。chapters で章に分けると、目次で探しやすい。")

    seen_ids: set[str] = set()
    polite = plain_cnt = 0
    polite_examples: list[str] = []
    term_first: dict[str, int] = {}
    null_targets = 0
    for i, st in enumerate(steps):
        sw = f"手順 {i + 1}"
        if not isinstance(st, dict):
            rep.err(sw, "オブジェクト（{ … }）にする。")
            continue
        title = st.get("title")
        sw = f"手順 {i + 1}「{title}」" if isinstance(title, str) else sw
        extra = set(st) - STEP_KEYS
        if extra:
            rep.warn(sw, f"知らない項目がある（書き間違いでないか）: {', '.join(sorted(extra))}")
        sid = st.get("id")
        if not isinstance(sid, str) or not ID_RE.match(sid):
            rep.err(sw, "id は英小文字・数字・ハイフンにする。")
        elif sid in seen_ids:
            rep.err(sw, f"id「{sid}」が重なっている。")
        else:
            seen_ids.add(sid)
        if not isinstance(title, str) or not title.strip():
            rep.err(sw, "title が無い。")
        if "target" not in st:
            rep.err(sw, "target が無い。部品を指さない手順（ページ全体の説明など）でも、null と書く。")
        check_target(rep, sw, st.get("target"))
        if st.get("target") is None and i > 0:
            null_targets += 1
        if st.get("chapter") is not None and st.get("chapter") not in chap_ids:
            rep.err(sw, f"chapter「{st.get('chapter')}」が chapters に無い。")
        if chap_ids and st.get("chapter") is None:
            rep.warn(sw, "章（chapter）が付いていない。目次で、前の章の続きに見える。")
        if st.get("placement", "auto") not in ("auto", "below", "above", "right", "left"):
            rep.err(sw, "placement は auto / below / above / right / left のどれかにする。")
        if "targetAll" in st and not isinstance(st["targetAll"], bool):
            rep.err(sw, "targetAll は true か false にする。")
        if "missing" in st and (not isinstance(st["missing"], str) or not st["missing"].strip()):
            rep.err(sw, "missing は、部品を見えるようにする方法を書いた文にする。")
        if "interactive" in st and not isinstance(st["interactive"], bool):
            rep.err(sw, "interactive は true か false にする。")
        if st.get("interactive") and st.get("target") is None:
            rep.warn(sw, "読み手が自分で操作する手順（interactive）なのに、target が null である。どこを操作するのかを指す。")
        if not live and ("url" in st or "actions" in st):
            rep.err(sw, "url と actions は、URL のページを操作しながら解説する案内（start_url を書いた、ライブの案内）でだけ使える。")
        if "url" in st and (not isinstance(st["url"], str) or not st["url"].strip()):
            rep.err(sw, "url は、この手順の画面の URL（start_url からの相対でもよい。何文字でもよい所は *）にする。")
        acts = st.get("actions")
        if acts is not None:
            check_actions(rep, sw, acts)
        rv = st.get("reveal")
        if rv is not None:
            if not isinstance(rv, list) or not rv:
                rep.err(sw, "reveal は [{\"click\": 部品の指定}, …] の配列にする。")
            else:
                for k, a in enumerate(rv):
                    if not isinstance(a, dict) or "click" not in a or set(a) - {"click"}:
                        rep.err(sw, f"reveal[{k}] は {{\"click\": 部品の指定}} にする。")
                    else:
                        check_target(rep, sw, a["click"], f"reveal[{k}].click")
                if st.get("target") is None:
                    rep.err(sw, "reveal があるのに target が null である。reveal は、target の部品が隠れているときに見せるためのもの。")
        levels = st.get("levels")
        if not isinstance(levels, list) or not levels:
            rep.err(sw, "levels（説明の細かさの段の配列）が無い。")
            continue
        if st.get("interactive") and not any(isinstance(b, dict) and b.get("type") == "do"
                                             for lv in levels if isinstance(lv, dict) for b in (lv.get("blocks") or [])):
            rep.warn(sw, "読み手が自分で操作する手順（interactive）なのに、「操作と結果」（do）のまとまりが無い。何をして、何が起きたら次へ進むのかを書く。")
        if len(levels) < 2:
            rep.err(sw, "説明の細かさが 1 段しかない。「分からない」を押したときに切り替える、1段細かい説明（levels[1]）を書く。")
        prev_s = prev_c = None
        for k, lv in enumerate(levels):
            lw = f"{sw} / 細かさ {k + 1}"
            if not isinstance(lv, dict):
                rep.err(lw, "オブジェクト（{ \"blocks\": [ … ] }）にする。")
                continue
            extra = set(lv) - LEVEL_KEYS
            if extra:
                rep.warn(lw, f"知らない項目がある: {', '.join(sorted(extra))}")
            if k >= 1 and (not isinstance(lv.get("added"), str) or not lv["added"].strip()):
                rep.err(lw, "added が無い。前の細かさと比べて、何を足したのか（どの前提・どの途中の理由・どの細かい操作か）を1文で書く。")
            blocks = lv.get("blocks")
            if not isinstance(blocks, list) or len(blocks) < 2:
                rep.err(lw, "blocks が無いか、1つしかない。冒頭の 1〜2 文（summary）と、その後の説明・例を書く。")
                continue
            types = [b.get("type") if isinstance(b, dict) else None for b in blocks]
            if types[0] != "summary":
                rep.err(lw, "最初のブロックを summary（部品が何で、何をするものかを述べる 1〜2 文）にする。")
            if types.count("summary") > 1:
                rep.err(lw, "summary が 2 つ以上ある。summary は最初に 1 つだけ置く。")
            if "example" not in types:
                rep.err(lw, "example（具体例）が無い。抽象的な説明の直後に、このページの実際の値を使った例を1つ置く。")
            for bi, b in enumerate(blocks):
                bw = f"{lw} / ブロック {bi + 1}（{types[bi]}）"
                if not isinstance(b, dict):
                    rep.err(bw, "オブジェクトにする。")
                    continue
                t = b.get("type")
                if t not in BLOCK_TYPES:
                    rep.err(bw, f"type は {' / '.join(BLOCK_TYPES)} のどれかにする。")
                    continue
                extra = set(b) - BLOCK_KEYS[t]
                if extra:
                    rep.warn(bw, f"このブロックでは使わない項目がある: {', '.join(sorted(extra))}")
                if t in ("summary", "premise", "text", "example", "note", "term") and (not isinstance(b.get("text"), str) or not b["text"].strip()):
                    rep.err(bw, "text が無い。")
                    continue
                if t == "term":
                    term = b.get("term")
                    if not isinstance(term, str) or not term.strip():
                        rep.err(bw, "term（説明する言葉）が無い。")
                    elif len(term) > 24 or re.search(r"[、,・/／]", term):
                        rep.err(bw, f"term「{term}」は 1 つの言葉にする。2 つ以上の言葉は、ブロックを分けて 1 つずつ説明する。")
                    else:
                        term_first.setdefault(term, i)
                if t == "cause":
                    stp = b.get("steps")
                    if not isinstance(stp, list) or len(stp) < 2 or not all(isinstance(s, str) and s.strip() for s in stp):
                        rep.err(bw, "steps に、原因から結果までの途中を 2 つ以上、順に書く。")
                        continue
                if t == "do":
                    if not isinstance(b.get("action"), str) or not b["action"].strip():
                        rep.err(bw, "action（あなたがすること）が無い。")
                        continue
                    if not isinstance(b.get("result"), str) or not b["result"].strip():
                        rep.err(bw, "result（その結果、画面などで起きること）が無い。操作と結果を組にして書く。")
                if t == "example":
                    if bi == 0 or types[bi - 1] == "example":
                        rep.err(bw, "例が続いている。例は、抽象的な説明の直後に 1 つずつ置く。")
                if t == "summary":
                    n = len(sentences(b["text"]))
                    if n > 2:
                        rep.err(bw, f"冒頭の summary が {n} 文ある。1〜2文にする。")
                    if len(b["text"]) > 150:
                        rep.warn(bw, f"冒頭の summary が {len(b['text'])} 文字ある。1〜2文で、何か・何をするものかだけを書く。")
                    if DECLARE_RE.search(unquoted(b["text"])):
                        rep.warn(bw, "冒頭の summary が、説明の予告（〜を説明する）になっていないか確かめる。その部品が何で、何をするものかを書く。")
                for part, s in block_texts(b):
                    if not s:
                        continue
                    check_words(rep, bw, s, "action" if (t == "do" and part == "action") else t)
                    if len(s) > 240:
                        rep.warn(bw, f"1つのまとまりが {len(s)} 文字ある。1つの事柄ずつに分けられないか確かめる。")
                    for rs in raw_sentences(s):
                        tail = rs.rstrip("。！？!?」』）) 　")
                        if POLITE_END.search(tail):
                            polite += 1
                            if len(polite_examples) < 4:
                                polite_examples.append(f"{bw}「…{rs[-24:]}」")
                        elif tail:
                            plain_cnt += 1
            terms_here = [b.get("term") for b in blocks if isinstance(b, dict) and b.get("type") == "term"]
            if k == 0 and len(terms_here) > 2:
                rep.warn(lw, f"1つの手順で {len(terms_here)} つの言葉を説明している。1つの手順では1つの部品・1つの考えを説明し、言葉が多いときは手順を分けられないか確かめる。")
            # 意味を書く前に、その言葉を使っていないか（同じ細かさの中で）
            for term in terms_here:
                if not isinstance(term, str) or not term:
                    continue
                ti = next(bi for bi, b in enumerate(blocks) if isinstance(b, dict) and b.get("type") == "term" and b.get("term") == term)
                for bi in range(ti):
                    b = blocks[bi]
                    if not isinstance(b, dict):
                        continue
                    if any(term in unquoted(s) for _, s in block_texts(b)):
                        where = "冒頭の summary" if bi == 0 else f"ブロック {bi + 1}"
                        rep.warn(lw, f"言葉「{term}」を、意味を書く（ブロック {ti + 1}）より前の{where}で使っている。先に意味を書くか、その場で短く言い換える。")
                        break
            s_n, c_n = count_sentences(lv), count_chars(lv)
            if prev_s is not None and (s_n <= prev_s or c_n < prev_c * 1.1):
                rep.err(lw, f"前の細かさより細かくなっていない（文 {prev_s}→{s_n}、文字 {prev_c}→{c_n}）。言い換えではなく、前の説明が前提にしていたこと・飛ばしていた途中の理由・まとめて書いた操作を、1つずつ足す。")
            prev_s, prev_c = s_n, c_n
    # 後の手順で初めて説明する言葉を、前の手順で使っていないか
    for term, first in term_first.items():
        for i in range(first):
            st = steps[i]
            if not isinstance(st, dict):
                continue
            used = any(term in unquoted(s) for lv in (st.get("levels") or []) if isinstance(lv, dict)
                       for b in (lv.get("blocks") or []) if isinstance(b, dict) for _, s in block_texts(b))
            if used:
                rep.warn(f"手順 {i + 1}", f"言葉「{term}」を使っているが、意味を書くのは手順 {first + 1} である。先に説明するか、手順 {i + 1} で意味を書く。")
                break
    if null_targets and null_targets >= max(2, len(steps) // 3):
        rep.warn("全体", f"部分を指さない手順（target: null）が {null_targets} ある。この案内は、ページの部分を指して説明するのが中心である。指せる部分（見出し・表・図・ボタンなど）がないか確かめる。")
    if style == "plain" and polite:
        rep.warn("全体", f"文体を「だ・である」（style: plain）にしているが、です・ます で終わる文が {polite} ある。例: " + " / ".join(polite_examples), cap="style")
    if style == "polite" and plain_cnt > polite:
        rep.warn("全体", f"文体を「です・ます」（style: polite）にしているが、だ・である の文のほうが多い（{plain_cnt} 対 {polite}）。", cap="style")
    rep.finish()
    return rep


# ---------------------------------------------------------------- HTML の読み書き

META_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_\-:.]+)""", re.I)
CSP_RE = re.compile(rb"""<meta[^>]+http-equiv\s*=\s*["']?\s*content-security-policy""", re.I)


def detect_encoding(raw: bytes) -> tuple[str, bool]:
    """(エンコーディング名, UTF-8 か) を返す。ASCII と互換でないものは止める。"""
    if raw.startswith(b"\xef\xbb\xbf"):
        return "utf-8", True
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise Usage("UTF-16 の HTML には付けられない。UTF-8 に変えてから付ける。")
    m = META_CHARSET.search(raw[:4096])
    name = m.group(1).decode("ascii", "replace").lower() if m else "utf-8"
    if name in ("utf8", "utf-8", "unicode-1-1-utf-8"):
        return "utf-8", True
    if name.startswith(("utf-16", "utf-32", "iso-2022", "ucs-2", "utf-7")):
        raise Usage(f"文字コード {name} の HTML には付けられない（ASCII の文字と区別できないため）。UTF-8 に変えてから付ける。")
    return name, False


def find_block(raw: bytes) -> tuple[int, int] | None:
    """案内の部分（始まりの印から終わりの印と、その後の改行 1 つまで）の位置を返す。
    スキルの古い名前（html-operation-guide）で付けた案内も見つける。inject で付け直すと、新しい名前の案内に置き換わる。"""
    found = [(raw.find(bg), bg, en) for bg, en in MARKERS if raw.find(bg) >= 0]
    if not found:
        if any(i.encode() in raw for i in DATA_IDS):
            raise Problem(f"id=\"{DATA_ID}\" はあるが、始まりの印が無い。手で書き換えた可能性がある。印を戻すか、その部分を消してから付け直す。")
        return None
    if len(found) > 1 or any(raw.find(bg, b + 1) >= 0 for b, bg, _ in found):
        raise Problem("案内の始まりの印が 2 つ以上ある。古い案内を手で消してから付け直す。")
    b, _, end = found[0]
    e = raw.find(end, b)
    if e < 0:
        raise Problem("案内の始まりの印はあるが、終わりの印が無い。HTML が途中で壊れている可能性がある。")
    e += len(end)
    if raw[e:e + 2] == b"\r\n":
        e += 2
    elif raw[e:e + 1] == b"\n":
        e += 1
    return b, e


def ascii_escape(s: str) -> str:
    out = []
    for ch in s:
        o = ord(ch)
        if o < 128:
            out.append(ch)
        elif o <= 0xFFFF:
            out.append(f"\\u{o:04x}")
        else:
            o -= 0x10000
            out.append(f"\\u{0xD800 + (o >> 10):04x}\\u{0xDC00 + (o & 0x3FF):04x}")
    return "".join(out)


def engine_source(utf8: bool) -> str:
    js = (ASSETS / "guide-engine.js").read_text(encoding="utf-8")
    css = (ASSETS / "guide-engine.css").read_text(encoding="utf-8")
    slot = "const CSS = __GUIDE_CSS__;"
    if js.count(slot) != 1 or js.count("__GUIDE_CSS__") != 1:
        raise Usage("assets/guide-engine.js の「const CSS = __GUIDE_CSS__;」が 1 か所だけになっていない。")
    css_lit = json.dumps(css, ensure_ascii=not utf8).replace("<", "\\u003c")
    js = js.replace(slot, "const CSS = " + css_lit + ";", 1)
    if "</script" in js.lower() or "<!--" in js:
        raise Usage("エンジンの中に </script か <!-- がある。HTML の中に埋め込めないので、エンジンを直す。")
    return js if utf8 else ascii_escape(js)


def data_source(g: dict, utf8: bool) -> str:
    s = json.dumps(g, ensure_ascii=not utf8, indent=1)
    return s.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def build_block(g: dict, utf8: bool, nl: bytes) -> bytes:
    note = ("<!-- ページの解説の案内（page-explainer スキルが付けた）。外すときは、スキルの scripts/guide.py remove を使う。 -->"
            if utf8 else "<!-- operation guide added by the page-explainer skill; remove it with scripts/guide.py remove -->")
    parts = [
        "<!-- page-explainer:begin v1 -->",
        note,
        f'<script type="application/json" id="{DATA_ID}">',
        data_source(g, utf8),
        "</script>",
        '<script id="page-explainer-engine">',
        engine_source(utf8).rstrip("\n"),
        "</script>",
        "<!-- page-explainer:end -->",
    ]
    text = "\n".join(parts) + "\n"
    if nl == b"\r\n":
        text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    return text.encode("utf-8" if utf8 else "ascii")


def write_atomic(path: Path, data: bytes) -> None:
    fd, tmp = tempfile.mkstemp(prefix=".guide-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_bytes(p: str) -> tuple[Path, bytes]:
    path = Path(p)
    try:
        return path, path.read_bytes()
    except OSError as e:
        raise Usage(f"{p} を読めない: {e}")


def upgrade_schema(g):
    """古い名前の形式（html-operation-guide/1）を、今の形式名に直す。中身の形は同じである。"""
    if isinstance(g, dict) and g.get("schema") == OLD_SCHEMA:
        g["schema"] = SCHEMA
    return g


def load_guide(p: str) -> dict:
    path, raw = read_bytes(p)
    if path.suffix.lower() in (".html", ".htm", ".xhtml"):
        return extract_guide(raw)
    try:
        return upgrade_schema(json.loads(raw.decode("utf-8-sig")))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise Usage(f"{p} を JSON として読めない: {e}")


def extract_guide(raw: bytes) -> dict:
    pos = find_block(raw)
    if not pos:
        raise Problem("この HTML には、案内が付いていない。")
    block = raw[pos[0]:pos[1]].decode("utf-8", "replace")
    ids = "|".join(re.escape(i) for i in DATA_IDS)
    m = re.search(r'<script type="application/json" id="(?:' + ids + r')">\s*(.*?)\s*</script>', block, re.S)
    if not m:
        raise Problem("案内の印の中に、案内のデータが無い。")
    try:
        return upgrade_schema(json.loads(m.group(1)))
    except json.JSONDecodeError as e:
        raise Problem(f"案内のデータを JSON として読めない: {e}")


def print_report(rep: Report, ok_msg: str) -> None:
    for w in rep.warnings:
        print("注意: " + w)
    for e in rep.errors:
        print("問題: " + e)
    if rep.errors:
        print(f"\n直すべき問題が {len(rep.errors)} 件、確かめる注意が {len(rep.warnings)} 件ある。")
    else:
        print(f"{ok_msg}（確かめる注意 {len(rep.warnings)} 件）")


def stats(g: dict) -> str:
    steps = g.get("steps") or []
    lv = sum(len(s.get("levels") or []) for s in steps if isinstance(s, dict))
    ch = sum(count_chars(l) for s in steps if isinstance(s, dict) for l in (s.get("levels") or []) if isinstance(l, dict))
    return f"{len(steps)} 手順・説明の段 {lv}・{ch:,} 文字"


# ---------------------------------------------------------------- コマンド

def cmd_validate(a) -> int:
    g = load_guide(a.guide)
    rep = validate_guide(g)
    print_report(rep, f"検査を通った: {stats(g)}")
    return 1 if rep.errors else 0


def cmd_inject(a) -> int:
    g = load_guide(a.guide)
    if "start_url" in g or any(isinstance(st, dict) and st.get("actions") for st in (g.get("steps") or [])):
        raise Problem("この案内は、URL のページを操作しながら解説するライブの案内（start_url・actions がある）なので、HTML には埋め込まない。"
                      "scripts/live-tour.mjs に渡して開く。HTML に埋め込むなら、start_url・url・actions を外した案内を作る。")
    rep = validate_guide(g)
    if rep.errors:
        print_report(rep, "")
        print("案内のデータに問題があるので、HTML には付けていない。")
        return 1
    page, raw = read_bytes(a.page)
    enc, utf8 = detect_encoding(raw)
    if re.search(rb"<frameset", raw, re.I):
        raise Problem("フレームセット（<frameset>）のページには付けられない。中のページに付ける。")
    nl = b"\r\n" if raw.count(b"\r\n") * 2 > raw.count(b"\n") else b"\n"
    block = build_block(g, utf8, nl)
    pos = find_block(raw)
    if pos:
        out = raw[:pos[0]] + block + raw[pos[1]:]
        how = "前の案内を置き換えた"
    else:
        ms = list(re.finditer(rb"</body\s*>", raw, re.I))
        at = ms[-1].start() if ms else len(raw)
        out = raw[:at] + block + raw[at:]
        how = "</body> の直前に入れた" if ms else "</body> が無いので、ファイルの最後に入れた"
    dest = Path(a.out) if a.out else page
    if a.out and dest.resolve().parent != page.resolve().parent:
        print("注意: 元の HTML と違うフォルダーに書き出す。ページが相対パスで読む CSS・JS・画像が見つからなくなる可能性がある。")
    if CSP_RE.search(raw):
        print("注意: ページに Content-Security-Policy の指定がある。インラインのスクリプトが止められると、案内が動かない。check-guide.mjs で確かめる。")
    if not utf8:
        print(f"注意: ページの文字コードが {enc} なので、案内の文字は \\uXXXX の形で書き込んだ（表示は同じ）。")
    for w in rep.warnings:
        print("注意: " + w)
    write_atomic(dest, out)
    print(f"案内を付けた: {dest}（{how}。{stats(g)}。HTML は {len(raw):,} → {len(out):,} バイト）")
    return 0


def cmd_remove(a) -> int:
    page, raw = read_bytes(a.page)
    pos = find_block(raw)
    if not pos:
        print("この HTML には、案内が付いていない。何も変えていない。")
        return 0
    out = raw[:pos[0]] + raw[pos[1]:]
    dest = Path(a.out) if a.out else page
    write_atomic(dest, out)
    print(f"案内を外した: {dest}（{len(raw):,} → {len(out):,} バイト）")
    return 0


def cmd_extract(a) -> int:
    page, raw = read_bytes(a.page)
    g = extract_guide(raw)
    text = json.dumps(g, ensure_ascii=False, indent=2) + "\n"
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
        print(f"案内のデータを書き出した: {a.out}（{stats(g)}）")
    else:
        sys.stdout.write(text)
    return 0


def describe_target(t) -> str:
    if t is None:
        return "なし（画面の中央に出す）"
    if isinstance(t, str):
        return t
    if isinstance(t, dict):
        s = t.get("selector", "")
        if t.get("text"):
            s += f" のうち、文字「{t['text']}」を含むもの"
        if "nth" in t:
            s += f"（{t['nth'] + 1} 番目）"
        return s
    return str(t)


def guide_text(g: dict) -> str:
    L = [f"案内: {g.get('title')}（id: {g.get('id')}）", f"冒頭の文: {g.get('summary')}", f"読み手: {g.get('reader')}"]
    if g.get("start_url"):
        L.append(f"最初に開く URL: {g.get('start_url')}（ライブの案内）")
    chapters = {c.get("id"): c.get("title") for c in (g.get("chapters") or []) if isinstance(c, dict)}
    steps = g.get("steps") or []
    for i, st in enumerate(steps):
        if not isinstance(st, dict):
            continue
        chap = chapters.get(st.get("chapter"))
        L += ["", f"━━ 手順 {i + 1} / {len(steps)}「{st.get('title')}」" + (f"（章: {chap}）" if chap else "")]
        acts = [a for a in (st.get("actions") or []) if isinstance(a, dict)]
        if acts:
            L.append("   この手順を出す前に、案内が自動で行う操作:")
            for n, a in enumerate(acts):
                L.append(f"     {n + 1}. {a.get('say') or a.get('do')}" + ("（データを変える操作。依頼者が許した）" if a.get("allow_change") else ""))
        if st.get("url"):
            L.append(f"   画面の URL: {st['url']}")
        if st.get("interactive"):
            L.append("   読み手が自分でページを操作する手順（暗幕を出さない）")
        L.append(f"   指す部品: {describe_target(st.get('target'))}")
        if st.get("missing"):
            L.append(f"   部品が見えないとき: {st['missing']}")
        levels = st.get("levels") or []
        for k, lv in enumerate(levels):
            if not isinstance(lv, dict):
                continue
            L.append(f"  ── 細かさ {k + 1} / {len(levels)}" + (f"（足した説明: {lv.get('added')}）" if k and lv.get("added") else ""))
            for b in lv.get("blocks") or []:
                if not isinstance(b, dict):
                    continue
                t = b.get("type")
                if t == "summary":
                    L.append(f"    [冒頭] {b.get('text')}")
                elif t == "premise":
                    L.append(f"    [前提] {b.get('text')}")
                elif t == "term":
                    L.append(f"    [言葉の意味]「{b.get('term')}」: {b.get('text')}")
                elif t == "example":
                    L.append(f"    [例] {b.get('text')}")
                elif t == "cause":
                    L.append("    [なぜそうなるか]" + (f" {b.get('title')}" if b.get("title") else ""))
                    for n, s in enumerate(b.get("steps") or []):
                        L.append(("      ↓\n" if n else "") + f"      {n + 1}. {s}")
                elif t == "do":
                    L.append(f"    [操作と結果] あなた: {b.get('action')}")
                    L.append(f"                結果: {b.get('result')}")
                elif t == "note":
                    L.append(f"    [注意] {b.get('text')}")
                else:
                    L.append(f"    {b.get('text')}")
    return "\n".join(L) + "\n"


def cmd_text(a) -> int:
    g = load_guide(a.guide)
    text = guide_text(g)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
        print(f"読み物の文章を書き出した: {a.out}")
    else:
        sys.stdout.write(text)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="page-explainer の道具（検査・埋め込み・取り外し・取り出し・文章化）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("validate", help="案内のデータを検査する")
    p.add_argument("guide", help="案内のデータ（.json）か、案内を付けた HTML")
    p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("inject", help="HTML に案内を付ける（付いていれば置き換える）")
    p.add_argument("page")
    p.add_argument("--guide", required=True)
    p.add_argument("--out", help="書き出す先（省くと、元の HTML を書き換える）")
    p.set_defaults(fn=cmd_inject)
    p = sub.add_parser("remove", help="HTML から案内を外す（付ける前と同じバイト列に戻る）")
    p.add_argument("page")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_remove)
    p = sub.add_parser("extract", help="HTML に付けた案内のデータを取り出す")
    p.add_argument("page")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_extract)
    p = sub.add_parser("text", help="案内を、読み手役の点検に使う読み物の文章にする")
    p.add_argument("guide")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_text)
    a = ap.parse_args(argv)
    try:
        return a.fn(a)
    except Problem as e:
        print("問題: " + str(e))
        return 1
    except Usage as e:
        print("止めた: " + str(e))
        return 2


if __name__ == "__main__":
    sys.exit(main())
