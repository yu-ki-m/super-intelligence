#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run the official TOON fixtures (tests/toon-fixtures) against scripts/toon.py.

Usage: python tests/run_toon_conformance.py [-v]
Exit code 0 when every applicable fixture passes.
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import toon  # noqa: E402

TARGET = (4, 4)


def ver(s):
    return tuple(int(x) for x in s.split("."))


def same(a, b):
    """JSON-model equality that keeps booleans distinct from numbers."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, str) or isinstance(b, str):
        return isinstance(a, str) and isinstance(b, str) and a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return list(a.keys()) == list(b.keys()) and all(same(a[k], b[k]) for k in a)
    return False


def main():
    verbose = "-v" in sys.argv
    for s in (sys.stdout,):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    total = passed = skipped = 0
    failures = []
    for path in sorted(glob.glob(os.path.join(HERE, "toon-fixtures", "*", "*.json"))):
        kind = os.path.basename(os.path.dirname(path))
        with open(path, encoding="utf-8") as f:
            suite = json.load(f)
        for i, t in enumerate(suite["tests"]):
            if "minSpecVersion" in t and ver(t["minSpecVersion"]) > TARGET:
                skipped += 1
                continue
            total += 1
            opts = t.get("options", {})
            where = f"{kind}/{os.path.basename(path)}#{i}"
            try:
                if kind == "decode":
                    got = toon.decode(t["input"], indent=opts.get("indentSize", 2), strict=opts.get("strict", True))
                else:
                    got = toon.encode(t["input"], indent=opts.get("indentSize", 2), delimiter=opts.get("delimiter", ","))
                if t.get("shouldError"):
                    failures.append((where, t["name"], "expected an error", got))
                    continue
                ok = same(got, t["expected"]) if kind == "decode" else got == t["expected"]
                if ok:
                    passed += 1
                else:
                    failures.append((where, t["name"], t["expected"], got))
            except Exception as e:  # noqa: BLE001
                if t.get("shouldError") and isinstance(e, (toon.ToonError, TypeError, ValueError)):
                    passed += 1
                else:
                    failures.append((where, t["name"], t.get("expected"), f"{type(e).__name__}: {e}"))
    for where, name, exp, got in failures:
        print(f"FAIL {where}: {name}")
        if verbose:
            print(f"   expected: {json.dumps(exp, ensure_ascii=False)}")
            print(f"   got:      {json.dumps(got, ensure_ascii=False) if not isinstance(got, str) else got!r}")
    print(f"passed {passed}/{total} (skipped {skipped} newer than spec {TARGET[0]}.{TARGET[1]})")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
