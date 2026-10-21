#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

const COVERAGE_VERSION = 1;
const EVIDENCE_KINDS = new Set(["semantic", "text", "framework", "manual"]);
const CALL_SITE_STATUSES = new Set(["included", "excluded", "unresolved"]);
const ANALYSIS_MODES = new Set(["callers", "entry-point", "not-applicable"]);
const [inputPath] = process.argv.slice(2);

if (inputPath === "--self-test") {
  runSelfTest();
  process.exit(0);
}

if (!inputPath) {
  console.error("Usage: node verify-caller-coverage.mjs <review-data.json>");
  process.exit(1);
}

const data = JSON.parse(await readFile(inputPath, "utf8"));
const result = verifyCallerCoverage(data);
console.log(
  `Caller coverage passed: version ${COVERAGE_VERSION}, ${result.commits} commits, `
  + `${result.targets} targets, ${result.included} included, ${result.excluded} excluded`
);

function verifyCallerCoverage(data) {
  assertObject(data, "root");
  const commits = data.commits ?? [{
    hash: "working-tree",
    steps: data.steps,
    callerCoverage: data.callerCoverage
  }];
  assertArray(commits, "commits");

  const totals = { commits: commits.length, targets: 0, included: 0, excluded: 0 };

  commits.forEach((commit, commitIndex) => {
    const commitLocation = `commits[${commitIndex}]`;
    assertObject(commit, commitLocation);
    assertArray(commit.steps, `${commitLocation}.steps`);
    const stepIndex = buildStepIndex(commit.steps, `${commitLocation}.steps`);
    const coverage = commit.callerCoverage;
    assertObject(coverage, `${commitLocation}.callerCoverage`);
    if (coverage.version !== COVERAGE_VERSION) {
      fail(`${commitLocation}.callerCoverage.version`, `${COVERAGE_VERSION}を指定してください`);
    }
    assertArray(coverage.targets, `${commitLocation}.callerCoverage.targets`);
    if (coverage.targets.length === 0) {
      fail(`${commitLocation}.callerCoverage.targets`, "変更対象を1件以上記録してください");
    }

    const targetIds = new Set();
    const callSiteIds = new Set();
    const coveredChangedStepIds = new Set();

    coverage.targets.forEach((target, targetIndex) => {
      const targetLocation = `${commitLocation}.callerCoverage.targets[${targetIndex}]`;
      assertObject(target, targetLocation);
      requireText(target.id, `${targetLocation}.id`);
      requireUnique(target.id, targetIds, `${targetLocation}.id`, "変更対象ID");
      requireText(target.displayName, `${targetLocation}.displayName`);
      if (!ANALYSIS_MODES.has(target.analysisMode)) {
        fail(`${targetLocation}.analysisMode`, "callers、entry-point、not-applicableのいずれかを指定してください");
      }
      assertArray(target.changedStepIds, `${targetLocation}.changedStepIds`);
      if (target.changedStepIds.length === 0) {
        fail(`${targetLocation}.changedStepIds`, "変更コードを含むステップIDを1件以上指定してください");
      }

      const targetChangedStepIds = new Set();
      target.changedStepIds.forEach((stepId, stepIndexInTarget) => {
        const location = `${targetLocation}.changedStepIds[${stepIndexInTarget}]`;
        requireText(stepId, location);
        requireUnique(stepId, targetChangedStepIds, location, "変更ステップID");
        const record = requireStep(stepIndex, stepId, location);
        if (!record.changed) {
          fail(location, `${stepId}は変更前後が同一のステップです`);
        }
        coveredChangedStepIds.add(stepId);
      });

      assertArray(target.callSites, `${targetLocation}.callSites`);
      const targetCallSites = new Map();
      const targetCallSiteLocations = new Set();
      const includedChangedStepIds = new Set();
      let unresolvedCount = 0;

      target.callSites.forEach((callSite, callSiteIndex) => {
        const callSiteLocation = `${targetLocation}.callSites[${callSiteIndex}]`;
        assertObject(callSite, callSiteLocation);
        requireText(callSite.id, `${callSiteLocation}.id`);
        requireUnique(callSite.id, callSiteIds, `${callSiteLocation}.id`, "呼び出し箇所ID");
        targetCallSites.set(callSite.id, callSite);
        requireText(callSite.callerSymbol, `${callSiteLocation}.callerSymbol`);
        if (!CALL_SITE_STATUSES.has(callSite.status)) {
          fail(`${callSiteLocation}.status`, "included、excluded、unresolvedのいずれかを指定してください");
        }

        if (callSite.status === "unresolved") {
          requireText(callSite.reason, `${callSiteLocation}.reason`);
          unresolvedCount += 1;
          return;
        }

        requireText(callSite.callerPath, `${callSiteLocation}.callerPath`);
        requireLine(callSite.startLine, `${callSiteLocation}.startLine`);
        requireLine(callSite.endLine, `${callSiteLocation}.endLine`);
        if (callSite.endLine < callSite.startLine) {
          fail(`${callSiteLocation}.endLine`, "終了行は開始行以上にしてください");
        }
        requireUnique(
          `${callSite.callerPath}:${callSite.startLine}-${callSite.endLine}`,
          targetCallSiteLocations,
          callSiteLocation,
          "呼び出し箇所"
        );

        if (callSite.status === "excluded") {
          requireText(callSite.reason, `${callSiteLocation}.reason`);
          totals.excluded += 1;
          return;
        }

        requireText(callSite.entryStepId, `${callSiteLocation}.entryStepId`);
        requireText(callSite.callerStepId, `${callSiteLocation}.callerStepId`);
        requireText(callSite.changedStepId, `${callSiteLocation}.changedStepId`);
        const entryRecord = requireStep(stepIndex, callSite.entryStepId, `${callSiteLocation}.entryStepId`);
        const callerRecord = requireStep(stepIndex, callSite.callerStepId, `${callSiteLocation}.callerStepId`);
        const changedRecord = requireStep(stepIndex, callSite.changedStepId, `${callSiteLocation}.changedStepId`);

        if (!stepIndex.entryStepIds.has(entryRecord.id)) {
          fail(`${callSiteLocation}.entryStepId`, `${entryRecord.id}は独立フローの先頭ステップではありません`);
        }
        if (callerRecord.entryStepId !== entryRecord.id || changedRecord.entryStepId !== entryRecord.id) {
          fail(callSiteLocation, "入口、呼び出し箇所、変更箇所が同じ処理フローに属していません");
        }
        if (callerRecord.step.filePath !== callSite.callerPath) {
          fail(`${callSiteLocation}.callerPath`, `呼び出し元ステップ${callerRecord.id}のファイルと一致しません`);
        }
        if (callerRecord.step.startLine > callSite.startLine || callerRecord.step.endLine < callSite.endLine) {
          fail(callSiteLocation, `呼び出し箇所の行範囲が呼び出し元ステップ${callerRecord.id}に含まれていません`);
        }
        if (!hasChildSteps(callerRecord.step)) {
          fail(`${callSiteLocation}.callerStepId`, `${callerRecord.id}に呼び出し先のstepsがありません`);
        }
        if (!isDescendantOf(changedRecord.id, callerRecord.id, stepIndex)) {
          fail(callSiteLocation, `${changedRecord.id}が${callerRecord.id}の呼び出し先として入れ子になっていません`);
        }
        if (!changedRecord.changed) {
          fail(`${callSiteLocation}.changedStepId`, `${changedRecord.id}は変更コードを含みません`);
        }
        if (!targetChangedStepIds.has(changedRecord.id)) {
          fail(`${callSiteLocation}.changedStepId`, `${changedRecord.id}が変更対象${target.id}のchangedStepIdsにありません`);
        }
        requireUnique(
          changedRecord.id,
          includedChangedStepIds,
          `${callSiteLocation}.changedStepId`,
          "掲載済み呼び出し元に対応する変更ステップID"
        );
        totals.included += 1;
      });

      validateEvidence(target, targetCallSites, targetLocation);

      if (unresolvedCount > 0) {
        fail(`${targetLocation}.callSites`, `未解決の呼び出し候補が${unresolvedCount}件あります`);
      }

      if (target.analysisMode === "callers") {
        if (target.callSites.length === 0) {
          fail(`${targetLocation}.callSites`, "callersでは呼び出し箇所を1件以上記録してください");
        }
        if (includedChangedStepIds.size === 0) {
          fail(`${targetLocation}.callSites`, "掲載する呼び出し元がありません");
        }
        requireSameSet(
          targetChangedStepIds,
          includedChangedStepIds,
          `${targetLocation}.changedStepIds`,
          "掲載する各呼び出し元には、専用の変更ステップを1件ずつ対応させてください"
        );
      } else if (target.analysisMode === "entry-point") {
        if (target.callSites.length !== 0) {
          fail(`${targetLocation}.callSites`, "entry-pointではcallSitesを空配列にしてください");
        }
        requireText(target.entryStepId, `${targetLocation}.entryStepId`);
        const entryRecord = requireStep(stepIndex, target.entryStepId, `${targetLocation}.entryStepId`);
        if (!stepIndex.entryStepIds.has(entryRecord.id)) {
          fail(`${targetLocation}.entryStepId`, `${entryRecord.id}は独立フローの先頭ステップではありません`);
        }
        targetChangedStepIds.forEach((stepId) => {
          if (stepIndex.stepsById.get(stepId).entryStepId !== entryRecord.id) {
            fail(`${targetLocation}.changedStepIds`, `${stepId}が入口${entryRecord.id}のフローに属していません`);
          }
        });
      } else {
        if (target.callSites.length !== 0) {
          fail(`${targetLocation}.callSites`, "not-applicableではcallSitesを空配列にしてください");
        }
        requireText(target.reason, `${targetLocation}.reason`);
      }

      totals.targets += 1;
    });

    stepIndex.changedStepIds.forEach((stepId) => {
      if (!coveredChangedStepIds.has(stepId)) {
        fail(`${commitLocation}.callerCoverage.targets`, `変更ステップ${stepId}が変更対象へ登録されていません`);
      }
    });
  });

  return totals;
}

