// risk-scores.json の検証。採点基準は references/risk-scoring.md に対応する。

import { collectUnits, unitKey } from "./units.mjs";

export const CATEGORIES = [
  "データ保存・更新",
  "認可・個人情報",
  "金額・数量の計算",
  "外部連携・イベント",
  "並行・再実行",
  "失敗時の処理",
  "業務ルール・分岐",
  "入出力の互換性",
  "設定・運用",
  "表示・整形",
  "文脈(変更なし)"
];
export const CONTEXT_CATEGORY = "文脈(変更なし)";
export const UNCHANGED_MAX_SCORE = 2;
export const FLOOR_BY_FINDING = { バグ: 7, 懸念点: 5, 考慮漏れ: 5 };
export const MIN_REASON_LENGTH = 10;
export const MAX_CHECK_POINTS = 3;

export function bandOf(score) {
  if (score >= 9) return { id: "critical", label: "最優先" };
  if (score >= 6) return { id: "high", label: "高" };
  if (score >= 3) return { id: "mid", label: "中" };
  return { id: "low", label: "低" };
}

export function validateRiskScores(reviewData, scores) {
  const errors = [];
  const fail = (message) => errors.push(message);

  let collected;
  try {
    collected = collectUnits(reviewData);
  } catch (error) {
    return { errors: [error.message], units: [], scoreByKey: new Map() };
  }
  const { commits, units } = collected;

  const hashes = commits.map((commit) => commit.hash);
  const duplicatedHash = hashes.find((hash, index) => hashes.indexOf(hash) !== index);
  if (duplicatedHash !== undefined) fail(`コミットのhashが重複している: ${duplicatedHash}`);

  const stepIdsSeen = new Set();
  for (const unit of units) {
    const key = unitKey(unit);
    if (stepIdsSeen.has(key)) fail(`ステップidが同じコミット内で重複している: ${unit.stepId}`);
    stepIdsSeen.add(key);
  }

  if (scores === null || typeof scores !== "object" || Array.isArray(scores)) {
    return { errors: [...errors, "risk-scores.json がオブジェクトではない"], units, scoreByKey: new Map() };
  }
  if (scores.version !== 1) fail("version は 1 でなければならない");
  if (!Array.isArray(scores.units)) {
    return { errors: [...errors, "units が配列ではない"], units, scoreByKey: new Map() };
  }

  const hashToIndex = new Map(hashes.map((hash, index) => [hash, index]));
  const unitByKey = new Map(units.map((unit) => [unitKey(unit), unit]));
  const scoreByKey = new Map();

  scores.units.forEach((entry, index) => {
    const where = `units[${index}]`;
    if (entry === null || typeof entry !== "object") {
      fail(`${where}: オブジェクトではない`);
      return;
    }
    const commitIndex = hashToIndex.get(entry.commit);
    if (commitIndex === undefined) {
      fail(`${where}: commit "${entry.commit}" が review-data.json に存在しない`);
      return;
    }
    const key = `${commitIndex}:${entry.stepId}`;
    const unit = unitByKey.get(key);
    if (unit === undefined) {
      fail(`${where}: stepId "${entry.stepId}" がコミット ${entry.commit} に存在しない`);
      return;
    }
    if (scoreByKey.has(key)) {
      fail(`${where}: ${entry.commit} の ${entry.stepId} が重複している`);
      return;
    }

    const label = `${entry.commit} ${entry.stepId}`;
    let usable = true;

    if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > 10) {
      fail(`${label}: score は 0〜10 の整数でなければならない(値: ${JSON.stringify(entry.score)})`);
      usable = false;
    }
    if (!CATEGORIES.includes(entry.category)) {
      fail(`${label}: category は次のいずれかでなければならない: ${CATEGORIES.join(" / ")}(値: ${JSON.stringify(entry.category)})`);
      usable = false;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < MIN_REASON_LENGTH) {
      fail(`${label}: reason は「人が見ない場合に何が起きるか」を ${MIN_REASON_LENGTH} 文字以上で書く`);
      usable = false;
    }
    const points = entry.checkPoints;
    if (!Array.isArray(points) || points.length > MAX_CHECK_POINTS || points.some((point) => typeof point !== "string" || point.trim() === "")) {
      fail(`${label}: checkPoints は空でない文字列の配列(最大 ${MAX_CHECK_POINTS} 件)でなければならない`);
      usable = false;
    } else if (Number.isInteger(entry.score) && entry.score >= 3 && points.length === 0) {
      fail(`${label}: score が 3 以上のテーブルには、人が確認する点(checkPoints)を1件以上書く`);
      usable = false;
    }
    if (!usable) return;

    // 基準との整合
    if (entry.category === CONTEXT_CATEGORY && unit.changed) {
      fail(`${label}: 変更のあるテーブルの category に「${CONTEXT_CATEGORY}」は使えない`);
    }
    if (entry.category !== CONTEXT_CATEGORY && !unit.changed) {
      fail(`${label}: 変更のないテーブルの category は「${CONTEXT_CATEGORY}」にする`);
    }
    const floor = Math.max(0, ...unit.findings.map((tag) => FLOOR_BY_FINDING[tag]));
    if (floor > 0 && entry.score < floor) {
      fail(`${label}: 備考に [${unit.findings.join("][")}] があるため score は ${floor} 以上にする(値: ${entry.score})`);
    }
    if (!unit.changed && unit.findings.length === 0 && entry.score > UNCHANGED_MAX_SCORE) {
      fail(`${label}: 変更のないテーブルで備考に指摘がない場合、score は ${UNCHANGED_MAX_SCORE} 以下にする(値: ${entry.score})`);
    }

    scoreByKey.set(key, entry);
  });

  for (const unit of units) {
    if (!scoreByKey.has(unitKey(unit)) && !errors.some((message) => message.includes(unit.stepId))) {
      fail(`${unit.commitHash} の ${unit.stepId} に採点がない`);
    }
  }
  if (scores.units.length !== units.length) {
    fail(`採点の件数(${scores.units.length})がテーブル数(${units.length})と一致しない`);
  }

  return { errors, units, scoreByKey };
}
