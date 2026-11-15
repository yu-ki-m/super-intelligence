#!/usr/bin/env python3
"""Build an offline HTML workbook or apply a version-matched state export.

Python 3.10+ and Node.js 18+; no pip/npm packages. Validation uses the exact
same model validator as the browser. Never executes input HTML or cell data.
An existing output file is never overwritten: it is first renamed to
<name>_<YYYYMMDDHHMMSS><suffix>, and the new content takes the original name.
"""
import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_RE = re.compile(r'<script id="workbook-data" type="application/json">(.*?)</script>', re.S)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def revision(workbook):
    data = {key: value for key, value in workbook.items() if key != "revision"}
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate(workbook):
    program = "const C=require(process.argv[1]);let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{try{C.validate(JSON.parse(s));}catch(e){console.error(e.message);process.exitCode=1;}});"
    try:
        result = subprocess.run(["node", "-e", program, str(ROOT / "assets" / "core.js")],
                                input=json.dumps(workbook, ensure_ascii=False), text=True,
                                encoding="utf-8", capture_output=True, check=False)
    except FileNotFoundError as exc:
        raise ValueError("Node.js 18+ が必要です。生成後のHTMLの閲覧にはNodeは不要です。") from exc
    if result.returncode:
        raise ValueError(result.stderr.strip())


def read_base(path):
    source = Path(path).read_text(encoding="utf-8-sig")
    match = DATA_RE.search(source)
    if not match:
        raise ValueError("元HTMLにworkbook-dataがありません。このスキルの生成HTMLを指定してください。")
    base = json.loads(match.group(1))
    validate(base)
    if base["revision"] != revision(base):
        raise ValueError("元HTMLのデータがリビジョン生成後に変更されています。元の生成版を指定してください。")
    return base


def apply_state(base_path, state_path):
    base = read_base(base_path)
    raw = Path(state_path).read_text(encoding="utf-8-sig").strip()
    if not raw.startswith("EXCEL_HTML_STATE_V1\n"):
        raise ValueError("編集状態はEXCEL_HTML_STATE_V1で始まる完全なテキストを渡してください。")
    state = json.loads(raw.split("\n", 1)[1])
    if state.get("schema") != "excel-html-state/v1":
        raise ValueError("状態形式が不正です。")
    if state.get("workbookId") != base["id"] or state.get("baseRevision") != base["revision"]:
        raise ValueError("元ブックIDまたはリビジョンが一致しません。競合を無視した上書きは行いません。")
    workbook = state.get("workbook")
    validate(workbook)
    if workbook["id"] != base["id"] or workbook["revision"] != base["revision"]:
        raise ValueError("編集状態内のブックIDまたはリビジョンが一致しません。")
    return workbook


def build(workbook):
    validate(workbook)
    workbook["revision"] = revision(workbook)
    data = json.dumps(workbook, ensure_ascii=False, separators=(",", ":"))
    # JSON stays parseable but cannot terminate its inert script element.
    data = data.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    tokens = {
        "__TITLE__": html.escape(workbook["title"]),
        "/*__STYLE__*/": (ROOT / "assets" / "style.css").read_text(encoding="utf-8"),
        "/*__CORE__*/": (ROOT / "assets" / "core.js").read_text(encoding="utf-8"),
        "/*__APP__*/": (ROOT / "assets" / "app.js").read_text(encoding="utf-8"),
        "/*__DATA__*/": data,
    }
    source = (ROOT / "assets" / "shell.html").read_text(encoding="utf-8")
    # One pass prevents user text which resembles a token from being replaced.
    return re.sub("|".join(re.escape(token) for token in tokens), lambda m: tokens[m.group()], source)


def previous_name(path):
    """The name that keeps the old content: <stem>_<YYYYMMDDHHMMSS><suffix>, unused in the same folder."""
    moment = datetime.now()
    while True:
        candidate = path.with_name(f"{path.stem}_{moment:%Y%m%d%H%M%S}{path.suffix}")
        if not candidate.exists():
            return candidate
        moment += timedelta(seconds=1)


def write_keeping_previous(path, text):
    """Writes text to path. If path exists, it is renamed to previous_name(path) first.

    The new content is written to a temporary file beforehand, so a failure leaves the old file in place.
    Returns the path of the renamed old file, or None when there was nothing to keep.
    """
    if path.is_dir():
        raise ValueError(f"出力先がフォルダーです: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temp.write_text(text, encoding="utf-8")
    previous = None
    try:
        if path.exists():
            previous = previous_name(path)
            path.rename(previous)
        temp.replace(path)
    except OSError:
        if previous and previous.exists() and not path.exists():
            previous.rename(path)
        temp.unlink(missing_ok=True)
        raise
    return previous


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="新規ブックJSON")
    parser.add_argument("--base", type=Path, help="編集元の生成HTML")
    parser.add_argument("--state", type=Path, help="AI用状態テキスト")
    parser.add_argument("--output", type=Path,
                        help="出力先。--base と --state で反映するときは省略でき、省略すると --base と同じファイルに書き出す")
    parser.add_argument("--extract-json", action="store_true", help="状態適用後のJSONを出力（AIによる追加編集用）")
    args = parser.parse_args()
    if bool(args.input) == bool(args.base) or bool(args.base) != bool(args.state):
        parser.error("--input、または--baseと--stateの組を指定してください。")
    output_path = args.output or (args.base if args.base and not args.extract_json else None)
    if output_path is None:
        parser.error("--output を指定してください。")
    try:
        workbook = read_json(args.input) if args.input else apply_state(args.base, args.state)
        validate(workbook)
        output = json.dumps(workbook, ensure_ascii=False, indent=2) if args.extract_json else build(workbook)
        previous = write_keeping_previous(output_path, output)
        print(str(output_path.resolve()))
        if previous:
            print("以前の内容: " + str(previous.resolve()))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print("エラー: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
