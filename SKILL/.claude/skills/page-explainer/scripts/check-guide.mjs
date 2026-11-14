#!/usr/bin/env node
// page-explainer の確認。
// 案内を付けた HTML を、見えないブラウザー（Chrome か Edge のヘッドレス）で開き、次を確かめる。
//   ・手順ごとに、指す部品が見つかり、見えているか
//   ・吹き出しが画面の中に収まり、指す部品を隠さず、中身が横にはみ出していないか
//     （幅の広いページを狭い画面で開いたときにずれる、実際に見えている範囲を基準に確かめる）
//   ・案内を付けても、ページの大きさ（スクロールの幅と高さ）とエラーが変わらないか
//   ・案内を開くボタン（既定の文字は「解説」）が、見えている範囲にあり、ページのボタンや文字に重ならないか
//   ・初めて開いたときの誘い、キー操作（→ ← Esc）、「詳細」の開閉（最初は冒頭の 1〜2 文だけが見えるか）、
//     「分からない」と「前の細かさに戻る」、目次、続きから、質問文が動くか
// 画面の大きさごとのスクリーンショットと、結果の JSON・一覧の HTML を --out のフォルダーに残す。
//
// 使い方:
//   node check-guide.mjs PAGE.html --out DIR [--sizes 1440x900,1024x768,390x844] [--browser PATH] [--no-shots]
//   node check-guide.mjs --outline PAGE.html --out DIR [--sizes 1440x900,390x844]
//     --outline は、案内を付ける前（付いていても止めた状態）のページを開き、指せる部品の候補
//     （見出し・領域・ボタン・入力欄）のセレクター・文字・位置と、画面の大きさごとに見えるかを一覧にする。
// 必要なもの: Node.js 22 以上（組み込みの WebSocket を使う）、Chrome か Edge。
// 終了コード: 0 問題なし（注意はありうる）/ 1 直すべき問題がある / 2 ブラウザーが見つからない・開けない

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUTLINE_JS } from './outline-js.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- 引数
const argv = process.argv.slice(2);
const opt = { file: null, out: null, sizes: null, browser: null, shots: true, outline: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opt.out = argv[++i];
  else if (a === '--sizes') opt.sizes = argv[++i];
  else if (a === '--browser') opt.browser = argv[++i];
  else if (a === '--no-shots') opt.shots = false;
  else if (a === '--outline') opt.outline = true;
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
  else if (!opt.file) opt.file = a;
  else { console.error('知らない引数: ' + a); process.exit(2); }
}
if (!opt.file) { console.error('HTML のファイルを指定する。例: node check-guide.mjs page.html --out ./check'); process.exit(2); }
const file = path.resolve(opt.file);
if (!fs.existsSync(file)) { console.error('ファイルが無い: ' + file); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('この Node.js には WebSocket が無い。Node.js 22 以上で実行する。'); process.exit(2); }
const sizes = (opt.sizes || (opt.outline ? '1440x900,390x844' : '1440x900,1024x768,390x844')).split(',').map((s) => {
  const m = s.trim().match(/^(\d+)x(\d+)$/);
  if (!m) { console.error('--sizes は 1440x900,390x844 の形で書く: ' + s); process.exit(2); }
  return { w: +m[1], h: +m[2], label: `${m[1]}x${m[2]}` };
});
const outDir = path.resolve(opt.out || path.join(os.tmpdir(), 'page-explainer-check', path.basename(file).replace(/\.[^.]+$/, '') + '-' + Date.now()));
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- ブラウザー
function findBrowser(explicit) {
  const c = [explicit, process.env.CHROME_PATH, process.env.BROWSER_PATH];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      c.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(base, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) { try { c.push(execFileSync('which', [n]).toString().trim()); } catch (_) { /* 無い */ } }
  }
  return c.find((p) => p && fs.existsSync(p));
}

