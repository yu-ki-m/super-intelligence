#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve
} from "node:path";
import process from "node:process";

const MODE = "commit-parallel-independent-verification";
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const DISPLAY_COMMIT_PATTERN = /^[0-9a-f]{7,64}$/i;
const MAX_CORRECTION_ROUNDS = 2;

await main();

async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.length === 1 && args[0] === "--self-test") {
      await runSelfTest();
      return;
    }

    if (args.length === 2 && args[0] === "--print-digests") {
      const inputPath = resolve(args[1]);
      const report = await readJson(inputPath);
      printDigests(report);
      return;
    }

    if (args.length !== 1 || args[0].startsWith("--")) {
      throw new Error(
        "Usage: node verify-orchestration.mjs <review-data.json> | "
        + "--print-digests <review-data.json> | --self-test"
      );
    }

    const inputPath = resolve(args[0]);
    const report = await readJson(inputPath);
    const result = await verifyOrchestration(report, inputPath);
    console.log(
      `Orchestration verification passed: ${result.commitCount} commits, `
      + `${result.investigationCount} investigations, `
      + `${result.investigationBatchCount} investigation batches, `
      + `${result.verificationAttemptCount} verification attempts, `
      + `${result.correctionRoundCount} correction rounds, `
      + `${result.artifactCount} evidence artifacts`
    );
  } catch (error) {
    console.error(`Orchestration verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function readJson(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Cannot parse ${path} as JSON: ${error.message}`);
  }
}

