// assets/templates/ のテンプレートから、レポートへ差し込む部品(スタイル・バー・パネル・スクリプト)を作る共有モジュール。
// build-checklist-report.mjs(本番)と render-template-catalog.mjs / verify-templates.mjs(見本・検査)が同じ関数を使う。
//
// テンプレートの規則:
//   {{name}}   値をHTMLエスケープして埋め込む
//   {{{name}}} 生のHTMLを埋め込む(呼び出し側でエスケープ済みの断片だけを渡す)
//   *.html は読み込み時に「行頭・行末の空白と改行」を取り除いて1行にする(読みやすさのために改行してよい)。
//   そのため、1つのタグの属性は必ず同じ行に書く。style.css / script.js はそのまま使う。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bandOf } from "./risk-scores.mjs";

export const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "templates");

export const MARKERS = {
  style: ["<!--rc:style-start-->", "<!--rc:style-end-->"],
  panel: ["<!--rc:panel-start-->", "<!--rc:panel-end-->"],
  bar: ["<!--rc:bar-start-->", "<!--rc:bar-end-->"],
  script: ["<!--rc:script-start-->", "<!--rc:script-end-->"]
};

// 各テンプレートが持つプレースホルダー(verify-templates.mjs がテンプレートと一致するか検査する)
export const PLACEHOLDERS = {
  "bar.html": ["key", "score", "bandId", "bandLabel", "category", "reason", "{points}"],
  "points.html": ["{items}"],
  "point-item.html": ["text"],
  "queue-item.html": ["key", "bandId", "score", "category", "location", "commitHash"],
  "panel.html": ["total", "critical", "high", "mid", "low", "{items}"]
};

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrap(kind, body) {
  return `${MARKERS[kind][0]}${body}${MARKERS[kind][1]}`;
}

const cache = new Map();

export function loadTemplate(name) {
  if (!cache.has(name)) {
    const raw = readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
    cache.set(name, name.endsWith(".html") ? raw.replace(/\r\n?/g, "\n").replace(/\s*\n\s*/g, "") : raw.replace(/\r\n?/g, "\n"));
  }
  return cache.get(name);
}

export function render(name, values) {
  const used = new Set();
  const output = loadTemplate(name).replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (match, rawName, textName) => {
    const key = rawName ?? textName;
    if (!Object.hasOwn(values, key)) throw new Error(`${name}: 値 ${key} が渡されていない`);
    used.add(key);
    return rawName !== undefined ? String(values[key]) : escapeHtml(values[key]);
  });
  const unused = Object.keys(values).filter((key) => !used.has(key));
  if (unused.length > 0) throw new Error(`${name}: 使われない値がある: ${unused.join(", ")}`);
  return output;
}

// 元の実装では STYLE は先頭に改行を持つ
export const styleText = () => `\n${loadTemplate("style.css")}`;
export const scriptText = () => `\n${loadTemplate("script.js")}`;

export function buildBar(key, entry) {
  const band = bandOf(entry.score);
  const points = entry.checkPoints.length > 0
    ? render("points.html", { items: entry.checkPoints.map((text) => render("point-item.html", { text })).join("") })
    : "";
  return wrap("bar", render("bar.html", {
    key,
    score: entry.score,
    bandId: band.id,
    bandLabel: band.label,
    category: entry.category,
    reason: entry.reason,
    points
  }));
}

// rows: [{ key, entry, location, commitHash }](表示したい順に並べて渡す)
export function buildPanel(rows) {
  const totals = { critical: 0, high: 0, mid: 0, low: 0 };
  const items = rows.map((row) => {
    const band = bandOf(row.entry.score);
    totals[band.id] += 1;
    return render("queue-item.html", {
      key: row.key,
      bandId: band.id,
      score: row.entry.score,
      category: row.entry.category,
      location: row.location,
      commitHash: row.commitHash
    });
  }).join("");
  return wrap("panel", render("panel.html", { total: rows.length, ...totals, items }));
}
