#!/usr/bin/env python3
"""成果物レビュー画面のサーバー。

review.json（マニフェスト）に書かれた成果物を1つのページに埋め込み、
利用者がブラウザで判定とコメントを付けられるようにする。判定とコメントは
feedback.json に保存し、利用者が「レビュー完了」を押すとサーバーは自分から終了する。

開いているページは、成果物や review.json の変更を問い合わせ（/api/state）で知り、
読み込み直さずにその場で描き直す。完了した後もページは開いたまま次のサーバーを待ち、
同じポートで次の版のサーバーが起動すると、そのページがつながって次の版に切り替わる。
ページを読み込み直すと、判定とコメントを書く別ウィンドウ（レビュー用ウィンドウ）が閉じ、
開き直すには利用者がボタンを押す必要があるため、読み込み直しを減らす作りにしている。

使い方:
    python review_server.py <review.json>                      # サーバーを起動してブラウザを開く
    python review_server.py <review.json> --no-browser         # ブラウザを開かない
    python review_server.py <review.json> --static out.html    # サーバーを使わず HTML を書き出す
    python review_server.py <review.json> --check              # マニフェストを検査するだけ

Python の標準ライブラリだけで動く。
"""

from __future__ import annotations

import argparse
import base64
import datetime as _dt
import hashlib
import json
import mimetypes
import os
import secrets
import socket
import sys
import threading
import time
import webbrowser
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = SKILL_DIR / "assets" / "viewer.html"
PLACEHOLDER = "/*__REVIEW_DATA__*/null"

DEFAULT_PORT = 3118
PORT_TRIES = 10  # 既定のポートから数えて試す数。すべて使用中なら OS に空きポートを選ばせる

# 前の版から開いたままのページがつながってくるのを待つ秒数。待っているページは1秒ごとに問い合わせる。
# この間につながらなければ、ブラウザで新しいタブを開く
ATTACH_WAIT = 2.5

# 成果物の変更を見分けるために調べる、HTML・Markdown と同じフォルダ以下のファイル（相対パスで読む CSS や画像）
WATCH_DEPTH = 2
WATCH_MAX_FILES = 300
WATCH_SKIP_DIRS = {"node_modules", "__pycache__"}

# 表示の上限。超えた分は埋め込まず、「全文を開く」で見てもらう
TEXT_PREVIEW_BYTES = 256 * 1024
HTML_EMBED_BYTES = 2 * 1024 * 1024
IMAGE_EMBED_BYTES = 8 * 1024 * 1024
DIR_MAX_FILES = 50

DEFAULT_VERDICTS = [
    {"value": "adopt", "label": "採用", "tone": "good"},
    {"value": "revise", "label": "要修正", "tone": "warn"},
    {"value": "reject", "label": "不採用", "tone": "bad"},
]
TONES = {"good", "warn", "bad", "neutral"}

MARKDOWN_EXT = {".md", ".markdown", ".mdown"}
HTML_EXT = {".html", ".htm"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".avif"}
TABLE_EXT = {".csv", ".tsv"}
MIME_OVERRIDES = {
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".md": "text/plain",
    ".markdown": "text/plain",
    ".ts": "text/plain",
    ".tsx": "text/plain",
}
LANG_BY_EXT = {
    ".py": "python", ".js": "javascript", ".mjs": "javascript", ".ts": "typescript",
    ".tsx": "tsx", ".jsx": "jsx", ".json": "json", ".css": "css", ".sql": "sql",
    ".sh": "shell", ".ps1": "powershell", ".java": "java", ".go": "go", ".rs": "rust",
    ".rb": "ruby", ".c": "c", ".h": "c", ".cpp": "cpp", ".cs": "csharp", ".kt": "kotlin",
    ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".xml": "xml", ".csv": "csv",
    ".tsv": "tsv", ".txt": "text", ".log": "text",
}


class ManifestError(Exception):
    """マニフェストが読めない、または形式が誤っている。"""


# ---------------------------------------------------------------------------
# 入出力の共通処理
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return _dt.datetime.now().astimezone().isoformat(timespec="seconds")


