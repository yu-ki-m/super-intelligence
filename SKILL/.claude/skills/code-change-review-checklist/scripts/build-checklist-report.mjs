#!/usr/bin/env node
// code-change-flow-report が生成したHTMLに、テーブルごとの「確認済みチェックボックス」と
// 「重要度(0〜10)」、優先度順の確認リストを重ねた別のHTMLを書き出す。元のHTMLは変更しない。
//
//   node build-checklist-report.mjs <review-data.json> <risk-scores.json> <base-report.html> <output.html>

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadJson, unitKey, location } from "./units.mjs";
import { validateRiskScores, bandOf } from "./risk-scores.mjs";
import { MARKERS, escapeHtml, wrap, buildBar, buildPanel, styleText, scriptText } from "./checklist-render.mjs";

const SUPPORTED_TEMPLATE_VERSIONS = ["2026.09.13.3"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

function stripInjected(html) {
  let result = html;
  for (const [start, end] of Object.values(MARKERS)) {
    const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "g");
    result = result.replace(pattern, "");
  }
  return result;
}

function main() {
  const [dataPath, scoresPath, basePath, outputPath] = process.argv.slice(2);
  if (!outputPath) {
    console.error("Usage: build-checklist-report.mjs <review-data.json> <risk-scores.json> <base-report.html> <output.html>");
    process.exit(1);
  }
  if (path.resolve(basePath) === path.resolve(outputPath)) {
    console.error("出力先が元のHTMLと同じ。元のHTMLは変更しないため、別のファイル名にする");
    process.exit(1);
  }

  const reviewData = loadJson(dataPath);
  const scores = loadJson(scoresPath);
  const { errors, units, scoreByKey } = validateRiskScores(reviewData, scores);
  if (errors.length > 0) {
    console.error(`Risk score validation failed (${errors.length} 件):`);
    errors.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }

  const base = readFileSync(basePath, "utf8");
  const version = base.match(/<meta name="code-change-flow-template-version" content="([^"]+)">/)?.[1];
  if (!SUPPORTED_TEMPLATE_VERSIONS.includes(version)) {
    console.error(`元のHTMLのテンプレート版(${version ?? "不明"})は対応していない。対応: ${SUPPORTED_TEMPLATE_VERSIONS.join(", ")}`);
    process.exit(1);
  }
  if (base.includes("<!--rc:")) {
    console.error("元のHTMLに既にチェックリストが含まれている。code-change-flow-report が生成した元のHTMLを指定する");
    process.exit(1);
  }

  const entryOf = (unit) => scoreByKey.get(unitKey(unit));
  const unitByKey = new Map(units.map((unit) => [unitKey(unit), unit]));

  // 各テーブルの review-unit 直後へバーを差し込む(commit-panel と flow-item の並びから対応付ける)
  let currentCommit = -1;
  let currentFlow = -1;
  const inserted = new Set();
  const pattern = /<section class="commit-panel" id="commit-panel-(\d+)"|<div class="flow-item" data-flow-index="(\d+)">|<div class="review-unit">/g;
  const unitByPosition = new Map(units.map((unit) => [`${unit.commitIndex}:${unit.flowIndex}`, unit]));
  let barError = null;
  const withBars = base.replace(pattern, (match, commitIndex, flowIndex) => {
    if (commitIndex !== undefined) { currentCommit = Number(commitIndex); currentFlow = -1; return match; }
    if (flowIndex !== undefined) { currentFlow = Number(flowIndex); return match; }
    const unit = unitByPosition.get(`${currentCommit}:${currentFlow}`);
    if (unit === undefined) { barError ??= `HTMLの commit ${currentCommit} / flow ${currentFlow} に対応するテーブルが review-data.json にない`; return match; }
    inserted.add(unitKey(unit));
    return match + buildBar(unitKey(unit), entryOf(unit));
  });
  if (barError) { console.error(barError); process.exit(1); }
  if (inserted.size !== units.length) {
    console.error(`HTML上のテーブル数(${inserted.size})が review-data.json のテーブル数(${units.length})と一致しない`);
    process.exit(1);
  }

  const sorted = units
    .map((unit) => ({ unit, entry: entryOf(unit) }))
    .sort((left, right) => right.entry.score - left.entry.score || left.unit.commitIndex - right.unit.commitIndex || left.unit.flowIndex - right.unit.flowIndex);
  const totals = { critical: 0, high: 0, mid: 0, low: 0 };
  sorted.forEach(({ entry }) => { totals[bandOf(entry.score).id] += 1; });

  const reportId = createHash("sha256").update(base).update(JSON.stringify(scores)).digest("hex").slice(0, 12);
  const payload = {
    reportId,
    units: sorted.map(({ unit, entry }) => ({ k: unitKey(unit), c: unit.commitIndex, f: unit.flowIndex, s: entry.score, b: bandOf(entry.score).id }))
  };
  const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

  const replaceOnce = (html, search, replacement, label) => {
    const first = html.indexOf(search);
    if (first < 0 || html.indexOf(search, first + 1) >= 0) {
      console.error(`元のHTMLに ${label} が1つだけ存在する必要がある`);
      process.exit(1);
    }
    return html.slice(0, first) + replacement + html.slice(first + search.length);
  };

  let output = withBars;
  output = replaceOnce(output, "</head>", `${wrap("style", `<style id="rc-style">${styleText()}</style>`)}</head>`, "</head>");
  output = replaceOnce(output, '<nav class="commit-tabs"', `${buildPanel(sorted.map(({ unit, entry }) => ({ key: unitKey(unit), entry, location: location(unit), commitHash: unit.commitHash })))}<nav class="commit-tabs"`, '<nav class="commit-tabs"');
  output = replaceOnce(output, "</body>", `${wrap("script", `<script type="application/json" id="rc-data">${payloadJson}</script><script>${scriptText()}</script>`)}</body>`, "</body>");

  // 検証: 差し込んだ部分を除くと元のHTMLと完全に一致する
  if (stripInjected(output) !== base) {
    console.error("検証に失敗: 差し込み部分を除いた結果が元のHTMLと一致しない");
    process.exit(1);
  }
  const barCount = (output.match(/<!--rc:bar-start-->/g) ?? []).length;
  if (barCount !== units.length) {
    console.error(`検証に失敗: バーの数(${barCount})がテーブル数(${units.length})と一致しない`);
    process.exit(1);
  }
  for (const unit of units) {
    const score = entryOf(unit).score;
    if (!output.includes(`data-rc-key="${escapeHtml(unitKey(unit))}" data-rc-score="${score}"`)) {
      console.error(`検証に失敗: ${unit.stepId} の点数がHTMLに反映されていない`);
      process.exit(1);
    }
  }

  const temporary = `${outputPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, output, "utf8");
    renameSync(temporary, outputPath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }

  const top = sorted[0];
  console.log(`Checklist report built: ${path.resolve(outputPath)}`);
  console.log(`Checklist verification passed: ${units.length} tables, original HTML unchanged, scores reflected`);
  console.log(`Bands: 最優先 ${totals.critical} / 高 ${totals.high} / 中 ${totals.mid} / 低 ${totals.low}`);
  console.log(`Highest risk: ${top.entry.score} ${unitByKey.get(unitKey(top.unit)).stepId} (${location(top.unit)})`);
}

main();
