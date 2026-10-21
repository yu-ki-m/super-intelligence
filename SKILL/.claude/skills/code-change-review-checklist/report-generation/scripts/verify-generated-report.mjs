#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

const TEMPLATE_VERSION = "2026.09.13.3";
const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error("Usage: node verify-generated-report.mjs <review-data.json> <review-report.html>");
  process.exit(1);
}

const data = JSON.parse(await readFile(inputPath, "utf8"));
const html = await readFile(outputPath, "utf8");
const commits = data.commits ?? [{ hash: "working-tree", message: "変更内容", overview: data.overview, steps: data.steps }];
const flattenedSteps = commits.flatMap((commit) => flattenSteps(commit.steps));
const rootSectionsByCommit = commits.map((commit) => buildRootSections(commit.steps));
const rootSections = rootSectionsByCommit.flat();
const expectedTableCount = flattenedSteps.length;
const expectedRootSectionCount = rootSections.length;
const expectedFlowSectionCount = rootSections.filter((section) => section.isFlow).length;
const expectedStandaloneSectionCount = expectedRootSectionCount - expectedFlowSectionCount;
const expectedToggleCount = flattenedSteps.filter(hasDisplayedDescendants).length;
const expectedBranchCount = commits.reduce((total, commit) => total + countCallEntries(commit.steps), 0);
const expectedDisconnectedCount = commits.reduce(
  (total, commit) => total + commit.steps.slice(1).filter((step) => step.connectFromPrevious === false).length,
  0
);
const expectedBreakCount = commits.reduce(
  (total, commit) => total + countMatches(String(commit.overview), /。[ \t]*(?=\S)/g),
  0
) + rootSections.reduce(
  (total, section) => total + (section.isFlow
    ? countMatches(String(section.startStep.flowDescription), /。[ \t]*(?=\S)/g)
    : 0),
  0
) + flattenedSteps.reduce(
  (total, step) => total + [
    step.overview,
    step.reason,
    step.specification.summary,
    ...step.specification.steps,
    step.specification.example,
    step.remarks
  ]
    .reduce((count, value) => count + countMatches(String(value), /。[ \t]*(?=\S)/g), 0),
  0
);

requireText(`<meta name="code-change-flow-template-version" content="${TEMPLATE_VERSION}">`, "テンプレート版メタ情報");
requireText(`data-template-version="${TEMPLATE_VERSION}"`, "テンプレート版属性");
requireText("--table-width:2460px", "表全体の横幅");
requireText("grid-template-columns:1fr 2fr 2fr 1fr", "410:820:820:410の列比率");
requireText("--canvas:#f3f5f8", "画面全体の落ち着いた背景色");
requireText("--accent:#2563eb", "選択状態を示すアクセント色");
requireText("--shadow:0 2px 5px rgba(15,23,42,.12),0 12px 28px rgba(15,23,42,.09)", "比較表を背景から分離する二層の影");
requireText(".review-unit{position:relative;z-index:1;width:var(--table-width);margin-left:var(--screen-offset);border-radius:6px", "比較表のカード表現");
requireText("box-shadow:var(--shadow)", "比較表の控えめな影");
requireText(".column-title{margin:0;padding:2px 8px;border-bottom:1px solid var(--line);background:var(--header-bg);color:#344054;font-size:14px", "薄いグレーの列タイトル");
requireText(".source-header{display:flex;align-items:center;gap:3px;height:var(--source-height);padding:0 8px", "ファイル位置の見出し表現");
requireText(".commit-overview-scroll{max-height:240px;overflow-y:auto", "コミット概要の高さ上限とスクロール");
requireText(".commit-overview-scroll{max-height:none;overflow:visible}", "印刷時のコミット概要展開");
requireText(".root-section-heading{width:var(--table-width);margin:0 0 8px;padding:8px 12px;border:1px solid var(--line);border-left:4px solid #64748b;border-radius:6px;background:#e8edf3;color:var(--ink);break-after:avoid;page-break-after:avoid}", "第1階層タイトルの見出し表現");
requireText(".root-section-heading--standalone{padding-top:6px;padding-bottom:6px}", "単独テーブル用タイトルの高さ");
requireText(".root-section-description{max-width:1200px;margin:3px 0 0", "処理フロー説明の読みやすい行幅");
requireText(".review-unit{margin-left:var(--print-offset);border-radius:0;box-shadow:none}", "印刷時のカード装飾解除");
requireText(".detail:last-child{max-height:536px;overflow-y:auto", "処理仕様の高さ上限とスクロール");
requireText(".detail:last-child{max-height:none;overflow:visible", "印刷時の処理仕様展開");
requireText(".specification-steps{margin:5px 0;padding-left:25px;list-style:decimal}", "処理仕様の番号付き手順");
requireText(".specification-step::marker{color:#475467;font-weight:600}", "処理手順の番号表示");
requireText("--diff-remove:#ffebe9", "削除行の薄い赤色");
requireText(".editor .shiki .diff-line--removed{background:var(--diff-remove)}", "削除行の背景指定");
requireText('.editor .shiki .diff-line--removed::before{color:#cf222e;content:"-"}', "削除行のマイナス記号");
requireText("--diff-add:#dafbe1", "追加行の薄い緑色");
requireText(".editor .shiki .diff-line--added{background:var(--diff-add)}", "追加行の背景指定");
requireText('.editor .shiki .diff-line--added::before{color:#1a7f37;content:"+"}', "追加行のプラス記号");
requireText(".connector-track{top:0;bottom:0}", "縦の接続線");
requireText(".row-track,.connector-track{border-left:1px dotted var(--line-strong)}", "横線通過後を含む点線の縦接続線");
requireText(".entry-stem,.connector-track--entry{border-left:1px solid var(--line-strong)}", "横線まで連続する実線縦区間");
requireText(".entry-stem{top:0;height:var(--source-height)}", "横線直前の実線縦区間");
requireText(".entry-branch{position:absolute", "入れ子入口の横線");
requireText("border-top:1px solid var(--line-strong)", "実線の横接続線");
requireText(".commit-panel[hidden]{display:block!important}", "印刷時の全コミット表示");
requireText(".flow-item[hidden]{display:block!important}", "印刷時の全入れ子表示");
requireText("const collapsedRanges", "段ごとの入れ子開閉処理");
requireText("tab.focus({ preventScroll: true })", "ページを移動させないタブフォーカス");
requireText("tabViewport.scrollLeft", "タブ欄内だけの横スクロール調整");

