#!/usr/bin/env node
/*
 * sequence-diagram skill CLI（Node.js 18+、外部依存なし）
 *
 *   node seqdiag.cjs init     <out.model.json>                      雛形モデルを作成
 *   node seqdiag.cjs validate <model.json> [--source-root DIR] [--json]
 *   node seqdiag.cjs mmd      <model.json> [-o DIR]                 図ごとの Mermaid(.mmd) を出力
 *   node seqdiag.cjs build    <model.json> [-o OUT.html] [--mermaid inline|cdn] [--source-root DIR] [--no-embed-source] [--force] [--verify]
 *   node seqdiag.cjs verify   <OUT.html> [--browser PATH] [--screenshots DIR] [--sizes 1600x900,1280x800] [--diagram ID] [--full] [--json]
 *
 * build はモデルの検証 → 根拠ファイルの照合と抜粋の埋め込み → 単一 HTML の生成を行う。
 * verify はヘッドレスの Chrome / Edge / Chromium で HTML を開き、全図の描画・対応付け・
 * 文字の重なりを検査する（ビューアの ?verify=1 モード）。--screenshots で画面写真も保存する。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Core = require('./lib/core.cjs');

const SKILL_DIR = path.resolve(__dirname, '..');
const ASSETS = path.join(SKILL_DIR, 'assets');
const VENDOR_MERMAID = path.join(ASSETS, 'vendor', 'mermaid.min.js');
const CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@' + Core.MERMAID_VERSION + '/dist/mermaid.min.js';

// ---------------------------------------------------------------------------
// 引数解析
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') { out.out = argv[++i]; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-') && !['json', 'force', 'verify', 'full', 'no-embed-source', 'quiet', 'all'].includes(key)) {
        out[key] = next; i++;
      } else out[key] = true;
      continue;
    }
    out._.push(a);
  }
  return out;
}

function die(msg, code) {
  process.stderr.write('エラー: ' + msg + '\n');
  process.exit(code === undefined ? 2 : code);
}

function readJson(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { die('ファイルを読めません: ' + file + ' (' + e.message + ')'); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try { return JSON.parse(text); } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const pos = Number(m[1]);
      const before = text.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      const srcLine = text.split('\n')[line - 1] || '';
      die('JSON の構文エラー: ' + file + ' ' + line + '行' + col + '桁目付近\n  ' + srcLine.trim().slice(0, 160) + '\n  (' + e.message + ')');
    }
    die('JSON の構文エラー: ' + file + ' (' + e.message + ')');
  }
  return null;
}

// ---------------------------------------------------------------------------
// 根拠（ソースファイル・行番号）の照合と抜粋
// ---------------------------------------------------------------------------
function resolveSourceRoot(model, modelFile, args) {
  if (args['source-root']) return path.resolve(String(args['source-root']));
  const sr = model.meta && model.meta.sourceRoot;
  if (sr) return path.isAbsolute(sr) ? sr : path.resolve(path.dirname(path.resolve(modelFile)), sr);
  return process.cwd();
}

function collectRefs(model) {
  const items = [];
  model.lifelines.forEach((ll) => {
    (ll.evidence && ll.evidence.refs || []).forEach((r) => items.push({ ref: r, kind: 'lifeline', ll, label: 'ライフライン ' + ll.id }));
  });
  model._index.steps.forEach((s) => {
    (s.evidence && !s.evidence._inherited ? s.evidence.refs : []).forEach((r) => items.push({ ref: r, kind: 'step', step: s, label: 'ステップ ' + s.id }));
    ['branches', 'catches', 'options'].forEach((k) => (s[k] || []).forEach((b) => {
      (b.evidence ? b.evidence.refs : []).forEach((r) => items.push({ ref: r, kind: 'branch', step: s, label: 'ステップ ' + s.id + ' の分岐' }));
    }));
  });
  return items;
}

function checkAndEmbedSources(model, sourceRoot, embed) {
  const issues = [];
  const files = new Map();
  const segs = {};
  const stats = { refs: 0, files: 0, missing: 0, outOfRange: 0, symbolMismatch: 0 };
  const readLines = (rel) => {
    if (files.has(rel)) return files.get(rel);
    const abs = path.isAbsolute(rel) ? rel : path.join(sourceRoot, rel);
    let lines = null;
    try {
      const st = fs.statSync(abs);
      if (st.isFile() && st.size < 8 * 1024 * 1024) lines = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
    } catch (e) { lines = null; }
    files.set(rel, lines);
    return lines;
  };
  const addSeg = (file, start, end, lines) => {
    const list = segs[file] || (segs[file] = []);
    list.push({ start, end });
    void lines;
  };
  collectRefs(model).forEach((it) => {
    const r = it.ref;
    if (!r.file || /^https?:/i.test(r.file)) return;
    stats.refs++;
    const lines = readLines(r.file);
    const where = it.step ? { stepId: it.step.id, diagramId: it.step._diagram } : { lifelineId: it.ll && it.ll.id };
    if (!lines) {
      stats.missing++;
      issues.push(Object.assign({ level: 'warning', code: 'ref.fileNotFound', message: it.label + ' の根拠ファイルが見つかりません: ' + r.file + '（ソースルート: ' + sourceRoot + '）' }, where));
      return;
    }
    if (!r.line) return;
    const end = r.endLine || r.line;
    if (r.line < 1 || r.line > lines.length || end > lines.length || end < r.line) {
      stats.outOfRange++;
      issues.push(Object.assign({ level: 'warning', code: 'ref.lineOutOfRange', message: it.label + ' の行番号が範囲外です: ' + Core.refToString(r) + '（ファイルは ' + lines.length + ' 行）' }, where));
      return;
    }
    // 記号照合: 参照行（前後 3 行まで。デコレータや import 行を指した場合も許容）に、
    // 呼び出し先メソッド名・例外名・ライフラインのメソッド名が含まれるか。
    // 設計書などのコード以外の資料、および推定・未確認の根拠（文脈として示す行）は照合しない。
    const text = lines.slice(Math.max(0, r.line - 4), Math.min(lines.length, end + 3)).join('\n');
    const isDocument = /\.(md|markdown|txt|rst|adoc|docx?|pdf|xlsx?|csv|html?|pptx?)$/i.test(r.file);
    const owner = it.step || it.ll;
    const weakEvidence = owner && owner.evidence && owner.evidence.status !== 'confirmed';
    // 期待する記号（いずれか 1 つが含まれていればよい）
    let expect = null;
    const codeTypes = ['method', 'batch'];
    if (it.kind === 'lifeline' && it.ll.method && codeTypes.indexOf(it.ll.type) >= 0) expect = [it.ll.method];
    else if (it.kind === 'step' && it.step.type === 'call') {
      const to = model._index.lifelines.get(it.step.to);
      if (to && to.method && codeTypes.indexOf(to.type) >= 0) expect = [to.method];
    } else if (it.kind === 'step' && it.step.type === 'throw') {
      expect = (String(it.step.exception).match(/[A-Za-z_][A-Za-z0-9_]*(?:Exception|Error|Throwable)/g) || []).map((x) => x.split('.').pop());
      if (!expect.length) expect = null;
    }
    if (expect && !isDocument && !weakEvidence && !expect.some((e) => text.indexOf(e) >= 0) && !r.symbol) {
      stats.symbolMismatch++;
      issues.push(Object.assign({ level: 'warning', code: 'ref.symbolNotFound', message: it.label + ' の根拠 ' + Core.refToString(r) + ' に「' + expect.join(' / ') + '」が見当たりません（行番号のずれ・誤記の可能性）。' }, where));
    }
    if (embed) addSeg(r.file, Math.max(1, r.line - 3), Math.min(lines.length, Math.min(end, r.line + 60) + 3), lines);
  });
  // 範囲を統合して抜粋を作る
  const sources = {};
  Object.keys(segs).forEach((file) => {
    const lines = files.get(file);
    const list = segs[file].sort((a, b) => a.start - b.start);
    const merged = [];
    list.forEach((s) => {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end + 2) last.end = Math.max(last.end, s.end);
      else merged.push({ start: s.start, end: s.end });
    });
    sources[file] = merged.map((m) => ({ start: m.start, lines: lines.slice(m.start - 1, m.end) }));
  });
  stats.files = Object.keys(sources).length;
  return { issues, sources, stats };
}

// ---------------------------------------------------------------------------
// 出力の整形
// ---------------------------------------------------------------------------
function printValidation(v, buildIssues, opts) {
  const lines = [];
  const fmt = (lvl, i) => {
    const where = [i.diagramId && '図:' + i.diagramId, i.stepId && 'step:' + i.stepId, i.lifelineId && 'lifeline:' + i.lifelineId].filter(Boolean).join(' ');
    return '  [' + lvl + '] ' + i.message + (where ? '  (' + where + ')' : '');
  };
  // 同じ種類（code）の指摘は先頭の数件だけ表示し、残りは件数で示す（--all ですべて表示）
  const limit = opts.all ? Infinity : 8;
  const emit = (lvl, list) => {
    const seen = {};
    list.forEach((i) => {
      const k = i.code || '?';
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] <= limit) lines.push(fmt(lvl, i));
    });
    Object.keys(seen).forEach((k) => {
      if (seen[k] > limit) lines.push('  [' + lvl + '] …同じ種類（' + k + '）がほかに ' + (seen[k] - limit) + ' 件（--all で全件表示）');
    });
  };
  emit('エラー', v.errors);
  emit('警告', v.warnings.concat((buildIssues || []).filter((i) => i.level !== 'error')));
  emit('エラー', (buildIssues || []).filter((i) => i.level === 'error'));
  if (!opts.quiet) emit('情報', v.infos);
  const head = '検証結果: エラー ' + v.errors.length + ' / 警告 ' + (v.warnings.length + (buildIssues || []).length) +
    ' / 根拠 確認済み ' + v.evidence.confirmed + '・推定 ' + v.evidence.inferred + '・未確認 ' + v.evidence.unverified;
  process.stdout.write(head + '\n' + (lines.length ? lines.join('\n') + '\n' : ''));
}

function diagramSummary(model) {
  return model.diagrams.map((d) => {
    try {
      const g = Core.generate(model, d.id, {});
      return '  - ' + d.id + '「' + d.title + '」 メッセージ ' + g.stats.messages + ' / ライフライン ' + g.stats.participants + ' / フラグメント ' + g.stats.fragments;
    } catch (e) {
      return '  - ' + d.id + '「' + d.title + '」 生成エラー: ' + e.message;
    }
  }).join('\n');
}

// ---------------------------------------------------------------------------
// コマンド: init / validate / mmd / build
// ---------------------------------------------------------------------------
function cmdInit(args) {
  const out = args._[1] || args.out;
  if (!out) die('出力先を指定してください: init <out.model.json>');
  if (fs.existsSync(out) && !args.force) die(out + ' は既に存在します（上書きは --force）。');
  const tpl = {
    schemaVersion: 1,
    meta: {
      title: '（処理名）シーケンス図',
      system: '（システム名）',
      entryPoint: '（起点: 例 POST /api/orders → OrderController.createOrder）',
      description: '（この図が説明する処理の概要）',
      sourceRoot: '.',
      language: '',
      frameworks: [],
      inputs: [],
      analyzedAt: new Date().toISOString().slice(0, 10),
      defaultEvidenceStatus: 'unverified',
      assumptions: [],
      unresolved: [],
      omissions: [],
      excluded: []
    },
    lifelines: [
      { id: 'client', type: 'actor', name: '利用者' },
      { id: 'ctl_example', kind: 'Controller', class: 'ExampleController', method: 'handle', evidence: { refs: ['src/ExampleController.java:10-30'] } }
    ],
    diagrams: [
      {
        id: 'main',
        title: '全体処理',
        entry: 'client',
        steps: [
          { type: 'call', from: 'client', to: 'ctl_example', label: '（処理概要）', args: [], returns: { name: 'response', jpName: '応答', type: 'Response' }, evidence: { refs: ['src/ExampleController.java:10'] }, steps: [] }
        ]
      }
    ]
  };
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(tpl, null, 2) + '\n', 'utf8');
  process.stdout.write('雛形を作成しました: ' + out + '\n');
}

function loadModel(file) {
  const raw = readJson(file);
  return { raw, model: Core.normalize(raw) };
}

function cmdValidate(args) {
  const file = args._[1];
  if (!file) die('モデルファイルを指定してください: validate <model.json>');
  const { model } = loadModel(file);
  const v = Core.validate(model);
  const root = resolveSourceRoot(model, file, args);
  const src = checkAndEmbedSources(model, root, false);
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: v.ok, errors: v.errors, warnings: v.warnings.concat(src.issues), infos: v.infos, evidence: v.evidence, refs: src.stats }, null, 2) + '\n');
  } else {
    printValidation(v, src.issues, args);
    process.stdout.write('根拠の照合: 参照 ' + src.stats.refs + ' 件 / ファイル未検出 ' + src.stats.missing + ' / 行番号範囲外 ' + src.stats.outOfRange + ' / 記号不一致 ' + src.stats.symbolMismatch + '（ソースルート: ' + root + '）\n');
    process.stdout.write('図:\n' + diagramSummary(model) + '\n');
  }
  process.exit(v.ok ? 0 : 1);
}

function cmdMmd(args) {
  const file = args._[1];
  if (!file) die('モデルファイルを指定してください: mmd <model.json> [-o DIR]');
  const { model } = loadModel(file);
  const v = Core.validate(model);
  if (!v.ok) { printValidation(v, [], args); die('モデルにエラーがあるため Mermaid を出力できません。', 1); }
  const dir = args.out || path.join(path.dirname(path.resolve(file)), 'mmd');
  fs.mkdirSync(dir, { recursive: true });
  model.diagrams.forEach((d) => {
    const g = Core.generate(model, d.id, {});
    const header = '%% ' + model.meta.title + ' / ' + d.title + '\n';
    const text = g.text.replace(/^sequenceDiagram\n/, 'sequenceDiagram\n  ' + header.trim() + '\n');
    const out = path.join(dir, d.id + '.mmd');
    fs.writeFileSync(out, text, 'utf8');
    process.stdout.write('出力: ' + out + '（メッセージ ' + g.stats.messages + '）\n');
  });
}

function escapeScript(s) {
  return String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}
const LINE_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
function jsonForScript(o) {
  // < と行区切り文字(U+2028/2029)をエスケープし、script 要素内に安全に埋め込む
  return JSON.stringify(o).replace(/</g, '\\u003c').replace(LINE_SEPARATORS, (c) => '\\u' + c.charCodeAt(0).toString(16));
}
function fill(tpl, key, value) {
  const token = '/*@@' + key + '@@*/';
  if (tpl.indexOf(token) < 0) throw new Error('テンプレートに ' + token + ' がありません');
  return tpl.split(token).join(value);
}

