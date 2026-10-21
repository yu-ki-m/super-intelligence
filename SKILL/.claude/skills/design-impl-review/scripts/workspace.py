# -*- coding: utf-8 -*-
"""レビューのワークスペース（<リポジトリのルート>/.ai_review_workspace/）を作る・一覧する・進み具合を調べる。

使い方:
  python workspace.py init --target <対象名> [--root <リポジトリのルート>] [--mode 標準|視点指定|再レビュー]
                           [--focus V09,V11] [--previous <前回のレビューのフォルダ>]
  python workspace.py list [--root <リポジトリのルート>]
  python workspace.py status <レビューのフォルダ>

status は、書き出されたファイルの中身から進み具合と次の手順を判断する。
00_progress.md の記載と食い違うときは、ファイルの中身を正とする（記録の更新前に中断した可能性があるため）。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_report as br  # noqa: E402

WS_NAME = ".ai_review_workspace"
MODES = ("標準", "視点指定", "再レビュー")
# 状況探索の17視点（ガイドの5章の並び）。V17・V18 は各探索に重ねる共通視点なので、ファイルを分けない。
VIEWPOINTS = [
    ("V01", "主要シナリオ"), ("V02", "代替シナリオ"), ("V03", "エッジケース・入力境界"), ("V04", "不正・未知の入力"),
    ("V05", "特殊な状態"), ("V06", "条件の組み合わせ"), ("V07", "未実行・途中離脱"), ("V08", "順序・タイミング"),
    ("V09", "反復・再実行"), ("V10", "競合・並行"), ("V11", "部分失敗・回復"), ("V12", "情報の不一致"),
    ("V13", "波及・副作用"), ("V14", "規模・負荷・累積"), ("V15", "前提の変化"), ("V16", "想定外操作・悪用"),
    ("V19", "主体・対象・範囲の入れ替え"),
]
VP_NAME = dict(VIEWPOINTS)
EXPLORED = ("重点", "簡易")                     # 探索ファイルを作る深さ
STATUS_RE = re.compile(r"実施状況[：:]\s*(未着手|途中|記録完了)")
CASE_RE = re.compile(r"^#{2,4}\s*(C-(?:V\d{2}|X|R)-\d+)")
JUDGE_RE = re.compile(r"^\s*[-*]?\s*判定[：:]\s*([^\s（(／/、。]+)")
HANDOFF_RE = re.compile(r"^\s*[-*]\s*(V\d{2})へ[：:]\s*(.+)$")
PLAN_ROW_RE = re.compile(r"^\|\s*(V\d{2})[^|]*\|([^|]*)\|([^|]*)\|([^|]*)\|")


def find_root(given: str | None) -> Path:
    if given:
        return Path(given).resolve()
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
        return Path(out.stdout.strip()).resolve()
    except Exception:
        return Path.cwd().resolve()


def git_version(root: Path) -> str:
    try:
        head = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "未確認（git の版を取れなかった）"
    try:
        dirty = subprocess.run(["git", "-C", str(root), "status", "--porcelain", "--", ".", f":!{WS_NAME}"],
                               capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        dirty = ""
    return f"コミット {head}" + ("（未コミットの変更あり）" if dirty else "")


def read_json(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8-sig")
    except Exception:
        return ""


def section(text: str, title: str) -> list[str]:
    """「## title」の節の本文（空行を除く）。"""
    out, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line[3:].strip() == title
            continue
        if inside and line.strip():
            out.append(line.rstrip())
    return out


# ---------------------------------------------------------------- init

PROGRESS = """# 再開用記録

- 状態：進行中
- 現在の手順：Phase 0（開始直後）
- 更新日時：{now}

## 次にやること
1. Phase 0：01_request.md（レビュー開始記録）を書く。

## 対象・資料版・実行モード
- 対象：{target}
- 版：{version}
- モード：{mode}

## 完了した手順
- （まだない）

## 途中の作業
- （まだない）

## 未着手
- Phase 0〜5 のすべて

## 確定指摘・判断保留（ケースの段階を含む）
- （まだない）

## 未確認の参照先と必要な入力
- （まだない）

## 再開の履歴
- （まだない。再開するたびに1行足し、書き直すときも消さない）
"""


