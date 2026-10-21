#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const root = path.resolve(opt('--root', process.cwd()));
const outputDir = path.join(root, 'html-code');
const concurrency = Math.max(1, Number(opt('--concurrency', Math.min(32, Math.max(4, os.cpus().length * 2)))) || 16);

const valuesOf = name => args.flatMap((arg, i) => arg === name && i + 1 < args.length ? [args[i + 1]] : []);
const includeIgnored = args.includes('--include-ignored');
const includedDirs = new Set(valuesOf('--include-dir'));
const includedFiles = new Set(valuesOf('--include-file'));

// These can never be traversed. html-code is the output itself and .git contains VCS internals.
const HARD_EXCLUDED_DIRS = new Set(['.git', 'html-code']);

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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function hrefFrom(fromOutputFile, targetOutputFile) {
  const rel = toPosix(path.relative(path.dirname(fromOutputFile), targetOutputFile));
  return rel.split('/').map(encodeURIComponent).join('/');
}

function isLikelyBinary(buffer) {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) suspicious++;
  }
  return suspicious / sample.length > 0.08;
}


const HIGHLIGHT_KEYWORDS = {
  javascript: new Set('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined'.split(' ')),
  python: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case'.split(' ')),
  java: new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record sealed permits var'.split(' ')),
  c: new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool true false null'.split(' ')),
  go: new Set('break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var true false nil'.split(' ')),
  rust: new Set('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' ')),
  sql: new Set('select from where join inner left right full outer on group by order having limit offset insert into values update set delete create alter drop table view index distinct union all as and or not null is in exists between like case when then else end asc desc primary key foreign references constraint default true false'.split(' ')),
  shell: new Set('if then else elif fi for while until do done case esac function in select time coproc export local readonly declare typeset unset shift return break continue true false'.split(' ')),
  css: new Set('@media @supports @import @font-face @keyframes @layer @container inherit initial unset revert important'.split(' ')),
};

function highlightFamily(file) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file).toLowerCase();
  if (['.ts','.tsx','.js','.jsx','.mjs','.cjs','.vue','.svelte'].includes(ext)) return 'javascript';
  if (ext === '.py') return 'python';
  if (['.java','.kt','.kts','.gradle'].includes(ext)) return 'java';
  if (['.c','.h','.cpp','.cc','.cxx','.hpp','.hh','.cs'].includes(ext)) return 'c';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (ext === '.sql') return 'sql';
  if (['.sh','.bash','.zsh','.ps1','.bat','.cmd'].includes(ext) || base === 'dockerfile') return 'shell';
  if (['.css','.scss','.sass','.less'].includes(ext)) return 'css';
  if (['.html','.htm','.xml','.svg'].includes(ext)) return 'markup';
  if (ext === '.json') return 'json';
  if (['.yaml','.yml','.toml','.ini','.properties'].includes(ext)) return 'config';
  if (ext === '.md') return 'markdown';
  if (['.graphql','.gql'].includes(ext)) return 'graphql';
  return 'plain';
}

function keywordSetFor(family) {
  if (family === 'graphql') return new Set('query mutation subscription fragment on schema type interface union enum input scalar directive extend implements true false null'.split(' '));
  return HIGHLIGHT_KEYWORDS[family] || new Set();
}

function highlightCode(text, file) {
  const family = highlightFamily(file);
  if (family === 'plain') return escapeHtml(text);
  if (family === 'markup') return highlightMarkup(text);
  if (family === 'markdown') return highlightMarkdown(text);
  if (family === 'config') return highlightConfig(text);
  return highlightCStyle(text, family);
}

function span(cls, value) {
  return escapeHtml(value).split('\n').map(part => `<span class="tok-${cls}">${part}</span>`).join('\n');
}