async function verifyOrchestration(report, inputPath) {
  const { reportHashes, orchestration, workerCapacity } = validateTopLevel(report);
  const taskIds = new Set();
  const artifactManifestPaths = new Set();
  const artifactRealPaths = new Set();
  const investigationBatchCounts = new Map();
  const verificationBatchCounts = new Map();
  let verificationAttemptCount = 0;
  let correctionRoundCount = 0;

  for (let index = 0; index < orchestration.commits.length; index += 1) {
    const entry = orchestration.commits[index];
    const location = `root.orchestration.commits[${index}]`;
    assertObject(entry, location);

    const source = validateSource(entry, reportHashes[index], location);
    const expectedDigest = digestReviewUnit(report.commits[index], source);

    assertObject(entry.investigation, `${location}.investigation`);
    const investigationArtifact = await validateTaskIdentityAndLoadArtifact(
      entry.investigation,
      `${location}.investigation`,
      inputPath,
      taskIds,
      artifactManifestPaths,
      artifactRealPaths
    );
    const investigationBatch = requireIntegerAtLeast(
      entry.investigation.batch,
      1,
      `${location}.investigation.batch`
    );
    increment(investigationBatchCounts, investigationBatch);
    requireExact(entry.investigation.status, "completed", `${location}.investigation.status`);
    const investigationDigest = requireSha256(
      entry.investigation.reviewUnitSha256,
      `${location}.investigation.reviewUnitSha256`
    ).toLowerCase();
    if (investigationDigest !== expectedDigest) {
      fail(
        `${location}.investigation.reviewUnitSha256`,
        `does not match the comparison plan and root.commits[${index}] (expected ${expectedDigest})`
      );
    }
    validateInvestigationArtifact(
      investigationArtifact,
      entry,
      source,
      investigationDigest,
      `${location}.investigation.artifactPath`
    );

    assertArray(entry.verificationAttempts, `${location}.verificationAttempts`);
    if (entry.verificationAttempts.length === 0) {
      fail(`${location}.verificationAttempts`, "must contain at least one attempt");
    }
    if (entry.verificationAttempts.length > MAX_CORRECTION_ROUNDS + 1) {
      fail(
        `${location}.verificationAttempts`,
        `must contain at most ${MAX_CORRECTION_ROUNDS + 1} attempts`
      );
    }
    verificationAttemptCount += entry.verificationAttempts.length;

    let previousVerificationBatch = 0;
    const verificationDigests = [];
    for (let attemptIndex = 0; attemptIndex < entry.verificationAttempts.length; attemptIndex += 1) {
      const attempt = entry.verificationAttempts[attemptIndex];
      const attemptLocation = `${location}.verificationAttempts[${attemptIndex}]`;
      assertObject(attempt, attemptLocation);
      const verificationArtifact = await validateTaskIdentityAndLoadArtifact(
        attempt,
        attemptLocation,
        inputPath,
        taskIds,
        artifactManifestPaths,
        artifactRealPaths
      );
      const verificationBatch = requireIntegerAtLeast(
        attempt.batch,
        1,
        `${attemptLocation}.batch`
      );
      if (attemptIndex > 0 && verificationBatch <= previousVerificationBatch) {
        fail(
          `${attemptLocation}.batch`,
          "must be greater than the previous attempt batch because retries run after correction"
        );
      }
      previousVerificationBatch = verificationBatch;
      increment(verificationBatchCounts, verificationBatch);

      if (attempt.status !== "failed" && attempt.status !== "passed") {
        fail(`${attemptLocation}.status`, 'must be "failed" or "passed"');
      }
      requireExact(attempt.freshContext, true, `${attemptLocation}.freshContext`);
      const issueCount = requireIntegerAtLeast(attempt.issueCount, 0, `${attemptLocation}.issueCount`);
      const verifiedDigest = requireSha256(
        attempt.verifiedReviewUnitSha256,
        `${attemptLocation}.verifiedReviewUnitSha256`
      ).toLowerCase();
      verificationDigests.push(verifiedDigest);

      const isFinal = attemptIndex === entry.verificationAttempts.length - 1;
      if (isFinal) {
        if (attempt.status !== "passed" || issueCount !== 0) {
          fail(attemptLocation, 'the final attempt must have status "passed" and issueCount 0');
        }
        if (verifiedDigest !== expectedDigest) {
          fail(
            `${attemptLocation}.verifiedReviewUnitSha256`,
            `does not match the comparison plan and root.commits[${index}] (expected ${expectedDigest})`
          );
        }
      } else if (attempt.status !== "failed" || issueCount <= 0) {
        fail(
          attemptLocation,
          'a non-final attempt must have status "failed" and issueCount greater than 0'
        );
      }

      validateVerificationArtifact(
        verificationArtifact,
        entry,
        source,
        attempt,
        verifiedDigest,
        attemptLocation
      );
    }

    for (let attemptIndex = 0; attemptIndex < verificationDigests.length - 1; attemptIndex += 1) {
      if (verificationDigests[attemptIndex] === verificationDigests[attemptIndex + 1]) {
        fail(
          `${location}.verificationAttempts[${attemptIndex + 1}].verifiedReviewUnitSha256`,
          "must differ from the failed previous attempt after correction"
        );
      }
    }

    const correctionRounds = requireIntegerAtLeast(
      entry.correctionRounds,
      0,
      `${location}.correctionRounds`
    );
    if (correctionRounds > MAX_CORRECTION_ROUNDS) {
      fail(
        `${location}.correctionRounds`,
        `must not exceed ${MAX_CORRECTION_ROUNDS}; stop and report unresolved verification`
      );
    }
    if (correctionRounds !== entry.verificationAttempts.length - 1) {
      fail(
        `${location}.correctionRounds`,
        `must equal verificationAttempts.length - 1 (${entry.verificationAttempts.length - 1})`
      );
    }
    correctionRoundCount += correctionRounds;
    requireExact(entry.unresolvedIssues, 0, `${location}.unresolvedIssues`);
  }

  assertPackedInvestigationBatches(
    investigationBatchCounts,
    report.commits.length,
    workerCapacity
  );
  assertBatchCapacity(verificationBatchCounts, workerCapacity, "verification");

  return {
    commitCount: report.commits.length,
    investigationCount: orchestration.commits.length,
    investigationBatchCount: investigationBatchCounts.size,
    verificationAttemptCount,
    correctionRoundCount,
    artifactCount: artifactRealPaths.size
  };
}