def cmd_init(a) -> int:
    root = find_root(a.root)
    if not root.is_dir():
        print(f"リポジトリのルートがない：{root}")
        return 2
    focus = [v.strip().upper() for v in (a.focus or "").split(",") if v.strip()]
    bad = [v for v in focus if v not in VP_NAME and v not in ("V17", "V18")]
    if bad:
        print(f"--focus の視点が分からない：{bad}（V01〜V16・V19 で指定する）")
        return 2
    if a.mode == "視点指定" and not focus:
        print("視点指定のときは --focus で視点を指定する（例：--focus V09,V11）")
        return 2
    version = git_version(root)
    ws = root / WS_NAME
    ws.mkdir(exist_ok=True)
    base = f"{datetime.now():%Y%m%d-%H%M}_{br.safe_name(a.target)[:24]}"   # 長いと Windows のパスの上限に近づく
    d, n = ws / base, 2
    while d.exists():
        d, n = ws / f"{base}-{n}", n + 1
    d.mkdir()
    for sub in ("07_explorations", "08_findings", "report"):
        (d / sub).mkdir()
    review = {
        "target": a.target, "mode": a.mode, "focus": focus, "previous": a.previous or "",
        "created": f"{datetime.now():%Y-%m-%d}", "version": version, "materials": "",
        "status": "進行中", "banner": "",
    }
    (d / "review.json").write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    mode = a.mode + (f"（{', '.join(focus)}）" if focus else "") + (f"（前回：{a.previous}）" if a.previous else "")
    (d / "00_progress.md").write_text(PROGRESS.format(now=f"{datetime.now():%Y-%m-%d %H:%M}", target=a.target,
                                                      version=version, mode=mode), encoding="utf-8")
    (d / "03_requirements.jsonl").write_text("", encoding="utf-8")
    (d / "05_questions.md").write_text("# 確認待ち\n", encoding="utf-8")
    print(f"レビューのフォルダを作った：{d}")
    print(f"版：{version}")
    print("次：Phase 0 として 01_request.md を書く（書き方は references/workspace-files.md）")
    return 0


# ---------------------------------------------------------------- list

def newest_mtime(d: Path) -> float:
    return max((p.stat().st_mtime for p in d.rglob("*") if p.is_file()), default=d.stat().st_mtime)


def cmd_list(a) -> int:
    root = find_root(a.root)
    ws = root / WS_NAME
    dirs = sorted((p for p in ws.iterdir() if p.is_dir()), reverse=True) if ws.is_dir() else []
    if not dirs:
        print(f"レビューはまだない（{ws}）")
        return 0
    print(f"{ws} のレビュー（新しい順）:")
    for d in dirs:
        meta = read_json(d / "review.json")
        nxt = section(read_text(d / "00_progress.md"), "次にやること")
        when = datetime.fromtimestamp(newest_mtime(d)).strftime("%Y-%m-%d %H:%M")
        print(f"- {d.name}")
        print(f"    対象：{meta.get('target', '?')}／モード：{meta.get('mode', '?')}／状態：{meta.get('status', '?')}"
              f"／最終更新：{when}")
        if nxt:
            print(f"    次にやること（記録）：{nxt[0].lstrip('0123456789. ')}")
        print(f"    フォルダ：{d}")
    return 0


# ---------------------------------------------------------------- status

def parse_plan(text: str) -> dict:
    plan = {}
    for row, line in enumerate(text.splitlines()):
        m = PLAN_ROW_RE.match(line.strip())
        if not m:
            continue
        depth = m.group(2).strip()
        order = m.group(4).strip()
        plan[m.group(1)] = {
            "depth": next((k for k in ("重点", "簡易", "対象外", "未決定", "範囲外") if depth.startswith(k)), depth or "?"),
            "order": int(order) if order.isdigit() else None,
            "row": row,
        }
    return plan


def pending_sources(text: str) -> list[str]:
    """02_sources.md の表で、最後の列（要件の抽出）が「未」の資料。"""
    out = []
    for line in text.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 6 and re.match(r"SRC-\d+", cells[0]) and cells[-1].startswith("未") and not cells[-1].startswith("未入手"):
            out.append(f"{cells[0]} {cells[1]}")
    return out


def parse_exploration(text: str) -> dict:
    statuses = STATUS_RE.findall(text)
    cases, current = {}, None
    for line in text.splitlines():
        m = CASE_RE.match(line)
        if m:
            current = m.group(1)
            cases[current] = "未判定"
            continue
        m = JUDGE_RE.match(line)
        if m and current:
            cases[current] = m.group(1)
    handoffs = [(m.group(1), m.group(2)) for m in map(HANDOFF_RE.match, text.splitlines()) if m]
    return {"status": statuses[-1] if statuses else "途中", "cases": cases, "handoffs": handoffs}


def exploration_files(d: Path) -> dict:
    out = {}
    folder = d / "07_explorations"
    for p in sorted(folder.glob("*.md")) if folder.is_dir() else []:
        key = p.name.split("_", 1)[0]          # V10 / X / R
        out[key] = {"file": p.name, **parse_exploration(read_text(p))}
    return out


