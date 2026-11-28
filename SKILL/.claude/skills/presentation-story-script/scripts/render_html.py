#!/usr/bin/env python3
"""発表のストーリー設計と台本の Markdown を、閲覧用の HTML にする。

使い方:
    python render_html.py <Markdownのパス> [--out <HTMLのパス>] [--cpm 300] [--pause 2]
    python render_html.py <Markdownのパス> --joints

標準ライブラリだけで動く。
- 「## 台本」の節は、段階（### 名前）ごとに、〔スライド：…〕で区切った場面を、
  「見せるもの」と「話すこと」の2列の表にする。
- 「## 展開」の表の「時間」列と、台本の話す言葉の文字数から、段階ごとの長さの目安を出し、
  展開の表に「台本の長さ」の列を足す。
- 標準出力に、段階ごとの予定と台本の長さ、書式の注意、テーマの切り替わりの候補を出す。
- --joints を付けると、HTMLは書かずに、テーマが切り替わる所（段階の切り替わりと、
  スライドの切り替わり）ごとに、前の文と次の文を並べて出す。
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

SCRIPT_SECTION = "台本"
FLOW_SECTION = "展開"
KARI = "【仮】"

SENTENCE_END = set("。！？!?")
OPEN_BRACKETS = {"「": "」", "『": "』", "（": "）", "(": ")", "〔": "〕", "【": "】"}
CLOSE_BRACKETS = {v: k for k, v in OPEN_BRACKETS.items()}
HARD_TO_SAY = ["http://", "https://", "www.", "`", "**", "|", "→", "⇒", "／", "※"]
LONG_LINE_CHARS = 60

# テーマの切り替わりの最初の文が、これで始まるときは、切り替えたことだけを言っている
SWITCH_ONLY = (
    "本題の前に", "本題に入る前に", "さて", "ところで", "話は変わりますが", "話を変えて",
    "次に", "続いて", "次は", "では次に", "それでは次に", "ここでもう一つ", "もう一つ",
    "申し遅れました", "改めまして",
)
# これで始まるときは、前の話を受けている
LINK_START = (
    "では", "じゃあ", "それでは", "だから", "なので", "そこで", "でも", "ところが", "しかし",
    "けれど", "実は", "つまり", "たとえば", "例えば", "その", "それ", "そう", "ここまで",
    "先ほど", "さっき", "最初に", "最初の", "冒頭", "なぜ", "どうして", "答え", "ヒント",
    "今日のお話", "今日の話", "一つ目", "二つ目", "三つ目", "こうした", "こういう", "このよう",
)
# 文頭のこの言葉は、つなぎの有無を決めないので、外してから調べる
NEUTRAL_START = ("ここで",)
# 物語の時間の流れで続く文頭。前の出来事の続きなので、つながっているとみなす
TIME_START = re.compile(
    r"^(初日|翌日|次の日|次の週|その後|それから|始めて|やがて|しばらく"
    r"|[0-9０-９一二三四五六七八九十]+(日|週間|か月|ヶ月|カ月|年)(後|目|たって|が過ぎ))"
)
# 前と次で同じ言葉が出ていれば、話がつながっているとみなす。
# 漢字は2字の組で比べる（「差し戻し」のように送りがなを1字挟む組も含む）。カタカナ・英数字は2字以上の語で比べる
KANJI_PAIR = re.compile(r"(?=([一-鿿々〆ヶ])[しりきみちいえっ]?([一-鿿々〆ヶ]))")
KANA_ALNUM_WORD = re.compile(
    r"[ァ-ヺー]{2,}|[A-Za-z0-9０-９Ａ-Ｚａ-ｚ]{2,}"
)
STOP_WORDS = {"今日", "本日", "皆様"}


@dataclass
class Item:
    kind: str  # "talk" | "dir" | "gap"
    text: str = ""
    lineno: int = 0


@dataclass
class Scene:
    slide: str | None
    items: list[Item] = field(default_factory=list)
    lineno: int = 0


@dataclass
class Stage:
    name: str
    lineno: int
    scenes: list[Scene] = field(default_factory=list)


@dataclass
class Block:
    kind: str  # "table" | "para" | "list" | "h3" | "code" | "script"
    lines: list[str] = field(default_factory=list)
    header: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    ordered: bool = False
    stages: list[Stage] = field(default_factory=list)
    lineno: int = 0


@dataclass
class Section:
    title: str
    blocks: list[Block] = field(default_factory=list)


@dataclass
class Doc:
    title: str = ""
    sections: list[Section] = field(default_factory=list)


# ---------------------------------------------------------------- 読み取り

TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
LIST_ITEM = re.compile(r"^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$")
FULL_DIRECTION = re.compile(r"^〔(.*)〕$")


def split_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", s)]


def is_script_title(title: str) -> bool:
    return title.strip().startswith(SCRIPT_SECTION)


def is_flow_title(title: str) -> bool:
    return title.strip().startswith(FLOW_SECTION)


def parse(text: str) -> Doc:
    doc = Doc()
    lines = text.splitlines()
    section: Section | None = None
    i = 0
    n = len(lines)

    def current() -> Section:
        nonlocal section
        if section is None:
            section = Section(title="")
            doc.sections.append(section)
        return section

    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            block = Block(kind="code", lineno=i + 1)
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                block.lines.append(lines[i].rstrip("\n"))
                i += 1
            i += 1
            current().blocks.append(block)
            continue

        if re.match(r"^#\s+", stripped) and not doc.title:
            doc.title = re.sub(r"^#\s+", "", stripped)
            i += 1
            continue

        if re.match(r"^##\s+", stripped):
            section = Section(title=re.sub(r"^##\s+", "", stripped))
            doc.sections.append(section)
            i += 1
            if is_script_title(section.title):
                i = parse_script(lines, i, section)
            continue

        if re.match(r"^###\s+", stripped):
            current().blocks.append(
                Block(kind="h3", lines=[re.sub(r"^###\s+", "", stripped)], lineno=i + 1)
            )
            i += 1
            continue

        if not stripped:
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < n and TABLE_SEP.match(lines[i + 1]):
            block = Block(kind="table", header=split_row(stripped), lineno=i + 1)
            i += 2
            while i < n and lines[i].strip().startswith("|"):
                block.rows.append(split_row(lines[i]))
                i += 1
            current().blocks.append(block)
            continue

        m = LIST_ITEM.match(line)
        if m:
            block = Block(kind="list", ordered=bool(m.group(2)), lineno=i + 1)
            while i < n:
                m = LIST_ITEM.match(lines[i].rstrip())
                if m:
                    block.lines.append(m.group(3).strip())
                elif lines[i].strip() and lines[i].startswith((" ", "\t")) and block.lines:
                    block.lines[-1] += "\n" + lines[i].strip()
                else:
                    break
                i += 1
            current().blocks.append(block)
            continue

        block = Block(kind="para", lineno=i + 1)
        while i < n:
            s = lines[i].strip()
            if (
                not s
                or s.startswith(("#", "```"))
                or (s.startswith("|") and i + 1 < n and TABLE_SEP.match(lines[i + 1]))
                or LIST_ITEM.match(lines[i].rstrip())
            ):
                break
            block.lines.append(s)
            i += 1
        current().blocks.append(block)

    return doc


def parse_script(lines: list[str], i: int, section: Section) -> int:
    block = Block(kind="script", lineno=i)
    section.blocks.append(block)
    stage: Stage | None = None
    n = len(lines)
    while i < n:
        stripped = lines[i].strip()
        if re.match(r"^##\s+", stripped) or re.match(r"^#\s+", stripped):
            break
        if re.match(r"^###\s+", stripped):
            stage = Stage(name=re.sub(r"^###\s+", "", stripped), lineno=i + 1)
            block.stages.append(stage)
            i += 1
            continue
        if stripped.startswith("```"):
            i += 1
            continue
        if stage is None:
            if stripped:
                stage = Stage(name="", lineno=i + 1)
                block.stages.append(stage)
            else:
                i += 1
                continue
        if not stripped:
            if stage.scenes and stage.scenes[-1].items and stage.scenes[-1].items[-1].kind != "gap":
                stage.scenes[-1].items.append(Item(kind="gap"))
            i += 1
            continue
        m = FULL_DIRECTION.match(stripped)
        if m:
            content = m.group(1).strip()
            sm = re.match(r"^スライド\s*[：:]?\s*(.*)$", content)
            if sm:
                stage.scenes.append(Scene(slide=sm.group(1).strip(), lineno=i + 1))
            else:
                if not stage.scenes:
                    stage.scenes.append(Scene(slide=None, lineno=i + 1))
                stage.scenes[-1].items.append(Item(kind="dir", text=content, lineno=i + 1))
        else:
            if not stage.scenes:
                stage.scenes.append(Scene(slide=None, lineno=i + 1))
            stage.scenes[-1].items.append(Item(kind="talk", text=stripped, lineno=i + 1))
        i += 1
    for st in block.stages:
        for sc in st.scenes:
            while sc.items and sc.items[-1].kind == "gap":
                sc.items.pop()
    return i


# ---------------------------------------------------------------- 時間の計算


def talk_chars(text: str) -> int:
    t = text.replace(KARI, "")
    t = re.sub(r"〔[^〕]*〕", "", t)
    t = re.sub(r"\s", "", t)
    return len(t)


def direction_seconds(content: str, pause: float) -> float:
    c = content.strip()
    minutes = re.findall(r"(\d+(?:\.\d+)?)\s*分", c)
    seconds = re.findall(r"(\d+(?:\.\d+)?)\s*秒", c)
    if minutes or seconds:
        total = sum(float(x) for x in minutes) * 60 + sum(float(x) for x in seconds)
        return total
    if c.startswith("間"):
        return pause
    return 0.0


def stage_seconds(stage: Stage, cpm: float, pause: float) -> tuple[float, int]:
    chars = 0
    extra = 0.0
    for sc in stage.scenes:
        for it in sc.items:
            if it.kind == "talk":
                chars += talk_chars(it.text)
            elif it.kind == "dir":
                extra += direction_seconds(it.text, pause)
    return chars / cpm * 60 + extra, chars


def parse_span(cell: str) -> float | None:
    s = cell.strip()
    m = re.search(r"(\d+):(\d{2})\s*[〜~\-–—ー－]\s*(\d+):(\d{2})", s)
    if m:
        start = int(m.group(1)) * 60 + int(m.group(2))
        end = int(m.group(3)) * 60 + int(m.group(4))
        return float(end - start) if end >= start else None
    mm = re.search(r"(\d+(?:\.\d+)?)\s*分", s)
    ss = re.search(r"(\d+(?:\.\d+)?)\s*秒", s)
    if mm or ss:
        return (float(mm.group(1)) * 60 if mm else 0.0) + (float(ss.group(1)) if ss else 0.0)
    return None


def fmt_time(sec: float | None) -> str:
    if sec is None:
        return "—"
    total = int(round(sec))
    return f"{total // 60}:{total % 60:02d}"


def norm_name(name: str) -> str:
    n = re.sub(r"^\s*[0-9０-９]+\s*[.．、)）]\s*", "", name)
    return re.sub(r"\s+", "", n)


# ---------------------------------------------------------------- 検査


def sentence_count(text: str) -> int:
    depth = 0
    count = 0
    body = text.rstrip()
    for idx, ch in enumerate(body):
        if ch in OPEN_BRACKETS:
            depth += 1
        elif ch in CLOSE_BRACKETS and depth > 0:
            depth -= 1
        elif ch in SENTENCE_END and depth == 0:
            nxt = body[idx + 1] if idx + 1 < len(body) else ""
            if nxt not in SENTENCE_END:
                count += 1
    return count


@dataclass
class Report:
    stage_rows: list[tuple[str, float | None, float, int]] = field(default_factory=list)
    planned_total: float | None = None
    estimated_total: float = 0.0
    warnings: list[str] = field(default_factory=list)
    hints: list[str] = field(default_factory=list)
    joint_hints: list[str] = field(default_factory=list)
    unwanted_hints: list[str] = field(default_factory=list)
    kari_count: int = 0
    has_script: bool = False


def find_flow_table(doc: Doc) -> tuple[Block | None, int | None, int | None]:
    for sec in doc.sections:
        if is_flow_title(sec.title):
            for b in sec.blocks:
                if b.kind == "table":
                    stage_col = next((k for k, h in enumerate(b.header) if h.strip().startswith("段階")), None)
                    time_col = next((k for k, h in enumerate(b.header) if h.strip() == "時間"), None)
                    return b, stage_col, time_col
    return None, None, None


def find_script(doc: Doc) -> Block | None:
    for sec in doc.sections:
        if is_script_title(sec.title):
            for b in sec.blocks:
                if b.kind == "script":
                    return b
    return None


# ---------------------------------------------------------------- テーマの切り替わり


@dataclass
class Joint:
    kind: str  # "段階" | "スライド"
    before_stage: str
    after_stage: str
    lineno: int
    before: list[Item]
    slide: str | None
    after: list[Item]
    plan: str = ""
    flags: list[str] = field(default_factory=list)


def pick_items(items: list[Item], from_end: bool, talk_needed: int = 2, cap: int = 5) -> list[Item]:
    """切り替わりの前（from_end）か後ろの、話す言葉を talk_needed 行まで取る。ト書きも含める。"""
    seq = list(reversed(items)) if from_end else list(items)
    picked: list[Item] = []
    talks = 0
    for it in seq:
        if it.kind == "gap":
            continue
        picked.append(it)
        if it.kind == "talk":
            talks += 1
            if talks >= talk_needed:
                break
        if len(picked) >= cap:
            break
    return list(reversed(picked)) if from_end else picked


def start_key(text: str) -> str:
    t = re.sub(r"[、，,\s]", "", text.replace(KARI, "").strip())
    for w in NEUTRAL_START:
        if t.startswith(w) and len(t) > len(w):
            rest = t[len(w):]
            if rest.startswith(SWITCH_ONLY) or rest.startswith(LINK_START):
                return rest
    return t


def words_of(items: list[Item]) -> set[str]:
    found: set[str] = set()
    for it in items:
        if it.kind != "talk":
            continue
        t = it.text.replace(KARI, "")
        found.update(m.group(1) + m.group(2) for m in KANJI_PAIR.finditer(t))
        found.update(KANA_ALNUM_WORD.findall(t))
    return found - STOP_WORDS


def flow_joint_plans(doc: Doc) -> dict[str, str]:
    """展開の表に「つなぎ」の列があれば、段階の名前ごとにその中身を返す。"""
    flow, stage_col, _ = find_flow_table(doc)
    if flow is None or stage_col is None:
        return {}
    col = next((k for k, h in enumerate(flow.header) if "つなぎ" in h), None)
    if col is None:
        return {}
    plans: dict[str, str] = {}
    for row in flow.rows:
        if stage_col < len(row) and col < len(row):
            plans[norm_name(row[stage_col])] = row[col].strip()
    return plans


def find_joints(doc: Doc) -> list[Joint]:
    script = find_script(doc)
    if script is None:
        return []
    plans = flow_joint_plans(doc)
    parts = [
        (st, sc)
        for st in script.stages
        for sc in st.scenes
        if sc.slide or any(it.kind != "gap" for it in sc.items)
    ]
    joints: list[Joint] = []
    for (st_a, sc_a), (st_b, sc_b) in zip(parts, parts[1:]):
        kind = "段階" if st_b is not st_a else "スライド"
        before = pick_items(sc_a.items, from_end=True)
        after = pick_items(sc_b.items, from_end=False)
        joint = Joint(
            kind=kind,
            before_stage=st_a.name,
            after_stage=st_b.name,
            lineno=sc_b.lineno or st_b.lineno,
            before=before,
            slide=sc_b.slide,
            after=after,
            plan=plans.get(norm_name(st_b.name), "") if kind == "段階" else "",
        )
        first_talk = next((it for it in sc_b.items if it.kind == "talk"), None)
        if first_talk is not None:
            key = start_key(first_talk.text)
            if key.startswith(SWITCH_ONLY):
                joint.flags.append(
                    "切り替えたことを知らせる言葉で始まっている。次の文までに、前の話との関わりか理由を言っているかを確かめる"
                )
            elif (
                not key.startswith(LINK_START)
                and not TIME_START.match(key)
                and not (words_of(before) & words_of(after))
            ):
                joint.flags.append(
                    "前の話を受ける言葉が見当たらない。同じ話の続きでなければ、黙って切り替えている"
                )
        joints.append(joint)
    return joints


LATE_INTRO_START = ("申し遅れ", "改めまして")
HAND_REQUEST = re.compile(r"手を(挙げ|上げ|あげ)|挙手")


def unwanted_hints(doc: Doc) -> list[str]:
    """利用者が頼んでいなければ台本に入れないもの（途中の名乗り、手を挙げてもらう依頼）の候補を返す。"""
    script = find_script(doc)
    if script is None:
        return []
    hints: list[str] = []
    for st in script.stages:
        for sc in st.scenes:
            for it in sc.items:
                if it.kind == "talk" and start_key(it.text).startswith(LATE_INTRO_START):
                    hints.append(
                        f"{it.lineno}行目：途中で名乗り直す言い方がある。名乗る文を頼まれていなければ消し、"
                        "頼まれていれば台本の最初に置く"
                    )
                if it.kind != "gap" and HAND_REQUEST.search(it.text):
                    hints.append(
                        f"{it.lineno}行目：手を挙げてもらう依頼がある。頼まれていなければ消し、問いの後は〔間〕にする"
                    )
    return hints


def joint_label(j: Joint) -> str:
    if j.kind == "段階":
        return f"段階の切り替わり（{j.before_stage} → {j.after_stage}）"
    return f"「{j.after_stage}」の中のスライドの切り替わり"


def show_item(it: Item) -> str:
    return it.text if it.kind == "talk" else f"〔{it.text}〕"


def print_joints(joints: list[Joint], extra: list[str] | None = None) -> None:
    if not joints:
        print("台本の節がないか、切り替わりがないので、何も出していない。")
        return
    if extra:
        print("台本に入れないものの候補:")
        for h in extra:
            print(f"- {h}")
        print()
    stage_n = sum(1 for j in joints if j.kind == "段階")
    print(
        f"テーマの切り替わり: {len(joints)}か所"
        f"（段階の切り替わり {stage_n}、スライドの切り替わり {len(joints) - stage_n}）"
    )
    print("※ の印は目安。印がない所も、前と次を続けて声に出したつもりで読んで確かめる。")
    for j in joints:
        print()
        print(f"[{j.lineno}行目] {joint_label(j)}")
        if j.plan:
            print(f"  展開のつなぎ: {j.plan}")
        for it in j.before:
            print(f"  前: {show_item(it)}")
        if j.slide:
            print(f"  見せるもの: {j.slide}")
        for it in j.after:
            print(f"  次: {show_item(it)}")
        for f in j.flags:
            print(f"  ※ {f}")


def analyze(doc: Doc, text: str, cpm: float, pause: float) -> tuple[Report, dict[str, float]]:
    rep = Report()
    rep.kari_count = text.count(KARI)
    estimates: dict[str, float] = {}

    for sec in doc.sections:
        for b in sec.blocks:
            if b.kind == "table":
                width = len(b.header)
                for r_index, row in enumerate(b.rows):
                    if len(row) != width:
                        rep.hints.append(
                            f"「{sec.title}」の表の{r_index + 1}行目は列の数が見出しと違う"
                            f"（見出し{width}列、この行{len(row)}列。{b.lineno + 2 + r_index}行目）"
                        )

    flow, stage_col, time_col = find_flow_table(doc)
    planned: dict[str, float | None] = {}
    flow_order: list[str] = []
    if flow is not None and stage_col is not None:
        for row in flow.rows:
            if stage_col < len(row):
                key = norm_name(row[stage_col])
                flow_order.append(key)
                span = parse_span(row[time_col]) if time_col is not None and time_col < len(row) else None
                planned[key] = span

    script = find_script(doc)
    if script is None or not script.stages:
        return rep, estimates
    rep.has_script = True

    script_names = []
    for st in script.stages:
        key = norm_name(st.name)
        script_names.append(key)
        sec_est, chars = stage_seconds(st, cpm, pause)
        estimates[key] = sec_est
        rep.estimated_total += sec_est
        rep.stage_rows.append((st.name or "（名前のない段階）", planned.get(key), sec_est, chars))
        if not st.name:
            rep.warnings.append(f"台本の{st.lineno}行目の前に「### 段階の名前」の見出しがない")
        elif flow is not None and key not in planned:
            rep.warnings.append(f"台本の「{st.name}」が展開の表にない（{st.lineno}行目）。段階の名前を揃える")
        if not any(it.kind == "talk" for sc in st.scenes for it in sc.items):
            rep.warnings.append(f"台本の「{st.name}」に話す言葉がない（{st.lineno}行目）")

        for sc in st.scenes:
            for it in sc.items:
                if it.kind != "talk":
                    continue
                if "〔" in it.text or "〕" in it.text:
                    rep.hints.append(f"{it.lineno}行目：ト書きが話す言葉と同じ行にある。〔 〕の行を分ける")
                if sentence_count(it.text) >= 2:
                    rep.hints.append(f"{it.lineno}行目：1行に2つ以上の文がある。1行1文にする")
                length = talk_chars(it.text)
                if length > LONG_LINE_CHARS:
                    rep.hints.append(f"{it.lineno}行目：{length}字の長い文。切れるところで切る")
                found = [s for s in HARD_TO_SAY if s in it.text]
                if found:
                    rep.hints.append(
                        f"{it.lineno}行目：声に出せない書き方（{' '.join(found)}）がある。意味を言葉で言う"
                    )

    for key in flow_order:
        if key not in estimates:
            rep.warnings.append(f"展開の「{key}」に対応する台本の段階がない")

    known = [p for k, p in planned.items() if p is not None and k in estimates]
    if known:
        rep.planned_total = sum(p for p in planned.values() if p is not None)
        if rep.planned_total > 0:
            ratio = (rep.estimated_total - rep.planned_total) / rep.planned_total
            if abs(ratio) > 0.10:
                more = "長い" if ratio > 0 else "短い"
                rep.warnings.append(
                    f"台本の合計（{fmt_time(rep.estimated_total)}）が予定の合計（{fmt_time(rep.planned_total)}）より"
                    f"{abs(ratio) * 100:.0f}%{more}。台本を{'削る' if ratio > 0 else '足す'}"
                )
        for name, plan, est, _chars in rep.stage_rows:
            if plan:
                diff = est - plan
                if abs(diff) > max(plan * 0.3, 20):
                    more = "長い" if diff > 0 else "短い"
                    rep.hints.append(
                        f"「{name}」の台本（{fmt_time(est)}）が予定（{fmt_time(plan)}）より{more}"
                    )

    for j in find_joints(doc):
        for f in j.flags:
            rep.joint_hints.append(f"{j.lineno}行目：{joint_label(j)}。{f}")
    rep.unwanted_hints.extend(unwanted_hints(doc))
    return rep, estimates


# ---------------------------------------------------------------- HTML


def inline(text: str) -> str:
    out = html.escape(text, quote=False)
    out = out.replace(html.escape(KARI, quote=False), '<span class="kari">仮</span>')
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"〔([^〕]*)〕", r'<span class="dir-inline">\1</span>', out)
    return out


def lines_html(text: str) -> str:
    return "<br>".join(inline(x) for x in text.split("\n"))


SHORT_COLS = {"時間", "台本の長さ"}


def table_html(block: Block, extra: tuple[int, str, list[tuple[str, str]]] | None = None) -> str:
    header = list(block.header)
    rows = [list(r) for r in block.rows]
    extra_index = None
    extra_cells: list[tuple[str, str]] = []
    if extra is not None:
        extra_index, extra_title, extra_cells = extra
        header.insert(extra_index, extra_title)
    parts = ['<div class="table-wrap"><table>', "<thead><tr>"]
    for h in header:
        cls = ' class="short"' if h.strip() in SHORT_COLS else ""
        parts.append(f"<th{cls}>{inline(h)}</th>")
    parts.append("</tr></thead><tbody>")
    for r_index, row in enumerate(rows):
        parts.append("<tr>")
        cells = [inline(c) for c in row]
        while len(cells) < len(block.header):
            cells.append("")
        if extra_index is not None:
            value, note = extra_cells[r_index] if r_index < len(extra_cells) else ("", "")
            cell = html.escape(value)
            if note:
                cell = f'<span class="off" title="{html.escape(note)}">{cell}</span>'
            cells.insert(extra_index, cell)
        for c_index, c in enumerate(cells):
            h = header[c_index].strip() if c_index < len(header) else ""
            cls = ' class="short"' if h in SHORT_COLS else ""
            parts.append(f"<td{cls}>{c}</td>")
        parts.append("</tr>")
    parts.append("</tbody></table></div>")
    return "".join(parts)


def script_html(block: Block) -> str:
    parts = [
        '<div class="table-wrap"><table class="script">',
        '<colgroup><col class="c-slide"><col class="c-talk"></colgroup>',
        "<thead><tr><th>見せるもの</th><th>話すこと</th></tr></thead><tbody>",
    ]
    for st in block.stages:
        parts.append(f'<tr class="group"><td colspan="2">{inline(st.name or "（名前のない段階）")}</td></tr>')
        for sc in st.scenes:
            slide = inline(sc.slide) if sc.slide else ""
            talk = []
            for it in sc.items:
                if it.kind == "talk":
                    talk.append(f'<div class="line">{inline(it.text)}</div>')
                elif it.kind == "dir":
                    cls = "dir pause" if it.text.startswith("間") else "dir"
                    talk.append(f'<div class="{cls}">{inline(it.text)}</div>')
                else:
                    talk.append('<div class="gap"></div>')
            parts.append(f'<tr><td class="slide">{slide}</td><td class="talk">{"".join(talk)}</td></tr>')
    parts.append("</tbody></table></div>")
    return "".join(parts)


CSS = """
:root {
  --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --head: #f6f8fa;
  --group: #e8eef5; --dir-bg: #efeaff; --dir-fg: #5a4790; --pause-bg: #e6f4ea; --pause-fg: #1f6b3a;
  --kari-bg: #fff3c4; --kari-fg: #7a5200; --off: #c4314b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1419; --fg: #e6edf3; --muted: #9aa4ae; --line: #3a434d; --head: #161d25;
    --group: #1d2733; --dir-bg: #251f3d; --dir-fg: #c9bdf5; --pause-bg: #16301f; --pause-fg: #9fdcb3;
    --kari-bg: #3d3110; --kari-fg: #f2cc60; --off: #ff8a9a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 20px 24px 56px; background: var(--bg); color: var(--fg);
  font-family: "Hiragino Sans", "Yu Gothic UI", "Meiryo", system-ui, sans-serif; line-height: 1.7;
}
h1 { font-size: 1.5rem; margin: 0 0 12px; }
h2 { font-size: 1.15rem; margin: 32px 0 10px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
h3 { font-size: 1rem; margin: 18px 0 6px; }
p { margin: 6px 0 12px; }
ul, ol { margin: 6px 0 12px; padding-left: 1.4em; }
li { margin: 2px 0; }
code { font-family: Consolas, "Cascadia Mono", monospace; font-size: .92em; }
pre { background: var(--head); border: 1px solid var(--line); padding: 10px 12px; overflow-x: auto; }
.table-wrap { width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; }
th, td { border: 1px solid var(--line); padding: 6px 10px; vertical-align: top; text-align: left; }
th { background: var(--head); font-weight: 600; min-width: 5em; }
th.short, td.short { white-space: nowrap; min-width: 4.5em; }
tr.group td { background: var(--group); font-weight: 700; }
table.script col.c-slide { width: 28%; }
table.script td.slide { color: var(--muted); }
table.script td.talk { font-size: 1.05rem; line-height: 1.9; }
.line { margin: 1px 0; }
.dir, .dir-inline {
  display: inline-block; margin: 3px 0; padding: 0 8px; border-radius: 4px;
  background: var(--dir-bg); color: var(--dir-fg); font-size: .86rem; line-height: 1.7;
}
.dir-inline { margin: 0 2px; }
.dir.pause { background: var(--pause-bg); color: var(--pause-fg); }
.gap { height: .7em; }
.kari {
  display: inline-block; margin-right: 4px; padding: 0 6px; border-radius: 4px;
  background: var(--kari-bg); color: var(--kari-fg); font-size: .78rem; font-weight: 700; line-height: 1.6;
}
.off { color: var(--off); font-weight: 700; }
.note { color: var(--muted); font-size: .9rem; }
@media print {
  body { padding: 0; }
  tr { break-inside: avoid; }
}
"""


def render(doc: Doc, rep: Report, estimates: dict[str, float], cpm: float, pause: float) -> str:
    title = doc.title or "発表のストーリーと台本"
    body = [f"<h1>{inline(title)}</h1>"]
    flow, stage_col, time_col = find_flow_table(doc)
    for sec in doc.sections:
        if sec.title:
            body.append(f"<section><h2>{inline(sec.title)}</h2>")
        else:
            body.append("<section>")
        for b in sec.blocks:
            if b.kind == "table":
                extra = None
                if b is flow and rep.has_script and stage_col is not None:
                    cells = []
                    for row in b.rows:
                        key = norm_name(row[stage_col]) if stage_col < len(row) else ""
                        est = estimates.get(key)
                        plan = None
                        if time_col is not None and time_col < len(row):
                            plan = parse_span(row[time_col])
                        note = ""
                        if est is not None and plan:
                            diff = est - plan
                            if abs(diff) > max(plan * 0.3, 20):
                                note = f"予定の{fmt_time(plan)}より{'長い' if diff > 0 else '短い'}"
                        cells.append((fmt_time(est) if est is not None else "—", note))
                    index = (time_col + 1) if time_col is not None else len(b.header)
                    extra = (index, "台本の長さ", cells)
                body.append(table_html(b, extra))
                if extra is not None:
                    total = f"合計 {fmt_time(rep.estimated_total)}"
                    if rep.planned_total:
                        total += f"（予定 {fmt_time(rep.planned_total)}）"
                    pause_text = f"{pause:g}"
                    body.append(
                        f'<p class="note">台本の長さは、話す言葉を1分{cpm:g}字、〔間〕を1回{pause_text}秒とし、'
                        f"ト書きに書いた時間を足した目安。{html.escape(total)}。</p>"
                    )
            elif b.kind == "para":
                body.append(f"<p>{'<br>'.join(inline(x) for x in b.lines)}</p>")
            elif b.kind == "list":
                tag = "ol" if b.ordered else "ul"
                items = "".join(f"<li>{lines_html(x)}</li>" for x in b.lines)
                body.append(f"<{tag}>{items}</{tag}>")
            elif b.kind == "h3":
                body.append(f"<h3>{inline(b.lines[0])}</h3>")
            elif b.kind == "code":
                body.append(f"<pre><code>{html.escape(chr(10).join(b.lines))}</code></pre>")
            elif b.kind == "script":
                if b.stages:
                    body.append(script_html(b))
        body.append("</section>")
    return (
        "<!doctype html>\n<html lang=\"ja\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        "<link rel=\"icon\" href=\"data:,\">\n"
        f"<title>{html.escape(title)}</title>\n<style>{CSS}</style>\n</head>\n<body>\n"
        + "\n".join(body)
        + "\n</body>\n</html>\n"
    )


# ---------------------------------------------------------------- 入口


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    parser = argparse.ArgumentParser(description="発表のストーリー設計と台本のMarkdownをHTMLにする")
    parser.add_argument("markdown", help="Markdownのパス")
    parser.add_argument("--out", help="HTMLの書き出し先（省略時はMarkdownと同じ名前の.html）")
    parser.add_argument("--cpm", type=float, default=300.0, help="話す速さ。1分あたりの字数（既定300）")
    parser.add_argument("--pause", type=float, default=2.0, help="〔間〕1回の秒数（既定2）")
    parser.add_argument(
        "--joints", action="store_true", help="HTMLを書かずに、テーマの切り替わりごとに前と次の文を出す"
    )
    args = parser.parse_args(argv)

    src = Path(args.markdown)
    if not src.is_file():
        print(f"Markdownが見つからない: {src}")
        return 1
    text = src.read_text(encoding="utf-8-sig")
    doc = parse(text)
    if args.joints:
        print_joints(find_joints(doc), unwanted_hints(doc))
        return 0
    rep, estimates = analyze(doc, text, args.cpm, args.pause)
    out = Path(args.out) if args.out else src.with_suffix(".html")
    out.write_text(render(doc, rep, estimates, args.cpm, args.pause), encoding="utf-8")

    print(f"HTMLを書き出した: {out}")
    if rep.has_script:
        print(f"台本の長さの目安（話す言葉は1分{args.cpm:g}字、〔間〕は1回{args.pause:g}秒で計算）")
        for name, plan, est, chars in rep.stage_rows:
            print(f"- {name}: 予定 {fmt_time(plan)} / 台本 {fmt_time(est)}（話す言葉 {chars}字）")
        print(f"- 合計: 予定 {fmt_time(rep.planned_total)} / 台本 {fmt_time(rep.estimated_total)}")
    else:
        print("台本の節がないので、長さの目安は出していない。")
    if rep.warnings:
        print("直すこと:")
        for w in rep.warnings:
            print(f"- {w}")
    if rep.joint_hints:
        print("切り替わりの候補（--joints を付けて実行すると、前と次の文を確かめられる）:")
        for h in rep.joint_hints:
            print(f"- {h}")
    if rep.unwanted_hints:
        print("台本に入れないものの候補:")
        for h in rep.unwanted_hints:
            print(f"- {h}")
    if rep.hints:
        print("確かめる候補:")
        for h in rep.hints[:40]:
            print(f"- {h}")
        if len(rep.hints) > 40:
            print(f"- ほか{len(rep.hints) - 40}件")
    print(f"【仮】の数: {rep.kari_count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
