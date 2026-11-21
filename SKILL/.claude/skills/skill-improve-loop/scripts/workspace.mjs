#!/usr/bin/env node
// skill-creator の workspace（<設計フォルダ>/workspace/）を読み、決まった数え方で結果を返す。
// AI に数えさせると、実行回数やトークン数、どこまで終わったかを作ってしまうことがあるため、スクリプトで数える。
//
//   node workspace.mjs budget   <workspace>      … runs.jsonl から、使った実行回数とトークン数を数える
//   node workspace.mjs state    <iteration-N>    … 1巡がどこまで終わったか（最初から・採点・ビューアー・まとめ）
//   node workspace.mjs variance <ディレクトリ>    … run-1・run-2… の grading.json で、合否が変わった採点項目を挙げる
//   node workspace.mjs paths    <ディレクトリ> [--limit 240] … 絶対パスが limit 文字を超えるファイルを数える（Windows の 260 文字の上限に備える）
//
// workspace は案ごとに分ける：<workspace>/<案ID>/iteration-N/<ケース>/<構成>/[run-K/]（構成の下は skill-creator の形）。
// 結果は JSON で標準出力に出す。引数の誤りは終了コード 2。
//
// runs.jsonl は、テストの実行が終わって通知が届くたびに、1行ずつ足す記録である（workspace の直下）。
//   {"case_id":"C-01","iteration":1,"case":"flags-negative-quantity","config":"with_skill","run":1,"status":"完了","total_tokens":84852,"duration_ms":23332,"reused":false}
//   status は 完了・失敗・時間切れ。reused は、新規スキルの基準を iteration-1 から写して使い回した行で true にする（予算に数えない）。

import fs from 'node:fs';
import path from 'node:path';

const [cmd, target, ...rest] = process.argv.slice(2);
const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

function fail(message) {
  console.error(message);
  console.error('使い方: node workspace.mjs budget <workspace> | state <iteration-N> | variance <ディレクトリ> | paths <ディレクトリ> [--limit 240]');
  process.exit(2);
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function dirs(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(p, d.name)); } catch { return []; }
}

// 構成のフォルダの中の実行のフォルダ。run-1/ などがあればそれら、無ければ構成のフォルダそのもの（skill-creator の決まり）
function runDirs(configDir) {
  const runs = dirs(configDir).filter(d => /^run-\d+$/.test(path.basename(d)));
  return runs.length > 0 ? runs.sort((a, b) => Number(path.basename(a).slice(4)) - Number(path.basename(b).slice(4))) : [configDir];
}

// テストケースのフォルダ：中に、outputs/ か grading.json か timing.json を持つ構成のフォルダがあるもの
function caseDirs(iterationDir) {
  return dirs(iterationDir).filter(c => dirs(c).some(cfg => runDirs(cfg).some(r =>
    fs.existsSync(path.join(r, 'outputs')) || fs.existsSync(path.join(r, 'grading.json')) || fs.existsSync(path.join(r, 'timing.json')))));
}

function budget(workspace) {
  const ledger = path.join(workspace, 'runs.jsonl');
  if (!fs.existsSync(ledger)) return { 実行回数: 0, トークン数: 0, 失敗: 0, 時間切れ: 0, 使い回し: 0, 読めない行: 0, 記録: '無し' };
  const result = { 実行回数: 0, トークン数: 0, 失敗: 0, 時間切れ: 0, 使い回し: 0, 読めない行: 0, 記録: ledger };
  for (const line of fs.readFileSync(ledger, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { result.読めない行++; continue; }
    if (r.reused) { result.使い回し++; continue; }
    // 失敗・時間切れの実行も費用はかかっているので、予算には数える
    result.実行回数++;
    result.トークン数 += Number(r.total_tokens) || 0;
    if (r.status === '失敗') result.失敗++;
    if (r.status === '時間切れ') result.時間切れ++;
  }
  return result;
}

function state(iterationDir) {
  if (!fs.existsSync(iterationDir)) return { 段: '最初から', 理由: 'iteration のフォルダが無い', ケース: [] };
  const cases = caseDirs(iterationDir).map(c => {
    const runs = dirs(c).flatMap(cfg => runDirs(cfg).map(r => ({
      構成: path.basename(cfg),
      実行: path.relative(c, r) || '.',
      出力: fs.existsSync(path.join(r, 'outputs')),
      時間: fs.existsSync(path.join(r, 'timing.json')),
      採点: fs.existsSync(path.join(r, 'grading.json')),
    })));
    return { ケース: path.basename(c), 問い: fs.existsSync(path.join(c, 'eval_metadata.json')), 実行: runs };
  });
  const all = cases.flatMap(c => c.実行);
  const feedback = fs.existsSync(path.join(iterationDir, 'feedback.json'));
  const bench = fs.existsSync(path.join(iterationDir, 'benchmark.json'));
  let 段 = '最初から';
  let 理由 = 'テストの出力が無い';
  if (all.length > 0 && all.every(r => r.出力)) {
    段 = '採点'; 理由 = '実行は終わっているが、採点か集計が終わっていない';
    if (all.every(r => r.採点) && bench) {
      段 = 'ビューアー'; 理由 = '採点と集計は終わっているが、feedback.json が無い';
      if (feedback) { 段 = 'まとめ'; 理由 = 'feedback.json がある'; }
    }
  } else if (all.length > 0) {
    理由 = '出力の無い実行がある（実行の途中で止まった）';
  }
  return { 段, 理由, フィードバック: feedback, ベンチマーク: bench, ケース: cases };
}

function variance(dir) {
  const unstable = [];
  for (const c of caseDirs(dir)) {
    for (const cfg of dirs(c)) {
      const runs = runDirs(cfg).map(r => ({ 実行: path.basename(r), 採点: readJson(path.join(r, 'grading.json')) })).filter(r => r.採点);
      if (runs.length < 2) continue;
      const byText = new Map();
      for (const r of runs) {
        for (const e of r.採点.expectations ?? []) {
          if (!byText.has(e.text)) byText.set(e.text, []);
          byText.get(e.text).push({ 実行: r.実行, 合格: e.passed === true });
        }
      }
      for (const [text, results] of byText) {
        if (new Set(results.map(x => x.合格)).size > 1) {
          unstable.push({ ケース: path.basename(c), 構成: path.basename(cfg), 採点項目: text, 結果: results });
        }
      }
    }
  }
  return { 合否が変わった項目: unstable.length, 一覧: unstable };
}

// 絶対パスが長すぎるファイルを数える。Windows では 260 文字を超えると、多くのプログラム（Python の既定の開き方を含む）がファイルを開けない
function paths(dir, limit) {
  let longest = 0;
  let count = 0;
  const over = [];
  const walk = d => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      count++;
      if (p.length > longest) longest = p.length;
      if (p.length > limit) over.push({ 長さ: p.length, パス: p });
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  over.sort((a, b) => b.長さ - a.長さ);
  return { 上限: limit, 調べた数: count, 最長: longest, 超えた数: over.length, 長い順: over.slice(0, 10) };
}

if (!cmd || !target) fail('引数が足りない');
const abs = path.resolve(target);
let out;
if (cmd === 'budget') out = budget(abs);
else if (cmd === 'state') out = state(abs);
else if (cmd === 'variance') out = variance(abs);
else if (cmd === 'paths') {
  const limit = Number(opt('--limit') ?? 240);
  if (!Number.isFinite(limit) || limit <= 0) fail('--limit は正の数にする');
  out = paths(abs, limit);
}
else fail(`知らないコマンド：${cmd}`);
console.log(JSON.stringify(out, null, 2));
