#!/usr/bin/env node
// 使い方:
//   node validate-risk-scores.mjs <review-data.json> <risk-scores.json>
//   node validate-risk-scores.mjs --self-test

import { loadJson } from "./units.mjs";
import { validateRiskScores, CONTEXT_CATEGORY } from "./risk-scores.mjs";

function selfTest() {
  const step = (id, before, after, remarks = "", calls = []) => ({
    id, filePath: `src/${id}.java`, startLine: 1, endLine: 3, beforeCode: before, afterCode: after, remarks, calls
  });
  const data = {
    commits: [{
      hash: "aaa1111",
      message: "テスト",
      steps: [
        step("entry", "a();", "a();", "", [{ steps: [
          step("changed", "x = 1;", "x = 2;", "[考慮漏れ] nullの場合を扱っていない。"),
          step("after", "return x;", "return x;")
        ] }])
      ]
    }]
  };
  const good = () => ({
    version: 1,
    units: [
      { commit: "aaa1111", stepId: "entry", score: 1, category: CONTEXT_CATEGORY, reason: "入口で値を受け取るだけの処理である。", checkPoints: [] },
      { commit: "aaa1111", stepId: "changed", score: 6, category: "業務ルール・分岐", reason: "nullが渡されると例外になり、登録が失敗する。", checkPoints: ["nullの入力を扱うか"] },
      { commit: "aaa1111", stepId: "after", score: 0, category: CONTEXT_CATEGORY, reason: "変更結果をそのまま返すだけの処理である。", checkPoints: [] }
    ]
  });

  const cases = [
    ["正しい採点は通る", (s) => s, true],
    ["採点の欠落", (s) => { s.units.pop(); return s; }, false],
    ["採点の重複", (s) => { s.units.push({ ...s.units[0] }); return s; }, false],
    ["存在しないstepId", (s) => { s.units[0].stepId = "nothing"; return s; }, false],
    ["scoreが範囲外", (s) => { s.units[1].score = 11; return s; }, false],
    ["scoreが整数でない", (s) => { s.units[1].score = 6.5; return s; }, false],
    ["不正なcategory", (s) => { s.units[1].category = "その他"; return s; }, false],
    ["reasonが短い", (s) => { s.units[1].reason = "危険"; return s; }, false],
    ["重要度が高いのに確認点がない", (s) => { s.units[1].checkPoints = []; return s; }, false],
    ["備考の指摘に対してscoreが低い", (s) => { s.units[1].score = 4; return s; }, false],
    ["変更なしテーブルのscoreが高い", (s) => { s.units[0].score = 5; return s; }, false],
    ["変更ありなのに文脈カテゴリ", (s) => { s.units[1].category = CONTEXT_CATEGORY; return s; }, false],
    ["変更なしなのに文脈以外のカテゴリ", (s) => { s.units[2].category = "表示・整形"; return s; }, false],
    ["未知のコミット", (s) => { s.units[0].commit = "zzz"; return s; }, false],
    ["versionが違う", (s) => { s.version = 2; return s; }, false]
  ];

  let failures = 0;
  for (const [name, mutate, shouldPass] of cases) {
    const { errors } = validateRiskScores(data, mutate(good()));
    const passed = errors.length === 0;
    if (passed !== shouldPass) {
      failures += 1;
      console.error(`FAIL: ${name}(期待: ${shouldPass ? "成功" : "失敗"}、実際: ${passed ? "成功" : "失敗"})${errors.length ? " -> " + errors[0] : ""}`);
    }
  }
  if (failures > 0) process.exit(1);
  console.log(`Risk score self-test passed: ${cases.length} cases`);
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  selfTest();
} else if (args.length === 2) {
  const reviewData = loadJson(args[0]);
  const scores = loadJson(args[1]);
  const { errors, units } = validateRiskScores(reviewData, scores);
  if (errors.length > 0) {
    console.error(`Risk score validation failed (${errors.length} 件):`);
    errors.forEach((message) => console.error(`- ${message}`));
    process.exit(1);
  }
  console.log(`Risk score validation passed: ${units.length} tables`);
} else {
  console.error("Usage: validate-risk-scores.mjs <review-data.json> <risk-scores.json> | --self-test");
  process.exit(1);
}
