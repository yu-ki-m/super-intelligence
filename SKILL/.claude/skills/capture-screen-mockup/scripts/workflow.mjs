import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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

export async function capturePage(page, out, { ready, label = '' } = {}) {
  if (ready) await page.locator(ready).waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
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
  await page.evaluate(bundle);
  let captured;
  try {
    captured = await page.evaluate(async () => {
      const data = await globalThis.__screenSingleFile.getPageData({
        removeScripts: true, removeHiddenElements: false, removeUnusedStyles: false,
        removeUnusedFonts: false, removeFrames: true, loadDeferredContent: false,
        compressHTML: false, compressCSS: false, blockScripts: true,
        saveOriginalURLs: false, insertSingleFileComment: false,
        saveFavicon: false, maxResourceSizeEnabled: true, maxResourceSize: 10,
        networkTimeout: 15000
      });
      return data.content;
    });
  } finally { await page.evaluate(({scrollX:x,scrollY:y}) => scrollTo(x,y), original); }
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

function args(tokens) {
  const result = {};
  while(tokens.length) {const key=tokens.shift();if(!key.startsWith('--') || !tokens.length) throw new Error('Use --key value'); result[key.slice(2)] = tokens.shift();}
  return result;
}
async function main() {
  const [command,...tokens]=process.argv.slice(2); const a=args(tokens);
  if(command==='mockup') {
    if(!a.input||!a.patch||!a.out) throw new Error('mockup --input original.html --patch changes.json --out NEW_DIRECTORY');
    return mockup(resolve(a.input),resolve(a.patch),resolve(a.out));
  }
  if(!['list','capture'].includes(command)||!a.cdp) throw new Error('list --cdp ENDPOINT | capture --cdp ENDPOINT --url EXACT_URL --out NEW_DIRECTORY [--ready CSS] [--label NAME]');
  if(command==='capture'&&(!a.url||!a.out)) throw new Error('capture requires --url and --out');
  const browser=await chromium.connectOverCDP(a.cdp);
  try {
    const pages=browser.contexts().flatMap(c=>c.pages());
    if(command==='list') {console.log(json(pages.map((p,index)=>({index,url:p.url()}))));return;}
    const matches=pages.filter(p=>p.url()===a.url);
    if(matches.length!==1) throw new Error(`Expected exactly one tab for URL, found ${matches.length}. Close duplicate tabs or choose another URL.`);
    await capturePage(matches[0],resolve(a.out),{ready:a.ready,label:a.label});
    console.log('Capture saved. Inspect HTML/PNG and offline-check report.');
  } finally { await browser.close(); } // For connectOverCDP this disconnects the client, not the shared browser.
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