function cmdBuild(args) {
  const file = args._[1];
  if (!file) die('モデルファイルを指定してください: build <model.json> [-o OUT.html]');
  const { raw, model } = loadModel(file);
  const v = Core.validate(model);
  const root = resolveSourceRoot(model, file, args);
  const embed = !args['no-embed-source'];
  const src = checkAndEmbedSources(model, root, embed);
  printValidation(v, src.issues, { quiet: true });
  if (!v.ok && !args.force) die('モデルにエラーがあるため HTML を生成しません（強制する場合は --force）。', 1);

  const out = path.resolve(args.out || file.replace(/(\.model)?\.json$/i, '') + '.html');
  const mode = args.mermaid === 'cdn' ? 'cdn' : 'inline';
  let mermaidTag;
  if (mode === 'inline') {
    if (!fs.existsSync(VENDOR_MERMAID)) die('同梱の Mermaid が見つかりません: ' + VENDOR_MERMAID + '（--mermaid cdn を使うか、scripts/update-mermaid.cjs で取得してください）');
    mermaidTag = '<script>\n' + escapeScript(fs.readFileSync(VENDOR_MERMAID, 'utf8')) + '\n</script>';
  } else {
    let sri = '';
    if (fs.existsSync(VENDOR_MERMAID)) sri = ' integrity="sha384-' + crypto.createHash('sha384').update(fs.readFileSync(VENDOR_MERMAID)).digest('base64') + '" crossorigin="anonymous"';
    mermaidTag = '<script src="' + CDN_URL + '"' + sri + '></script>';
  }
  const buildInfo = {
    generatedAt: new Date().toISOString(),
    coreVersion: Core.VERSION,
    mermaidVersion: Core.MERMAID_VERSION,
    mermaidMode: mode,
    modelFile: path.basename(file),
    sourceRoot: model.meta.sourceRoot || null,
    sourceRootAbs: embed ? root.replace(/\\/g, '/') : null,
    sources: embed ? src.sources : {},
    issues: src.issues
  };
  let html = fs.readFileSync(path.join(ASSETS, 'viewer', 'template.html'), 'utf8');
  const title = model.meta.title.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  html = fill(html, 'TITLE', title);
  html = fill(html, 'CORE_VERSION', Core.VERSION);
  html = fill(html, 'MERMAID_VERSION', Core.MERMAID_VERSION);
  html = fill(html, 'VIEWER_CSS', fs.readFileSync(path.join(ASSETS, 'viewer', 'viewer.css'), 'utf8'));
  html = fill(html, 'MODEL_JSON', jsonForScript(raw));
  html = fill(html, 'BUILD_JSON', jsonForScript(buildInfo));
  html = fill(html, 'MERMAID_SCRIPT', mermaidTag);
  html = fill(html, 'CORE_JS', escapeScript(fs.readFileSync(path.join(__dirname, 'lib', 'core.cjs'), 'utf8')));
  html = fill(html, 'VIEWER_JS', escapeScript(fs.readFileSync(path.join(ASSETS, 'viewer', 'viewer.js'), 'utf8')));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  const size = fs.statSync(out).size;
  process.stdout.write('図:\n' + diagramSummary(model) + '\n');
  process.stdout.write('根拠の照合: 参照 ' + src.stats.refs + ' 件 / ファイル未検出 ' + src.stats.missing + ' / 行番号範囲外 ' + src.stats.outOfRange + ' / 記号不一致 ' + src.stats.symbolMismatch + ' / 抜粋埋め込み ' + src.stats.files + ' ファイル\n');
  process.stdout.write('HTML を出力しました: ' + out + '（' + (size / 1024 / 1024).toFixed(2) + ' MB、Mermaid: ' + mode + '）\n');
  if (args.verify) return cmdVerify(Object.assign({}, args, { _: ['verify', out] }));
  return undefined;
}

