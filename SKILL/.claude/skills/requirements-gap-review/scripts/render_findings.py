"""Validate review findings and render a self-contained, escaped HTML table."""
from __future__ import annotations

import argparse
from html import escape
import json
from pathlib import Path
import sys


STATUSES = {'確認できた不足', '要判断', '分析不能', '矛盾', '解消・対象外'}
SEVERITIES = {'重大', '高', '中', '低'}
FIELDS = ('id', 'title', 'status', 'severity', 'impact', 'scenario', 'observed',
          'expected', 'layers', 'reverse_trace', 'confidence_reason',
          'recommended_fix', 'next_action', 'decision_role', 'decision_timing')
COLUMNS = (
    ('id', 'ID', 100),
    ('title', '指摘', 300),
    ('status', '区分', 140),
    ('severity', '重大度', 90),
    ('impact', '業務への影響', 280),
    ('scenario', '再現シナリオ', 280),
    ('observed', '現在の結果', 280),
    ('expected', '必要な結果', 280),
    ('layers', '修正する層', 240),
    ('reverse_trace', '逆向きの対応', 330),
    ('evidence', '根拠', 450),
    ('confidence_pct', '確度（%）', 100),
    ('confidence_reason', '確度の理由', 280),
    ('recommended_fix', '推奨する修正', 400),
    ('verification', '検証条件', 360),
    ('next_action', '次の行動', 240),
    ('decision_role', '判断先', 180),
    ('decision_timing', '判断が必要な時点', 200),
)


def nonblank(value):
    return isinstance(value, str) and bool(value.strip())


def string_list(value, allow_empty=False):
    return (isinstance(value, list) and (allow_empty or bool(value))
            and all(nonblank(item) for item in value))


def validate(data):
    errors = []
    if not isinstance(data, dict):
        raise ValueError('Report must be a JSON object')
    if type(data.get('schema_version')) is not int or data['schema_version'] != 2:
        errors.append('schema_version must be 2')
    for key in ('title', 'target', 'baseline', 'scope', 'summary'):
        if not nonblank(data.get(key)):
            errors.append(f'{key}: non-empty text is required')
    for key in ('limitations', 'artifacts'):
        if not string_list(data.get(key, []), allow_empty=True):
            errors.append(f'{key}: a list of non-empty text is required')
    if 'limitations' not in data:
        errors.append('limitations is required (an empty list is allowed)')
    rows = data.get('findings')
    if not isinstance(rows, list):
        errors.append('findings must be a list')
        rows = []
    seen = set()
    for index, row in enumerate(rows, 1):
        prefix = f'findings[{index}]'
        if not isinstance(row, dict):
            errors.append(f'{prefix}: must be an object')
            continue
        for key in FIELDS:
            if not nonblank(row.get(key)):
                errors.append(f'{prefix}.{key}: non-empty text is required')
        identifier = row.get('id')
        if nonblank(identifier):
            if identifier.strip() in seen:
                errors.append(f'{prefix}.id: duplicate ID {identifier!r}')
            seen.add(identifier.strip())
        if isinstance(row.get('status'), str) and row['status'] not in STATUSES:
            errors.append(f'{prefix}.status: unsupported status')
        if isinstance(row.get('severity'), str) and row['severity'] not in SEVERITIES:
            errors.append(f'{prefix}.severity: unsupported severity')
        confidence = row.get('confidence_pct')
        if type(confidence) is not int or not 0 <= confidence <= 100:
            errors.append(f'{prefix}.confidence_pct: an integer from 0 to 100 is required')
        evidence = row.get('evidence')
        if not isinstance(evidence, dict):
            errors.append(f'{prefix}.evidence: behavior, necessity and counterevidence are required')
        else:
            for key in ('behavior', 'necessity', 'counterevidence'):
                if not string_list(evidence.get(key)):
                    errors.append(f'{prefix}.evidence.{key}: at least one evidence record is required')
        if not string_list(row.get('verification')):
            errors.append(f'{prefix}.verification: at least one verification condition is required')
    if errors:
        raise ValueError('\n'.join(errors))


def text_html(value):
    return escape(str(value), quote=True).replace('\n', '<br>')


def items(values):
    return '<ul>' + ''.join(f'<li>{text_html(value)}</li>' for value in values) + '</ul>'


