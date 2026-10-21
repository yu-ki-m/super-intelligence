#!/usr/bin/env node
// guide.json(AIが書いた順路・解説・指摘)を検証し、ガイドのHTML(表紙と注釈付きコードページ)を生成する。
// アンカー(コード片)から行番号を求め、差分の行・全体図の配置・リンクはすべてここで計算する。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  escapeHtml as esc, toPosix, hrefFrom, outputFileFor, baseCss, makeTree, sortTree, renderTree, isLikelyBinary,
  refreshTreePageGuides, sanitizeName,
  OUTPUT_DIR_NAME, GUIDES_DIR_NAME, MANIFEST_NAME, GUIDE_META_NAME, GUIDE_COVER_NAME, TREE_PAGE_NAME,
} from './lib/common.mjs';
import { highlightCode, languageFor } from './lib/highlight.mjs';
import { resolveDiffSpec, collectDiff, readTargetFile, readTargetFiles } from './lib/diff.mjs';
import { readXref, xrefLinks, sourceHash, normalizeSource, XREF_MENU_SCRIPT } from './lib/xref.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const root = path.resolve(opt('--root', process.cwd()));
const outputDir = path.join(root, OUTPUT_DIR_NAME);
const guidesDir = path.join(outputDir, GUIDES_DIR_NAME);
const repoName = path.basename(root);

const DEFAULT_TYPES = {
  explain: { label: '解説', short: '解説', color: '#4daafc', shape: 'square', finding: false },
  bug: { label: '指摘（バグ）', short: 'バグ', color: '#f14c4c', shape: 'circle', finding: true },
  concern: { label: '指摘（懸念）', short: '懸念', color: '#e8913a', shape: 'triangle', finding: true },
  improve: { label: '指摘（改善）', short: '改善', color: '#4ec9b0', shape: 'diamond', finding: true },
};
const SHAPES = new Set(['square', 'circle', 'triangle', 'diamond']);
const KINDS = { entry: '入口', branch: '分岐', call: '呼び出し', process: '処理', data: 'データ', external: '外部連携' };
const NODE_KINDS = { result: '処理の終わり', db: 'DB テーブル', external: '外部連携', other: '' };
const UNKNOWN_TAG = '<span class="tag tag-unk">呼び出し元未確認</span>';
// 順路に無い変更ファイルにも差分を見るページを作る上限。サイドバーで全ファイルの変更箇所を展開して並べる上限。表紙に並べる変更箇所の上限。
const DIFF_PAGE_LIMIT = 200;
const CHANGE_LIST_ALL = 150;
const COVER_CHANGE_LIMIT = 1000;
// ガイドのフォルダーで生成物ではないファイル(再ビルド時に残す)
const KEEP_FILES = new Set(['guide.json', 'guide.brief.md']);

const isStr = v => typeof v === 'string' && v.trim() !== '';
const clip = (s, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);
const circ = n => (n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n) : `(${n})`);
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const paras = s => String(s).trim().split(/\n{2,}/).map(p => `<p>${inline(p).replace(/\n/g, '<br>')}</p>`).join('');
const basename = rel => rel.split('/').pop();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normRel(v) {
  if (typeof v !== 'string') return null;
  const p = toPosix(v.trim()).replace(/^\.\//, '');
  if (!p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').some(s => s === '..' || s === '' || s === '.')) return null;
  return p;
}

// アンカーは1行の部分一致。見つからなければ空白の違いを無視してもう一度探す。
function findAll(lines, needle, fromIndex) {
  const hits = [];
  for (let i = fromIndex; i < lines.length; i++) if (lines[i].includes(needle)) hits.push(i + 1);
  if (hits.length) return hits;
  const n = needle.replace(/\s+/g, ' ').trim();
  if (!n) return hits;
  for (let i = fromIndex; i < lines.length; i++) if (lines[i].replace(/\s+/g, ' ').includes(n)) hits.push(i + 1);
  return hits;
}

function locate(entry, spec, file, where, problems) {
  const { lines } = entry;
  if (!isStr(spec.anchor)) { problems.push(`${where}.anchor: 対象の行にあるコード片を書く`); return null; }
  if (/\n/.test(spec.anchor)) { problems.push(`${where}.anchor: 1行のコード片で書く（範囲は anchorEnd か lines で指定する）`); return null; }
  const hits = findAll(lines, spec.anchor, 0);
  if (!hits.length) { problems.push(`${where}.anchor: "${clip(spec.anchor)}" が ${file} に見つからない`); return null; }
  let line;
  if (spec.occurrence !== undefined) {
    if (!Number.isInteger(spec.occurrence) || spec.occurrence < 1 || spec.occurrence > hits.length) {
      problems.push(`${where}.occurrence: 1〜${hits.length} で指定する（一致した行: ${hits.slice(0, 10).join(', ')}）`);
      return null;
    }
    line = hits[spec.occurrence - 1];
  } else if (hits.length > 1) {
    problems.push(`${where}.anchor: "${clip(spec.anchor)}" が ${file} の ${hits.length} か所に一致する（${hits.slice(0, 10).join(', ')} 行目）。長いコード片にするか、occurrence（何番目か）を指定する`);
    return null;
  } else line = hits[0];
  let end = line;
  if (spec.anchorEnd !== undefined) {
    if (!isStr(spec.anchorEnd) || /\n/.test(spec.anchorEnd)) { problems.push(`${where}.anchorEnd: 1行のコード片で書く`); return null; }
    const endHits = findAll(lines, spec.anchorEnd, line - 1);
    if (!endHits.length) { problems.push(`${where}.anchorEnd: "${clip(spec.anchorEnd)}" が ${line} 行目以降に見つからない`); return null; }
    end = endHits[0];
  } else if (spec.lines !== undefined) {
    if (!Number.isInteger(spec.lines) || spec.lines < 1) { problems.push(`${where}.lines: 1 以上の整数で書く`); return null; }
    end = Math.min(lines.length, line + spec.lines - 1);
  }
  return { line, end };
}

function buildTypes(custom, problems) {
  const types = structuredClone(DEFAULT_TYPES);
  if (custom === undefined || custom === null) return types;
  if (typeof custom !== 'object' || Array.isArray(custom)) { problems.push('noteTypes: オブジェクトで書く'); return types; }
  for (const [key, t] of Object.entries(custom)) {
    const w = `noteTypes.${key}`;
    if (!/^[a-z][a-z0-9-]*$/.test(key)) { problems.push(`${w}: 種類の名前は英小文字・数字・- で書く`); continue; }
    if (!t || typeof t !== 'object') { problems.push(`${w}: オブジェクトで書く`); continue; }
    const prev = types[key] || {};
    const label = t.label ?? prev.label;
    const color = t.color ?? prev.color ?? '#c586c0';
    const shape = t.shape ?? prev.shape ?? 'circle';
    if (!isStr(label)) { problems.push(`${w}.label: 表示名を書く`); continue; }
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) { problems.push(`${w}.color: #rrggbb 形式で書く`); continue; }
    if (!SHAPES.has(shape)) { problems.push(`${w}.shape: ${[...SHAPES].join(' / ')} のどれかにする`); continue; }
    types[key] = { label, short: t.short ?? prev.short ?? label, color, shape, finding: key === 'explain' ? false : (t.finding ?? prev.finding ?? true) };
  }
  return types;
}

const shapeEl = (types, t) => `<span class="mk s-${types[t].shape} t-${t}"></span>`;

function svgShape(shape, cx, cy, cls) {
  if (shape === 'circle') return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="4.5"/>`;
  if (shape === 'square') return `<rect class="${cls}" x="${cx - 4}" y="${cy - 4}" width="8" height="8" rx="1.5"/>`;
  if (shape === 'triangle') return `<polygon class="${cls}" points="${cx - 4.5},${cy + 4} ${cx},${cy - 4.5} ${cx + 4.5},${cy + 4}"/>`;
  return `<rect class="${cls}" x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7" transform="rotate(45 ${cx} ${cy})"/>`;
}

// 表示幅の見積もり(全角は1文字=フォントサイズ、半角は0.62倍)
function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += c >= 0x2e80 || (c >= 0xff00 && c <= 0xffef) ? size : size * 0.62;
  }
  return w;
}

function fitText(s, size, max) {
  if (textWidth(s, size) <= max) return s;
  let out = '';
  for (const ch of String(s)) {
    if (textWidth(`${out}${ch}…`, size) > max) break;
    out += ch;
  }
  return `${out}…`;
}

// 差分のハンクを、間が2行以内のものどうしまとめて「変更箇所」にする。位置は新しい版の行番号で、
// 削除行はそれを表示する位置(直前に置く行の番号 − 0.5)で表す。lo / hi はその箇所の最初と最後の位置。
function changeBlocks(fd) {
  const blocks = [];
  for (const h of [...fd.hunks].sort((a, b) => a.newStart - b.newStart)) {
    const lo = h.newLines ? h.newStart - (h.oldLines ? 0.5 : 0) : h.newStart + 0.5;
    const hi = h.newLines ? h.newStart + h.newLines - 1 : lo;
    const last = blocks.at(-1);
    if (last && lo <= last.hi + 3) { last.hi = Math.max(last.hi, hi); last.plus += h.newLines; last.minus += h.oldLines; }
    else blocks.push({ lo, hi, plus: h.newLines, minus: h.oldLines });
  }
  return blocks;
}

// 変更前と変更後の1行を単語単位で比べ、変わった部分の範囲(文字の位置)を返す。
// 共通部分が少ない(別の行に置き換えた)場合は null にし、行全体の色だけで示す。
function wordDiff(a, b) {
  const tok = s => s.match(/[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/gu) || [];
  const x = tok(a); const y = tok(b);
  if (!x.length || !y.length || x.length * y.length > 250000) return null;
  const m = x.length; const n = y.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ra = []; const rb = [];
  const push = (r, s, e) => { const last = r.at(-1); if (last && last[1] === s) last[1] = e; else r.push([s, e]); };
  let i = 0; let j = 0; let pa = 0; let pb = 0; let same = 0;
  while (i < m || j < n) {
    if (i < m && j < n && x[i] === y[j]) { if (x[i].trim()) same += x[i].length; pa += x[i].length; pb += y[j].length; i++; j++; }
    else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) { push(rb, pb, pb + y[j].length); pb += y[j].length; j++; }
    else { push(ra, pa, pa + x[i].length); pa += x[i].length; i++; }
  }
  const total = Math.max(a.trim().length, b.trim().length);
  if (!total || same / total < 0.4) return null;
  return { a: ra, b: rb };
}

// ハイライト済みの1行のHTMLに、文字の範囲を <span class="wd"> で重ねる。
// タグの中には入れず、タグをまたぐ範囲はタグの前後で分けて包む(入れ子が崩れない)。
function markRanges(html, ranges) {
  if (!ranges || !ranges.length) return html;
  let out = ''; let pos = 0; let r = 0; let open = false;
  for (let i = 0; i < html.length;) {
    if (html[i] === '<') {
      const j = html.indexOf('>', i);
      const end = j < 0 ? html.length : j + 1;
      if (open) { out += '</span>'; open = false; }
      out += html.slice(i, end); i = end; continue;
    }
    let len = 1;
    if (html[i] === '&') { const j = html.indexOf(';', i); if (j > i && j - i <= 8) len = j - i + 1; }
    while (r < ranges.length && ranges[r][1] <= pos) r++;
    const want = r < ranges.length && ranges[r][0] <= pos;
    if (want && !open) { out += '<span class="wd">'; open = true; }
    else if (!want && open) { out += '</span>'; open = false; }
    out += html.slice(i, i + len); i += len; pos++;
  }
  return open ? `${out}</span>` : out;
}

// 一覧に見せる1行。前後の空白を除き、focus(変わった部分の先頭の位置)が見えるように max 文字に切って、変わった部分を <span class="wd"> で示す。
function snippet(text, ranges, focus = 0, max = 72) {
  const lead = text.length - text.trimStart().length;
  const t = text.trim();
  const rs = (ranges || []).map(([a, b]) => [a - lead, b - lead]).filter(([, b]) => b > 0);
  const from = t.length <= max ? 0 : Math.max(0, Math.min(focus - lead - 20, t.length - max));
  const piece = t.slice(from, from + max);
  const local = rs.map(([a, b]) => [Math.max(0, a - from), Math.min(piece.length, b - from)]).filter(([a, b]) => b > a);
  return `${from > 0 ? '…' : ''}${markRanges(esc(piece), local)}${from + max < t.length ? '…' : ''}`;
}

