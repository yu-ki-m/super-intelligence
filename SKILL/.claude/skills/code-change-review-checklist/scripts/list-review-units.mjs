#!/usr/bin/env node
// 採点対象(HTML上の1テーブル)を列挙する。
//   node list-review-units.mjs <review-data.json> [--commit <hash>] [--with-code] [--skeleton <risk-scores.json> [--force]]
// 標準出力: 各テーブルの位置・変更有無・備考の指摘分類・呼び出し元の数(--with-code で説明とコードも含める)
// --skeleton: score などを空にした採点ファイルの雛形を書き出す

import { existsSync, writeFileSync } from "node:fs";
import { collectUnits, loadJson, location } from "./units.mjs";

const args = process.argv.slice(2);
const inputPath = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

if (!inputPath) {
  console.error("Usage: list-review-units.mjs <review-data.json> [--commit <hash>] [--with-code] [--skeleton <risk-scores.json> [--force]]");
  process.exit(1);
}

const commitFilter = valueAfter("--commit");
const withCode = args.includes("--with-code");
const skeletonPath = valueAfter("--skeleton");

const { units } = collectUnits(loadJson(inputPath));
const selected = commitFilter ? units.filter((unit) => unit.commitHash === commitFilter) : units;
if (selected.length === 0) {
  console.error(commitFilter ? `commit ${commitFilter} のテーブルがない` : "テーブルがない");
  process.exit(1);
}

if (skeletonPath) {
  if (existsSync(skeletonPath) && !args.includes("--force")) {
    console.error(`${skeletonPath} は既に存在する。上書きする場合は --force を付ける`);
    process.exit(1);
  }
  const skeleton = {
    version: 1,
    units: units.map((unit) => ({
      commit: unit.commitHash,
      stepId: unit.stepId,
      score: null,
      category: null,
      reason: "",
      checkPoints: []
    }))
  };
  writeFileSync(skeletonPath, `${JSON.stringify(skeleton, null, 2)}\n`, "utf8");
  console.error(`雛形を書き出した: ${skeletonPath}(${units.length} 件)`);
}

const listing = selected.map((unit) => {
  const base = {
    commit: unit.commitHash,
    flowIndex: unit.flowIndex,
    stepId: unit.stepId,
    depth: unit.depth,
    location: location(unit),
    changed: unit.changed,
    findings: unit.findings,
    callerCount: unit.callerCount
  };
  if (!withCode) return base;
  const { step } = unit;
  return {
    ...base,
    overview: step.overview,
    reason: step.reason,
    remarks: step.remarks,
    beforeCode: step.beforeCode,
    afterCode: step.afterCode
  };
});

console.log(JSON.stringify(listing, null, 2));