function highlightMarkup(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const j = end < 0 ? text.length : end + 3;
      out += span('comment', text.slice(i, j)); i = j; continue;
    }
    if (text[i] === '<') {
      const end = text.indexOf('>', i + 1);
      const j = end < 0 ? text.length : end + 1;
      const raw = text.slice(i, j);
      const escaped = escapeHtml(raw)
        .replace(/(&lt;\/?)([A-Za-z][\w:-]*)/, '$1<span class="tok-tag">$2</span>')
        .replace(/\s([A-Za-z_:][-\w:.]*)(=)/g, ' <span class="tok-attr">$1</span>$2')
        .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tok-string">$1</span>');
      out += escaped; i = j; continue;
    }
    const next = text.indexOf('<', i);
    const j = next < 0 ? text.length : next;
    out += escapeHtml(text.slice(i, j)); i = j;
  }
  return out;
}

function highlightMarkdown(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let fenced = false;
  return lines.map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return span('keyword', line); }
    if (fenced) return escapeHtml(line);
    let e = escapeHtml(line);
    e = e.replace(/^(\s{0,3}#{1,6}\s+)(.*)$/,'<span class="tok-keyword">$1</span><span class="tok-title">$2</span>');
    e = e.replace(/(`[^`]+`)/g,'<span class="tok-string">$1</span>');
    e = e.replace(/(\*\*[^*]+\*\*|__[^_]+__)/g,'<span class="tok-title">$1</span>');
    e = e.replace(/(\[[^\]]+\]\([^\)]+\))/g,'<span class="tok-link">$1</span>');
    return e;
  }).join('\n');
}

function highlightConfig(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(line => {
    const m = line.match(/^(\s*)(#|;)(.*)$/);
    if (m) return escapeHtml(m[1]) + span('comment', m[2] + m[3]);
    const kv = line.match(/^(\s*)([^:=\s][^:=]*?)(\s*[:=]\s*)(.*)$/);
    if (kv) return escapeHtml(kv[1]) + span('attr', kv[2]) + escapeHtml(kv[3]) + highlightCStyle(kv[4], 'json');
    return highlightCStyle(line, 'json');
  }).join('\n');
}

function highlightCStyle(text, family) {
  const keywords = keywordSetFor(family);
  let out = '';
  let i = 0;
  let blockComment = false;
  const hashComments = ['python','shell','graphql'].includes(family);
  const slashComments = !['python','shell','graphql','sql','css','json'].includes(family);
  while (i < text.length) {
    if (blockComment) {
      const end = text.indexOf('*/', i);
      const j = end < 0 ? text.length : end + 2;
      out += span('comment', text.slice(i, j)); i = j; blockComment = end < 0; continue;
    }
    if (text.startsWith('/*', i) && !['python','shell','graphql','json'].includes(family)) {
      const end = text.indexOf('*/', i + 2);
      const j = end < 0 ? text.length : end + 2;
      out += span('comment', text.slice(i, j)); i = j; blockComment = end < 0; continue;
    }
    if ((slashComments && text.startsWith('//', i)) || (family === 'sql' && text.startsWith('--', i)) || (hashComments && text[i] === '#')) {
      const end = text.indexOf('\n', i);
      const j = end < 0 ? text.length : end;
      out += span('comment', text.slice(i, j)); i = j; continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch; let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === quote) { j++; break; }
        j++;
      }
      out += span('string', text.slice(i, j)); i = j; continue;
    }
    const num = text.slice(i).match(/^(?:0x[0-9a-fA-F]+|0b[01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (num) { out += span('number', num[0]); i += num[0].length; continue; }
    const word = text.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const w = word[0];
      if (keywords.has(family === 'sql' ? w.toLowerCase() : w)) out += span('keyword', w);
      else if (/^(true|false|null|undefined|nil|None|True|False)$/i.test(w)) out += span('literal', w);
      else {
        const tail = text.slice(i + w.length);
        out += /^\s*\(/.test(tail) ? span('function', w) : escapeHtml(w);
      }
      i += w.length; continue;
    }
    out += escapeHtml(ch); i++;
  }
  return out;
}

function languageFor(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.ts':'TypeScript','.tsx':'TSX','.js':'JavaScript','.jsx':'JSX','.mjs':'JavaScript','.cjs':'JavaScript',
    '.java':'Java','.kt':'Kotlin','.kts':'Kotlin','.py':'Python','.rb':'Ruby','.go':'Go','.rs':'Rust',
    '.c':'C','.h':'C Header','.cpp':'C++','.cc':'C++','.hpp':'C++ Header','.cs':'C#','.php':'PHP',
    '.html':'HTML','.htm':'HTML','.css':'CSS','.scss':'SCSS','.sass':'Sass','.less':'Less',
    '.json':'JSON','.yaml':'YAML','.yml':'YAML','.xml':'XML','.toml':'TOML','.ini':'INI','.properties':'Properties',
    '.md':'Markdown','.sql':'SQL','.sh':'Shell','.bash':'Shell','.zsh':'Shell','.ps1':'PowerShell','.bat':'Batch','.cmd':'Batch',
    '.gradle':'Gradle','.graphql':'GraphQL','.gql':'GraphQL','.vue':'Vue','.svelte':'Svelte'
  };
  return map[ext] || (path.basename(file).toLowerCase() === 'dockerfile' ? 'Dockerfile' : 'Plain Text');
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

function makeTree(files) {
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

function sortTree(node) {
  node.files.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  node.dirs = new Map([...node.dirs.entries()].sort(([a],[b]) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'})));
  for (const child of node.dirs.values()) sortTree(child);
}

function outputFileFor(rel) {
  return path.join(outputDir, ...toPosix(rel).split('/')) + '.html';
}

function renderTree(node, currentOutputFile, compact = false) {
  const parts = [];
  const recur = (n, depth) => {
    for (const [name, child] of n.dirs) {
      parts.push(`<details open class="tree-dir"><summary><span class="codicon">▾</span><span>📁 ${escapeHtml(name)}</span></summary><div class="tree-children">`);
      recur(child, depth + 1);
      parts.push('</div></details>');
    }
    for (const f of n.files) {
      const href = hrefFrom(currentOutputFile, outputFileFor(f.rel));
      parts.push(`<a class="tree-file" href="${href}" title="${escapeHtml(f.rel)}">📄 ${escapeHtml(f.name)}</a>`);
    }
  };
  recur(node, 0);
  return parts.join('');
}

function baseCss() {
  return `
:root{color-scheme:dark;--bg:#1e1e1e;--sidebar:#181818;--sidebar2:#252526;--border:#2b2b2b;--text:#d4d4d4;--muted:#9d9d9d;--active:#37373d;--link:#4daafc;--line:#858585;--tab:#1f1f1f;--syn-keyword:#569cd6;--syn-string:#ce9178;--syn-number:#b5cea8;--syn-comment:#6a9955;--syn-function:#dcdcaa;--syn-literal:#569cd6;--syn-tag:#569cd6;--syn-attr:#9cdcfe;--syn-title:#4ec9b0;--syn-link:#4fc1ff}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:Segoe UI,system-ui,-apple-system,sans-serif}a{color:inherit;text-decoration:none}.app{height:100vh;display:grid;grid-template-columns:320px minmax(0,1fr);grid-template-rows:35px 1fr 22px}.titlebar{grid-column:1/3;background:#181818;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 12px;font-size:12px;color:#c8c8c8}.sidebar{grid-column:1;grid-row:2;border-right:1px solid var(--border);background:var(--sidebar);overflow:auto}.sidebar-title{height:35px;display:flex;align-items:center;padding:0 14px;text-transform:uppercase;font-size:11px;letter-spacing:.08em;color:#bbb}.tree{padding:2px 6px 20px 8px;font-size:13px}.tree-dir summary{list-style:none;cursor:pointer;padding:3px 4px;white-space:nowrap}.tree-dir summary::-webkit-details-marker{display:none}.tree-children{padding-left:14px}.tree-file{display:block;padding:3px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree-file:hover,.tree-dir summary:hover{background:#2a2d2e}.main{grid-column:2;grid-row:2;min-width:0;overflow:hidden;display:flex;flex-direction:column}.tabbar{height:35px;background:#181818;border-bottom:1px solid var(--border);display:flex;align-items:stretch}.tab{min-width:180px;max-width:45vw;background:var(--tab);display:flex;align-items:center;padding:0 12px;border-right:1px solid var(--border);font-size:13px}.crumbs{height:28px;display:flex;align-items:center;padding:0 14px;font-size:12px;color:#bbb;border-bottom:1px solid #232323;white-space:nowrap;overflow:auto}.editor{flex:1;overflow:auto;background:#1e1e1e}.code-table{border-collapse:collapse;width:max-content;min-width:100%;font:13px/1.55 Consolas,'Cascadia Code','SFMono-Regular',monospace;tab-size:4}.code-table td{vertical-align:top}.ln{position:sticky;left:0;z-index:1;width:1%;min-width:58px;padding:0 16px 0 8px;text-align:right;color:var(--line);user-select:none;background:#1e1e1e;border-right:1px solid #232323}.src{white-space:pre;padding:0 18px}.tok-keyword{color:var(--syn-keyword)}.tok-string{color:var(--syn-string)}.tok-number{color:var(--syn-number)}.tok-comment{color:var(--syn-comment);font-style:italic}.tok-function{color:var(--syn-function)}.tok-literal{color:var(--syn-literal)}.tok-tag{color:var(--syn-tag)}.tok-attr{color:var(--syn-attr)}.tok-title{color:var(--syn-title)}.tok-link{color:var(--syn-link)}.status{grid-column:1/3;grid-row:3;background:#007acc;color:white;font-size:11px;display:flex;align-items:center;gap:16px;padding:0 8px}.binary{padding:28px;font-family:Segoe UI,system-ui,sans-serif}.binary h2{font-size:18px;margin:0 0 10px}.binary p{color:#aaa}.tree-page{min-height:100vh;background:#1e1e1e;color:#ddd}.tree-page .header{position:sticky;top:0;background:#181818;border-bottom:1px solid #333;padding:12px 16px;z-index:2}.tree-page .content{padding:16px;max-width:1100px}.tree-page .tree{font-size:14px}.meta{color:#9d9d9d;font-size:12px;margin-left:auto}
@media(max-width:800px){.app{grid-template-columns:220px minmax(0,1fr)}.sidebar{font-size:12px}}
`;
}

function renderTextPage(rel, text, tree) {
  const outFile = outputFileFor(rel);
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const highlightedLines = highlightCode(normalized, rel).split('\n');
  const rows = lines.map((line, i) => `<tr><td class="ln">${i + 1}</td><td class="src">${highlightedLines[i] ?? escapeHtml(line)}</td></tr>`).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(rel)}</title><style>${baseCss()}</style></head><body><div class="app"><div class="titlebar">${escapeHtml(path.basename(root))} — Repository HTML Browser</div><aside class="sidebar"><div class="sidebar-title">Explorer</div><nav class="tree">${renderTree(tree, outFile, true)}</nav></aside><main class="main"><div class="tabbar"><div class="tab">${escapeHtml(path.basename(rel))}</div></div><div class="crumbs">${escapeHtml(toPosix(rel).split('/').join('  ›  '))}<span class="meta">${escapeHtml(languageFor(rel))} · ${lines.length} lines</span></div><div class="editor"><table class="code-table"><tbody>${rows}</tbody></table></div></main><footer class="status"><span>Repository HTML Browser</span><span>${escapeHtml(languageFor(rel))}</span><span>UTF-8</span></footer></div></body></html>`;
}

function renderBinaryPage(rel, tree, info) {
  const outFile = outputFileFor(rel);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(rel)}</title><style>${baseCss()}</style></head><body><div class="app"><div class="titlebar">${escapeHtml(path.basename(root))} — Repository HTML Browser</div><aside class="sidebar"><div class="sidebar-title">Explorer</div><nav class="tree">${renderTree(tree, outFile, true)}</nav></aside><main class="main"><div class="tabbar"><div class="tab">${escapeHtml(path.basename(rel))}</div></div><div class="crumbs">${escapeHtml(toPosix(rel).split('/').join('  ›  '))}</div><div class="editor binary"><h2>${escapeHtml(path.basename(rel))}</h2><p>${escapeHtml(info)}</p></div></main><footer class="status"><span>Repository HTML Browser</span><span>Binary / special file</span></footer></div></body></html>`;
}

function renderIndexPage(tree, count) {
  const outFile = path.join(outputDir, 'フォルダーツリー.html');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>フォルダーツリー</title><style>${baseCss()}</style></head><body class="tree-page"><div class="header"><strong>${escapeHtml(path.basename(root))}</strong> <span class="meta">${count} files</span></div><main class="content"><h1>フォルダーツリー</h1><p>ファイル名を選択すると、VS Code風のコードページを開く。</p><nav class="tree">${renderTree(tree, outFile)}</nav></main></body></html>`;
}

async function mapLimit(items, limit, worker) {
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

async function main() {
  const started = Date.now();
  let files = await listGitFiles();
  const source = files ? 'git ls-files' : 'filesystem walk';
  if (!files) files = await walkFilesystem();
  files = [...new Set(files.map(toPosix))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));

  const tree = makeTree(files);
  sortTree(tree);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  let textCount = 0;
  let binaryCount = 0;
  let symlinkCount = 0;
  const errors = [];

  await mapLimit(files, concurrency, async relPosix => {
    const rel = relPosix.split('/').join(path.sep);
    const abs = path.join(root, rel);
    const out = outputFileFor(rel);
    try {
      await fs.mkdir(path.dirname(out), { recursive: true });
      const stat = await fs.lstat(abs);
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(abs);
        await fs.writeFile(out, renderBinaryPage(relPosix, tree, `シンボリックリンク。リンク先: ${target}`));
        symlinkCount++;
        return;
      }
      if (!stat.isFile()) {
        await fs.writeFile(out, renderBinaryPage(relPosix, tree, '通常ファイルではないため、本文表示対象外。'));
        binaryCount++;
        return;
      }
      const buffer = await fs.readFile(abs);
      if (isLikelyBinary(buffer)) {
        await fs.writeFile(out, renderBinaryPage(relPosix, tree, `バイナリファイルのため本文表示対象外。サイズ: ${buffer.length.toLocaleString()} bytes`));
        binaryCount++;
      } else {
        await fs.writeFile(out, renderTextPage(relPosix, buffer.toString('utf8'), tree));
        textCount++;
      }
    } catch (err) {
      errors.push({ rel: relPosix, error: err?.message || String(err) });
    }
  });

  await fs.writeFile(path.join(outputDir, 'フォルダーツリー.html'), renderIndexPage(tree, files.length));

  const generated = [];
  async function countHtml(abs) {
    for (const e of await fs.readdir(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) await countHtml(p);
      else if (e.name.endsWith('.html') && e.name !== 'フォルダーツリー.html') generated.push(p);
    }
  }
  await countHtml(outputDir);

  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(`Repository root : ${root}`);
  console.log(`Listing method  : ${source}`);
  console.log(`Input files     : ${files.length}`);
  console.log(`Generated pages : ${generated.length}`);
  console.log(`Text pages      : ${textCount}`);
  console.log(`Binary pages    : ${binaryCount}`);
  console.log(`Symlink pages   : ${symlinkCount}`);
  console.log(`Concurrency     : ${concurrency}`);
  console.log(`Git ignored     : ${includeIgnored ? 'included when not otherwise excluded' : 'excluded'}`);
  if (includedDirs.size) console.log(`Included dirs   : ${[...includedDirs].join(', ')}`);
  if (includedFiles.size) console.log(`Included files  : ${[...includedFiles].join(', ')}`);
  console.log(`Elapsed         : ${elapsed}s`);
  console.log(`Index           : ${path.join(outputDir, 'フォルダーツリー.html')}`);

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