let browserProc = null;
let profileDir = null;
async function launch(exe) {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-explainer-chrome-'));
  browserProc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profileDir,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--mute-audio', '--force-color-profile=srgb', '--disable-features=Translate',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('ブラウザーが 30 秒で起動しなかった')), 30000);
    browserProc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
    browserProc.on('exit', (code) => { clearTimeout(t); reject(new Error(`ブラウザーが終了した（${code}）: ${buf.slice(-400)}`)); });
  });
}
async function shutdown(cdp) {
  try { if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch (_) { /* もう閉じている */ }
  if (cdp) cdp.close();
  if (browserProc && browserProc.exitCode == null) {
    await Promise.race([new Promise((r) => browserProc.once('exit', r)), sleep(5000)]);
    if (browserProc.exitCode == null) { try { browserProc.kill(); } catch (_) { /* 無視 */ } }
  }
  for (let k = 0; k < 10 && profileDir; k++) { try { fs.rmSync(profileDir, { recursive: true, force: true }); break; } catch (_) { await sleep(300); } }
}
process.on('exit', () => { if (browserProc && browserProc.exitCode == null) { try { browserProc.kill(); } catch (_) { /* 無視 */ } } });
process.on('SIGINT', () => process.exit(130));

class CDP {
  static connect(url) {
    return new Promise((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(new CDP(ws)); ws.onerror = (e) => rej(new Error('ブラウザーにつながらない: ' + (e.message || e.type))); });
  }
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.wait = new Map(); this.subs = new Set();
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id != null) { const w = this.wait.get(m.id); if (w) { this.wait.delete(m.id); if (m.error) w.rej(new Error(`${w.method}: ${m.error.message}`)); else w.res(m.result); } }
      else for (const f of this.subs) f(m);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((res, rej) => this.wait.set(id, { res, rej, method }));
  }
  on(f) { this.subs.add(f); return () => this.subs.delete(f); }
  close() { try { this.ws.close(); } catch (_) { /* 無視 */ } }
}

