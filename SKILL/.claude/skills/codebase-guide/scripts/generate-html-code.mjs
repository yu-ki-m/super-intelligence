#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  escapeHtml, toPosix, hrefFrom, outputFileFor, isLikelyBinary, baseCss, makeTree, sortTree, renderTree, mapLimit,
  execFileAsync, sourceSignature, readGuideMetas, renderGuideSection,
  OUTPUT_DIR_NAME, TREE_PAGE_NAME, GUIDES_DIR_NAME, MANIFEST_NAME, MANIFEST_VERSION,
} from './lib/common.mjs';
import { highlightCode, languageFor } from './lib/highlight.mjs';
import { Worker } from 'node:worker_threads';
import { writeXref, xrefLinks, normalizeSource, isXrefFile, XREF_MENU_SCRIPT } from './lib/xref.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const root = path.resolve(opt('--root', process.cwd()));
const outputDir = path.join(root, OUTPUT_DIR_NAME);
const concurrency = Math.max(1, Number(opt('--concurrency', Math.min(32, Math.max(4, os.cpus().length * 2)))) || 16);

const valuesOf = name => args.flatMap((arg, i) => arg === name && i + 1 < args.length ? [args[i + 1]] : []);
const includeIgnored = args.includes('--include-ignored');
const includedDirs = new Set(valuesOf('--include-dir'));
const includedFiles = new Set(valuesOf('--include-file'));
const xrefEnabled = !args.includes('--no-xref');
const typescriptPath = opt('--typescript', null);
const javaPath = opt('--java', null);

// These can never be traversed. .codebase-guide-out is the output itself and .git contains VCS internals.
const HARD_EXCLUDED_DIRS = new Set(['.git', OUTPUT_DIR_NAME]);

// Common dependency, build, cache, test-output and local-state directories that should not become code pages.
const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules', 'vendor', '.venv', 'venv', 'env', '__pypackages__',
  '.svn', '.hg',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  '.next', '.nuxt', '.output', '.svelte-kit', '.astro',
  'coverage', 'htmlcov', 'site', 'storybook-static', '.docusaurus',
  '.cache', '.parcel-cache', '.turbo', '.nx', '.vite', '.pytest_cache', '.mypy_cache', '.ruff_cache', '__pycache__', '.gradle', '.m2',
  '.npm', '.pnpm-store',
  'tmp', 'temp', '.tmp', '.temp', 'logs', 'test-results', 'playwright-report', 'allure-results', 'allure-report',
  '.terraform', '.serverless', '.aws-sam', 'cdk.out',
  '.vs', '.vscode', '.idea', '.cursor', '.continue', '.codex',
  'generated', 'gen',
  // 旧バージョン(repository-html-browser)の出力先
  'html-code',
]);

// Files that are normally generated, binary assets, archives, compiled artifacts, caches, or lock snapshots.
const DEFAULT_EXCLUDED_FILE_NAMES = new Set([
  '.DS_Store', 'Thumbs.db', '.eslintcache', '.stylelintcache',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'terraform.tfstate',
]);
const DEFAULT_EXCLUDED_EXTENSIONS = new Set([
  '.map', '.class', '.jar', '.war', '.ear', '.dll', '.exe', '.so', '.dylib', '.o', '.a', '.pyc', '.pyo', '.wasm',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.mp3', '.mp4', '.mov', '.avi',
  '.woff', '.woff2', '.ttf', '.eot',
]);

function pathSegments(rel) {
  return toPosix(rel).split('/').filter(Boolean);
}

function isExcludedDirName(name) {
  if (HARD_EXCLUDED_DIRS.has(name)) return true;
  return DEFAULT_EXCLUDED_DIRS.has(name) && !includedDirs.has(name);
}

function isExcludedFile(rel) {
  const posix = toPosix(rel);
  const parts = pathSegments(posix);
  const defaultExcludedPathPrefixes = ['.yarn/cache/', '.yarn/unplugged/', '.claude/cache/', 'docs/generated/'];
  if (defaultExcludedPathPrefixes.some(prefix => posix.startsWith(prefix))) {
    const excludedSegment = posix.startsWith('docs/generated/') ? 'generated' : posix.split('/')[1];
    if (!includedDirs.has(excludedSegment)) return true;
  }
  if (parts.slice(0, -1).some(isExcludedDirName)) return true;
  const base = parts.at(-1) || '';
  if (includedFiles.has(base) || includedFiles.has(posix)) return false;
  if (DEFAULT_EXCLUDED_FILE_NAMES.has(base)) return true;
  if (/\.min\.(?:js|css)$/i.test(base)) return true;
  if (/^terraform\.tfstate\./.test(base)) return true;
  return DEFAULT_EXCLUDED_EXTENSIONS.has(path.extname(base).toLowerCase());
}

