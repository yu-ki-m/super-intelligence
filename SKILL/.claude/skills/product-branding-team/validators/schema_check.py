"""schemas/ の定義でデータを検査する。外部ライブラリを増やさないための小さな実装。

対応するのは、この製品の定義で使う type / required / properties / items / enum /
additionalProperties / minItems / minLength だけである。
"""
from __future__ import annotations

import json
from pathlib import Path

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schemas"
_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "null": type(None),
}


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))


def validate(data, schema, path="$") -> list[str]:
    errors: list[str] = []
    expected = schema.get("type")
    if expected:
        kinds = expected if isinstance(expected, list) else [expected]
        ok = any(isinstance(data, _TYPES[k]) and not (k in ("integer", "number") and isinstance(data, bool)) for k in kinds)
        if not ok:
            return [f"{path}: 型が {expected} ではない"]
    if "enum" in schema and data not in schema["enum"]:
        errors.append(f"{path}: 値 {data!r} は {schema['enum']} のいずれでもない")
    if isinstance(data, str) and len(data) < schema.get("minLength", 0):
        errors.append(f"{path}: 文字列が空である")
    if isinstance(data, dict):
        for key in schema.get("required", []):
            if key not in data:
                errors.append(f"{path}.{key}: 必須項目がない")
        props = schema.get("properties", {})
        for key, value in data.items():
            if key in props:
                errors += validate(value, props[key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}.{key}: 定義にない項目である")
    if isinstance(data, list):
        if len(data) < schema.get("minItems", 0):
            errors.append(f"{path}: 要素が {schema['minItems']} 個未満である")
        if "items" in schema:
            for i, item in enumerate(data):
                errors += validate(item, schema["items"], f"{path}[{i}]")
    return errors
