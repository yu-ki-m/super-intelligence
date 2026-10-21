// review-data.json から、レビュー単位(=レポートHTML上の1テーブル)を列挙する共有モジュール。
// 列挙順は「ステップ → その呼び出し先 → 次のステップ」の前順走査で、レポートHTMLの data-flow-index と一致する必要がある
// (build-checklist-report.mjs が、HTML上のテーブル数と位置がこの列挙と合うことを検査する)。

import { readFileSync } from "node:fs";

export const FINDING_TAGS = ["バグ", "懸念点", "考慮漏れ"];

export function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: JSONを読み込めない: ${error.message}`);
  }
}

export function normalizeCode(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

export function normalizeCommits(data) {
  if (data === null || typeof data !== "object") throw new Error("review-data.json がオブジェクトではない");
  if (data.commits === undefined) {
    return [{ hash: "commit-1", message: String(data.title ?? "変更内容"), steps: data.steps, callerCoverage: data.callerCoverage }];
  }
  if (!Array.isArray(data.commits) || data.commits.length === 0) throw new Error("commits が空、または配列ではない");
  return data.commits.map((commit, index) => ({
    hash: typeof commit.hash === "string" && commit.hash !== "" ? commit.hash : `commit-${index + 1}`,
    message: String(commit.message ?? `コミット ${index + 1}`),
    steps: commit.steps,
    callerCoverage: commit.callerCoverage
  }));
}

function countIncludedCallers(callerCoverage) {
  const counts = new Map();
  for (const target of callerCoverage?.targets ?? []) {
    for (const site of target.callSites ?? []) {
      if (site.status !== "included" || typeof site.changedStepId !== "string") continue;
      counts.set(site.changedStepId, (counts.get(site.changedStepId) ?? 0) + 1);
    }
  }
  return counts;
}

export function collectUnits(data) {
  const commits = normalizeCommits(data);
  const units = [];

  commits.forEach((commit, commitIndex) => {
    if (!Array.isArray(commit.steps)) throw new Error(`commits[${commitIndex}].steps が配列ではない`);
    const callerCounts = countIncludedCallers(commit.callerCoverage);
    const stack = [];
    const pushList = (steps, depth) => {
      for (let index = steps.length - 1; index >= 0; index -= 1) stack.push({ step: steps[index], depth });
    };
    pushList(commit.steps, 0);

    let flowIndex = 0;
    while (stack.length > 0) {
      const { step, depth } = stack.pop();
      if (typeof step.id !== "string" || step.id === "") {
        throw new Error(`commits[${commitIndex}] の ${flowIndex} 番目のテーブルに id がない`);
      }
      const remarks = typeof step.remarks === "string" ? step.remarks : "";
      const findings = FINDING_TAGS.filter((tag) => remarks.includes(`[${tag}]`));
      const changed = normalizeCode(step.beforeCode) !== normalizeCode(step.afterCode);
      units.push({
        commitIndex,
        commitHash: commit.hash,
        commitMessage: commit.message,
        flowIndex,
        stepId: step.id,
        depth,
        filePath: String(step.filePath ?? ""),
        startLine: step.startLine,
        endLine: step.endLine,
        changed,
        findings,
        callerCount: changed ? (callerCounts.get(step.id) ?? 0) : 0,
        step
      });
      flowIndex += 1;

      const calls = step.calls ?? [];
      for (let callIndex = calls.length - 1; callIndex >= 0; callIndex -= 1) {
        pushList(calls[callIndex].steps ?? [], depth + 1);
      }
    }
  });

  return { commits, units };
}

export function unitKey(unit) {
  return `${unit.commitIndex}:${unit.stepId}`;
}

export function location(unit) {
  return `${unit.filePath}:${unit.startLine}-${unit.endLine}`;
}
