import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = s => createHash('sha256').update(s).digest('hex');
const save = (path, data) => writeFile(path, data, { flag: 'wx', mode: 0o600 });
const json = value => JSON.stringify(value, null, 2) + '\n';
const launchOptions = () => process.env.SCREEN_CHROMIUM ? {executablePath: process.env.SCREEN_CHROMIUM} : {};

// Parse without executing captured scripts or allowing requests. CSP also protects later viewing.
export async function inertHTML(browser, html) {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  await context.route('**/*', route => route.abort());
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.evaluate(() => {
      const clean = node => {
        node.querySelectorAll('script,iframe,frame,object,embed,base,meta[http-equiv],link[rel="preload"],link[rel="prefetch"],link[rel="modulepreload"],link[rel="canonical"]').forEach(e => e.remove());
        node.querySelectorAll('*').forEach(e => {
          for (const a of [...e.attributes]) {
            if (/^on/i.test(a.name) || ['action','formaction','ping','srcdoc'].includes(a.name.toLowerCase())) e.removeAttribute(a.name);
          }
          if (e.matches('a,area')) { e.removeAttribute('href'); e.removeAttribute('target'); }
          if (e.matches('input[type="password"],input[type="hidden"]')) { e.value = ''; e.removeAttribute('value'); }
          if (e.tagName === 'TEMPLATE') clean(e.content);
        });
      };
      clean(document);
      const policy = document.createElement('meta');
      policy.httpEquiv = 'Content-Security-Policy';
      policy.content = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; media-src data: blob:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
      document.head.prepend(policy);
      return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    });
  } finally { await context.close(); }
}

// Wait for finite CSS animations/transitions (e.g. a popup fading in) so a half-faded state is not saved.
async function settleAnimations(page, timeout = 5000) {
  return page.evaluate(timeout => {
    const finite = document.getAnimations().filter(a => {
      try { return a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime); } catch { return false; }
    });
    return Promise.race([
      Promise.allSettled(finite.map(a => a.finished)).then(() => ({ waited: finite.length, timedOut: false })),
      new Promise(r => setTimeout(() => r({ waited: finite.length, timedOut: true }), timeout))
    ]);
  }, timeout);
}

// Cross-origin images/fonts without CORS headers cannot be read by fetch() inside the page.
// Fall back to the same browser context's request client (shares its cookies) from Node.
async function exposeResourceFetch(page) {
  const name = '__screenFetch_' + Math.random().toString(36).slice(2);
  const request = page.context().request;
  await page.exposeFunction(name, async (url, accept, referrer) => {
    if (!/^https?:/i.test(url)) throw new Error('Unsupported URL scheme');
    const res = await request.get(url, { headers: { accept: accept || '*/*', ...(referrer ? { referer: referrer } : {}) }, timeout: 15000, maxRedirects: 5 });
    const body = await res.body();
    if (body.length > 10 * 1024 * 1024) throw new Error('Resource too large');
    return { status: res.status(), contentType: res.headers()['content-type'] || '', base64: body.toString('base64') };
  });
  return name;
}