function validateTopLevel(report) {
  assertObject(report, "root");
  assertArray(report.commits, "root.commits");
  if (report.commits.length === 0) {
    fail("root.commits", "must contain at least one commit");
  }

  const reportHashes = report.commits.map((commit, index) => {
    const location = `root.commits[${index}]`;
    assertObject(commit, location);
    return requireNonEmptyString(commit.hash, `${location}.hash`);
  });
  assertUnique(reportHashes, "root.commits[].hash");

  const orchestration = report.orchestration;
  assertObject(orchestration, "root.orchestration");
  requireExact(orchestration.version, 1, "root.orchestration.version");
  requireExact(orchestration.mode, MODE, "root.orchestration.mode");
  const workerCapacity = requireIntegerAtLeast(
    orchestration.workerCapacity,
    1,
    "root.orchestration.workerCapacity"
  );

  assertArray(orchestration.requestedCommitOrder, "root.orchestration.requestedCommitOrder");
  const requestedCommitOrder = orchestration.requestedCommitOrder.map((hash, index) => (
    requireNonEmptyString(hash, `root.orchestration.requestedCommitOrder[${index}]`)
  ));
  assertUnique(requestedCommitOrder, "root.orchestration.requestedCommitOrder");
  assertSameOrder(
    requestedCommitOrder,
    reportHashes,
    "root.orchestration.requestedCommitOrder",
    "root.commits[].hash"
  );

  assertArray(orchestration.commits, "root.orchestration.commits");
  if (orchestration.commits.length !== report.commits.length) {
    fail(
      "root.orchestration.commits",
      `must contain ${report.commits.length} entries in report commit order`
    );
  }

  if (report.commits.length > 1 && workerCapacity < 2) {
    fail("root.orchestration.workerCapacity", "must be at least 2 for multiple commits");
  }

  return { reportHashes, orchestration, workerCapacity };
}

function validateSource(entry, reportHash, location) {
  const commitHash = requireNonEmptyString(entry.commitHash, `${location}.commitHash`);
  if (commitHash !== reportHash) {
    fail(`${location}.commitHash`, `must be ${JSON.stringify(reportHash)} to match the report`);
  }

  const sourceKind = requireNonEmptyString(entry.sourceKind, `${location}.sourceKind`);
  const targetRef = requireNonEmptyString(entry.targetRef, `${location}.targetRef`);
  const comparisonBase = requireGitObject(entry.comparisonBase, `${location}.comparisonBase`);

  if (sourceKind === "commit") {
    requireGitObject(targetRef, `${location}.targetRef`);
    if (!DISPLAY_COMMIT_PATTERN.test(commitHash)) {
      fail(`${location}.commitHash`, "must be a hexadecimal commit ID with at least 7 characters");
    }
    if (!targetRef.toLowerCase().startsWith(commitHash.toLowerCase())) {
      fail(`${location}.targetRef`, `must start with display commit ID ${JSON.stringify(commitHash)}`);
    }
    if (entry.initialSnapshotSha256 !== undefined || entry.finalSnapshotSha256 !== undefined) {
      fail(location, "commit sources must not contain working-tree snapshot fields");
    }
    return { sourceKind, targetRef: targetRef.toLowerCase(), comparisonBase };
  }

  if (sourceKind === "working-tree") {
    requireExact(commitHash, "working-tree", `${location}.commitHash`);
    requireExact(targetRef, "WORKING_TREE", `${location}.targetRef`);
    const initialSnapshotSha256 = requireSha256(
      entry.initialSnapshotSha256,
      `${location}.initialSnapshotSha256`
    ).toLowerCase();
    const finalSnapshotSha256 = requireSha256(
      entry.finalSnapshotSha256,
      `${location}.finalSnapshotSha256`
    ).toLowerCase();
    if (initialSnapshotSha256 !== finalSnapshotSha256) {
      fail(
        `${location}.finalSnapshotSha256`,
        "must match initialSnapshotSha256; the working tree changed during investigation"
      );
    }
    return {
      sourceKind,
      targetRef,
      comparisonBase,
      snapshotSha256: finalSnapshotSha256
    };
  }

  fail(`${location}.sourceKind`, 'must be "commit" or "working-tree"');
}

function printDigests(report) {
  const { reportHashes, orchestration } = validateTopLevel(report);
  orchestration.commits.forEach((entry, index) => {
    const location = `root.orchestration.commits[${index}]`;
    assertObject(entry, location);
    const source = validateSource(entry, reportHashes[index], location);
    console.log(`${reportHashes[index]} ${digestReviewUnit(report.commits[index], source)}`);
  });
}

function digestReviewUnit(commit, source) {
  const reviewUnit = {
    sourceKind: source.sourceKind,
    targetRef: source.targetRef,
    comparisonBase: source.comparisonBase,
    commit
  };
  if (source.sourceKind === "working-tree") {
    reviewUnit.snapshotSha256 = source.snapshotSha256;
  }
  const canonicalJson = JSON.stringify(sortKeysRecursively(reviewUnit));
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

function sortKeysRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeysRecursively(value[key])])
    );
  }
  return value;
}

