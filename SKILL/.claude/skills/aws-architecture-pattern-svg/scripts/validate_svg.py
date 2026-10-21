#!/usr/bin/env python3
"""Basic structural safety/portability checks for generated SVG diagrams.

This validator does NOT check AWS topology correctness or visual collisions.
Usage: python scripts/validate_svg.py pattern-*.svg
"""
import argparse
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
BAD_TAGS = {"script", "foreignObject", "iframe", "image", "animate", "set", "animateMotion", "animateTransform"}


def test_svg(path: Path):
    errors = []
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError) as exc:
        return [f"XML parse error: {exc}"]
    if root.tag != f"{{{SVG}}}svg":
        errors.append("Root must be an SVG element with the SVG namespace")
    vb = root.attrib.get("viewBox", "")
    try:
        parts = [float(v) for v in re.split(r"[,\s]+", vb.strip())]
        if len(parts) != 4 or parts[2] <= 0 or parts[3] <= 0:
            raise ValueError
    except (ValueError, TypeError):
        errors.append("Missing/invalid positive viewBox")
    ids = set()
    text_elements = 0
    for node in root.iter():
        name = node.tag.rsplit("}", 1)[-1]
        if name in BAD_TAGS:
            errors.append(f"Unsupported or potentially unsafe tag: {name}")
        if name == "text":
            text_elements += 1
        nid = node.attrib.get("id")
        if nid:
            if nid in ids:
                errors.append(f"Duplicate element ID: {nid}")
            ids.add(nid)
        for key, value in node.attrib.items():
            attr = key.rsplit("}", 1)[-1]
            val = value.strip()
            if attr.lower().startswith("on"):
                errors.append(f"Disallowed event handler attribute: {attr}")
            if attr in {"href", "src"} and (val.startswith(("http:", "https:", "//", "data:", "file:")) or not val.startswith("#")):
                errors.append(f"External/nonlocal resource reference: {attr}={val[:60]}")
            if re.search(r"url\s*\(\s*['\"]?\s*(?:https?://|data:|//)", val, re.IGNORECASE):
                errors.append(f"External asset URL in attribute: {attr}")
    if text_elements == 0:
        errors.append("No <text> elements found")
    return errors


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("files", nargs="+", type=Path)
    args = p.parse_args()
    failed = False
    for path in args.files:
        issues = test_svg(path)
        if issues:
            failed = True
            print(f"FAIL {path}")
            for issue in issues:
                print(f"  - {issue}")
        else:
            print(f"PASS {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
