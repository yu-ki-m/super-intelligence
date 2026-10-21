#!/usr/bin/env node
// assets/templates/ のテンプレートと、見本(assets/example/)、パターンカタログ(assets/template-catalog.html)の整合を検査する。
// テンプレートやスクリプトを変更した時、および毎回のビルド前に実行する。
//
//   node verify-templates.mjs                 検査する(カタログが古ければ失敗)
//   node verify-templates.mjs --write-catalog カタログを再生成して書き出し、検査する

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, unitKey, location } from "./units.mjs";
import { validateRiskScores, bandOf, CATEGORIES } from "./risk-scores.mjs";
import {
  PLACEHOLDERS, TEMPLATE_DIR, escapeHtml, loadTemplate, render, buildBar, buildPanel, styleText, scriptText
} from "./checklist-render.mjs";

const SKILL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_DATA = path.join(SKILL_ROOT, "assets", "example", "review-data.example.json");
const EXAMPLE_SCORES = path.join(SKILL_ROOT, "assets", "example", "risk-scores.example.json");
const CATALOG_PATH = path.join(SKILL_ROOT, "assets", "template-catalog.html");

// 全体構造の見本: フロー・解説・変更前後の比較を含むレポート(固定のスナップショット)と、その採点、チェックリストを重ねた完成形。
// このスキルの中だけで完結し、他のスキルやリポジトリのファイルは読まない。
const FIXTURE_DIR = path.join(SKILL_ROOT, "assets", "example", "full-report");
const FIXTURE_DATA = path.join(FIXTURE_DIR, "review-data.json");
const FIXTURE_SCORES = path.join(FIXTURE_DIR, "risk-scores.json");
const FIXTURE_BASE = path.join(FIXTURE_DIR, "report.html");
const FIXTURE_SAMPLE = path.join(FIXTURE_DIR, "report.checklist.html");
const BUILD_SCRIPT = path.join(SKILL_ROOT, "scripts", "build-checklist-report.mjs");

// チェックリストを重ねても、元のレポートから1つも失われてはならない構造。いずれも見本に1件以上含まれている必要がある。
const REPORT_STRUCTURE = {
  "コミットの切り替えと概要": ["commit-tab", "commit-panel", "commit-summary", "commit-overview-body"],
  "フローの見出し(流れ・独立)": ["root-section-heading--flow", "root-section-heading--standalone", "root-section-title", "root-section-description"],
  "フローの入れ子・接続線": ["flow-item", "flow-row", "row-connectors", "connector-track", "connector-track--entry", "entry-stem", "entry-branch", "flow-connector", "flow-connector--disconnected", "nest-toggle", "nest-toggle-placeholder"],
  "テーブルの見出し(ファイル位置)": ["review-unit", "source-header", "source-location"],
  "説明(概説・変更理由・処理仕様・備考)": ["comparison", "details", "detail", "detail-title", "detail-body", "specification-body", "specification-summary", "specification-steps", "specification-step", "specification-example", "remarks", "remarks-body"],
  "変更前後の比較(差分色)": ["column", "column-title", "editor", "diff-line", "diff-line--added", "diff-line--removed"]
};

// 元レポート(テンプレート版 2026.09.13.3)の :root。カタログを単体で開いても同じ見た目にするために写している。
const BASE_ROOT = ":root{color-scheme:light;--canvas:#f3f5f8;--paper:#fff;--paper-soft:#f8fafc;--code-surface:#fbfcfe;--header-bg:#eef2f6;--line:#c8d0da;--line-strong:#96a1af;--ink:#1d2735;--muted:#5f6b7a;--accent:#2563eb;--accent-soft:#edf4ff;--diff-remove:#ffebe9;--diff-add:#dafbe1;--shadow:0 2px 5px rgba(15,23,42,.12),0 12px 28px rgba(15,23,42,.09)}";
const SOURCE_HEADER_STUB = "<div class=\"source-header\" style=\"display:flex;align-items:center;height:30px;padding:0 8px;border:1px solid var(--line);border-bottom:0;background:var(--paper-soft);font-size:13px\"><code>src/main/java/example/Sample.java:10-12</code></div><pre style=\"margin:0;padding:8px 12px;border:1px solid var(--line);background:var(--code-surface);font-size:12px\">// 実際のレポートでは、ここに解説・変更前後の比較・入れ子の流れが入る(完成形は example/full-report/report.checklist.html)</pre>";

const errors = [];
const fail = (message) => errors.push(message);

function placeholdersOf(name) {
  const text = readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
  const found = new Set();
  for (const match of text.matchAll(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g)) found.add(match[1] ? `{${match[1]}}` : match[2]);
  return [...found];
}

