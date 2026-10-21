#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

const MAX_LEVELS = 10_000;
const [inputPath] = process.argv.slice(2);

if (inputPath === "--self-test-root-sections") {
  runRootSectionSelfTest();
  process.exit(0);
}

if (inputPath === "--self-test-specification") {
  runSpecificationSelfTest();
  process.exit(0);
}

if (inputPath === "--self-test-explanation") {
  runExplanationSelfTest();
  process.exit(0);
}

if (!inputPath) {
  console.error("Usage: node validate-review-data.mjs <review-data.json>");
  process.exit(1);
}

let data;
try {
  data = JSON.parse(await readFile(inputPath, "utf8"));
} catch (error) {
  throw new Error(`JSONを読み込めません: ${error.message}`);
}

assertObject(data, "root");
const commits = data.commits ?? [{ hash: "working-tree", message: "変更内容", overview: data.overview, steps: data.steps }];
assertArray(commits, "commits");
if (commits.length === 0) fail("commits", "1件以上のコミットが必要です");

let totalSteps = 0;
let totalChanged = 0;
let totalContext = 0;
let maximumDepth = 0;
let totalRootSections = 0;
let totalFlowSections = 0;
let totalStandaloneSections = 0;

commits.forEach((commit, commitIndex) => {
  const commitLocation = `commits[${commitIndex}]`;
  assertObject(commit, commitLocation);
  requireText(commit.hash, `${commitLocation}.hash`);
  requireText(commit.message, `${commitLocation}.message`);
  validateCommitOverview(commit.overview, `${commitLocation}.overview`);
  assertArray(commit.steps, `${commitLocation}.steps`);
  if (commit.steps.length === 0) fail(`${commitLocation}.steps`, "1件以上のステップが必要です");
  const rootSectionCounts = validateRootSectionHeadings(commit.steps, `${commitLocation}.steps`);
  totalRootSections += rootSectionCounts.total;
  totalFlowSections += rootSectionCounts.flows;
  totalStandaloneSections += rootSectionCounts.standalone;

  let commitChanged = 0;
  let commitContext = 0;
  const pendingFlows = [{ steps: commit.steps, depth: 0, location: `${commitLocation}.steps` }];

  while (pendingFlows.length > 0) {
    const flow = pendingFlows.pop();
    if (flow.depth >= MAX_LEVELS) {
      fail(flow.location, `入れ子が上限の${MAX_LEVELS}段を超えています`);
    }

    flow.steps.forEach((step, stepIndex) => {
      const stepLocation = `${flow.location}[${stepIndex}]`;
      assertObject(step, stepLocation);
      requireText(step.filePath, `${stepLocation}.filePath`);
      requireLine(step.startLine, `${stepLocation}.startLine`);
      requireLine(step.endLine, `${stepLocation}.endLine`);
      if (step.endLine < step.startLine) {
        fail(`${stepLocation}.endLine`, "終了行は開始行以上にしてください");
      }
      requireText(step.language, `${stepLocation}.language`);
      requireString(step.beforeCode, `${stepLocation}.beforeCode`);
      requireString(step.afterCode, `${stepLocation}.afterCode`);
      if (step.beforeCode === "" && step.afterCode === "") {
        fail(stepLocation, "beforeCodeとafterCodeを両方とも空にはできません");
      }
      const displayedCode = step.afterCode !== "" ? step.afterCode : step.beforeCode;
      const displayedLineCount = countCodeLines(displayedCode);
      const locationLineCount = step.endLine - step.startLine + 1;
      if (locationLineCount !== displayedLineCount) {
        fail(
          `${stepLocation}.startLine/endLine`,
          `表示範囲は${locationLineCount}行ですが、表示基準側のコードは${displayedLineCount}行です`
        );
      }
      requireText(step.overview, `${stepLocation}.overview`);
      requireText(step.reason, `${stepLocation}.reason`);
      validateSpecification(step.specification, `${stepLocation}.specification`);
      requireText(step.remarks, `${stepLocation}.remarks`);
      assertArray(step.calls, `${stepLocation}.calls`);

      if (step.connectFromPrevious !== undefined) {
        if (typeof step.connectFromPrevious !== "boolean") {
          fail(`${stepLocation}.connectFromPrevious`, "trueまたはfalseを指定してください");
        }
        if (flow.depth !== 0) {
          fail(`${stepLocation}.connectFromPrevious`, "connectFromPreviousは1段目だけに指定できます");
        }
      }
      if (flow.depth !== 0 && step.flowTitle !== undefined) {
        fail(`${stepLocation}.flowTitle`, "flowTitleは第1階層の開始ステップだけに指定してください");
      }
      if (flow.depth !== 0 && step.flowDescription !== undefined) {
        fail(`${stepLocation}.flowDescription`, "flowDescriptionは第1階層の開始ステップだけに指定してください");
      }

      totalSteps += 1;
      maximumDepth = Math.max(maximumDepth, flow.depth + 1);
      if (step.beforeCode === step.afterCode) {
        if (step.reason !== "変更なし") {
          fail(`${stepLocation}.reason`, "未変更ステップでは「変更なし」だけを指定してください");
        }
        if (/変更されていない|変更されてません|変更はない|変更がない|変更なし|未変更/.test(step.overview)) {
          fail(`${stepLocation}.overview`, "未変更ステップの概説では変更有無を繰り返さず、処理の役割だけを説明してください");
        }
        commitContext += 1;
      } else {
        if (step.reason === "変更なし") {
          fail(`${stepLocation}.reason`, "変更ステップには実際の変更理由を指定してください");
        }
        commitChanged += 1;
      }

      step.calls.forEach((call, callIndex) => {
        const callLocation = `${stepLocation}.calls[${callIndex}]`;
        assertObject(call, callLocation);
        assertArray(call.steps, `${callLocation}.steps`);
        pendingFlows.push({ steps: call.steps, depth: flow.depth + 1, location: `${callLocation}.steps` });
      });
    });
  }

  if (commitChanged === 0) {
    fail(commitLocation, "変更コードを含むステップがありません");
  }
  if (commitContext === 0) {
    console.warn(`[確認] ${commit.hash}: 未変更コードのステップがありません。入口から終点まで追加すべき未変更処理がないか確認してください。`);
  }
  totalChanged += commitChanged;
  totalContext += commitContext;
});

