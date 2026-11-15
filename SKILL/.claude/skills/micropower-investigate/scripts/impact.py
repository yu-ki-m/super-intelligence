#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Impact-scope tool: reverse searches and co-change analysis, recorded in the
ledger (impact.toon) so that no hit can be skipped silently.

Commands (python -X utf8 impact.py <command> DIR ...):
  search DIR --change CH001 --term NAME [--term NAME ...] [--variants] [--print]
        (--change may be omitted with --print)
        search the whole repository (tracked and untracked, not ignored files,
        excluding the ledger folder) for each term as a fixed string, and add one
        `searches` row per term and one `hits` row per matching line, with
        disposition `unclassified`. --variants adds camelCase / snake_case /
        kebab-case / PascalCase / UPPER_SNAKE spellings of each term.
        --print only prints the hits (for reviewers) and writes nothing.
  classify DIR (--search SR001 | --change CH001 | --all) --disposition D
        [--path-glob GLOB] [--line N] [--impact I001] --reason TEXT [--force]
        set the disposition of matching hits (by default only unclassified ones;
        --force also overwrites classified ones). D: impact | same_change |
        test | definition | irrelevant
  cochange DIR [--max-commits 3000] [--min-count 2] [--min-percent 20]
        list files that were committed together with each changed file in the
        git history and add them to `cochanges` (disposition unclassified). Keeps
        the dispositions of pairs already present. Records the run in
        current.toon investigations.
  summary DIR
        counts of hits and co-changes per change and disposition