async function validateTaskIdentityAndLoadArtifact(
  task,
  location,
  inputPath,
  taskIds,
  artifactManifestPaths,
  artifactRealPaths
) {
  const taskId = requireNonEmptyString(task.taskId, `${location}.taskId`);
  if (taskIds.has(taskId)) {
    fail(`${location}.taskId`, `duplicate taskId ${JSON.stringify(taskId)}`);
  }
  taskIds.add(taskId);

  const artifactPath = requireNonEmptyString(task.artifactPath, `${location}.artifactPath`);
  if (isAbsolute(artifactPath)) {
    fail(`${location}.artifactPath`, "must be relative to the review-data JSON directory");
  }
  if (extname(artifactPath).toLowerCase() !== ".json") {
    fail(`${location}.artifactPath`, "must name a .json file");
  }

  const inputDirectory = dirname(inputPath);
  const resolvedPath = resolve(inputDirectory, artifactPath);
  if (!isPathInside(inputDirectory, resolvedPath)) {
    fail(`${location}.artifactPath`, "must stay inside the review-data JSON directory");
  }
  if (artifactManifestPaths.has(resolvedPath)) {
    fail(`${location}.artifactPath`, `duplicate artifactPath ${JSON.stringify(artifactPath)}`);
  }
  artifactManifestPaths.add(resolvedPath);

  let stats;
  try {
    stats = await lstat(resolvedPath);
  } catch (error) {
    fail(`${location}.artifactPath`, `cannot read evidence artifact: ${error.message}`);
  }
  if (!stats.isFile()) {
    fail(`${location}.artifactPath`, "must point to an existing regular file, not a directory or symlink");
  }

  let resolvedRealPath;
  try {
    const [inputDirectoryRealPath, artifactRealPath] = await Promise.all([
      realpath(inputDirectory),
      realpath(resolvedPath)
    ]);
    if (!isPathInside(inputDirectoryRealPath, artifactRealPath)) {
      fail(`${location}.artifactPath`, "resolves outside the review-data JSON directory");
    }
    resolvedRealPath = artifactRealPath;
  } catch (error) {
    fail(`${location}.artifactPath`, `cannot resolve evidence artifact: ${error.message}`);
  }
  if (artifactRealPaths.has(resolvedRealPath)) {
    fail(`${location}.artifactPath`, "must resolve to a file not used by another task");
  }
  artifactRealPaths.add(resolvedRealPath);

  return readJson(resolvedPath);
}

function validateInvestigationArtifact(artifact, entry, source, digest, location) {
  assertObject(artifact, location);
  requireExact(artifact.schemaVersion, 1, `${location}.schemaVersion`);
  requireExact(artifact.role, "investigator", `${location}.role`);
  requireExact(artifact.taskId, entry.investigation.taskId, `${location}.taskId`);
  validateArtifactSource(artifact, entry, source, location);
  requireExact(artifact.status, "completed", `${location}.status`);
  requireExact(
    requireSha256(artifact.reviewUnitSha256, `${location}.reviewUnitSha256`).toLowerCase(),
    digest,
    `${location}.reviewUnitSha256`
  );
}

function validateVerificationArtifact(artifact, entry, source, attempt, digest, location) {
  const artifactLocation = `${location}.artifactPath`;
  assertObject(artifact, artifactLocation);
  requireExact(artifact.schemaVersion, 1, `${artifactLocation}.schemaVersion`);
  requireExact(artifact.role, "verifier", `${artifactLocation}.role`);
  requireExact(artifact.taskId, attempt.taskId, `${artifactLocation}.taskId`);
  validateArtifactSource(artifact, entry, source, artifactLocation);
  requireExact(artifact.status, attempt.status, `${artifactLocation}.status`);
  requireExact(artifact.freshContext, true, `${artifactLocation}.freshContext`);
  requireExact(artifact.issueCount, attempt.issueCount, `${artifactLocation}.issueCount`);
  assertArray(artifact.issues, `${artifactLocation}.issues`);
  if (artifact.issues.length !== attempt.issueCount) {
    fail(
      `${artifactLocation}.issues`,
      `must contain exactly ${attempt.issueCount} issue records`
    );
  }
  artifact.issues.forEach((issue, issueIndex) => {
    const issueLocation = `${artifactLocation}.issues[${issueIndex}]`;
    assertObject(issue, issueLocation);
    requireNonEmptyString(issue.stepId, `${issueLocation}.stepId`);
    requireNonEmptyString(issue.evidence, `${issueLocation}.evidence`);
    requireNonEmptyString(issue.requiredCorrection, `${issueLocation}.requiredCorrection`);
  });
  requireExact(
    requireSha256(
      artifact.verifiedReviewUnitSha256,
      `${artifactLocation}.verifiedReviewUnitSha256`
    ).toLowerCase(),
    digest,
    `${artifactLocation}.verifiedReviewUnitSha256`
  );
}

