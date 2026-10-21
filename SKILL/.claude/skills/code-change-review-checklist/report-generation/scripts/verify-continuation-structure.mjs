#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

const [inputPath] = process.argv.slice(2);

if (inputPath === "--self-test") {
  runSelfTest();
  process.exit(0);
}

if (!inputPath) {
  console.error("Usage: node verify-continuation-structure.mjs <review-data.json>");
  process.exit(1);
}

const data = JSON.parse(await readFile(inputPath, "utf8"));
const result = verifyContinuationStructure(data, true);
console.log(
  `Continuation structure passed: ${result.calls} calls, `
  + `${result.connected} connected continuations, ${result.unconnected} without connected continuation`
);

function verifyContinuationStructure(data, printCandidates = false) {
  assertObject(data, "root");
  const commits = data.commits ?? [{ hash: "working-tree", steps: data.steps }];
  assertArray(commits, "commits");

  const totals = { calls: 0, connected: 0, unconnected: 0 };

  commits.forEach((commit, commitIndex) => {
    const commitLocation = `commits[${commitIndex}]`;
    assertObject(commit, commitLocation);
    assertArray(commit.steps, `${commitLocation}.steps`);
    const commitLabel = String(commit.hash ?? commitIndex + 1);
    const pending = [{ steps: commit.steps, depth: 0, location: `${commitLocation}.steps` }];

    while (pending.length > 0) {
      const flow = pending.pop();
      flow.steps.forEach((step, stepIndex) => {
        const stepLocation = `${flow.location}[${stepIndex}]`;
        assertObject(step, stepLocation);
        requireText(step.id, `${stepLocation}.id`);
        requireText(step.filePath, `${stepLocation}.filePath`);
        requireLine(step.startLine, `${stepLocation}.startLine`);
        requireLine(step.endLine, `${stepLocation}.endLine`);
        assertArray(step.calls, `${stepLocation}.calls`);

        const displayedCalls = step.calls
          .map((call, callIndex) => ({ call, callIndex }))
          .filter(({ call }) => call && typeof call === "object" && Array.isArray(call.steps) && call.steps.length > 0);

        if (displayedCalls.length > 0) {
          totals.calls += displayedCalls.length;
          const nextStep = flow.steps[stepIndex + 1];
          const isConnected = nextStep !== undefined
            && !(flow.depth === 0 && nextStep.connectFromPrevious === false);

          if (isConnected) {
            assertObject(nextStep, `${flow.location}[${stepIndex + 1}]`);
            requireText(nextStep.id, `${flow.location}[${stepIndex + 1}].id`);
            requireText(nextStep.filePath, `${flow.location}[${stepIndex + 1}].filePath`);
            requireLine(nextStep.startLine, `${flow.location}[${stepIndex + 1}].startLine`);
            if (nextStep.filePath !== step.filePath) {
              fail(
                `${flow.location}[${stepIndex + 1}].filePath`,
                `呼び出し後の接続テーブル${nextStep.id}は、呼び出し元${step.id}と同じファイルにしてください`
              );
            }
            if (nextStep.startLine <= step.endLine) {
              fail(
                `${flow.location}[${stepIndex + 1}].startLine`,
                `呼び出し後の接続テーブル${nextStep.id}は、呼び出し元${step.id}より後の行を指定してください`
              );
            }
            totals.connected += displayedCalls.length;
            if (printCandidates) {
              displayedCalls.forEach(({ call, callIndex }) => {
                console.log(
                  `[後続処理確認] ${commitLabel}: ${step.id}.calls[${callIndex}] -> ${call.steps[0].id}; `
                  + `${step.id} (${step.filePath}:${step.startLine}-${step.endLine}) -> ${nextStep.id} `
                  + `(${nextStep.filePath}:${nextStep.startLine}-${nextStep.endLine})`
                );
              });
            }
          } else {
            totals.unconnected += displayedCalls.length;
            if (printCandidates) {
              displayedCalls.forEach(({ call, callIndex }) => {
                console.log(
                  `[後続処理確認] ${commitLabel}: ${step.id}.calls[${callIndex}] -> ${call.steps[0].id}; `
                  + `${step.id} (${step.filePath}:${step.startLine}-${step.endLine}) -> 接続された後続テーブルなし`
                );
              });
            }
          }
        }

        step.calls.forEach((call, callIndex) => {
          const callLocation = `${stepLocation}.calls[${callIndex}]`;
          assertObject(call, callLocation);
          assertArray(call.steps, `${callLocation}.steps`);
          if (call.steps.length > 0) {
            pending.push({
              steps: call.steps,
              depth: flow.depth + 1,
              location: `${callLocation}.steps`
            });
          }
        });
      });
    }
  });

  return totals;
}

function runSelfTest() {
  const valid = buildFixture();
  const result = verifyContinuationStructure(valid);
  if (result.calls !== 2 || result.connected !== 1 || result.unconnected !== 1) {
    throw new Error("Self-test failed: 接続された後続処理と後続処理なしを正しく集計できませんでした");
  }

  const wrongFile = structuredClone(valid);
  wrongFile.commits[0].steps[1].filePath = "OtherController.java";
  expectFailure("呼び出し元と異なるファイル", wrongFile);

  const overlappingLines = structuredClone(valid);
  overlappingLines.commits[0].steps[1].startLine = 12;
  expectFailure("呼び出し箇所と重なる後続行", overlappingLines);

  console.log("Continuation structure self-test passed: same-file continuation, line order, unconnected flow");
}

function buildFixture() {
  return {
    commits: [{
      hash: "self-test",
      steps: [
        {
          id: "controller-call",
          filePath: "OrderController.java",
          startLine: 10,
          endLine: 12,
          calls: [{
            steps: [{
              id: "service-call",
              filePath: "OrderService.java",
              startLine: 20,
              endLine: 22,
              calls: [{
                steps: [{
                  id: "repository-save",
                  filePath: "OrderRepository.java",
                  startLine: 30,
                  endLine: 32,
                  calls: []
                }]
              }]
            }]
          }]
        },
        {
          id: "controller-return",
          filePath: "OrderController.java",
          startLine: 14,
          endLine: 15,
          calls: []
        }
      ]
    }]
  };
}

function expectFailure(label, data) {
  try {
    verifyContinuationStructure(data);
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