// ブラウザで動く処理。各ページに直接埋め込む(共通ファイルは読み込まない)。
// リンクの #… の後ろに @rN があれば、そのルートで読む。無ければ、前に選んだルート(そのステップを通る場合)か、そのステップを通る最初のルートにする。
// 解説・指摘は閉じた状態で始め、行番号の横の番号(ステップ)と印(指摘)のボタンでだけ開閉する。サイドバーやキーで移っても開かない。
function guideRuntime(G) {
  const $ = id => document.getElementById(id);
  const stepById = new Map(G.steps.map(s => [s.id, s]));
  const routeById = new Map(G.routes.map(r => [r.id, r]));
  const findingById = new Map(G.findings.map(f => [f.id, f]));
  const changeById = new Map(G.changes.map(c => [c.id, c]));
  let store = null;
  try { store = window.localStorage; } catch (e) { store = null; }
  const load = (key, fallback) => { try { const v = store && store.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
  const save = (key, value) => { try { if (store) store.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない環境では保持しない */ } };
  const hidden = new Set(load('cbg-hidden-types', []));
  const routeKey = 'cbg-route:' + G.guide;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const circ = n => (n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n) : '(' + n + ')');
  const multi = G.routes.length > 1;
  const open = new Set();
  let route = null;
  let lastFindingType = null;

  const rname = r => (r.unknown ? '呼び出し元が未確認' : 'ルート' + r.no);
  const hrefIn = (r, id) => stepById.get(id).href + '@' + r.id;
  // ルートの中での呼び出し元: 自分より前にある parent。無ければ、自分へ分岐している前のステップ。
  const callerIn = (r, id) => {
    const k = r.steps.indexOf(id);
    const before = r.steps.slice(0, k);
    return stepById.get(id).parents.find(p => before.includes(p)) || before.slice().reverse().find(q => stepById.get(q).to.includes(id)) || null;
  };
  const through = id => {
    const direct = G.routes.filter(r => r.steps.includes(id));
    const via = G.routes.filter(r => !r.steps.includes(id) && r.cont.some(c => routeById.get(c.route).steps.includes(id)));
    return { direct, via };
  };
  const viaNos = (r, id) => [...new Set(r.cont.map(c => routeById.get(c.route)).filter(x => x.steps.includes(id)).map(x => x.no))];

  function applyFilters() {
    for (const t of G.types) {
      document.body.classList.toggle('hide-' + t, hidden.has(t));
      const chip = document.querySelector('.chip[data-type="' + t + '"]');
      if (chip) chip.setAttribute('aria-pressed', String(!hidden.has(t)));
    }
  }
  function setTab(tab) {
    const panes = { findings: ['g-findings', 'g-nav-findings'], changes: ['g-changes', 'g-nav-changes'] };
    if (!panes[tab] || !$(panes[tab][0])) tab = $('g-findings') ? 'findings' : 'changes';
    document.querySelectorAll('[data-ptab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ptab === tab)));
    Object.keys(panes).forEach(t => panes[t].forEach(id => {
      const el = $(id);
      if (el) el.hidden = t !== tab;
    }));
    save('cbg-tab', tab);
  }
  function parseHash() {
    const raw = decodeURIComponent(location.hash.slice(1));
    const at = raw.lastIndexOf('@');
    return at >= 0 ? { h: raw.slice(0, at), r: raw.slice(at + 1) } : { h: raw, r: '' };
  }
  function current() {
    const { h, r } = parseHash();
    const hashRoute = routeById.get(r) || null;
    const f = findingById.get(h);
    if (f) return { step: f.step ? stepById.get(f.step) : null, finding: f, hashRoute };
    // 変更箇所(#chg-k)で開いたときは、その変更箇所と重なるステップ(最も狭いもの)を現在地にする
    const c = changeById.get(h);
    if (c) {
      const inner = G.steps.filter(x => x.file === G.page && c.lo <= x.end && c.hi >= x.line - 0.5).sort((a, b) => (a.end - a.line) - (b.end - b.line))[0];
      return { step: inner || null, change: c, hashRoute };
    }
    const s = G.steps.find(x => x.anchor === h);
    if (s) return { step: s, hashRoute };
    // 定義リンク(#L行番号)で開いたときは、その行を含むステップ(最も狭いもの)を現在地にする
    const m = /^L(\d+)$/.exec(h);
    if (m) {
      const line = Number(m[1]);
      const inner = G.steps.filter(x => x.file === G.page && x.line <= line && line <= x.end).sort((a, b) => (a.end - a.line) - (b.end - b.line))[0];
      return { step: inner || null, line, hashRoute };
    }
    return { step: G.firstStep ? stepById.get(G.firstStep) : null, hashRoute };
  }
  function pickRoute(step, hashRoute) {
    if (hashRoute) return hashRoute;
    const saved = routeById.get(load(routeKey, ''));
    if (saved && (!step || saved.steps.includes(step.id))) return saved;
    return (step && G.routes.find(r => r.steps.includes(step.id))) || saved || G.routes[0] || null;
  }
  // ルートを切り替える。ページは移らず、今のステップのまま。
  function setRoute(rid) {
    const { h } = parseHash();
    save(routeKey, rid);
    try { history.replaceState(null, '', '#' + h + '@' + rid); update(false); }
    catch (e) { location.hash = h + '@' + rid; }
  }
  function setNav(id, href) {
    const a = $(id);
    if (!a) return;
    if (href) { a.setAttribute('href', href); a.removeAttribute('aria-disabled'); }
    else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); }
  }
  // 削除行は直前に置く行と同じ番号を持つので、1つの番号に複数の行がある
  function rows(from, to) {
    const out = [];
    for (let n = from; n <= to; n++) document.querySelectorAll('tr.row[data-line="' + n + '"]').forEach(r => out.push(r));
    return out;
  }
  function applyNotes(markId) {
    document.querySelectorAll('tr[data-note]').forEach(tr => { tr.hidden = !open.has(tr.dataset.note); });
    document.querySelectorAll('[data-toggle-note]').forEach(b => {
      b.setAttribute('aria-expanded', String(open.has(b.dataset.toggleNote)));
      b.classList.toggle('sel', b.dataset.toggleNote === markId);
    });
  }
  function ensureVisible(el) {
    const editor = document.querySelector('.editor');
    if (!el || !editor) return;
    const er = editor.getBoundingClientRect(); const r = el.getBoundingClientRect();
    if (r.bottom > er.bottom) editor.scrollTop += Math.min(r.bottom - er.bottom + 12, r.top - er.top - 12);
    else if (r.top < er.top) editor.scrollTop += r.top - er.top - 12;
  }
  // 番号・印のボタン: 解説・指摘を開閉する。番号ならそのステップを現在地にもする(スクロールはしない)。
  function toggleNote(key) {
    if (open.has(key)) open.delete(key); else open.add(key);
    const s = G.steps.find(x => x.anchor === key);
    if (s) {
      const keep = route && route.steps.includes(s.id) ? '@' + route.id : '';
      try { history.replaceState(null, '', '#' + key + keep); } catch (e) { /* 書き換えられない環境では現在地を変えない */ }
      update(false);
    } else applyNotes(current().finding ? current().finding.id : null);
    if (open.has(key)) ensureVisible($(key));
  }

  function renderRoutes(step) {
    const box = $('g-routes');
    if (!box) return;
    const q = (($('g-rfilter') || {}).value || '').trim().toLowerCase();
    const th = step ? through(step.id) : { direct: [], via: [] };
    let h = ''; let group = null;
    for (const r of G.routes) {
      if (q && !(rname(r) + ' ' + r.title).toLowerCase().includes(q)) continue;
      if (r.group && r.group !== group) { h += '<div class="rg">' + esc(r.group) + '</div>'; group = r.group; }
      const d = th.direct.includes(r); const v = th.via.includes(r);
      const pass = !step || !multi ? '' : d ? '<span class="pass yes">● 通る</span>' : v ? '<span class="pass">ルート' + viaNos(r, step.id).join('・') + ' 経由</span>' : '<span class="pass">通らない</span>';
      h += '<button type="button" class="ri' + (step && multi && !d && !v ? ' far' : '') + '" data-route="' + r.id + '" aria-pressed="' + (r === route) + '" title="' + esc(rname(r) + ': ' + r.title) + '"><span class="rn">' + (r.unknown ? '?' : r.no) + '</span><span class="rtt">' + esc(r.title) + '</span>' + pass + '</button>';
    }
    box.innerHTML = h || '<div class="empty">一致するルートが無い</div>';
  }
  function renderStack(step) {
    const box = $('g-stack');
    $('g-stack-h').textContent = route ? 'コールスタック（' + rname(route) + '）' : 'コールスタック';
    if (!route) { box.innerHTML = '<div class="empty">ルートが無い</div>'; return; }
    const first = stepById.get(route.steps[0]);
    if (!step) { box.innerHTML = '<div class="empty">このページには順路のステップが無い。<a href="' + esc(hrefIn(route, first.id)) + '">' + circ(first.n) + ' ' + esc(first.title) + ' から読む</a></div>'; return; }
    if (!route.steps.includes(step.id)) { box.innerHTML = '<div class="empty">' + esc(rname(route)) + ' はこのステップ（' + circ(step.n) + '）を通らない。<a href="' + esc(hrefIn(route, first.id)) + '">' + circ(first.n) + ' ' + esc(first.title) + ' から読む</a></div>'; return; }
    const chain = [];
    for (let id = step.id; id && chain.length < 60 && !chain.includes(id); id = callerIn(route, id)) chain.unshift(id);
    const top = stepById.get(chain[0]).unknown ? 1 : 0;
    const pad = d => ' style="padding-left:' + (6 + d * 14) + 'px"';
    let h = top ? '<div class="stk unk"' + pad(0) + '>？ 呼び出し元が未確認</div>' : '';
    chain.forEach((id, k) => {
      const s = stepById.get(id); const d = k + top;
      h += '<a class="stk' + (s === step ? ' now' : '') + '" href="' + esc(hrefIn(route, id)) + '"' + pad(d) + '>' + (d ? '└ ' : '') + esc(s.title) + (s === step ? '<em>現在地</em>' : '') + '</a>';
    });
    box.innerHTML = h;
  }
  function renderSteps(step) {
    const box = $('g-steps');
    if (!route) { box.innerHTML = ''; return; }
    $('g-steps-h').textContent = '順路（' + (multi ? rname(route) + '・' : '') + route.steps.length + ' ステップ）';
    let h = '';
    route.steps.forEach((id, k) => {
      const s = stepById.get(id);
      h += '<a class="step-i' + (s === step ? ' on' : '') + '" data-id="' + s.id + '" href="' + esc(hrefIn(route, id)) + '"><span class="pos">' + (k + 1) + '</span><span class="badge' + (s.diff ? ' d' : '') + (s === step ? ' on' : '') + '" data-step="' + s.id + '">' + s.n + '</span><span class="step-t">' + esc(s.title) + s.tags + '</span><span class="step-f">' + esc(s.loc) + '</span></a>';
      for (const e of s.ends) h += '<div class="end-i">└ ' + esc(e.when) + ' → ' + esc(e.then) + '</div>';
      for (const c of route.cont.filter(x => x.from === id)) {
        const r2 = routeById.get(c.route);
        h += '<div class="end-i">└ ' + (c.when ? esc(c.when) + ' → ' : '') + '<a href="' + esc(hrefIn(r2, r2.steps[0])) + '">' + esc(rname(r2) + ' ' + r2.title) + '</a> へ続く</div>';
      }
    });
    if (route.end) h += '<div class="end-i fin">■ ' + esc(route.end) + '</div>';
    box.innerHTML = h;
  }
  function update(scroll) {
    const cur = current();
    const { step, finding, line, change } = cur;
    route = pickRoute(step, cur.hashRoute);
    if (route) save(routeKey, route.id);
    document.querySelectorAll('tr.cur').forEach(r => r.classList.remove('cur'));
    document.querySelectorAll('tr.csel').forEach(r => r.classList.remove('csel'));
    if (change) document.querySelectorAll('tr[data-chg="' + change.k + '"]').forEach(r => r.classList.add('csel'));
    document.querySelectorAll('tr.fsel').forEach(r => { r.classList.remove('fsel'); if (lastFindingType) r.classList.remove('t-' + lastFindingType); });
    if (step && step.file === G.page) rows(step.line, step.end).forEach(r => r.classList.add('cur'));
    if (finding && finding.file === G.page) {
      rows(finding.line, finding.end).forEach(r => r.classList.add('fsel', 't-' + finding.type));
      lastFindingType = finding.type;
    }
    applyNotes(finding ? finding.id : null);
    document.querySelectorAll('.note.is-cur, .note.sel').forEach(n => n.classList.remove('is-cur', 'sel'));
    if (step && $(step.anchor)) $(step.anchor).classList.add('is-cur');
    if (finding && $(finding.id)) $(finding.id).classList.add('sel');
    document.querySelectorAll('.badge.on').forEach(b => b.classList.remove('on'));
    if (step) document.querySelectorAll('.badge[data-step="' + step.id + '"]').forEach(b => b.classList.add('on'));
    document.querySelectorAll('.plist a.on').forEach(a => a.classList.remove('on'));
    const findingItem = finding && document.querySelector('#g-findings a[data-id="' + finding.id + '"]');
    if (findingItem) findingItem.classList.add('on');
    const changeItem = change && document.querySelector('#g-changes a[data-id="' + change.id + '"]');
    if (changeItem) changeItem.classList.add('on');
    renderRoutes(step);
    renderStack(step);
    renderSteps(step);
    // 前へ・次へ・呼び出し元は、選んでいるルートの中で動く。ルートが通らないステップでは「次へ」でルートの最初へ。
    const k = route && step ? route.steps.indexOf(step.id) : -1;
    const up = k > 0 ? callerIn(route, step.id) : null;
    setNav('g-prev', k > 0 ? hrefIn(route, route.steps[k - 1]) : null);
    setNav('g-next', !route ? null : k < 0 ? hrefIn(route, route.steps[0]) : k < route.steps.length - 1 ? hrefIn(route, route.steps[k + 1]) : null);
    setNav('g-up', up ? hrefIn(route, up) : null);
    const rpos = $('g-rpos');
    if (rpos) rpos.textContent = !route ? '' : k >= 0 ? (multi ? rname(route) + ' の ' : '') + (k + 1) + ' / ' + route.steps.length : step ? rname(route) + ' はこのステップを通らない（「次へ」でルートの最初へ）' : '';
    // 解説の中の「ルートN の k / M」と「このステップを通るルート」
    document.querySelectorAll('[data-pos]').forEach(el => {
      const id = el.dataset.pos;
      const r = route && route.steps.includes(id) ? route : G.routes.find(x => x.steps.includes(id));
      el.textContent = r ? (multi ? rname(r) + ' の ' : 'ステップ ') + (r.steps.indexOf(id) + 1) + ' / ' + r.steps.length : '';
    });
    document.querySelectorAll('[data-via]').forEach(el => {
      const id = el.dataset.via; const th = through(id); const s = stepById.get(id);
      const shortTitle = r => r.title.replace(/（[^）]*）$/, '');
      el.innerHTML = th.direct.map(r => '<a class="rt' + (r === route ? ' now' : '') + (r.unknown ? ' unk' : '') + '" href="' + esc(hrefIn(r, s.id)) + '">' + esc(rname(r) + ' ' + shortTitle(r) + '・' + (r.steps.indexOf(id) + 1) + ' 番目') + '</a>').join('')
        + th.via.map(r => '<a class="rt via' + (r === route ? ' now' : '') + '" href="' + esc(hrefIn(r, r.steps[0])) + '">' + esc(rname(r) + ' ' + shortTitle(r) + '（ルート' + viaNos(r, id).join('・') + ' 経由）') + '</a>').join('');
    });
    const visible = G.findings.filter(f => !hidden.has(f.type));
    const p = finding ? visible.indexOf(finding) : -1;
    setNav('g-pf', p > 0 ? visible[p - 1].href : null);
    setNav('g-nf', p + 1 < visible.length ? visible[p + 1].href : null);
    // 次・前の変更: 変更箇所を開いているならその前後。そうでなければ、今のステップ(または行)の位置から前後を探す。
    const cs = G.changes;
    let nextC = null;
    let prevC = null;
    if (change) { const ci = cs.indexOf(change); prevC = cs[ci - 1]; nextC = cs[ci + 1]; }
    else {
      const y = line || (step && step.file === G.page ? step.line : 0);
      const after = c => c.r > G.pageRank || (c.r === G.pageRank && c.hi >= y);
      nextC = cs.find(after);
      for (const c of cs) if (!after(c)) prevC = c;
    }
    setNav('g-pc', prevC ? prevC.href : null);
    setNav('g-nc', nextC ? nextC.href : null);
    const rs = $('g-route-s');
    if (rs) rs.textContent = route && multi ? rname(route) + ': ' + route.title : '';
    const pos = $('g-pos');
    if (pos) pos.textContent = step ? circ(step.n) + (k >= 0 ? '（' + (k + 1) + ' / ' + route.steps.length + '）' : '') : '–';
    if (scroll) {
      const target = line || (finding && finding.file === G.page ? finding.line : step && step.file === G.page ? step.line : null);
      const editor = document.querySelector('.editor');
      const row = change && $(change.id) ? $(change.id).closest('tr') : target ? document.querySelector('tr.row[data-line="' + target + '"]') : null;
      if (editor && row) editor.scrollTop += row.getBoundingClientRect().top - editor.getBoundingClientRect().top - 42;
    }
  }
  document.addEventListener('click', e => {
    const chip = e.target.closest('.chip[data-type]');
    if (chip) {
      const t = chip.dataset.type;
      if (hidden.has(t)) hidden.delete(t); else hidden.add(t);
      save('cbg-hidden-types', [...hidden]);
      applyFilters();
      update(false);
      return;
    }
    const tab = e.target.closest('[data-ptab]');
    if (tab) { setTab(tab.dataset.ptab); return; }
    const toggle = e.target.closest('[data-toggle-note]');
    if (toggle) { e.preventDefault(); toggleNote(toggle.dataset.toggleNote); return; }
    const close = e.target.closest('[data-close-note]');
    if (close) { e.preventDefault(); open.delete(close.dataset.closeNote); applyNotes(current().finding ? current().finding.id : null); return; }
    const all = e.target.closest('[data-notes]');
    if (all) {
      if (all.dataset.notes === 'open') document.querySelectorAll('tr[data-note]').forEach(tr => open.add(tr.dataset.note));
      else open.clear();
      applyNotes(current().finding ? current().finding.id : null);
      return;
    }
    const ri = e.target.closest('[data-route]');
    if (ri) { setRoute(ri.dataset.route); return; }
    // 一覧の項目の中にあるルートの札は、その場でルートを切り替える(項目のリンクには移らない)
    const rg = e.target.closest('[data-route-go]');
    if (rg) { e.preventDefault(); setRoute(rg.dataset.routeGo); }
  });
  const rf = $('g-rfilter');
  if (rf) rf.addEventListener('input', () => renderRoutes(current().step));
  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const follow = id => {
      const a = $(id);
      if (a && a.getAttribute('href')) { location.href = a.href; return true; }
      return false;
    };
    if (e.key === 'n' && follow('g-next')) e.preventDefault();
    else if (e.key === 'p' && follow('g-prev')) e.preventDefault();
    else if ((e.key === 'r' || e.key === 'R') && multi && route) {
      e.preventDefault();
      const i = G.routes.indexOf(route);
      setRoute(G.routes[(i + (e.key === 'R' ? G.routes.length - 1 : 1)) % G.routes.length].id);
    }
    else if (e.key === 'F8' && $('g-findings')) { e.preventDefault(); setTab('findings'); follow(e.shiftKey ? 'g-pf' : 'g-nf'); }
    else if ((e.key === ']' || e.key === '[') && $('g-changes')) { e.preventDefault(); setTab('changes'); follow(e.key === '[' ? 'g-pc' : 'g-nc'); }
  });
  window.addEventListener('hashchange', () => update(true));
  // 読み込み完了後にもう一度合わせ、ブラウザ自身の #id へのスクロールより後で対象行を表示する
  window.addEventListener('load', () => update(true));
  applyFilters();
  if ($('g-findings') || $('g-changes')) setTab(load('cbg-tab', 'findings'));
  update(true);
}

// 表紙で動く処理: 全体図でルートを選ぶと、そのルートの流れを強調し、続く先のルートは半分、ほかは薄くする。
// ルート一覧の番号にマウスを乗せると、同じステップの番号をほかのルートでも強調する。
function coverRuntime(D) {
  const flow = document.getElementById('flow');
  const nodes = flow ? [...flow.querySelectorAll('[data-n]')] : [];
  const edges = flow ? [...flow.querySelectorAll('[data-ef]')] : [];
  const isStep = new Set(D.steps);
  // ステップから出る矢印の先にある、ステップ以外のノード(処理の終わり・DB テーブルなど)も同じルートに含める
  const grow = ids => {
    const set = new Set(ids);
    for (let changed = true; changed;) {
      changed = false;
      for (const e of edges) if (set.has(e.dataset.ef) && !isStep.has(e.dataset.et) && !set.has(e.dataset.et)) { set.add(e.dataset.et); changed = true; }
    }
    return set;
  };
  function select(rid) {
    document.querySelectorAll('[data-rsel]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.rsel === rid)));
    const r = D.routes.find(x => x.id === rid);
    const own = r ? grow(r.steps) : new Set();
    const entries = new Set(r ? r.cont.map(c => c.entry) : []);
    const cont = r ? grow(r.cont.flatMap(c => D.routes.find(x => x.id === c.route).steps)) : new Set();
    const mark = (el, on, co) => { el.classList.remove('on', 'cont', 'off'); if (r) el.classList.add(on ? 'on' : co ? 'cont' : 'off'); };
    nodes.forEach(el => mark(el, own.has(el.dataset.n), cont.has(el.dataset.n)));
    edges.forEach(el => mark(el, own.has(el.dataset.ef) && (own.has(el.dataset.et) || entries.has(el.dataset.et)), cont.has(el.dataset.ef) && cont.has(el.dataset.et)));
  }
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-rsel]');
    if (c) select(c.dataset.rsel);
  });
  document.addEventListener('mouseover', e => {
    const b = e.target.closest('.chain .badge');
    document.querySelectorAll('.chain .badge.hot').forEach(x => x.classList.remove('hot'));
    if (b) document.querySelectorAll('.chain .badge[data-s="' + b.dataset.s + '"]').forEach(x => x.classList.add('hot'));
  });
}