// ---------------------------------------------------------------------------
// コマンド: verify（ヘッドレスブラウザでの表示検証）
// ---------------------------------------------------------------------------
function findBrowser(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  ['SEQDIAG_BROWSER', 'CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH'].forEach((k) => { if (process.env[k]) cands.push(process.env[k]); });
  const home = os.homedir();
  if (process.platform === 'win32') {
    const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA']].filter(Boolean);
    pf.forEach((p) => {
      cands.push(path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      cands.push(path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      cands.push(path.join(p, 'Chromium', 'Application', 'chrome.exe'));
    });
    const pw = path.join(process.env['LOCALAPPDATA'] || '', 'ms-playwright');
    globDirs(pw, /^chromium-\d+$/).forEach((d) => { cands.push(path.join(d, 'chrome-win', 'chrome.exe')); cands.push(path.join(d, 'chrome-win64', 'chrome.exe')); });
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    cands.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    cands.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    globDirs(path.join(home, 'Library', 'Caches', 'ms-playwright'), /^chromium-\d+$/).forEach((d) => cands.push(path.join(d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')));
  } else {
    ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable'].forEach((b) => {
      const r = spawnSync('which', [b], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) cands.push(r.stdout.trim());
    });
    globDirs(path.join(home, '.cache', 'ms-playwright'), /^chromium-\d+$/).forEach((d) => cands.push(path.join(d, 'chrome-linux', 'chrome')));
  }
  return cands.find((c) => { try { return fs.statSync(c).isFile(); } catch (e) { return false; } }) || null;
}
function globDirs(dir, re) {
  try { return fs.readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n)); } catch (e) { return []; }
}

function fileUrl(p, query) {
  let abs = path.resolve(p).replace(/\\/g, '/');
  if (!abs.startsWith('/')) abs = '/' + abs;
  return 'file://' + encodeURI(abs).replace(/#/g, '%23').replace(/\?/g, '%3F') + (query ? '?' + query : '');
}

function runBrowser(browser, extra, url, timeoutMs) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'seqdiag-'));
  const argv = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--hide-scrollbars', '--mute-audio', '--disable-background-networking', '--user-data-dir=' + prof].concat(extra, [url]);
  const r = spawnSync(browser, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs || 180000, windowsHide: true });
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* 一時ディレクトリの削除失敗は無視 */ }
  return r;
}