function validateArtifactSource(artifact, entry, source, location) {
  requireExact(artifact.commitHash, entry.commitHash, `${location}.commitHash`);
  requireExact(artifact.sourceKind, source.sourceKind, `${location}.sourceKind`);
  if (source.sourceKind === "commit") {
    requireExact(
      requireGitObject(artifact.targetRef, `${location}.targetRef`),
      source.targetRef,
      `${location}.targetRef`
    );
  } else {
    requireExact(artifact.targetRef, source.targetRef, `${location}.targetRef`);
  }
  requireExact(
    requireGitObject(artifact.comparisonBase, `${location}.comparisonBase`),
    source.comparisonBase,
    `${location}.comparisonBase`
  );
  if (source.sourceKind === "working-tree") {
    requireExact(
      requireSha256(artifact.snapshotSha256, `${location}.snapshotSha256`).toLowerCase(),
      source.snapshotSha256,
      `${location}.snapshotSha256`
    );
  }
}

function assertPackedInvestigationBatches(batchCounts, commitCount, workerCapacity) {
  const expectedBatchCount = Math.ceil(commitCount / workerCapacity);
  if (batchCounts.size !== expectedBatchCount) {
    fail(
      "root.orchestration.commits[].investigation.batch",
      `must use exactly ${expectedBatchCount} packed batch(es) for ${commitCount} commits and capacity ${workerCapacity}`
    );
  }

  for (let batch = 1; batch <= expectedBatchCount; batch += 1) {
    const remainingBeforeBatch = commitCount - ((batch - 1) * workerCapacity);
    const expectedCount = Math.min(workerCapacity, remainingBeforeBatch);
    const actualCount = batchCounts.get(batch) ?? 0;
    if (actualCount !== expectedCount) {
      fail(
        `root.orchestration investigation batch ${batch}`,
        `must contain ${expectedCount} task(s), found ${actualCount}`
      );
    }
  }

  if (commitCount > 1 && ![...batchCounts.values()].some((count) => count >= 2)) {
    fail(
      "root.orchestration.commits[].investigation.batch",
      "multiple commits must include at least two investigations in the same batch"
    );
  }
}

function assertBatchCapacity(batchCounts, workerCapacity, label) {
  for (const [batch, count] of batchCounts) {
    if (count > workerCapacity) {
      fail(
        `root.orchestration ${label} batch ${batch}`,
        `contains ${count} tasks but workerCapacity is ${workerCapacity}`
      );
    }
  }
}

function isPathInside(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function increment(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function assertSameOrder(actual, expected, actualLocation, expectedLocation) {
  if (actual.length !== expected.length) {
    fail(actualLocation, `must contain the same ${expected.length} commits as ${expectedLocation}`);
  }
  actual.forEach((value, index) => {
    if (value !== expected[index]) {
      fail(actualLocation, `order differs at index ${index}: expected ${JSON.stringify(expected[index])}`);
    }
  });
}

function assertUnique(values, location) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      fail(`${location}[${index}]`, `duplicate value ${JSON.stringify(value)}`);
    }
    seen.add(value);
  });
}

function assertObject(value, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(location, "must be an object");
  }
}

function assertArray(value, location) {
  if (!Array.isArray(value)) {
    fail(location, "must be an array");
  }
}

function requireNonEmptyString(value, location) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(location, "must be a non-empty string");
  }
  return value;
}

function requireGitObject(value, location) {
  if (typeof value !== "string" || !GIT_OBJECT_PATTERN.test(value)) {
    fail(location, "must be a complete 40- or 64-character hexadecimal Git object ID");
  }
  return value.toLowerCase();
}