async function listGitFiles() {
  try {
    await execFileAsync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { maxBuffer: 4 * 1024 * 1024 });
    const gitArgs = ['-C', root, 'ls-files', '-co'];
    if (!includeIgnored) gitArgs.push('--exclude-standard');
    gitArgs.push('-z');
    const { stdout } = await execFileAsync('git', gitArgs, { maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' });
    return stdout.toString('utf8').split('\0').filter(Boolean).filter(rel => !isExcludedFile(rel));
  } catch {
    return null;
  }
}

async function walkFilesystem() {
  const out = [];
  async function walk(abs, relBase = '') {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    await Promise.all(entries.map(async entry => {
      const absPath = path.join(abs, entry.name);
      const rel = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        if (isExcludedDirName(entry.name)) return;
        await walk(absPath, rel);
      } else if (!isExcludedFile(rel)) {
        out.push(rel);
      }
    }));
  }
  await walk(root);
  return out;
}

// 定義の解析を別スレッドで始める。メモリ不足などで止まっても、リンクを付けないだけで生成は続ける。
function startXref(files) {
  console.log('Definition links: TypeScript / Java のコンパイラーで定義の場所を求める(別スレッド)');
  return new Promise(resolve => {
    let settled = false;
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    const worker = new Worker(new URL('./lib/xref-worker.mjs', import.meta.url), {
      workerData: { root, files, typescript: typescriptPath, java: javaPath },
      resourceLimits: { maxOldGenerationSizeMb: 8192 },
    });
    worker.on('message', m => {
      if (m.log) console.log(m.log);
      if (m.result) finish(m.result);
    });
    worker.on('error', err => finish({ status: 'skip', reason: `定義の解析が失敗した: ${err?.message || err}` }));
    worker.on('exit', code => finish({ status: 'skip', reason: `定義の解析が途中で終了した(終了コード ${code})` }));
  });
}

// 定義リンク: 同じファイル内はそのページの行へ、別のファイルは別タブでそのファイルのページの行へ移動する
function definitionLinks(xref, rel, normalized, outFile) {
  if (!xref) return null;
  return xrefLinks(xref, rel, normalized, (target, line) => (target === rel
    ? { href: `#L${line}`, label: `${target}:${line}`, blank: false }
    : { href: `${hrefFrom(outFile, outputFileFor(outputDir, target))}#L${line}`, label: `${target}:${line}`, blank: true }));
}

function renderTextPage(rel, text, treeHtml, outFile, xref) {
  const normalized = normalizeSource(text);
  const lines = normalized.split('\n');
  const links = definitionLinks(xref, rel, normalized, outFile);
  const highlightedLines = highlightCode(normalized, rel, links).split('\n');
  const used = links ? [...links.values()].filter(l => l.used) : [];
  const rows = lines.map((line, i) => `<tr id="L${i + 1}"><td class="ln">${i + 1}</td><td class="src">${highlightedLines[i] ?? escapeHtml(line)}</td></tr>`).join('');
  const menu = used.some(l => l.open.includes('data-xm=')) ? `<script>${XREF_MENU_SCRIPT}</script>` : '';
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(rel)}</title><style>${baseCss()}</style></head><body><div class="app"><div class="titlebar">${escapeHtml(path.basename(root))} — Codebase Guide</div><aside class="sidebar"><div class="sidebar-title">Explorer</div><nav class="tree">${treeHtml}</nav></aside><main class="main"><div class="tabbar"><div class="tab">${escapeHtml(path.basename(rel))}</div></div><div class="crumbs">${escapeHtml(toPosix(rel).split('/').join('  ›  '))}<span class="meta">${escapeHtml(languageFor(rel))} · ${lines.length} lines${used.length ? ` · 定義リンク ${used.length}` : ''}</span></div><div class="editor"><table class="code-table"><tbody>${rows}</tbody></table></div></main><footer class="status"><span>Codebase Guide</span><span>${escapeHtml(languageFor(rel))}</span><span>UTF-8</span></footer></div>${menu}</body></html>`;
  return { html, links: used.length, linkable: links ? links.size : 0 };
}

function renderBinaryPage(rel, treeHtml, info) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(rel)}</title><style>${baseCss()}</style></head><body><div class="app"><div class="titlebar">${escapeHtml(path.basename(root))} — Codebase Guide</div><aside class="sidebar"><div class="sidebar-title">Explorer</div><nav class="tree">${treeHtml}</nav></aside><main class="main"><div class="tabbar"><div class="tab">${escapeHtml(path.basename(rel))}</div></div><div class="crumbs">${escapeHtml(toPosix(rel).split('/').join('  ›  '))}</div><div class="editor binary"><h2>${escapeHtml(path.basename(rel))}</h2><p>${escapeHtml(info)}</p></div></main><footer class="status"><span>Codebase Guide</span><span>Binary / special file</span></footer></div></body></html>`;
}