function cmdVerify(args) {
  const file = args._[1];
  if (!file || !fs.existsSync(file)) die('検証する HTML を指定してください: verify <out.html>');
  const browser = findBrowser(args.browser);
  if (!browser) die('Chrome / Edge / Chromium が見つかりません。--browser でパスを指定するか、環境変数 SEQDIAG_BROWSER を設定してください。', 3);
  const budget = Number(args.budget || 120000);
  const r = runBrowser(browser, ['--virtual-time-budget=' + budget, '--window-size=1600,1000', '--dump-dom'], fileUrl(file, 'verify=1'), Number(args.timeout || 240000));
  const m = /<script type="application\/json" id="seqdiag-verify-result">([\s\S]*?)<\/script>/.exec(r.stdout || '');
  if (!m) {
    process.stderr.write((r.stderr || '').split('\n').filter((l) => !/DevTools|extension|registry/i.test(l)).slice(-10).join('\n') + '\n');
    die('検証結果を取得できませんでした（描画が時間内に完了しなかった可能性があります。--budget を増やしてください）。ブラウザ: ' + browser, 4);
  }
  const report = JSON.parse(m[1]);
  report.browser = browser;
  let shots = [];
  if (args.screenshots) shots = takeScreenshots(browser, file, report, args);
  report.screenshots = shots;
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const lines = [];
    lines.push('表示検証: ' + (report.ok ? 'OK' : '問題あり') + '（Mermaid ' + report.mermaidVersion + ' / ' + path.basename(browser) + '）');
    lines.push('  モデル: エラー ' + report.validation.errors.length + ' / 警告 ' + report.validation.warnings.length + ' / 根拠照合の警告 ' + report.buildIssues.length);
    report.diagrams.forEach((d) => {
      const c = d.counts || {};
      const st = d.renderError ? '描画失敗: ' + d.renderError
        : 'メッセージ ' + c.messages.mapped + '/' + c.messages.expected + '・注記 ' + c.notes.mapped + '/' + c.notes.expected +
        '・枠 ' + c.fragments.mapped + '/' + c.fragments.expected + '・ライフライン ' + c.participants.mapped + '/' + c.participants.expected +
        ' / 重なり ' + d.overlaps.length + ' / はみ出し ' + d.clipped.length + ' / ' + d.size.w + 'x' + d.size.h + 'px';
      lines.push('  ' + (d.ok ? '✓' : '✗') + ' ' + d.diagramId + ' [' + (d.mode === 'class' ? 'クラス単位' : 'メソッド単位') + '] ' + st);
      (d.problems || []).forEach((p) => lines.push('      - ' + p.level + ': ' + p.message));
      (d.overlaps || []).slice(0, 10).forEach((o) => lines.push('      - 重なり: 「' + o.a + '」と「' + o.b + '」 (x=' + o.x + ', y=' + o.y + ')'));
      (d.clipped || []).slice(0, 10).forEach((o) => lines.push('      - はみ出し: 「' + o.text + '」'));
    });
    shots.forEach((s) => lines.push('  画像: ' + s));
    process.stdout.write(lines.join('\n') + '\n');
  }
  process.exit(report.ok ? 0 : 1);
}