def cmd_status(a) -> int:
    d = Path(a.review_dir).resolve()
    if not (d / "review.json").exists():
        print(f"レビューのフォルダではない（review.json がない）：{d}")
        return 2
    meta = read_json(d / "review.json")
    mode = meta.get("mode", "標準")
    print(f"対象：{meta.get('target')}／モード：{mode}{'（' + ', '.join(meta.get('focus') or []) + '）' if meta.get('focus') else ''}"
          f"／版：{meta.get('version')}／状態（review.json）：{meta.get('status')}")
    root = d.parent.parent if d.parent.name == WS_NAME else None
    if root:
        now = git_version(root)
        same = now.split("（")[0] == str(meta.get("version", "")).split("（")[0]
        print(f"今のリポジトリの版：{now}" + ("（記録した版と同じ）" if same else
              "（記録した版と違う。git diff --stat で変わったファイルを見て、影響を受けるケースを確かめ直す）"))

    # Phase 0
    errs, warns = [], []
    reqs = br.load_requirements(d / "03_requirements.jsonl", errs, warns)
    questions = re.findall(r"^##\s*(Q-\d+)", read_text(d / "05_questions.md"), re.M)
    unanswered = len(re.findall(r"状態[：:]\s*未回答", read_text(d / "05_questions.md")))
    print("\n[Phase 0]")
    for name in ("01_request.md", "02_sources.md", "04_structure.md"):
        print(f"  {'あり' if (d / name).exists() else 'なし'}  {name}")
    print(f"  要件 {len(reqs)} 件（03_requirements.jsonl）" + (f"／読めない行 {len(errs) + len(warns)} 件" if errs or warns else ""))
    for m in errs + warns:
        print(f"    - {m}")
    print(f"  確認待ち {len(questions)} 件（未回答 {unanswered} 件）")
    pending_src = pending_sources(read_text(d / "02_sources.md"))
    if pending_src:
        print(f"  要件をまだ抜き出していない資料：{', '.join(pending_src)}")

    # Phase 1・2・3
    plan = parse_plan(read_text(d / "06_plan.md"))
    expl = exploration_files(d)
    print("\n[Phase 1・2] 視点（06_plan.md と 07_explorations）")
    if not plan:
        print("  06_plan.md がないか、探索範囲表の行（| V01 … |）が読めない")
    for vid, name in VIEWPOINTS if plan or expl else []:
        p = plan.get(vid, {})
        e = expl.get(vid)
        depth = p.get("depth", "06_plan.md に行がない")
        if e:
            judged = {}
            for j in e["cases"].values():
                judged[j] = judged.get(j, 0) + 1
            breakdown = "、".join(f"{k} {v}" for k, v in judged.items()) or "ケースなし"
            state = f"{e['status']}／ケース {len(e['cases'])} 件（{breakdown}）"
        elif depth in EXPLORED:
            state = "未着手"
        else:
            state = "探索しない（理由は 06_plan.md）"
        order = p.get("order")
        print(f"  {vid} {name}：深さ {depth}" + (f"・順 {order}" if order else "") + f"／{state}")
    for key, label in (("X", "横断確認"), ("R", "前回の指摘の再確認")):
        if key in expl:
            e = expl[key]
            print(f"  {label}：{e['status']}／ケース {len(e['cases'])} 件（{e['file']}）")
        elif key == "X" or mode == "再レビュー":
            print(f"  {label}：未着手")
    pending = [(src, dst, txt) for src, e in expl.items() for dst, txt in e["handoffs"]
               if expl.get(dst, {}).get("status") != "記録完了"]
    if pending:
        print("  まだ受け取っていない引継ぎ：")
        for src, dst, txt in pending:
            print(f"    - {src} → {dst}：{txt[:60]}")

    # Phase 4
    ferrs = []
    findings = br.load_findings(d / "08_findings", ferrs)
    br.validate(reqs, findings, ferrs)
    covered = {c for f in findings for c in (f.get("cases") or [])}
    reportable = sorted(c for e in expl.values() for c, j in e["cases"].items() if j in br.REPORTED)
    uncovered = [c for c in reportable if c not in covered]
    undecided = sorted(c for e in expl.values() for c, j in e["cases"].items() if j == "未判定")
    print("\n[Phase 4] 指摘（08_findings）")
    print(f"  {br.summary(reqs, findings)}")
    print(f"  書式の誤り {len(ferrs)} 件" + ("（build_report.py --check-only で詳しく見る）" if ferrs else ""))
    if uncovered:
        print(f"  指摘にしていないケース（判定が欠陥・未定義・保留）：{', '.join(uncovered)}")
    if undecided:
        print(f"  未判定のケース：{', '.join(undecided)}")

    # Phase 5
    pages = sorted((d / "report").glob("*.html")) if (d / "report").is_dir() else []
    inputs = [d / "03_requirements.jsonl", *sorted((d / "08_findings").glob("*.json")), d / "review.json"]
    newest_input = max((p.stat().st_mtime for p in inputs if p.exists()), default=0)
    stale = bool(pages) and pages[0].stat().st_mtime < newest_input
    print("\n[Phase 5]")
    print(f"  {'あり' if (d / '09_closing.md').exists() else 'なし'}  09_closing.md")
    print(f"  HTML：{pages[0].name if pages else 'なし'}" + ("（入力より古い。作り直す）" if stale else ""))

    # 次の手順
    progress = section(read_text(d / "00_progress.md"), "次にやること")
    print("\n[次にやること]")
    print(f"  ファイルから判断：{next_step(d, meta, plan, expl, reqs, findings, uncovered, undecided, pages, stale)}")
    if progress:
        print("  00_progress.md の記録：")
        for line in progress:
            print(f"    {line}")
    return 0


