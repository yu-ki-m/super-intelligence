#!/usr/bin/env python3
"""Render arbitrary trusted HTML blocks and independent original-layout tables.

Python standard library only. Do not run untrusted raw HTML/JavaScript.
"""
from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "assets" / "template.html"
# Scope replacement to the constant immediately before the known renderer-start marker.
ALLOWED_STYLES = {
    "d-light", "d-focus", "d-undecided", "st-done", "st-wip", "st-todo",
    "j-ok", "j-defect", "j-undef", "j-pending", "j-na",
}
ALLOWED_TAGS = {
    "strong", "b", "em", "i", "u", "s", "del", "mark", "br", "p",
    "ul", "ol", "li", "blockquote", "code", "pre", "a", "span", "small",
    "sup", "sub", "div", "kbd", "q",
}
VOID_TAGS = {"br"}
# Text inside these elements is never displayed (not just their tags).
DROP_TAGS = {"script", "style", "iframe", "object", "embed", "svg", "math", "form", "textarea", "template", "noscript"}
CSS_VALUE = re.compile(
    r"^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|"
    r"rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\s*\))$"
)


class ValidationError(ValueError):
    pass


def safe_href(value: str) -> str | None:
    value = value.strip()
    if not value or any(ord(ch) < 32 for ch in value) or value.startswith("//"):
        return None
    parts = urlsplit(value)
    if parts.scheme and parts.scheme.lower() not in {"https", "http", "mailto"}:
        return None
    if parts.netloc and not parts.scheme:
        return None
    return value


def safe_css(value: str) -> str:
    result = []
    for decl in value.split(";"):
        if ":" not in decl:
            continue
        prop, val = [s.strip().lower() for s in decl.split(":", 1)]
        if prop in {"color", "background-color"} and CSS_VALUE.fullmatch(val):
            result.append(f"{prop}: {val}")
        elif prop == "font-weight" and val in {"normal", "bold", "bolder", "lighter", "400", "500", "600", "700", "800", "900"}:
            result.append(f"{prop}: {val}")
        elif prop == "text-decoration" and val in {"underline", "line-through", "none"}:
            result.append(f"{prop}: {val}")
    return "; ".join(result)


class SafeRichHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.open_tags: list[str] = []
        self.drop_stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if self.drop_stack:
            if tag in DROP_TAGS:
                self.drop_stack.append(tag)
            return
        if tag in DROP_TAGS:
            self.drop_stack.append(tag)
            return
        if tag not in ALLOWED_TAGS:
            return
        d = dict(attrs)
        emitted = []
        if tag == "a":
            href = safe_href(d.get("href") or "")
            if href is not None:
                emitted.append(f' href="{html.escape(href, quote=True)}"')
            if d.get("title"):
                emitted.append(f' title="{html.escape(d["title"], quote=True)}"')
            if d.get("target") == "_blank" and href is not None:
                emitted.append(' target="_blank" rel="noopener noreferrer"')
        if tag in {"span", "div"}:
            classes = (d.get("class") or "").split()
            safe_classes = [c for c in classes if c in {"rich-red", "rich-highlight"}]
            if safe_classes:
                emitted.append(f' class="{" ".join(safe_classes)}"')
        if tag in {"span", "div", "p", "strong", "b", "em", "u"}:
            style = safe_css(d.get("style") or "")
            if style:
                emitted.append(f' style="{html.escape(style, quote=True)}"')
        self.out.append(f"<{tag}{''.join(emitted)}>")
        if tag not in VOID_TAGS:
            self.open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str):
        if self.drop_stack:
            if tag == self.drop_stack[-1]:
                self.drop_stack.pop()
            return
        if tag not in ALLOWED_TAGS or tag in VOID_TAGS or tag not in self.open_tags:
            return
        # Close up to matching node to keep HTML balanced.
        while self.open_tags:
            current = self.open_tags.pop()
            self.out.append(f"</{current}>")
            if current == tag:
                break

    def handle_data(self, data: str):
        if not self.drop_stack:
            self.out.append(html.escape(data, quote=False))

    def handle_entityref(self, name: str):
        self.handle_data(f"&{name};")

    def handle_charref(self, name: str):
        self.handle_data(f"&#{name};")

    def finish(self) -> str:
        while self.open_tags:
            self.out.append(f"</{self.open_tags.pop()}>")
        return "".join(self.out)