function takeScreenshots(browser, file, report, args) {
  const dir = path.resolve(String(args.screenshots));
  fs.mkdirSync(dir, { recursive: true });
  const sizes = String(args.sizes || '1600x900').split(',').map((s) => s.trim().split('x').map(Number)).filter((s) => s[0] > 0 && s[1] > 0);
  const ids = args.diagram ? [String(args.diagram)] : Array.from(new Set(report.diagrams.map((d) => d.diagramId)));
  const out = [];
  // 画像は既定でライトテーマ（閲覧環境の設定に左右されないようにする）
  const theme = args.theme === 'dark' ? 'dark' : 'light';
  // ステップを選んだ画像は初期表示の画像を上書きしないよう、ステップ ID をファイル名に含める
  const selTag = args.select ? '@' + String(args.select).replace(/[^A-Za-z0-9_.-]/g, '_') : '';
  if (args.select) {
    // 指定したステップ ID が無いと、何も選ばれていない画像になるので知らせる
    try {
      const html = fs.readFileSync(file, 'utf8');
      const m = html.match(/<script id="seqdiag-model" type="application\/json">([\s\S]*?)<\/script>/);
      const model = Core.normalize(JSON.parse(m[1]));
      const step = model._index.steps.get(String(args.select));
      if (!step) process.stderr.write('警告: --select のステップ ID「' + args.select + '」がモデルにありません（選択なしで撮影します）。\n');
      else if (args.diagram && step._diagram !== String(args.diagram)) process.stderr.write('注意: ステップ「' + args.select + '」は図「' + step._diagram + '」にあります（その図に切り替えて撮影します）。\n');
    } catch (e) { /* 確認できない場合は撮影だけ行う */ }
  }
  ids.forEach((id) => {
    sizes.forEach(([w, hgt]) => {
      const png = path.join(dir, id + selTag + '@' + w + 'x' + hgt + '.png');
      const q = 'diagram=' + encodeURIComponent(id) + (args.select ? '&select=' + encodeURIComponent(args.select) : '') + '&theme=' + theme;
      runBrowser(browser, ['--virtual-time-budget=20000', '--window-size=' + w + ',' + hgt, '--screenshot=' + png], fileUrl(file, q), 120000);
      if (fs.existsSync(png)) out.push(png);
    });
    if (args.full) {
      const d = report.diagrams.find((x) => x.diagramId === id && x.mode === 'method');
      if (d && d.size) {
        const w = Math.min(16000, d.size.w + 120), hgt = Math.min(16000, d.size.h + 140);
        const png = path.join(dir, id + '@full.png');
        runBrowser(browser, ['--virtual-time-budget=20000', '--window-size=' + w + ',' + hgt, '--screenshot=' + png], fileUrl(file, 'diagram=' + encodeURIComponent(id) + '&shot=diagram&zoom=1&theme=' + theme), 180000);
        if (fs.existsSync(png)) out.push(png);
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  switch (cmd) {
    case 'init': return cmdInit(args);
    case 'validate': return cmdValidate(args);
    case 'mmd': return cmdMmd(args);
    case 'build': return cmdBuild(args);
    case 'verify': return cmdVerify(args);
    case 'version': process.stdout.write('core ' + Core.VERSION + ' / mermaid ' + Core.MERMAID_VERSION + '\n'); return undefined;
    default:
      process.stdout.write([
        'sequence-diagram CLI (core ' + Core.VERSION + ', Mermaid ' + Core.MERMAID_VERSION + ')',
        '  init     <out.model.json>                 雛形モデルを作成',
        '  validate <model.json> [--source-root DIR] モデルと根拠を検証',
        '  mmd      <model.json> [-o DIR]            Mermaid(.mmd) を出力',
        '  build    <model.json> [-o OUT.html] [--mermaid inline|cdn] [--verify]  単一HTMLを生成',
        '  verify   <OUT.html> [--screenshots DIR] [--sizes 1600x900,1280x800] [--full]  ヘッドレスブラウザで表示検証',
        ''
      ].join('\n'));
      return undefined;
  }
}

main();