def next_step(d, meta, plan, expl, reqs, findings, uncovered, undecided, pages, stale) -> str:
    if not (d / "01_request.md").exists():
        return "Phase 0：01_request.md（レビュー開始記録）を書く"
    if not (d / "02_sources.md").exists():
        return "Phase 0：資料を読み、02_sources.md に記録する"
    if not reqs:
        return "Phase 0：要件を 03_requirements.jsonl に書く"
    pending_src = pending_sources(read_text(d / "02_sources.md"))
    if pending_src:
        return f"Phase 0：要件をまだ抜き出していない資料（{', '.join(pending_src[:3])}）から、要件を 03_requirements.jsonl に追記する"
    if not (d / "04_structure.md").exists():
        return "Phase 0：04_structure.md（機能構造・基準ケース・期待結果）を書く"
    if not plan:
        return "Phase 1：06_plan.md（視点ごとの深さ・理由・順）を書く"
    missing = [v for v, _ in VIEWPOINTS if v not in plan]
    if missing:
        return f"Phase 1：06_plan.md の探索範囲表に、{', '.join(missing)} の行を足す（17視点すべての深さと理由を書く）"
    if meta.get("mode") == "再レビュー" and expl.get("R", {}).get("status") != "記録完了":
        return "再レビュー：前回の指摘を新しい版で確かめる（07_explorations/R_前回の指摘の再確認.md）"
    planned = [v for v in plan if plan[v]["depth"] in EXPLORED]
    planned.sort(key=lambda v: (plan[v]["order"] is None, plan[v]["order"] or 0, plan[v]["row"]))
    for v in planned:
        st = expl.get(v, {}).get("status", "未着手")
        if st != "記録完了":
            where = expl[v]["file"] if v in expl else f"{v}_{VP_NAME.get(v, '')}.md"
            return f"Phase 2：{v} {VP_NAME.get(v, '')}（{st}）を探索する（07_explorations/{where}）"
    if expl.get("X", {}).get("status") != "記録完了":
        return "Phase 3：横断確認（07_explorations/X_横断確認.md）。行わない場合も理由を書いて記録完了にする"
    if undecided:
        return f"Phase 2：未判定のケースを判定する（{', '.join(undecided[:5])}）"
    if uncovered:
        return f"Phase 4：指摘にしていないケースを、08_findings にまとめる（{', '.join(uncovered[:5])}）"
    if not (d / "09_closing.md").exists():
        return "Phase 5：09_closing.md（終了状態・確認範囲・未確認・残存リスク）を書く"
    if not pages or stale:
        return "Phase 5：build_report.py で検査し、HTML を作る"
    if meta.get("status") == "進行中":
        return "Phase 5：review.json の status を「記録完了」「途中」「入力待ち」のどれかにし、HTML を作り直す"
    return "完了（利用者への報告が済んでいなければ報告する）"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="レビューのワークスペースを作る・一覧する・進み具合を調べる")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init", help="新しいレビューのフォルダを作る")
    p.add_argument("--target", required=True, help="対象の名前（例：会議室予約）")
    p.add_argument("--root", help="リポジトリのルート（既定：git のルート、なければ今のフォルダ）")
    p.add_argument("--mode", choices=MODES, default="標準")
    p.add_argument("--focus", help="視点指定のときの視点（例：V09,V11）")
    p.add_argument("--previous", help="再レビューのときの前回のレビューのフォルダ")
    p = sub.add_parser("list", help="レビューの一覧")
    p.add_argument("--root")
    p = sub.add_parser("status", help="進み具合と次の手順")
    p.add_argument("review_dir")
    a = ap.parse_args(argv)
    return {"init": cmd_init, "list": cmd_list, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