def sanitize_rich(raw: str) -> str:
    p = SafeRichHTML()
    p.feed(raw)
    p.close()
    return p.finish()


def rich(value, location: str):
    """Validate a rich-text slot, returning a normalized safe representation."""
    if isinstance(value, (str, int, float)) and not isinstance(value, bool):
        return value
    if isinstance(value, dict):
        if set(value) == {"html"} and isinstance(value["html"], str):
            return {"html": sanitize_rich(value["html"])}
        if set(value) == {"text"} and isinstance(value["text"], str):
            return {"text": value["text"]}
    raise ValidationError(f"{location}: 文字列、{{'text': ...}} または {{'html': ...}} が必要です")


def object_keys(o: dict, allowed: set, loc: str):
    unknown = set(o) - allowed
    if unknown:
        raise ValidationError(f"{loc}: 未対応のフィールド {sorted(unknown)}")


def normalize_label(value, loc: str):
    if isinstance(value, dict) and ("style" in value or "text" in value and "html" not in value):
        object_keys(value, {"text", "style"}, loc)
        if "text" not in value:
            raise ValidationError(f"{loc}: text を指定してください")
        style = value.get("style", "d-light")
        if style not in ALLOWED_STYLES:
            raise ValidationError(f"{loc}: 不明なラベルスタイル {style!r}")
        return {"text": rich(value["text"], loc + ".text"), "style": style}
    return {"text": rich(value, loc), "style": "d-light"}


def normalize_refs(value, loc: str):
    if not isinstance(value, list):
        raise ValidationError(f"{loc}: 参照は配列で指定してください")
    out = []
    for i, item in enumerate(value):
        p = f"{loc}[{i}]"
        if isinstance(item, dict) and ("style" in item or "title" in item):
            object_keys(item, {"text", "style", "title"}, p)
            if "text" not in item:
                raise ValidationError(f"{p}: text を指定してください")
            val = {"text": rich(item["text"], p + ".text")}
            if "style" in item:
                if item["style"] not in ALLOWED_STYLES:
                    raise ValidationError(f"{p}: 不明なタグスタイル {item['style']!r}")
                val["style"] = item["style"]
            if "title" in item:
                val["title"] = rich(item["title"], p + ".title")
            out.append(val)
        else:
            out.append({"text": rich(item, p)})
    return out