async function openPage(cdp, { disableGuide = false } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const p = { cdp, targetId, sessionId, logs: [], send: (m, prm) => cdp.send(m, prm, sessionId) };
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      p.logs.push({ level: 'error', source: 'exception', text: (d.exception && d.exception.description) || d.text || '', url: d.url || '' });
    } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
      p.logs.push({ level: m.params.type === 'warning' ? 'warning' : 'error', source: 'console', text: m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' ') });
    } else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) {
      const e = m.params.entry; p.logs.push({ level: e.level, source: e.source, text: e.text || '', url: e.url || '' });
    }
  });
  await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Log.enable');
  if (disableGuide) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__PAGE_EXPLAINER_DISABLED__ = true; window.__HTML_OPERATION_GUIDE_DISABLED__ = true;' });
  return p;
}
function waitEvent(p, method, ms) {
  return new Promise((res, rej) => {
    const off = p.cdp.on((m) => { if (m.sessionId === p.sessionId && m.method === method) { off(); clearTimeout(t); res(m.params); } });
    const t = setTimeout(() => { off(); rej(new Error(method + ' を待ちきれなかった')); }, ms);
  });
}
async function navigate(p, url) {
  const loaded = waitEvent(p, 'Page.loadEventFired', 30000);
  const r = await p.send('Page.navigate', { url });
  if (r.errorText) throw new Error('ページを開けない: ' + r.errorText);
  await loaded;
  await sleep(500);
}
async function evaluate(p, expression, ms = 15000) {
  const run = p.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  const r = await Promise.race([run, sleep(ms).then(() => ({ timeout: true }))]);
  if (r.timeout) throw new Error('ページの中の処理が ' + ms / 1000 + ' 秒で終わらなかった: ' + expression.slice(0, 80));
  if (r.exceptionDetails) throw new Error('ページの中の処理で例外: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function setSize(p, s) {
  await p.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.w < 600 });
  await sleep(200);
}
async function shot(p, name, shots, caption) {
  if (!opt.shots) return;
  const r = await p.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64'));
  shots.push({ file: name, caption });
}
const G = 'window.pageExplainer';
async function clickGuide(p, selector) {
  // 吹き出しの本文の下の方にある部品（詳細の最後の「分からない」など）は、読み手と同じく、本文を送って見せてから押す
  const r = await evaluate(p, `(() => { const el = ${G}.__test.root.querySelector(${JSON.stringify(selector)}); if (!el) return null; try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {} const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
  if (!r || r.w < 1) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await p.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  }
  await sleep(350);
  return true;
}
const KEYS = { ArrowRight: 39, ArrowLeft: 37, Escape: 27 };
async function press(p, key) {
  const k = KEYS[key];
  await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: k, nativeVirtualKeyCode: k });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: k, nativeVirtualKeyCode: k });
  await sleep(450);
}
const state = (p) => evaluate(p, `${G} ? ${G}.state : null`);
async function until(p, fn, ms) {
  const t0 = Date.now();
  for (;;) { const s = await state(p); if (s && fn(s)) return s; if (Date.now() - t0 > ms) return s; await sleep(150); }
}

const PAGE_FACTS = `(() => ({ scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, bodyChildren: document.body ? document.body.children.length : 0, title: document.title }))()`;

// 案内を開くボタンが、実際に見えている範囲（ビジュアルビューポート）の中にあるか
const LAUNCHER_VISIBLE = `(() => {
  const l = ${G}.__test.root.querySelector('.launcher'); if (!l) return null;
  const r = l.getBoundingClientRect(), vv = window.visualViewport || { offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight };
  const x = r.left - vv.offsetLeft, y = r.top - vv.offsetTop;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), vw: Math.round(vv.width), vh: Math.round(vv.height), inside: x >= -1 && y >= -1 && x + r.width <= vv.width + 1 && y + r.height <= vv.height + 1 };
})()`;

// 案内を開くボタンの下にある、ページの操作できる部品と文字
const LAUNCHER_OVERLAP = `(() => {
  const sr = ${G}.__test.root, host = sr.host, l = sr.querySelector('.launcher');
  if (!l || getComputedStyle(l).visibility === 'hidden') return [];
  const r = l.getBoundingClientRect(), hits = new Set();
  const INTER = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=slider],[tabindex]:not([tabindex="-1"]),[contenteditable=""],[contenteditable=true]';
  const name = (el) => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; const c = [...el.classList].slice(0, 2).join('.'); if (c) s += '.' + c; const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 20); return t ? s + '「' + t + '」' : s; };
  for (let x = r.left + 3; x <= r.right - 3; x += Math.max(4, (r.width - 6) / 6)) {
    for (let y = r.top + 3; y <= r.bottom - 3; y += Math.max(4, (r.height - 6) / 3)) {
      const el = document.elementsFromPoint(x, y).find((e) => e !== host && !host.contains(e));
      if (!el || el === document.documentElement || el === document.body) continue;
      const hit = el.closest(INTER);
      if (hit) { hits.add('操作できる部品 ' + name(hit)); continue; }
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own) hits.add('文字 ' + name(el));
    }
  }
  return [...hits];
})()`;

// ---------------------------------------------------------------- 指せる部品の候補（--outline）
// 集める式は outline-js.mjs にある（live-tour.mjs と同じものを使う）

// ---------------------------------------------------------------- 判定
function judge(info, size, R, stepMeta) {
  const where = `${size.label} 手順 ${info.step + 1}「${info.title}」細かさ ${info.level + 1}${info.expanded ? '（詳細を開いた状態）' : ''}`;
  const t = info.target;
  if (t.expected) {
    if (t.count === 0) (stepMeta.missing ? R.warnings : R.errors).push(`${where}: 指す部品が見つからない（target: ${JSON.stringify(stepMeta.target)}）。${stepMeta.missing ? 'missing の説明を出している。' : 'セレクターを直すか、見えない状態があるなら missing に、見えるようにする方法を書く。'}`);
    else if (!t.visible) (stepMeta.missing ? R.warnings : R.errors).push(`${where}: 指す部品はあるが、画面に見えていない。${stepMeta.missing ? 'missing の説明を出している。' : '別の部品を指すか、reveal で見せるか、missing に見えるようにする方法を書く。'}`);
    if (t.count > 1 && !stepMeta.targetAll && size === sizes[0] && info.level === 0) R.warnings.push(`${where}: 部品の指定に合う要素が ${t.count} 個ある。最初の見えている 1 つを指している。意図した部品か、スクリーンショットで確かめる。`);
  }
  const b = info.balloon, v = info.viewport;
  if (b.x < -1 || b.y < -1 || b.x + b.w > v.w + 1 || b.y + b.h > v.h + 1) R.errors.push(`${where}: 吹き出しが画面の外にはみ出している（吹き出し ${b.x},${b.y} ${b.w}×${b.h}、画面 ${v.w}×${v.h}）。`);
  if (t.visible && info.overlap > 0) {
    if (info.forced) R.warnings.push(`${where}: 部品が大きく、周りに吹き出しを置く場所が無いので、部品に重ねて置いた（部品 ${t.rect.w}×${t.rect.h}px、重なり ${info.overlap}px²）。部品の中の見出しや一部の行など、もっと小さい部品を指せないか確かめる。`);
    else R.errors.push(`${where}: 吹き出しが、指す部品に重なっている（重なり ${info.overlap}px²、置き方 ${info.mode}）。placement を変えるか、部品を指し直す。`);
  }
  if (info.overflowX) R.errors.push(`${where}: 吹き出しの中身が横にはみ出している。長い英数字・コードを短くするか、途中で区切る。`);
  if (info.body.scroll > info.body.client + 2 && info.body.client < 72) R.warnings.push(`${where}: 吹き出しの本文の見える高さが ${info.body.client}px しかない。画面の高さが足りず、読むのに何度も送る必要がある。`);
  if (!info.settled) R.warnings.push(`${where}: 部品の位置が 3 秒たっても落ち着かなかった（動き続ける部品か、スクロールが終わらない）。`);
}

// ---------------------------------------------------------------- 案内の確認
async function checkGuide(cdp, url, R) {
  // 1. 案内を止めたページ（比べる元）
  const base = await openPage(cdp, { disableGuide: true });
  await setSize(base, sizes[0]);
  await navigate(base, url);
  const baseFacts = await evaluate(base, PAGE_FACTS);
  const baseLogTexts = new Set(base.logs.filter((l) => l.level === 'error').map((l) => l.text));
  await cdp.send('Target.closeTarget', { targetId: base.targetId });

  // 2. 案内を付けたページ（新しいプロファイルなので、初めて開いた状態）
  const pg = await openPage(cdp);
  await setSize(pg, sizes[0]);
  await navigate(pg, url);
  const has = await evaluate(pg, `typeof ${G} === 'object' && !!${G} && !!${G}.__test`);
  if (!has) {
    R.errors.push('案内のエンジンが動いていない（window.pageExplainer が無い）。guide.py inject で付けたか、ページのエラーで止まっていないかを確かめる。');
    R.logs = pg.logs;
    return;
  }
  const meta = await evaluate(pg, `${G}.__test.meta()`);
  R.guide = { id: meta.id, title: meta.title, steps: meta.steps.length, levels: meta.steps.reduce((a, s) => a + s.levels, 0) };

  // 3. 初めて開いたときの誘い
  if (meta.start === 'welcome') {
    const s = await until(pg, (x) => x.open && x.mode === 'welcome', 3000);
    if (!(s && s.open && s.mode === 'welcome')) R.errors.push('初めて開いたときに、案内への誘いが出ない。');
    else {
      await shot(pg, `welcome-${sizes[0].label}.png`, R.shots, `${sizes[0].label} 初めて開いたときの誘い`);
      await clickGuide(pg, '[data-act="later"]');
      const s2 = await state(pg);
      if (s2.open) R.errors.push('誘いの「あとで」を押しても閉じない。');
      await navigate(pg, url);
      await sleep(900);
      const s3 = await state(pg);
      if (s3.open) R.errors.push('「あとで」を押したあとに開き直すと、また誘いが出る（誘いは初めの 1 回だけのはず）。');
    }
  }

  // 4. 案内を付けても、ページの大きさが変わらないか
  const facts = await evaluate(pg, PAGE_FACTS);
  if (facts.scrollW !== baseFacts.scrollW || facts.scrollH !== baseFacts.scrollH) R.warnings.push(`案内を付けると、ページの大きさが変わった（幅 ${baseFacts.scrollW}→${facts.scrollW}、高さ ${baseFacts.scrollH}→${facts.scrollH}）。時間で変わるページでなければ、案内がページの並びに入り込んでいる。`);
  if (facts.bodyChildren !== baseFacts.bodyChildren) R.warnings.push(`案内を付けると、body の直下の要素の数が変わった（${baseFacts.bodyChildren}→${facts.bodyChildren}）。`);

  // 5. 画面の大きさごとに、全手順を出す
  for (const size of sizes) {
    await setSize(pg, size);
    await navigate(pg, url);
    if (meta.launcher) {
      const lv = await evaluate(pg, LAUNCHER_VISIBLE);
      if (lv && !lv.inside) R.errors.push(`${size.label}: 案内を開くボタンが、画面に見えている範囲の外にある（ボタン ${lv.x},${lv.y} ${lv.w}×${lv.h}、見えている範囲 ${lv.vw}×${lv.vh}）。読み手が案内を開けない。`);
      const ov = await evaluate(pg, LAUNCHER_OVERLAP);
      if (ov.length) R.warnings.push(`${size.label}: 案内を開くボタンが、ページの次のものに重なる: ${ov.slice(0, 5).join('、')}。launcher の position を変えるか、重なっても困らないか確かめる。`);
      await shot(pg, `closed-${size.label}.png`, R.shots, `${size.label} 案内を閉じた状態（案内を開くボタン）`);
    }
    for (let i = 0; i < meta.steps.length; i++) {
      const sm = meta.steps[i];
      // どの大きさでも、細かさ 1 を「詳細を閉じた状態」と「開いた状態」で出す。最初の大きさでは、細かい段も開いた状態で出す
      const views = [[0, false], [0, true]];
      if (size === sizes[0]) for (let lv = 1; lv < sm.levels; lv++) views.push([lv, true]);
      for (const [lv, open] of views) {
        let info;
        try { info = await evaluate(pg, `${G}.__test.show(${i}, ${lv}, ${open})`, 20000); } catch (e) { R.errors.push(`${size.label} 手順 ${i + 1}「${sm.title}」細かさ ${lv + 1}: 出せなかった: ${e.message}`); continue; }
        info.size = size.label;
        R.steps.push(info);
        if (!open && info.detailsHidden === false) R.errors.push(`${size.label} 手順 ${i + 1}「${sm.title}」: 最初から詳細が開いている（冒頭の 1〜2 文のほかは、「詳細」を押すまで隠すはず）。`);
        if (!open && info.detailsHidden === null && sm.levels > 0) R.warnings.push(`${size.label} 手順 ${i + 1}「${sm.title}」: 「詳細」で開くまとまりが無い（冒頭の 1〜2 文しか無いか、最初のブロックが summary でない）。`);
        judge(info, size, R, sm);
        await shot(pg, `s${pad2(i + 1)}-l${lv + 1}${open ? '-open' : ''}-${size.label}.png`, R.shots, `${size.label} 手順 ${i + 1}「${sm.title}」細かさ ${lv + 1} / ${sm.levels}${open ? '（詳細を開いた状態）' : '（最初の状態）'}`);
      }
    }
    await evaluate(pg, `${G}.close()`);
  }

  // 6. 操作の確認（最初の画面の大きさ）
  const size = sizes[0];
  await setSize(pg, size);
  await navigate(pg, url);
  const N = meta.steps.length;
  await evaluate(pg, `(() => { try { localStorage.removeItem(${JSON.stringify('page-explainer:' + meta.id + ':last')}); } catch (_) {} return true; })()`);
  const fails = [];
  if (meta.launcher) {
    await clickGuide(pg, '.launcher');
    let s = await until(pg, (x) => x.open && x.mode === 'tour', 2000);
    if (!(s && s.open && s.mode === 'tour' && s.step === 0)) fails.push('案内を開くボタンを押しても、手順 1 から始まらない');
  } else {
    await evaluate(pg, `${G}.open(0)`);
  }
  await sleep(600);
  {
    const lay = await evaluate(pg, `${G}.__test.layout()`);
    if (lay.detailsHidden === false) fails.push('手順を開いた直後から、詳細が見えている（「詳細」を押すまで隠すはず）');
    if (lay.detailsHidden === true && lay.deeperVisible) fails.push('手順を開いた直後から、「分からない」が見えている（詳細の中に入れて、「詳細」を押すまで隠すはず）');
    if (lay.detailsHidden === true) {
      await clickGuide(pg, '[data-act="details"]');
      let l2 = await evaluate(pg, `${G}.__test.layout()`);
      if (!(l2.expanded && l2.detailsHidden === false)) fails.push('「詳細」を押しても、残りの説明が開かない');
      else await shot(pg, `details-open-${size.label}.png`, R.shots, `${size.label} 手順 1 で「詳細」を押したあと`);
      if (l2.detailsHidden === false && l2.deeperVisible === false) fails.push('「詳細」を開いても、「分からない」が見えない');
      await clickGuide(pg, '[data-act="details"]');
      l2 = await evaluate(pg, `${G}.__test.layout()`);
      if (!(l2.expanded === false && l2.detailsHidden === true)) fails.push('「詳細を閉じる」を押しても、残りの説明が閉じない');
    }
  }
  if (N > 1) {
    await press(pg, 'ArrowRight');
    let s = await state(pg);
    if (s.step !== 1) fails.push('→ キーで次の手順へ進まない');
    await press(pg, 'ArrowLeft');
    s = await state(pg);
    if (s.step !== 0) fails.push('← キーで前の手順へ戻らない');
  }
  if (meta.steps[0].levels > 1) {
    // 「分からない」は詳細の中にあるので、読み手と同じく、まず「詳細」を開く
    const lay0 = await evaluate(pg, `${G}.__test.layout()`);
    if (lay0.detailsHidden === true) await clickGuide(pg, '[data-act="details"]');
    await clickGuide(pg, '[data-act="deeper"]');
    let s = await state(pg);
    if (s.level !== 1) fails.push('「分からない」を押しても、1段細かい説明に切り替わらない');
    else if (!s.expanded) fails.push('「分からない」で切り替えた細かい説明が、詳細を閉じた状態で出る（開いた状態で出すはず）');
    await shot(pg, `deeper-${size.label}.png`, R.shots, `${size.label} 手順 1 で「分からない」を押したあと`);
    await clickGuide(pg, '[data-act="shallower"]');
    s = await state(pg);
    if (s.level !== 0) fails.push('「前の細かさに戻る」で、元の説明に戻らない');
  }
  await clickGuide(pg, '[data-act="toc"]');
  let s = await state(pg);
  if (!s.toc) fails.push('「目次」を押しても、目次が出ない');
  else {
    await shot(pg, `toc-${size.label}.png`, R.shots, `${size.label} 目次`);
    const target = Math.min(N - 1, 2);
    await clickGuide(pg, `.toc-item[data-i="${target}"]`);
    s = await until(pg, (x) => !x.toc && x.step === target, 1500);
    if (!(s && !s.toc && s.step === target)) fails.push('目次の手順を押しても、その手順へ移らない');
  }
  await press(pg, 'Escape');
  s = await state(pg);
  if (s.open) fails.push('Esc キーで案内が閉じない');
  if (meta.launcher) {
    const back = await evaluate(pg, `(() => { const sr = ${G}.__test.root; return document.activeElement === sr.host && !!sr.activeElement && sr.activeElement.classList.contains('launcher'); })()`);
    if (!back) fails.push('案内を閉じたあと、キーボードの焦点が案内を開くボタンに戻らない');
    if (N > 2) {
      await evaluate(pg, `${G}.open(2)`); await sleep(500); await evaluate(pg, `${G}.close()`); await sleep(300);
      await clickGuide(pg, '.launcher');
      s = await until(pg, (x) => x.open, 1500);
      if (!(s && s.open && s.mode === 'welcome')) fails.push('途中でやめたあとに案内を開くボタンを押しても、「続きから」を選ぶ画面が出ない');
      else {
        await shot(pg, `resume-${size.label}.png`, R.shots, `${size.label} 途中でやめたあとに開いたとき`);
        await clickGuide(pg, '[data-act="resume"]');
        s = await until(pg, (x) => x.mode === 'tour' && x.step === 2, 1500);
        if (!(s && s.step === 2)) fails.push('「続きから」を押しても、やめた手順に戻らない');
      }
      await evaluate(pg, `${G}.close()`);
    }
  }
  // 最も細かい説明で「分からない」→ 質問文
  const deepest = meta.steps[0].levels - 1;
  await evaluate(pg, `${G}.__test.show(0, ${deepest}, true)`, 20000);
  await clickGuide(pg, '[data-act="deeper"]');
  const ho = await evaluate(pg, `(() => { const sr = ${G}.__test.root; const ta = sr.querySelector('.handoff textarea'); return { shown: ${G}.state.handoff, text: ta ? ta.value : '' }; })()`);
  if (!ho.shown || !ho.text.includes('【案内で分からない所】')) fails.push('最も細かい説明で「分からない」を押しても、質問文が出ない');
  else {
    await clickGuide(pg, '[data-act="copy"]');
    const msg = await evaluate(pg, `(() => { const m = ${G}.__test.root.querySelector('.copied'); return m ? m.textContent : ''; })()`);
    if (!msg) fails.push('「質問文をコピー」を押しても、結果の知らせが出ない');
    await shot(pg, `handoff-${size.label}.png`, R.shots, `${size.label} 最も細かい説明で「分からない」を押したとき（質問文）`);
  }
  await evaluate(pg, `${G}.close()`);
  for (const f of fails) R.errors.push('操作: ' + f + '。');
  R.interaction = { checked: true, failures: fails.length };

  // 7. 暗い画面と、動きを減らす設定
  await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await navigate(pg, url);
  const di = Math.min(1, N - 1);
  const dinfo = await evaluate(pg, `${G}.__test.show(${di}, 0)`, 20000);
  if (!dinfo.settled) R.warnings.push('暗い画面・動きを減らす設定で、部品の位置が落ち着かなかった。');
  await shot(pg, `dark-s${pad2(di + 1)}-${size.label}.png`, R.shots, `${size.label} 暗い画面・動きを減らす設定で 手順 ${di + 1}`);
  await evaluate(pg, `${G}.close()`);
  await pg.send('Emulation.setEmulatedMedia', { features: [] });

  // 8. エラー（案内を止めたページには無いもの）
  const seen = new Set();
  for (const l of pg.logs) {
    if (seen.has(l.level + l.text)) continue;
    seen.add(l.level + l.text);
    if (l.text.includes('[page-explainer]')) (l.level === 'error' ? R.errors : R.warnings).push('案内のエンジンの知らせ: ' + l.text.slice(0, 300));
    else if (l.level === 'error' && !baseLogTexts.has(l.text)) R.errors.push('案内を付けたページにだけ出たエラー: ' + l.text.slice(0, 300) + (l.url ? `（${l.url}）` : ''));
  }
  R.logs = pg.logs.slice(0, 200);
  await cdp.send('Target.closeTarget', { targetId: pg.targetId });
}

// ---------------------------------------------------------------- 部品の候補（--outline）
async function outline(cdp, url, R) {
  const pg = await openPage(cdp, { disableGuide: true });
  let first = null;
  const byKey = new Map();
  for (const size of sizes) {
    await setSize(pg, size);
    await navigate(pg, url);
    const res = await evaluate(pg, OUTLINE_JS, 30000);
    await shot(pg, `page-${size.label}.png`, R.shots, `${size.label} ページ（画面に見えている部分）`);
    if (!first) {
      first = res;
      for (const it of res.items) { it.visibleAt = []; byKey.set(it.selector || `${it.tag}:${it.text}`, it); }
      if (opt.shots) {
        const m = await pg.send('Page.getLayoutMetrics');
        const cs = m.cssContentSize || m.contentSize;
        const hgt = Math.min(Math.ceil(cs.height), 8000);
        if (hgt > size.h + 10) {
          const r = await pg.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.min(Math.ceil(cs.width), size.w), height: hgt, scale: 1 } });
          fs.writeFileSync(path.join(outDir, `page-full-${size.label}.png`), Buffer.from(r.data, 'base64'));
          R.shots.push({ file: `page-full-${size.label}.png`, caption: `${size.label} ページ全体（上から ${hgt}px まで）` });
        }
      }
    }
    for (const it of res.items) { const k = it.selector || `${it.tag}:${it.text}`; const o = byKey.get(k); if (o && it.visible) o.visibleAt.push(size.label); }
  }
  R.outline = { title: first.title, scrollW: first.scrollW, scrollH: first.scrollH, items: [...byKey.values()] };
  R.logs = pg.logs.slice(0, 100);
}

// ---------------------------------------------------------------- 一覧の HTML
function writeGallery(R) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = (title, arr, cls) => arr.length ? `<h2>${title}（${arr.length} 件）</h2><ul class="${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>案内の確認の結果</title>
<style>body{margin:0;padding:24px;font:14px/1.7 "Segoe UI","Yu Gothic UI",Meiryo,sans-serif;background:#f4f4f5;color:#18181b}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.err li{color:#b91c1c}.warn li{color:#92400e}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden}
figure img{display:block;width:100%;height:auto;border-bottom:1px solid #e4e4e7}figcaption{padding:8px 12px;font-size:13px}</style></head><body>
<h1>案内の確認の結果</h1><p>${esc(R.file)}<br>${esc(R.when)}・${esc(R.browser)}・画面の大きさ ${esc(sizes.map((s) => s.label).join(', '))}</p>
${list('直すべき問題', R.errors, 'err')}${list('確かめる注意', R.warnings, 'warn')}
<h2>スクリーンショット（${R.shots.length} 枚）</h2><div class="grid">${R.shots.map((s) => `<figure><a href="${esc(s.file)}"><img src="${esc(s.file)}" alt="${esc(s.caption)}" loading="lazy"></a><figcaption>${esc(s.caption)}</figcaption></figure>`).join('')}</div></body></html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}

// ---------------------------------------------------------------- 実行
const exe = findBrowser(opt.browser);
if (!exe) { console.error('Chrome も Edge も見つからない。--browser にブラウザーの実行ファイルを指定するか、CHROME_PATH を設定する。'); process.exit(2); }
const R = { file, url: pathToFileURL(file).href, browser: path.basename(exe), when: new Date().toLocaleString('ja-JP'), sizes: sizes.map((s) => s.label), errors: [], warnings: [], steps: [], shots: [] };
let cdp = null;
let code = 0;
try {
  const ws = await launch(exe);
  cdp = await CDP.connect(ws);
  if (opt.outline) await outline(cdp, R.url, R);
  else await checkGuide(cdp, R.url, R);
} catch (e) {
  R.errors.push('確認を最後まで進められなかった: ' + (e && e.message ? e.message : e));
  code = /起動|つながらない|ブラウザーが終了/.test(String(e && e.message)) ? 2 : 1;
} finally {
  await shutdown(cdp);
}
fs.writeFileSync(path.join(outDir, opt.outline ? 'outline.json' : 'result.json'), JSON.stringify(R, null, 1));
if (opt.shots) writeGallery(R);

if (opt.outline && R.outline) {
  const it = R.outline.items;
  console.log(`ページ: ${R.outline.title || '（題名なし）'}（${file}）`);
  console.log(`ページの大きさ: 幅 ${R.outline.scrollW}px・高さ ${R.outline.scrollH}px（${sizes[0].label} で開いたとき）`);
  console.log(`指せる部品の候補: ${it.length} 個（見えている大きさ / 種類 / セレクター / 文字 / 位置 x,y 幅×高さ）`);
  const order = { '見出し': 0, '領域': 1, '操作': 2, 'id': 3 };
  const rows = [...it].sort((a, b) => (order[a.kind] - order[b.kind]) || (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
  for (const r of rows.slice(0, 250)) {
    console.log(`${(r.visibleAt.join(',') || '見えない').padEnd(18)} ${r.kind.padEnd(3, '　')} ${r.selector || '（一意のセレクターなし。text で指す）'}  「${r.text}」  ${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h}`);
  }
  if (rows.length > 250) console.log(`…ほか ${rows.length - 250} 個は outline.json にある`);
  console.log(`\nスクリーンショットと outline.json: ${outDir}`);
} else {
  console.log(`確認した: ${file}`);
  if (R.guide) console.log(`  案内: ${R.guide.title}（${R.guide.steps} 手順・説明の段 ${R.guide.levels}）`);
  console.log(`  ブラウザー: ${R.browser}（見えないブラウザー）・画面の大きさ: ${sizes.map((s) => s.label).join(', ')}`);
  console.log(`  スクリーンショット ${R.shots.length} 枚・結果: ${outDir}${opt.shots ? '（一覧は index.html）' : ''}`);
}
if (R.errors.length) { console.log(`\n直すべき問題: ${R.errors.length} 件`); for (const e of R.errors) console.log('  - ' + e); if (!code) code = 1; }
if (R.warnings.length) { console.log(`\n確かめる注意: ${R.warnings.length} 件`); for (const w of R.warnings) console.log('  - ' + w); }
if (!R.errors.length) console.log(opt.outline ? '' : '\n直すべき問題は無かった。');
process.exit(code);
