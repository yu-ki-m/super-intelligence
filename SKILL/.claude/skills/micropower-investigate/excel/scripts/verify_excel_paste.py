#!/usr/bin/env python3
"""Verify that copying from a generated workbook HTML pastes into desktop Excel exactly like the source.

For each sheet (or one --range) this
  1. builds the same cells natively in Excel from the workbook data (the reference),
  2. produces the clipboard HTML the page writes for that range (assets/core.js, the same code the page runs),
  3. puts it on the Windows clipboard the way Chrome/Edge do and pastes it into a new Excel workbook,
  4. compares value, type, formula, number format, font, colours, fill, alignment, wrap, indent, merge, link and
     all four borders cell by cell, and also reports what Excel's own copy-and-paste of the reference keeps.

Requires Windows, desktop Excel, PowerShell 7 (pwsh) and Node.js 18+. It overwrites the clipboard and starts a
hidden Excel; the user's open workbooks are not touched. Exit code: 0 = no unexpected difference, 1 = unexpected
differences, 2 = cannot run here (not Windows / no Excel / no pwsh).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / 'scripts' / 'excel_check'
DATA_RE = re.compile(r'<script id="workbook-data" type="application/json">(.*?)</script>', re.S)
FIELDS = ['value2', 'text', 'hasFormula', 'formula', 'prefix', 'numfmt', 'font', 'size', 'bold', 'italic', 'underline',
          'strike', 'color', 'fill', 'halign', 'valign', 'wrap', 'indent', 'mergeArea', 'hyperlink',
          'bTop', 'bBottom', 'bLeft', 'bRight']
LABEL = {'value2': '値', 'text': '表示文字列', 'hasFormula': '数式の有無', 'formula': '数式', 'prefix': '先頭の\'',
         'numfmt': '表示形式', 'font': 'フォント', 'size': 'サイズ', 'bold': '太字', 'italic': '斜体',
         'underline': '下線', 'strike': '取り消し線', 'color': '文字色', 'fill': '塗りつぶし', 'halign': '横位置',
         'valign': '縦位置', 'wrap': '折り返し', 'indent': 'インデント', 'mergeArea': '結合', 'hyperlink': 'リンク',
         'bTop': '上罫線', 'bBottom': '下罫線', 'bLeft': '左罫線', 'bRight': '右罫線'}
FONT_ALIAS = {'游ゴシック': 'Yu Gothic', '游明朝': 'Yu Mincho', 'メイリオ': 'Meiryo', 'ＭＳ ゴシック': 'MS Gothic',
              'ＭＳ Ｐゴシック': 'MS PGothic', 'ＭＳ 明朝': 'MS Mincho', 'ＭＳ Ｐ明朝': 'MS PMincho'}
EXPECTED = {'text-protected': {'numfmt', 'prefix'}, 'formula-as-value': {'hasFormula', 'formula'}}
REASON = {'text-protected': '数値・日付などに変わりうる文字列は、値を守るため表示形式「文字列」で渡す（Excelで \' を付けて入力した状態とは表示形式だけが異なる）',
          'formula-as-value': 'コピー範囲の外を参照する数式は、計算結果の値として渡す'}


def col_name(n):
    out = ''
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def coord(a):
    m = re.match(r'^([A-Z]+)(\d+)$', a)
    c = 0
    for ch in m.group(1):
        c = c * 26 + ord(ch) - 64
    return int(m.group(2)), c


def load_workbook(args):
    if args.input:
        return json.loads(Path(args.input).read_text(encoding='utf-8-sig'))
    m = DATA_RE.search(Path(args.html).read_text(encoding='utf-8-sig'))
    if not m:
        raise SystemExit('workbook-data が見つかりません。このスキルで生成した HTML を指定してください。')
    return json.loads(m.group(1))


def used_range(sheet):
    rows, cols = [], []
    for key in sheet['cells']:
        r, c = coord(key)
        rows.append(r)
        cols.append(c)
    for m in sheet.get('merges', []):
        rows += [m['r1'] + 1, m['r2'] + 1]
        cols += [m['c1'] + 1, m['c2'] + 1]
    if not rows:
        return 'A1:A1'
    return f'{col_name(min(cols))}{min(rows)}:{col_name(max(cols))}{max(rows)}'


def norm(field, value, cell):
    if field == 'font':
        return FONT_ALIAS.get(value, value)
    if field == 'numfmt':
        return {'G/標準': 'General'}.get(value, value).replace('"', '') if isinstance(value, str) else value
    if field == 'text' and isinstance(cell.get('value2'), (int, float)) and not isinstance(cell.get('value2'), bool):
        return None  # "####" when the column is narrow; value + format already cover numbers
    if field == 'formula' and not cell.get('hasFormula'):
        return None
    if field == 'value2' and isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def cells_of(path):
    data = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    return {c['addr']: c for c in data['cells']}, data


def compare(ref_path, got_path, notes):
    ref, ref_all = cells_of(ref_path)
    got, got_all = cells_of(got_path)
    unexpected, expected = [], []
    for addr, rc in ref.items():
        gc = got.get(addr, {})
        for f in FIELDS:
            a, b = norm(f, rc.get(f), rc), norm(f, gc.get(f), gc)
            if a == b:
                continue
            item = {'cell': addr, 'field': f, 'label': LABEL[f], 'excel': a, 'pasted': b}
            kind = notes.get(addr)
            if kind == 'border-conflict' and f in ('bTop', 'bBottom', 'bLeft', 'bRight'):
                item['cause'] = '隣のセルと同じ境界に異なる罫線を指定している（データの問題）'
            if kind in EXPECTED and f in EXPECTED[kind]:
                item['reason'] = REASON[kind]
                expected.append(item)
            else:
                unexpected.append(item)
    dims = {'columnsSource': [c['chars'] for c in ref_all['columns']], 'columnsPasted': [c['chars'] for c in got_all['columns']],
            'rowsSource': ref_all['rowHeights'], 'rowsPasted': got_all['rowHeights']}
    return unexpected, expected, dims


def run(cmd, what):
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if proc.returncode:
        raise RuntimeError(f'{what} に失敗しました:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}')
    return proc.stdout


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--html', help='このスキルで生成した HTML')
    src.add_argument('--input', help='ブック JSON')
    ap.add_argument('--sheet', help='シート ID（省略時は全シート）')
    ap.add_argument('--range', help='A1:H20 の形式（省略時は使用範囲）。--sheet と一緒に指定する')
    ap.add_argument('--out', help='結果フォルダ（省略時は一時フォルダ）')
    ap.add_argument('--pdf', action='store_true', help='Excel 上の見た目を PDF にも書き出す')
    args = ap.parse_args()
    if args.range and not args.sheet:
        ap.error('--range は --sheet と一緒に指定してください。')
    if sys.platform != 'win32' or not shutil.which('pwsh') or not shutil.which('node'):
        print('この環境では検証できません（Windows、PowerShell 7 の pwsh、Node.js、デスクトップ版 Excel が必要）。', file=sys.stderr)
        return 2

    workbook = load_workbook(args)
    out = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix='excel-paste-check-'))
    out.mkdir(parents=True, exist_ok=True)
    wb_path = out / 'workbook.json'
    wb_path.write_text(json.dumps(workbook, ensure_ascii=False), encoding='utf-8')
    sheets = [s for s in workbook['sheets'] if not args.sheet or s['id'] == args.sheet]
    if not sheets:
        ap.error(f'シート {args.sheet} がありません。')

    pwsh = ['pwsh', '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', str(CHECK / 'excel.ps1')]
    summary, total_unexpected = [], 0
    for sheet in sheets:
        rng = args.range or used_range(sheet)
        base = out / re.sub(r'[^\w-]', '_', sheet['id'])
        info = json.loads(run(['node', str(CHECK / 'clipboard.cjs'), str(wb_path), sheet['id'], rng, str(base) + '.ours'], 'クリップボード HTML の生成'))
        meta = json.loads(Path(str(base) + '.ours.notes.json').read_text(encoding='utf-8'))
        box = ['-R1', str(meta['r1']), '-C1', str(meta['c1']), '-R2', str(meta['r2']), '-C2', str(meta['c2'])]
        cells = (meta['r2'] - meta['r1'] + 1) * (meta['c2'] - meta['c1'] + 1)
        if cells > 3000:
            print(f'注意: {sheet["name"]} は {cells} セルあり、検証に数分かかります。--range で絞れます。', file=sys.stderr)
        try:
            run(pwsh + ['-Mode', 'native', '-Workbook', str(wb_path), '-Sheet', sheet['id'], '-Out', str(base)] + box + (['-Pdf'] if args.pdf else []), 'Excel での参照表の作成')
            run(pwsh + ['-Mode', 'paste', '-Html', str(base) + '.ours.html', '-Text', str(base) + '.ours.txt', '-Out', str(base) + '.pasted'] + box + (['-Pdf'] if args.pdf else []), 'Excel への貼り付け')
        except RuntimeError as exc:
            if 'Excel.Application' in str(exc) or '80040154' in str(exc):
                print('デスクトップ版 Excel を起動できません。この環境では検証できません。', file=sys.stderr)
                return 2
            raise
        unexpected, expected, dims = compare(str(base) + '.native.json', str(base) + '.pasted.json', meta['notes'])
        own_unexpected, _, _ = compare(str(base) + '.native.json', str(base) + '.excelcopy.json', {})
        total_unexpected += len(unexpected)
        summary.append({'sheet': sheet['name'], 'range': info['range'], 'cells': cells, 'unexpected': unexpected, 'conflicts': meta.get('conflicts', []),
                        'expected': expected, 'excelOwnCopyDifferences': len(own_unexpected),
                        'excelOwnCopySample': own_unexpected[:15], 'dimensions': dims})

    report = out / 'report.md'
    lines = ['# Excel 貼り付け検証', '', f'Excel（デスクトップ版）で、元の表を直接作った状態と、この HTML からコピーして貼り付けた状態をセルごとに比べた。', '']
    for s in summary:
        lines += [f'## {s["sheet"]}（{s["range"]}、{s["cells"]} セル）', '',
                  f'- 想定外の差: {len(s["unexpected"])} 件',
                  f'- 仕様どおりの差: {len(s["expected"])} 件',
                  f'- 参考: Excel 自身のコピー（Excel の HTML を貼り付け）では {s["excelOwnCopyDifferences"]} 件の差が出る', '']
        if s['conflicts']:
            lines += ['隣り合うセルの同じ境界に、異なる罫線を指定している箇所がある。Excel はセルの辺ごとに線を1本しか持てず、どちらかに上書きされる。片方のセルにだけ書くか、同じ線にそろえる。', '']
            lines += [f'- {x["a"]} と {x["b"]}（{x["edge"]}）: {x["lines"][0]} / {x["lines"][1]}' for x in s['conflicts'][:50]] + ['']
        if s['unexpected']:
            lines += ['| セル | 項目 | Excel で作った表 | 貼り付け結果 | 原因 |', '|---|---|---|---|---|']
            lines += [f'| {d["cell"]} | {d["label"]} | {d["excel"]!r} | {d["pasted"]!r} | {d.get("cause", "")} |' for d in s['unexpected'][:200]]
            lines.append('')
        if s['expected']:
            reasons = sorted({d['reason'] for d in s['expected']})
            lines += ['仕様どおりの差の理由:', ''] + [f'- {r}' for r in reasons] + ['']
        lines += ['列幅と行の高さは、Excel 同士の Ctrl+V でも貼り付け先の値のまま（行は自動調整）なので比較から除いた。', '',
                  f'- 元の列幅（文字数）: {s["dimensions"]["columnsSource"]}', f'- 貼り付け後: {s["dimensions"]["columnsPasted"]}', '']
    report.write_text('\n'.join(lines), encoding='utf-8')
    (out / 'report.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    for s in summary:
        print(f'{s["sheet"]} {s["range"]}: 想定外の差 {len(s["unexpected"])} 件 / 仕様どおりの差 {len(s["expected"])} 件 / Excel 自身のコピーの差 {s["excelOwnCopyDifferences"]} 件')
        if s['conflicts']:
            print(f'  罫線の食い違い {len(s["conflicts"])} 箇所（隣り合うセルの境界に異なる線）: ' + ', '.join(f'{x["a"]}-{x["b"]}' for x in s['conflicts'][:10]))
    print(f'報告: {report}')
    return 1 if total_unexpected else 0


if __name__ == '__main__':
    sys.exit(main())
