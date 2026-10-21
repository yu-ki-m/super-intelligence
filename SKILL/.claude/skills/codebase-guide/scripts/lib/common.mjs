// 通常生成(generate-html-code.mjs)とガイド生成(prepare-guide.mjs / build-guide.mjs)で共有する処理。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

export const OUTPUT_DIR_NAME = '.codebase-guide-out';
// 旧バージョン(repository-html-browser)の出力先。残っていても差分や検索の対象にしない
export const LEGACY_OUTPUT_DIR_NAMES = ['html-code'];
export const EXCLUDE_OUTPUT_PATHSPECS = [OUTPUT_DIR_NAME, ...LEGACY_OUTPUT_DIR_NAMES].map(d => `:(exclude)${d}`);
export const TREE_PAGE_NAME = 'フォルダーツリー.html';
export const GUIDES_DIR_NAME = 'ガイド';
export const MANIFEST_NAME = '.codebase-guide.json';
// 出力の形式を変えたら上げる(古い形式の出力は、ガイド生成の前に通常生成からやり直す)
export const MANIFEST_VERSION = 3;
export const GUIDE_META_NAME = 'guide.meta.json';
export const GUIDE_COVER_NAME = '表紙.html';

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function hrefFrom(fromOutputFile, targetOutputFile) {
  const rel = toPosix(path.relative(path.dirname(fromOutputFile), targetOutputFile));
  return rel.split('/').map(encodeURIComponent).join('/');
}

export function outputFileFor(outputDir, rel) {
  return path.join(outputDir, ...toPosix(rel).split('/')) + '.html';
}

export function isLikelyBinary(buffer) {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.08;
}

// 改行をLFにそろえて行に分ける。末尾の改行の後ろも1行として数える(コードページの行番号と一致させる)。
export function splitLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function sanitizeName(value) {
  let out = String(value).normalize('NFC')
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=^~[\];,]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
    .replace(/[-.]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = `guide-${out}`;
  return out || 'guide';
}

export async function git(root, args, { encoding = 'utf8' } = {}) {
  const { stdout } = await execFileAsync('git', ['-C', root, '-c', 'core.quotepath=false', ...args], { maxBuffer: 256 * 1024 * 1024, encoding });
  return stdout;
}

// ソースの状態を表す署名。HEADと、未コミットの変更(パス・更新日時・サイズ)から作る。.codebase-guide-out 自身は含めない。
export async function sourceSignature(root) {
  try {
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ...EXCLUDE_OUTPUT_PATHSPECS]);
    const hash = crypto.createHash('sha1').update(head).update('\0').update(status);
    for (const entry of status.split('\0').filter(Boolean)) {
      const rel = entry.length > 3 ? entry.slice(3) : entry;
      try {
        const st = await fs.stat(path.join(root, rel));
        hash.update(`${rel}:${st.mtimeMs}:${st.size}\0`);
      } catch {
        hash.update(`${rel}:missing\0`);
      }
    }
    return { head, signature: hash.digest('hex') };
  } catch {
    return null;
  }
}

export function makeTree(files) {
  const tree = { dirs: new Map(), files: [] };
  for (const rel of files) {
    const parts = toPosix(rel).split('/');
    let node = tree;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir);
    }
    node.files.push({ name: parts.at(-1), rel: toPosix(rel) });
  }
  return tree;
}