export async function capturePage(page, out, { ready, label = '' } = {}) {
  if (ready) await page.locator(ready).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  const settled = await settleAnimations(page);
  const original = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollX, scrollY }));
  const manifest = { version: 1, label, capturedAt: new Date().toISOString(),
    viewport: { width: original.width, height: original.height }, scroll: {x:original.scrollX,y:original.scrollY},
    warnings: [], limitations: ['Static snapshot; application actions are not reproduced.', 'Unloaded/virtualized content is not captured.', 'Frames are omitted from the editable artifact.', 'Cross-origin resources may fail under CORS.'] };
  // Do not persist source URL/query, cookies, headers or browser storage by default.
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  await mkdir(out, { recursive: false, mode: 0o700 });
  const bundle = await readFile(join(root, 'dist/single-file.js'), 'utf8');
  const framesBundle = await readFile(join(root, 'dist/single-file-frames.js'), 'utf8');
  for (const frame of page.frames()) {
    try { await frame.evaluate(framesBundle); }
    catch { manifest.warnings.push('Frame script injection failed.'); }
  }
  if (settled.timedOut) manifest.warnings.push(`${settled.waited} animation(s) were still running at capture time.`);
  await page.evaluate(bundle);
  const fetchName = await exposeResourceFetch(page);
  let captured;
  try {
    captured = await page.evaluate(async fetchName => {
      const fallbacks = { used: 0, failed: 0 };
      const viaNode = async (url, options) => {
        const r = await globalThis[fetchName](url, options?.headers?.accept, options?.referrer);
        const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
        return new Response(bytes, { status: r.status >= 200 && r.status <= 599 ? r.status : 200, headers: r.contentType ? { 'content-type': r.contentType } : {} });
      };
      const fetch = async (url, options = {}) => {
        try {
          return await globalThis.fetch(url, { ...options, cache: 'force-cache', referrerPolicy: 'strict-origin-when-cross-origin' });
        } catch (error) {
          if (!/^https?:/i.test(url)) throw error;
          try { const r = await viaNode(url, options); fallbacks.used++; return r; }
          catch (e) { fallbacks.failed++; throw e; }
        }
      };
      const data = await globalThis.__screenSingleFile.getPageData({
        removeScripts: true, removeHiddenElements: false, removeUnusedStyles: false,
        removeUnusedFonts: false, removeFrames: true, loadDeferredContent: false,
        compressHTML: false, compressCSS: false, blockScripts: true,
        saveOriginalURLs: false, insertSingleFileComment: false,
        saveFavicon: false, maxResourceSizeEnabled: true, maxResourceSize: 10,
        networkTimeout: 15000
      }, { fetch, frameFetch: fetch });
      return { content: data.content, fallbacks };
    }, fetchName);
  } finally { await page.evaluate(({scrollX:x,scrollY:y}) => scrollTo(x,y), original); }
  manifest.resourceFallback = captured?.fallbacks;
  captured = captured?.content;
  if (typeof captured !== 'string' || !captured.includes('<html')) throw new Error('SingleFile returned no HTML.');
  const localBrowser = await chromium.launch(launchOptions());
  try {
    const html = await inertHTML(localBrowser, captured);
    await save(join(out, 'original.html'), html);
    manifest.sha256 = digest(html);
    manifest.warnings.push('Review original.html and offline-check.json visually before accepting fidelity.');
    await save(join(out, 'capture.json'), json(manifest));
    await render(localBrowser, html, out, 'original', manifest.viewport);
  } finally { await localBrowser.close(); }
  return manifest;
}

export async function render(browser, html, out, name, viewport) {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport });
  const blocked = [];
  await context.route('**/*', route => { blocked.push(route.request().resourceType()); return route.abort(); });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const report = await page.evaluate(() => ({
      brokenImages: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      externalResourceAttributes: [...document.querySelectorAll('[src],link[href]')].filter(e => /^(https?:)?\/\//i.test(e.getAttribute('src') || e.getAttribute('href') || '')).length
    }));
    const bytes = await page.screenshot({ fullPage: true, animations: 'disabled' });
    await save(join(out, name + '.png'), bytes);
    await save(join(out, name + '-offline-check.json'), json({ ...report, blockedResourceTypes: blocked,
      note: 'CSP may block resources before routing; zero requests does not prove visual completeness.' }));
  } finally { await context.close(); }
}