def render(data):
    validate(data)
    rows = []
    for row in data['findings']:
        evidence = row['evidence']
        evidence_html = (
            '<strong>挙動の証拠</strong>' + items(evidence['behavior'])
            + '<strong>必要性の根拠</strong>' + items(evidence['necessity'])
            + '<strong>反証・限界</strong>' + items(evidence['counterevidence'])
        )
        cells = []
        for key, _, _ in COLUMNS:
            if key == 'evidence':
                cells.append(evidence_html)
            elif key == 'confidence_pct':
                cells.append(f'<p class="confidence">{row[key]}%</p>')
            elif key == 'verification':
                cells.append(items(row[key]))
            else:
                cells.append('<p>' + text_html(row[key]) + '</p>')
        # All caller-supplied content is text; only the fixed template creates HTML.
        rows.append('<tr>' + ''.join(f'<td>{cell}</td>' for cell in cells) + '</tr>')
    if not rows:
        rows.append(f'<tr><td colspan="{len(COLUMNS)}">指摘0件。対象範囲と未確認・未分析を併せて確認してください。</td></tr>')
    headers = ''.join(f'<th scope="col">{label}</th>' for _, label, _ in COLUMNS)
    column_styles = ''.join(f'<col style="width:{width}px">' for _, _, width in COLUMNS)
    table_width = sum(width for _, _, width in COLUMNS)
    open_count = sum(row['status'] != '解消・対象外' for row in data['findings'])
    limitations = items(data['limitations']) if data['limitations'] else '<p>未確認事項の登録はありません。対象範囲外を含む網羅性の保証ではありません。</p>'
    artifacts = ('<section><h2>分析記録・参照先</h2>' + items(data['artifacts']) + '</section>') if data.get('artifacts') else ''
    return '''<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>''' + escape(data['title'], quote=True) + '''</title>
<style>
:root{color-scheme:light;font-family:"Yu Gothic UI","Meiryo",sans-serif;color:#172b42;background:#f3f6fa}
*{box-sizing:border-box}body{margin:0;padding:28px}main{max-width:1800px;margin:auto}
header,section{background:#fff;border:1px solid #d9e2ee;border-radius:10px;padding:22px;margin-bottom:20px}
header{border-top:5px solid #2456a6}h1{font-size:26px;margin:0 0 12px}h2{font-size:18px;margin:0 0 12px}
p,li,dd{line-height:1.65;overflow-wrap:anywhere}p{margin:0 0 12px}p:last-child{margin-bottom:0}
dl{display:grid;grid-template-columns:100px 1fr;gap:8px 16px;margin:16px 0 0}dt{font-weight:700}dd{margin:0;white-space:pre-wrap}
.note{color:#425974;font-size:13px}.counts{font-weight:700;color:#2456a6}.table-wrap{overflow:auto;max-height:75vh;border:1px solid #c8d5e5;border-radius:6px}
table{border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:13px}
caption{text-align:left;padding:14px;font-size:16px;font-weight:700;background:#f0f5fc}
th{background:#1b3556;color:white;text-align:left;vertical-align:top;padding:14px;position:sticky;top:0;z-index:2}
td{border-right:1px solid #d9e2ee;border-bottom:1px solid #d9e2ee;padding:14px;vertical-align:top;overflow-wrap:anywhere;background:white}
tbody tr:nth-child(even) td{background:#f6f9fd}th:first-child,td:first-child{position:sticky;left:0}
td:first-child{z-index:1}th:first-child{z-index:3}.confidence{font-size:23px;font-weight:700;color:#2456a6}
td strong{font-weight:700}ul{margin:5px 0 14px;padding-left:19px}li+li{margin-top:7px}td ul:last-child{margin-bottom:0}
@media(max-width:700px){body{padding:12px}header,section{padding:16px}h1{font-size:22px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:8px}}
@media print{@page{size:A3 landscape;margin:10mm}body{background:white;padding:0}main{max-width:none}header,section{border:0;padding:0}table{width:100%!important;font-size:8px}col{width:auto!important}.table-wrap{overflow:visible;max-height:none}thead{display:table-header-group}th,td{position:static!important;padding:4px}.confidence{font-size:12px}}
</style>
</head>
<body><main>
<header><h1>''' + text_html(data['title']) + '''</h1>
<p>''' + text_html(data['summary']) + '''</p>
<p class="counts">未解決 ''' + str(open_count) + '件 ／ 掲載 ' + str(len(data['findings'])) + '''件</p>
<dl><dt>対象の版</dt><dd>''' + text_html(data['target']) + '''</dd>
<dt>比較基準</dt><dd>''' + text_html(data['baseline']) + '''</dd>
<dt>調査範囲</dt><dd>''' + text_html(data['scope']) + '''</dd></dl></header>
<section><h2>指摘一覧</h2>
<p class="note" id="confidence-note">確度は指摘の妥当性への証拠に基づく評価です。統計的に校正された確率、障害発生確率、重大度、網羅率とは異なります。数値と評価理由を併せて確認してください。</p>
<p class="note">各項目を独立した列に掲載しています。表は縦横にスクロールでき、見出しとID列を固定しています。</p>
<div class="table-wrap" role="region" aria-label="指摘一覧の横スクロール領域" tabindex="0">
<table style="width:''' + str(table_width) + '''px" aria-describedby="confidence-note"><caption>要求・要件・仕様のレビュー結果</caption><colgroup>''' + column_styles + '''</colgroup><thead><tr>''' + headers + '''</tr></thead>
<tbody>''' + '\n'.join(rows) + '''</tbody></table></div></section>
<section><h2>未確認・未分析と判断上の限界</h2>''' + limitations + '''</section>
''' + artifacts + '''
</main></body></html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--overwrite', action='store_true', help='Replace an existing report explicitly')
    args = parser.parse_args()
    try:
        if args.input.resolve() == args.output.resolve():
            raise ValueError('Input and output must be different files')
        data = json.loads(args.input.read_text(encoding='utf-8-sig'))
        html = render(data)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('w' if args.overwrite else 'x', encoding='utf-8', newline='\n') as stream:
            stream.write(html)
    except (OSError, ValueError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'html': str(args.output), 'findings': len(data['findings']),
                      'validation': 'structure only; review conclusions are not verified'}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