"""
import argparse
import fnmatch
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toon  # noqa: E402

DISPOSITIONS = ["impact", "same_change", "test", "definition", "irrelevant"]
CO_DISPOSITIONS = ["impact", "checked_no_impact", "same_change", "irrelevant"]
COCHANGE_AREA = "変更の共起（git の履歴）"


def load(folder, name):
    with open(os.path.join(folder, name), "rb") as f:
        return toon.decode(f.read())


def save(folder, name, doc):
    text = toon.encode(doc)
    toon.decode(text)
    with open(os.path.join(folder, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def repo_and_ledger(folder):
    scope = load(folder, "scope.toon")
    repo = scope.get("repo_root") or ""
    if not repo or not os.path.isdir(repo):
        raise SystemExit("scope.toon の repo_root がない、またはフォルダーがない")
    ledger_abs = os.path.normcase(os.path.abspath(folder))
    repo_abs = os.path.normcase(os.path.abspath(repo))
    rel = None
    if ledger_abs.startswith(repo_abs + os.sep):
        rel = os.path.relpath(os.path.abspath(folder), os.path.abspath(repo)).replace("\\", "/")
    return repo, rel


def is_git(repo):
    r = subprocess.run(["git", "-C", repo, "rev-parse", "--is-inside-work-tree"], capture_output=True)
    return r.returncode == 0 and r.stdout.strip() == b"true"


def variants(term):
    words = re.findall(r"[A-Z]+(?=[A-Z][a-z]|[0-9]|\b|_|-)|[A-Z]?[a-z]+|[0-9]+", term)
    if len(words) < 2:
        return [term]
    low = [w.lower() for w in words]
    out = [term,
           low[0] + "".join(w.capitalize() for w in low[1:]),
           "".join(w.capitalize() for w in low),
           "_".join(low), "-".join(low), "_".join(low).upper()]
    seen = []
    for v in out:
        if v not in seen:
            seen.append(v)
    return seen


def grep(repo, ledger_rel, term):
    hits = []
    if is_git(repo):
        cmd = ["git", "-C", repo, "grep", "-n", "-I", "-F", "--untracked", "--null", "-e", term, "--", "."]
        if ledger_rel:
            cmd.append(f":(exclude){ledger_rel}")
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode not in (0, 1):
            raise SystemExit("git grep に失敗: " + r.stderr.decode("utf-8", "replace"))
        for raw in r.stdout.split(b"\n"):
            if not raw:
                continue
            parts = raw.split(b"\0", 2)
            if len(parts) != 3:
                continue
            path = parts[0].decode("utf-8", "replace").replace("\\", "/")
            hits.append((path, int(parts[1]), parts[2].decode("utf-8", "replace")))
        return hits, "git grep（追跡中と未追跡のファイル、.gitignore を除く）"
    skip_dirs = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", "target"}
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for fn in files:
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, repo).replace("\\", "/")
            if ledger_rel and (rel == ledger_rel or rel.startswith(ledger_rel + "/")):
                continue
            try:
                with open(full, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            if b"\0" in data[:8000]:
                continue
            text = data.decode("utf-8", "replace")
            for i, line in enumerate(text.split("\n"), 1):
                if term in line:
                    hits.append((rel, i, line))
    return hits, "Python によるファイルの走査（git のリポジトリではない）"


def next_id(rows, prefix, key="id"):
    n = 0
    for r in rows:
        m = re.fullmatch(prefix + r"(\d+)", str(r.get(key, "")))
        if m:
            n = max(n, int(m.group(1)))
    return n + 1


def cmd_search(a):
    if not a.print and not a.change:
        raise SystemExit("--change が要る（--print のときだけ省ける）")
    repo, ledger_rel = repo_and_ledger(a.dir)
    doc = load(a.dir, "impact.toon")
    if not a.print and not any(c.get("id") == a.change for c in doc.get("changes", [])):
        raise SystemExit(f"impact.toon の changes に {a.change} がない（先に変更する箇所を書く）")
    terms = []
    for t in a.term:
        for v in (variants(t) if a.variants else [t]):
            if v not in terms:
                terms.append(v)
    total = 0
    for term in terms:
        hits, tool = grep(repo, ledger_rel, term)
        total += len(hits)
        if a.print:
            print(f"## {term}（{len(hits)} 件）")
            for p, ln, text in hits:
                print(f"{p}:{ln}: {text.strip()[:200]}")
            continue
        sid = f"SR{next_id(doc.get('searches', []), 'SR'):03d}"
        doc.setdefault("searches", []).append({"id": sid, "change": a.change, "term": term,
                                               "scope": "リポジトリ全体（台帳のフォルダーを除く）", "tool": tool,
                                               "hit_count": len(hits), "status": "done", "note": ""})
        for p, ln, text in hits:
            doc.setdefault("hits", []).append({"search": sid, "path": p, "line": ln, "text": text.strip()[:300],
                                               "disposition": "unclassified", "impact": "", "reason": ""})
        print(f"{sid} {term}: {len(hits)} 件")
    if not a.print:
        save(a.dir, "impact.toon", doc)
        print(f"記録しました（検索 {len(terms)} 件、当たり {total} 件）。すべての当たりを classify で判断してください。")
    return 0


def cmd_classify(a):
    doc = load(a.dir, "impact.toon")
    if a.disposition not in DISPOSITIONS:
        raise SystemExit(f"disposition は {DISPOSITIONS} のどれか")
    if a.disposition == "impact" and not a.impact:
        raise SystemExit("impact には --impact（current.toon の impacts の ID）が要る")
    if not a.reason.strip():
        raise SystemExit("--reason を書く")
    searches = {s.get("id"): s for s in doc.get("searches", [])}
    n = 0
    for h in doc.get("hits", []):
        s = searches.get(h.get("search"), {})
        if a.search and h.get("search") != a.search:
            continue
        if a.change and s.get("change") != a.change:
            continue
        if a.path_glob and not fnmatch.fnmatch(h.get("path", ""), a.path_glob):
            continue
        if a.line is not None and h.get("line") != a.line:
            continue
        if h.get("disposition") != "unclassified" and not a.force:
            continue
        h.update({"disposition": a.disposition, "impact": a.impact or "", "reason": a.reason})
        n += 1
    save(a.dir, "impact.toon", doc)
    left = sum(1 for h in doc.get("hits", []) if h.get("disposition") == "unclassified")
    print(f"{n} 件を {a.disposition} にしました（未分類の残り {left} 件）")
    return 0


def git_commits(repo, max_commits):
    r = subprocess.run(["git", "-C", repo, "log", f"-n{max_commits}", "--format=@@%H", "--name-only", "--no-renames"], capture_output=True)
    if r.returncode != 0:
        raise SystemExit("git log に失敗: " + r.stderr.decode("utf-8", "replace"))
    commits = []
    cur = None
    for line in r.stdout.decode("utf-8", "replace").split("\n"):
        if line.startswith("@@"):
            cur = set()
            commits.append(cur)
        elif line.strip() and cur is not None:
            cur.add(line.strip().replace("\\", "/"))
    return commits


def cmd_cochange(a):
    repo, ledger_rel = repo_and_ledger(a.dir)
    doc = load(a.dir, "impact.toon")
    cur = load(a.dir, "current.toon")
    files = []
    for c in doc.get("changes", []):
        if c.get("origin") == "existing" and c.get("ev_path") not in ("", "none", None, "conversation"):
            p = c["ev_path"][4:] if c["ev_path"].startswith("doc:") else c["ev_path"]
            if p not in files:
                files.append(p)
    inv = cur.setdefault("investigations", [])
    row = next((r for r in inv if r.get("area") == COCHANGE_AREA), None)
    if row is None:
        row = {"id": f"INV{next_id(inv, 'INV'):03d}", "area": COCHANGE_AREA, "method": "history", "status": "done",
               "boundary_reason": "", "note": ""}
        inv.append(row)
    if not is_git(repo):
        row.update({"status": "not_done", "boundary_reason": "git のリポジトリではないため、変更の共起を調べられない"})
        save(a.dir, "current.toon", cur)
        print("git のリポジトリではないため、調べられないことを調査台帳に記録しました")
        return 0
    commits = git_commits(repo, a.max_commits)
    old = {(r.get("file"), r.get("partner")): r for r in doc.get("cochanges", [])}
    rows = []
    for f in files:
        with_f = [c for c in commits if f in c]
        if not with_f:
            continue
        counts = {}
        for c in with_f:
            for p in c:
                if p != f and not (ledger_rel and p.startswith(ledger_rel + "/")):
                    counts[p] = counts.get(p, 0) + 1
        for p, n in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
            pct = n * 100 // len(with_f)
            if n < a.min_count or pct < a.min_percent:
                continue
            prev = old.get((f, p))
            rows.append({"file": f, "partner": p, "count": n, "percent": pct,
                         "disposition": prev.get("disposition") if prev else "unclassified",
                         "impact": prev.get("impact", "") if prev else "", "reason": prev.get("reason", "") if prev else ""})
    for k, r in old.items():
        if k[0] not in files:
            rows.append(r)
    doc["cochanges"] = rows
    row.update({"status": "done", "boundary_reason": "",
                "note": f"直近 {len(commits)} 件のコミット。{a.min_count} 回以上かつ {a.min_percent}% 以上一緒に変更されたファイル"})
    save(a.dir, "impact.toon", doc)
    save(a.dir, "current.toon", cur)
    left = sum(1 for r in rows if r.get("disposition") == "unclassified")
    print(f"変更するファイル {len(files)} 件について、一緒に変更されてきたファイル {len(rows)} 件を記録しました（未分類 {left} 件）")
    return 0


def cmd_summary(a):
    doc = load(a.dir, "impact.toon")
    searches = doc.get("searches", [])
    for c in doc.get("changes", []):
        ss = [s for s in searches if s.get("change") == c.get("id")]
        tally = {}
        for h in doc.get("hits", []):
            if any(h.get("search") == s.get("id") for s in ss):
                tally[h.get("disposition")] = tally.get(h.get("disposition"), 0) + 1
        print(f"{c.get('id')} {c.get('name')}: 検索 {len(ss)} 件 " + " ".join(f"{k}:{v}" for k, v in sorted(tally.items())))
    ct = {}
    for r in doc.get("cochanges", []):
        ct[r.get("disposition")] = ct.get(r.get("disposition"), 0) + 1
    print("変更の共起: " + (" ".join(f"{k}:{v}" for k, v in sorted(ct.items())) or "なし"))
    return 0


def main(argv):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("search")
    p.add_argument("dir")
    p.add_argument("--change", default="")
    p.add_argument("--term", action="append", required=True)
    p.add_argument("--variants", action="store_true")
    p.add_argument("--print", action="store_true")
    p = sub.add_parser("classify")
    p.add_argument("dir")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--search")
    g.add_argument("--change")
    g.add_argument("--all", action="store_true")
    p.add_argument("--disposition", required=True)
    p.add_argument("--path-glob")
    p.add_argument("--line", type=int)
    p.add_argument("--impact")
    p.add_argument("--reason", required=True)
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("cochange")
    p.add_argument("dir")
    p.add_argument("--max-commits", type=int, default=3000)
    p.add_argument("--min-count", type=int, default=2)
    p.add_argument("--min-percent", type=int, default=20)
    p = sub.add_parser("summary")
    p.add_argument("dir")
    a = ap.parse_args(argv[1:])
    return {"search": cmd_search, "classify": cmd_classify, "cochange": cmd_cochange, "summary": cmd_summary}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