requireCount('<button class="commit-tab"', commits.length, "コミットタブ");
requireCount('<section class="commit-overview"', commits.length, "コミット概要");
requireCount('class="commit-overview-title"', commits.length, "概要ラベル");
requireCount('<section class="root-section-heading ', expectedRootSectionCount, "第1階層のタイトル");
requireCount('data-section-kind="flow"', expectedFlowSectionCount, "処理フローのタイトル");
requireCount('data-section-kind="standalone"', expectedStandaloneSectionCount, "単独テーブルのタイトル");
requireCount('<p class="root-section-description">', expectedFlowSectionCount, "処理フローの説明");
requireCount('<div class="review-unit">', expectedTableCount, "比較表");
requireCount('<h2 class="column-title">変更前</h2>', expectedTableCount, "変更前タイトル");
requireCount('<h2 class="column-title">変更後</h2>', expectedTableCount, "変更後タイトル");
requireCount('<h2 class="column-title">解説</h2>', expectedTableCount, "解説タイトル");
requireCount('<h2 class="column-title">備考</h2>', expectedTableCount, "備考タイトル");
requireCount('<ol class="specification-steps">', expectedTableCount, "処理仕様の番号付き一覧");
requireCount(
  '<li class="specification-step">',
  flattenedSteps.reduce((total, step) => total + step.specification.steps.length, 0),
  "処理仕様の手順"
);
requireCount('<button class="nest-toggle"', expectedToggleCount, "入れ子開閉シェブロン");
requireCount('<span class="connector-track connector-track--entry"', expectedBranchCount, "各横線へ向かうテーブル間の実線縦区間");
requireCount('<span class="entry-stem"', expectedBranchCount, "各横線直前の実線縦区間");
requireCount('<span class="entry-branch"', expectedBranchCount, "各入れ子入口の横線");
requireCount('<div class="flow-connector flow-connector--disconnected"', expectedDisconnectedCount, "独立した1段目の線なし間隔");
requireCount("<br>", expectedBreakCount, "句点直後の改行");