console.log(
  `JSON validation passed: ${commits.length} commits, ${totalSteps} tables, ${totalChanged} changed, `
  + `${totalContext} unchanged, depth ${maximumDepth}, ${totalRootSections} root sections `
  + `(${totalFlowSections} flows, ${totalStandaloneSections} standalone)`
);
console.log(`Code location structure passed: ${totalSteps} tables`);

function countCodeLines(code) {
  const normalized = String(code).replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return normalized.split("\n").length;
}

function validateCommitOverview(value, location) {
  requireText(value, location);
}

function validateSpecification(value, location) {
  assertObject(value, location);
  requireText(value.summary, `${location}.summary`);
  const summarySentences = String(value.summary).split("。").filter((sentence) => sentence.trim() !== "");
  if (summarySentences.length < 1 || summarySentences.length > 2) {
    fail(`${location}.summary`, "処理の意味を1〜2文で説明してください");
  }
  if (/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\([^)]*\)/.test(summarySentences[0])) {
    fail(`${location}.summary`, "最初の文ではメソッドの呼び出し順ではなく、処理が持つ意味を説明してください");
  }

  assertArray(value.steps, `${location}.steps`);
  if (value.steps.length < 2) {
    fail(`${location}.steps`, "番号付きで説明する処理手順を2件以上指定してください");
  }
  value.steps.forEach((step, index) => {
    requireText(step, `${location}.steps[${index}]`);
    if (/^\s*\d+[.)．）]\s*/.test(step)) {
      fail(`${location}.steps[${index}]`, "番号はHTMLが付けるため、手順本文へ番号を含めないでください");
    }
  });

  if (value.example !== undefined) {
    requireText(value.example, `${location}.example`);
  }
}

function runExplanationSelfTest() {
  validateCommitOverview(
    "このコミットは注文状態を保存対象へ追加し、後続処理が受付済み注文を識別できるようにする。変更前は状態が保存されず、変更後は注文IDと状態が同じレコードへ保存される。",
    "overview"
  );

  try {
    validateCommitOverview("", "overview");
  } catch {
    console.log("Explanation input self-test passed: non-empty overview, no required introductory phrase");
    return;
  }
  throw new Error("Explanation input self-test failed: 空のコミット概要を検出できませんでした");
}

function runSpecificationSelfTest() {
  const valid = {
    summary: "この処理は、登録結果を利用者へ返す。",
    steps: [
      "ControllerがServiceから登録結果を受け取る。",
      "Controllerが登録結果をHTTPレスポンスへ設定する。"
    ],
    example: "注文ID1001を登録すると、レスポンスが1001を返す。"
  };
  validateSpecification(valid, "specification");

  const withoutExample = structuredClone(valid);
  delete withoutExample.example;
  validateSpecification(withoutExample, "specification");

  expectSpecificationFailure("旧文字列形式", "旧形式の処理仕様");

  const oneStep = structuredClone(valid);
  oneStep.steps = oneStep.steps.slice(0, 1);
  expectSpecificationFailure("手順不足", oneStep);

  const prefixedStep = structuredClone(valid);
  prefixedStep.steps[0] = `1. ${prefixedStep.steps[0]}`;
  expectSpecificationFailure("本文内の重複番号", prefixedStep);

  const emptyExample = structuredClone(valid);
  emptyExample.example = "";
  expectSpecificationFailure("空の具体例", emptyExample);

  console.log("Specification structure self-test passed: summary, numbered steps, optional concrete example without a required introductory phrase, invalid formats");
}

