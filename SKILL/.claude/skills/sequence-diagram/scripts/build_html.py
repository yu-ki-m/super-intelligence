#!/usr/bin/env python3
"""Node.js が使えない環境向けの HTML 組み立て（フォールバック）。

    python build_html.py <model.json> [-o OUT.html] [--mermaid inline|cdn]

seqdiag.cjs build と同じテンプレートに、処理モデル・ビューア・Mermaid を埋め込むだけを行う。
モデルの検証・根拠ファイルの照合・ソース抜粋の埋め込みは行わない（ビューアを開いたときに
モデル検証が実行され、「検証」タブに結果が出る）。Node.js が使えるなら seqdiag.cjs を使うこと。
"""
import argparse
import datetime
import json
import os
import re
import sys

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(SKILL_DIR, "assets")
CORE = os.path.join(SKILL_DIR, "scripts", "lib", "core.cjs")
VENDOR_MERMAID = os.path.join(ASSETS, "vendor", "mermaid.min.js")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def core_constant(name):
    m = re.search(r"var %s = '([^']+)'" % name, read(CORE))
    return m.group(1) if m else "unknown"


def escape_script(text):
    return re.sub(r"</(script)", r"<\\/\1", text, flags=re.I).replace("<!--", "<\\!--")


def json_for_script(obj):
    s = json.dumps(obj, ensure_ascii=False)
    return s.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def fill(tpl, key, value):
    token = "/*@@" + key + "@@*/"
    if token not in tpl:
        raise SystemExit("テンプレートに %s がありません" % token)
    return tpl.replace(token, value)


def main():
    # Windows のコンソール（cp932 等）でも日本語のメッセージが化けないようにする
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model")
    ap.add_argument("-o", "--out")
    ap.add_argument("--mermaid", choices=["inline", "cdn"], default="inline")
    a = ap.parse_args()

    try:
        with open(a.model, encoding="utf-8-sig") as f:
            model = json.load(f)
    except json.JSONDecodeError as e:
        raise SystemExit("JSON の構文エラー: %s %d行%d桁目 (%s)" % (a.model, e.lineno, e.colno, e.msg))

    core_version = core_constant("VERSION")
    mermaid_version = core_constant("MERMAID_VERSION")
    if a.mermaid == "inline":
        if not os.path.exists(VENDOR_MERMAID):
            raise SystemExit("同梱の Mermaid が見つかりません: " + VENDOR_MERMAID + "（--mermaid cdn を使ってください）")
        mermaid_tag = "<script>\n" + escape_script(read(VENDOR_MERMAID)) + "\n</script>"
    else:
        mermaid_tag = '<script src="https://cdn.jsdelivr.net/npm/mermaid@%s/dist/mermaid.min.js"></script>' % mermaid_version

    title = str((model.get("meta") or {}).get("title") or "シーケンス図")
    build_info = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "coreVersion": core_version,
        "mermaidVersion": mermaid_version,
        "mermaidMode": a.mermaid,
        "modelFile": os.path.basename(a.model),
        "sources": {},
        "issues": [{"level": "info", "code": "build.python", "message": "Python 版で組み立てたため、根拠ファイルの照合と抜粋の埋め込みは行っていません。"}],
    }
    html = read(os.path.join(ASSETS, "viewer", "template.html"))
    html = fill(html, "TITLE", title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    html = fill(html, "CORE_VERSION", core_version)
    html = fill(html, "MERMAID_VERSION", mermaid_version)
    html = fill(html, "VIEWER_CSS", read(os.path.join(ASSETS, "viewer", "viewer.css")))
    html = fill(html, "MODEL_JSON", json_for_script(model))
    html = fill(html, "BUILD_JSON", json_for_script(build_info))
    html = fill(html, "MERMAID_SCRIPT", mermaid_tag)
    html = fill(html, "CORE_JS", escape_script(read(CORE)))
    html = fill(html, "VIEWER_JS", escape_script(read(os.path.join(ASSETS, "viewer", "viewer.js"))))

    out = a.out or re.sub(r"(\.model)?\.json$", "", a.model, flags=re.I) + ".html"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    print("HTML を出力しました: %s（%.2f MB、Mermaid: %s）" % (os.path.abspath(out), os.path.getsize(out) / 1024 / 1024, a.mermaid))
    print("注意: モデルの検証は HTML を開いたときに「検証」タブで確認してください。")


if __name__ == "__main__":
    sys.exit(main())