def normalize_data(data: dict) -> tuple[dict, dict]:
    if not isinstance(data, dict):
        raise ValidationError("入力JSONの最上位はオブジェクトである必要があります")
    object_keys(data, {"title", "banner", "meta", "legend", "columns", "rows"}, "root")
    if "title" not in data:
        raise ValidationError("root.title が必要です")
    result = {
        "title": rich(data["title"], "root.title"),
        "banner": rich(data.get("banner", ""), "root.banner"),
        "legend": rich(data.get("legend", ""), "root.legend"),
        "meta": [], "columns": [], "rows": [],
    }
    meta = data.get("meta", [])
    if not isinstance(meta, list):
        raise ValidationError("root.meta は配列です")
    for i, m in enumerate(meta):
        if not isinstance(m, dict) or set(m) != {"label", "value"}:
            raise ValidationError(f"root.meta[{i}]: label と value が必要です")
        result["meta"].append({"label": rich(m["label"], f"meta[{i}].label"), "value": rich(m["value"], f"meta[{i}].value")})
    cols = data.get("columns")
    if not isinstance(cols, list) or not cols:
        raise ValidationError("root.columns は1列以上の配列で指定してください")
    known = set()
    special = []
    for i, col in enumerate(cols):
        if not isinstance(col, dict):
            raise ValidationError(f"columns[{i}]: オブジェクトが必要です")
        object_keys(col, {"key", "label", "kind"}, f"columns[{i}]")
        key = col.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", key):
            raise ValidationError(f"columns[{i}].key: 英数字で構成されるキーが必要です")
        if key in known:
            raise ValidationError(f"columns[{i}]: 重複キー {key!r}")
        known.add(key)
        kind = col.get("kind", "text")
        if kind not in {"text", "badge", "chips"}:
            raise ValidationError(f"columns[{i}].kind: text/badge/chips のいずれかです")
        if kind != "text":
            special.append((i, kind))
        result["columns"].append({"key": key, "label": rich(col.get("label", key), f"columns[{i}].label"), **({"kind": kind} if kind != "text" else {})})
    if cols[0]["key"] != "name" or cols[0].get("kind", "text") != "text":
        raise ValidationError("最初の列は key='name' の階層名列にしてください")
    # Historically established layout: all badge/chips columns are at the right.
    if special and min(i for i, _ in special) != len(cols) - len(special):
        raise ValidationError("ラベル・参照の列（badge/chips）は通常の列の右側に並べてください")
    if [kind for _, kind in special] != sorted([kind for _, kind in special], key={"badge": 0, "chips": 1}.get):
        raise ValidationError("右端のラベル（badge）→参照（chips）の順で指定してください")
    col_map = {col["key"]: col.get("kind", "text") for col in result["columns"]}
    rows = data.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValidationError("root.rows は1件以上の配列で指定してください")
    metrics = {"rows": 0, "groups": 0, "leaves": 0, "depth": 0}

    def walk(nodes: list, depth: int):
        if depth > 100:
            raise ValidationError("階層が深すぎます（100階層を超えています）")
        out = []
        for i, row in enumerate(nodes):
            p = f"rows(depth={depth})[{i}]"
            if not isinstance(row, dict):
                raise ValidationError(f"{p}: オブジェクトが必要です")
            object_keys(row, {"name", "children", "cells", "layout"}, p)
            if "name" not in row:
                raise ValidationError(f"{p}.name が必要です")
            value = {"name": rich(row["name"], p + ".name")}
            children = row.get("children")
            is_group = isinstance(children, list) and len(children) > 0
            if children is not None and not isinstance(children, list):
                raise ValidationError(f"{p}.children: 配列が必要です")
            cells = row.get("cells", {})
            if not isinstance(cells, dict):
                raise ValidationError(f"{p}.cells: オブジェクトが必要です")
            if "name" in cells:
                raise ValidationError(f"{p}.cells.name: 項目名は row.name で指定してください")
            extra = set(cells) - set(col_map)
            if extra:
                raise ValidationError(f"{p}.cells: 未定義の列キー {sorted(extra)}")
            layout = row.get("layout")
            if layout is not None and layout not in {"merged", "columns"}:
                raise ValidationError(f"{p}.layout: 'merged' または 'columns' にしてください")
            if not is_group and layout is not None:
                raise ValidationError(f"{p}.layout: children のあるグループ行だけ指定できます")
            if is_group and layout == "merged" and cells:
                raise ValidationError(f"{p}: layout='merged' の場合、cells は指定できません")
            # 明示指定が無ければセルの有無から表示形式を選ぶ。
            # cells を持たない従来のグループは全列結合表示を維持する。
            as_columns = is_group and (layout == "columns" or (layout is None and bool(cells)))
            if is_group and as_columns:
                value["layout"] = "columns"
            if cells or not is_group or as_columns:
                processed = {}
                for key, content in cells.items():
                    kind = col_map[key]
                    if kind == "badge":
                        processed[key] = normalize_label(content, f"{p}.cells.{key}")
                    elif kind == "chips":
                        processed[key] = normalize_refs(content, f"{p}.cells.{key}")
                    else:
                        processed[key] = rich(content, f"{p}.cells.{key}")
                value["cells"] = processed
            if is_group:
                value["children"] = walk(children, depth + 1)
                metrics["groups"] += 1
            else:
                metrics["leaves"] += 1
            metrics["rows"] += 1
            metrics["depth"] = max(metrics["depth"], depth + 1)
            out.append(value)
        return out

    result["rows"] = walk(rows, 0)
    return result, metrics



# Raw HTML is intentionally not sanitized. It is a separate explicit, trusted
# authoring channel. All rich HTML inside table text cells remains sanitized.
INJECTION_RE = re.compile(r"<!-- INJECT_(HEAD_HTML|CONTENT_BLOCKS|PAGE_DATA|TAIL_HTML) -->")
TABLE_ID_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]*\Z")