function expectSpecificationFailure(label, value) {
  try {
    validateSpecification(value, "specification");
  } catch {
    return;
  }
  throw new Error(`Specification structure self-test failed: ${label}を検出できませんでした`);
}

function validateRootSectionHeadings(steps, location) {
  const starts = [];
  steps.forEach((step, index) => {
    assertObject(step, `${location}[${index}]`);
    if (index === 0 || step.connectFromPrevious === false) starts.push(index);
  });

  let flows = 0;
  let standalone = 0;
  const startIndexes = new Set(starts);

  starts.forEach((startIndex, sectionIndex) => {
    const endIndex = starts[sectionIndex + 1] ?? steps.length;
    const startStep = steps[startIndex];
    const startLocation = `${location}[${startIndex}]`;
    const sectionSteps = steps.slice(startIndex, endIndex);
    const isFlow = sectionSteps.length > 1 || sectionSteps.some(hasDisplayedCalls);

    requireText(startStep.flowTitle, `${startLocation}.flowTitle`);
    if (isFlow) {
      requireText(startStep.flowDescription, `${startLocation}.flowDescription`);
      flows += 1;
    } else {
      if (startStep.flowDescription !== undefined && String(startStep.flowDescription).trim() !== "") {
        fail(`${startLocation}.flowDescription`, "単独テーブルではflowDescriptionを指定しないでください");
      }
      standalone += 1;
    }
  });

  steps.forEach((step, index) => {
    if (startIndexes.has(index)) return;
    if (step.flowTitle !== undefined) {
      fail(`${location}[${index}].flowTitle`, "flowTitleは第1階層のまとまりを開始するステップだけに指定してください");
    }
    if (step.flowDescription !== undefined) {
      fail(`${location}[${index}].flowDescription`, "flowDescriptionは第1階層のまとまりを開始するステップだけに指定してください");
    }
  });

  return { total: starts.length, flows, standalone };
}

function hasDisplayedCalls(step) {
  return Array.isArray(step.calls)
    && step.calls.some((call) => call && typeof call === "object" && Array.isArray(call.steps) && call.steps.length > 0);
}

function runRootSectionSelfTest() {
  const valid = [
    {
      flowTitle: "注文登録フロー",
      flowDescription: "注文を受け付けてから保存結果を返すまでを示す。",
      calls: [{ steps: [{}] }]
    },
    { calls: [] },
    {
      flowTitle: "ログ設定",
      connectFromPrevious: false,
      calls: []
    }
  ];
  const counts = validateRootSectionHeadings(valid, "steps");
  if (counts.total !== 2 || counts.flows !== 1 || counts.standalone !== 1) {
    throw new Error("Root section self-test failed: フローと単独テーブルを正しく分類できませんでした");
  }

  const missingTitle = structuredClone(valid);
  delete missingTitle[0].flowTitle;
  expectRootSectionFailure("開始タイトルの欠落", missingTitle);

  const missingDescription = structuredClone(valid);
  delete missingDescription[0].flowDescription;
  expectRootSectionFailure("処理フロー説明の欠落", missingDescription);

  const standaloneDescription = structuredClone(valid);
  standaloneDescription[2].flowDescription = "単独テーブルには表示しない説明。";
  expectRootSectionFailure("単独テーブルの不要な説明", standaloneDescription);

  const titleOnContinuation = structuredClone(valid);
  titleOnContinuation[1].flowTitle = "後続テーブルの誤ったタイトル";
  expectRootSectionFailure("後続テーブルのタイトル", titleOnContinuation);

  console.log("Root section self-test passed: flow titles, flow descriptions, standalone titles, section boundaries");
}

function expectRootSectionFailure(label, steps) {
  try {
    validateRootSectionHeadings(steps, "steps");
  } catch {
    return;
  }
  throw new Error(`Root section self-test failed: ${label}を検出できませんでした`);
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

function requireString(value, location) {
  if (typeof value !== "string") fail(location, "文字列が必要です");
}

function requireText(value, location) {
  requireString(value, location);
  if (value.trim() === "") fail(location, "空ではない文字列が必要です");
}

function requireLine(value, location) {
  if (!Number.isInteger(value) || value < 1) fail(location, "1以上の整数が必要です");
}