if (html.includes("marker-end=") || html.includes("marker-start=") || html.includes("<polygon")) {
  fail("接続線に矢印の先端が含まれています");
}
if (html.includes("scrollIntoView(")) {
  fail("ページ全体を動かすスクロール処理が含まれています");
}
if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /<link\b[^>]*\bhref\s*=/i.test(html)) {
  fail("HTMLが外部のJavaScriptまたはCSSを参照しています");
}
if (/<(?:img|source)\b[^>]*\bsrc\s*=\s*["'](?!data:)/i.test(html)) {
  fail("HTMLが別ファイルの画像またはメディアを参照しています");
}
if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(html)) {
  fail("HTMLがWeb APIまたはサーバー通信を必要としています");
}
if (/diff-(?:spacer|placeholder)|diff-line--empty/.test(html)) {
  fail("差分位置をそろえるための人工的な空行が含まれています");
}

const comparisonRule = html.match(/\.comparison\{([^}]*)\}/)?.[1] ?? "";
if (/(?:^|;)\s*(?:min-)?height\s*:/.test(comparisonRule)) {
  fail("比較表に固定の縦幅が設定されています");
}

const detailBodyRule = html.match(/\.detail-body\{([^}]*)\}/)?.[1] ?? "";
if (/(?:^|;)\s*(?:min-)?height\s*:/.test(detailBodyRule)) {
  fail("説明本文に固定の縦幅が設定されています");
}

const renderedUnits = html.split('<div class="review-unit">').slice(1);
if (renderedUnits.length !== flattenedSteps.length) {
  fail(`比較表の分割数が不正です: expected ${flattenedSteps.length}, actual ${renderedUnits.length}`);
}

flattenedSteps.forEach((step, index) => {
  const unit = renderedUnits[index];
  const orderedTitles = ["解説", "変更前", "変更後", "備考"];
  let previousTitlePosition = -1;
  orderedTitles.forEach((title) => {
    const titlePosition = unit.indexOf(`<h2 class="column-title">${title}</h2>`);
    if (titlePosition < 0 || titlePosition <= previousTitlePosition) {
      fail(`${index + 1}番目の表で列順が「解説、変更前、変更後、備考」になっていません`);
    }
    previousTitlePosition = titlePosition;
  });
  requireUnitText(unit, '<pre class="shiki', index, "シンタックスハイライト領域");
  const locationPosition = unit.indexOf('<p class="source-location">');
  const control = hasDisplayedDescendants(step)
    ? '<button class="nest-toggle"'
    : '<span class="nest-toggle-placeholder"';
  const controlPosition = unit.indexOf(control);
  if (controlPosition < 0 || locationPosition < 0 || controlPosition > locationPosition) {
    fail(`${index + 1}番目の表で、ファイルパス左側の開閉領域が不正です`);
  }
  const expectedLocation = `<p class="source-location">${escapeHtml(String(step.filePath))}:${escapeHtml(String(step.startLine))}-${escapeHtml(String(step.endLine))}</p>`;
  requireUnitText(unit, expectedLocation, index, "コロン区切りのファイル位置");
  requireUnitText(unit, renderSpecificationForVerification(step.specification), index, "要点・番号付き手順・具体例で構成した処理仕様");

  const hasRenderedDiff = /class="line diff-line diff-line--(?:added|removed)"/.test(unit);
  if (step.beforeCode === step.afterCode && hasRenderedDiff) {
    fail(`${index + 1}番目の未変更ステップに差分色が付いています`);
  }
  if (step.beforeCode !== step.afterCode && !hasRenderedDiff) {
    fail(`${index + 1}番目の変更ステップに差分色がありません`);
  }
});