export async function mockup(input, patchFile, out, viewport) {
  const source = await readFile(input, 'utf8');
  const record = JSON.parse(await readFile(patchFile, 'utf8'));
  const patch = record.patch ?? record;
  if (patch.version !== 1 || !Array.isArray(patch.operations)) throw new Error('Expected version:1 and operations array.');
  if (!viewport) {
    try { viewport = JSON.parse(await readFile(join(resolve(input, '..'), 'capture.json'), 'utf8')).viewport; }
    catch { viewport = {width:1440, height:900}; }
  }
  await mkdir(dirname(out), { recursive: true, mode: 0o700 });
  await mkdir(out, { recursive: false, mode: 0o700 });
  const browser = await chromium.launch(launchOptions());
  try {
    const safe = await inertHTML(browser, source);
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    try {
      await page.setContent(safe);
      const result = await page.evaluate(patch => {
        const log = [];
        for (const [index, op] of patch.operations.entries()) {
          if (!['text','html','insert','remove','style'].includes(op.type)) throw new Error('Unknown operation: ' + op.type);
          const elements = [...document.querySelectorAll(op.selector)];
          const expected = op.expectedCount ?? 1;
          if (!Number.isInteger(expected) || expected < 1 || elements.length !== expected) throw new Error(`Operation ${index}: expected ${expected} matches; found ${elements.length}`);
          for (const e of elements) {
            if (op.type === 'text') e.textContent = String(op.value);
            if (op.type === 'html') e.innerHTML = String(op.value);
            if (op.type === 'insert') {
              if (!['beforebegin','afterbegin','beforeend','afterend'].includes(op.position)) throw new Error('Invalid insert position');
              e.insertAdjacentHTML(op.position, String(op.value));
            }
            if (op.type === 'remove') e.remove();
            if (op.type === 'style') for (const [key,value] of Object.entries(op.value)) e.style.setProperty(key, String(value));
          }
          log.push({ index, type:op.type, selector:op.selector, matched:elements.length });
        }
        if (patch.css) { const s = document.createElement('style'); s.textContent = patch.css; document.head.append(s); }
        return {html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML, log};
      }, patch);
      const clean = await inertHTML(browser, result.html);
      await save(join(out, 'mockup.html'), clean);
      await render(browser, clean, out, 'mockup', viewport);
      await page.setContent(clean);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(notes => {
        const layer = document.createElement('div'); layer.id = 'screen-mockup-annotations';
        layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483647;';
        document.body.append(layer);
        const origin = layer.getBoundingClientRect();
        for (const [i, note] of notes.entries()) {
          const items = document.querySelectorAll(note.selector);
          if (items.length !== 1) throw new Error('Annotation target must match exactly once: ' + note.selector);
          const r = items[0].getBoundingClientRect();
          if (!r.width || !r.height) throw new Error('Annotation target is not visible: ' + note.selector);
          const box = document.createElement('div');
          box.style.cssText = `position:absolute;left:${r.left - origin.left}px;top:${r.top - origin.top}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;border:3px solid #e66b00;z-index:2147483647;pointer-events:none;`;
          const badge = document.createElement('span'); badge.textContent = String(i + 1);
          badge.style.cssText = 'position:absolute;left:0;top:-20px;background:#a43d00;color:white;font:bold 14px sans-serif;padding:2px 7px;';
          box.append(badge); layer.append(box);
        }
        if (notes.length) {
          const panel = document.createElement('section');
          panel.style.cssText = 'position:relative;clear:both;margin:32px;padding:24px;background:#fff7ed;color:#402200;border:1px solid #e66b00;font-family:inherit;font-size:16px;line-height:1.7;';
          const heading=document.createElement('h2'); heading.textContent='変更箇所・補足'; panel.append(heading);
          for (const [i,note] of notes.entries()) { const item = document.createElement('p'); item.textContent = `${i+1}. ${note.text}`; panel.append(item); }
          document.body.append(panel);
        }
      }, patch.annotations || []);
      const annotated = await page.content();
      await save(join(out, 'annotated.html'), annotated);
      await render(browser, annotated, out, 'annotated', viewport);
      await save(join(out, 'changes.json'), json({sourceSha256:digest(source), viewport, patch, applied:result.log}));
    } finally { await context.close(); }
  } finally { await browser.close(); }
}

// ---- Browser started and operated by this skill (no Playwright MCP configuration required) ----
const DEFAULT_CDP = 'http://127.0.0.1:9222';
const defaultProfile = () => process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'screen-mockup-profile')
  : join(homedir(), '.screen-mockup-profile');

function findChrome(explicit) {
  const candidates = [explicit, process.env.SCREEN_BROWSER];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  try { candidates.push(chromium.executablePath()); } catch {}
  const found = candidates.find(p => p && existsSync(p));
  if (!found) throw new Error('No Chrome/Edge/Chromium found. Pass --chrome PATH or set SCREEN_BROWSER.');
  return found;
}