function validateEvidence(target, targetCallSites, targetLocation) {
  assertArray(target.evidence, `${targetLocation}.evidence`);
  const minimumEvidence = target.analysisMode === "callers" ? 2 : 1;
  if (target.evidence.length < minimumEvidence) {
    fail(`${targetLocation}.evidence`, `${minimumEvidence}種類以上の探索根拠を記録してください`);
  }

  const evidenceKinds = new Set();
  const evidencedCallSiteIds = new Set();
  target.evidence.forEach((evidence, evidenceIndex) => {
    const evidenceLocation = `${targetLocation}.evidence[${evidenceIndex}]`;
    assertObject(evidence, evidenceLocation);
    if (!EVIDENCE_KINDS.has(evidence.kind)) {
      fail(`${evidenceLocation}.kind`, "semantic、text、framework、manualのいずれかを指定してください");
    }
    evidenceKinds.add(evidence.kind);
    requireText(evidence.method, `${evidenceLocation}.method`);
    requireText(evidence.scope, `${evidenceLocation}.scope`);
    requireText(evidence.query, `${evidenceLocation}.query`);
    requireText(evidence.resultSummary, `${evidenceLocation}.resultSummary`);
    assertArray(evidence.callSiteIds, `${evidenceLocation}.callSiteIds`);
    evidence.callSiteIds.forEach((callSiteId, callSiteIndex) => {
      const location = `${evidenceLocation}.callSiteIds[${callSiteIndex}]`;
      requireText(callSiteId, location);
      if (!targetCallSites.has(callSiteId)) {
        fail(location, `探索で検出した${callSiteId}がcallSitesに登録されていません`);
      }
      evidencedCallSiteIds.add(callSiteId);
    });
  });

  if (evidenceKinds.size < minimumEvidence) {
    fail(`${targetLocation}.evidence`, `${minimumEvidence}種類以上の異なる探索方法が必要です`);
  }
  if (target.analysisMode === "callers") {
    if (!evidenceKinds.has("semantic")) {
      fail(`${targetLocation}.evidence`, "意味解析による参照検索を1件以上記録してください");
    }
    if (!evidenceKinds.has("text") && !evidenceKinds.has("framework")) {
      fail(`${targetLocation}.evidence`, "文字列検索またはフレームワーク設定の確認を1件以上記録してください");
    }
  }
  targetCallSites.forEach((_, callSiteId) => {
    if (!evidencedCallSiteIds.has(callSiteId)) {
      fail(`${targetLocation}.callSites`, `${callSiteId}を検出した探索根拠がありません`);
    }
  });
}

