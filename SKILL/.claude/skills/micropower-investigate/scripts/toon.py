#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TOON (Token-Oriented Object Notation) encoder / decoder.

Targets toon-spec: 4.4 (https://github.com/toon-format/spec, 2026-10-08).
Standard library only.

Host-type mapping (spec 3): dict -> object (keys must be str), list/tuple -> array,
str -> string, bool -> boolean, None -> null, int/float -> number
(NaN/Infinity -> null). Other types raise TypeError.
Numeric policy (spec 4): integer tokens decode to int (arbitrary precision),
tokens with a fraction or exponent decode to float; -0 decodes to 0.
Duplicate keys / prototype keys: Python dicts hold every key as an own entry.

Command line:
  python toon.py check FILE...          strict-decode each file (exit 1 on error)
  python toon.py to-json FILE           decode to JSON on stdout
  python toon.py from-json FILE         encode a JSON file to TOON on stdout
  python toon.py fmt FILE               decode then re-encode in place (canonical form)
"""
import json
import math
import re
import sys
from decimal import Decimal

__all__ = ["encode", "decode", "ToonError", "dumps", "loads"]

TOON_SPEC_VERSION = "4.4"


class ToonError(ValueError):
    def __init__(self, message, line=None):
        self.line = line
        super().__init__(f"line {line}: {message}" if line is not None else message)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_NUMERIC_LIKE = re.compile(r"^[+-]?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$", re.IGNORECASE)
_JSON_NUMBER = re.compile(r"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$")
_UNQUOTED_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
_DELIMS = (",", "\t", "|")


def _escape(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        elif 0xD800 <= o <= 0xDFFF:
            raise ToonError("string contains an unpaired surrogate")
        else:
            out.append(ch)
    return "".join(out)


def _unescape(body, line):
    out = []
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        if i + 1 >= n:
            raise ToonError("unterminated escape sequence", line)
        nx = body[i + 1]
        if nx == "\\":
            out.append("\\")
        elif nx == '"':
            out.append('"')
        elif nx == "n":
            out.append("\n")
        elif nx == "r":
            out.append("\r")
        elif nx == "t":
            out.append("\t")
        elif nx == "u":
            hexpart = body[i + 2:i + 6]
            if len(hexpart) != 4 or not all(c in "0123456789abcdefABCDEF" for c in hexpart):
                raise ToonError("\\u must be followed by four hex digits", line)
            cp = int(hexpart, 16)
            if 0xD800 <= cp <= 0xDFFF:
                raise ToonError("surrogate code point in \\u escape", line)
            out.append(chr(cp))
            i += 6
            continue
        else:
            raise ToonError(f"invalid escape sequence \\{nx}", line)
        i += 2
    return "".join(out)


def _scan(s):
    """Yield (index, char, quoted) for each char; quoted spans per spec 5.2."""
    in_q = False
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if in_q:
            if ch == "\\":
                yield i, ch, True
                if i + 1 < n:
                    yield i + 1, s[i + 1], True
                i += 2
                continue
            if ch == '"':
                yield i, ch, True
                in_q = False
                i += 1
                continue
            yield i, ch, True
        else:
            if ch == '"':
                in_q = True
                yield i, ch, True
                i += 1
                continue
            yield i, ch, False
        i += 1


def _first_unquoted(s, chars):
    for i, ch, q in _scan(s):
        if not q and ch in chars:
            return i
    return -1


def _split_unquoted(s, delim):
    parts = []
    start = 0
    for i, ch, q in _scan(s):
        if not q and ch == delim:
            parts.append(s[start:i])
            start = i + 1
    parts.append(s[start:])
    return parts


def _trim(s):
    return s.strip(" ")


# ---------------------------------------------------------------------------
# Encoder
# ---------------------------------------------------------------------------

def _is_primitive(v):
    return v is None or isinstance(v, (str, bool, int, float))


def _normalize(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, tuple):
        return list(v)
    if v is None or isinstance(v, (str, bool, int, float, list, dict)):
        return v
    raise TypeError(f"unsupported type for TOON: {type(v).__name__}")


def _fmt_number(x):
    if isinstance(x, bool):
        raise TypeError("bool is not a number")
    if isinstance(x, int):
        return str(x)
    if math.isnan(x) or math.isinf(x):
        return "null"
    if x == 0:
        return "0"
    r = repr(x)
    ax = abs(x)
    if 1e-6 <= ax < 1e21:
        d = Decimal(r)
        s = format(d, "f")
        if "." in s:
            s = s.rstrip("0").rstrip(".")
        return s
    # outside canonical range: JSON exponent form, lowercase e, explicit sign
    mant, _, exp = r.partition("e")
    if not exp:
        d = Decimal(r)
        sign, digits, e = d.as_tuple()
        mant = "".join(map(str, digits))
        exp_val = e + len(digits) - 1
        mant = mant[0] + ("." + mant[1:].rstrip("0") if mant[1:].rstrip("0") else "")
        if sign:
            mant = "-" + mant
    else:
        exp_val = int(exp)
        if "." in mant:
            mant = mant.rstrip("0").rstrip(".")
    return f"{mant}e{'+' if exp_val >= 0 else '-'}{abs(exp_val)}"


def _needs_quote(s, delim, root=False):
    if s == "":
        return True
    if s[0] in " \t" or s[-1] in " \t":
        return True
    if s in ("true", "false", "null"):
        return True
    if _NUMERIC_LIKE.fullmatch(s):
        return True
    for ch in s:
        if ch in ':"\\[]{}' or ord(ch) < 0x20 or ch == delim:
            return True
    if s[0] in "-#":
        return True
    if root and s[0] == "﻿":
        return True
    return False


def _enc_primitive(v, delim, root=False):
    v = _normalize(v)
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return _fmt_number(v)
    if isinstance(v, str):
        if _needs_quote(v, delim, root):
            return '"' + _escape(v) + '"'
        _escape(v)  # surrogate check
        return v
    raise TypeError("not a primitive")


def _enc_key(k):
    if not isinstance(k, str):
        raise TypeError("object keys must be strings")
    if _UNQUOTED_KEY.fullmatch(k):
        return k
    return '"' + _escape(k) + '"'


def _uniform_structure(values):
    """Return the field tree for a list of dicts if every column is
    uniform-primitive or nested-uniform, else None.
    Field tree: list of (name, subtree-or-None) in first value's key order."""
    if not values:
        return None
    first = values[0]
    if not isinstance(first, dict) or not first:
        return None
    keyset = set(first.keys())
    for v in values:
        if not isinstance(v, dict) or not v or set(v.keys()) != keyset:
            return None
    tree = []
    for k in first.keys():
        col = [_normalize(v[k]) for v in values]
        if all(_is_primitive(c) for c in col):
            tree.append((k, None))
        elif all(isinstance(c, dict) and c for c in col):
            sub = _uniform_structure(col)
            if sub is None:
                return None
            tree.append((k, sub))
        else:
            return None
    return tree


def _fields_str(tree, delim):
    parts = []
    for name, sub in tree:
        if sub is None:
            parts.append(_enc_key(name))
        else:
            parts.append(_enc_key(name) + "{" + _fields_str(sub, delim) + "}")
    return delim.join(parts)


def _leaf_values(obj, tree):
    out = []
    for name, sub in tree:
        v = _normalize(obj[name])
        if sub is None:
            out.append(v)
        else:
            out.extend(_leaf_values(v, sub))
    return out


def _bracket(n, delim, keyed=False):
    d = "" if delim == "," else delim
    return f"[{n}{':' if keyed else ''}{d}]"


class _Encoder:
    def __init__(self, indent=2, delimiter=","):
        if delimiter not in _DELIMS:
            raise ValueError("delimiter must be ',', '\\t' or '|'")
        if not isinstance(indent, int) or indent < 1:
            raise ValueError("indent must be a positive integer")
        self.ind = indent
        self.delim = delimiter

    def pad(self, depth):
        return " " * (self.ind * depth)

    def prim(self, v, root=False):
        return _enc_primitive(v, self.delim, root)

    def encode(self, value):
        value = _normalize(value)
        if isinstance(value, dict):
            tree = self._keyed_tree(value)
            if tree is not None:
                lines = [_bracket(len(value), self.delim, True) + "{" + _fields_str(tree, self.delim) + "}:"]
                lines += self._entry_rows(value, tree, 1)
                return "\n".join(lines)
            return "\n".join(self.object_lines(value, 0))
        if isinstance(value, list):
            if not value:
                return "[]"
            return "\n".join(self.array_lines(None, value, 0, root=True))
        return self.prim(value, root=True)

    def _keyed_tree(self, obj):
        if len(obj) < 2:
            return None
        vals = [_normalize(v) for v in obj.values()]
        return _uniform_structure(vals)

    def _entry_rows(self, obj, tree, depth):
        rows = []
        for k, v in obj.items():
            cells = [self.prim(c) for c in _leaf_values(_normalize(v), tree)]
            rows.append(self.pad(depth) + _enc_key(k) + ": " + self.delim.join(cells))
        return rows

    def object_lines(self, obj, depth):
        lines = []
        for k, v in obj.items():
            lines += self.field_lines(k, _normalize(v), depth)
        return lines

    def field_lines(self, key, v, depth):
        ek = _enc_key(key)
        p = self.pad(depth)
        if isinstance(v, dict):
            tree = self._keyed_tree(v)
            if tree is not None:
                head = p + ek + _bracket(len(v), self.delim, True) + "{" + _fields_str(tree, self.delim) + "}:"
                return [head] + self._entry_rows(v, tree, depth + 1)
            return [p + ek + ":"] + self.object_lines(v, depth + 1)
        if isinstance(v, list):
            if not v:
                return [p + ek + ": []"]
            return self.array_lines(ek, v, depth)
        return [p + ek + ": " + self.prim(v)]

    def array_lines(self, ek, arr, depth, root=False):
        """Header line at `depth` (key may be None for root) plus contents."""
        p = self.pad(depth)
        key = ek or ""
        arr = [_normalize(x) for x in arr]
        n = len(arr)
        if all(_is_primitive(x) for x in arr):
            return [p + key + _bracket(n, self.delim) + ": " + self.delim.join(self.prim(x) for x in arr)]
        tree = None
        if all(isinstance(x, dict) for x in arr):
            tree = _uniform_structure(arr)
        if tree is not None:
            head = p + key + _bracket(n, self.delim) + "{" + _fields_str(tree, self.delim) + "}:"
            rows = [self.pad(depth + 1) + self.delim.join(self.prim(c) for c in _leaf_values(x, tree)) for x in arr]
            return [head] + rows
        lines = [p + key + _bracket(n, self.delim) + ":"]
        for x in arr:
            lines += self.item_lines(x, depth + 1)
        return lines

    def item_lines(self, x, depth):
        p = self.pad(depth)
        if _is_primitive(x):
            return [p + "- " + self.prim(x)]
        if isinstance(x, list):
            if all(_is_primitive(y) for y in x):
                if not x:
                    return [p + "- " + _bracket(0, self.delim) + ":"]
                return [p + "- " + _bracket(len(x), self.delim) + ": " + self.delim.join(self.prim(y) for y in x)]
            lines = [p + "- " + _bracket(len(x), self.delim) + ":"]
            for y in x:
                lines += self.item_lines(_normalize(y), depth + 1)
            return lines
        # object
        if not x:
            return [p + "-"]
        keys = list(x.keys())
        first = self.field_lines(keys[0], _normalize(x[keys[0]]), depth + 1)
        first[0] = p + "- " + first[0].lstrip(" ")
        lines = first
        for k in keys[1:]:
            lines += self.field_lines(k, _normalize(x[k]), depth + 1)
        return lines


def encode(value, indent=2, delimiter=","):
    """Encode a JSON-model value as a TOON document (no trailing newline)."""
    return _Encoder(indent, delimiter).encode(value)


dumps = encode


# ---------------------------------------------------------------------------
# Decoder
# ---------------------------------------------------------------------------

class _Line:
    __slots__ = ("idx", "depth", "content")

    def __init__(self, idx, depth, content):
        self.idx = idx
        self.depth = depth
        self.content = content


class _Field:
    __slots__ = ("name", "sub")

    def __init__(self, name, sub):
        self.name = name
        self.sub = sub


def _leaf_count(fields):
    return sum(1 if f.sub is None else _leaf_count(f.sub) for f in fields)


class _Header:
    __slots__ = ("key", "keyed", "n", "delim", "fields", "rest")


class _Decoder:
    def __init__(self, text, indent=2, strict=True):
        if not isinstance(indent, int) or indent < 1:
            raise ValueError("indent must be a positive integer")
        self.ind = indent
        self.strict = strict
        self.lines = []
        self.blank = []
        self.pos = 0
        self._prepare(text)

    # -- line preparation (spec 12) --
    def _prepare(self, text):
        if text.startswith("﻿"):
            text = text[1:]
        raw = text.split("\n")
        for idx, line in enumerate(raw):
            if line.endswith("\r"):
                line = line[:-1]
            line = line.rstrip(" ")
            stripped = line.lstrip(" ")
            if stripped.startswith("#"):
                continue  # comment line (only spaces may precede '#')
            if line == "":
                self.blank.append(idx)
                continue
            j = 0
            while j < len(line) and line[j] in " \t":
                j += 1
            indent = line[:j]
            content = line[j:]
            if content == "":
                # only spaces and tabs
                if not self.strict:
                    self.blank.append(idx)
                    continue
                raise ToonError("tab in indentation", idx + 1)
            if self.strict:
                if "\t" in indent:
                    raise ToonError("tab in indentation", idx + 1)
                if len(indent) % self.ind:
                    raise ToonError("indentation is not a multiple of the indent size", idx + 1)
                depth = len(indent) // self.ind
            else:
                tabs = indent.count("\t")
                spaces = len(indent) - tabs
                depth = tabs + spaces // self.ind
            self.lines.append(_Line(idx, depth, content))

    def err(self, msg, line=None):
        raise ToonError(msg, (line.idx + 1) if isinstance(line, _Line) else line)

    def peek(self):
        return self.lines[self.pos] if self.pos < len(self.lines) else None

    def last_idx(self):
        return self.lines[self.pos - 1].idx if self.pos > 0 else -1

    def check_span(self, first_idx, last_idx, line):
        if not self.strict or first_idx is None:
            return
        for b in self.blank:
            if first_idx < b < last_idx:
                self.err("blank line inside an array or keyed scope", b + 1)

    # -- tokens --
    def quoted_or_raw(self, tok, line):
        """Return (string, was_quoted) for an extracted token (already trimmed)."""
        if tok.startswith('"'):
            body, close = self._quoted_body(tok, line)
            if close != len(tok) - 1:
                self.err("characters after closing quote", line)
            return _unescape(body, line.idx + 1 if line else None), True
        return tok, False

    def _quoted_body(self, tok, line):
        i = 1
        n = len(tok)
        while i < n:
            ch = tok[i]
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                return tok[1:i], i
            i += 1
        self.err("unterminated string", line)

    def primitive(self, tok, line):
        tok = _trim(tok)
        if tok.startswith('"'):
            s, _ = self.quoted_or_raw(tok, line)
            return s
        if tok == "true":
            return True
        if tok == "false":
            return False
        if tok == "null":
            return None
        if _JSON_NUMBER.fullmatch(tok):
            if "." in tok or "e" in tok or "E" in tok:
                v = float(tok)
                if v == 0:
                    v = 0.0
                if v.is_integer() and abs(v) < 1e21:
                    try:
                        return int(Decimal(tok))
                    except Exception:
                        return v
                return v
            v = int(tok)
            return 0 if v == 0 else v
        return tok

    def key_token(self, tok, line):
        tok = _trim(tok)
        if tok.startswith('"'):
            s, _ = self.quoted_or_raw(tok, line)
            return s
        return tok

    # -- headers (spec 6) --
    def is_header(self, content):
        c = _first_unquoted(content, ":")
        if c < 0:
            return False
        b = _first_unquoted(content, "[")
        return 0 <= b < c

    def parse_header(self, content, line):
        b = _first_unquoted(content, "[")
        keypart = content[:b]
        h = _Header()
        if keypart == "":
            h.key = None
        else:
            if keypart[-1] in " \t":
                self.err("whitespace between key and bracket segment", line)
            if keypart.startswith('"'):
                body, close = self._quoted_body(keypart, line)
                if close != len(keypart) - 1:
                    self.err("characters after closing quote in key", line)
                h.key = _unescape(body, line.idx + 1)
            else:
                h.key = keypart
        i = b + 1
        j = i
        while j < len(content) and content[j] in "0123456789":
            j += 1
        digits = content[i:j]
        if digits == "" or (len(digits) > 1 and digits[0] == "0"):
            self.err("malformed array length", line)
        h.n = int(digits)
        h.keyed = False
        if j < len(content) and content[j] == ":":
            h.keyed = True
            j += 1
        h.delim = ","
        if j < len(content) and content[j] in "\t|":
            h.delim = content[j]
            j += 1
        if j >= len(content) or content[j] != "]":
            self.err("malformed bracket segment", line)
        j += 1
        h.fields = None
        if j < len(content) and content[j] == "{":
            end = self._match_brace(content, j, line)
            h.fields = self.parse_fields(content[j + 1:end], h.delim, line)
            j = end + 1
        if j >= len(content) or content[j] != ":":
            self.err("header must end with a colon", line)
        rest = content[j + 1:]
        if h.keyed and h.fields is None:
            self.err("keyed header requires a field list", line)
        if h.fields is not None and _trim(rest) != "":
            self.err("content after a fields-bearing header", line)
        h.rest = _trim(rest)
        return h

    def _match_brace(self, s, start, line):
        depth = 0
        for i, ch, q in _scan(s[start:]):
            if q:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return start + i
        self.err("unmatched brace in field list", line)

    def parse_fields(self, inner, delim, line):
        # other delimiters (unquoted) are not allowed anywhere in the list
        for i, ch, q in _scan(inner):
            if not q and ch in _DELIMS and ch != delim:
                self.err("field list uses a delimiter other than the declared one", line)
        entries = []
        start = 0
        depth = 0
        for i, ch, q in _scan(inner):
            if q:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth < 0:
                    self.err("unmatched brace in field list", line)
            elif ch == delim and depth == 0:
                entries.append(inner[start:i])
                start = i + 1
        if depth != 0:
            self.err("unmatched brace in field list", line)
        entries.append(inner[start:])
        fields = []
        names = set()
        for ent in entries:
            ent = _trim(ent)
            if ent == "":
                self.err("empty field entry", line)
            br = _first_unquoted(ent, "{")
            if br >= 0:
                name_tok = ent[:br]
                group = ent[br:]
                if name_tok == "":
                    self.err("nameless nested field group", line)
                if name_tok[-1] in " \t":
                    self.err("whitespace between field name and nested group", line)
                end = self._match_brace(group, 0, line)
                if end != len(group) - 1:
                    self.err("characters after nested field group", line)
                sub = self.parse_fields(group[1:-1], delim, line)
            else:
                name_tok = ent
                sub = None
                if _first_unquoted(ent, "}") >= 0:
                    self.err("unmatched brace in field list", line)
            name = self.key_token(name_tok, line)
            if name in names and self.strict:
                self.err("duplicate field name in field list", line)
            # non-strict: keep the repeated field as its own column; materializing
            # assigns in order, so the last write wins and the key keeps its
            # first position (spec 14.4 recovery 2)
            names.add(name)
            fields.append(_Field(name, sub))
        return fields

    # -- values --
    def materialize(self, cells, fields, line):
        it = iter(cells)
        return self._mat(it, fields)

    def _mat(self, it, fields):
        obj = {}
        for f in fields:
            if f.sub is None:
                obj[f.name] = next(it)
            else:
                obj[f.name] = self._mat(it, f.sub)
        return obj

    def split_cells(self, s, delim, line):
        return [self.primitive(t, line) for t in _split_unquoted(s, delim)]

    # -- scopes --
    def open_scope(self, parent_depth):
        """Return (content_depth, end_threshold) for a nested scope whose
        expected content depth is parent_depth+1, applying depth-jump rules."""
        c = parent_depth + 1
        nxt = self.peek()
        if nxt is None or nxt.depth <= parent_depth:
            return c, c
        if nxt.depth > c:
            if self.strict:
                self.err("indentation depth jump", nxt)
            return nxt.depth, c
        return c, c

    def parse_object(self, depth, threshold, first=None):
        obj = {}
        lines_iter_first = first
        while True:
            if lines_iter_first is not None:
                line = lines_iter_first
                lines_iter_first = None
                virtual = True
            else:
                line = self.peek()
                virtual = False
                if line is None or line.depth < threshold:
                    break
                if line.depth < depth:
                    self.err("line is shallower than its scope (depth jump recovery)", line)
                if line.depth > depth:
                    self.err("over-indented line", line)
                self.pos += 1
            key, value = self.parse_field(line, depth)
            if key in obj:
                if self.strict:
                    self.err(f"duplicate key '{key}'", line)
            obj[key] = value
        return obj

    def parse_field(self, line, depth):
        content = line.content
        if self.is_header(content):
            h = self.parse_header(content, line)
            if h.key is None:
                self.err("keyless header in object-field position", line)
            return h.key, self.parse_header_value(h, line, depth)
        c = _first_unquoted(content, ":")
        if c < 0:
            self.err("line has no colon (scalar line outside root position)", line)
        key = self.key_token(content[:c], line)
        rest = _trim(content[c + 1:])
        if rest == "":
            cd, th = self.open_scope(depth)
            return key, self.parse_object(cd, th)
        if rest == "[]":
            return key, []
        return key, self.primitive(rest, line)

    def parse_header_value(self, h, line, depth):
        if h.keyed:
            return self.parse_keyed(h, line, depth)
        if h.fields is not None:
            return self.parse_tabular(h, line, depth)
        if h.rest != "":
            vals = self.split_cells(h.rest, h.delim, line)
            if self.strict and len(vals) != h.n:
                self.err(f"inline array has {len(vals)} values, header declares {h.n}", line)
            return vals
        return self.parse_list(h, line, depth)

    def parse_tabular(self, h, line, depth):
        cd, th = self.open_scope(depth)
        leaf = _leaf_count(h.fields)
        rows = []
        first_idx = None
        while True:
            ln = self.peek()
            if ln is None or ln.depth < th:
                break
            if ln.depth < cd:
                self.err("line is shallower than its scope (depth jump recovery)", ln)
            if ln.depth > cd:
                self.err("over-indented line in tabular rows", ln)
            d = _first_unquoted(ln.content, h.delim)
            c = _first_unquoted(ln.content, ":")
            is_row = c < 0 or (d >= 0 and d < c)
            if not is_row:
                break
            self.pos += 1
            if first_idx is None:
                first_idx = ln.idx
            cells = self.split_cells(ln.content, h.delim, ln)
            if len(cells) != leaf:
                self.err(f"row has {len(cells)} cells, header declares {leaf}", ln)
            rows.append(self.materialize(cells, h.fields, ln))
        if self.strict and len(rows) != h.n:
            self.err(f"tabular array has {len(rows)} rows, header declares {h.n}", line)
        self.check_span(first_idx, self.last_idx(), line)
        return rows

    def parse_keyed(self, h, line, depth):
        cd, th = self.open_scope(depth)
        leaf = _leaf_count(h.fields)
        obj = {}
        count = 0
        first_idx = None
        while True:
            ln = self.peek()
            if ln is None or ln.depth < th:
                break
            if ln.depth < cd:
                self.err("line is shallower than its scope (depth jump recovery)", ln)
            if ln.depth > cd:
                self.err("over-indented line in keyed entries", ln)
            c = _first_unquoted(ln.content, ":")
            if c < 0:
                self.err("keyed entry row without a colon", ln)
            self.pos += 1
            if first_idx is None:
                first_idx = ln.idx
            key = self.key_token(ln.content[:c], ln)
            rem = _trim(ln.content[c + 1:])
            cells = [] if rem == "" else self.split_cells(rem, h.delim, ln)
            if len(cells) != leaf:
                self.err(f"entry row has {len(cells)} cells, header declares {leaf}", ln)
            if key in obj and self.strict:
                self.err(f"duplicate entry key '{key}'", ln)
            obj[key] = self.materialize(cells, h.fields, ln)
            count += 1
        if self.strict and count != h.n:
            self.err(f"keyed object has {count} entries, header declares {h.n}", line)
        self.check_span(first_idx, self.last_idx(), line)
        return obj

    def parse_list(self, h, line, depth):
        cd, th = self.open_scope(depth)
        items = []
        first_idx = None
        while True:
            ln = self.peek()
            if ln is None or ln.depth < th:
                break
            if ln.depth < cd:
                self.err("line is shallower than its scope (depth jump recovery)", ln)
            if ln.depth > cd:
                self.err("over-indented line in list", ln)
            if not (ln.content == "-" or ln.content.startswith("- ")):
                break
            self.pos += 1
            if first_idx is None:
                first_idx = ln.idx
            items.append(self.parse_item(ln, cd))
        if self.strict and len(items) != h.n:
            self.err(f"list has {len(items)} items, header declares {h.n}", line)
        self.check_span(first_idx, self.last_idx(), line)
        return items

    def parse_item(self, ln, depth):
        if ln.content == "-":
            return {}
        rest = ln.content[1:].lstrip(" ")
        if rest == "[]":
            return []
        if self.is_header(rest):
            h = self.parse_header(rest, ln)
            if h.key is None:
                if h.fields is not None:
                    self.err("keyless fields-bearing header outside the root", ln)
                if h.rest != "":
                    vals = self.split_cells(h.rest, h.delim, ln)
                    if self.strict and len(vals) != h.n:
                        self.err(f"inline array has {len(vals)} values, header declares {h.n}", ln)
                    return vals
                return self.parse_list(h, ln, depth)
            virtual = _Line(ln.idx, depth + 1, rest)
            return self.parse_object(depth + 1, depth + 1, first=virtual)
        if _first_unquoted(rest, ":") >= 0:
            virtual = _Line(ln.idx, depth + 1, rest)
            return self.parse_object(depth + 1, depth + 1, first=virtual)
        return self.primitive(rest, ln)

    # -- root (spec 5) --
    def parse_root(self):
        if not self.lines:
            return {}
        first = self.lines[0]
        if first.depth > 0:
            self.err("first line is indented", first)
        content = first.content
        if self.is_header(content) and _first_unquoted(content, "[") == 0:
            h = self.parse_header(content, first)
            self.pos = 1
            if h.keyed:
                val = self.parse_keyed(h, first, 0)
            elif h.fields is not None:
                val = self.parse_tabular(h, first, 0)
            elif h.rest != "":
                val = self.split_cells(h.rest, h.delim, first)
                if self.strict and len(val) != h.n:
                    self.err(f"inline array has {len(val)} values, header declares {h.n}", first)
            else:
                val = self.parse_list(h, first, 0)
            self.ensure_end()
            return val
        if content == "[]":
            self.pos = 1
            self.ensure_end()
            return []
        if len(self.lines) == 1 and _first_unquoted(content, ":") < 0:
            return self.primitive(content, first)
        obj = self.parse_object(0, 0)
        self.ensure_end()
        return obj

    def ensure_end(self):
        ln = self.peek()
        if ln is not None:
            self.err("trailing content after the root value", ln)


def decode(text, indent=2, strict=True):
    """Decode a TOON document to Python values (dict/list/str/int/float/bool/None)."""
    if isinstance(text, (bytes, bytearray)):
        try:
            text = bytes(text).decode("utf-8")
        except UnicodeDecodeError as e:
            raise ToonError(f"ill-formed UTF-8: {e}")
    return _Decoder(text, indent, strict).parse_root()


loads = decode


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def _read(path):
    with open(path, "rb") as f:
        data = f.read()
    return decode(data)


def main(argv):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if len(argv) < 3 or argv[1] not in ("check", "to-json", "from-json", "fmt"):
        print(__doc__)
        return 2
    cmd = argv[1]
    try:
        if cmd == "check":
            bad = 0
            for p in argv[2:]:
                try:
                    _read(p)
                    print(f"OK    {p}")
                except ToonError as e:
                    bad += 1
                    print(f"ERROR {p}: {e}")
            return 1 if bad else 0
        if cmd == "to-json":
            print(json.dumps(_read(argv[2]), ensure_ascii=False, indent=2))
            return 0
        if cmd == "from-json":
            with open(argv[2], encoding="utf-8") as f:
                sys.stdout.write(encode(json.load(f)))
            return 0
        if cmd == "fmt":
            val = _read(argv[2])
            with open(argv[2], "w", encoding="utf-8", newline="\n") as f:
                f.write(encode(val))
            return 0
    except ToonError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
