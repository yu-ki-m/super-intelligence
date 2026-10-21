#!/usr/bin/env node
// FlowTS（.flow.ts）を検査し、フローを図にした HTML を書き出す。
//
//   node flow-view.mjs <file.flow.ts> [--title <名前>] [--out <file.html>] [--before <改善前.flow.ts>]
//                      [--typescript <TypeScript の場所>] [--no-tsc] [--no-html] [--json <結果.json>]
//
// エラーが1件でもあれば終了コード 1（HTML は書き出す）。注意だけなら 0。

import fs from 'node:fs';
import path from 'node:path';
import { parseFlow } from './lib/parse.mjs';
import { checkFlow } from './lib/check.mjs';
import { findTypeScript, typecheck } from './lib/typecheck.mjs';
import { renderHtml } from './lib/render.mjs';
import { diffModels } from './lib/diff.mjs';

const WHO = { model: 'AI', tool: 'ツール', human: '人', subflow: 'サブフロー', unknown: '不明' };

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = name => args.includes(name);
const valued = new Set(['--title', '--out', '--before', '--typescript', '--json']);
const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
if (!file || flag('--help')) {
  console.error('使い方: node flow-view.mjs <file.flow.ts> [--title <名前>] [--out <file.html>] [--before <改善前.flow.ts>] [--typescript <場所>] [--no-tsc] [--no-html] [--json <結果.json>]');
  process.exit(2);
}

const src = fs.readFileSync(file, 'utf8');
const model = parseFlow(src);
const findings = checkFlow(model);

let tc = { ran: false, reason: '--no-tsc の指定', errors: [] };
if (!flag('--no-tsc')) {
  const ts = findTypeScript(opt('--typescript'), [path.dirname(path.resolve(file)), process.cwd()]);
  tc = ts.tsc ? typecheck(model, ts.tsc) : { ran: false, reason: ts.reason, errors: [] };
}
for (const e of tc.errors) {
  const fn = model.functions.find(f => e.line >= f.line && e.line <= f.endLine);
  const seg = fn?.segments?.find(s => !s.transparent && e.line >= s.line && e.line <= s.endLine);
  findings.push({ severity: 'エラー', fn: fn?.name ?? '', step: seg?.title ?? '', line: e.line, message: `型検査：${e.message}（${e.code}）` });
}

let diff = null;
if (opt('--before')) diff = diffModels(parseFlow(fs.readFileSync(opt('--before'), 'utf8')), model);

const base = path.basename(file).replace(/\.flow\.ts$|\.ts$/, '');
const title = opt('--title') ?? base;
const out = opt('--out') ?? path.join(path.dirname(file), `${base}.flow.html`);
if (!flag('--no-html')) fs.writeFileSync(out, renderHtml({ model, findings, title, typecheck: tc, diff }));

// 結果の要約
const flows = model.functions.filter(f => f.isFlow);
const helpers = model.functions.filter(f => !f.isFlow && model.helperWorks[f.name]);
const steps = flows.reduce((n, f) => n + f.segments.filter(s => !s.transparent).length, 0);
const work = {};
for (const f of flows) for (const s of f.segments) for (const it of s.items) {
  const who = it.kind === 'subflow' ? 'subflow' : it.kind === 'helper' ? (model.helperWorks[it.helper]?.[0]?.who ?? 'unknown') : it.who;
  work[who] = (work[who] ?? 0) + 1;
}
const errors = findings.filter(x => x.severity === 'エラー');
const warns = findings.filter(x => x.severity === '注意');
const lines = [
  `Flow file      : ${file}`,
  `Functions      : フロー関数 ${flows.length}（${flows.map(f => f.name).join('、') || 'なし'}）、実施を含む補助関数 ${helpers.length}`,
  `Steps          : ${steps}`,
  `Work           : ${Object.entries(work).map(([k, v]) => `${WHO[k] ?? k} ${v}`).join(' / ') || 'なし'}`,
  `Type check     : ${tc.ran ? `済み（エラー ${tc.errors.length}）` : `していない。${tc.reason}`}`,
  `Findings       : エラー ${errors.length} / 注意 ${warns.length}`,
  ...[...errors, ...warns].map(x => `  ${x.severity} ${[x.fn, x.step].filter(Boolean).join(' > ') || '（ファイル全体）'}${x.line ? `（${x.line} 行）` : ''}: ${x.message}`),
];
if (diff) {
  const c = k => diff.rows.filter(r => r.kind === k).length;
  lines.push(`Diff           : 追加 ${c('追加')} / 変更 ${c('変更')} / 削除 ${c('削除')}`);
  for (const r of diff.rows) lines.push(`  ${r.kind} ${[r.fn, r.step].filter(Boolean).join(' > ')}: ${r.text.replace(/\n/g, ' ／ ')}`);
}
if (!flag('--no-html')) lines.push(`HTML           : ${out}`);
console.log(lines.join('\n'));
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ findings, typecheck: tc, diff: diff?.rows ?? null, steps, work }, null, 2));
process.exitCode = errors.length ? 1 : 0;