function buildStepIndex(rootSteps, rootLocation) {
  const stepsById = new Map();
  const entryStepIds = new Set();
  const changedStepIds = new Set();
  let currentEntryStepId;

  rootSteps.forEach((rootStep, rootIndex) => {
    const rootStepLocation = `${rootLocation}[${rootIndex}]`;
    assertObject(rootStep, rootStepLocation);
    requireText(rootStep.id, `${rootStepLocation}.id`);
    if (rootIndex === 0 || rootStep.connectFromPrevious === false) {
      currentEntryStepId = rootStep.id;
      entryStepIds.add(currentEntryStepId);
    }

    const pending = [{ step: rootStep, location: rootStepLocation, ownerStepId: null }];
    while (pending.length > 0) {
      const item = pending.pop();
      const step = item.step;
      assertObject(step, item.location);
      requireText(step.id, `${item.location}.id`);
      if (stepsById.has(step.id)) {
        fail(`${item.location}.id`, `ステップID ${step.id}が重複しています`);
      }
      const changed = step.beforeCode !== step.afterCode;
      stepsById.set(step.id, {
        id: step.id,
        step,
        entryStepId: currentEntryStepId,
        ownerStepId: item.ownerStepId,
        changed
      });
      if (changed) changedStepIds.add(step.id);

      const calls = step.calls ?? [];
      assertArray(calls, `${item.location}.calls`);
      for (let callIndex = calls.length - 1; callIndex >= 0; callIndex -= 1) {
        const call = calls[callIndex];
        const callLocation = `${item.location}.calls[${callIndex}]`;
        assertObject(call, callLocation);
        assertArray(call.steps, `${callLocation}.steps`);
        for (let stepIndex = call.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
          pending.push({
            step: call.steps[stepIndex],
            location: `${callLocation}.steps[${stepIndex}]`,
            ownerStepId: step.id
          });
        }
      }
    }
  });

  return { stepsById, entryStepIds, changedStepIds };
}

