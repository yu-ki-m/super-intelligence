#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Quality-viewpoint ledger (quality.toon) backed by the bundled catalog
(references/quality/catalog.json: 9 characteristics, 40 subcharacteristics,
605 viewpoints, 1,833 check items).

Commands (python -X utf8 quality.py <command> ...):
  init DIR                 fill DIR/quality.toon with every viewpoint as 'unreviewed'
  show --ids ID...         print viewpoints / subcharacteristics with their check items
  set DIR --file UPDATES   apply judgements from a TOON file:
                             viewpoints[N]{id,judgement,requirements,reason}: ...
                             checks[N]{id,judgement,requirements,reason}: ...
                           (either table may be omitted). Unknown IDs are rejected.
  summary DIR              counts per subcharacteristic and judgement
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toon  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, "..", "references", "quality", "catalog.json")
VP_JUDGEMENTS = ["unreviewed", "applicable", "not_applicable", "unknown", "out_of_scope"]
CK_JUDGEMENTS = ["reflected", "not_needed", "unknown", "out_of_scope"]


def load_catalog():
    with open(CATALOG, encoding="utf-8") as f:
        cat = json.load(f)
    vps = {}
    order = []
    for g in cat["groups"]:
        for s in g["subcharacteristics"]:
            for v in s["viewpoints"]:
                vps[v["id"]] = {"sub": s["id"], "subname": s["name"], "group": g["name"], "text": v["text"],
                               "checks": [(c["id"], c["text"]) for c in v["checks"]]}
                order.append(v["id"])
    return cat, vps, order


def path_of(d):
    return os.path.join(d, "quality.toon")


def read(d):
    with open(path_of(d), "rb") as f:
        return toon.decode(f.read())


def write(d, doc):
    text = toon.encode(doc)
    toon.decode(text)
    with open(path_of(d), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def cmd_init(a):
    cat, vps, order = load_catalog()
    if os.path.exists(path_of(a.dir)):
        try:
            doc = read(a.dir)
            if doc.get("viewpoints"):
                print("止めました：quality.toon に判定が既にある（作り直すなら手で消す）", file=sys.stderr)
                return 1
        except toon.ToonError:
            pass
    doc = {"catalog_version": cat["catalog_version"],
           "viewpoints": [{"id": vid, "judgement": "unreviewed", "requirements": "", "reason": ""} for vid in order],
           "checks": []}
    write(a.dir, doc)
    print(f"quality.toon を作りました（観点 {len(order)} 件、すべて unreviewed）")
    return 0


def cmd_show(a):
    cat, vps, order = load_catalog()
    shown = 0
    for want in a.ids:
        hits = [vid for vid in order if vid == want or vps[vid]["sub"] == want]
        if not hits:
            print(f"見つからない ID: {want}")
            continue
        for vid in hits:
            v = vps[vid]
            print(f"## {vid} {v['text']}（{v['subname']}）")
            for cid, text in v["checks"]:
                print(f"  - {cid} {text}")
            shown += 1
    print(f"表示した観点: {shown} 件")
    return 0


def cmd_set(a):
    cat, vps, order = load_catalog()
    doc = read(a.dir)
    with open(a.file, "rb") as f:
        upd = toon.decode(f.read())
    vrows = {r["id"]: r for r in doc.get("viewpoints", [])}
    crows = {r["id"]: r for r in doc.get("checks", [])}
    check_parent = {cid: vid for vid in order for cid, _ in vps[vid]["checks"]}
    errors = []
    for r in upd.get("viewpoints", []) or []:
        if r.get("id") not in vps:
            errors.append(f"カタログにない観点: {r.get('id')}")
            continue
        if r.get("judgement") not in VP_JUDGEMENTS:
            errors.append(f"{r['id']}: 判定は {VP_JUDGEMENTS} のどれか")
            continue
        vrows[r["id"]].update({"judgement": r["judgement"], "requirements": r.get("requirements", "") or "",
                               "reason": r.get("reason", "") or ""})
    for r in upd.get("checks", []) or []:
        cid = r.get("id")
        if cid not in check_parent:
            errors.append(f"カタログにない確認項目: {cid}")
            continue
        if r.get("judgement") not in CK_JUDGEMENTS:
            errors.append(f"{cid}: 判定は {CK_JUDGEMENTS} のどれか")
            continue
        row = {"id": cid, "viewpoint": check_parent[cid], "judgement": r["judgement"],
               "requirements": r.get("requirements", "") or "", "reason": r.get("reason", "") or ""}
        crows[cid] = row
    if errors:
        for e in errors:
            print(f"ERROR {e}")
        print("何も書き込んでいません")
        return 1
    doc["viewpoints"] = [vrows[vid] for vid in order]
    pos = {cid: i for i, cid in enumerate(c for vid in order for c, _ in vps[vid]["checks"])}
    doc["checks"] = sorted(crows.values(), key=lambda r: pos[r["id"]])
    write(a.dir, doc)
    print(f"反映しました（観点 {len(upd.get('viewpoints', []) or [])} 件、確認項目 {len(upd.get('checks', []) or [])} 件）")
    return 0


def cmd_summary(a):
    cat, vps, order = load_catalog()
    doc = read(a.dir)
    by = {}
    for r in doc.get("viewpoints", []):
        sub = vps.get(r["id"], {}).get("sub", "?")
        by.setdefault(sub, {}).setdefault(r["judgement"], 0)
        by[sub][r["judgement"]] += 1
    for sub in sorted(by):
        print(sub, " ".join(f"{k}:{v}" for k, v in sorted(by[sub].items())))
    total = {}
    for r in doc.get("viewpoints", []):
        total[r["judgement"]] = total.get(r["judgement"], 0) + 1
    ck = {}
    for r in doc.get("checks", []):
        ck[r["judgement"]] = ck.get(r["judgement"], 0) + 1
    print("観点:", total)
    print("確認項目:", ck)
    return 0


def main(argv):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init")
    p.add_argument("dir")
    p = sub.add_parser("show")
    p.add_argument("--ids", nargs="+", required=True)
    p = sub.add_parser("set")
    p.add_argument("dir")
    p.add_argument("--file", required=True)
    p = sub.add_parser("summary")
    p.add_argument("dir")
    a = ap.parse_args(argv[1:])
    return {"init": cmd_init, "show": cmd_show, "set": cmd_set, "summary": cmd_summary}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
