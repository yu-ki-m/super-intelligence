#!/usr/bin/env python3
"""Use the bundled quality catalog and check review-ledger completeness.

Python standard library only. This verifies bookkeeping, never requirement truth.
"""
import argparse
from collections import Counter
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

DEFAULT_CATALOG = Path(__file__).resolve().parents[1] / 'references' / 'quality' / 'catalog.json'
STATUSES = {'unreviewed', 'unknown', 'covered', 'gap', 'conflict', 'not_applicable', 'out_of_scope'}
UPDATE_TEXT_FIELDS = ('reason', 'expected', 'next_action')
UPDATE_LIST_FIELDS = ('evidence', 'finding_ids')
UPDATE_KEYS = {'ids', 'status', *UPDATE_TEXT_FIELDS, *UPDATE_LIST_FIELDS}
NOTICE = ('このカタログを、案件固有の要求候補を発見するために使う。'
          '各項目の適用条件・必要性・代替手段を確認し、一律に必須要件としない。'
          '技術例や数値をそのまま採用せず、案件の根拠に基づいて判断する。'
          '規格・法令・期限を判断に用いる場合は適用範囲と最新性を確認する。')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, obj, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x' if exclusive else 'w', encoding='utf-8', newline='\n') as stream:
        json.dump(obj, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def catalog_digest(groups):
    encoded = json.dumps(groups, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def check_catalog(catalog):
    if catalog.get('schema_version') != 2:
        raise ValueError('Unsupported catalog schema version')
    if not isinstance(catalog.get('catalog_version'), str) or not catalog['catalog_version'].strip():
        raise ValueError('Missing catalog version')
    groups = catalog.get('groups')
    if not isinstance(groups, list) or not groups:
        raise ValueError('Catalog groups must be a nonempty array')
    seen = set()

    def walk(nodes, level, parent=''):
        for node in nodes:
            rid = node.get('id')
            text_key = 'name' if level < 2 else 'text'
            if not isinstance(rid, str) or not rid.strip() or rid in seen:
                raise ValueError('Missing or duplicate catalog ID')
            if parent and not rid.startswith(parent + '.'):
                raise ValueError(f'Invalid catalog hierarchy: {rid}')
            seen.add(rid)
            if not isinstance(node.get(text_key), str) or not node[text_key].strip():
                raise ValueError(f'Missing catalog wording: {rid}')
            if level < 3:
                child_key = ('subcharacteristics', 'viewpoints', 'checks')[level]
                children = node.get(child_key)
                if not isinstance(children, list) or not children:
                    raise ValueError(f'Empty catalog section: {rid}')
                walk(children, level + 1, rid)

    walk(groups, 0)
    if catalog.get('catalog_sha256') != catalog_digest(groups):
        raise ValueError('Bundled catalog fingerprint does not match its contents')


def flatten(catalog):
    for group in catalog['groups']:
        for sub in group['subcharacteristics']:
            for point in sub['viewpoints']:
                for check in point['checks']:
                    yield group, sub, point, check


def counts(catalog):
    subs = [s for g in catalog['groups'] for s in g['subcharacteristics']]
    points = [p for s in subs for p in s['viewpoints']]
    return {'characteristics': len(catalog['groups']), 'subcharacteristics': len(subs),
            'viewpoints': len(points), 'checks': sum(len(p['checks']) for p in points)}


def render_catalog(catalog, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'catalog.json', catalog)
    total = counts(catalog)
    index = ['# 品質観点カタログ', '', NOTICE, '',
             f"カタログ版：`{catalog['catalog_version']}`", '',
             f"{total['characteristics']}品質特性・{total['subcharacteristics']}副特性・"
             f"{total['viewpoints']}観点・{total['checks']}確認項目。", '',
             '副特性名の一覧だけでは分析済みにならない。適用がある、または不明な分野の詳細ファイルを開き、'
             '観点と詳細確認項目を読む。未読・未分析の項目は台帳に残す。', '',
             'IDはこの版のカタログ内で一意。カタログ更新時は、'
             '旧台帳をIDだけで流用せず、項目内容・前提を照合して移行する。', '',
             '| ID | 品質副特性 | 観点数 | 確認項目数 | 詳細 |', '|---|---|---:|---:|---|']
    viewpoints = [f"# 全{total['viewpoints']}観点の一次選別用一覧", '', NOTICE, '',
                  '全体を見渡して適用候補と未知領域を発見するための一覧。'
                  'この確認項目は、一覧を読むだけでは分析済みにならない。'
                  '関連あり・不明の観点はリンク先の詳細を読む。', '']
    for group in catalog['groups']:
        filename = f"{group['id'].lower()}.md"
        body = [f"# {group['id']} {group['name']}", '', NOTICE, '',
                '項目IDを使って案件の根拠・要求候補・指摘・検証条件を結び付ける。', '']
        for sub in group['subcharacteristics']:
            n = sum(len(p['checks']) for p in sub['viewpoints'])
            index.append(f"| {sub['id']} | {sub['name']} | {len(sub['viewpoints'])} | {n} | "
                         f"[{group['name']}]({filename}#{sub['id'].replace('.', '-')}) |")
            body += [f'<a id="{sub["id"].replace(".", "-")}"></a>',
                     f"## {sub['id']} {sub['name']}", '']
            viewpoints += [f"## {sub['id']} {sub['name']}", '',
                           f"[詳細]({filename}#{sub['id'].replace('.', '-')})", '']
            for point in sub['viewpoints']:
                viewpoints.append(f"- `{point['id']}` {point['text']}（詳細{len(point['checks'])}件）")
                body += [f"### {point['id']} {point['text']}", '']
                body += [f"- `{c['id']}` {c['text']}" for c in point['checks']]
                body.append('')
            viewpoints.append('')
        (output / filename).write_text('\n'.join(body) + '\n', encoding='utf-8')
    index += ['', '[全観点の一次選別一覧](viewpoints.md)', '', '[台帳の使用方法](../coverage-workflow.md)', '']
    (output / 'index.md').write_text('\n'.join(index), encoding='utf-8')
    (output / 'viewpoints.md').write_text('\n'.join(viewpoints) + '\n', encoding='utf-8')


def check_markdown(catalog, directory):
    """Confirm the Markdown views next to the catalog are exactly what the catalog renders to.

    The Markdown files are what reviewers read; the JSON is what the scripts use. Both must
    carry the same items so that no external document is needed to trust either of them.
    """
    directory = Path(directory)
    if not (directory / 'index.md').is_file():
        return {'markdown_checked': False, 'reason': f'No Markdown views next to the catalog: {directory}'}
    with TemporaryDirectory() as temp:
        render_catalog(catalog, temp)
        expected = sorted(p for p in Path(temp).glob('*.md'))
        missing = [p.name for p in expected if not (directory / p.name).is_file()]
        differing = [p.name for p in expected if (directory / p.name).is_file()
                     and (directory / p.name).read_bytes() != p.read_bytes()]
    if missing or differing:
        raise ValueError('Bundled Markdown views do not match the catalog '
                         f'(missing: {", ".join(missing) or "none"}; differing: {", ".join(differing) or "none"}). '
                         'Regenerate them with the render command instead of editing them by hand.')
    return {'markdown_checked': True, 'markdown_files': len(expected)}


def init_ledger(catalog, output):
    checks = []
    for group, sub, point, check in flatten(catalog):
        checks.append({'id': check['id'], 'status': 'unreviewed', 'reason': '',
                       'expected': '', 'evidence': [], 'finding_ids': [], 'next_action': ''})
    ledger = {'schema_version': 2, 'catalog_sha256': catalog['catalog_sha256'],
              'scope': '', 'baseline': '', 'target': '', 'checks': checks}
    write_json(output, ledger, exclusive=True)
    return {'created': str(output), 'check_count': len(checks), 'default_status': 'unreviewed'}


def validate_ledger(catalog, ledger):
    errors = []
    if not isinstance(ledger, dict):
        return {'structurally_valid': False, 'errors': ['Ledger must be an object']}
    if ledger.get('schema_version') != 2:
        errors.append('Unsupported ledger schema_version')
    if ledger.get('catalog_sha256') != catalog['catalog_sha256']:
        errors.append('Catalog fingerprint differs; reassess before migrating ledger')
    for key in ('scope', 'baseline', 'target'):
        if not isinstance(ledger.get(key), str) or not ledger[key].strip():
            errors.append(f'Missing review context: {key}')
    rows = ledger.get('checks')
    if not isinstance(rows, list):
        return {'structurally_valid': False, 'errors': errors + ['checks must be an array']}
    expected = {c['id'] for _, _, _, c in flatten(catalog)}
    actual = [r.get('id') for r in rows if isinstance(r, dict)]
    if len(actual) != len(rows) or any(not isinstance(i, str) for i in actual):
        return {'structurally_valid': False, 'errors': errors + ['All check rows need string IDs']}
    seen = Counter(actual)
    if expected - set(actual):
        errors.append('Missing check IDs: ' + ', '.join(sorted(expected - set(actual))[:10]))
    if set(actual) - expected:
        errors.append('Unknown check IDs: ' + ', '.join(sorted(set(actual) - expected)[:10]))
    if any(n > 1 for n in seen.values()):
        errors.append('Duplicate check IDs: ' + ', '.join(i for i, n in seen.items() if n > 1))
    status_counts = Counter()
    per_sub = {}
    for row in rows:
        rid, status = row['id'], row.get('status')
        if not isinstance(status, str) or status not in STATUSES:
            errors.append(f'{rid}: invalid status')
            continue
        status_counts[status] += 1
        per_sub.setdefault('.'.join(rid.split('.')[:2]), Counter())[status] += 1
        for field in ('reason', 'expected', 'next_action'):
            if not isinstance(row.get(field), str):
                errors.append(f'{rid}: {field} must be a string')
        for field in ('evidence', 'finding_ids'):
            value = row.get(field)
            if not isinstance(value, list) or any(not isinstance(v, str) or not v.strip() for v in value):
                errors.append(f'{rid}: {field} must be an array of nonempty strings')
        if status != 'unreviewed' and not str(row.get('reason', '')).strip():
            errors.append(f'{rid}: a reviewed row needs a reason')
        if status in {'covered', 'gap', 'conflict', 'not_applicable', 'out_of_scope'} and not row.get('evidence'):
            errors.append(f'{rid}: this disposition needs evidence')
        if status in {'covered', 'gap', 'conflict'} and not str(row.get('expected', '')).strip():
            errors.append(f'{rid}: expected condition is missing')
        if status in {'gap', 'conflict'} and not row.get('finding_ids'):
            errors.append(f'{rid}: finding linkage is missing')
        if status in {'gap', 'conflict', 'unknown'} and not str(row.get('next_action', '')).strip():
            errors.append(f'{rid}: next action is missing')
    unresolved = sum(status_counts[s] for s in ('unreviewed', 'unknown', 'out_of_scope'))
    return {'structurally_valid': not errors, 'errors': errors, 'expected_checks': len(expected),
            'status_counts': dict(status_counts), 'by_subcharacteristic': per_sub,
            'catalog_disposition_complete': not errors and unresolved == 0,
            'open_findings_check_count': status_counts['gap'] + status_counts['conflict'],
            'warning': 'Structure and counts only; neither factual validity nor product approval is proven.'}


def select_viewpoints(catalog, ids):
    """Resolve subcharacteristic (Q01.01) or viewpoint (Q01.01.001) IDs, keeping their order."""
    subs, points = {}, {}
    for group in catalog['groups']:
        for sub in group['subcharacteristics']:
            subs[sub['id']] = sub
            for point in sub['viewpoints']:
                points[point['id']] = (sub, point)
    selected, unknown, seen = [], [], set()
    for raw in ids:
        rid = raw.strip()
        if rid in points:
            found = [points[rid]]
        elif rid in subs:
            found = [(subs[rid], point) for point in subs[rid]['viewpoints']]
        else:
            unknown.append(rid)
            continue
        for sub, point in found:
            if point['id'] not in seen:
                seen.add(point['id'])
                selected.append((sub, point))
    if unknown:
        raise ValueError('Unknown subcharacteristic or viewpoint IDs (check IDs are not accepted): '
                         + ', '.join(unknown[:10]))
    if not selected:
        raise ValueError('No subcharacteristic or viewpoint IDs were given')
    return selected


def show_viewpoints(catalog, ids, ledger=None):
    """Return the detailed checks of the selected viewpoints as Markdown text."""
    selected = select_viewpoints(catalog, ids)
    status = {}
    if ledger is not None:
        if ledger.get('catalog_sha256') != catalog['catalog_sha256']:
            raise ValueError('Catalog fingerprint differs; reassess before using the ledger')
        status = {row.get('id'): row.get('status') for row in ledger.get('checks', []) if isinstance(row, dict)}
    check_total = sum(len(point['checks']) for _, point in selected)
    lines = [f'# 詳細確認項目（観点 {len(selected)}件・確認項目 {check_total}件、カタログ版 {catalog["catalog_version"]}）',
             '', NOTICE, '']
    current = None
    for sub, point in selected:
        if sub['id'] != current:
            current = sub['id']
            lines += [f"## {sub['id']} {sub['name']}", '']
        lines += [f"### {point['id']} {point['text']}", '']
        for check in point['checks']:
            suffix = f"（台帳：{status.get(check['id'], '記録なし')}）" if ledger is not None else ''
            lines.append(f"- `{check['id']}` {check['text']}{suffix}")
        lines.append('')
    lines += ['表示した観点ID（読んだ観点の記録と `validate --read` に使う）：',
              ' '.join(point['id'] for _, point in selected), '']
    return '\n'.join(lines)


def read_check(catalog, ledger, ids):
    """Compare the viewpoints whose details were read with the rows judged in the ledger."""
    selected = select_viewpoints(catalog, ids)
    in_read = {check['id'] for _, point in selected for check in point['checks']}
    status = {row.get('id'): row.get('status') for row in ledger.get('checks', []) if isinstance(row, dict)}
    unreviewed = sorted(i for i in in_read if status.get(i) == 'unreviewed')
    outside = sorted(i for i, s in status.items() if s != 'unreviewed' and i not in in_read)
    return {'viewpoints': len(selected), 'checks_in_read_viewpoints': len(in_read),
            'unreviewed_in_read': unreviewed, 'reviewed_outside_read': outside,
            'consistent': not unreviewed and not outside}


def update_ledger(catalog, ledger_path, updates_path):
    """Apply explicit per-ID decisions so the large ledger never needs hand editing.

    Each update replaces the whole record of every listed ID; omitted fields become
    empty. IDs must be listed one by one: a viewpoint ID never stands in for its checks.
    Nothing is written when any update is malformed or would leave an invalid row.
    """
    ledger = read_json(ledger_path)
    if not isinstance(ledger, dict) or not isinstance(ledger.get('checks'), list):
        raise ValueError('Ledger must be an object with a checks array')
    if ledger.get('catalog_sha256') != catalog['catalog_sha256']:
        raise ValueError('Catalog fingerprint differs; reassess before updating the ledger')
    data = read_json(updates_path)
    if not isinstance(data, dict) or not isinstance(data.get('updates', []), list):
        raise ValueError('Update file must be an object with an "updates" array')
    unknown_keys = set(data) - {'scope', 'baseline', 'target', 'updates'}
    errors = [f'Unknown top-level key: {key}' for key in sorted(unknown_keys)]
    for key in ('scope', 'baseline', 'target'):
        if key in data and (not isinstance(data[key], str) or not data[key].strip()):
            errors.append(f'{key}: non-empty text is required')
    known_ids = {row.get('id') for row in ledger['checks'] if isinstance(row, dict)}
    touched = []
    for index, item in enumerate(data.get('updates', []), 1):
        prefix = f'updates[{index}]'
        if not isinstance(item, dict):
            errors.append(f'{prefix}: must be an object')
            continue
        for key in sorted(set(item) - UPDATE_KEYS):
            errors.append(f'{prefix}: unknown key {key!r}')
        ids = item.get('ids')
        if not isinstance(ids, list) or not ids or any(not isinstance(i, str) or not i.strip() for i in ids):
            errors.append(f'{prefix}.ids: list every check ID explicitly (no prefixes or wildcards)')
            continue
        unknown = [i for i in ids if i not in known_ids]
        if unknown:
            errors.append(f'{prefix}.ids: unknown check IDs: ' + ', '.join(unknown[:10]))
        if item.get('status') not in STATUSES:
            errors.append(f'{prefix}.status: one of {", ".join(sorted(STATUSES))} is required')
        for field in UPDATE_TEXT_FIELDS:
            if field in item and not isinstance(item[field], str):
                errors.append(f'{prefix}.{field}: text is required')
        for field in UPDATE_LIST_FIELDS:
            value = item.get(field, [])
            if not isinstance(value, list) or any(not isinstance(v, str) or not v.strip() for v in value):
                errors.append(f'{prefix}.{field}: an array of non-empty text is required')
        touched.extend(ids)
    repeated = sorted(i for i, n in Counter(touched).items() if n > 1)
    if repeated:
        errors.append('IDs updated more than once in one file: ' + ', '.join(repeated[:10]))
    if errors:
        raise ValueError('\n'.join(errors))

    updated = copy.deepcopy(ledger)
    for key in ('scope', 'baseline', 'target'):
        if key in data:
            updated[key] = data[key]
    rows = {row['id']: row for row in updated['checks']}
    for item in data.get('updates', []):
        for check_id in item['ids']:
            row = rows[check_id]
            row['status'] = item['status']
            for field in UPDATE_TEXT_FIELDS:
                row[field] = item.get(field, '')
            for field in UPDATE_LIST_FIELDS:
                row[field] = list(item.get(field, []))
    result = validate_ledger(catalog, updated)
    targets = set(touched)
    row_errors = [e for e in result['errors'] if e.split(':', 1)[0] in targets]
    if row_errors:
        raise ValueError('Rejected; no changes were written:\n' + '\n'.join(row_errors))

    ledger_path = Path(ledger_path)
    temporary = ledger_path.with_name(ledger_path.name + '.tmp')
    write_json(temporary, updated)
    os.replace(temporary, ledger_path)
    result['updated_checks'] = len(touched)
    result['ledger'] = str(ledger_path)
    return result


def id_file_tokens(line):
    """Read @file arguments as whitespace-separated IDs; text after '#' is a comment."""
    return line.split('#', 1)[0].split()


def main():
    parser = argparse.ArgumentParser(description=__doc__, fromfile_prefix_chars='@')
    parser.convert_arg_line_to_args = id_file_tokens
    parser.add_argument('--catalog', type=Path, default=DEFAULT_CATALOG)
    commands = parser.add_subparsers(dest='command', required=True)
    render = commands.add_parser('render')
    render.add_argument('--output', type=Path, required=True)
    commands.add_parser('check-catalog')
    init =commands.add_parser('init')
    init.add_argument('--output', type=Path, required=True)
    validate = commands.add_parser('validate')
    validate.add_argument('--ledger', type=Path, required=True)
    validate.add_argument('--require-complete', action='store_true')
    validate.add_argument('--read', nargs='+', metavar='ID',
                          help='Subcharacteristic or viewpoint IDs whose details were read; checks the ledger against them')
    show = commands.add_parser('show', help='Print the detailed checks of subcharacteristics or viewpoints')
    show.add_argument('--ids', nargs='+', required=True, metavar='ID')
    show.add_argument('--ledger', type=Path, help='Also print the current status of each check')
    update = commands.add_parser('update', help='Apply explicit per-ID decisions from a small JSON file')
    update.add_argument('--ledger', type=Path, required=True)
    update.add_argument('--input', type=Path, required=True)
    args = parser.parse_args()
    try:
        catalog = read_json(args.catalog)
        check_catalog(catalog)
        if args.command == 'render':
            render_catalog(catalog, args.output)
            result = counts(catalog)
        elif args.command == 'check-catalog':
            result = {'catalog_valid': True, 'catalog_version': catalog['catalog_version'], **counts(catalog),
                      **check_markdown(catalog, args.catalog.parent)}
        elif args.command == 'init':
            result = init_ledger(catalog, args.output)
        elif args.command == 'update':
            result = update_ledger(catalog, args.ledger, args.input)
        elif args.command == 'show':
            ledger = read_json(args.ledger) if args.ledger else None
            print(show_viewpoints(catalog, args.ids, ledger))
            return 0
        else:
            ledger = read_json(args.ledger)
            result = validate_ledger(catalog, ledger)
            if args.read:
                result['read_check'] = read_check(catalog, ledger, args.read)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            if not result['structurally_valid']:
                return 1
            if args.read and not result['read_check']['consistent']:
                return 3
            return 2 if args.require_complete and not result['catalog_disposition_complete'] else 0
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
