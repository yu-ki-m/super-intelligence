// FlowTS を TypeScript の型検査にかける（仕様 11 章のコンパイル規則に沿った変換）。
// ラベル付きブロックを持つ関数の本体を、ラベルごとの case を並べた switch を回すループにし、
// goto を `continue __flow;` にする。case は上から順に流れ落ちるので、ブロックの末尾から次の文へ進む意味を保つ。
// 引数付きの goto は、引数を隠れた変数（ラベルの引数と同じ型）に代入する関数を呼んでから移り、
// ラベルの側でその変数から引数を受け取る。これで渡す値の型も、引数の式の位置で検査される。
// 行は増やさないので、エラーの行番号は元の flow.ts の行と同じになる。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const PRELUDE = 'declare function 実施<T>(指示: string, 入力?: Record<string, unknown>, 設定?: { 担当?: "model" | "tool" | "human"; 能力?: string }): Promise<T>; declare function __step(): string; ';

export function findTypeScript(explicit, dirs) {
  if (explicit) {
    const p = path.resolve(explicit);
    const candidates = /\.(c?js|mjs)$/.test(p) || path.basename(p) === 'tsc'
      ? [p]
      : [path.join(p, 'bin', 'tsc'), path.join(p, 'node_modules', 'typescript', 'bin', 'tsc')];
    const found = candidates.find(c => fs.existsSync(c));
    return found ? { tsc: found } : { reason: `指定された場所に TypeScript が無い（${explicit}）` };
  }
  const candidates = [];
  for (const d of dirs) {
    try {
      const pkg = createRequire(path.join(path.resolve(d), 'noop.js')).resolve('typescript/package.json');
      candidates.push(path.join(path.dirname(pkg), 'bin', 'tsc'));
    } catch { /* 見つからなければ次へ */ }
  }
  const npm = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true });
  if (npm.status === 0 && npm.stdout.trim()) candidates.push(path.join(npm.stdout.trim(), 'typescript', 'bin', 'tsc'));
  const found = candidates.find(c => fs.existsSync(c));
  return found ? { tsc: found } : { reason: 'TypeScript が見つからない（--typescript で場所を指定できる。インストールは利用者の了承を得てから）' };
}

export function toCheckableTs(model) {
  const src = model.src;
  const edits = [];
  for (const f of model.functions) {
    if (!f.isFlow) continue;
    const labels = f.segments.filter(s => s.kind === 'label');
    if (!labels.length) continue;
    // 最初の goto を含む文より前は、goto より先に一度だけ実行されるので、ループの外に置く。
    // こうすると、goto より前の宣言は済んでいるものとして型検査され、goto が飛び越えた宣言だけが未初期化として出る
    const start = f.segments.find(s => s.kind === 'start');
    const firstJump = start ? Math.min(...start.gotos.map(g => g.topIndex).filter(i => i !== undefined)) : Infinity;
    if (Number.isFinite(firstJump)) edits.push({ start: f.topStarts[firstJump], end: f.topStarts[firstJump], text: '__flow: for (;;) switch (__step()) { case "__start": ' });
    else edits.push({ start: labels[0].labelStart, end: labels[0].labelStart, text: '__flow: for (;;) switch (__step()) { ' });
    // 引数を受け渡す隠れた変数と、そこへ代入する関数（関数本体の先頭で宣言する）。
    // goto の引数を関数の引数として渡すので、型の誤りは引数の式の位置に出る
    const hidden = new Map();
    const setter = new Map();
    labels.filter(s => s.params.length).forEach((s, li) => {
      hidden.set(s.name, s.params.map((p, k) => ({ v: `__a${li}_${k}`, p })));
      setter.set(s.name, `__go${li}`);
    });
    const decls = [...hidden].map(([name, vars]) => {
      const lets = vars.map(({ v, p }) => `let ${v}!: ${p.ok ? p.type : 'any'};`).join(' ');
      const sig = vars.map(({ p }, k) => `p${k}: ${p.ok ? p.type : 'any'}`).join(', ');
      const body = vars.map(({ v }, k) => `${v} = p${k};`).join(' ');
      return `${lets} const ${setter.get(name)} = (${sig}): void => { ${body} };`;
    }).join(' ');
    if (decls) edits.push({ start: f.bOpenEnd, end: f.bOpenEnd, text: ` ${decls} ` });
    for (const s of labels) {
      const recv = (hidden.get(s.name) ?? []).filter(({ p }) => p.ok).map(({ v, p }) => `const ${p.name}: ${p.type} = ${v};`).join(' ');
      edits.push({ start: s.labelStart, end: s.labelEnd, text: `case ${JSON.stringify(s.name)}: {${recv ? ` ${recv}` : ''}` });
    }
    edits.push({ start: f.bCloseStart, end: f.bCloseStart, text: ' break __flow; } ' });
    for (const s of f.segments) {
      for (const g of s.gotos) {
        const vars = hidden.get(g.target);
        if (g.args.length && vars && vars.length === g.args.length) {
          // goto 名前(a, b); → { __go0(a, b); continue __flow; }（引数・空白・改行はそのまま残す）
          edits.push({ start: g.start, end: g.argsOpenEnd, text: `{ ${setter.get(g.target)}(` });
          edits.push({ start: g.argsCloseStart, end: g.end, text: '); continue __flow; }' });
        } else {
          edits.push({ start: g.start, end: g.end, text: 'continue __flow;' });
        }
      }
      for (const g of s.nestedGotos) edits.push({ start: g.start, end: g.end, text: 'continue __flow;' });
    }
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return PRELUDE + out;
}

export function typecheck(model, tsc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowts-check-'));
  const file = path.join(dir, 'flow-check.ts');
  try {
    fs.writeFileSync(file, toCheckableTs(model));
    const r = spawnSync(process.execPath, [tsc, '--noEmit', '--strict', '--target', 'es2022', '--lib', 'es2022', '--locale', 'ja', '--pretty', 'false', file], { encoding: 'utf8' });
    if (r.error) return { ran: false, reason: `TypeScript を実行できなかった（${r.error.message}）`, errors: [] };
    const errors = [];
    for (const line of `${r.stdout}\n${r.stderr}`.split(/\r?\n/)) {
      const m = line.match(/\((\d+),(\d+)\): error (TS\d+): (.*)$/);
      if (m) errors.push({ line: Number(m[1]), code: m[3], message: m[4] });
      else if (errors.length && /^\s+\S/.test(line)) errors[errors.length - 1].message += ` ${line.trim()}`;
    }
    if (r.status !== 0 && !errors.length) return { ran: false, reason: `TypeScript が失敗した（${(r.stderr || r.stdout).trim().slice(0, 200)}）`, errors: [] };
    return { ran: true, errors };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
