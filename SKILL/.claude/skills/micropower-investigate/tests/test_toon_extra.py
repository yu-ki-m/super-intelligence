#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Checks that the official fixtures cannot express (spec 3 and 4), plus a
round-trip property test with ledger-like Japanese text.
Usage: python -X utf8 tests/test_toon_extra.py
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import toon  # noqa: E402

fails = 0


def check(name, cond):
    global fails
    if not cond:
        fails += 1
        print(f"FAIL {name}")


def raises(fn):
    try:
        fn()
    except (toon.ToonError, TypeError, ValueError):
        return True
    return False


check("NaN encodes to null", toon.encode({"a": float("nan")}) == "a: null")
check("Infinity encodes to null", toon.encode([math.inf, -math.inf]) == "[2]: null,null")
check("unpaired surrogate is rejected", raises(lambda: toon.encode({"a": "x\ud800y"})))
check("ill-formed UTF-8 bytes are rejected", raises(lambda: toon.decode(b"a: \xff")))
check("UTF-8 bytes decode", toon.decode("a: 書籍".encode("utf-8")) == {"a": "書籍"})
check("unsupported host type is rejected", raises(lambda: toon.encode({"a": object()})))

pieces = ["書籍ID", "、", "：", "（必須）", "「すでに登録されています」", ",", ":", "\"", "\\", "[0]", "{x}", " ", "-", "#",
          "\n", "\t", "200", "true", "null", "1e5", "05", "_書籍ID_1_", "N001 N003", "é", "😀", ""]
random.seed(20261115)
for i in range(400):
    def text():
        return "".join(random.choice(pieces) for _ in range(random.randint(0, 6)))
    rows = [{"id": f"N{j:03d}", "want": text(), "why": text(), "n": random.randint(-5, 5), "ok": random.choice([True, False])}
            for j in range(random.randint(0, 4))]
    doc = {"topic": text(), "needs": rows, "tags": [text() for _ in range(random.randint(0, 3))],
           "nested": {"k": text(), "list": [{"a": text()}, {"b": 1}]}}
    for delim in (",", "|", "\t"):
        enc = toon.encode(doc, delimiter=delim)
        dec = toon.decode(enc)
        if dec != doc:
            fails += 1
            print(f"FAIL round trip #{i} delimiter {delim!r}\n{enc}")
            break
        if "\r" in enc or enc.endswith("\n") or any(l != l.rstrip(" ") for l in enc.split("\n")):
            fails += 1
            print(f"FAIL formatting invariants #{i}")
            break

print("ALL OK" if not fails else f"{fails} FAILURE(S)")
sys.exit(1 if fails else 0)