const renderedPanels = html.split('<section class="commit-panel"').slice(1);
commits.forEach((commit, index) => {
  const panel = renderedPanels[index] ?? "";
  const overviewPosition = panel.indexOf('<section class="commit-overview"');
  const firstTablePosition = panel.indexOf('<div class="review-unit">');
  if (overviewPosition < 0 || firstTablePosition < 0 || overviewPosition > firstTablePosition) {
    fail(`${index + 1}番目のコミットで概要が最初の比較表より前にありません`);
  }
  if (!panel.includes(formatProseForVerification(commit.overview))) {
    fail(`${index + 1}番目のコミット概要がJSONの内容と一致しません`);
  }

  const expectedSections = rootSectionsByCommit[index];
  const renderedSectionHeadings = panel.match(/<section class="root-section-heading[\s\S]*?<\/section>/g) ?? [];
  if (renderedSectionHeadings.length !== expectedSections.length) {
    fail(`${index + 1}番目のコミットで第1階層タイトルの数が一致しません`);
  }
  expectedSections.forEach((section, sectionIndex) => {
    const heading = renderedSectionHeadings[sectionIndex];
    const expectedKind = section.isFlow ? "flow" : "standalone";
    if (!heading.includes(`data-section-kind="${expectedKind}"`)) {
      fail(`${index + 1}番目のコミットの${sectionIndex + 1}番目でタイトル種別が不正です`);
    }
    if (!heading.includes(`<h2 class="root-section-title"`) || !heading.includes(`>${escapeHtml(String(section.startStep.flowTitle))}</h2>`)) {
      fail(`${index + 1}番目のコミットの${sectionIndex + 1}番目でタイトルがJSONと一致しません`);
    }
    if (section.isFlow) {
      const expectedDescription = `<p class="root-section-description">${formatProseForVerification(section.startStep.flowDescription)}</p>`;
      if (!heading.includes(expectedDescription)) {
        fail(`${index + 1}番目のコミットの${sectionIndex + 1}番目で処理フローの説明がJSONと一致しません`);
      }
    } else if (heading.includes('class="root-section-description"')) {
      fail(`${index + 1}番目のコミットの${sectionIndex + 1}番目の単独テーブルに説明が表示されています`);
    }
  });
});

console.log(
  `HTML verification passed: template ${TEMPLATE_VERSION}, ${commits.length} commits, ${expectedTableCount} tables, `
  + `${expectedRootSectionCount} root sections (${expectedFlowSectionCount} flows, ${expectedStandaloneSectionCount} standalone)`
);

function buildRootSections(rootSteps) {
  const startIndexes = [];
  rootSteps.forEach((step, index) => {
    if (index === 0 || step.connectFromPrevious === false) startIndexes.push(index);
  });
  return startIndexes.map((startIndex, sectionIndex) => {
    const endIndex = startIndexes[sectionIndex + 1] ?? rootSteps.length;
    const steps = rootSteps.slice(startIndex, endIndex);
    return {
      startStep: rootSteps[startIndex],
      isFlow: steps.length > 1 || steps.some(hasDisplayedCalls)
    };
  });
}

function hasDisplayedCalls(step) {
  return (step.calls ?? []).some((call) => Array.isArray(call.steps) && call.steps.length > 0);
}

function flattenSteps(rootSteps) {
  const result = [];
  const tasks = [{ kind: "flow", steps: rootSteps }];

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task.kind === "step") {
      result.push(task.step);
      continue;
    }

    for (let stepIndex = task.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
      const step = task.steps[stepIndex];
      const calls = step.calls ?? [];
      for (let callIndex = calls.length - 1; callIndex >= 0; callIndex -= 1) {
        tasks.push({ kind: "flow", steps: calls[callIndex].steps });
      }
      tasks.push({ kind: "step", step });
    }
  }

  return result;
}

function hasDisplayedDescendants(step) {
  return (step.calls ?? []).some((call) => Array.isArray(call.steps) && call.steps.length > 0);
}

function countCallEntries(rootSteps) {
  let count = 0;
  const pendingFlows = [rootSteps];

  while (pendingFlows.length > 0) {
    const steps = pendingFlows.pop();
    steps.forEach((step) => {
      (step.calls ?? []).forEach((call) => {
        if (Array.isArray(call.steps) && call.steps.length > 0) {
          count += 1;
          pendingFlows.push(call.steps);
        }
      });
    });
  }

  return count;
}

function countMatches(value, expression) {
  return [...value.matchAll(expression)].length;
}

function countText(value, needle) {
  return value.split(needle).length - 1;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatProseForVerification(value) {
  return escapeHtml(String(value)).replace(/。[ \t]*(?=\S)/g, "。<br>");
}

function renderSpecificationForVerification(specification) {
  const steps = specification.steps
    .map((step) => `<li class="specification-step">${formatProseForVerification(step)}</li>`)
    .join("");
  const example = typeof specification.example === "string" && specification.example.trim() !== ""
    ? `<p class="specification-example">${formatProseForVerification(specification.example)}</p>`
    : "";
  return `<div class="detail-body specification-body"><p class="specification-summary">${formatProseForVerification(specification.summary)}</p><ol class="specification-steps">${steps}</ol>${example}</div>`;
}

function requireText(needle, label) {
  if (!html.includes(needle)) fail(`${label}がHTMLにありません`);
}

function requireUnitText(unit, needle, index, label) {
  if (!unit.includes(needle)) fail(`${index + 1}番目の表に${label}がありません`);
}

function requireCount(needle, expected, label) {
  const actual = countText(html, needle);
  if (actual !== expected) fail(`${label}の数が不正です: expected ${expected}, actual ${actual}`);
}

function fail(message) {
  throw new Error(message);
}
