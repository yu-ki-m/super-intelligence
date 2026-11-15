#!/usr/bin/env python3
"""Count how often modules change together in git history (co-change).

This is an observation aid. Frequent co-change hints that a change reason crosses
module boundaries; it does not prove it. Report the period and exclusions with
the numbers, because they change the result.

Usage:
  python -X utf8 co_change.py <repo> [--since 2025-01-01] [--until 2025-12-31]
      [--depth 2] [--map map.json] [--path src] [--exclude "*.lock"]...
      [--max-files 50] [--min-count 2] [--top 30] [--json]

--map takes a JSON list of [pattern, module] pairs, checked in order. fnmatch
patterns are used, so "*" also matches "/". Files that match no pattern fall
back to --depth.
"""
import argparse
import fnmatch
import itertools
import json
import subprocess
import sys
from collections import Counter

SEP = '\x1e'


def parse_args(argv):
    p = argparse.ArgumentParser(description='Count module co-change in git history.')
    p.add_argument('repo', help='path to a git repository')
    p.add_argument('--since', help='passed to git log --since (e.g. 2025-01-01)')
    p.add_argument('--until', help='passed to git log --until')
    p.add_argument('--depth', type=int, default=2, help='leading path components that name a module (default 2)')
    p.add_argument('--map', dest='map_file', help='JSON file: [[pattern, module], ...]')
    p.add_argument('--path', action='append', default=[], help='limit to this path (repeatable)')
    p.add_argument('--exclude', action='append', default=[], help='fnmatch pattern of files to ignore (repeatable)')
    p.add_argument('--max-files', type=int, default=50, help='skip commits touching more files than this (default 50)')
    p.add_argument('--min-count', type=int, default=2, help='hide pairs that changed together fewer times (default 2)')
    p.add_argument('--top', type=int, default=30, help='number of pairs to show (default 30)')
    p.add_argument('--json', action='store_true', help='print JSON instead of Markdown')
    args = p.parse_args(argv)
    if args.depth < 1:
        p.error('--depth must be 1 or more')
    return args


def load_map(path):
    if not path:
        return []
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list) or not all(
            isinstance(row, list) and len(row) == 2 and all(isinstance(x, str) and x for x in row)
            for row in data):
        raise ValueError('--map must be a JSON list of [pattern, module] string pairs')
    return [tuple(row) for row in data]


def module_of(path, depth, mapping):
    for pattern, name in mapping:
        if fnmatch.fnmatch(path, pattern):
            return name
    parts = path.split('/')
    if len(parts) == 1:
        return '(root)'
    # Never include the file name itself in the module name.
    return '/'.join(parts[:min(depth, len(parts) - 1)])


def read_commits(args):
    cmd = ['git', '-C', args.repo, '-c', 'core.quotepath=false', 'log', '--no-merges',
           '--name-only', f'--pretty=format:{SEP}%H']
    if args.since:
        cmd.append(f'--since={args.since}')
    if args.until:
        cmd.append(f'--until={args.until}')
    if args.path:
        cmd += ['--'] + args.path
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or 'git log failed')
    commits = []
    for chunk in proc.stdout.split(SEP):
        lines = [line.strip() for line in chunk.splitlines() if line.strip()]
        if lines:
            commits.append((lines[0], lines[1:]))
    return commits


def analyze(commits, args, mapping):
    per_module = Counter()
    pairs = Counter()
    used = skipped_large = skipped_empty = 0
    for _commit, files in commits:
        files = [f for f in files if not any(fnmatch.fnmatch(f, pat) for pat in args.exclude)]
        if not files:
            skipped_empty += 1
            continue
        if len(files) > args.max_files:
            skipped_large += 1
            continue
        used += 1
        modules = sorted({module_of(f, args.depth, mapping) for f in files})
        per_module.update(modules)
        pairs.update(itertools.combinations(modules, 2))
    rows = []
    for (a, b), together in pairs.items():
        if together < args.min_count:
            continue
        smaller = min(per_module[a], per_module[b])
        rows.append({'module_a': a, 'module_b': b, 'together': together,
                     'changes_a': per_module[a], 'changes_b': per_module[b],
                     'coupling': round(together / smaller, 2)})
    rows.sort(key=lambda r: (-r['together'], -r['coupling'], r['module_a'], r['module_b']))
    return {
        'commits_total': len(commits),
        'commits_used': used,
        'skipped_large': skipped_large,
        'skipped_excluded_only': skipped_empty,
        'modules': [{'module': m, 'changes': n} for m, n in per_module.most_common()],
        'pairs': rows[:args.top],
        'pairs_hidden': max(0, len(rows) - args.top),
    }


def to_markdown(result, args):
    cond = [f'depth={args.depth}', f'max-files={args.max_files}', f'min-count={args.min_count}']
    if args.since:
        cond.append(f'since={args.since}')
    if args.until:
        cond.append(f'until={args.until}')
    if args.path:
        cond.append('path=' + ','.join(args.path))
    if args.exclude:
        cond.append('exclude=' + ','.join(args.exclude))
    if args.map_file:
        cond.append(f'map={args.map_file}')
    out = [
        '# 同時変更の集計（観測値。境界の誤りの証明ではない）',
        '',
        f'- 条件：{"、".join(cond)}',
        f'- コミット：全{result["commits_total"]}件、集計{result["commits_used"]}件、'
        f'一括変更として除外{result["skipped_large"]}件、除外ファイルのみ{result["skipped_excluded_only"]}件',
        '',
        '## モジュールごとの変更コミット数',
        '',
        '| モジュール | 変更コミット数 |',
        '|---|---|',
    ]
    out += [f'| {m["module"]} | {m["changes"]} |' for m in result['modules']]
    out += [
        '',
        '## 同時に変更されたモジュールの組',
        '',
        '結合度は、同時変更コミット数を、変更回数が少ない方のモジュールのコミット数で割った値。',
        '',
        '| モジュールA | モジュールB | 同時変更 | Aの変更 | Bの変更 | 結合度 |',
        '|---|---|---|---|---|---|',
    ]
    out += [f'| {r["module_a"]} | {r["module_b"]} | {r["together"]} | {r["changes_a"]} | '
            f'{r["changes_b"]} | {r["coupling"]:.2f} |' for r in result['pairs']]
    if not result['pairs']:
        out.append('| （該当なし） | | | | | |')
    if result['pairs_hidden']:
        out += ['', f'ほかに{result["pairs_hidden"]}組（--top で表示件数を増やせる）。']
    return '\n'.join(out)


def main(argv=None):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        mapping = load_map(args.map_file)
        commits = read_commits(args)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f'Input error: {exc}', file=sys.stderr)
        return 2
    result = analyze(commits, args, mapping)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(to_markdown(result, args))
    return 0


if __name__ == '__main__':
    sys.exit(main())