def raw_fragment(block: dict, where: str, base_dir: Path) -> str:
    choices = ("html" in block) + ("html_file" in block)
    if choices != 1:
        raise ValidationError(f"{where}: html または html_file をちょうど1つ指定してください")
    if "html" in block:
        if not isinstance(block["html"], str):
            raise ValidationError(f"{where}.html は文字列が必要です")
        return block["html"]
    path = block["html_file"]
    if not isinstance(path, str) or not path:
        raise ValidationError(f"{where}.html_file はファイルパス文字列が必要です")
    # Restrict reading to paths under the input JSON's directory, so a fetched
    # untrusted JSON cannot arbitrarily load files elsewhere on disk.
    rel = Path(path)
    if rel.is_absolute() or not (base_dir / rel).resolve().is_relative_to(base_dir.resolve()):
        raise ValidationError(f"{where}.html_file は入力JSONのあるフォルダ以下の相対パスにしてください")
    try:
        return (base_dir / rel).read_text(encoding="utf-8")
    except (OSError, UnicodeError) as ex:
        raise ValidationError(f"{where}.html_file を読み込めません: {ex}") from ex


def normalize_document(data: dict, base_dir: Path) -> tuple[dict, list[dict], dict]:
    if not isinstance(data, dict):
        raise ValidationError("root: JSONオブジェクトが必要です")
    object_keys(data, {"title", "banner", "legend", "meta", "blocks", "columns", "rows", "head_html", "tail_html"}, "root")
    if "title" not in data:
        raise ValidationError("root.title が必要です")
    page = {
        "title": rich(data["title"], "root.title"),
        "banner": rich(data.get("banner", ""), "root.banner"),
        "legend": rich(data.get("legend", ""), "root.legend"),
        "meta": [],
    }
    if not isinstance(data.get("head_html", ""), str) or not isinstance(data.get("tail_html", ""), str):
        raise ValidationError("root.head_html / tail_html はHTML文字列で指定してください")
    head_html = data.get("head_html", "")
    tail_html = data.get("tail_html", "")
    meta = data.get("meta", [])
    if not isinstance(meta, list):
        raise ValidationError("root.meta は配列で指定してください")
    for i, m in enumerate(meta):
        if not isinstance(m, dict) or set(m) != {"label", "value"}:
            raise ValidationError(f"root.meta[{i}]: label と value を指定してください")
        page["meta"].append({
            "label": rich(m["label"], f"root.meta[{i}].label"),
            "value": rich(m["value"], f"root.meta[{i}].value"),
        })
    if "blocks" in data:
        if "columns" in data or "rows" in data:
            raise ValidationError("root: blocks と旧形式の columns/rows は同時には指定できません")
        blocks = data["blocks"]
    else:
        if "columns" not in data or "rows" not in data:
            raise ValidationError("root.blocks、または従来形式の columns と rows が必要です")
        blocks = [{"type": "table", "columns": data["columns"], "rows": data["rows"]}]
    if not isinstance(blocks, list) or not blocks:
        raise ValidationError("root.blocks は1つ以上のブロックを持つ配列です")

    normalized_blocks = []
    tables = []
    table_ids = set()
    stats = {"blocks": len(blocks), "tables": 0, "html_blocks": 0, "rows": 0, "groups": 0, "leaves": 0, "depth": 0}
    for index, block in enumerate(blocks):
        at = f"root.blocks[{index}]"
        if not isinstance(block, dict):
            raise ValidationError(f"{at}: オブジェクトが必要です")
        kind = block.get("type")
        if kind == "html":
            object_keys(block, {"type", "html", "html_file"}, at)
            normalized_blocks.append({"type": "html", "html": raw_fragment(block, at, base_dir)})
            stats["html_blocks"] += 1
        elif kind == "table":
            object_keys(block, {"type", "id", "title", "intro", "columns", "rows"}, at)
            table_id = block.get("id", f"table-{stats['tables']+1}")
            if not isinstance(table_id, str) or not TABLE_ID_RE.fullmatch(table_id):
                raise ValidationError(f"{at}.id: 英数字とハイフン/アンダースコアからなるIDが必要です")
            if table_id in table_ids:
                raise ValidationError(f"{at}.id: 重複ID {table_id!r}")
            table_ids.add(table_id)
            if "columns" not in block or "rows" not in block:
                raise ValidationError(f"{at}: columns と rows が必要です")
            normalized, m = normalize_data({
                "title": block.get("title", ""),
                "columns": block["columns"],
                "rows": block["rows"],
            })
            table = {
                "id": table_id,
                "title": normalized["title"],
                "intro": rich(block.get("intro", ""), at + ".intro"),
                "columns": normalized["columns"],
                "rows": normalized["rows"],
            }
            tables.append(table)
            normalized_blocks.append({"type": "table", "id": table_id, "has_title": "title" in block, "has_intro": "intro" in block})
            stats["tables"] += 1
            stats["rows"] += m["rows"]
            stats["groups"] += m["groups"]
            stats["leaves"] += m["leaves"]
            stats["depth"] = max(stats["depth"], m["depth"])
        else:
            raise ValidationError(f"{at}.type: 'table' または 'html' にしてください")
    return {"page": page, "blocks": normalized_blocks, "head_html": head_html, "tail_html": tail_html}, tables, stats