function renderIndexPage(treeHtml, count, guideSection) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>フォルダーツリー</title><style>${baseCss()}</style></head><body class="tree-page"><div class="header"><strong>${escapeHtml(path.basename(root))}</strong> <span class="meta">${count} files</span></div><main class="content"><h1>フォルダーツリー</h1><p>ファイル名を選択すると、VS Code風のコードページを開く。</p>${guideSection}<nav class="tree">${treeHtml}</nav></main></body></html>`;
}

async function main() {
  const started = Date.now();
  const source = await sourceSignature(root);
  let files = await listGitFiles();
  const listing = files ? 'git ls-files' : 'filesystem walk';
  if (!files) files = await walkFilesystem();
  files = [...new Set(files.map(toPosix))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));

  // ガイドの保存先(.codebase-guide-out/ガイド/)と、リポジトリ直下の「ガイド」フォルダーのページが同じ場所になるのを防ぐ
  const clash = files.find(rel => rel.split('/')[0] === GUIDES_DIR_NAME);
  if (clash) {
    console.error(`リポジトリ直下に「${GUIDES_DIR_NAME}」があり、.codebase-guide-out/${GUIDES_DIR_NAME}/(ガイドの保存先)と衝突する: ${clash}`);
    process.exit(1);
  }

  // 定義リンク(TypeScript / JavaScript)は別スレッドで求め、その間にリンクの要らないページを先に書き出す。
  // typescript の無いリポジトリや、解析が失敗したときは、リンクを付けずに進める。
  const xrefPending = xrefEnabled ? startXref(files) : Promise.resolve({ status: 'off', reason: '--no-xref の指定' });

  const tree = makeTree(files);
  sortTree(tree);

  // 生成済みのガイド(.codebase-guide-out/ガイド/)は残し、それ以外を作り直す
  await fs.mkdir(outputDir, { recursive: true });
  for (const entry of await fs.readdir(outputDir)) {
    if (entry !== GUIDES_DIR_NAME) await fs.rm(path.join(outputDir, entry), { recursive: true, force: true });
  }

  // Explorerのリンクは出力先のフォルダーごとに同じになるので、フォルダー単位で使い回す
  const treeCache = new Map();
  const treeFor = outFile => {
    const dir = path.dirname(outFile);
    if (!treeCache.has(dir)) treeCache.set(dir, renderTree(tree, outFile, { outputDir }));
    return treeCache.get(dir);
  };

  let textCount = 0;
  let binaryCount = 0;
  let symlinkCount = 0;
  let linkCount = 0;
  let linkableCount = 0;
  const errors = [];

  const renderFile = xrefIndex => async relPosix => {
    const rel = relPosix.split('/').join(path.sep);
    const abs = path.join(root, rel);
    const out = outputFileFor(outputDir, rel);
    try {
      await fs.mkdir(path.dirname(out), { recursive: true });
      const stat = await fs.lstat(abs);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(abs);
        await fs.writeFile(out, renderBinaryPage(relPosix, treeFor(out), `シンボリックリンク。リンク先: ${target}`));
        symlinkCount++;
        return;
      }
      if (!stat.isFile()) {
        await fs.writeFile(out, renderBinaryPage(relPosix, treeFor(out), '通常ファイルではないため、本文表示対象外。'));
        binaryCount++;
        return;
      }
      const buffer = await fs.readFile(abs);
      if (isLikelyBinary(buffer)) {
        await fs.writeFile(out, renderBinaryPage(relPosix, treeFor(out), `バイナリファイルのため本文表示対象外。サイズ: ${buffer.length.toLocaleString()} bytes`));
        binaryCount++;
      } else {
        const page = renderTextPage(relPosix, buffer.toString('utf8'), treeFor(out), out, xrefIndex);
        await fs.writeFile(out, page.html);
        linkCount += page.links;
        linkableCount += page.linkable;
        textCount++;
      }
    } catch (err) {
      errors.push({ rel: relPosix, error: err?.message || String(err) });
    }
  };

  await mapLimit(files.filter(f => !isXrefFile(f)), concurrency, renderFile(null));
  const xref = await xrefPending;
  const xrefIndex = xref.status === 'ok' ? xref : null;
  await mapLimit(files.filter(isXrefFile), concurrency, renderFile(xrefIndex));

  // ガイドのページにも同じ定義リンクを付けるため、求めた結果を残す
  if (xrefIndex) await writeXref(outputDir, xrefIndex);

  const indexFile = path.join(outputDir, TREE_PAGE_NAME);
  await fs.writeFile(indexFile, renderIndexPage(treeFor(indexFile), files.length, renderGuideSection(await readGuideMetas(outputDir))));

  // ガイド生成(prepare-guide.mjs / build-guide.mjs)が、同じ一覧と同じ除外設定を使うための記録
  await fs.writeFile(path.join(outputDir, MANIFEST_NAME), JSON.stringify({
    tool: 'codebase-guide',
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    listing,
    source,
    options: { includeIgnored, includeDirs: [...includedDirs], includeFiles: [...includedFiles], xref: xrefEnabled, typescript: typescriptPath, java: javaPath },
    xref: xrefIndex
      ? { status: 'ok', engine: xrefIndex.engine, files: xrefIndex.stats.files, links: linkCount }
      : { status: xref.status, reason: xref.reason },
    files,
  }));

  const generated = [];
  async function countHtml(abs, top) {
    for (const e of await fs.readdir(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (!(top && e.name === GUIDES_DIR_NAME)) await countHtml(p, false);
      } else if (e.name.endsWith('.html') && !(top && e.name === TREE_PAGE_NAME)) generated.push(p);
    }
  }
  await countHtml(outputDir, true);

  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(`Repository root : ${root}`);
  console.log(`Listing method  : ${listing}`);
  console.log(`Input files     : ${files.length}`);
  console.log(`Generated pages : ${generated.length}`);
  console.log(`Text pages      : ${textCount}`);
  console.log(`Binary pages    : ${binaryCount}`);
  console.log(`Symlink pages   : ${symlinkCount}`);
  console.log(`Concurrency     : ${concurrency}`);
  console.log(`Git ignored     : ${includeIgnored ? 'included when not otherwise excluded' : 'excluded'}`);
  if (includedDirs.size) console.log(`Included dirs   : ${[...includedDirs].join(', ')}`);
  if (includedFiles.size) console.log(`Included files  : ${[...includedFiles].join(', ')}`);
  if (xrefIndex) {
    const dropped = linkableCount - linkCount;
    console.log(`Definition links: ${linkCount} links in ${xrefIndex.stats.files} files (${xrefIndex.engine}, ${xrefIndex.stats.seconds.toFixed(1)}s)${dropped ? `、ハイライトの字句と位置が合わず付けなかったもの ${dropped}` : ''}`);
    if (xrefIndex.stats.minified) console.log(`  圧縮されたコードのため対象外: ${xrefIndex.stats.minified} files (1行が3000文字を超える、または2MBを超える)`);
    for (const n of xrefIndex.notes) console.log(`  注意: ${n}`);
  } else {
    console.log(`Definition links: なし。${xref.reason}`);
  }
  console.log(`Elapsed         : ${elapsed}s`);
  console.log(`Index           : ${indexFile}`);

  if (errors.length || generated.length !== files.length) {
    if (errors.length) {
      console.error('\nErrors:');
      for (const e of errors.slice(0, 50)) console.error(`- ${e.rel}: ${e.error}`);
      if (errors.length > 50) console.error(`...and ${errors.length - 50} more`);
    }
    if (generated.length !== files.length) console.error(`Count mismatch: input=${files.length}, generated=${generated.length}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