function guideCss(types) {
  let css = `
[hidden]{display:none!important}
:root{--panel:#252526;--hover:#2a2d2e;--line2:#3a3a3a;--accent:#0078d4;--hl:rgba(77,170,252,.12);--add:#81b88b;--add-bg:rgba(46,160,67,.17);--add-wd:rgba(46,160,67,.5);--mod:#e2c08d;--del:#f14c4c;--del-bg:rgba(248,81,73,.15);--del-wd:rgba(248,81,73,.5);--branch:#c586c0;--warn:#d7ba7d;--edge:#707070;--chip:#3a3d41;--btn:#2d2d30;--btn-border:#3c3c3c;--codebg:#1a1a1a;--dbfill:#1d2826;--ui:Segoe UI,system-ui,-apple-system,sans-serif;--mono:Consolas,'Cascadia Code','SFMono-Regular',monospace}
.mk{display:inline-block;width:9px;height:9px;flex:none;background:var(--c)}.mk.s-square{border-radius:2px}.mk.s-circle{border-radius:50%}.mk.s-triangle{width:10px;clip-path:polygon(50% 0,100% 100%,0 100%)}.mk.s-diamond{transform:rotate(45deg) scale(.85)}
.kl{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:1.6;color:var(--c);border:1px solid var(--c);border-radius:3px;padding:0 6px;white-space:nowrap}
.tag{display:inline-block;font-size:10px;line-height:1.5;padding:0 5px;border-radius:3px;border:1px solid var(--line2);color:var(--muted);margin-left:6px;vertical-align:1px;font-weight:400;white-space:nowrap}.tag-entry{color:var(--link);border-color:var(--link)}.tag-branch{color:var(--branch);border-color:var(--branch)}.tag-diff{color:var(--mod);border-color:var(--mod)}.tag-data,.tag-external{color:var(--syn-title);border-color:var(--syn-title)}.tag-unk{color:var(--warn);border:1px dashed var(--warn)}
.badge{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;font:600 11px/1 var(--ui);background:var(--chip);color:var(--text);flex:none;vertical-align:middle}.badge.d{box-shadow:inset 0 0 0 1.5px var(--mod)}.badge.on{background:var(--accent);color:#fff}.badge.on.d{box-shadow:0 0 0 1.5px var(--mod)}a.badge:hover{background:#4a4d52}a.badge.on:hover{background:var(--accent)}
.titlebar .tb-guide{margin-left:auto;color:var(--link)}.titlebar .tb-guide:hover{text-decoration:underline}
.guide-panel{border-bottom:1px solid var(--border);padding-bottom:12px;font-size:13px}.g-title{padding:0 14px;font-weight:600;line-height:1.5}.g-title a:hover{text-decoration:underline}.subh{padding:12px 14px 4px;font-size:11px;color:var(--muted)}
.filters{display:flex;flex-wrap:wrap;gap:4px;padding:0 12px}.chip{display:inline-flex;align-items:center;gap:5px;background:var(--btn);border:1px solid var(--btn-border);border-radius:10px;padding:1px 8px;font:11.5px var(--ui);color:var(--text);cursor:pointer}.chip:hover{background:var(--chip)}.chip b{font-weight:400;color:var(--muted)}.chip[aria-pressed="false"]{opacity:.45}.chip[aria-pressed="false"] span:not(.mk){text-decoration:line-through}
.stack .stk{display:block;font:12px var(--mono);padding:2px 14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stack .stk:hover{background:var(--hover)}.stack .stk.now{color:var(--text)}.stack .stk em{font:11px var(--ui);color:var(--link);margin-left:8px}.stack .stk.unk{color:var(--warn);font-family:var(--ui)}.stack .stk.unk:hover{background:none}.stack .stk-alt{font:11.5px var(--ui);color:var(--muted);padding:0 14px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stack .stk-alt a{color:var(--link)}.stack .stk-alt a:hover{text-decoration:underline}.empty{padding:4px 14px;color:var(--muted);font-size:12px}
.ptabs{display:flex;margin:12px 12px 4px;border-bottom:1px solid var(--border)}.ptab{background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:4px 10px;font:12px var(--ui);color:var(--muted);cursor:pointer}.ptab[aria-selected="true"]{color:var(--text);border-bottom-color:var(--accent)}.ptab b{font-weight:400;margin-left:6px;background:var(--chip);border-radius:8px;padding:0 6px;font-size:11px}
.plist{display:grid}.step-i{display:grid;grid-template-columns:16px 22px minmax(0,1fr);column-gap:6px;padding:4px 12px}.step-i .pos{grid-row:1/3;font:11px var(--mono);color:#727272;text-align:right;margin-top:1px}.step-i .badge{grid-row:1/3;margin-top:1px}.f-i{display:grid;grid-template-columns:12px minmax(0,1fr);column-gap:8px;padding:5px 12px}.f-i .mk{grid-row:1/3;margin-top:5px}.step-i:hover,.f-i:hover{background:var(--hover)}.step-i.on,.f-i.on{background:var(--active)}.step-t,.f-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.step-f,.f-l{font:11px var(--mono);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.f-k{color:var(--c);font-family:var(--ui)}
.navs{display:flex;gap:6px;padding:12px 12px 0}.nb{flex:1;text-align:center;background:var(--btn);border:1px solid var(--btn-border);border-radius:3px;padding:5px 4px;font-size:12px;white-space:nowrap;cursor:pointer}.nb:hover{background:var(--chip)}.nb[aria-disabled="true"]{opacity:.35;pointer-events:none}.keys{display:flex;flex-wrap:wrap;gap:2px 14px;padding:8px 14px 0;font-size:11px;color:var(--muted)}.keys span{white-space:nowrap}
.tree-file.tf-x{display:flex;align-items:center;gap:4px}.tf-n{overflow:hidden;text-overflow:ellipsis}.tf-d{display:inline-flex;align-items:center;gap:5px;margin-left:auto;padding-left:6px}.tf-d .badge{width:16px;height:16px;font-size:10px}.tree-file.tf-m,.tree-file.tf-r{color:var(--mod)}.tree-file.tf-a{color:var(--add)}.tree-file.tf-here{background:var(--active)}
.scm{font-size:11px;color:var(--mod);margin-left:6px}.fc{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--c)}.crumbs .base-link{color:var(--link)}
.code-table.g .ln{position:static;min-width:44px;padding:0 10px 0 6px;border-right:0}.code-table.g .dm{width:16px;min-width:16px;padding:0;text-align:center;font-weight:600;user-select:none}.code-table.g .st{width:26px;min-width:26px;padding:0;text-align:center}.code-table.g .st .badge{margin-top:2px}.code-table.g .mkc{width:16px;min-width:16px;padding:0;text-align:center}.code-table.g .src{padding:0 24px 0 6px}.mkb{display:inline-grid;place-items:center;width:14px;height:20px}
.row.add .dm,.row.add .src,.row.mod .dm,.row.mod .src{background:var(--add-bg)}.row.add .dm::before,.row.mod .dm::before{content:"+";color:var(--add)}.row.del .dm,.row.del .src{background:var(--del-bg)}.row.del .dm::before{content:"−";color:var(--del)}.row.add .wd,.row.mod .wd{background:var(--add-wd);border-radius:2px}.row.del .wd{background:var(--del-wd);border-radius:2px}
.row.cur .ln,.row.cur .st,.row.cur .mkc{background:var(--hl)}.row.cur:not(.add):not(.mod):not(.del) .src{background:var(--hl)}.row.cur .ln{color:#c6c6c6;box-shadow:inset 2px 0 0 var(--link)}.row.fsel .ln,.row.fsel .st,.row.fsel .mkc,.row.fsel:not(.add):not(.mod):not(.del) .src{background:color-mix(in srgb,var(--c) 16%,transparent)}.row.csel .ln{background:rgba(226,192,141,.2);color:var(--text);box-shadow:inset 2px 0 0 var(--mod)}
.code-table.g .note-cell{padding:4px 24px 10px 6px}.note{max-width:680px;white-space:normal;font:13px/1.7 var(--ui);background:var(--panel);border:1px solid var(--line2);border-left:3px solid var(--c);border-radius:4px;padding:10px 14px}.note.is-cur,.note.sel{box-shadow:0 0 0 1px var(--c)}.note-h{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:4px}.note-h .tag{margin-left:0}.note-h .pos{margin-left:auto;color:var(--muted);font-size:12px}.note p{margin:0}.note p+p{margin-top:6px}
.note code,.cv code{font:12px var(--mono);background:var(--codebg);border:1px solid #333;padding:0 4px;border-radius:3px}.fix{margin-top:8px}.fix>span{display:block;font-size:11.5px;color:var(--muted);margin-bottom:2px}.fix pre{margin:0;font:12px/1.6 var(--mono);background:var(--codebg);border:1px solid #333;border-radius:3px;padding:4px 10px;white-space:pre;overflow-x:auto}
.br{border-collapse:collapse;margin:8px 0 2px;font-size:12.5px}.br th,.br td{border:1px solid var(--line2);padding:4px 10px;text-align:left;font-weight:400;vertical-align:top}.br th{color:var(--muted);font-size:11.5px}.br a,.links a{color:var(--link)}.callers{margin-top:8px;font-size:12.5px;color:var(--muted)}.callers a{color:var(--link)}.callers a:hover{text-decoration:underline}.callers span{margin:0 6px}
.chg{margin-top:8px;font-size:12.5px;color:var(--muted)}.chg a{color:var(--link)}.chg a:hover{text-decoration:underline}.chg>span:not(.plus):not(.minus){margin:0 6px}
.c-key{display:flex;flex-wrap:wrap;gap:2px 12px;padding:2px 12px 6px;font-size:11px;color:var(--muted)}.c-key b{font:600 12px var(--mono);margin-right:4px}.c-key i{font-style:normal;color:var(--text);padding:0 3px;border-radius:2px;margin-right:2px}.c-key i.wa{background:var(--add-wd)}.c-key i.wr{background:var(--del-wd);margin-right:4px}
.c-f{display:flex;align-items:center;gap:6px;padding:5px 12px 2px;font-size:12.5px}.c-fn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.c-f .scm{margin-left:0}.c-f.here .c-fn{color:#fff;font-weight:600}.c-n{margin-left:auto;font:11px var(--mono);white-space:nowrap}.c-i{display:flex;align-items:center;gap:6px;padding:3px 12px 3px 26px;font-size:12px}.c-l{font:11.5px var(--mono);white-space:nowrap}.c-w{color:var(--muted);font-size:11px;white-space:nowrap}.c-i .badge{width:16px;height:16px;font-size:10px}.c-i .c-n+.badge{margin-left:2px}.c-f:hover,.c-i:hover{background:var(--hover)}.c-i.on{background:var(--active)}
.unv{margin-top:8px;padding:6px 10px;border:1px solid rgba(215,186,125,.4);background:rgba(215,186,125,.07);border-radius:3px;color:var(--warn);font-size:12.5px}.links{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.lk{border:1px solid var(--btn-border);font-size:12px;padding:2px 9px;border-radius:3px}.lk:hover{background:var(--hover)}
.status .sc{display:inline-flex;align-items:center;gap:4px}.status .mk{background:#fff}.status .r{margin-left:auto}
.cover-page{height:auto;min-height:100vh}.cover-page .titlebar{height:35px}.cv{padding:22px 28px 40px;display:grid;grid-template-columns:minmax(0,1fr);gap:26px;max-width:1280px}.cv-crumbs{font-size:12px;color:var(--muted)}.cv-crumbs a{color:var(--link)}.cv h1{margin:4px 0 0;font-size:22px;font-weight:600}.cv h2{margin:0 0 8px;font-size:12px;letter-spacing:.06em;color:#bbb;font-weight:600}
.facts{display:grid;grid-template-columns:auto 1fr;gap:4px 18px;margin:0;font-size:13px;line-height:1.6}.facts dt{color:var(--muted)}.facts dd{margin:0}.plus{color:var(--add)}.minus{color:var(--del)}.sum{margin:0;padding-left:18px;line-height:1.85;max-width:90ch}.fsum{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}.fsum .kl{font-size:12px;padding:1px 8px}.none{margin:0;color:var(--muted)}
.diagram{background:var(--codebg);border:1px solid var(--border);border-radius:4px;padding:14px;overflow:auto}.diagram svg{display:block}.n rect.box{fill:var(--panel);stroke:#4a4a4a;stroke-width:1}.n.d rect.box{stroke:var(--mod);stroke-width:1.6}.n.k-result rect.box{fill:none;stroke:#7a7a7a;stroke-dasharray:4 3}.n.k-db rect.box{fill:var(--dbfill);stroke:var(--syn-title)}.n.k-external rect.box{fill:none;stroke:var(--syn-title);stroke-dasharray:2 3}a:hover .n rect.box,a:focus .n rect.box{fill:var(--hover);stroke:var(--link)}
.n .t{fill:var(--text);font:600 13px var(--ui)}.n .s{fill:var(--muted);font:11px var(--mono)}.n.k-db .t{font:12px var(--mono)}.dtag{fill:var(--mod);font:11px var(--ui)}.fm{fill:var(--c)}.fmt{fill:var(--c);font:11px var(--ui)}.e{fill:none;stroke:var(--edge);stroke-width:1.3}.e.back{stroke-dasharray:4 3}.el{fill:var(--muted);font:11px var(--ui)}.n.u rect.box{stroke-dasharray:5 3}.n.u:not(.d) rect.box{stroke:var(--warn)}.e.q{stroke:var(--warn);stroke-dasharray:3 3}.qm{fill:var(--warn);font:600 13px var(--ui)}.sep-l{stroke:#4a4a4a;stroke-dasharray:4 4}.sep-t{fill:var(--warn);font:12px var(--ui)}
.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:10px}.legend i{display:inline-block;width:16px;height:11px;border:1.5px solid var(--mod);margin-right:6px;vertical-align:-1px;border-radius:2px}.legend i.r{border:1.5px dashed #7a7a7a;border-radius:6px}.legend i.db{border-color:var(--syn-title);background:var(--dbfill)}.legend i.x{border:1.5px dotted var(--syn-title)}.legend i.u{border:1.5px dashed var(--warn)}
.ctable{border-collapse:collapse;width:100%;font-size:13px}.ctable th,.ctable td{border-bottom:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}.ctable th{color:var(--muted);font-weight:400;font-size:12px}.ctable a{color:var(--link)}.ctable a:hover{text-decoration:underline}.ctable .f{font:12px var(--mono);color:var(--muted)}.ctable .tag{margin:0 4px 0 0}.fms{display:flex;gap:6px;align-items:center;padding-top:5px}.cn{margin:0 0 8px;color:var(--muted);font-size:13px}.ctable .cf td{padding-top:12px}.ctable .cb td{border-bottom:0;padding-top:4px;padding-bottom:4px}.ctable .cb td:nth-child(2){padding-left:28px}.ctable .cw{margin-left:10px;font-size:12px;color:var(--muted)}.ctable .pv{font:12px var(--mono);color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(80ch,52vw)}.ctable .cb .badge{width:16px;height:16px;font-size:10px}.pv .wd{color:var(--text);border-radius:2px}.pv.pa .wd{background:var(--add-wd)}.pv.pd .wd{background:var(--del-wd)}.offr{padding:5px 14px;font-size:12px;color:var(--warn);background:rgba(215,186,125,.06);border-bottom:1px solid #232323}.c-i .tag-out{font-size:10px;padding:0 4px}.tag-out{color:var(--warn);border-color:var(--warn);margin:0}.cmk{display:inline-flex;margin-right:6px}
.unv-list{margin:0;padding-left:18px;line-height:1.9;color:var(--warn)}.unv-list a{color:var(--link);margin-left:8px}
.sb-sec{margin:12px 8px 0;border:1px solid var(--line2);border-radius:4px;padding-bottom:12px}.sb-route{background:#1b2129;border-color:#2f4a66}.sb-h{padding:9px 6px 0;font-size:12.5px;font-weight:600;color:var(--text)}.sb-d{margin:2px 6px 0;font-size:11px;line-height:1.5;color:var(--muted)}
.sb-sec .subh{padding-left:6px;padding-right:6px}.sb-sec .step-i,.sb-sec .f-i,.sb-sec .c-f{padding-left:4px;padding-right:4px}.sb-sec .c-i{padding-left:16px;padding-right:4px}.sb-sec .stack .stk,.sb-sec .empty,.sb-sec .c-key{padding-left:6px;padding-right:6px}.sb-sec .navs{padding-left:4px;padding-right:4px}.sb-sec .ptabs{margin-left:4px;margin-right:4px}.guide-panel .keys{padding-top:10px}
.rfilter{margin:2px 4px 6px;width:calc(100% - 8px);background:#1e1e1e;border:1px solid var(--btn-border);border-radius:3px;color:var(--text);font:12px var(--ui);padding:4px 8px}.rg{padding:6px 6px 2px;font-size:11px;color:#8a8a8a}
.ri{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;column-gap:6px;width:100%;text-align:left;background:none;border:0;padding:4px;cursor:pointer;font:12.5px var(--ui);color:var(--text)}.ri:hover{background:var(--hover)}.ri[aria-pressed="true"]{background:var(--active)}.ri .rn{display:inline-grid;place-items:center;height:18px;border-radius:3px;background:var(--btn);border:1px solid var(--btn-border);font:600 10.5px var(--ui);color:#c8c8c8}.ri[aria-pressed="true"] .rn{background:var(--accent);border-color:var(--accent);color:#fff}.ri .rtt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ri .pass{font-size:10.5px;white-space:nowrap;color:var(--muted)}.ri .pass.yes{color:var(--add)}.ri.far .rtt{color:#7a7a7a}
.rpos{padding:6px 6px 0;font-size:11.5px;color:var(--muted)}.end-i{padding:1px 4px 3px 54px;font-size:11.5px;color:var(--muted)}.end-i a{color:var(--link)}.end-i a:hover{text-decoration:underline}.end-i.fin{padding-left:26px;color:#c8c8c8}.stack .stk.unk{padding-left:6px}
.rt{display:inline-flex;align-items:center;font:600 11px/1.5 var(--ui);color:var(--text);background:var(--btn);border:1px solid var(--btn-border);border-radius:3px;padding:0 6px;white-space:nowrap;cursor:pointer}.rt:hover{border-color:var(--link)}.rt.now{background:var(--accent);border-color:var(--accent);color:#fff}.rt.via{font-weight:400;color:var(--muted)}.rt.unk{color:var(--warn);border-style:dashed}.routes-cell{display:inline-flex;flex-wrap:wrap;gap:4px}
.via{margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12.5px;color:var(--muted)}.f-i .f-l{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;white-space:normal}.c-i{flex-wrap:wrap}
.nbtn{background:none;border:0;padding:0;margin:0;cursor:pointer;display:inline-grid;place-items:center;border-radius:50%}.nbtn:hover .badge,.nbtn[aria-expanded="true"] .badge{box-shadow:0 0 0 2px var(--link)}.nbtn:hover .badge.d,.nbtn[aria-expanded="true"] .badge.d{box-shadow:inset 0 0 0 1.5px var(--mod),0 0 0 2px var(--link)}
button.mkb{background:none;border:0;padding:0;margin:0;cursor:pointer;border-radius:3px}button.mkb:hover,button.mkb[aria-expanded="true"]{background:color-mix(in srgb,var(--c) 26%,transparent);box-shadow:0 0 0 1px var(--c)}button.mkb.sel{background:color-mix(in srgb,var(--c) 26%,transparent);box-shadow:0 0 0 2px var(--c)}
.note-x{background:none;border:1px solid transparent;border-radius:3px;color:var(--muted);cursor:pointer;font:15px/1 var(--ui);padding:1px 6px}.note-x:hover{border-color:var(--btn-border);color:var(--text)}.note-h .pos+.note-x{margin-left:-2px}
.ntools{display:inline-flex;align-items:center;gap:6px;margin-left:14px}.ntools span{color:var(--muted)}.ntools button{background:var(--btn);border:1px solid var(--btn-border);border-radius:3px;font:11.5px/1.6 var(--ui);padding:0 8px;cursor:pointer;color:#c8c8c8}.ntools button:hover{background:var(--chip)}
.cv>section{border-top:1px solid var(--line2);padding-top:16px}.cv>section>h2{font-size:14px;letter-spacing:.02em;color:var(--text);margin-bottom:6px}
.rname{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.rname a.rtl{font-weight:600}.chain{display:flex;flex-wrap:wrap;align-items:center;gap:3px 2px;min-width:240px}.chain .ar{color:#727272;font-size:11px;margin:0 1px}.chain .badge{cursor:default}.chain .badge.hot{background:var(--link);color:#0b1b2a}.endp{display:inline-block;font-size:11px;line-height:1.6;border:1px dashed #7a7a7a;border-radius:9px;padding:0 8px;color:#c8c8c8;margin-left:4px}.ends{margin-top:4px;font-size:12px;color:var(--muted)}.ends span+span::before{content:"・";margin:0 2px}.ctable tr.grp td{padding:14px 10px 4px;font-size:12px;color:#bbb;border-bottom:1px solid var(--line2)}.ctable tr.grp b{font-weight:400;color:var(--muted);margin-left:8px}
.rchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.rchip{display:inline-flex;align-items:center;gap:5px;background:var(--btn);border:1px solid var(--btn-border);border-radius:12px;padding:2px 10px;font:12px var(--ui);cursor:pointer;color:var(--text)}.rchip:hover{background:var(--chip)}.rchip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
#flow .n,#flow .e,#flow .el{transition:opacity .15s}#flow .off{opacity:.13}#flow .cont{opacity:.5}#flow .e.on{stroke:var(--link);stroke-width:1.8}@media (prefers-reduced-motion:reduce){#flow .n,#flow .e,#flow .el{transition:none}}
`;
  for (const [k, t] of Object.entries(types)) css += `.t-${k}{--c:${t.color}}body.hide-${k} tr.nr-${k},body.hide-${k} .mkb.t-${k},body.hide-${k} .f-i.t-${k}{display:none}`;
  return css;
}