function hasChildSteps(step) {
  return (step.calls ?? []).some((call) => Array.isArray(call.steps) && call.steps.length > 0);
}

function isDescendantOf(descendantStepId, ancestorStepId, stepIndex) {
  let ownerStepId = stepIndex.stepsById.get(descendantStepId)?.ownerStepId;
  while (ownerStepId) {
    if (ownerStepId === ancestorStepId) return true;
    ownerStepId = stepIndex.stepsById.get(ownerStepId)?.ownerStepId;
  }
  return false;
}

function requireStep(stepIndex, stepId, location) {
  const record = stepIndex.stepsById.get(stepId);
  if (!record) fail(location, `存在しないステップID ${stepId}を参照しています`);
  return record;
}

function requireSameSet(expected, actual, location, message) {
  if (expected.size !== actual.size || [...expected].some((value) => !actual.has(value))) {
    fail(location, message);
  }
}

function requireUnique(value, values, location, label) {
  if (values.has(value)) fail(location, `${label} ${value}が重複しています`);
  values.add(value);
}

function runSelfTest() {
  const valid = buildSelfTestFixture();
  const result = verifyCallerCoverage(valid);
  if (result.included !== 2 || result.excluded !== 1) {
    throw new Error("Self-test failed: 複数呼び出し元または理由付き除外を正しく集計できませんでした");
  }

  const missingMapping = structuredClone(valid);
  missingMapping.commits[0].callerCoverage.targets[0].callSites.pop();
  expectFailure("探索結果の未登録", missingMapping);

  const missingCoverage = structuredClone(valid);
  delete missingCoverage.commits[0].callerCoverage;
  expectFailure("呼び出し元インベントリの欠落", missingCoverage);

  const duplicateMapping = structuredClone(valid);
  duplicateMapping.commits[0].callerCoverage.targets[0].callSites[1].changedStepId = "changed-a";
  expectFailure("複数呼び出し元による変更ステップの共有", duplicateMapping);

  const unresolved = structuredClone(valid);
  unresolved.commits[0].callerCoverage.targets[0].callSites[1] = {
    id: "site-b",
    callerSymbol: "CallerB#run",
    status: "unresolved",
    reason: "インターフェースの実装先を確定できない"
  };
  expectFailure("未解決の呼び出し候補", unresolved);

  const excludedWithoutReason = structuredClone(valid);
  delete excludedWithoutReason.commits[0].callerCoverage.targets[0].callSites[2].reason;
  expectFailure("理由のない除外", excludedWithoutReason);

  const missingSemanticEvidence = structuredClone(valid);
  missingSemanticEvidence.commits[0].callerCoverage.targets[0].evidence[0].kind = "manual";
  expectFailure("意味解析による探索根拠の欠落", missingSemanticEvidence);

  const duplicatePhysicalCallSite = structuredClone(valid);
  duplicatePhysicalCallSite.commits[0].callerCoverage.targets[0].callSites[1].callerPath = "CallerA.java";
  duplicatePhysicalCallSite.commits[0].callerCoverage.targets[0].callSites[1].startLine = 11;
  duplicatePhysicalCallSite.commits[0].callerCoverage.targets[0].callSites[1].endLine = 11;
  expectFailure("同一呼び出し箇所の重複登録", duplicatePhysicalCallSite);

  console.log("Caller coverage self-test passed: multiple callers, missing inventories, missing mappings, unresolved callers, exclusions, independent evidence, duplicate locations");
}