function requireIntegerAtLeast(value, minimum, location) {
  if (!Number.isInteger(value) || value < minimum) {
    fail(location, `must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function requireSha256(value, location) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(location, "must be a 64-character hexadecimal SHA-256 digest");
  }
  return value;
}

function requireExact(actual, expected, location) {
  if (actual !== expected) {
    fail(location, `must be ${JSON.stringify(expected)}`);
  }
  return actual;
}

function fail(location, message) {
  throw new Error(`${location}: ${message}`);
}

async function runSelfTest() {
  const tests = [
    { name: "valid", build: () => makeValidSelfTestReport(2, 2), shouldFail: false },
    { name: "single commit with separate roles", build: () => makeValidSelfTestReport(1, 1), shouldFail: false },
    { name: "valid working tree", build: makeWorkingTreeSelfTestReport, shouldFail: false },
    {
      name: "missing orchestration",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => { delete report.orchestration; },
      shouldFail: true
    },
    {
      name: "same investigation and verification task",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        report.orchestration.commits[0].verificationAttempts[0].taskId =
          report.orchestration.commits[0].investigation.taskId;
      },
      shouldFail: true
    },
    {
      name: "freshContext false",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        report.orchestration.commits[0].verificationAttempts[0].freshContext = false;
      },
      shouldFail: true
    },
    {
      name: "digest mismatch",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        report.orchestration.commits[0].investigation.reviewUnitSha256 = "0".repeat(64);
      },
      shouldFail: true
    },
    {
      name: "comparison base changed after digest",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        report.orchestration.commits[0].comparisonBase = "f".repeat(40);
      },
      shouldFail: true
    },
    {
      name: "incomplete target ref",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        report.orchestration.commits[0].targetRef = report.commits[0].hash;
      },
      shouldFail: true
    },
    {
      name: "working tree drift",
      build: makeWorkingTreeSelfTestReport,
      mutate: (report) => {
        report.orchestration.commits[0].finalSnapshotSha256 = "f".repeat(64);
      },
      shouldFail: true
    },
    {
      name: "final verification failed",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        const attempt = report.orchestration.commits[0].verificationAttempts.at(-1);
        attempt.status = "failed";
        attempt.issueCount = 1;
      },
      shouldFail: true
    },
    {
      name: "non-parallel multiple commits",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        report.orchestration.commits[1].investigation.batch = 2;
      },
      shouldFail: true
    },
    {
      name: "unnecessarily split packed batch",
      build: () => makeValidSelfTestReport(3, 3),
      mutate: (report) => {
        report.orchestration.commits[2].investigation.batch = 2;
      },
      shouldFail: true
    },
    {
      name: "commit order mismatch",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => { report.orchestration.requestedCommitOrder.reverse(); },
      shouldFail: true
    },
    {
      name: "duplicate commit",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => { report.commits[1].hash = report.commits[0].hash; },
      shouldFail: true
    },
    {
      name: "duplicate artifact path",
      build: () => makeValidSelfTestReport(2, 2),
      mutate: (report) => {
        report.orchestration.commits[1].investigation.artifactPath =
          report.orchestration.commits[0].investigation.artifactPath;
      },
      shouldFail: true
    },
    {
      name: "missing artifact",
      build: () => makeValidSelfTestReport(2, 2),
      afterArtifacts: async (report, inputPath) => {
        const artifactPath = resolve(
          dirname(inputPath),
          report.orchestration.commits[0].investigation.artifactPath
        );
        await rm(artifactPath);
      },
      shouldFail: true
    },
    {
      name: "artifact content mismatch",
      build: () => makeValidSelfTestReport(2, 2),
      afterArtifacts: async (report, inputPath) => {
        const artifactPath = resolve(
          dirname(inputPath),
          report.orchestration.commits[0].investigation.artifactPath
        );
        const artifact = await readJson(artifactPath);
        artifact.taskId = "different-task";
        await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      },
      shouldFail: true
    },
    {
      name: "failed verification reused unchanged digest",
      build: () => {
        const report = makeValidSelfTestReport(1, 1);
        const entry = report.orchestration.commits[0];
        const digest = entry.investigation.reviewUnitSha256;
        entry.verificationAttempts = [
          {
            taskId: "verification-failed",
            batch: 1,
            artifactPath: "artifacts/1111111/verification-failed.json",
            status: "failed",
            freshContext: true,
            issueCount: 1,
            verifiedReviewUnitSha256: digest
          },
          {
            taskId: "verification-passed",
            batch: 2,
            artifactPath: "artifacts/1111111/verification-passed.json",
            status: "passed",
            freshContext: true,
            issueCount: 0,
            verifiedReviewUnitSha256: digest
          }
        ];
        entry.correctionRounds = 1;
        return report;
      },
      shouldFail: true
    },
    {
      name: "too many correction rounds",
      build: () => {
        const report = makeValidSelfTestReport(1, 1);
        const entry = report.orchestration.commits[0];
        const finalDigest = entry.investigation.reviewUnitSha256;
        entry.verificationAttempts = ["a", "b", "c", finalDigest].map((digest, index) => ({
          taskId: `verification-correction-${index + 1}`,
          batch: index + 1,
          artifactPath: `artifacts/1111111/verification-correction-${index + 1}.json`,
          status: index === 3 ? "passed" : "failed",
          freshContext: true,
          issueCount: index === 3 ? 0 : 1,
          verifiedReviewUnitSha256: digest.length === 1 ? digest.repeat(64) : digest
        }));
        entry.correctionRounds = 3;
        return report;
      },
      shouldFail: true
    }
  ];

  const temporaryRoot = await mkdtemp(join(tmpdir(), "code-change-flow-orchestration-"));
  let passed = 0;
  try {
    for (let index = 0; index < tests.length; index += 1) {
      const test = tests[index];
      const caseDirectory = join(temporaryRoot, `case-${index + 1}`);
      await mkdir(caseDirectory, { recursive: true });
      const inputPath = join(caseDirectory, "review-data.json");
      const report = test.build();
      if (test.mutate) {
        test.mutate(report);
      }
      await materializeSelfTestArtifacts(report, inputPath);
      if (test.afterArtifacts) {
        await test.afterArtifacts(report, inputPath);
      }

      let error;
      try {
        await verifyOrchestration(report, inputPath);
      } catch (caught) {
        error = caught;
      }

      if (test.shouldFail && !error) {
        throw new Error(`Self-test ${JSON.stringify(test.name)} failed: invalid data was accepted`);
      }
      if (!test.shouldFail && error) {
        throw new Error(`Self-test ${JSON.stringify(test.name)} failed: ${error.message}`);
      }
      passed += 1;
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  console.log(
    `Orchestration self-test passed: ${passed} cases `
    + "(refs, working-tree snapshot, packed parallel batches, independent roles, evidence files, "
    + "review-unit digests, retries, completion)"
  );
}

function makeValidSelfTestReport(commitCount, workerCapacity) {
  const commits = Array.from({ length: commitCount }, (_, index) => {
    const digit = String((index % 9) + 1);
    return {
      hash: digit.repeat(7),
      message: `change ${index + 1}`,
      overview: `overview ${index + 1}`,
      steps: [{ id: `step-${index + 1}`, filePath: `src/File${index + 1}.java` }]
    };
  });

  const entries = commits.map((commit, index) => ({
    commitHash: commit.hash,
    sourceKind: "commit",
    targetRef: String((index % 9) + 1).repeat(40),
    comparisonBase: index === 0 ? "0".repeat(40) : String((index % 9)).repeat(40),
    investigation: {
      taskId: `investigation-${index + 1}`,
      batch: Math.floor(index / workerCapacity) + 1,
      artifactPath: `artifacts/${commit.hash}/investigation.json`,
      status: "completed"
    },
    verificationAttempts: [
      {
        taskId: `verification-${index + 1}`,
        batch: Math.floor(index / workerCapacity) + 1,
        artifactPath: `artifacts/${commit.hash}/verification-1.json`,
        status: "passed",
        freshContext: true,
        issueCount: 0
      }
    ],
    correctionRounds: 0,
    unresolvedIssues: 0
  }));

  entries.forEach((entry, index) => {
    const digest = digestReviewUnit(commits[index], validateSourceForSelfTest(entry));
    entry.investigation.reviewUnitSha256 = digest;
    entry.verificationAttempts[0].verifiedReviewUnitSha256 = digest;
  });

  return {
    title: "self-test report",
    commits,
    orchestration: {
      version: 1,
      mode: MODE,
      workerCapacity,
      requestedCommitOrder: commits.map((commit) => commit.hash),
      commits: entries
    }
  };
}

function makeWorkingTreeSelfTestReport() {
  const commit = {
    hash: "working-tree",
    message: "uncommitted change",
    overview: "working tree overview",
    steps: [{ id: "working-step", filePath: "src/Working.java" }]
  };
  const snapshotSha256 = "a".repeat(64);
  const entry = {
    commitHash: "working-tree",
    sourceKind: "working-tree",
    targetRef: "WORKING_TREE",
    comparisonBase: "1".repeat(40),
    initialSnapshotSha256: snapshotSha256,
    finalSnapshotSha256: snapshotSha256,
    investigation: {
      taskId: "investigation-working-tree",
      batch: 1,
      artifactPath: "artifacts/working-tree/investigation.json",
      status: "completed"
    },
    verificationAttempts: [
      {
        taskId: "verification-working-tree",
        batch: 1,
        artifactPath: "artifacts/working-tree/verification-1.json",
        status: "passed",
        freshContext: true,
        issueCount: 0
      }
    ],
    correctionRounds: 0,
    unresolvedIssues: 0
  };
  const source = validateSourceForSelfTest(entry);
  const digest = digestReviewUnit(commit, source);
  entry.investigation.reviewUnitSha256 = digest;
  entry.verificationAttempts[0].verifiedReviewUnitSha256 = digest;
  return {
    title: "working-tree self-test",
    commits: [commit],
    orchestration: {
      version: 1,
      mode: MODE,
      workerCapacity: 1,
      requestedCommitOrder: ["working-tree"],
      commits: [entry]
    }
  };
}

function validateSourceForSelfTest(entry) {
  if (entry.sourceKind === "working-tree") {
    return {
      sourceKind: entry.sourceKind,
      targetRef: entry.targetRef,
      comparisonBase: entry.comparisonBase,
      snapshotSha256: entry.finalSnapshotSha256
    };
  }
  return {
    sourceKind: entry.sourceKind,
    targetRef: entry.targetRef,
    comparisonBase: entry.comparisonBase
  };
}

async function materializeSelfTestArtifacts(report, inputPath) {
  if (!report.orchestration || !Array.isArray(report.orchestration.commits)) {
    return;
  }
  for (const entry of report.orchestration.commits) {
    if (!entry || !entry.investigation || !Array.isArray(entry.verificationAttempts)) {
      continue;
    }
    await writeSelfTestArtifact(inputPath, entry.investigation.artifactPath, {
      schemaVersion: 1,
      role: "investigator",
      taskId: entry.investigation.taskId,
      commitHash: entry.commitHash,
      sourceKind: entry.sourceKind,
      targetRef: entry.targetRef,
      comparisonBase: entry.comparisonBase,
      ...(entry.sourceKind === "working-tree"
        ? { snapshotSha256: entry.finalSnapshotSha256 }
        : {}),
      status: entry.investigation.status,
      reviewUnitSha256: entry.investigation.reviewUnitSha256
    });
    for (const attempt of entry.verificationAttempts) {
      const issueCount = Number.isInteger(attempt.issueCount) ? attempt.issueCount : 0;
      const issues = Array.from({ length: issueCount }, (_, index) => ({
        stepId: `step-${index + 1}`,
        evidence: `evidence ${index + 1}`,
        requiredCorrection: `correction ${index + 1}`
      }));
      await writeSelfTestArtifact(inputPath, attempt.artifactPath, {
        schemaVersion: 1,
        role: "verifier",
        taskId: attempt.taskId,
        commitHash: entry.commitHash,
        sourceKind: entry.sourceKind,
        targetRef: entry.targetRef,
        comparisonBase: entry.comparisonBase,
        ...(entry.sourceKind === "working-tree"
          ? { snapshotSha256: entry.finalSnapshotSha256 }
          : {}),
        status: attempt.status,
        freshContext: attempt.freshContext,
        issueCount: attempt.issueCount,
        issues,
        verifiedReviewUnitSha256: attempt.verifiedReviewUnitSha256
      });
    }
  }
}

async function writeSelfTestArtifact(inputPath, artifactPath, value) {
  if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
    return;
  }
  const outputPath = resolve(dirname(inputPath), artifactPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