function checkPlaceholders() {
  for (const [name, expected] of Object.entries(PLACEHOLDERS)) {
    const actual = placeholdersOf(name).sort();
    const want = [...expected].sort();
    if (JSON.stringify(actual) !== JSON.stringify(want)) {
      fail(`${name}: プレースホルダーが期待と違う(テンプレート: ${actual.join(", ")} / checklist-render.mjs の PLACEHOLDERS: ${want.join(", ")})`);
    }
  }
  for (const name of ["style.css", "script.js"]) {
    if (/\{\{/.test(loadTemplate(name)) && name === "style.css") fail("style.css に {{ がある。CSSにプレースホルダーは使えない");
  }
}

function loadExample() {
  const reviewData = loadJson(EXAMPLE_DATA);
  const scores = loadJson(EXAMPLE_SCORES);
  const { errors: scoreErrors, units, scoreByKey } = validateRiskScores(reviewData, scores);
  scoreErrors.forEach((message) => fail(`見本の採点: ${message}`));
  return { units, scoreByKey };
}

function checkCoverage(units, scoreByKey) {
  const scoresSeen = new Set();
  const categoriesSeen = new Set();
  let pointsMin = Infinity;
  let pointsMax = -Infinity;
  let tagged = new Set();
  for (const unit of units) {
    const entry = scoreByKey.get(unitKey(unit));
    if (!entry) continue;
    scoresSeen.add(entry.score);
    categoriesSeen.add(entry.category);
    pointsMin = Math.min(pointsMin, entry.checkPoints.length);
    pointsMax = Math.max(pointsMax, entry.checkPoints.length);
    unit.findings.forEach((tag) => tagged.add(tag));
  }
  for (let score = 0; score <= 10; score += 1) if (!scoresSeen.has(score)) fail(`見本に ${score} 点のテーブルがない`);
  CATEGORIES.forEach((category) => { if (!categoriesSeen.has(category)) fail(`見本に category「${category}」がない`); });
  if (pointsMin !== 0 || pointsMax !== 3) fail(`見本の checkPoints は 0件〜3件を含める(実際: ${pointsMin}〜${pointsMax})`);
  ["バグ", "懸念点", "考慮漏れ"].forEach((tag) => { if (!tagged.has(tag)) fail(`見本に備考の指摘 [${tag}] がない`); });
  if (!units.some((unit) => !unit.changed && unit.findings.length > 0)) fail("見本に「変更なしで指摘あり」のテーブルがない");
  if (new Set(units.map((unit) => unit.commitHash)).size < 2) fail("見本は2コミット以上にする");
}

function checkRendering() {
  const hostile = { score: 4, category: "表示・整形", reason: "<script>alert(\"x\")</script> & <b>太字</b>", checkPoints: ["<img src=x onerror=1>"] };
  const bar = buildBar("0:evil\"key", hostile);
  if (/<script|<img/.test(bar) || !bar.includes("&lt;b&gt;") || !bar.includes("&amp;") || !bar.includes("evil&quot;key")) fail("HTMLの特殊文字がエスケープされていない(bar)");
  if (bar.includes("{{")) fail("バーに未展開のプレースホルダーが残っている");
  const withoutPoints = buildBar("0:none", { score: 1, category: "表示・整形", reason: "点数が低く確認点がない例。", checkPoints: [] });
  if (withoutPoints.includes("rc-points")) fail("checkPoints が空なのに確認点の欄が出ている");
  try {
    render("bar.html", {});
    fail("値が足りないのにエラーにならない");
  } catch { /* 期待どおり */ }
}

function renderCatalog(units, scoreByKey) {
  const rows = units
    .map((unit) => ({ unit, entry: scoreByKey.get(unitKey(unit)) }))
    .sort((a, b) => b.entry.score - a.entry.score || a.unit.commitIndex - b.unit.commitIndex || a.unit.flowIndex - b.unit.flowIndex);
  const panel = buildPanel(rows.map(({ unit, entry }) => ({ key: unitKey(unit), entry, location: location(unit), commitHash: unit.commitHash })));

  const figure = ({ unit, entry }, note = "", transform = (html) => html) => {
    const kind = unit.changed ? "変更あり" : "変更なし";
    const tags = unit.findings.length ? ` / 備考 ${unit.findings.map((tag) => `[${tag}]`).join("")}` : "";
    const callers = unit.callerCount ? ` / 呼び出し元 ${unit.callerCount}` : "";
    return `<figure class="cat-figure"><figcaption><code>${escapeHtml(unit.stepId)}</code> — ${kind}${tags}${callers}${note}</figcaption><div class="review-unit">${transform(buildBar(unitKey(unit), entry))}${SOURCE_HEADER_STUB}</div></figure>`;
  };

  const bandOrder = ["critical", "high", "mid", "low"];
  const bandTitle = { critical: "最優先(9〜10点)", high: "高(6〜8点)", mid: "中(3〜5点)", low: "低(0〜2点)" };
  const sections = bandOrder.map((id) => {
    const inBand = rows.filter(({ entry }) => bandOf(entry.score).id === id);
    return `<h3>${bandTitle[id]} — ${inBand.length}件</h3>${inBand.map((row) => figure(row)).join("")}`;
  }).join("");

  const sample = rows.find(({ entry }) => entry.checkPoints.length >= 2) ?? rows[0];
  const checked = figure(sample, " / 確認済みにした状態", (html) => html
    .replace('class="rc-bar"', 'class="rc-bar is-checked"')
    .replace('class="rc-checkbox"', 'class="rc-checkbox" checked'));
  const hostile = { unit: { ...sample.unit, stepId: "escape-sample", changed: true, findings: [], callerCount: 0 }, entry: { score: 4, category: "表示・整形", reason: "特殊文字 <script>alert(\"x\")</script> & <b>太字</b> は文字として表示される。", checkPoints: ["<img src=x onerror=1> も文字として表示される"] } };

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>チェックリスト部品カタログ</title>
<meta name="code-change-review-checklist-catalog" content="generated by scripts/verify-templates.mjs --write-catalog">
<style>
${BASE_ROOT}
body{margin:0;padding:20px;background:var(--canvas);color:var(--ink);font:14px/1.6 system-ui,"Hiragino Sans","Yu Gothic",sans-serif}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:17px;margin:32px 0 6px}
h3{font-size:14px;margin:18px 0 6px;color:var(--muted)}
.cat-lead{margin:0 0 8px;color:var(--muted);max-width:980px}
.cat-figure{margin:0 0 12px;max-width:1240px}
.cat-figure figcaption{margin:0 0 4px;font-size:12px;color:var(--muted)}
.review-unit{max-width:1240px}
${styleText()}</style>
</head>
<body>
<h1>チェックリスト部品カタログ</h1>
<p class="cat-lead">code-change-review-checklist が元のレポートへ差し込む部品を、全パターン並べた見本。<code>assets/templates/</code> と <code>assets/example/</code> から <code>node scripts/verify-templates.mjs --write-catalog</code> で生成する。手で編集しない。</p>
<p class="cat-lead"><b>このページは部品(バーとパネル)だけの一覧で、レポート本体の文脈(入れ子の流れ、接続線、解説、変更前後の比較)は含まない。</b>レポート全体にチェックリストを重ねた完成形は <code>assets/example/full-report/report.checklist.html</code> を開く。</p>
<p class="cat-lead">実際の出力は、元のレポートに、下のバー(各テーブルの直前)、パネル(コミットタブの直前)、スタイル、スクリプトを差し込んだもの。元のレポートの内容は変更しない。</p>
<h2>1. 確認パネル(コミットタブの直前)</h2>
<p class="cat-lead">全テーブルを点数の高い順に並べる。同点はコミット順、テーブルの並び順。</p>
${panel}
<h2>2. バー(各テーブルの直前)— 点数帯・パターン別</h2>
<p class="cat-lead">キャプションの stepId は <code>assets/example/risk-scores.example.json</code> の採点と対応する。点数・category・reason・checkPoints の書き方の見本になる。</p>
${sections}
<h2>3. 状態の見本</h2>
<h3>確認済みにした状態(バー全体が淡くなり、パネルの項目に取り消し線が付く)</h3>
${checked}
<h3>HTMLの特殊文字(エスケープされ、文字として表示される)</h3>
${figure(hostile)}
<!-- スクリプトは検査で使うため、カタログには含めない(${scriptText().length} 文字) -->
</body>
</html>
`;
}

// 同梱したレポート生成器(report-generation/)が、チェックリストの対応版と同じテンプレート版を出力することを確認する。
// 食い違うと、入力が無い時に生成したレポートを build-checklist-report.mjs が拒否する。
function checkBundledGenerator() {
  const root = path.join(SKILL_ROOT, "report-generation");
  const required = ["PROCEDURE.md", "scripts/generate-report.sh", "scripts/verify-orchestration.mjs", "scripts/validate-review-data.mjs", "assets/generator/generate-report.mjs", "assets/generator/package-lock.json", "references/review-data-schema.md", "references/multi-agent-orchestration.md"];
  for (const relative of required) if (!existsSync(path.join(root, relative))) fail(`同梱のレポート生成器に ${relative} がない(report-generation/)`);
  if (errors.length > 0) return;

  const generatorVersion = readFileSync(path.join(root, "assets", "generator", "generate-report.mjs"), "utf8").match(/const TEMPLATE_VERSION = "([^"]+)"/)?.[1];
  const supported = readFileSync(BUILD_SCRIPT, "utf8").match(/const SUPPORTED_TEMPLATE_VERSIONS = \[([^\]]*)\]/)?.[1].match(/"([^"]+)"/g)?.map((value) => value.slice(1, -1)) ?? [];
  const sampleVersion = readFileSync(FIXTURE_BASE, "utf8").match(/<meta name="code-change-flow-template-version" content="([^"]+)">/)?.[1];
  if (!generatorVersion) fail("同梱のレポート生成器のテンプレート版を読み取れない");
  else if (!supported.includes(generatorVersion)) fail(`同梱のレポート生成器のテンプレート版(${generatorVersion})が、build-checklist-report.mjs の対応版(${supported.join(", ")})に含まれない`);
  if (sampleVersion !== generatorVersion) fail(`full-report/report.html のテンプレート版(${sampleVersion})が同梱のレポート生成器(${generatorVersion})と違う`);
}

function classCounts(html) {
  const counts = new Map();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1].split(/\s+/).filter(Boolean)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

// 実際のレポート(フロー・解説・変更前後の比較つき)へ、本番と同じ build-checklist-report.mjs でチェックリストを重ね、
// 元のレポートの構造が1つも失われていないこと、全テーブルにバーが付くことを確認する。戻り値は完成形のHTML。
function buildFullReportSample() {
  const temporary = path.join(os.tmpdir(), `rc-fixture-${process.pid}.html`);
  let sample;
  try {
    const stdout = execFileSync(process.execPath, [BUILD_SCRIPT, FIXTURE_DATA, FIXTURE_SCORES, FIXTURE_BASE, temporary], { encoding: "utf8" });
    if (!stdout.includes("Checklist verification passed")) fail("全体構造の見本のビルドが Checklist verification passed を出力しない");
    sample = readFileSync(temporary, "utf8");
  } catch (error) {
    fail(`全体構造の見本のビルドに失敗した: ${String(error.stderr ?? error.message).trim().split("\n").slice(0, 3).join(" / ")}`);
    return null;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }

  const base = readFileSync(FIXTURE_BASE, "utf8");
  const before = classCounts(base);
  const after = classCounts(sample);
  for (const [group, names] of Object.entries(REPORT_STRUCTURE)) {
    for (const name of names) {
      if (!before.get(name)) fail(`全体構造の見本(report.html)に「${group}」の ${name} がない。見本が全パターンを含んでいない`);
      else if (after.get(name) !== before.get(name)) fail(`チェックリストを重ねると「${group}」の ${name} が変わる(${before.get(name)} → ${after.get(name) ?? 0})`);
    }
  }
  const { units } = validateRiskScores(loadJson(FIXTURE_DATA), loadJson(FIXTURE_SCORES));
  if ((after.get("rc-bar") ?? 0) !== units.length) fail(`全体構造の見本のバーの数(${after.get("rc-bar") ?? 0})がテーブル数(${units.length})と一致しない`);
  if (units.length < 10) fail(`全体構造の見本のテーブル数が少ない(${units.length})`);
  return sample;
}

function main() {
  const writeCatalog = process.argv.includes("--write-catalog");
  checkPlaceholders();
  checkBundledGenerator();
  const { units, scoreByKey } = loadExample();
  if (errors.length === 0) {
    checkCoverage(units, scoreByKey);
    checkRendering();
  }
  let fixtureTables = 0;
  if (errors.length === 0) {
    const outputs = [
      [CATALOG_PATH, renderCatalog(units, scoreByKey), "assets/template-catalog.html"],
      [FIXTURE_SAMPLE, buildFullReportSample(), "assets/example/full-report/report.checklist.html"]
    ];
    fixtureTables = validateRiskScores(loadJson(FIXTURE_DATA), loadJson(FIXTURE_SCORES)).units.length;
    for (const [filePath, expected, label] of outputs) {
      if (expected === null) continue;
      if (writeCatalog) {
        writeFileSync(filePath, expected, "utf8");
        console.log(`Written: ${label}`);
      } else {
        let current = "";
        try { current = readFileSync(filePath, "utf8"); } catch { /* 無い場合は不一致として扱う */ }
        if (current !== expected) fail(`${label} が最新でない。node scripts/verify-templates.mjs --write-catalog で再生成する`);
      }
    }
  }
  if (errors.length > 0) {
    console.error(`Template verification failed (${errors.length} 件):`);
    errors.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }
  console.log(`Template verification passed: ${Object.keys(PLACEHOLDERS).length} templates, ${units.length} example tables (0-10 points, ${CATEGORIES.length} categories), full report sample ${fixtureTables} tables (flow, explanation, comparison preserved), catalog and sample up to date`);
}

main();