async function main() {
  const started = Date.now();
  const guideArg = opt('--guide');
  const nameArg = opt('--name');
  if (!guideArg && !nameArg) fail('--name <ガイド名> か --guide <guide.json のパス> を指定する');
  const guideFile = guideArg ? path.resolve(guideArg) : path.join(guidesDir, sanitizeName(nameArg), 'guide.json');
  const guideDir = path.dirname(guideFile);
  if (path.dirname(guideDir) !== guidesDir) fail(`guide.json は ${toPosix(path.relative(root, guidesDir))}/<ガイド名>/guide.json に置く`);
  const guideName = path.basename(guideDir);

  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(outputDir, MANIFEST_NAME), 'utf8')); }
  catch { fail(`${OUTPUT_DIR_NAME}/${MANIFEST_NAME} が無い。先に prepare-guide.mjs（または generate-html-code.mjs）を実行する`); }
  let guide;
  try { guide = JSON.parse(await fs.readFile(guideFile, 'utf8')); }
  catch (err) { fail(`guide.json を読めない: ${err.message}`); }

  // ---- 検証と、アンカーから行への変換 ----
  const problems = [];
  if (!guide || typeof guide !== 'object' || Array.isArray(guide)) fail('guide.json はオブジェクトで書く');
  if (!isStr(guide.title)) problems.push('title: ガイドの題名を書く');
  if (!isStr(guide.request)) problems.push('request: 依頼文を書く');
  if (guide.review !== undefined && typeof guide.review !== 'boolean') problems.push('review: true か false で書く');
  const review = guide.review === true;
  if (!Array.isArray(guide.summary) || !guide.summary.length || !guide.summary.every(isStr)) problems.push('summary: 要約を1行以上、文字列の配列で書く');
  if (!Array.isArray(guide.steps) || !guide.steps.length) problems.push('steps: 順路のステップを1つ以上書く');
  if (guide.notes !== undefined && !Array.isArray(guide.notes)) problems.push('notes: 配列で書く');
  if (guide.unverified !== undefined && !Array.isArray(guide.unverified)) problems.push('unverified: 配列で書く');
  const types = buildTypes(guide.noteTypes, problems);

  let diff = null;
  let diffFiles = new Map();
  if (guide.diff !== undefined && guide.diff !== null) {
    try {
      diff = await resolveDiffSpec(root, guide.diff);
      if (diff) diffFiles = await collectDiff(root, diff);
    } catch (err) { problems.push(`diff: ${err.message}`); }
  }

  const fileCache = new Map();
  const toEntry = buf => {
    if (!buf) return { missing: true };
    if (isLikelyBinary(buf)) return { binary: true };
    const normalized = normalizeSource(buf.toString('utf8'));
    return { normalized, lines: normalized.split('\n') };
  };
  async function loadFile(rel) {
    if (!fileCache.has(rel)) fileCache.set(rel, toEntry(await readTargetFile(root, diff, rel)));
    return fileCache.get(rel);
  }
  async function resolveFile(value, where) {
    const rel = normRel(value);
    if (!rel) { problems.push(`${where}.file: リポジトリのルートからの相対パスで書く`); return null; }
    const entry = await loadFile(rel);
    if (entry.missing) { problems.push(`${where}.file: ${rel} が${diff?.target ? `比較先（${diff.target.slice(0, 10)}）` : '作業ツリー'}に無い`); return null; }
    if (entry.binary) { problems.push(`${where}.file: ${rel} はバイナリのため対象にできない`); return null; }
    return { rel, entry };
  }

  const steps = [];
  const stepIds = new Set();
  for (const [i, s] of (Array.isArray(guide.steps) ? guide.steps : []).entries()) {
    const w = `steps[${i}]`;
    if (!s || typeof s !== 'object') { problems.push(`${w}: オブジェクトで書く`); continue; }
    if (!isStr(s.id) || !/^[A-Za-z0-9_-]+$/.test(s.id)) problems.push(`${w}.id: 英数字・_・- で書く`);
    else if (stepIds.has(s.id)) problems.push(`${w}.id: "${s.id}" が重複している`);
    else stepIds.add(s.id);
    const kind = s.kind ?? 'call';
    if (!KINDS[kind]) problems.push(`${w}.kind: ${Object.keys(KINDS).join(' / ')} のどれかにする`);
    if (!isStr(s.title)) problems.push(`${w}.title: ステップの題名を書く`);
    if (!isStr(s.body)) problems.push(`${w}.body: 解説を書く`);
    if (s.summary !== undefined && typeof s.summary !== 'string') problems.push(`${w}.summary: 文字列で書く`);
    if (s.unverified !== undefined && !isStr(s.unverified)) problems.push(`${w}.unverified: 文字列で書く`);
    if (s.callerUnknown !== undefined && !isStr(s.callerUnknown)) problems.push(`${w}.callerUnknown: 呼び出し元を確かめられなかった理由を文字列で書く`);
    let parents = [];
    let badParent = false;
    if (s.parent !== undefined && s.parent !== null) {
      const list = Array.isArray(s.parent) ? s.parent : [s.parent];
      if (!list.length || !list.every(isStr)) { badParent = true; problems.push(`${w}.parent: 呼び出し元のステップidを、文字列（呼び出し元が複数なら文字列の配列）で書く`); }
      else {
        if (new Set(list).size !== list.length) problems.push(`${w}.parent: 同じステップidが重複している`);
        parents = [...new Set(list)];
      }
    }
    if (s.branches !== undefined && (!Array.isArray(s.branches) || !s.branches.every(b => b && isStr(b.when) && isStr(b.then)))) problems.push(`${w}.branches: [{ "when": 条件, "then": 結果, "to": 次のステップid（任意） }] の形で書く`);
    if (s.links !== undefined && (!Array.isArray(s.links) || !s.links.every(l => l && isStr(l.to)))) problems.push(`${w}.links: [{ "to": ステップid, "label": 表示名（任意） }] の形で書く`);
    const f = await resolveFile(s.file, w);
    const pos = f ? locate(f.entry, s, f.rel, w, problems) : null;
    if (!f || !pos) continue;
    steps.push({ id: s.id, n: 0, file: f.rel, line: pos.line, end: pos.end, kind, title: s.title, body: s.body, summary: s.summary || '', parents, branches: s.branches || [], links: s.links, unverified: s.unverified || '', callerUnknown: isStr(s.callerUnknown) ? s.callerUnknown : '', badParent });
  }
  steps.forEach((s, i) => { s.n = i + 1; });
  const stepById = new Map(steps.map(s => [s.id, s]));
  const parentsOf = id => stepById.get(id)?.parents || [];
  // 呼び出し元(parent)か、ほかのステップの分岐(branches の to)から入るステップは、つながりがある
  const branchIn = new Set(steps.flatMap(s => s.branches.filter(b => b.to && b.to !== s.id).map(b => b.to)));
  const cyclic = new Set();
  for (const s of steps) {
    const w = `steps(${s.id})`;
    for (const p of s.parents) if (!stepIds.has(p) || p === s.id) problems.push(`${w}.parent: 存在する別のステップidを書く（"${p}"）`);
    for (const b of s.branches) if (b.to !== undefined && !stepIds.has(b.to)) problems.push(`${w}.branches.to: "${b.to}" というステップが無い`);
    for (const l of s.links || []) if (!stepIds.has(l.to)) problems.push(`${w}.links.to: "${l.to}" というステップが無い`);
    const seen = new Set();
    for (const queue = [...s.parents]; queue.length;) {
      const id = queue.pop();
      if (id === s.id) { cyclic.add(s.id); problems.push(`${w}.parent: 呼び出し元をたどると循環している`); break; }
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...parentsOf(id));
    }
    const connected = s.parents.length > 0 || branchIn.has(s.id);
    if (s.callerUnknown && s.kind === 'entry') problems.push(`${w}.callerUnknown: 入口（kind が "entry"）には書かない`);
    else if (s.callerUnknown && connected) problems.push(`${w}.callerUnknown: 呼び出し元（parent か、ほかのステップの branches の to）があるステップには書かない。ほかにも呼び出し元がありそうで確かめられない場合は unverified に書く`);
    else if (!connected && s.kind !== 'entry' && !s.callerUnknown && !s.badParent) problems.push(`${w}: 呼び出し元が無い。parent に呼び出し元のステップidを書く。入口なら kind を "entry" にする。呼び出し元を確かめられなかったなら callerUnknown にその理由を書く`);
  }
  // どのステップも、呼び出し元をたどると入口か callerUnknown のステップに着く(呼び出し元の分からないステップを入口のように見せない)
  const grounded = new Set(steps.filter(s => s.kind === 'entry' || s.callerUnknown || (!s.parents.length && !branchIn.has(s.id))).map(s => s.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const s of steps) {
      if (grounded.has(s.id)) continue;
      const from = [...s.parents, ...steps.filter(q => q.id !== s.id && q.branches.some(b => b.to === s.id)).map(q => q.id)];
      if (from.some(id => grounded.has(id) || !stepById.has(id))) { grounded.add(s.id); changed = true; }
    }
  }
  for (const s of steps) if (!grounded.has(s.id) && !cyclic.has(s.id)) problems.push(`steps(${s.id}): 呼び出し元と分岐をたどっても、入口（kind が "entry"）か callerUnknown のステップに着かない（循環している）`);
  // 順路は入口(処理のきっかけ)から始め、実行される順に並べる(呼び出し元が先)。差分やレビューでも、変更箇所から始めない。
  // 入口からたどれないステップ(呼び出し元が未確認)は、入口からたどれるステップの後に置く。
  const order = new Map(steps.map((s, i) => [s.id, i]));
  const callersOf = new Map(steps.map(s => [s.id, s.parents.filter(id => order.has(id))]));
  for (const s of steps) for (const b of s.branches) if (b.to && b.to !== s.id && callersOf.has(b.to)) callersOf.get(b.to).push(s.id);
  const entries = steps.filter(s => s.kind === 'entry');
  if (steps.length && entries.length && steps[0].kind !== 'entry') problems.push(`steps[0]: 順路は入口（ボタン操作・画面の初期表示・エンドポイントなど、処理のきっかけ）から始める。最初のステップを kind が "entry" のステップにする（今は "${steps[0].id}"）`);
  if (steps.length && !entries.length && !steps[0].callerUnknown) problems.push('steps: 入口（kind が "entry"）が無い。順路は処理のきっかけ（ボタン操作・画面の初期表示・エンドポイントなど）から始める。呼び出し元をさかのぼってもきっかけを確かめられない場合だけ、callerUnknown のステップから始める');
  // 入口は、ほかのルートから続いて入る(画面の操作 → API → エンドポイント)ことがあるので、並び順の検査から外す
  for (const s of steps) {
    const callers = callersOf.get(s.id);
    if (!callers.length || s.callerUnknown || s.kind === 'entry' || callers.some(id => order.get(id) < order.get(s.id))) continue;
    problems.push(`steps(${s.id}): 呼び出し元（${callers.join(', ')}）より前に並んでいる。順路は入口から実行される順に、呼び出し元を先に並べる`);
  }
  if (entries.length) {
    const fromEntry = new Set(entries.map(s => s.id));
    for (let changed = true; changed;) {
      changed = false;
      for (const s of steps) if (!fromEntry.has(s.id) && callersOf.get(s.id).some(id => fromEntry.has(id))) { fromEntry.add(s.id); changed = true; }
    }
    const last = Math.max(...steps.filter(s => fromEntry.has(s.id)).map(s => order.get(s.id)));
    for (const s of steps) if (!fromEntry.has(s.id) && order.get(s.id) < last) problems.push(`steps(${s.id}): 入口からたどれないステップ（呼び出し元が未確認）は、入口からたどれるステップより後に並べる`);
  }

  // ルート: 入口(kind が entry)ごとに1つ作る。routes では、名前・グループ・終わり方・並び順だけを指定できる(省略可)。
  // 中身は、入口から呼び出し先(parent が自分のステップ)と分岐の先(branches の to)を深さ優先でたどった順。
  // 同じステップから出る先どうしは steps の並び順にする。ほかの入口に着いたら、その先はそのルートに任せて「ルートN へ続く」にする。
  const routeSpecs = [];
  if (guide.routes !== undefined && guide.routes !== null) {
    if (!Array.isArray(guide.routes)) problems.push('routes: 配列で書く');
    else {
      guide.routes.forEach((r, i) => {
        const w = `routes[${i}]`;
        if (!r || typeof r !== 'object') { problems.push(`${w}: オブジェクトで書く`); return; }
        const s = stepById.get(r.entry);
        if (!s) { problems.push(`${w}.entry: 入口のステップidを書く（"${r.entry}" というステップが無い）`); return; }
        if (s.kind !== 'entry') { problems.push(`${w}.entry: "${r.entry}" は入口ではない。kind が "entry" のステップを書く`); return; }
        if (routeSpecs.some(x => x.entry === r.entry)) { problems.push(`${w}.entry: "${r.entry}" のルートが重複している`); return; }
        for (const k of ['title', 'group', 'end']) if (r[k] !== undefined && !isStr(r[k])) problems.push(`${w}.${k}: 文字列で書く`);
        routeSpecs.push({ entry: r.entry, title: isStr(r.title) ? r.title : '', group: isStr(r.group) ? r.group : '', end: isStr(r.end) ? r.end : '' });
      });
    }
  }
  const nextOf = new Map(steps.map(s => [s.id, []]));
  for (const s of steps) for (const p of s.parents) if (nextOf.has(p) && p !== s.id) nextOf.get(p).push(s.id);
  for (const s of steps) for (const b of s.branches) if (b.to && b.to !== s.id && nextOf.has(b.to)) nextOf.get(s.id).push(b.to);
  for (const [id, list] of nextOf) nextOf.set(id, [...new Set(list)].sort((a, b) => order.get(a) - order.get(b)));
  const walk = (start, stopAtEntry) => {
    const list = []; const cont = []; const seen = new Set([start]);
    const visit = id => {
      list.push(id);
      for (const nx of nextOf.get(id)) {
        if (seen.has(nx)) continue;
        seen.add(nx);
        if (stopAtEntry && stepById.get(nx).kind === 'entry') {
          const b = stepById.get(id).branches.find(x => x.to === nx);
          cont.push({ from: id, entry: nx, when: b ? b.when : '' });
        } else visit(nx);
      }
    };
    visit(start);
    return { list, cont };
  };
  const specByEntry = new Map(routeSpecs.map(r => [r.entry, r]));
  const routeEntries = [...routeSpecs.map(r => r.entry), ...entries.map(s => s.id).filter(id => !specByEntry.has(id))];
  let routeList = routeEntries.map(entry => {
    const spec = specByEntry.get(entry) || {};
    const { list, cont } = walk(entry, true);
    return { entry, title: spec.title || stepById.get(entry).title, group: spec.group || '', end: spec.end || '', steps: list, cont };
  });
  // グループを書いたルートは、グループごとにまとめる(グループの順は最初に出てきた順)
  if (routeList.some(r => r.group)) {
    const groupOrder = [...new Set(routeList.map(r => r.group || 'その他'))];
    routeList = groupOrder.flatMap(g => routeList.filter(r => (r.group || 'その他') === g).map(r => ({ ...r, group: g })));
  }
  routeList.forEach((r, i) => { r.id = `r${i + 1}`; r.no = i + 1; });
  // 入口からたどれないステップ(呼び出し元が未確認)は、まとめて1つの「ルート」にする
  const routed = new Set(routeList.flatMap(r => r.steps));
  const rest = steps.filter(s => !routed.has(s.id));
  if (rest.length) {
    const list = [];
    for (const s of rest) if (!list.includes(s.id)) for (const id of walk(s.id, false).list) if (!routed.has(id) && !list.includes(id)) list.push(id);
    routeList.push({ id: 'ru', no: 0, entry: list[0], title: '呼び出し元が未確認のステップ', group: routeList.some(r => r.group) ? '呼び出し元が未確認' : '', end: '', steps: list, cont: [], unknown: true });
  }
  const routeById = new Map(routeList.map(r => [r.id, r]));
  for (const r of routeList) r.cont = r.cont.map(c => ({ ...c, route: routeList.find(x => x.entry === c.entry && !x.unknown).id }));
  const realRoutes = routeList.filter(r => !r.unknown);

  const notes = [];
  for (const [i, n] of (Array.isArray(guide.notes) ? guide.notes : []).entries()) {
    const w = `notes[${i}]`;
    if (!n || typeof n !== 'object') { problems.push(`${w}: オブジェクトで書く`); continue; }
    if (!types[n.type]) { problems.push(`${w}.type: ${Object.keys(types).join(' / ')} のどれかにする（増やす場合は noteTypes に書く）`); continue; }
    if (types[n.type].finding && !review) problems.push(`${w}.type: review が false なのに「${types[n.type].label}」がある。レビュー依頼でなければ指摘は書かず、レビュー依頼なら review を true にする`);
    if (!isStr(n.title)) problems.push(`${w}.title: 見出しを書く`);
    if (!isStr(n.body)) problems.push(`${w}.body: 本文を書く`);
    if (n.fix !== undefined && !isStr(n.fix)) problems.push(`${w}.fix: 修正案のコードを文字列で書く`);
    if (n.step !== undefined && !stepIds.has(n.step)) problems.push(`${w}.step: "${n.step}" というステップが無い`);
    const f = await resolveFile(n.file, w);
    const pos = f ? locate(f.entry, n, f.rel, w, problems) : null;
    if (!f || !pos) continue;
    notes.push({ type: n.type, file: f.rel, line: pos.line, end: pos.end, title: n.title, body: n.body, fix: n.fix, step: n.step ?? null });
  }

  const unverified = [];
  for (const s of steps) {
    if (s.callerUnknown) unverified.push({ text: `呼び出し元: ${s.callerUnknown}`, step: s.id });
    if (s.unverified) unverified.push({ text: s.unverified, step: s.id });
  }
  for (const [i, u] of (Array.isArray(guide.unverified) ? guide.unverified : []).entries()) {
    if (isStr(u)) unverified.push({ text: u, step: null });
    else if (u && isStr(u.text) && (u.step === undefined || stepIds.has(u.step))) unverified.push({ text: u.text, step: u.step ?? null });
    else problems.push(`unverified[${i}]: 文字列か { "text": 内容, "step": ステップid（任意） } で書く`);
  }

  // 全体図: ステップと分岐から自動で作り、flow.nodes / flow.edges を足す
  const flow = guide.flow ?? {};
  if (typeof flow !== 'object' || Array.isArray(flow)) problems.push('flow: オブジェクトで書く');
  const flowNodes = new Map();
  const flowEdges = [];
  if (flow.auto !== false) {
    // 分岐から入るステップには、分岐元の呼び出し元からの矢印を描かない。ミドルウェアのように、分岐元を通ってから進むため。
    // ただし、自分の呼び出し先から戻ってくる分岐(再試行など)は除く。
    const ancestors = new Map();
    const ancestorsOf = id => {
      if (!ancestors.has(id)) {
        const seen = new Set();
        for (const queue = [...parentsOf(id)]; queue.length;) {
          const p = queue.pop();
          if (!seen.has(p)) { seen.add(p); queue.push(...parentsOf(p)); }
        }
        ancestors.set(id, seen);
      }
      return ancestors.get(id);
    };
    const branchSources = new Map();
    for (const s of steps) for (const b of s.branches) if (b.to && stepById.has(b.to)) branchSources.set(b.to, [...(branchSources.get(b.to) || []), s.id]);
    const viaBranch = (p, id) => (branchSources.get(id) || []).some(q => !ancestorsOf(q).has(id) && (q === p || ancestorsOf(q).has(p)));
    for (const s of steps) flowNodes.set(s.id, { id: s.id, kind: 'step', step: s });
    for (const s of steps) for (const p of s.parents) if (stepById.has(p) && !viaBranch(p, s.id)) flowEdges.push({ from: p, to: s.id, label: '' });
    for (const s of steps) {
      s.branches.forEach((b, k) => {
        if (b.to) { if (stepById.has(b.to)) flowEdges.push({ from: s.id, to: b.to, label: b.when }); }
        else {
          const id = `${s.id}~${k}`;
          flowNodes.set(id, { id, kind: 'result', label: b.then, sub: '' });
          flowEdges.push({ from: s.id, to: id, label: b.when });
        }
      });
    }
  }
  for (const [i, node] of (Array.isArray(flow.nodes) ? flow.nodes : []).entries()) {
    const w = `flow.nodes[${i}]`;
    if (!node || !isStr(node.id) || !/^[A-Za-z0-9_-]+$/.test(node.id)) { problems.push(`${w}.id: 英数字・_・- で書く`); continue; }
    if (flowNodes.has(node.id) || stepIds.has(node.id)) { problems.push(`${w}.id: "${node.id}" はステップか他のノードと重複している`); continue; }
    const kind = node.kind ?? 'other';
    if (!(kind in NODE_KINDS)) { problems.push(`${w}.kind: ${Object.keys(NODE_KINDS).join(' / ')} のどれかにする`); continue; }
    if (!isStr(node.label)) { problems.push(`${w}.label: 表示名を書く`); continue; }
    flowNodes.set(node.id, { id: node.id, kind, label: node.label, sub: typeof node.sub === 'string' ? node.sub : NODE_KINDS[kind] });
  }
  if (flow.nodes !== undefined && !Array.isArray(flow.nodes)) problems.push('flow.nodes: 配列で書く');
  if (flow.edges !== undefined && !Array.isArray(flow.edges)) problems.push('flow.edges: 配列で書く');
  for (const [i, e] of (Array.isArray(flow.edges) ? flow.edges : []).entries()) {
    const w = `flow.edges[${i}]`;
    if (!e || !flowNodes.has(e.from) || !flowNodes.has(e.to)) { problems.push(`${w}: from / to にステップidかノードidを書く`); continue; }
    flowEdges.push({ from: e.from, to: e.to, label: typeof e.label === 'string' ? e.label : '' });
  }

  const pageRels = [...new Set([...steps.map(s => s.file), ...notes.map(n => n.file)])];
  if (pageRels.includes(GUIDE_COVER_NAME.replace(/\.html$/, ''))) problems.push(`リポジトリ直下の「${GUIDE_COVER_NAME.replace(/\.html$/, '')}」は表紙のファイル名と衝突するため対象にできない`);

  if (problems.length) {
    console.error(`guide.json に ${problems.length} 件の問題がある。直して再実行する:`);
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }

  // 順路に無い変更ファイルにも、差分を見るためのページを作る(ファイル名順に DIFF_PAGE_LIMIT 件まで)。
  // 削除されたファイル・バイナリ・圧縮されたコード(1行が1000文字を超える)・2万行を超えるファイルは作らず、表紙に一覧だけ出す。
  const coverName = GUIDE_COVER_NAME.replace(/\.html$/, '');
  const diffCandidates = [...diffFiles.values()].filter(f => f.hunks.length && f.status !== 'D' && !f.binary && f.path !== coverName && !pageRels.includes(f.path)).map(f => f.path).sort((a, b) => a.localeCompare(b));
  for (const [rel, buf] of await readTargetFiles(root, diff, diffCandidates.slice(0, DIFF_PAGE_LIMIT * 2))) fileCache.set(rel, toEntry(buf));
  const diffOnlyRels = [];
  for (const rel of diffCandidates) {
    if (diffOnlyRels.length >= DIFF_PAGE_LIMIT) break;
    const e = fileCache.get(rel);
    if (e?.lines && e.lines.length <= 20000 && !e.lines.some(l => l.length > 1000)) diffOnlyRels.push(rel);
  }

  // ---- モデルの組み立て ----
  const typeOrder = Object.keys(types);
  const findingTypes = typeOrder.filter(t => types[t].finding);
  for (const s of steps) {
    const fd = diffFiles.get(s.file);
    s.plus = 0; s.minus = 0;
    if (fd) for (let n = s.line; n <= s.end; n++) { if (fd.added.has(n) || fd.modified.has(n)) s.plus++; s.minus += (fd.deleted.get(n) || []).length; }
    s.diff = s.plus + s.minus > 0;
  }
  const stepIndex = new Map(steps.map((s, i) => [s.id, i]));
  for (const n of notes) {
    if (n.step) continue;
    const inFile = steps.filter(s => s.file === n.file);
    const containing = inFile.filter(s => n.line >= s.line && n.line <= s.end).sort((a, b) => (a.end - a.line) - (b.end - b.line));
    const before = inFile.filter(s => s.line <= n.line).sort((a, b) => b.line - a.line);
    n.step = (containing[0] || before[0] || inFile[0])?.id ?? null;
  }
  notes.sort((a, b) => (stepIndex.get(a.step) ?? 1e9) - (stepIndex.get(b.step) ?? 1e9) || a.file.localeCompare(b.file) || a.line - b.line || typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));
  notes.forEach((n, i) => { n.key = `note-${i + 1}`; });
  const findings = notes.filter(n => types[n.type].finding);
  const typeCount = t => (t === 'explain' ? steps.length : 0) + notes.filter(n => n.type === t).length;
  const presentTypes = typeOrder.filter(t => typeCount(t) > 0);

  const pageFileOf = rel => path.join(guideDir, ...rel.split('/')) + '.html';
  const pages = new Map([...pageRels, ...diffOnlyRels].map(rel => [rel, pageFileOf(rel)]));
  const coverFile = path.join(guideDir, GUIDE_COVER_NAME);
  const manifestFiles = new Set(manifest.files);
  const stepAnchor = s => `step-${s.id}`;
  const linkTo = (fromFile, rel, anchor) => `${fromFile === pages.get(rel) ? '' : hrefFrom(fromFile, pages.get(rel))}#${anchor}`;
  const stepHref = (s, fromFile) => linkTo(fromFile, s.file, stepAnchor(s));
  const noteHref = (n, fromFile) => linkTo(fromFile, n.file, n.key);
  const children = new Map(steps.map(s => [s.id, steps.filter(c => c.parents.includes(s.id))]));
  // ルートの表示。ルートが1つだけなら「通るルート」は出さない。リンクの #… の後ろの @rN で、開いたページのルートを決める。
  const multiRoute = routeList.length > 1;
  const rname = r => (r.unknown ? '呼び出し元が未確認' : `ルート${r.no}`);
  const routeHref = (r, s, fromFile) => `${stepHref(s, fromFile)}@${r.id}`;
  const through = id => {
    const direct = routeList.filter(r => r.steps.includes(id));
    const via = realRoutes.filter(r => !r.steps.includes(id) && r.cont.some(c => routeById.get(c.route).steps.includes(id)))
      .map(r => ({ r, via: r.cont.map(c => routeById.get(c.route)).filter((x, i, a) => x.steps.includes(id) && a.indexOf(x) === i) }));
    return { direct, via };
  };
  // そのステップを通るルートの札。fromFile を渡すとリンク(表紙)、渡さなければその場でルートを切り替える札(サイドバーの一覧の中)にする。
  const routeChips = (id, fromFile = null) => {
    if (!multiRoute || !id) return '';
    const { direct, via } = through(id);
    const chip = (r, label, cls, target) => (fromFile
      ? `<a class="rt${cls}" href="${esc(routeHref(r, target, fromFile))}" title="${esc(`${rname(r)}: ${r.title}`)}">${esc(label)}</a>`
      : `<span class="rt${cls}" data-route-go="${r.id}" title="${esc(`${rname(r)}: ${r.title}`)}">${esc(label)}</span>`);
    return direct.map(r => chip(r, rname(r), r.unknown ? ' unk' : '', stepById.get(id))).join('')
      + via.map(x => chip(x.r, `${rname(x.r)}（${x.via.map(v => v.no).join('・')} 経由）`, ' via', stepById.get(x.r.steps[0]))).join('');
  };

  // 変更箇所: ページを作るファイルの差分を、ファイル名順・位置順に並べて通し番号(k)を振る。r はファイルの順番。
  // 変更箇所と重なるステップ・指摘も求めておく(表紙の一覧とサイドバーで、どのステップの変更かを示す)。
  const changes = [];
  const changesByFile = new Map();
  const changeFiles = [];
  for (const rel of [...pages.keys()].filter(r => diffFiles.has(r)).sort((a, b) => a.localeCompare(b))) {
    const fd = diffFiles.get(rel);
    const { lines } = fileCache.get(rel);
    const blocks = changeBlocks(fd);
    if (!blocks.length) continue;
    const list = blocks.map(b => {
      const c = { ...b, k: changes.length, r: changeFiles.length, file: rel };
      const first = Math.ceil(c.lo); const last = Math.floor(c.hi);
      // 一覧に見せる行: 変更の行があれば、空行でない最初の変更の行とその変更前の行(変わった部分つき)。
      // 無ければ、空行でない最初の削除行と、空行でない最初の追加行。
      const newNs = [];
      for (let n = first; n <= last; n++) if (fd.added.has(n) || fd.modified.has(n)) newNs.push(n);
      const delKeys = [...fd.deleted.keys()].filter(k => k - 0.5 >= c.lo && k - 0.5 <= c.hi).sort((a, b) => a - b);
      const oldLines = delKeys.flatMap(k => fd.deleted.get(k)).map(t => t.replace(/\r$/, ''));
      const delKey = delKeys[0];
      const pick = list => list.find(t => t.trim()) ?? list[0];
      const modN = newNs.find(n => fd.modified.has(n) && lines[n - 1].trim());
      c.label = c.plus ? (first === last ? `${first} 行目` : `${first}–${last} 行目`) : delKey > lines.length ? '末尾' : `${delKey} 行目の前`;
      c.what = c.plus && c.minus ? '変更' : c.plus ? '追加' : '削除';
      if (modN != null) {
        const old = fd.oldText.get(modN).replace(/\r$/, '');
        const wd = wordDiff(old, lines[modN - 1]);
        // 変わった部分より前は両方の行で同じなので、同じ位置から切り出す
        const focus = Math.min(wd?.a[0]?.[0] ?? Infinity, wd?.b[0]?.[0] ?? Infinity);
        c.preview = [{ sign: '−', text: old, ranges: wd?.a, focus }, { sign: '+', text: lines[modN - 1], ranges: wd?.b, focus }].map(p => ({ ...p, focus: Number.isFinite(p.focus) ? p.focus : 0 }));
      } else {
        c.preview = [oldLines.length && { sign: '−', text: pick(oldLines) }, newNs.length && { sign: '+', text: pick(newNs.map(n => lines[n - 1])) }].filter(Boolean);
      }
      c.steps = steps.filter(s => s.file === rel && c.lo <= s.end && c.hi >= s.line - 0.5);
      c.notes = findings.filter(n => n.file === rel && n.line <= c.hi + 0.5 && n.end >= c.lo - 0.5);
      changes.push(c);
      return c;
    });
    changesByFile.set(rel, list);
    changeFiles.push(rel);
  }
  const changeHref = (c, fromFile) => linkTo(fromFile, c.file, `chg-${c.k}`);
  const pm = (p, m) => `<span class="plus">+${p}</span> <span class="minus">−${m}</span>`;
  const closeBtn = key => `<button type="button" class="note-x" data-close-note="${key}" aria-label="閉じる" title="閉じる">×</button>`;

  // 定義リンク: 通常生成で求めた結果(作業ツリーの内容)を使う。ガイドのファイルが記録時と違う内容なら、そのページには付けない。
  // リンク先は、ガイドにあって記録時と同じ内容のファイルならガイドのページ、それ以外は通常のページ(記録時と同じ内容)にする。
  const xref = await readXref(outputDir);
  const guideHashes = new Map();
  const guideHash = rel => {
    if (!guideHashes.has(rel)) guideHashes.set(rel, sourceHash(fileCache.get(rel).normalized));
    return guideHashes.get(rel);
  };
  const xrefStats = { links: 0, pages: 0, skipped: [] };
  function definitionLinks(rel, normalized, outFile) {
    if (!xref) return null;
    const links = xrefLinks(xref, rel, normalized, (target, line) => {
      const label = `${target}:${line}`;
      if (pages.has(target) && (line === 1 || xref.files[target]?.hash === guideHash(target))) {
        return target === rel ? { href: `#L${line}`, label, blank: false } : { href: `${hrefFrom(outFile, pages.get(target))}#L${line}`, label, blank: true };
      }
      if (manifestFiles.has(target)) return { href: `${hrefFrom(outFile, outputFileFor(outputDir, target))}#L${line}`, label, blank: true };
      return null;
    });
    if (!links && xref.files[rel]?.refs.length) xrefStats.skipped.push(rel);
    return links;
  }

  const tree = makeTree(manifest.files);
  sortTree(tree);

  function explorer(fromFile, currentRel) {
    return renderTree(tree, fromFile, {
      outputDir,
      hrefFor: rel => (pages.has(rel) ? hrefFrom(fromFile, pages.get(rel)) : null),
      decorate: rel => {
        const fd = diffFiles.get(rel);
        const isPage = pages.has(rel);
        if (!fd && !isPage) return null;
        const cls = [fd ? `tf-${fd.status.toLowerCase()}` : '', isPage ? 'tf-g' : '', rel === currentRel ? 'tf-here' : ''].filter(Boolean).join(' ');
        let after = '<span class="tf-d">';
        if (isPage) {
          for (const t of findingTypes) {
            const c = findings.filter(n => n.file === rel && n.type === t).length;
            if (c) after += `<span class="fc t-${t}">${shapeEl(types, t)}${c}</span>`;
          }
          for (const s of steps.filter(x => x.file === rel)) after += `<span class="badge${s.diff ? ' d' : ''}" data-step="${s.id}">${s.n}</span>`;
        }
        if (fd) after += `<span class="scm">${fd.status}</span>`;
        return { cls, after: `${after}</span>` };
      },
    });
  }

  function panel(fromFile, rel) {
    const chips = presentTypes.map(t => `<button type="button" class="chip t-${t}" data-type="${t}" aria-pressed="true">${shapeEl(types, t)}<span>${esc(types[t].short)}</span><b>${typeCount(t)}</b></button>`).join('');
    const findingItems = findings.map(n => `<a class="f-i t-${n.type}" data-id="${n.key}" href="${noteHref(n, fromFile)}">${shapeEl(types, n.type)}<span class="f-t">${esc(n.title)}</span><span class="f-l"><span class="f-k">${esc(types[n.type].short)}</span>${esc(basename(n.file))}:${n.line}${routeChips(n.step)}</span></a>`).join('');
    const hasF = findings.length > 0;
    const hasC = changes.length > 0;
    // 変更箇所はファイルごとにまとめる。多い場合は、開いているファイルの変更箇所だけ展開し、ほかのファイルは見出しだけにする。
    const changeItems = changeFiles.map(f => {
      const fd = diffFiles.get(f);
      const list = changesByFile.get(f);
      let h = `<a class="c-f${f === rel ? ' here' : ''}" href="${changeHref(list[0], fromFile)}" title="${esc(f)}"><span class="c-fn">${esc(basename(f))}</span><span class="scm">${fd.status}</span><span class="c-n">${pm(fd.plus, fd.minus)}</span></a>`;
      if (changes.length <= CHANGE_LIST_ALL || f === rel) {
        h += list.map(c => `<a class="c-i" data-id="chg-${c.k}" href="${changeHref(c, fromFile)}"><span class="c-l">${esc(c.label)}</span><span class="c-w">${c.what}</span>${c.steps.length ? '' : '<span class="tag tag-out" title="順路のステップに含まれていない変更">順路外</span>'}<span class="c-n">${pm(c.plus, c.minus)}</span>${c.steps.map(s => `<span class="badge d" data-step="${s.id}" title="${esc(`ステップ ${s.n}: ${s.title}`)}">${s.n}</span>`).join('')}${c.steps.length ? routeChips(c.steps[0].id) : ''}</a>`).join('');
      }
      return h;
    }).join('');
    // 「ルートで読む」の枠(選んだルートだけが対象)と、「ガイド全体」の枠(全件)に分ける。ルートの中身はページの処理が描く。
    const tabs = [...(hasF ? [['findings', '指摘', findings.length]] : []), ...(hasC ? [['changes', '差分', changes.length]] : [])];
    const routeBox = `<section class="sb-sec sb-route" aria-label="ルートで読む"><div class="sb-h">ルートで読む</div><p class="sb-d">${multiRoute ? 'この枠の中は、選んだルートだけを対象にする。' : '入口から、実行される順に読む。'}</p>`
      + `<div class="subh">ルート</div>${routeList.length > 6 ? '<input class="rfilter" id="g-rfilter" type="search" placeholder="ルートを絞り込む" aria-label="ルートを絞り込む">' : ''}<div id="g-routes"></div>`
      + `<div class="subh" id="g-stack-h">コールスタック</div><div class="stack" id="g-stack"></div>`
      + `<div class="subh" id="g-steps-h">順路</div><div class="plist" id="g-steps"></div>`
      + `<div class="navs"><a class="nb" id="g-prev">◀ 前へ</a><a class="nb" id="g-up">↑ 呼び出し元</a><a class="nb" id="g-next">次へ ▶</a></div><div class="rpos" id="g-rpos"></div></section>`;
    const allBox = tabs.length ? `<section class="sb-sec sb-all" aria-label="ガイド全体"><div class="sb-h">ガイド全体</div><p class="sb-d">ルートで絞らず、全件を出す。${multiRoute ? 'どのルートで起きるかは、各項目のルート番号で示す。' : ''}</p>`
      + `<div class="ptabs" role="tablist">${tabs.map(([id, label, n], i) => `<button type="button" class="ptab" role="tab" data-ptab="${id}" aria-selected="${i === 0}">${label}<b>${n}</b></button>`).join('')}</div>`
      + (hasF ? `<div class="plist" id="g-findings">${findingItems}</div>` : '')
      + (hasC ? `<div class="plist" id="g-changes" hidden><div class="c-key"><span><b class="plus">+</b>追加・変更後の行</span><span><b class="minus">−</b>削除・変更前の行</span><span><i class="wa">濃い色</i><i class="wr">濃い色</i>行の中で変わった部分</span></div>${changeItems}</div>` : '')
      + (hasF ? '<div class="navs" id="g-nav-findings"><a class="nb" id="g-pf">◀ 前の指摘</a><a class="nb" id="g-nf">次の指摘 ▶</a></div>' : '')
      + (hasC ? '<div class="navs" id="g-nav-changes" hidden><a class="nb" id="g-pc">◀ 前の変更</a><a class="nb" id="g-nc">次の変更 ▶</a></div>' : '')
      + '</section>' : '';
    return `<section class="guide-panel"><div class="sidebar-title">ガイド</div><div class="g-title"><a href="${hrefFrom(fromFile, coverFile)}">${esc(guide.title)}</a></div>`
      + `<div class="subh">表示する解説の種類</div><div class="filters">${chips}</div>`
      + routeBox + allBox
      + `<div class="keys"><span>番号・印を押す: 解説・指摘を開く／閉じる</span><span>n / p: 次・前のステップ</span>${multiRoute ? '<span>r / Shift+R: 次・前のルート</span>' : ''}${hasF ? '<span>F8 / Shift+F8: 次・前の指摘</span>' : ''}${hasC ? '<span>] / [: 次・前の変更</span>' : ''}</div></section>`;
  }

  function stepNote(s, fromFile) {
    let h = `<div class="note t-explain" id="${stepAnchor(s)}"><div class="note-h"><span class="kl t-explain">${shapeEl(types, 'explain')}${esc(types.explain.label)}</span><a class="badge${s.diff ? ' d' : ''}" data-step="${s.id}" href="#${stepAnchor(s)}">${s.n}</a><strong>${esc(s.title)}</strong><span class="tag tag-${s.kind}">${KINDS[s.kind]}</span>${s.callerUnknown ? UNKNOWN_TAG : ''}${s.diff ? '<span class="tag tag-diff">差分</span>' : ''}<span class="pos" data-pos="${s.id}"></span>${closeBtn(stepAnchor(s))}</div>${paras(s.body)}`;
    if (multiRoute) h += `<div class="via">このステップを通るルート<span class="routes-cell" data-via="${s.id}">${routeChips(s.id, fromFile)}</span></div>`;
    if (s.diff) {
      const cs = changes.filter(c => c.steps.includes(s));
      h += `<div class="chg">このステップの変更　${pm(s.plus, s.minus)}${cs.length ? `　${cs.map(c => `<a href="${changeHref(c, fromFile)}">${esc(c.label)}（${c.what}）</a>`).join('<span>／</span>')}` : ''}</div>`;
    }
    if (s.branches.length) {
      h += `<table class="br"><tr><th>条件</th><th>結果</th></tr>${s.branches.map(b => {
        const t = b.to ? stepById.get(b.to) : null;
        return `<tr><td>${inline(b.when)}</td><td>${inline(b.then)}${t ? `　<a href="${stepHref(t, fromFile)}">→ ${circ(t.n)} ${esc(t.title)}</a>` : ''}</td></tr>`;
      }).join('')}</table>`;
    }
    if (s.callerUnknown) h += `<div class="unv">呼び出し元が未確認: ${inline(s.callerUnknown)}</div>`;
    if (s.unverified) h += `<div class="unv">未確認: ${inline(s.unverified)}</div>`;
    const branchTo = new Set(s.branches.map(b => b.to).filter(Boolean));
    const links = s.links ? s.links.map(l => ({ t: stepById.get(l.to), label: l.label })) : children.get(s.id).filter(c => !branchTo.has(c.id)).map(c => ({ t: c, label: '' }));
    if (links.length) h += `<div class="links">${links.map(({ t, label }) => `<a class="lk" href="${stepHref(t, fromFile)}">${label ? inline(label) : `↓ 呼び出し先: ${circ(t.n)} ${esc(t.title)}`}</a>`).join('')}</div>`;
    return `${h}</div>`;
  }

  function noteBox(n) {
    const range = n.line === n.end ? `${n.line} 行目` : `${n.line}–${n.end} 行目`;
    let h = `<div class="note t-${n.type}" id="${n.key}"><div class="note-h"><span class="kl t-${n.type}">${shapeEl(types, n.type)}${esc(types[n.type].label)}</span><strong>${esc(n.title)}</strong><span class="pos">${range}</span>${closeBtn(n.key)}</div>${paras(n.body)}`;
    if (n.fix) h += `<div class="fix"><span>修正案</span><pre>${highlightCode(n.fix.replace(/\r\n?/g, '\n'), n.file)}</pre></div>`;
    return `${h}</div>`;
  }

  function codePage(rel) {
    const outFile = pages.get(rel);
    const entry = fileCache.get(rel);
    const fd = diffFiles.get(rel);
    const { lines } = entry;
    const links = definitionLinks(rel, entry.normalized, outFile);
    const hl = highlightCode(entry.normalized, rel, links).split('\n');
    const used = links ? [...links.values()].filter(l => l.used) : [];
    if (used.length) { xrefStats.links += used.length; xrefStats.pages++; }
    const menu = used.some(l => l.open.includes('data-xm=')) ? `<script>${XREF_MENU_SCRIPT}</script>` : '';
    const fileSteps = steps.filter(s => s.file === rel);
    const fileNotes = notes.filter(n => n.file === rel);
    // 注釈は対象行の直後に挟む。ステップの範囲内にある注釈は、その範囲(最も狭いもの)の末尾にまとめる。
    // 同じ位置では、ステップの解説を先に、残りは行番号順(サイドバーの指摘一覧と同じ順)に並べる。
    // 解説・指摘は閉じた状態で出し、行番号の横の番号(ステップ)と印(指摘)のボタンで開閉する
    const placements = fileSteps.map(s => ({ at: s.end, order: 0, sub: s.n, kind: 0, type: 'explain', key: stepAnchor(s), html: stepNote(s, outFile) }));
    for (const n of fileNotes) {
      const inside = fileSteps.filter(s => n.end >= s.line && n.end <= s.end).sort((a, b) => (a.end - a.line) - (b.end - b.line));
      placements.push({ at: inside.length ? inside[0].end : n.end, order: 1, sub: n.line, kind: typeOrder.indexOf(n.type), type: n.type, key: n.key, html: noteBox(n) });
    }
    placements.sort((a, b) => a.at - b.at || a.order - b.order || a.sub - b.sub || a.kind - b.kind);
    const group = (items, key) => items.reduce((m, x) => m.set(x[key], [...(m.get(x[key]) || []), x]), new Map());
    const placeAt = group(placements, 'at');
    const badgeAt = group(fileSteps, 'line');
    const markAt = group(fileNotes, 'line');
    // 差分の行: 追加・変更後の行は +、削除・変更前の行は − を付けて色を塗る。変更の行は、変更前の行と単語単位で比べ、変わった部分を濃くする。
    // 削除行には、直前に置く行の番号を data-line に持たせる(その行を含むステップの範囲として一緒に強調する)。
    // 各行に、属する変更箇所の番号(data-chg)を付け、変更箇所の最初の行に移動先(#chg-k)を置く。行は上から順に出すので、変更箇所も先頭から順に進めて探す。
    const blocks = changesByFile.get(rel) || [];
    let bi = 0;
    const anchored = new Set();
    const chg = pos => {
      while (bi < blocks.length && blocks[bi].hi < pos) bi++;
      const b = bi < blocks.length && blocks[bi].lo <= pos ? blocks[bi] : null;
      if (!b) return { attr: '', mark: '' };
      const mark = anchored.has(b.k) ? '' : `<span class="chg-a" id="chg-${b.k}"></span>`;
      anchored.add(b.k);
      return { attr: ` data-chg="${b.k}"`, mark };
    };
    const pairs = new Map();
    const pairOf = n => {
      if (!pairs.has(n)) pairs.set(n, fd?.modified.has(n) && fd.oldText.has(n) ? wordDiff(fd.oldText.get(n).replace(/\r$/, ''), lines[n - 1]) : null);
      return pairs.get(n);
    };
    const delRow = (d, at, i) => {
      const c = chg(at - 0.5);
      const pair = fd.oldText.get(at + i) === d ? pairOf(at + i) : null;
      return `<tr class="row del" data-line="${at}"${c.attr}><td class="ln"></td><td class="dm">${c.mark}</td><td class="st"></td><td class="mkc"></td><td class="src">${markRanges(highlightCode(d.replace(/\r$/, ''), rel), pair?.a)}</td></tr>`;
    };
    const rows = [];
    for (let n = 1; n <= lines.length; n++) {
      (fd?.deleted.get(n) || []).forEach((d, i) => rows.push(delRow(d, n, i)));
      const cls = fd?.added.has(n) ? ' add' : fd?.modified.has(n) ? ' mod' : '';
      const c = chg(n);
      const badges = (badgeAt.get(n) || []).map(s => `<button type="button" class="nbtn" data-toggle-note="${stepAnchor(s)}" aria-expanded="false" aria-controls="${stepAnchor(s)}" title="${esc(`ステップ ${s.n}: ${s.title}（押すと解説を開く・閉じる）`)}"><span class="badge${s.diff ? ' d' : ''}" data-step="${s.id}">${s.n}</span></button>`).join('');
      const marks = (markAt.get(n) || []).map(x => `<button type="button" class="mkb t-${x.type}" data-toggle-note="${x.key}" aria-expanded="false" aria-controls="${x.key}" title="${esc(`${types[x.type].label}: ${x.title}（押すと開く・閉じる）`)}">${shapeEl(types, x.type)}</button>`).join('');
      const src = hl[n - 1] ?? esc(lines[n - 1]);
      rows.push(`<tr class="row${cls}" id="L${n}" data-line="${n}"${c.attr}><td class="ln">${n}</td><td class="dm">${c.mark}</td><td class="st">${badges}</td><td class="mkc">${marks}</td><td class="src">${cls === ' mod' ? markRanges(src, pairOf(n)?.b) : src}</td></tr>`);
      for (const p of placeAt.get(n) || []) rows.push(`<tr class="note-row nr-${p.type}" data-note="${p.key}" hidden><td class="ln"></td><td class="dm"></td><td class="st"></td><td class="mkc"></td><td class="note-cell">${p.html}</td></tr>`);
    }
    (fd?.deleted.get(lines.length + 1) || []).forEach((d, i) => rows.push(delRow(d, lines.length + 1, i)));
    const plain = s => String(s).replace(/`/g, '');
    const data = {
      page: rel,
      guide: guideName,
      firstStep: fileSteps[0]?.id || null,
      types: typeOrder,
      steps: steps.map(s => ({
        id: s.id, n: s.n, title: s.title, anchor: stepAnchor(s), href: stepHref(s, outFile), parents: s.parents, to: s.branches.map(b => b.to).filter(Boolean),
        unknown: !!s.callerUnknown, diff: s.diff, file: s.file, line: s.line, end: s.end, loc: `${basename(s.file)}:${s.line}`,
        tags: `${s.kind !== 'call' ? `<span class="tag tag-${s.kind}">${KINDS[s.kind]}</span>` : ''}${s.callerUnknown ? UNKNOWN_TAG : ''}${s.diff ? '<span class="tag tag-diff">差分</span>' : ''}`,
        ends: s.branches.filter(b => !b.to).map(b => ({ when: plain(b.when), then: plain(b.then) })),
      })),
      routes: routeList.map(r => ({ id: r.id, no: r.no, title: r.title, group: r.group, end: r.end, steps: r.steps, unknown: !!r.unknown, cont: r.cont.map(c => ({ from: c.from, route: c.route, when: plain(c.when) })) })),
      findings: findings.map(n => ({ id: n.key, type: n.type, href: noteHref(n, outFile), file: n.file, line: n.line, end: n.end, step: n.step })),
      // 次・前の変更へ移るための一覧。変更箇所が多い場合は、このファイルの全部と、ほかのファイルの最初と最後だけ持つ。
      changes: (changes.length <= CHANGE_LIST_ALL ? changes : changes.filter((c, i) => c.file === rel || changes[i - 1]?.file !== c.file || changes[i + 1]?.file !== c.file))
        .map(c => ({ id: `chg-${c.k}`, k: c.k, r: c.r, lo: c.lo, hi: c.hi, href: changeHref(c, outFile) })),
      pageRank: changeFiles.indexOf(rel),
    };
    const baseLink = manifestFiles.has(rel) ? ` · <a class="base-link" href="${hrefFrom(outFile, outputFileFor(outputDir, rel))}">通常のページ</a>` : '';
    const counts = findingTypes.map(t => [t, findings.filter(n => n.type === t).length]).filter(([, c]) => c).map(([t, c]) => `<span class="sc" title="${esc(types[t].label)}">${shapeEl(types, t)}${c}</span>`).join('');
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(`${rel} — ${guide.title}`)}</title><style>${baseCss()}${guideCss(types)}</style></head>`
      + `<body class="guide-page"><div class="app"><div class="titlebar">${esc(repoName)} — Codebase Guide<a class="tb-guide" href="${hrefFrom(outFile, coverFile)}">ガイド: ${esc(guide.title)}</a></div>`
      + `<aside class="sidebar">${panel(outFile, rel)}<div class="sidebar-title">Explorer</div><nav class="tree">${explorer(outFile, rel)}</nav></aside>`
      + `<main class="main"><div class="tabbar"><div class="tab">${esc(basename(rel))}${fd ? `<span class="scm">${fd.status}</span>` : ''}</div></div><div class="crumbs">${esc(rel.split('/').join('  ›  '))}${placements.length ? '<span class="ntools"><span>解説・指摘</span><button type="button" data-notes="open">すべて開く</button><button type="button" data-notes="close">すべて閉じる</button></span>' : ''}<span class="meta">${esc(languageFor(rel))} · ${lines.length} lines${used.length ? ` · 定義リンク ${used.length}` : ''}${baseLink}</span></div>`
      + (fileSteps.length || fileNotes.length ? '' : `<div class="offr">このファイルの変更は、順路のステップに含まれていない（順路の外の変更）。${blocks.length} か所　${pm(fd.plus, fd.minus)}</div>`)
      + `<div class="editor"><table class="code-table g"><tbody>${rows.join('')}</tbody></table></div></main>`
      + `<footer class="status"><span>${esc(diff ? `差分 ${diff.label}` : 'ガイド')}</span>${counts}<span id="g-route-s"></span><span>ステップ <b id="g-pos"></b></span><span class="r">${esc(languageFor(rel))}</span><span>UTF-8</span></footer></div>`
      + `<script>(${guideRuntime.toString()})(${JSON.stringify(data).replace(/</g, '\\u003c')});</script>${menu}</body></html>`;
  }

  // 全体図の配置: 矢印を左から右へ向け、列は根からの最長の段数にする。2列以上またぐ矢印は、間の列に中継点を置いて1列ずつに分ける。
  // 各ノードへ入る矢印のうち1本で木を作り、葉を上から順に置き、親は子の中央に置く。ほかの矢印は列の間の縦線でつなぐ。
  // 呼び出し元が未確認のステップ(callerUnknown)からしかたどれないノードは、区切り線の下にまとめる。
  function flowSvg(fromFile) {
    const NODE_H = 54; const ROW = 78; const TOP = 26; const SEP = 52;
    const nodes = [...flowNodes.values()];
    if (!nodes.length) return '<p class="none">全体図に描くノードが無い。</p>';
    const ids = nodes.map(n => n.id);
    const out = new Map(ids.map(id => [id, []]));
    for (const e of flowEdges) out.get(e.from).push(e);
    const hasIn = new Set(flowEdges.map(e => e.to));
    const isUnknown = id => !!flowNodes.get(id).step?.callerUnknown;
    const mainRoots = ids.filter(id => !hasIn.has(id) && !isUnknown(id));
    const unknownRoots = ids.filter(id => !hasIn.has(id) && isUnknown(id));
    // 深さ優先でたどり、たどっている途中のノードへ戻る矢印(繰り返しなど)は「戻り」として列の計算から外す
    const state = new Map(); const back = new Set(); const post = [];
    const dfs = id => {
      state.set(id, 1);
      for (const e of out.get(id)) {
        if (state.get(e.to) === 1) back.add(e);
        else if (!state.has(e.to)) dfs(e.to);
      }
      state.set(id, 2);
      post.push(id);
    };
    for (const id of [...mainRoots, ...unknownRoots]) if (!state.has(id)) dfs(id);
    // どの根からもたどれない循環は、先頭のノードを根にする
    for (const id of ids) if (!state.has(id)) { mainRoots.push(id); dfs(id); }
    const topo = post.reverse();
    const col = new Map(ids.map(id => [id, 0]));
    const inMain = new Set(mainRoots);
    for (const id of topo) {
      for (const e of out.get(id)) {
        if (back.has(e)) continue;
        col.set(e.to, Math.max(col.get(e.to), col.get(id) + 1));
        if (inMain.has(id)) inMain.add(e.to);
      }
    }
    // 配置用のノード(中継点を含む)と、矢印ごとの経路
    const vn = new Map(ids.map(id => [id, { col: col.get(id), group: inMain.has(id) ? 0 : 1, ins: [], outs: [] }]));
    const routes = [];
    for (const e of flowEdges) {
      if (back.has(e)) continue;
      const route = [e.from];
      for (let c = col.get(e.from) + 1; c < col.get(e.to); c++) {
        const id = `~~${vn.size}`;
        vn.set(id, { col: c, group: vn.get(e.from).group, ins: [], outs: [] });
        route.push(id);
      }
      route.push(e.to);
      for (let k = 1; k < route.length; k++) { vn.get(route[k]).ins.push(route[k - 1]); vn.get(route[k - 1]).outs.push(route[k]); }
      routes.push({ e, route });
    }
    // 木の親は、入ってくる矢印のうち同じ区画(区切り線の上か下か)の最初のもの
    for (const v of vn.values()) if (v.ins.length) v.tp = v.ins.find(p => vn.get(p).group === v.group) ?? v.ins[0];
    const kids = new Map([...vn.keys()].map(id => [id, []]));
    for (const [id, v] of vn) for (const o of v.outs) if (vn.get(o).tp === id && !kids.get(id).includes(o)) kids.get(id).push(o);
    let slot = 0; const slots = new Map();
    const place = id => {
      const ch = kids.get(id);
      if (!ch.length) { slots.set(id, slot++); return; }
      ch.forEach(place);
      slots.set(id, (slots.get(ch[0]) + slots.get(ch.at(-1))) / 2);
    };
    const treeRoots = g => [...vn].filter(([, v]) => !v.ins.length && v.group === g).map(([id]) => id);
    treeRoots(0).forEach(place);
    const split = slot;
    treeRoots(1).forEach(place);
    const hasUnknown = slot > split;
    const yOf = id => TOP + slots.get(id) * ROW + (hasUnknown && slots.get(id) >= split ? SEP : 0);
    const LEFT = unknownRoots.length ? 52 : 20;
    const box = new Map();
    for (const n of nodes) {
      let title; let sub;
      if (n.kind === 'step') { title = `${circ(n.step.n)} ${n.step.title}`; sub = `${basename(n.step.file)}:${n.step.line}`; }
      else { title = n.label; sub = n.sub || ''; }
      const w = Math.min(300, Math.max(110, Math.max(textWidth(title, 13), textWidth(sub, 11)) + 26));
      box.set(n.id, { n, title: fitText(title, 13, w - 24), fullTitle: title, sub: fitText(sub, 11, w - 24), w, col: col.get(n.id), y: yOf(n.id) });
    }
    const cols = Math.max(...[...box.values()].map(b => b.col)) + 1;
    const colW = Array(cols).fill(0); const gap = Array(cols).fill(52);
    for (const b of box.values()) colW[b.col] = Math.max(colW[b.col], b.w);
    for (const { e } of routes) if (e.label) gap[col.get(e.from)] = Math.max(gap[col.get(e.from)], textWidth(fitText(e.label, 11, 200), 11) + 34);
    // 列の間の縦線: 木の矢印は元の近く(元ごとに1本)、木以外の矢印は先ごとに右側へ1本ずつ置き、関係のない矢印が同じ線に重ならないようにする
    const lanes = Array.from({ length: cols }, () => new Map());
    for (const { route } of routes) {
      for (let k = 1; k < route.length; k++) {
        const v = vn.get(route[k]);
        if (v.tp !== route[k - 1]) lanes[v.col - 1].set(route[k], null);
      }
    }
    lanes.forEach((m, c) => {
      [...m.keys()].sort((a, b) => yOf(a) - yOf(b)).forEach((id, k) => m.set(id, 14 + 10 * (k + 1)));
      if (m.size) gap[c] = Math.max(gap[c], 14 + 10 * m.size + 24);
    });
    const colX = []; let x = LEFT;
    for (let c = 0; c < cols; c++) { colX.push(x); x += colW[c] + gap[c]; }
    for (const b of box.values()) b.x = colX[b.col];
    const width = Math.ceil(colX[cols - 1] + colW[cols - 1] + 20);
    let height = Math.ceil(Math.max(...[...vn.keys()].map(yOf)) + NODE_H + 18);
    // 矢印の端: ノードは箱の左右、中継点は列の左右
    const end = id => {
      const b = box.get(id);
      if (b) return { l: b.x, r: b.x + b.w, y: b.y + NODE_H / 2, c: b.col };
      const v = vn.get(id);
      return { l: colX[v.col], r: colX[v.col] + colW[v.col], y: yOf(id) + NODE_H / 2, c: v.col };
    };
    const parts = [];
    for (const { e, route } of routes) {
      let d = '';
      let labelAt = null;
      for (let k = 1; k < route.length; k++) {
        const a = end(route[k - 1]); const b = end(route[k]);
        const xm = colX[a.c] + colW[a.c] + (vn.get(route[k]).tp === route[k - 1] ? 14 : lanes[a.c].get(route[k]));
        d += k === 1 ? `M${a.r},${a.y}` : ` H${a.r}`;
        if (Math.abs(a.y - b.y) >= 1) d += ` H${xm} V${b.y}`;
        if (k === 1) labelAt = { x: xm + 6, y: b.y - 6 };
        if (k === route.length - 1) d += ` H${b.l - 2}`;
      }
      // data-ef / data-et(矢印の元と先)と data-n(ノード)は、表紙でルートを選んだときの強調に使う
      const ends = `data-ef="${esc(e.from)}" data-et="${esc(e.to)}"`;
      parts.push(`<path class="e" ${ends} d="${d}" marker-end="url(#ah)"/>`);
      if (e.label) {
        const label = fitText(e.label, 11, 200);
        parts.push(`<text class="el" ${ends} x="${labelAt.x}" y="${labelAt.y}">${esc(label)}${label !== e.label ? `<title>${esc(e.label)}</title>` : ''}</text>`);
      }
    }
    for (const e of back) {
      const a = box.get(e.from); const b = box.get(e.to);
      const ax = a.x + a.w / 2; const bx = b.x + b.w / 2; const ay = a.y + NODE_H; const by = b.y + NODE_H;
      parts.push(`<path class="e back" data-ef="${esc(e.from)}" data-et="${esc(e.to)}" d="M${ax},${ay} C${ax},${ay + 34} ${bx},${by + 34} ${bx},${by + 2}" marker-end="url(#ah)"/>`);
    }
    if (back.size) height += 34;
    if (hasUnknown) {
      const top = TOP + split * ROW + SEP;
      if (split > 0) parts.push(`<line class="sep-l" x1="8" y1="${top - 44}" x2="${width - 8}" y2="${top - 44}"/>`);
      parts.push(`<text class="sep-t" x="8" y="${top - 24}">呼び出し元が未確認</text>`);
    }
    for (const id of unknownRoots) {
      const b = box.get(id); const cy = b.y + NODE_H / 2;
      parts.push(`<path class="e q" d="M${b.x - 30},${cy} H${b.x - 2}" marker-end="url(#ah)"/><text class="qm" x="${b.x - 44}" y="${cy + 5}">?</text>`);
    }
    for (const b of box.values()) {
      const { n } = b;
      const s = n.kind === 'step' ? n.step : null;
      const cls = `n k-${n.kind}${s?.diff ? ' d' : ''}${s?.callerUnknown ? ' u' : ''}`;
      const rx = n.kind === 'result' ? NODE_H / 2 : n.kind === 'db' ? 10 : 4;
      const textX = b.x + (n.kind === 'result' ? 18 : 12);
      let g = `<g class="${cls}" data-n="${esc(n.id)}"><title>${esc(b.fullTitle)}${s?.callerUnknown ? esc(`（呼び出し元が未確認: ${s.callerUnknown}）`) : ''}</title><rect class="box" x="${b.x}" y="${b.y}" width="${b.w}" height="${NODE_H}" rx="${rx}"/>`;
      if (b.sub) g += `<text class="t" x="${textX}" y="${b.y + 23}">${esc(b.title)}</text><text class="s" x="${textX}" y="${b.y + 42}">${esc(b.sub)}</text>`;
      else g += `<text class="t" x="${textX}" y="${b.y + 32}">${esc(b.title)}</text>`;
      if (s?.diff) g += `<text class="dtag" x="${b.x + b.w}" y="${b.y - 6}" text-anchor="end">差分</text>`;
      if (s) {
        let cx = b.x + 5;
        for (const t of findingTypes) {
          const c = findings.filter(f => f.step === s.id && f.type === t).length;
          if (!c) continue;
          const label = `${types[t].short} ${c}`;
          g += svgShape(types[t].shape, cx, b.y - 10, `fm t-${t}`) + `<text class="fmt t-${t}" x="${cx + 8}" y="${b.y - 6}">${esc(label)}</text>`;
          cx += textWidth(label, 11) + 22;
        }
      }
      g += '</g>';
      parts.push(s ? `<a href="${stepHref(s, fromFile)}">${g}</a>` : g);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${guide.title} の全体図`)}"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#707070"/></marker></defs>${parts.join('')}</svg>`;
  }

  // コードページを先に作るので、表紙を作る時点で件数がそろっている
  function xrefSummary() {
    if (!xref) return esc(`なし。${manifest.xref?.reason || '通常生成で定義の場所を求めていない'}`);
    let s = `${xrefStats.links} 件（${xref.engine}。識別子を押すと定義の行を開く）`;
    if (xrefStats.skipped.length) s += `　作業ツリーと内容が違うため付けていないファイル: ${xrefStats.skipped.length}`;
    return esc(s);
  }

  function coverPage() {
    const out = coverFile;
    const short = sha => (sha ? sha.slice(0, 10) : '');
    const changed = [...diffFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
    const plus = changed.reduce((s, f) => s + f.plus, 0);
    const minus = changed.reduce((s, f) => s + f.minus, 0);
    const counts = findingTypes.map(t => ({ t, c: findings.filter(n => n.type === t).length }));
    const facts = [
      ['依頼', inline(guide.request)],
      ['対象の差分', diff ? `<code>${esc(diff.label)}</code>　比較元 ${short(diff.base)} → 比較先 ${diff.target ? short(diff.target) : '作業ツリー'}　${changed.length} ファイル　<span class="plus">+${plus}</span> <span class="minus">−${minus}</span>` : 'なし（作業ツリーのコードを読む）'],
      ['生成', [new Date().toLocaleString('ja-JP'), realRoutes.length ? `${realRoutes.length} ルート` : '', `${steps.length} ステップ`, review ? `指摘 ${findings.length} 件${findings.length ? `（${counts.filter(x => x.c).map(x => `${esc(types[x.t].short)} ${x.c}`).join('・')}）` : ''}` : '', `未確認 ${unverified.length} 件`].filter(Boolean).join('　')],
      ['定義リンク', xrefSummary()],
    ];
    let h = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(guide.title)}</title><style>${baseCss()}${guideCss(types)}</style></head><body class="cover-page"><div class="titlebar">${esc(repoName)} — Codebase Guide</div><main class="cv">`;
    h += `<div><div class="cv-crumbs"><a href="${hrefFrom(out, path.join(outputDir, TREE_PAGE_NAME))}">フォルダーツリー</a> › ガイド</div><h1>${esc(guide.title)}</h1></div>`;
    h += `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    h += `<section><h2>要約</h2><ul class="sum">${guide.summary.map(s => `<li>${inline(s)}</li>`).join('')}</ul></section>`;
    if (review) {
      h += '<section><h2>指摘</h2>';
      if (!findings.length) h += '<p class="none">指摘はない。</p>';
      else {
        if (multiRoute) h += '<p class="cn">ガイド全体の指摘。ルートごとには分けない（1つの指摘が複数のルートにかかるため）。どのルートで起きるかは「通るルート」の列に出す。</p>';
        h += `<div class="fsum">${counts.map(({ t, c }) => `<span class="kl t-${t}">${shapeEl(types, t)}${esc(types[t].label)}　${c}</span>`).join('')}</div>`;
        h += `<table class="ctable"><thead><tr><th style="width:130px">種類</th><th>内容</th><th style="width:300px">場所</th>${multiRoute ? '<th>通るルート</th>' : ''}</tr></thead><tbody>${findings.map(n => {
          const s = n.step ? stepById.get(n.step) : null;
          return `<tr><td><span class="kl t-${n.type}">${shapeEl(types, n.type)}${esc(types[n.type].label)}</span></td><td><a href="${noteHref(n, out)}">${esc(n.title)}</a></td><td><span class="f">${esc(n.file)}:${n.line}</span>${s ? `<div class="f">ステップ ${s.n}: ${esc(s.title)}</div>` : ''}</td>${multiRoute ? `<td><div class="routes-cell">${routeChips(n.step, out)}</div></td>` : ''}</tr>`;
        }).join('')}</tbody></table>`;
      }
      h += '</section>';
    }
    const legend = [];
    if (steps.some(s => s.diff)) legend.push('<span><i></i>差分を含む</span>');
    const kindsUsed = new Set([...flowNodes.values()].map(n => n.kind));
    if (kindsUsed.has('result')) legend.push('<span><i class="r"></i>処理の終わり</span>');
    if (kindsUsed.has('db')) legend.push('<span><i class="db"></i>DB テーブル</span>');
    if (kindsUsed.has('external')) legend.push('<span><i class="x"></i>外部連携</span>');
    if (steps.some(s => s.callerUnknown)) legend.push('<span><i class="u"></i>呼び出し元が未確認</span>');
    legend.push('<span>ノードを押すと、そのステップのコードを開く</span>');
    if (multiRoute) legend.push('<span>ルートを選ぶと、そのルートの流れを強調し、ほかを薄くする</span>');
    // ルート: 入口ごとに、通るステップを番号で並べる(同じ番号は同じコード)。エラーなどで途中で終わる分岐は「途中の終わり」に出す。
    const routeRow = r => {
      const first = stepById.get(r.steps[0]);
      const chain = r.steps.map(id => {
        const s = stepById.get(id);
        return `<span class="badge${s.diff ? ' d' : ''}" data-s="${s.id}" title="${esc(`${circ(s.n)} ${s.title}${s.summary ? ` — ${s.summary}` : ''}`)}">${s.n}</span>`;
      }).join('<span class="ar">→</span>');
      const contRoutes = [...new Set(r.cont.map(c => c.route))].map(id => routeById.get(id));
      const tail = contRoutes.length
        ? `<span class="ar">→</span>${contRoutes.map(x => `<a class="rt" href="${esc(routeHref(x, stepById.get(x.steps[0]), out))}" title="${esc(x.title)}">${rname(x)}</a>`).join('<span class="ar">または</span>')}<span class="cw" style="margin-left:4px">へ続く</span>`
        : r.end ? `<span class="ar">→</span><span class="endp">${esc(r.end)}</span>` : '';
      const ends = r.steps.flatMap(id => stepById.get(id).branches.filter(b => !b.to).map(b => `<span>${circ(stepById.get(id).n)} ${inline(b.when)} → ${inline(b.then)}</span>`));
      const diffN = r.steps.filter(id => stepById.get(id).diff).length;
      const fs = findings.filter(n => r.steps.includes(n.step));
      const fm = findingTypes.map(t => [t, fs.filter(n => n.type === t).length]).filter(([, c]) => c).map(([t, c]) => `<span class="fc t-${t}">${shapeEl(types, t)}${c}</span>`).join('');
      return `<tr><td><div class="rname">${multiRoute ? `<span class="rt${r.unknown ? ' unk' : ''}">${r.unknown ? '?' : `ルート${r.no}`}</span>` : ''}<a class="rtl" href="${esc(routeHref(r, first, out))}">${esc(r.title)}</a></div><div class="f">${esc(first.file)}:${first.line}</div></td>`
        + `<td><div class="chain">${chain}${tail}</div>${ends.length ? `<div class="ends">途中の終わり: ${ends.join('')}</div>` : ''}</td>`
        + `${diff ? `<td>${diffN ? `${diffN} ステップ` : '<span class="none">なし</span>'}</td>` : ''}${findings.length ? `<td><div class="fms">${fm || '<span class="none">—</span>'}</div></td>` : ''}</tr>`;
    };
    let routeRows = '';
    let lastGroup = null;
    for (const r of routeList) {
      if (r.group && r.group !== lastGroup) routeRows += `<tr class="grp"><td colspan="${2 + (diff ? 1 : 0) + (findings.length ? 1 : 0)}">${esc(r.group)}<b>${routeList.filter(x => x.group === r.group).length}</b></td></tr>`;
      lastGroup = r.group;
      routeRows += routeRow(r);
    }
    h += `<section><h2>ルート</h2><p class="cn">${multiRoute ? '入口（処理のきっかけ）ごとのルート。番号はステップの番号で、同じ番号は同じコード（共通の処理）。番号にマウスを乗せると、同じステップを通るルートが分かる。' : '入口（処理のきっかけ）から、実行される順に通るステップ。'}${steps.some(s => s.diff) ? '黄色の枠は差分を含むステップ。' : ''}</p>`
      + `<table class="ctable"><thead><tr><th>ルート</th><th>通るステップ</th>${diff ? '<th style="width:90px">差分</th>' : ''}${findings.length ? '<th style="width:90px">指摘の数</th>' : ''}</tr></thead><tbody>${routeRows}</tbody></table></section>`;
    const routeSel = multiRoute ? `<div class="rchips" role="group" aria-label="強調するルート"><button type="button" class="rchip" data-rsel="" aria-pressed="true">すべてのルート</button>${routeList.map(r => `<button type="button" class="rchip" data-rsel="${r.id}" aria-pressed="false">${esc(rname(r))}　${esc(r.title)}</button>`).join('')}</div>` : '';
    h += `<section><h2>全体図</h2>${routeSel}<div class="diagram" id="flow">${flowSvg(out)}</div><div class="legend">${legend.join('')}</div></section>`;
    const shared = multiRoute ? steps.filter(s => through(s.id).direct.filter(r => !r.unknown).length >= 2) : [];
    if (shared.length) {
      h += `<section><h2>共通のステップ</h2><p class="cn">2つ以上のルートが通るステップ。ここを変えると、並んでいるルートすべてに影響する。</p><table class="ctable"><thead><tr><th>ステップ</th><th>通るルート</th>${diff ? '<th style="width:70px">差分</th>' : ''}${findings.length ? '<th style="width:110px">指摘</th>' : ''}</tr></thead><tbody>${shared.map(s => {
        const fs = findings.filter(n => n.step === s.id);
        return `<tr><td><span class="badge${s.diff ? ' d' : ''}">${s.n}</span> <a href="${stepHref(s, out)}">${esc(s.title)}</a><div class="f">${esc(s.file)}:${s.line}</div></td><td><div class="routes-cell">${routeChips(s.id, out)}</div></td>${diff ? `<td>${s.diff ? '<span class="tag tag-diff">差分</span>' : ''}</td>` : ''}${findings.length ? `<td><div class="fms">${fs.map(n => `<span class="fc t-${n.type}">${shapeEl(types, n.type)}${esc(types[n.type].short)}</span>`).join('')}</div></td>` : ''}</tr>`;
      }).join('')}</tbody></table></section>`;
    }
    if (diff) {
      // 変更ファイルごとに、変更箇所(場所・種類・最初の変更行・含まれるステップと指摘)を並べる。ページを作っていないファイルは理由を出す。
      const outside = changes.filter(c => !c.steps.length).length;
      const why = f => {
        if (f.status === 'D') return '削除されたファイル';
        if (f.binary) return 'バイナリ';
        if (!f.hunks.length) return '内容の変更なし（名前・権限の変更だけ）';
        const e = fileCache.get(f.path);
        if (e?.lines) return e.lines.length > 20000 || e.lines.some(l => l.length > 1000) ? '圧縮されたコードか大きいファイルのため、差分のページを作っていない' : `差分のページは ${DIFF_PAGE_LIMIT} ファイルまでのため作っていない`;
        return e ? '読み込めない' : `差分のページは ${DIFF_PAGE_LIMIT} ファイルまでのため作っていない`;
      };
      let listed = 0;
      const rowsHtml = changed.map(f => {
        const href = pages.has(f.path) ? hrefFrom(out, pages.get(f.path)) : manifestFiles.has(f.path) ? hrefFrom(out, outputFileFor(outputDir, f.path)) : null;
        const label = f.status === 'R' && f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
        const list = changesByFile.get(f.path) || [];
        let r = `<tr class="cf"><td>${f.status}</td><td>${href ? `<a href="${href}">${esc(label)}</a>` : esc(label)}${list.length ? `<span class="cw">${list.length} か所</span>` : `<span class="cw">${why(f)}</span>`}</td><td>${pm(f.plus, f.minus)}</td><td></td>${multiRoute ? '<td></td>' : ''}</tr>`;
        for (const c of list) {
          if (listed++ >= COVER_CHANGE_LIMIT) break;
          const where = c.steps.length ? c.steps.map(s => `<a href="${stepHref(s, out)}"><span class="badge d">${s.n}</span> ${esc(s.title)}</a>`).join('<br>') : '<span class="tag tag-out">順路の外</span>';
          const marks = c.notes.map(n => `<a class="cmk" href="${noteHref(n, out)}" title="${esc(`${types[n.type].label}: ${n.title}`)}">${shapeEl(types, n.type)}</a>`).join('');
          const pv = c.preview.map(p => `<div class="pv ${p.sign === '+' ? 'pa' : 'pd'}"><span class="${p.sign === '+' ? 'plus' : 'minus'}">${p.sign}</span> ${snippet(p.text, p.ranges, p.focus)}</div>`).join('');
          r += `<tr class="cb"><td></td><td><a href="${changeHref(c, out)}">${esc(c.label)}</a><span class="cw">${c.what}</span>${pv}</td><td>${pm(c.plus, c.minus)}</td><td>${where}${marks ? `<div class="fms">${marks}</div>` : ''}</td>${multiRoute ? `<td><div class="routes-cell">${c.steps.length ? routeChips(c.steps[0].id, out) : '<span class="none">—</span>'}</div></td>` : ''}</tr>`;
        }
        return r;
      }).join('');
      const scope = changeFiles.length < changed.length ? `変更ファイル ${changed.length} のうち、差分のページがある ${changeFiles.length} ファイルの変更箇所は ${changes.length} か所` : `${changes.length} か所（${changed.length} ファイル）`;
      h += `<section><h2>変更箇所</h2><p class="cn">${scope}。順路のステップに含まれる変更 ${changes.length - outside} か所、順路の外 ${outside} か所。場所を押すと、変更前の行（−）と変更後の行（+）を並べたコードを開く。${listed > COVER_CHANGE_LIMIT ? `ここには先頭の ${COVER_CHANGE_LIMIT} か所だけ並べている。` : ''}</p>`
        + `<table class="ctable"><thead><tr><th style="width:50px">状態</th><th>ファイル・変更箇所</th><th style="width:110px">行数</th><th style="width:280px">順路のステップ・指摘</th>${multiRoute ? '<th>通るルート</th>' : ''}</tr></thead><tbody>${rowsHtml}</tbody></table></section>`;
    }
    // ステップの一覧(ルートをまたいで、番号の順)
    h += `<section><h2>ステップ</h2><table class="ctable"><thead><tr><th style="width:44px">番号</th><th style="width:120px">種別</th><th>ステップ</th><th>内容</th>${multiRoute ? '<th>通るルート</th>' : ''}${findings.length ? '<th style="width:90px">指摘</th>' : ''}</tr></thead><tbody>${steps.map(s => {
      const marks = findings.filter(n => n.step === s.id).map(n => shapeEl(types, n.type)).join('');
      return `<tr><td><span class="badge${s.diff ? ' d' : ''}">${s.n}</span></td><td><span class="tag tag-${s.kind}">${KINDS[s.kind]}</span>${s.callerUnknown ? UNKNOWN_TAG : ''}${s.diff ? '<span class="tag tag-diff">差分</span>' : ''}</td><td><a href="${stepHref(s, out)}">${esc(s.title)}</a><div class="f">${esc(s.file)}:${s.line}</div></td><td>${inline(s.summary || '')}</td>${multiRoute ? `<td><div class="routes-cell">${routeChips(s.id, out)}</div></td>` : ''}${findings.length ? `<td><div class="fms">${marks}</div></td>` : ''}</tr>`;
    }).join('')}</tbody></table></section>`;
    if (unverified.length) {
      h += `<section><h2>未確認事項</h2><ul class="unv-list">${unverified.map(u => {
        const s = u.step ? stepById.get(u.step) : null;
        return `<li>${inline(u.text)}${s ? `<a href="${stepHref(s, out)}">${circ(s.n)} を開く</a>` : ''}</li>`;
      }).join('')}</ul></section>`;
    }
    const coverData = { steps: steps.map(s => s.id), routes: routeList.map(r => ({ id: r.id, steps: r.steps, cont: r.cont.map(c => ({ entry: c.entry, route: c.route })) })) };
    return `${h}</main><script>(${coverRuntime.toString()})(${JSON.stringify(coverData).replace(/</g, '\\u003c')});</script></body></html>`;
  }

  // ---- 書き出し ----
  await fs.mkdir(guideDir, { recursive: true });
  for (const entry of await fs.readdir(guideDir)) {
    if (!KEEP_FILES.has(entry)) await fs.rm(path.join(guideDir, entry), { recursive: true, force: true });
  }
  const written = new Map();
  for (const rel of pages.keys()) written.set(pages.get(rel), codePage(rel));
  written.set(coverFile, coverPage());
  for (const [file, html] of written) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, html);
  }
  const now = new Date();
  const meta = {
    title: guide.title,
    name: guideName,
    builtAt: now.toISOString(),
    builtAtLabel: now.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    diffLabel: diff ? diff.label : '',
    review,
    stepCount: steps.length,
    findingCounts: findingTypes.map(t => ({ type: t, short: types[t].short, count: findings.filter(n => n.type === t).length })),
  };
  await fs.writeFile(path.join(guideDir, GUIDE_META_NAME), `${JSON.stringify(meta, null, 2)}\n`);
  const treeUpdated = await refreshTreePageGuides(outputDir);

  // ---- リンクの検査(生成したページ内の href と #id がすべて存在するか) ----
  const known = new Set([...written.keys()].map(f => path.resolve(f)));
  for (const rel of manifest.files) known.add(path.resolve(outputFileFor(outputDir, rel)));
  known.add(path.resolve(path.join(outputDir, TREE_PAGE_NAME)));
  const ids = new Map([...written].map(([f, html]) => [path.resolve(f), new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))]));
  let checked = 0;
  const broken = [];
  const unescape = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const [file, html] of written) {
    const body = html.replace(/<script>[\s\S]*?<\/script>/g, '');
    const hrefs = [...body.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
    // 定義の候補が複数あるリンクの候補(data-xm)も調べる
    for (const m of body.matchAll(/data-xm="([^"]*)"/g)) for (const [h] of JSON.parse(unescape(m[1]))) hrefs.push(h);
    for (const href of hrefs) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      checked++;
      const [p, hash] = href.split('#');
      const target = p ? path.resolve(path.dirname(file), decodeURIComponent(p)) : path.resolve(file);
      if (!known.has(target)) broken.push(`${toPosix(path.relative(outputDir, file))} → ${href}`);
      // #… の後ろの @rN はルートの指定なので、要素の id としては見ない。ルートが存在するかも確かめる。
      else if (hash && ids.has(target) && (!ids.get(target).has(decodeURIComponent(hash).replace(/@.*$/, '')) || (/@/.test(hash) && !routeById.has(decodeURIComponent(hash).replace(/^.*@/, ''))))) broken.push(`${toPosix(path.relative(outputDir, file))} → ${href}（#${hash} が無い）`);
    }
  }

  const rel = p => toPosix(path.relative(root, p));
  console.log(`Guide          : ${guide.title}`);
  console.log(`Guide dir      : ${rel(guideDir)}`);
  console.log(`Cover          : ${rel(coverFile)}`);
  console.log(`Routes         : ${realRoutes.length}${realRoutes.length ? `（${realRoutes.map(r => `${rname(r)} ${r.title}`).join(' / ')}）` : ''}${routeList.some(r => r.unknown) ? '　ほかに、呼び出し元が未確認のステップがある' : ''}`);
  console.log(`Steps          : ${steps.length}`);
  console.log(`Notes          : ${typeOrder.map(t => `${types[t].short} ${t === 'explain' ? notes.filter(n => n.type === t).length : findings.filter(n => n.type === t).length}`).join(' / ')}（解説は各ステップにも1件ずつ）`);
  console.log(`Unverified     : ${unverified.length}`);
  console.log(`Pages          : コード ${pageRels.length}${diffOnlyRels.length ? ` + 差分だけ ${diffOnlyRels.length}` : ''} + 表紙 1`);
  if (diff) console.log(`Changes        : ${changes.length} か所（順路の外 ${changes.filter(c => !c.steps.length).length}）${diffCandidates.length > diffOnlyRels.length ? `。差分のページを作っていない変更ファイル: ${diffCandidates.length - diffOnlyRels.length}` : ''}`);
  console.log(`Diff           : ${diff ? `${diff.label}（${diffFiles.size} ファイル）` : 'なし'}`);
  console.log(`Tree page      : ${treeUpdated ? 'ガイド一覧を更新した' : `${TREE_PAGE_NAME} が無いため更新していない`}`);
  console.log(`Definition links: ${xref ? `${xrefStats.links}（${xrefStats.pages} ページ、${xref.engine}）${xrefStats.skipped.length ? `。作業ツリーと内容が違うため付けていない: ${xrefStats.skipped.join(', ')}` : ''}` : `なし。${manifest.xref?.reason || '通常生成で定義の場所を求めていない'}`}`);
  console.log(`Links checked  : ${checked}（リンク切れ ${broken.length}）`);
  console.log(`Elapsed        : ${((Date.now() - started) / 1000).toFixed(2)}s`);
  if (broken.length) {
    console.error('\nリンク切れ:');
    for (const b of broken.slice(0, 30)) console.error(`- ${b}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err?.stack || err);
  process.exit(1);
});
