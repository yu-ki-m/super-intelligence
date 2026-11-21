#!/usr/bin/env node
// スキルのフォルダの書式を検査する。テストの前に、書式の誤り（参照先の無いファイル、長すぎる SKILL.md など）を取り除くため。
//
//   node check-skill.mjs <スキルのフォルダ> [--name <期待する name>]
//
// 検査すること：
//   エラー：SKILL.md が無い／frontmatter に name か description が無い／name がフォルダ名（または --name）と違う／
//           SKILL.md から参照する references・scripts・assets・agents のファイルが無い
//   注意  ：SKILL.md が500行以上／300行を超える references に目次が無い／description が短い（200文字未満）
//
// 結果は JSON で標準出力に出す。エラーが1件でもあれば終了コード 1、引数の誤りは 2。

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--name');
if (!dir) {
  console.error('使い方: node check-skill.mjs <スキルのフォルダ> [--name <期待する name>]');
  process.exit(2);
}

const root = path.resolve(dir);
const errors = [];
const warnings = [];
const skillMd = path.join(root, 'SKILL.md');

if (!fs.existsSync(skillMd)) {
  errors.push('SKILL.md が無い');
} else {
  const text = fs.readFileSync(skillMd, 'utf8');
  const lines = text.split(/\r?\n/);

  // frontmatter
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) {
    errors.push('frontmatter（先頭の --- で囲んだ部分）が無い');
  } else {
    const name = fm[1].match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
    const desc = fm[1].match(/^description:\s*([\s\S]*?)(?=^\w[\w-]*:|$(?![\s\S]))/m)?.[1].trim() ?? '';
    const expected = opt('--name') ?? path.basename(root);
    if (!name) errors.push('frontmatter に name が無い');
    else if (name !== expected) errors.push(`name「${name}」がフォルダ名「${expected}」と違う`);
    if (!desc) errors.push('frontmatter に description が無い');
    else if (desc.length < 200) warnings.push(`description が短い（${desc.length} 文字）。何をするかと、いつ使うか（言い方）を書く`);
  }

  if (lines.length >= 500) warnings.push(`SKILL.md が ${lines.length} 行ある。500行未満を目安にし、長い決まりや例は references に分ける`);

  // 参照するファイル：バッククォートやリンクの中の references/… scripts/… assets/… agents/…
  const body = fm ? text.slice(fm[0].length) : text;
  const refs = new Set();
  const re = /(?:`|\]\(|\()((?:\.\/)?(?:references|scripts|assets|agents)\/[^\s`)<>*?]+?)(?=[`)\s#]|$)/g;
  for (const m of body.matchAll(re)) refs.add(m[1].replace(/^\.\//, '').replace(/[、。,.:：]+$/, ''));
  for (const r of refs) {
    if (r.includes('<') || r.includes('{')) continue;   // <名前> などの書き方の例は外す
    if (!fs.existsSync(path.join(root, r))) errors.push(`SKILL.md が参照する ${r} が無い`);
  }

  // 長い references の目次
  const refDir = path.join(root, 'references');
  if (fs.existsSync(refDir)) {
    for (const f of fs.readdirSync(refDir).filter(f => f.endsWith('.md'))) {
      const t = fs.readFileSync(path.join(refDir, f), 'utf8');
      const n = t.split(/\r?\n/).length;
      if (n > 300 && !/^#+\s*(目次|Contents|Table of contents)/im.test(t)) warnings.push(`references/${f} が ${n} 行あり、目次が無い`);
    }
  }
}

console.log(JSON.stringify({ フォルダ: root, エラー: errors, 注意: warnings }, null, 2));
process.exitCode = errors.length > 0 ? 1 : 0;
