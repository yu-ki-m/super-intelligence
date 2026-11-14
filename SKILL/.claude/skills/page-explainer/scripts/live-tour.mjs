#!/usr/bin/env node
// page-explainer のライブの案内。
// URL のページを Playwright で開き、すべてのページに案内のエンジンを差し込んで（addInitScript）、ページを解説する。
// 読み手が吹き出しの「次へ」を押すと、台本（案内のデータの各手順の actions）に書いた操作
// （クリック・入力・選択・キー・ページの移動）を、解説と同じ暗幕と枠で操作する部分を照らしながら Playwright で行い、
// 移った先の画面で、次の手順の吹き出しを出す。前の手順へ戻るときは、最初の画面から操作をやり直す。
//
// 使い方:
//   node live-tour.mjs TOUR.json                     見えるブラウザーで案内を始める。ブラウザーを閉じると終わる
//   node live-tour.mjs TOUR.json --check --out DIR   見えないブラウザーで、全手順を操作しながら確かめ、スクリーンショットと結果を残す
//   node live-tour.mjs --outline URL --out DIR       URL を開いただけの画面で、指せる部品の候補（セレクター・文字・位置）を一覧にする
//   node live-tour.mjs --login URL --profile DIR    見えるブラウザーで URL を開く。依頼者が自分でログインして閉じると、
//                                                    ログインした状態が DIR に残り、--outline・--check・案内で --profile DIR を付けると使える
//   node live-tour.mjs TOUR.json --outline [--at K] --out DIR
//                                                    手順 K（1 から数える。省くと最後の手順）の前の操作までを行い、
//                                                    移った先の画面で、指せる部品の候補を一覧にする（台本を 1 手順ずつ書き足すときに使う）
// オプション:
//   --size 1440x900       画面の大きさ（--check では , 区切りで複数書ける）。見えるブラウザーでは窓の大きさ
//   --browser chrome      使うブラウザー（chrome / msedge / chromium。既定は chrome、無ければ msedge）
//   --profile DIR         ブラウザーのプロファイルを DIR に残す（ログインを次の回も使う）。省くと、閉じたら消える一時のプロファイル
//   --slow 1200           自動の操作の前に、操作する部分を照らして、中身を見せておく時間（ミリ秒。--check では 0）
//   --allow-change        "allow_change": true を付けた操作（データを送る・変える操作）を、--check でも行う
// 必要なもの: Node.js 18 以上と、Playwright（playwright-core。Playwright の MCP や CLI を入れていれば、その中のものを使う）
// 終了コード: 0 問題なし（注意はありうる）/ 1 直すべき問題がある / 2 Playwright やブラウザーが見つからない・台本を読めない

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUTLINE_JS } from './outline-js.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------- 引数と台本
const argv = process.argv.slice(2);
const opt = { tour: null, check: false, outline: false, login: false, at: null, out: null, sizes: null, browser: null, profile: null, slow: null, allowChange: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--check') opt.check = true;
  else if (a === '--outline') opt.outline = true;
  else if (a === '--login') opt.login = true;
  else if (a === '--at') opt.at = Number(argv[++i]);
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--size' || a === '--sizes') opt.sizes = argv[++i];
  else if (a === '--browser') opt.browser = argv[++i];
  else if (a === '--profile') opt.profile = argv[++i];
  else if (a === '--slow') opt.slow = Number(argv[++i]);
  else if (a === '--allow-change') opt.allowChange = true;
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(0); }
  else if (!opt.tour) opt.tour = a;
  else { console.error('知らない引数: ' + a); process.exit(2); }
}
if (!opt.tour) { console.error('台本（案内のデータの JSON）を指定する。例: node live-tour.mjs tour.json'); process.exit(2); }
const isUrl = /^(https?|file):\/\//i.test(opt.tour);
if (opt.login && (!isUrl || !opt.profile)) { console.error('--login には、開く URL と --profile DIR（ログインした状態を残すフォルダー）を渡す。'); process.exit(2); }
if (isUrl && !opt.outline && !opt.login) { console.error('URL だけを渡せるのは --outline のときだけ。案内を始めるときと確かめるときは、台本（案内のデータの JSON）を渡す。'); process.exit(2); }
const tourPath = isUrl ? opt.tour : path.resolve(opt.tour);
let tour;
if (isUrl) tour = { start_url: opt.tour, steps: [{ id: 'page', title: opt.tour }] };
else {
  try { tour = JSON.parse(fs.readFileSync(tourPath, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { console.error('台本を読めない: ' + e.message); process.exit(2); }
}
if (!tour || typeof tour.start_url !== 'string' || !tour.start_url) { console.error('台本に start_url（最初に開く URL）が無い。'); process.exit(2); }
const steps = Array.isArray(tour.steps) ? tour.steps : [];
const N = steps.length;
if (!N) { console.error('台本に手順（steps）が無い。'); process.exit(2); }
const sizes = (opt.sizes || '1440x900').split(',').map((s) => {
  const m = s.trim().match(/^(\d+)x(\d+)$/);
  if (!m) { console.error('--size は 1440x900 の形で書く: ' + s); process.exit(2); }
  return { w: +m[1], h: +m[2], label: `${m[1]}x${m[2]}` };
});
const slow = opt.check ? 0 : (Number.isFinite(opt.slow) ? opt.slow : 1200);
const label = (tour.launcher && tour.launcher.label) || '解説';

// ---------------------------------------------------------------- Playwright を探す
function requireDir(dir) { try { return createRequire(path.join(dir, 'package.json'))(dir); } catch (_) { return null; } }
async function loadPlaywright() {
  for (const name of ['playwright-core', 'playwright']) {
    try { const m = await import(name); const x = m.chromium ? m : m.default; if (x && x.chromium) return x; } catch (_) { /* 次を試す */ }
  }
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* npm が無い */ }
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm', 'node_modules'));
  for (const r of roots) {
    for (const sub of ['@playwright/cli/node_modules', '@playwright/mcp/node_modules', '@playwright/test/node_modules', '']) {
      for (const lib of ['playwright-core', 'playwright']) {
        const d = path.join(r, sub, lib);
        if (fs.existsSync(path.join(d, 'package.json'))) { const m = requireDir(d); if (m && m.chromium) return m; }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- 差し込むもの
function engineSource() {
  const js = fs.readFileSync(path.join(ASSETS, 'guide-engine.js'), 'utf8');
  const css = fs.readFileSync(path.join(ASSETS, 'guide-engine.css'), 'utf8');
  const slot = 'const CSS = __GUIDE_CSS__;';
  if (!js.includes(slot)) throw new Error('assets/guide-engine.js に「const CSS = __GUIDE_CSS__;」が無い');
  return js.replace(slot, 'const CSS = ' + JSON.stringify(css) + ';');
}
// 案内のデータは、ライブの案内では毎回この形で渡す（誘いを出さず、操作は live-tour.mjs が受け持つ）
const guideForPage = Object.assign({}, tour, { start: 'manual' });
// ページに案内がすでに埋め込まれていても（古い名前のものも）、それは動かさず、ライブの案内のエンジンだけを動かす。
// 埋め込まれたエンジンは、ページを読み込む途中で動くので、それより前に「止める」印を立てておき、
// ライブの案内のエンジンを動かす間だけ、印を外す
const INIT = `(() => {
  if (window.top !== window) return;
  window.__PAGE_EXPLAINER_DISABLED__ = true;
  window.__HTML_OPERATION_GUIDE_DISABLED__ = true;
  window.__PAGE_EXPLAINER_LIVE__ = { guide: ${JSON.stringify(guideForPage)} };
  const run = () => {
    if (window.pageExplainer) return;
    delete window.__PAGE_EXPLAINER_DISABLED__;
    try {
${engineSource()}
    } finally { window.__PAGE_EXPLAINER_DISABLED__ = true; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
})();`;

// ページの中で、部品の指定（CSS セレクターの文字列か {selector, text, nth}）に合う部品を 1 つ探す（案内のエンジンが無くても動くように、ここに書く）
const FIND = (spec) => {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const vis = (el) => {
    if (!el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  let list = [];
  try {
    if (typeof spec === 'string') list = [...document.querySelectorAll(spec)];
    else if (spec && typeof spec === 'object') {
      list = [...document.querySelectorAll(spec.selector || '*')];
      if (spec.text) {
        const want = norm(spec.text);
        const has = (el) => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('title'), el.value].some((x) => typeof x === 'string' && norm(x).includes(want));
        list = list.filter(has);
        list = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
      }
      if (Number.isInteger(spec.nth)) list = list[spec.nth] ? [list[spec.nth]] : [];
    }
  } catch (_) { return null; }
  list = list.filter((el) => !el.closest('page-explainer'));
  return list.find(vis) || list[0] || null;
};

// データを送る・変える操作の歯止め。依頼者が許した操作（"allow_change": true）でなければ、押す前に止める
const CHANGE_WORDS = /送信|保存|削除|購入|登録|申し込|申込|確定|支払|決済|注文|送る|投稿|発行|承認|却下|差し戻|取り消|解約|退会|submit|save|delete|remove|buy|purchase|order|checkout|pay|send|post|publish|confirm|approve|reject/i;
async function guardChange(el, a, what) {
  if (a.allow_change && (!opt.check || opt.allowChange)) return;
  const info = await el.evaluate((e) => {
    const text = [e.innerText, e.value, e.getAttribute('aria-label'), e.getAttribute('title')].filter((x) => typeof x === 'string' && x.trim()).join(' ').replace(/\s+/g, ' ').slice(0, 60);
    const form = e.form || e.closest('form');
    const method = form ? String(form.getAttribute('method') || 'get').toLowerCase() : '';
    const submits = (e.tagName === 'BUTTON' && (e.getAttribute('type') || 'submit') === 'submit' && !!form) || (e.tagName === 'INPUT' && /^(submit|image)$/i.test(e.type));
    return { text, method, submits };
  });
  const sendsForm = (what === 'enter' && info.method && info.method !== 'get') || (info.submits && info.method && info.method !== 'get');
  if ((what === 'click' && CHANGE_WORDS.test(info.text)) || sendsForm) {
    if (a.allow_change) throw new Error(`データを送る・変える操作（「${info.text}」）なので、確かめるときは行わない。行うなら --allow-change を付ける。`);
    throw new Error(`データを送る・変える操作の可能性があるので止めた（「${info.text}」${sendsForm ? '、POST のフォームを送る' : ''}）。依頼者が明示して許した操作なら、その操作に "allow_change": true を付ける。`);
  }
}

// 手順の url（台本に書いた、その手順の画面の URL。* は何文字でもよい所）と、今の URL が合うか。
// 相対の URL は start_url を基準に直し、%E3%83… のような書き方は文字に戻してから比べる
const urlMatches = (cur, want, base) => {
  const plain = (u) => { const x = String(u).split('#')[0]; try { return decodeURI(x); } catch (_) { return x; } };
  const STAR = '__page_explainer_star__';
  let abs = String(want).split('*').join(STAR);
  try { abs = new URL(abs, base).href; } catch (_) { /* そのまま比べる */ }
  abs = plain(abs).split(STAR).join('*');
  const now = plain(cur);
  if (!abs.includes('*')) return now.startsWith(abs);
  const re = new RegExp('^' + abs.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(now);
};
const defaultSay = (a) => ({ click: '部品を押す', fill: `「${a.value ?? ''}」と入れる`, select: `「${a.value ?? ''}」を選ぶ`, check: '印を付ける', uncheck: '印を外す', press: `${a.key} キーを押す`, goto: '次のページを開く', hover: 'ポインターを重ねる', scroll: '部品の所まで画面を送る', wait: '画面が変わるのを待つ' }[a.do] || '操作する');

// ---------------------------------------------------------------- 1 つのブラウザーでの案内
class Session {
  constructor(ctx, { log, warn, engine = true, reshow = true }) {
    this.ctx = ctx; this.page = null; this.cur = 0; this.log = log; this.warn = warn || log; this.queue = Promise.resolve();
    this.pageErrors = []; this.engine = engine; this.autoReshow = reshow;
    this.open = false;          // 読み手が案内を開いているか（閉じたあとにページが移っても、吹き出しを出し直さないため）
    this.warned = new Set();    // 同じ注意を、何度も出さないため
  }
  async init() {
    if (this.engine) {
      await this.ctx.exposeBinding('__pageExplainerHost', (_source, msg) => { this.enqueue(msg); return true; });
      await this.ctx.addInitScript({ content: INIT });
    }
    this.ctx.on('page', (p) => { this.watch(p); this.page = p; p.bringToFront().catch(() => {}); });
    this.page = this.ctx.pages()[0] || await this.ctx.newPage();
    this.watch(this.page);
  }
  watch(p) {
    // ページが出す確認の窓（confirm など）は、データを変えないよう「キャンセル」で閉じる。
    // ページを離れるときの確認（beforeunload）だけは「離れる」を選ぶ（離れても、入れかけた内容が保存されずに消えるだけで、データは変わらない）
    p.on('dialog', async (d) => {
      const leave = d.type() === 'beforeunload';
      const text = leave ? 'ページを離れるときの確認が出たので、「離れる」を選んだ。'
        : `ページが確認の窓（「${String(d.message()).replace(/\s+/g, ' ').slice(0, 80)}」）を出したので、データを変えないよう「キャンセル」を選んで閉じた。`;
      this.log(text);
      try { if (leave) await d.accept(); else await d.dismiss(); } catch (_) { /* もう閉じている */ }
      if (!leave) p.evaluate((t) => window.pageExplainer && window.pageExplainer.__live && window.pageExplainer.__live.notice(t), text).catch(() => {});
    });
    // 読み手が自分で操作して（ログインのボタンを押すなど）ページが移ると、移った先のページには吹き出しが無い。
    // 案内を開いていたなら、移った先で、今の手順の吹き出しを出し直す（自動の操作で移ったときは、操作のあとに出すので、何もしない）
    p.on('framenavigated', (f) => { if (this.engine && this.autoReshow && f === p.mainFrame() && this.open) this.enqueue({ type: 'reshow', page: p }); });
    p.on('pageerror', (e) => this.pageErrors.push(String(e && e.message || e)));
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (t.includes('[page-explainer]')) this.pageErrors.push(t); } });
  }
  // 吹き出しから届いた知らせを、1 つずつ順に処理する（操作の途中で次の知らせが来ても、重ならない）
  enqueue(msg) { this.queue = this.queue.then(() => this.handle(msg)).catch((e) => this.fail(e)); }
  async handle(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'next') await this.goTo(this.cur + 1);
    else if (msg.type === 'goto') await this.goTo(Number(msg.to));
    else if (msg.type === 'resume') await this.showStep(this.cur);
    else if (msg.type === 'reshow') {
      if (!this.open || msg.page !== this.page || this.page.isClosed()) return;
      await this.ensureEngine(this.page);
      const st = await this.page.evaluate(() => window.pageExplainer.__live.state()).catch(() => null);
      if (st && st.open) return;
      await this.showStep(this.cur);
    }
    else if (msg.type === 'close') { this.open = false; this.log(`案内を閉じた（手順 ${Number(msg.at) + 1}）。ページは自由に操作できる。画面の隅の「${label}」で、この手順から開き直せる。`); }
    else if (msg.type === 'end') { this.open = false; this.log('案内を最後まで進めた。ブラウザーを閉じると終わる。'); }
  }
  async fail(e) {
    const m = e && e.message ? e.message : String(e);
    this.log('操作の途中で止まった: ' + m);
    try { await this.showStep(this.cur, { notice: `次の手順へ進む操作の途中で止まった：${m}　ページの状態が変わっていることがある。「次へ」でもう一度試すか、案内を閉じて自分で操作する。` }); } catch (_) { /* 吹き出しも出せない */ }
  }
  async start() {
    await this.page.goto(tour.start_url, { waitUntil: 'load', timeout: 60000 });
    await this.runActions(0, { visible: true });
    this.cur = 0;
    return this.showStep(0);
  }
  // 手順 j へ移る。先へ進むときは、間の手順の操作を順に行う。前へ戻るときは、間に操作があれば、最初の画面からやり直す
  async goTo(j) {
    j = Math.max(0, Math.min(N - 1, j | 0));
    if (j > this.cur) {
      for (let k = this.cur + 1; k <= j; k++) { await this.runActions(k, { visible: true }); this.cur = k; }
      return this.showStep(j);
    }
    if (j < this.cur && steps.slice(j + 1, this.cur + 1).some((s) => Array.isArray(s.actions) && s.actions.length)) await this.replay(j);
    this.cur = j;
    return this.showStep(j);
  }
  async replay(j) {
    this.log(`手順 ${j + 1} の画面に戻すため、最初の画面から操作をやり直す。`);
    await this.page.goto(tour.start_url, { waitUntil: 'load', timeout: 60000 });
    for (let k = 0; k <= j; k++) await this.runActions(k, { visible: false });
  }
  async runActions(k, { visible }) {
    const acts = Array.isArray(steps[k].actions) ? steps[k].actions : [];
    if (!acts.length) return;
    // 見せずに操作するとき（確かめるとき・戻るためにやり直すとき）は、操作の前に案内の層を閉じる。
    // 開いたままだと、モーダルの層がページを覆い、ページの部品がクリックや入力を受け取れない。
    // 見せながら操作するときは閉じない（エンジンの operate が、暗幕を出したまま、クリックを通す表示に切り替える）
    if (!visible) await this.page.evaluate(() => window.pageExplainer && window.pageExplainer.__live && window.pageExplainer.__live.hide()).catch(() => {});
    for (let n = 0; n < acts.length; n++) await this.doAction(k, acts[n], visible, n, acts.length);
  }
  async ensureEngine(pg, ms = 15000) {
    await pg.waitForFunction(() => !!(window.pageExplainer && window.pageExplainer.__live), null, { timeout: ms });
  }
  async el(pg, spec, timeout) {
    if (spec == null) throw new Error('操作する部品（target）が台本に無い');
    const t0 = Date.now();
    for (;;) {
      const hnd = await pg.evaluateHandle(FIND, spec).catch(() => null);
      const el = hnd && hnd.asElement();
      if (el) return el;
      if (Date.now() - t0 > timeout) throw new Error('操作する部品が見つからない: ' + JSON.stringify(spec));
      await sleep(200);
    }
  }
  async settle() {
    const pg = this.page;
    try { await pg.waitForLoadState('domcontentloaded', { timeout: 20000 }); } catch (_) { /* 待ちきれなくても進む */ }
    try { await pg.waitForLoadState('load', { timeout: 10000 }); } catch (_) { /* 待ちきれなくても進む */ }
    await sleep(300);
  }
  async doAction(k, a, visible, n = 0, total = 1) {
    const pg = this.page;
    const say = a.say || defaultSay(a);
    // 見せながら操作するときは、解説と同じ暗幕と枠で、操作する部分を照らし、吹き出しに操作の中身を出してから、少し待って操作する
    // （待つ間に、読み手は、どこが・どう操作されるかを読める。急に画面が変わって驚かないようにするため）
    if (visible && (a.do !== 'wait' || a.say)) {
      try { await this.ensureEngine(pg, 8000); await pg.evaluate((x) => window.pageExplainer.__live.operate(x), { say, target: a.target == null ? null : a.target, index: n, total }); } catch (_) { /* 見せられなくても操作は行う */ }
      if (slow) await sleep(slow);
    }
    this.log(`手順 ${k + 1} の前の操作: ${say}`);
    const timeout = Number(a.timeout) || 15000;
    if (a.do === 'goto') {
      await pg.goto(new URL(a.url, pg.url()).href, { waitUntil: 'load', timeout: Math.max(timeout, 30000) });
    } else if (a.do === 'wait') {
      if (a.target != null) await this.el(pg, a.target, timeout);
      else if (a.text) await pg.getByText(String(a.text)).first().waitFor({ timeout });
      else await sleep(Number(a.ms) || 500);
    } else if (a.do === 'press' && a.target == null) {
      await pg.keyboard.press(String(a.key));
    } else {
      const el = await this.el(pg, a.target, timeout);
      if (a.do === 'click') { await guardChange(el, a, 'click'); await el.click({ timeout }); }
      else if (a.do === 'press') { if (/^enter$/i.test(String(a.key))) await guardChange(el, a, 'enter'); await el.press(String(a.key)); }
      else if (a.do === 'fill') {
        const value = String(a.value ?? '');
        if (visible) { await el.fill(''); await el.focus(); await pg.keyboard.type(value, { delay: 35 }); } else await el.fill(value);
      }
      else if (a.do === 'select') await el.selectOption(Array.isArray(a.value) ? a.value.map(String) : String(a.value));
      else if (a.do === 'check') await el.check({ timeout });
      else if (a.do === 'uncheck') await el.uncheck({ timeout });
      else if (a.do === 'hover') await el.hover({ timeout });
      else if (a.do === 'scroll') await el.scrollIntoViewIfNeeded({ timeout });
      else throw new Error('知らない操作: ' + a.do);
    }
    await this.settle();
  }
  async showStep(j, extra = {}) {
    const pg = this.page;
    await this.ensureEngine(pg);
    const st = steps[j];
    if (st.url && !urlMatches(pg.url(), st.url, tour.start_url) && !this.warned.has('url' + j)) {
      this.warned.add('url' + j);
      this.warn(`手順 ${j + 1}「${st.title}」の画面の URL が、台本の url と違う（今: ${pg.url()}、台本: ${st.url}）。前の手順の操作で、思った画面に移れていないことがある。`);
    }
    this.open = true;
    const info = await pg.evaluate(([i, o]) => window.pageExplainer.__live.show(i, o), [j, { expanded: !!extra.expanded, level: extra.level }]);
    if (extra.notice) await pg.evaluate((t) => window.pageExplainer.__live.notice(t), extra.notice);
    info.url = pg.url();
    return info;
  }
}

// ---------------------------------------------------------------- ブラウザーを開く
async function launch(chromium, size, headless) {
  const args = ['--disable-features=Translate'];
  if (!headless) args.push(`--window-size=${size.w},${size.h}`);
  const ctxOpts = { bypassCSP: true, locale: 'ja-JP', viewport: headless ? { width: size.w, height: size.h } : null };
  const want = opt.browser || 'chrome';
  const channels = want === 'chromium' ? [undefined] : [want, want === 'chrome' ? 'msedge' : 'chrome', undefined];
  let last;
  for (const channel of channels) {
    try {
      if (opt.profile) {
        const ctx = await chromium.launchPersistentContext(path.resolve(opt.profile), { headless, channel, args, ...ctxOpts });
        return { ctx, close: () => ctx.close(), closed: new Promise((r) => ctx.on('close', r)) };
      }
      const browser = await chromium.launch({ headless, channel, args });
      const ctx = await browser.newContext(ctxOpts);
      return { ctx, close: () => browser.close(), closed: new Promise((r) => browser.on('disconnected', r)) };
    } catch (e) { last = e; }
  }
  throw last;
}

// ---------------------------------------------------------------- 確かめる（--check）
function judge(info, size, R, st, j, what) {
  const where = `${size.label} 手順 ${j + 1}「${st.title}」${what}`;
  const t = info.target;
  if (t.expected) {
    if (t.count === 0) (st.missing ? R.warnings : R.errors).push(`${where}: 指す部分が見つからない（target: ${JSON.stringify(st.target)}、ページ: ${info.url}）。`);
    else if (!t.visible) (st.missing ? R.warnings : R.errors).push(`${where}: 指す部分はあるが、見えていない。`);
  }
  const b = info.balloon, v = info.viewport;
  if (b.x < -1 || b.y < -1 || b.x + b.w > v.w + 1 || b.y + b.h > v.h + 1) R.errors.push(`${where}: 吹き出しが画面の外にはみ出している（吹き出し ${b.x},${b.y} ${b.w}×${b.h}、画面 ${v.w}×${v.h}）。`);
  if (t.visible && info.overlap > 0) (info.forced ? R.warnings : R.errors).push(`${where}: 吹き出しが指す部分に重なっている（重なり ${info.overlap}px²${info.forced ? '。部分が大きく、置く場所が無い' : ''}）。`);
  if (info.overflowX) R.errors.push(`${where}: 吹き出しの中身が横にはみ出している。`);
  if (!info.settled) R.warnings.push(`${where}: 部分の位置が落ち着かなかった。`);
}
function writeGallery(dir, R) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = (title, arr, cls) => arr.length ? `<h2>${title}（${arr.length} 件）</h2><ul class="${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ライブの案内の確認の結果</title>
<style>body{margin:0;padding:24px;font:14px/1.7 "Segoe UI","Yu Gothic UI",Meiryo,sans-serif;background:#f4f4f5;color:#18181b}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
.err li{color:#b91c1c}.warn li{color:#92400e}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden}
figure img{display:block;width:100%;height:auto;border-bottom:1px solid #e4e4e7}figcaption{padding:8px 12px;font-size:13px}</style></head><body>
<h1>ライブの案内の確認の結果</h1><p>${esc(R.tour)}<br>${esc(R.start_url)}<br>${esc(R.when)}</p>
${list('直すべき問題', R.errors, 'err')}${list('確かめる注意', R.warnings, 'warn')}
<h2>操作の記録</h2><ol>${R.log.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
<h2>スクリーンショット（${R.shots.length} 枚）</h2><div class="grid">${R.shots.map((s) => `<figure><a href="${esc(s.file)}"><img src="${esc(s.file)}" alt="${esc(s.caption)}" loading="lazy"></a><figcaption>${esc(s.caption)}</figcaption></figure>`).join('')}</div></body></html>`);
}

async function runCheck(chromium) {
  const outDir = path.resolve(opt.out || path.join(os.tmpdir(), 'page-explainer-live-check', path.basename(tourPath).replace(/\.[^.]+$/, '') + '-' + Date.now()));
  fs.mkdirSync(outDir, { recursive: true });
  const R = { tour: tourPath, start_url: tour.start_url, when: new Date().toLocaleString('ja-JP'), errors: [], warnings: [], steps: [], shots: [], log: [] };
  const shot = async (pg, name, caption) => { await pg.screenshot({ path: path.join(outDir, name) }); R.shots.push({ file: name, caption }); };
  for (const size of sizes) {
    const first = size === sizes[0];
    const { ctx, close } = await launch(chromium, size, true);
    // 確かめるときは、操作と吹き出しの表示を、この関数が順に行う（ページが移ったときの出し直しは行わない）
    const s = new Session(ctx, { reshow: false, log: (m) => R.log.push(`${size.label} ${m}`), warn: (m) => { R.log.push(`${size.label} 注意: ${m}`); R.warnings.push(`${size.label} ${m}`); } });
    try {
      await s.init();
      await s.page.goto(tour.start_url, { waitUntil: 'load', timeout: 60000 });
      await s.runActions(0, { visible: false });
      for (let j = 0; j < N; j++) {
        const st = steps[j];
        if (j > 0) {
          const acts = Array.isArray(st.actions) ? st.actions : [];
          // 最初の操作を見せる表示（暗幕と橙の枠で操作する部分を照らし、吹き出しに中身を出す）を撮り、
          // そのとき、照らしている部分にクリックが届くか（案内の層がさえぎらないか）を調べる
          if (acts.length && acts[0].do !== 'wait') {
            try {
              await s.ensureEngine(s.page, 8000);
              await s.page.evaluate((x) => window.pageExplainer.__live.operate(x), { say: acts[0].say || defaultSay(acts[0]), target: acts[0].target == null ? null : acts[0].target, index: 0, total: acts.length });
              if (acts[0].target != null) {
                const hit = await s.page.evaluate((spec) => {
                  const el = window.pageExplainer.__live.findOne(spec); if (!el) return null;
                  const r = el.getBoundingClientRect();
                  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                  return !!top && !top.closest('page-explainer') && (top === el || el.contains(top) || top.contains(el));
                }, acts[0].target);
                if (hit === false) R.errors.push(`${size.label} 手順 ${j + 1}: 操作を見せている間、案内の層が操作する部分を覆っていて、クリックや入力が届かない。`);
                const lay = await s.page.evaluate(() => window.pageExplainer.__test.layout());
                const b = lay.balloon, v = lay.viewport;
                if (b.x < -1 || b.y < -1 || b.x + b.w > v.w + 1 || b.y + b.h > v.h + 1) R.errors.push(`${size.label} 手順 ${j + 1}: 操作を見せる吹き出しが画面の外にはみ出している。`);
                if (lay.target.visible && lay.overlap > 0 && !lay.forced) R.errors.push(`${size.label} 手順 ${j + 1}: 操作を見せる吹き出しが、操作する部分に重なっている。`);
              }
              if (first) await shot(s.page, `s${pad2(j + 1)}-op-${size.label}.png`, `${size.label} 手順 ${j + 1} の前の操作「${acts[0].say || defaultSay(acts[0])}」を見せているところ`);
              await s.page.evaluate(() => window.pageExplainer.__live.idle());
            } catch (e) { R.warnings.push(`${size.label} 手順 ${j + 1}: 操作を見せる表示を出せなかった: ${e.message}`); }
          }
          try { await s.runActions(j, { visible: false }); } catch (e) { R.errors.push(`${size.label} 手順 ${j + 1}「${st.title}」へ進む操作で止まった: ${e.message}`); throw e; }
          s.cur = j;
        }
        const views = [{ expanded: false, label: '' , tag: '' }, { expanded: true, label: '（詳細を開いた状態）', tag: '-open' }];
        if (first) for (let lv = 1; lv < (st.levels || []).length; lv++) views.push({ expanded: true, level: lv, label: `（細かさ ${lv + 1}）`, tag: `-l${lv + 1}` });
        for (const v of views) {
          const info = await s.showStep(j, v);
          info.size = size.label; info.view = v.label;
          R.steps.push(info);
          judge(info, size, R, st, j, v.label);
          // 読み手が自分で操作する手順（interactive）では、指す部分を、案内の層がさえぎらずに押せるか
          if (st.interactive && info.target.visible && !v.expanded) {
            const hit = await s.page.evaluate((spec) => {
              const el = window.pageExplainer.__live.findOne(spec); if (!el) return null;
              const r = el.getBoundingClientRect();
              const top = document.elementFromPoint(r.left + Math.min(r.width / 2, 24), r.top + Math.min(r.height / 2, 12));
              return !!top && !top.closest('page-explainer') && (top === el || el.contains(top) || top.contains(el));
            }, st.target);
            if (hit === false) R.errors.push(`${size.label} 手順 ${j + 1}「${st.title}」: 読み手が自分で操作する手順なのに、指す部分を押せない（案内の層か吹き出しが上にある）。`);
          }
          if (!v.expanded && info.detailsHidden === false) R.errors.push(`${size.label} 手順 ${j + 1}: 最初から詳細が開いている。`);
          if (!v.expanded && info.detailsHidden === true && info.deeperVisible) R.errors.push(`${size.label} 手順 ${j + 1}: 最初から「分からない」が見えている（詳細の中に入れるはず）。`);
          if (v.expanded && info.detailsHidden === false && info.deeperVisible === false) R.errors.push(`${size.label} 手順 ${j + 1}: 詳細を開いても「分からない」が見えない。`);
          await shot(s.page, `s${pad2(j + 1)}${v.tag}-${size.label}.png`, `${size.label} 手順 ${j + 1}「${st.title}」${v.label || '（最初の状態）'}　${info.url}`);
        }
      }
      if (first && N > 1) {
        // 吹き出しの「次へ」を本物のクリックで押し、操作を受け持つ側への知らせ、照らしたままの自動の操作、次の手順の表示までが通るか。
        // 次の手順に操作がある所で押す（無ければ手順 1 で押す）
        const withOps = steps.findIndex((x, i) => i > 0 && Array.isArray(x.actions) && x.actions.length);
        const from = withOps > 0 ? withOps - 1 : 0, to = from + 1;
        await s.page.goto(tour.start_url, { waitUntil: 'load', timeout: 60000 });
        for (let k = 0; k <= from; k++) await s.runActions(k, { visible: false });
        s.cur = from;
        await s.showStep(from);
        const pos = await s.page.evaluate(() => { const b = window.pageExplainer.__test.root.querySelector('[data-act="next"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        if (!pos) R.errors.push('操作: 吹き出しに「次へ」が無い。');
        else {
          await s.page.mouse.click(pos.x, pos.y);
          const t0 = Date.now(); let ok = false;
          while (Date.now() - t0 < 30000) {
            await sleep(400);
            const st1 = await s.page.evaluate(() => (window.pageExplainer && window.pageExplainer.__live) ? window.pageExplainer.__live.state() : null).catch(() => null);
            if (st1 && st1.open && st1.mode === 'tour' && st1.step === to && s.cur === to) { ok = true; break; }
          }
          if (!ok) R.errors.push(`操作: 手順 ${from + 1} で吹き出しの「次へ」を押しても、自動の操作と、次の手順（手順 ${to + 1}）の表示までが通らない。`);
          else {
            // 吹き出しが動き終わるまで待ってから（受け持つ側の処理が終わるまで待ってから）、置き方を調べて撮る
            await s.queue;
            const info = await s.page.evaluate(() => window.pageExplainer.__test.layout());
            info.url = s.page.url();
            judge(info, size, R, steps[to], to, '（「次へ」を押したあと）');
            await shot(s.page, `next-click-${size.label}.png`, `${size.label} 手順 ${from + 1} で「次へ」を押し、自動の操作のあとに手順 ${to + 1} が出たところ`);
          }
        }
        // 前の手順へ戻る（最初からやり直す）
        const m = steps.map((x, i) => (i > 0 && Array.isArray(x.actions) && x.actions.length ? i : -1)).filter((i) => i > 0).pop();
        if (m != null) {
          for (let k = s.cur + 1; k <= m; k++) { await s.runActions(k, { visible: false }); s.cur = k; }
          const info = await s.goTo(m - 1);
          if (info.step !== m - 1) R.errors.push(`操作: 手順 ${m + 1} から手順 ${m} に戻せなかった。`);
          else { judge(info, sizes[0], R, steps[m - 1], m - 1, '（戻ったあと）'); await shot(s.page, `back-${sizes[0].label}.png`, `${sizes[0].label} 手順 ${m + 1} から手順 ${m} に戻ったあと（最初からやり直した）`); }
        }
      }
    } catch (e) {
      if (!R.errors.some((x) => x.includes(e.message))) R.errors.push(`${size.label}: 案内を最後まで進められなかった: ${e.message}`);
    } finally {
      for (const t of s.pageErrors) if (!R.errors.includes('案内のエンジンの知らせ: ' + t)) R.warnings.push('案内のエンジンやページの知らせ: ' + t.slice(0, 300));
      await close().catch(() => {});
    }
  }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(R, null, 1));
  writeGallery(outDir, R);
  console.log(`確かめた: ${tour.title || ''}（${N} 手順）`);
  console.log(`  最初の URL: ${tour.start_url}`);
  console.log(`  スクリーンショット ${R.shots.length} 枚・結果: ${outDir}（一覧は index.html）`);
  if (R.errors.length) { console.log(`\n直すべき問題: ${R.errors.length} 件`); for (const e of R.errors) console.log('  - ' + e); }
  if (R.warnings.length) { console.log(`\n確かめる注意: ${R.warnings.length} 件`); for (const w of R.warnings) console.log('  - ' + w); }
  if (!R.errors.length) console.log('\n直すべき問題は無かった。');
  return R.errors.length ? 1 : 0;
}

// ---------------------------------------------------------------- 指せる部品の候補（--outline）
// 台本を書くときに使う。手順 K の前の操作までを行い、移った先の画面で、指せる部品の候補を集める。
// 案内のエンジンは差し込まない（ページそのものの部品だけを集める）
async function runOutline(chromium) {
  const outDir = path.resolve(opt.out || path.join(os.tmpdir(), 'page-explainer-live-outline', String(Date.now())));
  fs.mkdirSync(outDir, { recursive: true });
  const at = opt.at == null || !Number.isFinite(opt.at) ? N - 1 : Math.max(0, Math.min(N - 1, Math.round(opt.at) - 1));
  const R = { start_url: tour.start_url, at: at + 1, url: null, title: null, scrollW: 0, scrollH: 0, items: [], log: [], errors: [], shots: [] };
  const byKey = new Map();
  for (const size of sizes) {
    const first = size === sizes[0];
    const { ctx, close } = await launch(chromium, size, true);
    const s = new Session(ctx, { log: (m) => R.log.push(`${size.label} ${m}`), engine: false });
    try {
      await s.init();
      await s.page.goto(tour.start_url, { waitUntil: 'load', timeout: 60000 });
      for (let k = 0; k <= at; k++) {
        try { await s.runActions(k, { visible: false }); } catch (e) { R.errors.push(`${size.label} 手順 ${k + 1} の前の操作で止まった: ${e.message}`); throw e; }
      }
      await sleep(400);
      const res = await s.page.evaluate(OUTLINE_JS);
      await s.page.screenshot({ path: path.join(outDir, `page-${size.label}.png`) });
      R.shots.push({ file: `page-${size.label}.png`, caption: `${size.label} 手順 ${at + 1} の画面（見えている部分）` });
      if (first) {
        Object.assign(R, { url: s.page.url(), title: res.title, scrollW: res.scrollW, scrollH: res.scrollH });
        for (const it of res.items) { it.visibleAt = []; byKey.set(it.selector || `${it.tag}:${it.text}`, it); }
        const hgt = Math.min(res.scrollH, 8000);
        if (hgt > size.h + 10) {
          await s.page.screenshot({ path: path.join(outDir, `page-full-${size.label}.png`), fullPage: true, clip: { x: 0, y: 0, width: Math.min(res.scrollW, size.w), height: hgt } });
          R.shots.push({ file: `page-full-${size.label}.png`, caption: `${size.label} 手順 ${at + 1} の画面の全体（上から ${hgt}px まで）` });
        }
      }
      for (const it of res.items) { const o = byKey.get(it.selector || `${it.tag}:${it.text}`); if (o && it.visible) o.visibleAt.push(size.label); }
    } catch (e) {
      if (!R.errors.some((x) => x.includes(e.message))) R.errors.push(`${size.label}: 画面を開けなかった: ${e.message}`);
    } finally { await close().catch(() => {}); }
  }
  R.items = [...byKey.values()];
  fs.writeFileSync(path.join(outDir, 'outline.json'), JSON.stringify(R, null, 1));
  console.log(`手順 ${at + 1} の画面: ${R.title || '（題名なし）'}`);
  console.log(`  URL: ${R.url || '（開けなかった）'}`);
  console.log(`  ページの大きさ: 幅 ${R.scrollW}px・高さ ${R.scrollH}px（${sizes[0].label} で開いたとき）`);
  for (const l of R.log) console.log('  ' + l);
  console.log(`指せる部品の候補: ${R.items.length} 個（見えている大きさ / 種類 / セレクター / 文字 / 位置 x,y 幅×高さ）`);
  const order = { '見出し': 0, '領域': 1, '操作': 2, 'id': 3 };
  const rows = [...R.items].sort((a, b) => (order[a.kind] - order[b.kind]) || (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
  for (const r of rows.slice(0, 250)) console.log(`${(r.visibleAt.join(',') || '見えない').padEnd(18)} ${r.kind.padEnd(3, '　')} ${r.selector || '（一意のセレクターなし。text で指す）'}  「${r.text}」  ${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h}`);
  if (rows.length > 250) console.log(`…ほか ${rows.length - 250} 個は outline.json にある`);
  console.log(`\nスクリーンショットと outline.json: ${outDir}`);
  if (R.errors.length) { console.log(`\n直すべき問題: ${R.errors.length} 件`); for (const e of R.errors) console.log('  - ' + e); }
  return R.errors.length ? 1 : 0;
}

// ---------------------------------------------------------------- 実行
const pw = await loadPlaywright();
if (!pw) { console.error('Playwright（playwright-core）が見つからない。`npm install -g playwright-core` で入れるか、Playwright の MCP か CLI を入れる。'); process.exit(2); }
const { chromium } = pw;
let code = 0;
if (opt.login) {
  // 依頼者が自分でログインするための、見えるブラウザー。Claude はパスワードを見ないし、入れない
  let opened;
  try { opened = await launch(chromium, sizes[0], false); } catch (e) { console.error('ブラウザーを開けない: ' + e.message); process.exit(2); }
  const pg = opened.ctx.pages()[0] || await opened.ctx.newPage();
  await pg.goto(tour.start_url, { waitUntil: 'load', timeout: 60000 }).catch((e) => console.log('ページを開けなかった: ' + e.message));
  console.log(`ログイン用のブラウザーを開いた。ログインが終わったら、ブラウザーを閉じる。ログインした状態は ${path.resolve(opt.profile)} に残る。`);
  await opened.closed;
  console.log('ブラウザーが閉じられた。');
} else if (opt.outline) {
  try { code = await runOutline(chromium); } catch (e) { console.error('部品の候補を集められなかった: ' + (e && e.message ? e.message : e)); code = /Executable|browser|channel/i.test(String(e && e.message)) ? 2 : 1; }
} else if (opt.check) {
  try { code = await runCheck(chromium); } catch (e) { console.error('確認を進められなかった: ' + (e && e.message ? e.message : e)); code = /Executable|browser|channel/i.test(String(e && e.message)) ? 2 : 1; }
} else {
  let opened;
  try { opened = await launch(chromium, sizes[0], false); } catch (e) { console.error('ブラウザーを開けない: ' + e.message); process.exit(2); }
  const s = new Session(opened.ctx, { log: (m) => console.log(m) });
  await s.init();
  try { await s.start(); } catch (e) { await s.fail(e); }
  console.log(`案内を始めた: ${tour.title || ''}（${N} 手順）。吹き出しの「次へ」で進む。前の手順へ戻ると、最初の画面から操作をやり直す。ブラウザーを閉じると終わる。`);
  await opened.closed;
  console.log('ブラウザーが閉じられたので、案内を終えた。');
}
process.exit(code);