function buildSelfTestFixture() {
  return {
    commits: [{
      hash: "self-test",
      steps: [
        {
          id: "entry-a",
          filePath: "CallerA.java",
          startLine: 10,
          endLine: 12,
          beforeCode: "service.run();",
          afterCode: "service.run();",
          calls: [{ steps: [{
            id: "changed-a",
            filePath: "Service.java",
            startLine: 30,
            endLine: 32,
            beforeCode: "return oldValue;",
            afterCode: "return newValue;",
            calls: []
          }] }]
        },
        {
          id: "entry-b",
          filePath: "CallerB.java",
          startLine: 20,
          endLine: 22,
          beforeCode: "service.run();",
          afterCode: "service.run();",
          connectFromPrevious: false,
          calls: [{ steps: [{
            id: "changed-b",
            filePath: "Service.java",
            startLine: 30,
            endLine: 32,
            beforeCode: "return oldValue;",
            afterCode: "return newValue;",
            calls: []
          }] }]
        }
      ],
      callerCoverage: {
        version: COVERAGE_VERSION,
        targets: [{
          id: "service-run",
          displayName: "Service.run()",
          analysisMode: "callers",
          changedStepIds: ["changed-a", "changed-b"],
          evidence: [
            {
              kind: "semantic",
              method: "LSP Call Hierarchy",
              scope: "production and test source roots",
              query: "Service.run()",
              resultSummary: "CallerAとCallerBの2件を検出",
              callSiteIds: ["site-a", "site-b", "site-test"]
            },
            {
              kind: "text",
              method: "rg",
              scope: "production and test source roots",
              query: "service.run(",
              resultSummary: "CallerAとCallerBの2件を検出",
              callSiteIds: ["site-a", "site-b", "site-test"]
            }
          ],
          callSites: [
            {
              id: "site-a",
              callerSymbol: "CallerA#run",
              callerPath: "CallerA.java",
              startLine: 11,
              endLine: 11,
              status: "included",
              entryStepId: "entry-a",
              callerStepId: "entry-a",
              changedStepId: "changed-a"
            },
            {
              id: "site-b",
              callerSymbol: "CallerB#run",
              callerPath: "CallerB.java",
              startLine: 21,
              endLine: 21,
              status: "included",
              entryStepId: "entry-b",
              callerStepId: "entry-b",
              changedStepId: "changed-b"
            },
            {
              id: "site-test",
              callerSymbol: "ServiceTest#run",
              callerPath: "ServiceTest.java",
              startLine: 15,
              endLine: 15,
              status: "excluded",
              reason: "テスト専用の呼び出しであり、実行時の入口から到達しない"
            }
          ]
        }]
      }
    }]
  };
}

function expectFailure(label, data) {
  try {
    verifyCallerCoverage(data);
  } catch {
    return;
  }
  throw new Error(`Self-test failed: ${label}を検出できませんでした`);
}

function fail(location, message) {
  throw new Error(`${location}: ${message}`);
}

function assertObject(value, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(location, "オブジェクトが必要です");
  }
}

function assertArray(value, location) {
  if (!Array.isArray(value)) fail(location, "配列が必要です");
}

function requireText(value, location) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(location, "空ではない文字列が必要です");
  }
}

function requireLine(value, location) {
  if (!Number.isInteger(value) || value < 1) fail(location, "1以上の整数が必要です");
}