def read_json(path: Path) -> object:
    # utf-8-sig: PowerShell などが付ける BOM があっても読めるようにする
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: object) -> None:
    """途中で止まっても壊れたファイルを残さないよう、一時ファイルに書いてから置き換える。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def embed_json(data: object) -> str:
    """ページの <script> に埋め込む JSON。

    成果物に "</script>" が含まれていてもスクリプトが途中で閉じないよう、"<" を \\u003c にする。
    U+2028/U+2029 も古いブラウザで文字列リテラルを壊すため逃がしておく。
    """
    text = json.dumps(data, ensure_ascii=False)
    return text.replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def decode_text(raw: bytes) -> tuple[str, str]:
    """成果物のテキストを読む。UTF-8 で読めなければ cp932（Excel の CSV など）を試す。"""
    for enc in ("utf-8-sig", "cp932"):
        try:
            return raw.decode(enc), ("utf-8" if enc == "utf-8-sig" else enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace"), "utf-8 (一部の文字を置き換えて表示)"


def looks_binary(raw: bytes) -> bool:
    return b"\x00" in raw[:8192]


def mime_of(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in MIME_OVERRIDES:
        return MIME_OVERRIDES[ext]
    mime, _ = mimetypes.guess_type(path.name)
    return mime or "application/octet-stream"


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


# ---------------------------------------------------------------------------
# マニフェスト
# ---------------------------------------------------------------------------

def normalize_verdict_config(raw: object) -> dict:
    """判定欄の設定を {enabled, options[]} にそろえる。"""
    if raw is None:
        return {"enabled": True, "options": [dict(o) for o in DEFAULT_VERDICTS]}
    if raw is False:
        return {"enabled": False, "options": []}
    if not isinstance(raw, dict):
        raise ManifestError('"verdict" はオブジェクトか false にしてください')
    enabled = raw.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ManifestError('"verdict.enabled" は true か false にしてください')
    raw_options = raw.get("options")
    if raw_options is None:
        options = [dict(o) for o in DEFAULT_VERDICTS]
    else:
        if not isinstance(raw_options, list) or not raw_options:
            raise ManifestError('"verdict.options" は1つ以上の選択肢の配列にしてください')
        options = []
        for i, opt in enumerate(raw_options):
            if isinstance(opt, str):
                opt = {"value": opt, "label": opt}
            if not isinstance(opt, dict) or not opt.get("value"):
                raise ManifestError(f'"verdict.options[{i}]" には "value" が必要です')
            value = str(opt["value"])
            label = str(opt.get("label") or value)
            tone = opt.get("tone", "neutral")
            if tone not in TONES:
                tone = "neutral"
            options.append({"value": value, "label": label, "tone": tone})
        values = [o["value"] for o in options]
        if len(set(values)) != len(values):
            raise ManifestError('"verdict.options" の value が重複しています')
    return {"enabled": enabled, "options": options if enabled else []}


def load_manifest(path: Path) -> dict:
    """review.json を読み、項目・グループ・判定の設定を検査してそろえる。"""
    if not path.is_file():
        raise ManifestError(f"マニフェストが見つかりません: {path}")
    try:
        raw = read_json(path)
    except json.JSONDecodeError as e:
        raise ManifestError(f"マニフェストの JSON が壊れています（{e.lineno} 行 {e.colno} 列）: {e.msg}") from e
    except OSError as e:
        raise ManifestError(f"マニフェストを読めません: {e}") from e
    if not isinstance(raw, dict):
        raise ManifestError("マニフェストの最上位はオブジェクトにしてください")

    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        raise ManifestError('"items" に1つ以上の項目を書いてください')

    groups: list[dict] = []
    for i, g in enumerate(raw.get("groups") or []):
        if isinstance(g, str):
            g = {"id": g, "label": g}
        if not isinstance(g, dict) or not g.get("id"):
            raise ManifestError(f'"groups[{i}]" には "id" が必要です')
        groups.append({"id": str(g["id"]), "label": str(g.get("label") or g["id"]),
                       "description": str(g.get("description") or "")})
    known_groups = {g["id"] for g in groups}

    items: list[dict] = []
    seen: set[str] = set()
    for i, it in enumerate(items_raw):
        if not isinstance(it, dict):
            raise ManifestError(f'"items[{i}]" はオブジェクトにしてください')
        item_id = it.get("id")
        if not item_id:
            raise ManifestError(f'"items[{i}]" に "id" がありません')
        item_id = str(item_id)
        if item_id in seen:
            raise ManifestError(f'項目の id が重複しています: "{item_id}"')
        seen.add(item_id)
        files = it.get("files", [])
        if isinstance(files, str):
            files = [files]
        if not isinstance(files, list):
            raise ManifestError(f'"items[{i}].files" はパスの配列にしてください')
        norm_files = []
        for j, f in enumerate(files):
            if isinstance(f, str):
                f = {"path": f}
            if not isinstance(f, dict) or not f.get("path"):
                raise ManifestError(f'"items[{i}].files[{j}]" には "path" が必要です')
            norm_files.append({"path": str(f["path"]), "label": f.get("label"), "type": f.get("type")})
        group = it.get("group")
        group = str(group) if group not in (None, "") else None
        if group and group not in known_groups:
            # groups に書かれていないグループは、表示名＝id として末尾に足す
            groups.append({"id": group, "label": group, "description": ""})
            known_groups.add(group)
        items.append({
            "id": item_id,
            "title": str(it.get("title") or item_id),
            "description": str(it.get("description") or ""),
            "group": group,
            "files": norm_files,
        })

    # 一覧と移動の順序は「グループの順 → グループ内はマニフェストの順 → グループなし」にする
    order = {g["id"]: n for n, g in enumerate(groups)}
    items.sort(key=lambda x: order.get(x["group"], len(groups)) if x["group"] else len(groups) + 1)

    return {
        "title": str(raw.get("title") or "成果物レビュー"),
        "instructions": str(raw.get("instructions") or ""),
        "verdict": normalize_verdict_config(raw.get("verdict")),
        "groups": groups,
        "items": items,
        "previous_feedback": raw.get("previous_feedback"),
    }


# ---------------------------------------------------------------------------
# 成果物ファイル
# ---------------------------------------------------------------------------

def resolve_item_files(manifest_dir: Path, item: dict) -> list[dict]:
    """項目のファイル指定を実在のファイルの一覧に展開する。フォルダは中のファイルに広げる。"""
    out = []
    for spec in item["files"]:
        p = Path(spec["path"]).expanduser()
        if not p.is_absolute():
            p = manifest_dir / p
        if p.is_dir():
            found = sorted(
                q for q in p.rglob("*")
                if q.is_file() and not any(part.startswith(".") for part in q.relative_to(p).parts)
            )
            for q in found[:DIR_MAX_FILES]:
                out.append({"abs": q, "label": str(q.relative_to(p.parent)).replace("\\", "/"),
                            "type": None, "spec": spec["path"]})
            if len(found) > DIR_MAX_FILES:
                out.append({"abs": None, "label": spec["path"], "type": "note", "spec": spec["path"],
                            "note": f"フォルダ内のファイルが多いため、先頭の {DIR_MAX_FILES} 件だけを表示しています（全 {len(found)} 件）"})
        else:
            out.append({"abs": p, "label": spec.get("label") or spec["path"],
                        "type": spec.get("type"), "spec": spec["path"]})
    return out


def watched_neighbors(base: Path, limit: int) -> list[os.DirEntry]:
    """HTML や Markdown と同じフォルダ以下のファイル（深さ WATCH_DEPTH まで、limit 件まで）。

    HTML が相対パスで読む CSS や画像だけを直したときも、変更として見分けるために使う。
    隠しフォルダや node_modules は見ない（大きなフォルダで問い合わせが重くならないように）。
    """
    found: list[os.DirEntry] = []
    stack = [(base, 0)]
    while stack and len(found) < limit:
        folder, depth = stack.pop()
        try:
            entries = sorted(os.scandir(folder), key=lambda e: e.name)
        except OSError:
            continue
        for e in entries:
            if e.name.startswith(".") or e.name in WATCH_SKIP_DIRS:
                continue
            try:
                if e.is_dir(follow_symlinks=False):
                    if depth < WATCH_DEPTH:
                        stack.append((Path(e.path), depth + 1))
                elif e.is_file():
                    found.append(e)
                    if len(found) >= limit:
                        break
            except OSError:
                continue
    return found


def detect_kind(path: Path, forced: str | None) -> str:
    if forced in {"markdown", "html", "image", "text", "table", "binary"}:
        return forced
    ext = path.suffix.lower()
    if ext in MARKDOWN_EXT:
        return "markdown"
    if ext in HTML_EXT:
        return "html"
    if ext in IMAGE_EXT:
        return "image"
    if ext in TABLE_EXT:
        return "table"
    return "text"


def build_file_entry(f: dict, raw_url: str | None) -> dict:
    """1つの成果物ファイルを、ページで表示できる形に変換する。"""
    entry = {"label": f["label"], "path": str(f["abs"]) if f["abs"] else f["spec"], "raw_url": raw_url}
    if f.get("type") == "note":
        entry.update(kind="note", note=f["note"])
        return entry
    p: Path = f["abs"]
    if not p.exists():
        entry.update(kind="missing", error=f"ファイルが見つかりません: {p}")
        return entry
    if not p.is_file():
        entry.update(kind="missing", error=f"ファイルではありません: {p}")
        return entry
    size = p.stat().st_size
    entry["size"] = size
    entry["size_label"] = human_size(size)
    entry["file_uri"] = p.resolve().as_uri()
    kind = detect_kind(p, f.get("type"))
    entry["lang"] = LANG_BY_EXT.get(p.suffix.lower(), "")

    try:
        if kind == "image":
            entry["kind"] = "image"
            if size > IMAGE_EMBED_BYTES:
                entry["too_large"] = True
            else:
                b64 = base64.b64encode(p.read_bytes()).decode("ascii")
                entry["data_uri"] = f"data:{mime_of(p)};base64,{b64}"
            return entry

        with p.open("rb") as fh:
            limit = HTML_EMBED_BYTES if kind == "html" else TEXT_PREVIEW_BYTES
            raw = fh.read(limit + 1)
        if looks_binary(raw):
            entry["kind"] = "binary"
            entry["mime"] = mime_of(p)
            return entry
        truncated = len(raw) > limit
        if truncated:
            raw = raw[:limit]
            cut = raw.rfind(b"\n")
            if cut > limit // 2:
                raw = raw[:cut].rstrip(b"\r")
        text, encoding = decode_text(raw)
        entry.update(kind=kind, text=text, truncated=truncated, encoding=encoding)
        if truncated:
            entry["shown_label"] = human_size(len(raw))
    except OSError as e:
        entry.update(kind="missing", error=f"ファイルを読めません: {e}")
    return entry


# ---------------------------------------------------------------------------
# 前回と今回のフィードバック
# ---------------------------------------------------------------------------

def load_previous(path: Path | None) -> tuple[dict, dict]:
    """前回の feedback.json を読み、項目 id → 前回のレビュー の辞書にする。"""
    if not path:
        return {}, {}
    try:
        data = read_json(path)
    except (OSError, json.JSONDecodeError) as e:
        print(f"[warn] 前回のフィードバックを読めません: {path} ({e})", file=sys.stderr)
        return {}, {}
    reviews = {}
    for r in data.get("reviews", []) if isinstance(data, dict) else []:
        if isinstance(r, dict) and r.get("id"):
            reviews[str(r["id"])] = {
                "verdict": r.get("verdict"),
                "verdict_label": r.get("verdict_label") or r.get("verdict"),
                "comment": r.get("comment") or "",
            }
    meta = {
        "path": str(path),
        "overall_comment": (data.get("overall_comment") or "") if isinstance(data, dict) else "",
        "updated_at": data.get("updated_at") if isinstance(data, dict) else None,
    }
    return reviews, meta


def normalize_feedback(payload: dict, manifest: dict, manifest_path: Path, previous: dict) -> dict:
    """ページから届いた判定とコメントを、マニフェストの全項目を含む形にそろえる。

    ページ側に不具合があっても、エージェントが全項目の状態を確かめられるよう、
    サーバー側で全項目を並べ直す。判定の付いていない項目は verdict を null にする。
    """
    status = "complete" if payload.get("status") == "complete" else "in_progress"
    options = {o["value"]: o["label"] for o in manifest["verdict"]["options"]}
    incoming = {}
    for r in payload.get("reviews") or []:
        if isinstance(r, dict) and r.get("id") is not None:
            incoming[str(r["id"])] = r

    reviews = []
    for item in manifest["items"]:
        r = incoming.pop(item["id"], {})
        verdict = r.get("verdict")
        if verdict not in options:
            verdict = None
        prev = previous.get(item["id"])
        reviews.append({
            "id": item["id"],
            "title": item["title"],
            "group": item["group"],
            "verdict": verdict,
            "verdict_label": options.get(verdict) if verdict else None,
            "comment": str(r.get("comment") or ""),
            "viewed": bool(r.get("viewed")),
            "previous_verdict": prev.get("verdict") if prev else None,
        })

    result = {
        "status": status,
        "updated_at": now_iso(),
        "title": manifest["title"],
        "manifest": str(manifest_path),
        "verdict_enabled": manifest["verdict"]["enabled"],
        "verdict_options": manifest["verdict"]["options"],
        "overall_comment": str(payload.get("overall_comment") or ""),
        "summary": summarize(reviews, manifest),
        "reviews": reviews,
    }
    # マニフェストから消えた項目へのコメントは、捨てずに別枠で残す
    leftovers = [
        {"id": k, "verdict": v.get("verdict"), "comment": str(v.get("comment") or "")}
        for k, v in incoming.items() if v.get("verdict") or v.get("comment")
    ]
    if leftovers:
        result["removed_items"] = leftovers
    return result


def summarize(reviews: list[dict], manifest: dict) -> dict:
    counts = {o["value"]: 0 for o in manifest["verdict"]["options"]}
    unjudged = 0
    for r in reviews:
        if r["verdict"]:
            counts[r["verdict"]] += 1
        else:
            unjudged += 1
    return {
        "total": len(reviews),
        "counts": counts,
        "unjudged": unjudged if manifest["verdict"]["enabled"] else None,
        "commented": sum(1 for r in reviews if r["comment"].strip()),
        "untouched": sum(1 for r in reviews if not r["verdict"] and not r["comment"].strip()),
        "not_viewed": sum(1 for r in reviews if not r["viewed"]),
    }


# ---------------------------------------------------------------------------
# ページの組み立て
# ---------------------------------------------------------------------------

class ReviewContext:
    """マニフェストの場所と保存先など、起動中に変わらない設定。"""

    def __init__(self, manifest_path: Path, feedback_path: Path, previous_path: Path | None,
                 mode: str):
        self.manifest_path = manifest_path
        self.manifest_dir = manifest_path.parent
        self.feedback_path = feedback_path
        self.previous_path_arg = previous_path
        self.mode = mode
        self.lock = threading.Lock()
        self.port: int | None = None
        self.completed = False
        # このサーバーの起動ごとに変わる値。ページは自分の知っている値と比べ、
        # 違えば「サーバーが替わった（次の版か、起動し直し）」と判断する
        self.session = secrets.token_hex(8)
        self.page_seen = False          # ページから一度でも問い合わせが来たか
        self.accept_carryover = True    # 前の版から開いたままのページを受け入れるか
        self.attach_announced = False   # 前の版のページがつながったことを出力したか

    def previous_path(self, manifest: dict) -> Path | None:
        if self.previous_path_arg:
            return self.previous_path_arg
        p = manifest.get("previous_feedback")
        if p:
            p = Path(p).expanduser()
            return p if p.is_absolute() else (self.manifest_dir / p).resolve()
        return None

    def load(self) -> tuple[dict, list[list[dict]], dict, dict]:
        manifest = load_manifest(self.manifest_path)
        resolved = [resolve_item_files(self.manifest_dir, it) for it in manifest["items"]]
        previous, prev_meta = load_previous(self.previous_path(manifest))
        return manifest, resolved, previous, prev_meta

    def build_page_data(self) -> dict:
        # 内容を読む前に、変更を見分ける値を取っておく。読んでいる途中でファイルが変わっても、
        # ページは次の問い合わせで値の違いに気づき、もう一度読み直せる
        version = self.version()
        manifest, resolved, previous, prev_meta = self.load()
        items = []
        for idx, (item, files) in enumerate(zip(manifest["items"], resolved)):
            entries = []
            for fidx, f in enumerate(files):
                raw_url = None
                if self.mode == "server" and f.get("abs") is not None:
                    raw_url = f"/raw/{idx}/{fidx}/{quote(f['abs'].name)}"
                entries.append(build_file_entry(f, raw_url))
            items.append({**item, "files": entries, "previous": previous.get(item["id"])})
        return {
            "mode": self.mode,
            "title": manifest["title"],
            "instructions": manifest["instructions"],
            "verdict": manifest["verdict"],
            "groups": manifest["groups"],
            "items": items,
            "previous_meta": prev_meta or None,
            "manifest_path": str(self.manifest_path),
            "feedback_path": str(self.feedback_path),
            "storage_key": "review-viewer:" + str(self.manifest_path),
            "generated_at": now_iso(),
            "session": self.session,
            "version": version,
        }

    def version(self) -> str:
        """review.json・成果物・前回のフィードバックのどれかが変わると変わる値。

        ファイルの更新時刻と大きさから作る。ページはこの値を問い合わせ、変わっていれば
        読み込み直さずに描き直す。feedback.json はページ自身が書くので含めない。
        """
        skip = {self.feedback_path, self.feedback_path.with_name(self.feedback_path.name + ".tmp")}
        h = hashlib.sha1()

        def add(path: Path | None, st: os.stat_result | None = None) -> None:
            if path is None:
                return
            try:
                if st is None:
                    if path.resolve() in skip:
                        return
                    st = path.stat()
                h.update(f"{path}\0{st.st_mtime_ns}\0{st.st_size}\n".encode("utf-8", "replace"))
            except OSError:
                h.update(f"{path}\0-\n".encode("utf-8", "replace"))

        add(self.manifest_path)
        manifest = load_manifest(self.manifest_path)
        budget = WATCH_MAX_FILES
        watched: set[Path] = set()
        for item in manifest["items"]:
            for f in resolve_item_files(self.manifest_dir, item):
                path = f.get("abs")
                add(path)
                if path is None or path.suffix.lower() not in MARKDOWN_EXT | HTML_EXT or budget <= 0:
                    continue
                try:
                    base = path.resolve().parent
                except OSError:
                    continue
                if base in watched:
                    continue
                watched.add(base)
                for e in watched_neighbors(base, budget):
                    budget -= 1
                    q = Path(e.path)
                    if q not in skip:
                        try:
                            add(q, e.stat())
                        except OSError:
                            add(q)
        add(self.previous_path(manifest))
        return h.hexdigest()[:16]

    def render(self) -> str:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        if PLACEHOLDER not in template:
            raise RuntimeError(f"テンプレートに {PLACEHOLDER} がありません: {TEMPLATE_PATH}")
        return template.replace(PLACEHOLDER, embed_json(self.build_page_data()), 1)

    def raw_file(self, item_idx: int, file_idx: int, rest: str) -> Path | None:
        """/raw/<項目>/<ファイル>/<名前> に対応するファイル。

        マニフェストに載っているファイルと、そのファイルと同じフォルダ以下のファイル
        （HTML が相対パスで読む CSS や画像）だけを返す。それ以外のパスは返さない。
        """
        manifest = load_manifest(self.manifest_path)
        if not (0 <= item_idx < len(manifest["items"])):
            return None
        files = resolve_item_files(self.manifest_dir, manifest["items"][item_idx])
        if not (0 <= file_idx < len(files)) or files[file_idx].get("abs") is None:
            return None
        target: Path = files[file_idx]["abs"].resolve()
        if rest == target.name:
            return target if target.is_file() else None
        base = target.parent
        candidate = (base / rest).resolve()
        try:
            candidate.relative_to(base)
        except ValueError:
            return None
        return candidate if candidate.is_file() else None


def error_page(message: str) -> str:
    esc = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (
        "<!doctype html><html lang='ja'><meta charset='utf-8'><title>レビュー画面のエラー</title>"
        "<body style='font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;"
        "line-height:1.7'><h1 style='font-size:20px'>レビュー対象を読み込めませんでした</h1>"
        f"<pre style='white-space:pre-wrap;background:#f4f4f5;padding:12px;border-radius:6px'>{esc}</pre>"
        "<p>エージェントが review.json を書き直している途中の可能性があります。"
        "少し待ってからこのページを再読み込みしてください。</p></body></html>"
    )


# ---------------------------------------------------------------------------
# HTTP サーバー
# ---------------------------------------------------------------------------

class ReviewHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows の SO_REUSEADDR は「使用中のポートにも重ねて bind できる」という意味になり、
    # ポートの衝突を検出できなくなる。そのため Windows では使わず、排他指定にする。
    allow_reuse_address = os.name != "nt"

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class ReviewHandler(BaseHTTPRequestHandler):
    server_version = "ReviewViewer/1.0"

    def __init__(self, ctx: ReviewContext, *args, **kwargs):
        self.ctx = ctx
        super().__init__(*args, **kwargs)

    # --- 共通 ---------------------------------------------------------------

    def _allowed_hosts(self) -> set[str]:
        port = self.ctx.port
        return {f"127.0.0.1:{port}", f"localhost:{port}"}

    def _host_ok(self) -> bool:
        # DNS リバインディング対策: 自分宛ての Host ヘッダーの要求だけに答える
        host = self.headers.get("Host")
        return host is None or host in self._allowed_hosts()

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, data: object) -> None:
        self._send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass  # 要求ごとのログは出さない（バックグラウンドの出力を読みやすく保つ）

    # --- GET ----------------------------------------------------------------

    def do_GET(self) -> None:
        if not self._host_ok():
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        parts = urlsplit(self.path)
        path = parts.path
        if path in ("/", "/index.html"):
            with self.ctx.lock:
                self.ctx.page_seen = True
            try:
                html = self.ctx.render()
                self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")
            except ManifestError as e:
                self._send(500, error_page(str(e)).encode("utf-8"), "text/html; charset=utf-8")
            return
        if path == "/api/state":
            self._serve_state((parse_qs(parts.query).get("session") or [""])[0])
            return
        if path == "/api/data":
            try:
                self._send_json(200, self.ctx.build_page_data())
            except ManifestError as e:
                self._send_json(500, {"error": str(e)})
            return
        if path == "/api/feedback":
            data: object = {}
            with self.ctx.lock:
                if self.ctx.feedback_path.exists():
                    try:
                        data = read_json(self.ctx.feedback_path)
                    except (OSError, json.JSONDecodeError):
                        data = {}
            self._send_json(200, data)
            return
        if path.startswith("/raw/"):
            self._serve_raw(path)
            return
        if path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
            return
        self._send(404, b"not found", "text/plain; charset=utf-8")

    def _serve_state(self, known: str) -> None:
        """ページからの問い合わせ。このサーバーの起動の識別子と、成果物の変更を見分ける値を返す。

        known はページが知っている識別子。違う値なら、前の版（または前の起動）から開いたままの
        ページがつながってきたことを表す。新しいタブを開いた後につながってきたページは、
        二重に保存しないよう superseded（使わない）として返す。
        """
        carry = bool(known) and known != self.ctx.session
        announce = False
        with self.ctx.lock:
            superseded = carry and not self.ctx.accept_carryover
            if not superseded:
                self.ctx.page_seen = True
                if carry and not self.ctx.attach_announced:
                    self.ctx.attach_announced = announce = True
        if announce:
            print("ATTACHED: 開いていたレビュー画面が、この版の表示に切り替わります（新しいタブは開きません）", flush=True)
        if superseded:
            self._send_json(200, {"session": self.ctx.session, "superseded": True})
            return
        try:
            version, error = self.ctx.version(), None
        except ManifestError as e:
            version, error = None, str(e)
        self._send_json(200, {"session": self.ctx.session, "version": version,
                              "completed": self.ctx.completed, "error": error})

    def _serve_raw(self, path: str) -> None:
        parts = path.split("/", 4)  # ["", "raw", item, file, rest]
        if len(parts) < 5:
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        try:
            item_idx, file_idx = int(parts[2]), int(parts[3])
            target = self.ctx.raw_file(item_idx, file_idx, unquote(parts[4]))
        except (ValueError, ManifestError):
            target = None
        if target is None:
            self._send(404, "ファイルが見つかりません".encode("utf-8"), "text/plain; charset=utf-8")
            return
        ctype = mime_of(target)
        if ctype.startswith("text/") or ctype in ("application/json", "application/javascript",
                                                  "image/svg+xml", "application/xml"):
            ctype += "; charset=utf-8"
        # 成果物を直接開いても、スクリプトがこのサーバーの API を使えないよう、
        # 独立した（オリジンを持たない）文書として扱わせる
        self._send(200, target.read_bytes(), ctype,
                   {"Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms",
                    "X-Content-Type-Options": "nosniff"})

    # --- POST ---------------------------------------------------------------

    def do_POST(self) -> None:
        if not self._host_ok():
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        if urlsplit(self.path).path != "/api/feedback":
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        # 成果物の iframe（オリジンは "null"）やほかのサイトから書き込まれないようにする
        origin = self.headers.get("Origin")
        if origin is not None and origin.replace("http://", "") not in self._allowed_hosts():
            self._send_json(403, {"error": "origin not allowed"})
            return
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            self._send_json(415, {"error": "Content-Type must be application/json"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON オブジェクトを送ってください")
            # 前の版の画面が、まだ切り替わる前に送ってきた保存は、この版の feedback.json に書かない
            claimed = payload.get("manifest")
            if claimed and str(claimed) != str(self.ctx.manifest_path):
                self._send_json(409, {"error": "この画面は別の review.json のレビューを表示しています", "stale": True})
                return
            sent_session = self.headers.get("X-Review-Session")
            if sent_session and sent_session != self.ctx.session:
                with self.ctx.lock:
                    accepted = self.ctx.accept_carryover
                    if accepted:
                        self.ctx.page_seen = True
                if not accepted:
                    self._send_json(409, {"error": "このレビューは別のタブで開かれています", "superseded": True})
                    return
            manifest, _resolved, previous, _meta = self.ctx.load()
            feedback = normalize_feedback(payload, manifest, self.ctx.manifest_path, previous)
            with self.ctx.lock:
                if self.ctx.completed:
                    # 完了の後に遅れて届いた途中保存で、完了の記録を上書きしない
                    self._send_json(409, {"error": "レビューは完了済みです"})
                    return
                write_json(self.ctx.feedback_path, feedback)
                if feedback["status"] == "complete":
                    self.ctx.completed = True
        except (ValueError, ManifestError, OSError) as e:
            self._send_json(400, {"error": str(e)})
            return

        self._send_json(200, {"ok": True, "status": feedback["status"],
                              "updated_at": feedback["updated_at"], "summary": feedback["summary"]})
        if feedback["status"] == "complete":
            self.wfile.flush()
            self.server.review_result = feedback  # type: ignore[attr-defined]
            # 応答を返し終えてから止める。shutdown() は serve_forever と別のスレッドから呼ぶ必要がある
            threading.Timer(0.5, self.server.shutdown).start()


def bind_server(handler, port: int) -> ReviewHTTPServer:
    """既定のポートから順に試し、すべて使用中なら OS に空きポートを選ばせる。"""
    candidates = [port + i for i in range(PORT_TRIES)] if port else []
    for p in candidates + [0]:
        try:
            return ReviewHTTPServer(("127.0.0.1", p), handler)
        except OSError:
            continue
    raise OSError("待ち受けるポートを確保できませんでした")


def open_url(url: str) -> bool:
    """ブラウザで URL を開く。REVIEW_VIEWER_BROWSER_LOG があれば、開く代わりにそのファイルへ URL を追記する（テスト用）。"""
    log = os.environ.get("REVIEW_VIEWER_BROWSER_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(url + "\n")
        return True
    try:
        return webbrowser.open(url)
    except Exception:  # noqa: BLE001 - ブラウザを開けない環境では URL の表示だけにする
        return False


def open_browser_when_needed(ctx: ReviewContext, url: str) -> None:
    """前の版から開いたままのページがつながってこなければ、ブラウザで新しく開く。

    完了したページは、次の版のサーバーを待って同じポートに問い合わせ続けている。
    つながれば、そのページとレビュー用ウィンドウがそのまま次の版に切り替わるので、
    新しいタブは開かない（開くと、利用者はレビュー用ウィンドウを開き直すことになる）。
    """
    deadline = time.monotonic() + ATTACH_WAIT
    while time.monotonic() < deadline and not ctx.page_seen:
        time.sleep(0.1)
    with ctx.lock:
        seen, attached = ctx.page_seen, ctx.attach_announced
        if not seen:
            ctx.accept_carryover = False  # この後につながってきた古いページには保存させない
    if seen:
        if not attached:
            print("BROWSER: レビュー画面がすでに開かれていたので、新しいタブは開きませんでした", flush=True)
        return
    if open_url(url):
        print("BROWSER: ブラウザでレビュー画面を開きました", flush=True)
    else:
        print("[info] ブラウザを自動で開けませんでした。上の URL を開いてください。", flush=True)


def print_summary(feedback: dict) -> None:
    s = feedback["summary"]
    labels = {o["value"]: o["label"] for o in feedback.get("verdict_options", [])}
    parts = [f"{labels.get(k, k)} {v}" for k, v in s["counts"].items()]
    if s.get("unjudged") is not None:
        parts.append(f"未判定 {s['unjudged']}")
    print(f"SUMMARY: total={s['total']} " + " / ".join(parts)
          + f" / コメントあり {s['commented']} / 判定もコメントもなし {s['untouched']}", flush=True)


def main() -> int:
    # Windows でも標準出力を UTF-8 にする（パイプ経由で読まれるときに cp932 で化けないように）
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser(description="成果物レビュー画面を起動する")
    ap.add_argument("manifest", type=Path, help="review.json のパス")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"待ち受けるポート（既定 {DEFAULT_PORT}）")
    ap.add_argument("--feedback", type=Path, default=None,
                    help="判定とコメントの保存先（既定: review.json と同じフォルダの feedback.json）")
    ap.add_argument("--previous-feedback", type=Path, default=None,
                    help="前回の feedback.json。各項目に前回の判定とコメントを表示する")
    ap.add_argument("--no-browser", action="store_true", help="ブラウザを自動で開かない")
    ap.add_argument("--static", type=Path, default=None, metavar="OUT_HTML",
                    help="サーバーを起動せず、1つの HTML ファイルを書き出す")
    ap.add_argument("--check", action="store_true", help="マニフェストを検査して内容を表示するだけ")
    args = ap.parse_args()

    manifest_path = args.manifest.expanduser().resolve()
    feedback_path = (args.feedback.expanduser().resolve() if args.feedback
                     else manifest_path.parent / "feedback.json")
    previous_path = args.previous_feedback.expanduser().resolve() if args.previous_feedback else None
    ctx = ReviewContext(manifest_path, feedback_path, previous_path,
                        "static" if args.static else "server")

    try:
        manifest, resolved, previous, prev_meta = ctx.load()
    except ManifestError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    missing = [str(f["abs"]) for files in resolved for f in files
               if f.get("abs") is not None and not f["abs"].exists()]
    for m in missing:
        print(f"[warn] ファイルが見つかりません（画面にはエラーとして表示されます）: {m}", file=sys.stderr)

    if args.check:
        print(f"OK: {manifest['title']} / 項目 {len(manifest['items'])} 件 / "
              f"グループ {len(manifest['groups'])} 件 / ファイル {sum(len(r) for r in resolved)} 件 / "
              f"判定欄 {'あり: ' + '・'.join(o['label'] for o in manifest['verdict']['options']) if manifest['verdict']['enabled'] else 'なし'}"
              + (f" / 前回のレビュー {len(previous)} 件" if previous else ""))
        return 1 if missing else 0

    if args.static:
        out = args.static.expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(ctx.render(), encoding="utf-8")
        print(f"STATIC: {out}")
        print("完了ボタンを押すと feedback.json がブラウザのダウンロードフォルダに保存されます。")
        return 0

    if feedback_path.exists():
        try:
            old = read_json(feedback_path)
            if isinstance(old, dict) and old.get("status") == "complete":
                print(f"[warn] 完了済みの feedback.json が残っています。画面にはその内容が復元されます: {feedback_path}\n"
                      "       新しい版をレビューするなら、別のフォルダに review.json を作り、"
                      "previous_feedback で前回の feedback.json を指定してください。", file=sys.stderr)
        except (OSError, json.JSONDecodeError):
            pass

    try:
        server = bind_server(partial(ReviewHandler, ctx), args.port)
    except OSError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    server.review_result = None  # type: ignore[attr-defined]
    ctx.port = server.server_address[1]
    url = f"http://127.0.0.1:{ctx.port}/"

    if ctx.port != args.port:
        print(f"[info] ポート {args.port} は使用中のため {ctx.port} を使います。")
    print(f"URL: {url}", flush=True)
    print(f"MANIFEST: {manifest_path}")
    print(f"FEEDBACK: {feedback_path}")
    if previous:
        print(f"PREVIOUS: {ctx.previous_path(manifest)}（{len(previous)} 件）")
    print("利用者が「レビュー完了」を押すと、feedback.json を保存してこのサーバーは終了します。", flush=True)

    if not args.no_browser:
        # 前の版のページがつながってくるかを数秒待ってから決めるので、別のスレッドで行う
        threading.Thread(target=open_browser_when_needed, args=(ctx, url), daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("STOPPED: 中断されました（feedback.json には途中までの内容が保存されています）", flush=True)
        return 130
    finally:
        server.server_close()

    result = server.review_result  # type: ignore[attr-defined]
    if result:
        print(f"REVIEW_COMPLETE: {feedback_path}", flush=True)
        print_summary(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