export function sortTree(node) {
  node.files.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  node.dirs = new Map([...node.dirs.entries()].sort(([a],[b]) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'})));
  for (const child of node.dirs.values()) sortTree(child);
}

// hrefFor(rel) でリンク先を差し替え、decorate(rel) で {cls, after} を返すとファイル行に装飾を付ける(ガイドのページ用)。
export function renderTree(node, currentOutputFile, { outputDir, hrefFor = null, decorate = null }) {
  const parts = [];
  const recur = n => {
    for (const [name, child] of n.dirs) {
      parts.push(`<details open class="tree-dir"><summary><span class="codicon">▾</span><span>📁 ${escapeHtml(name)}</span></summary><div class="tree-children">`);
      recur(child);
      parts.push('</div></details>');
    }
    for (const f of n.files) {
      const href = (hrefFor && hrefFor(f.rel)) || hrefFrom(currentOutputFile, outputFileFor(outputDir, f.rel));
      const deco = decorate ? decorate(f.rel) : null;
      if (deco) parts.push(`<a class="tree-file tf-x${deco.cls ? ` ${deco.cls}` : ''}" href="${href}" title="${escapeHtml(f.rel)}">📄 <span class="tf-n">${escapeHtml(f.name)}</span>${deco.after || ''}</a>`);
      else parts.push(`<a class="tree-file" href="${href}" title="${escapeHtml(f.rel)}">📄 ${escapeHtml(f.name)}</a>`);
    }
  };
  recur(node);
  return parts.join('');
}

export function baseCss() {
  return `
:root{color-scheme:dark;--bg:#1e1e1e;--sidebar:#181818;--sidebar2:#252526;--border:#2b2b2b;--text:#d4d4d4;--muted:#9d9d9d;--active:#37373d;--link:#4daafc;--line:#858585;--tab:#1f1f1f;--syn-keyword:#569cd6;--syn-string:#ce9178;--syn-number:#b5cea8;--syn-comment:#6a9955;--syn-function:#dcdcaa;--syn-literal:#569cd6;--syn-tag:#569cd6;--syn-attr:#9cdcfe;--syn-title:#4ec9b0;--syn-link:#4fc1ff}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:Segoe UI,system-ui,-apple-system,sans-serif}a{color:inherit;text-decoration:none}.app{height:100vh;display:grid;grid-template-columns:320px minmax(0,1fr);grid-template-rows:35px 1fr 22px}.titlebar{grid-column:1/3;background:#181818;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 12px;font-size:12px;color:#c8c8c8}.sidebar{grid-column:1;grid-row:2;border-right:1px solid var(--border);background:var(--sidebar);overflow:auto}.sidebar-title{height:35px;display:flex;align-items:center;padding:0 14px;text-transform:uppercase;font-size:11px;letter-spacing:.08em;color:#bbb}.tree{padding:2px 6px 20px 8px;font-size:13px}.tree-dir summary{list-style:none;cursor:pointer;padding:3px 4px;white-space:nowrap}.tree-dir summary::-webkit-details-marker{display:none}.tree-children{padding-left:14px}.tree-file{display:block;padding:3px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-file:hover,.tree-dir summary:hover{background:#2a2d2e}.main{grid-column:2;grid-row:2;min-width:0;overflow:hidden;display:flex;flex-direction:column}.tabbar{height:35px;background:#181818;border-bottom:1px solid var(--border);display:flex;align-items:stretch}.tab{min-width:180px;max-width:45vw;background:var(--tab);display:flex;align-items:center;padding:0 12px;border-right:1px solid var(--border);font-size:13px}.crumbs{height:28px;display:flex;align-items:center;padding:0 14px;font-size:12px;color:#bbb;border-bottom:1px solid #232323;white-space:nowrap;overflow:auto}.editor{flex:1;overflow:auto;background:#1e1e1e}.code-table{border-collapse:collapse;width:max-content;min-width:100%;font:13px/1.55 Consolas,'Cascadia Code','SFMono-Regular',monospace;tab-size:4}.code-table td{vertical-align:top}.ln{position:sticky;left:0;z-index:1;width:1%;min-width:58px;padding:0 16px 0 8px;text-align:right;color:var(--line);user-select:none;background:#1e1e1e;border-right:1px solid #232323}.src{white-space:pre;padding:0 18px}.tok-keyword{color:var(--syn-keyword)}.tok-string{color:var(--syn-string)}.tok-number{color:var(--syn-number)}.tok-comment{color:var(--syn-comment);font-style:italic}.tok-function{color:var(--syn-function)}.tok-literal{color:var(--syn-literal)}.tok-tag{color:var(--syn-tag)}.tok-attr{color:var(--syn-attr)}.tok-title{color:var(--syn-title)}.tok-link{color:var(--syn-link)}.tok-regex{color:#d16969}.status{grid-column:1/3;grid-row:3;background:#007acc;color:white;font-size:11px;display:flex;align-items:center;gap:16px;padding:0 8px}.binary{padding:28px;font-family:Segoe UI,system-ui,sans-serif}.binary h2{font-size:18px;margin:0 0 10px}.binary p{color:#aaa}.tree-page{min-height:100vh;background:#1e1e1e;color:#ddd}.tree-page .header{position:sticky;top:0;background:#181818;border-bottom:1px solid #333;padding:12px 16px;z-index:2}.tree-page .content{padding:16px;max-width:1100px}.tree-page .tree{font-size:14px}.meta{color:#9d9d9d;font-size:12px;margin-left:auto}
.guides{margin:0 0 20px;padding:12px 16px;background:#252526;border:1px solid #3a3a3a;border-radius:4px}.guides h2{margin:0 0 6px;font-size:13px;letter-spacing:.06em;color:#bbb;font-weight:600}.guides ul{margin:0;padding-left:18px;line-height:1.9;font-size:14px}.guides a{color:var(--link)}.guides a:hover{text-decoration:underline}.guide-meta{color:var(--muted);font-size:12px;margin-left:10px}
.code-table a.xref{cursor:pointer}.code-table a.xref:hover{text-decoration:underline}.code-table tr[id]:target>td{background:#3a3524}.xmenu{position:fixed;z-index:30;min-width:220px;max-width:70vw;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.5);padding:4px 0;font:12px Consolas,'Cascadia Code',monospace}.xmenu a{display:block;padding:3px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xmenu a:hover{background:#04395e}.xmh{padding:2px 12px 4px;color:var(--muted);font:11px Segoe UI,system-ui,sans-serif}
@media(max-width:800px){.app{grid-template-columns:220px minmax(0,1fr)}.sidebar{font-size:12px}}
`;
}

// フォルダーツリー.html の「ガイド」一覧。各ガイドの guide.meta.json(build-guide.mjs が書く)から作る。
export async function readGuideMetas(outputDir) {
  const dir = path.join(outputDir, GUIDES_DIR_NAME);
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const metas = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dir, e.name, GUIDE_META_NAME), 'utf8'));
      metas.push({ ...meta, dirName: e.name });
    } catch {
      // まだビルドしていないガイドは一覧に出さない
    }
  }
  return metas.sort((a, b) => String(b.builtAt).localeCompare(String(a.builtAt)));
}