async function cdpVersion(endpoint) {
  try {
    const res = await fetch(new URL('/json/version', endpoint), { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export async function startBrowser({ cdp = DEFAULT_CDP, profile = defaultProfile(), chrome, headless = false, url } = {}) {
  const endpoint = new URL(cdp);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Only a localhost CDP endpoint is allowed.');
  const existing = await cdpVersion(cdp);
  if (existing) {
    if (url) await openTab({ cdp, url });
    return { reused: true, cdp, browser: existing.Browser };
  }
  const executable = findChrome(chrome);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const flags = [`--remote-debugging-port=${endpoint.port || 9222}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new'] : []), url || 'about:blank'];
  const child = spawn(executable, flags, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  for (let i = 0; i < 60; i++) {
    const v = await cdpVersion(cdp);
    if (v) return { reused: false, cdp, browser: v.Browser, executable, profile, pid: child.pid };
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Browser did not open CDP at ${cdp} within 15s. If Chrome was already running with the same profile, close it and retry.`);
}

async function withBrowser(cdp, fn) {
  const browser = await chromium.connectOverCDP(cdp || DEFAULT_CDP);
  try { return await fn(browser); }
  finally { await browser.close(); } // For connectOverCDP this disconnects the client, not the shared browser.
}
const tabsOf = browser => browser.contexts().flatMap(c => c.pages());
function pickTab(browser, { url, index }) {
  const pages = tabsOf(browser);
  if (index !== undefined) {
    const page = pages[Number(index)];
    if (!page) throw new Error(`No tab at index ${index}. Run list.`);
    if (url && page.url() !== url) throw new Error(`Tab ${index} is ${page.url()}, not ${url}.`);
    return page;
  }
  if (!url) throw new Error('Specify --url EXACT_URL or --index N (see list).');
  const matches = pages.filter(p => p.url() === url);
  if (matches.length !== 1) throw new Error(`Expected exactly one tab for URL, found ${matches.length}. Use --index N or close duplicate tabs.`);
  return matches[0];
}

// Reuse a blank tab; otherwise open a separate window so the tab the user is working in stays untouched.
export async function openTab({ cdp, url }) {
  return withBrowser(cdp, async browser => {
    const context = browser.contexts()[0];
    if (!context) throw new Error('Browser has no default context.');
    let page = tabsOf(browser).find(p => p.url() === 'about:blank');
    if (!page) {
      const created = context.waitForEvent('page', { timeout: 10000 });
      const session = await browser.newBrowserCDPSession();
      try { await session.send('Target.createTarget', { url: 'about:blank', newWindow: true }); }
      finally { await session.detach().catch(() => {}); }
      page = await created;
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return { index: tabsOf(browser).indexOf(page), url: page.url(), title: await page.title() };
  });
}

function parseViewport(value) {
  const m = /^(\d+)x(\d+)$/.exec(value || '');
  if (!m) throw new Error('--viewport must be WIDTHxHEIGHT, e.g. 1440x900');
  return { width: Number(m[1]), height: Number(m[2]) };
}

// Emulation overrides vanish when this CLI disconnects, so resize the real window instead.
// The window keeps the size for later commands and for the user, and inner size is corrected for browser chrome.
export async function resizeWindow(page, { width, height }) {
  if (width < 320 || height < 240) throw new Error('Viewport must be at least 320x240.');
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    // A background tab keeps reporting a stale innerWidth/innerHeight, which would drive the correction wrong.
    await page.bringToFront();
    if (await page.evaluate(() => document.visibilityState) !== 'visible')
      throw new Error('Target tab is not visible (minimized or hidden window). Restore the window and retry.');
    const apply = async bounds => {
      bounds = { width: Math.max(400, bounds.width), height: Math.max(300, bounds.height) };
      await session.send('Browser.setWindowBounds', { windowId, bounds });
      await page.waitForTimeout(250);
      return page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    };
    let target = { width, height };
    let inner = await apply(target);
    const first = inner;
    target = { width: target.width + width - inner.width, height: target.height + height - inner.height };
    inner = await apply(target);
    if (Math.abs(inner.width - width) > 20 && inner.width === first.width && first.width !== width)
      throw new Error('Window size did not change the viewport. The tab may be in a fixed-size or hidden window.');
    for (let i = 0; i < 2 && (inner.width !== width || inner.height !== height); i++) {
      target = { width: target.width + width - inner.width, height: target.height + height - inner.height };
      inner = await apply(target);
    }
    // With fractional device scale (e.g. 125%), some window sizes skip a CSS pixel; probe nearby sizes per axis.
    for (const axis of ['width', 'height']) {
      for (const delta of [-1, 1, -2, 2, -3, 3]) {
        if (inner[axis] === (axis === 'width' ? width : height)) break;
        const trial = { ...target, [axis]: target[axis] + delta };
        const got = await apply(trial);
        if (got[axis] === (axis === 'width' ? width : height)) { target = trial; inner = got; }
      }
    }
    if (inner.width === width && inner.height === height) return { ...inner, matched: true };
    inner = await apply(target);
    return { ...inner, matched: inner.width === width && inner.height === height,
      note: 'The screen may be too small or the window manager limited the size.' };
  } finally { await session.detach().catch(() => {}); }
}

const USAGE = `Usage:
  browser [--cdp ${DEFAULT_CDP}] [--url URL] [--profile DIR] [--chrome PATH] [--headless]
  open     [--cdp E] --url URL
  list     [--cdp E]
  snapshot [--cdp E] (--url TAB_URL | --index N) [--out FILE]
  shot     [--cdp E] (--url TAB_URL | --index N) --out NEW.png [--full]
  run      [--cdp E] (--url TAB_URL | --index N) --script FILE.mjs
  viewport [--cdp E] (--url TAB_URL | --index N) --size 1440x900
  close    [--cdp E] (--url TAB_URL | --index N)      (only tabs this skill opened)
  capture  [--cdp E] (--url TAB_URL | --index N) --out NEW_DIRECTORY [--ready CSS] [--label NAME]
  mockup   --input original.html --patch changes.json --out NEW_DIRECTORY`;

function args(tokens) {
  const result = {};
  while (tokens.length) {
    const key = tokens.shift();
    if (!key.startsWith('--')) throw new Error('Use --key value\n' + USAGE);
    result[key.slice(2)] = (!tokens.length || tokens[0].startsWith('--')) ? true : tokens.shift();
  }
  return result;
}
async function main() {
  const [command,...tokens]=process.argv.slice(2); const a=args(tokens);
  if(command==='mockup') {
    if(!a.input||!a.patch||!a.out) throw new Error('mockup --input original.html --patch changes.json --out NEW_DIRECTORY');
    return mockup(resolve(a.input),resolve(a.patch),resolve(a.out));
  }
  if(command==='browser') {
    const r=await startBrowser({cdp:a.cdp||DEFAULT_CDP,profile:a.profile?resolve(a.profile):undefined,chrome:a.chrome,headless:a.headless===true,url:a.url});
    console.log(json(r)); return;
  }
  if(!['open','list','snapshot','shot','run','viewport','close','capture'].includes(command)) throw new Error(USAGE);
  const cdp=a.cdp||DEFAULT_CDP;
  if(!await cdpVersion(cdp)) throw new Error(`No browser answers CDP at ${cdp}. Run: browser --cdp ${cdp}`);
  if(command==='open') { if(!a.url) throw new Error('open requires --url'); console.log(json(await openTab({cdp,url:a.url}))); return; }
  if(command==='list') return withBrowser(cdp, async b => { const pages=tabsOf(b); console.log(json(await Promise.all(pages.map(async (p,index)=>({index,url:p.url(),title:await p.title().catch(()=>'')}))))); });
  return withBrowser(cdp, async browser => {
    const page=pickTab(browser,a);
    if(command==='snapshot') {
      const tree=await page.locator('body').ariaSnapshot();
      const text=`url: ${page.url()}\ntitle: ${await page.title()}\nviewport: ${JSON.stringify(await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollX,scrollY})))}\n${tree}\n`;
      if(a.out) { await save(resolve(a.out),text); console.log('Snapshot saved: '+resolve(a.out)); } else console.log(text);
      return;
    }
    if(command==='shot') {
      if(!a.out) throw new Error('shot requires --out NEW.png');
      await save(resolve(a.out), await page.screenshot({fullPage:a.full===true}));
      console.log('Live screenshot saved: '+resolve(a.out)); return;
    }
    if(command==='close') { await page.close(); console.log('Tab closed.'); return; }
    if(command==='viewport') { console.log(json(await resizeWindow(page, parseViewport(a.size)))); return; }
    if(command==='run') {
      if(!a.script) throw new Error('run requires --script FILE.mjs exporting default async (page) => result');
      const mod=await import(pathToFileURL(resolve(a.script)).href+'?t='+Date.now());
      if(typeof mod.default!=='function') throw new Error('Script must export a default async function(page).');
      const result=await mod.default(page);
      console.log(json({url:page.url(),title:await page.title(),result:result??null})); return;
    }
    if(!a.out) throw new Error('capture requires --out NEW_DIRECTORY');
    await capturePage(page,resolve(a.out),{ready:a.ready,label:a.label});
    console.log('Capture saved. Inspect HTML/PNG and offline-check report.');
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