def js_literal(data) -> str:
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    # Escape < > & and line separators to avoid breaking out of script raw text.
    for ch, val in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"),
                    ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        payload = payload.replace(ch, val)
    return payload


def embed(template: str, document: dict, tables: list[dict]) -> str:
    content = []
    for block in document["blocks"]:
        if block["type"] == "html":
            content.append(block["html"])
        else:
            bid = html.escape(block["id"], quote=True)
            heading = '<h2 class="table-title rich-content"></h2>' if block["has_title"] else ""
            intro = '<div class="table-intro rich-content"></div>' if block["has_intro"] else ""
            content.append(
                f'<section class="table-section" data-table-id="{bid}">'
                f'{heading}{intro}'
                '<div class="panel"><table class="tree"><thead><tr></tr></thead>'
                '<tbody></tbody></table></div></section>'
            )
    replacements = {
        "HEAD_HTML": document["head_html"],
        "CONTENT_BLOCKS": "\n".join(content),
        "PAGE_DATA": f"const PAGE_DATA = {js_literal(document['page'])};\nconst TABLES_DATA = {js_literal(tables)};",
        "TAIL_HTML": document["tail_html"],
    }
    counts = {k: 0 for k in replacements}
    def substitute(match):
        name = match.group(1)
        counts[name] += 1
        return replacements[name]
    result = INJECTION_RE.sub(substitute, template)
    if any(n != 1 for n in counts.values()):
        raise ValidationError(f"テンプレートの挿入ポイントが不正です: {counts}")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="任意HTMLと複数の独立した階層テーブルを結合する")
    parser.add_argument("--input", "-i", required=True, help="入力JSONパス")
    parser.add_argument("--output", "-o", help="出力HTMLパス")
    parser.add_argument("--validate-only", action="store_true", help="JSONと挿入処理を検証")
    parser.add_argument("--overwrite", action="store_true", help="既存成果物の上書きを許可")
    args = parser.parse_args(argv)
    try:
        if args.input == "-":
            source, base_dir = sys.stdin.read(), Path.cwd()
        else:
            inpath = Path(args.input).expanduser().resolve()
            source, base_dir = inpath.read_text(encoding="utf-8-sig"), inpath.parent
        doc, tables, stats = normalize_document(json.loads(source), base_dir)
        output = embed(TEMPLATE.read_text(encoding="utf-8"), doc, tables)
        if not args.validate_only:
            if not args.output:
                raise ValidationError("--output が必要です")
            dest = Path(args.output).expanduser().resolve()
            if dest in {TEMPLATE.resolve(), ROOT / "assets" / "original-hierarchy-table.html"}:
                raise ValidationError("スキルの付属テンプレートを上書きできません")
            if dest.exists() and not args.overwrite:
                raise ValidationError(f"出力先が存在します: {dest}（上書きには --overwrite）")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(output, encoding="utf-8")
            print(f"CREATED {dest}")
        print(f"VALID: {stats['blocks']} ブロック / {stats['tables']} テーブル / {stats['html_blocks']} 自由HTML / "
              f"{stats['rows']} 行 / 最大 {stats['depth']} 階層")
        return 0
    except (OSError, UnicodeError, ValidationError, json.JSONDecodeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