export function renderGuideSection(metas) {
  if (!metas.length) return '<!--guides:start--><!--guides:end-->';
  const items = metas.map(m => {
    const href = [GUIDES_DIR_NAME, m.dirName, GUIDE_COVER_NAME].map(encodeURIComponent).join('/');
    const counts = (m.findingCounts || []).filter(c => c.count).map(c => `${escapeHtml(c.short)} ${c.count}`).join('・');
    const meta = [m.builtAtLabel, m.diffLabel ? `差分 ${m.diffLabel}` : '', `${m.stepCount} ステップ`, counts ? `指摘 ${counts}` : ''].filter(Boolean).map(escapeHtml).join(' · ');
    return `<li><a href="${href}">${escapeHtml(m.title)}</a><span class="guide-meta">${meta}</span></li>`;
  }).join('');
  return `<!--guides:start--><section class="guides"><h2>ガイド</h2><ul>${items}</ul></section><!--guides:end-->`;
}

export async function refreshTreePageGuides(outputDir) {
  const file = path.join(outputDir, TREE_PAGE_NAME);
  let html;
  try { html = await fs.readFile(file, 'utf8'); } catch { return false; }
  const section = renderGuideSection(await readGuideMetas(outputDir));
  const re = /<!--guides:start-->[\s\S]*?<!--guides:end-->/;
  if (re.test(html)) html = html.replace(re, () => section);
  else html = html.replace('<nav class="tree">', () => `${section}<nav class="tree">`);
  await fs.writeFile(file, html);
  return true;
}

export async function mapLimit(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}
