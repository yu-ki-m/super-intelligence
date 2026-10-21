// 定義リンク: TypeScript のコンパイラーに、識別子ごとの定義の場所(リポジトリ内のファイルと行)を問い合わせる。
// 名前の一致では推測しない。型から定義を決められたもので、定義がコードページのあるファイルにあるものだけを記録する。
// node_modules・標準ライブラリ・生成物など、自分たちが書いていない場所の定義はリンクしない。

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { escapeHtml, toPosix } from './common.mjs';

export const XREF_NAME = '.codebase-guide-xref.json';
const XREF_VERSION = 1;
const SCRIPT_EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const CONFIG_NAME = /^[tj]sconfig(?:\.[^/]*)?\.json$/i;
// 圧縮されたコード(同梱されたライブラリなど)は自分たちが書いたコードではなく、解析に時間もかかるので対象外にする
const MAX_SOURCE_CHARS = 2 * 1024 * 1024;
const MAX_LINE_CHARS = 3000;

function looksMinified(text) {
  if (text.length > MAX_SOURCE_CHARS) return true;
  for (let from = 0; from < text.length;) {
    const nl = text.indexOf('\n', from);
    const end = nl < 0 ? text.length : nl;
    if (end - from > MAX_LINE_CHARS) return true;
    from = end + 1;
  }
  return false;
}

// 定義リンクを付ける対象(TypeScript / JavaScript / Java)のファイルか
export const isXrefFile = rel => SCRIPT_EXT.test(rel) || /\.java$/i.test(rel);

/**
 * 言語ごとの結果(TypeScript の buildXref、Java の buildJavaXref)を1つにまとめる。
 * どれかが使えれば status: 'ok'。使えなかった言語の理由は notes に残す(対象のファイルが無い言語は何も残さない)。
 */
export function mergeXref(results) {
  const present = results.filter(r => r && !r.empty);
  const ok = present.filter(r => r.status === 'ok');
  const skipped = present.filter(r => r.status !== 'ok');
  if (!ok.length) {
    return { status: 'skip', reason: skipped.map(r => r.reason).join(' / ') || 'TypeScript / JavaScript / Java のファイルが無い' };
  }
  const files = {};
  const targets = [];
  const stats = { files: 0, refs: 0, targets: 0, minified: 0, seconds: 0 };
  const notes = [];
  for (const r of ok) {
    const offset = targets.length;
    targets.push(...r.targets);
    const shift = t => (Array.isArray(t) ? t.map(i => i + offset) : t + offset);
    for (const [rel, f] of Object.entries(r.files)) files[rel] = { hash: f.hash, refs: offset ? f.refs.map(([l, c, n, t]) => [l, c, n, shift(t)]) : f.refs };
    stats.files += r.stats.files;
    stats.refs += r.stats.refs;
    stats.minified += r.stats.minified || 0;
    // 言語ごとの解析は並行して動くので、時間は長い方
    stats.seconds = Math.max(stats.seconds, r.stats.seconds);
    notes.push(...(r.notes || []));
  }
  stats.targets = targets.length;
  for (const r of skipped) notes.push(r.reason);
  return { status: 'ok', engine: ok.map(r => r.engine).join(', '), files, targets, stats, notes };
}

// ページの本文と TypeScript が読んだ本文を、同じ形にそろえて比べる(BOM と改行コードの違いを無視する)
export function normalizeSource(text) {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function sourceHash(normalized) {
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

// 改行は \r\n・\r・\n だけを数える(ページの行分けと同じ規則)
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) { if (text.charCodeAt(i + 1) === 10) i++; starts.push(i + 1); }
    else if (c === 10) starts.push(i + 1);
  }
  return starts;
}

function lineIndexOf(starts, pos) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function npmGlobalRoot() {
  try {
    return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 15000, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// 対象リポジトリにインストール済みの typescript を使う(このスキルからは持ち込まない)
function loadTypeScript(dirs, explicit) {
  const tried = [];
  const attempts = [];
  if (explicit) attempts.push(() => createRequire(import.meta.url)(path.resolve(explicit)));
  for (const d of dirs) attempts.push(() => createRequire(path.join(d, '__codebase_guide__.js'))('typescript'));
  attempts.push(() => {
    const g = npmGlobalRoot();
    if (!g) throw new Error('npm root -g が使えない');
    return createRequire(import.meta.url)(path.join(g, 'typescript'));
  });
  for (const attempt of attempts) {
    let ts;
    try { ts = attempt(); } catch { continue; }
    if (ts && typeof ts.createProgram === 'function' && typeof ts.forEachChild === 'function') return ts;
    tried.push(ts?.version || '不明');
  }
  return { unusable: tried };
}

function inferredOptions(ts) {
  const bundler = ts.ModuleResolutionKind.Bundler;
  return {
    allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext,
    module: bundler !== undefined ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
    moduleResolution: bundler !== undefined ? bundler : ts.ModuleResolutionKind.NodeJs,
    allowImportingTsExtensions: bundler !== undefined ? true : undefined,
    resolveJsonModule: true, esModuleInterop: true, allowSyntheticDefaultImports: true,
  };
}

/**
 * files(リポジトリのルートからの相対パス。コードページになるファイルの一覧)のうち TypeScript / JavaScript について、
 * 識別子ごとの定義の場所を求める。typescript が無ければ { status: 'skip', reason } を返す。
 */
export function buildXref({ root, files, typescript, log = () => {} }) {
  const started = Date.now();
  const listed = new Set(files);
  const folded = process.platform === 'win32' || process.platform === 'darwin' ? new Map(files.map(f => [f.toLowerCase(), f])) : null;
  const relOf = abs => {
    const r = toPosix(path.relative(root, abs));
    if (!r || r.startsWith('../') || path.isAbsolute(r)) return null;
    const hit = listed.has(r) ? r : folded?.get(r.toLowerCase());
    // 一覧に含めた場合でも、node_modules 配下は自分たちのコードではないのでリンク先にしない
    return hit && !hit.split('/').includes('node_modules') ? hit : null;
  };

  const minified = [];
  const scripts = files.filter(f => SCRIPT_EXT.test(f) && !f.split('/').includes('node_modules')).filter(f => {
    let text = '';
    try { text = readFileSync(path.join(root, f), 'utf8'); } catch { return false; }
    if (looksMinified(text)) { minified.push(f); return false; }
    return true;
  });
  if (!scripts.length) return { status: 'skip', empty: true, reason: 'TypeScript / JavaScript のファイルが無い' };
  const analyzable = new Set(scripts);
  const isRoot = abs => { const r = relOf(abs); return !r || !SCRIPT_EXT.test(r) || analyzable.has(r); };
  const depth = f => f.split('/').length;
  // 深い場所の設定を先に使う(サブプロジェクトの paths などを優先する)。同じフォルダーでは tsconfig.json を先にする。
  const configs = files.filter(f => CONFIG_NAME.test(f.split('/').pop()) && !f.split('/').includes('node_modules'))
    .sort((a, b) => depth(b) - depth(a) || /^[tj]sconfig\.json$/i.test(b.split('/').pop()) - /^[tj]sconfig\.json$/i.test(a.split('/').pop()) || a.localeCompare(b));
  const dirs = [...new Set([root, ...configs.map(c => path.join(root, path.dirname(c)))])];
  const ts = loadTypeScript(dirs, typescript);
  if (ts.unusable) {
    return {
      status: 'skip',
      reason: ts.unusable.length
        ? `typescript ${ts.unusable.join(', ')} はコンパイラーの API(createProgram)を使えない`
        : 'typescript が見つからない。対象リポジトリで依存パッケージをインストールするか、--typescript で場所を指定する',
    };
  }
  const SK = ts.SyntaxKind;

  const done = new Map();
  const targets = [];
  const targetIndex = new Map();
  const addTarget = (rel, line) => {
    const key = `${rel}:${line}`;
    let i = targetIndex.get(key);
    if (i === undefined) { i = targets.length; targets.push([rel, line]); targetIndex.set(key, i); }
    return i;
  };
  const programs = [];
  const notes = [];
  let refCount = 0;

  // 定義の名前そのもの(リンク元にしない)。import / export の名前は元の定義へリンクするので含めない。
  const DEFINITION_KINDS = new Set([
    SK.ClassDeclaration, SK.ClassExpression, SK.InterfaceDeclaration, SK.TypeAliasDeclaration, SK.EnumDeclaration, SK.EnumMember,
    SK.FunctionDeclaration, SK.FunctionExpression, SK.MethodDeclaration, SK.MethodSignature, SK.PropertyDeclaration, SK.PropertySignature,
    SK.GetAccessor, SK.SetAccessor, SK.ModuleDeclaration, SK.VariableDeclaration, SK.Parameter, SK.TypeParameter, SK.BindingElement,
    SK.PropertyAssignment, SK.NamespaceExportDeclaration,
  ]);
  // リンク先にする定義。引数・関数内のローカル変数・型引数は、メソッドやクラスではないので含めない。
  const TARGET_KINDS = new Set([
    SK.SourceFile, SK.ModuleDeclaration, SK.ClassDeclaration, SK.ClassExpression, SK.InterfaceDeclaration, SK.TypeAliasDeclaration,
    SK.EnumDeclaration, SK.EnumMember, SK.FunctionDeclaration, SK.MethodDeclaration, SK.MethodSignature, SK.PropertyDeclaration,
    SK.PropertySignature, SK.GetAccessor, SK.SetAccessor, SK.Constructor, SK.PropertyAssignment, SK.ShorthandPropertyAssignment,
    SK.ExportAssignment, SK.BinaryExpression, SK.PropertyAccessExpression, SK.JSDocTypedefTag, SK.JSDocCallbackTag,
  ]);

  const startsCache = new WeakMap();
  const startsOf = sf => {
    let s = startsCache.get(sf);
    if (!s) { s = lineStarts(sf.text); startsCache.set(sf, s); }
    return s;
  };

  function isModuleLevel(decl) {
    let n = decl;
    while (n && [SK.BindingElement, SK.ObjectBindingPattern, SK.ArrayBindingPattern, SK.VariableDeclaration, SK.VariableDeclarationList].includes(n.kind)) n = n.parent;
    return !!n && n.kind === SK.VariableStatement && (n.parent.kind === SK.SourceFile || n.parent.kind === SK.ModuleBlock);
  }

  function isLinkTarget(decl) {
    if (decl.kind === SK.Parameter) return ts.isParameterPropertyDeclaration(decl, decl.parent);
    if (decl.kind === SK.VariableDeclaration || decl.kind === SK.BindingElement) return isModuleLevel(decl);
    return TARGET_KINDS.has(decl.kind);
  }

  function isModuleSpecifier(node) {
    const p = node.parent;
    if (!p) return false;
    if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return true;
    if (ts.isExternalModuleReference(p)) return true;
    if (ts.isCallExpression(p) && p.arguments[0] === node) {
      return p.expression.kind === SK.ImportKeyword || (ts.isIdentifier(p.expression) && p.expression.text === 'require');
    }
    return ts.isLiteralTypeNode(p) && !!p.parent && ts.isImportTypeNode(p.parent);
  }

  function isDefinitionName(node) {
    const p = node.parent;
    return !!p && p.name === node && DEFINITION_KINDS.has(p.kind);
  }

  function runProgram(label, rootNames, options, own) {
    const t0 = Date.now();
    let program;
    try {
      program = ts.createProgram({ rootNames, options: { ...options, noEmit: true } });
    } catch (err) {
      notes.push(`${label}: プログラムを作れない(${err.message})`);
      return;
    }
    const checker = program.getTypeChecker();
    const compilerOptions = program.getCompilerOptions();

    // `declare module '*.vue'` のような型だけの宣言で解決された import は、宣言ではなく実際のファイルへリンクする
    function resolveToListedFile(spec, fromFile) {
      const candidates = [];
      if (/^\.\.?\//.test(spec)) candidates.push(path.resolve(path.dirname(fromFile), spec));
      else {
        const base = compilerOptions.pathsBasePath || compilerOptions.baseUrl;
        for (const [key, subs] of Object.entries(compilerOptions.paths || {})) {
          if (!base) break;
          const star = key.indexOf('*');
          let mid = null;
          if (star < 0) { if (key === spec) mid = ''; }
          else {
            const pre = key.slice(0, star), suf = key.slice(star + 1);
            if (spec.length >= pre.length + suf.length && spec.startsWith(pre) && spec.endsWith(suf)) mid = spec.slice(pre.length, spec.length - suf.length);
          }
          if (mid !== null) for (const s of subs) candidates.push(path.resolve(base, s.replace('*', mid)));
        }
        if (compilerOptions.baseUrl) candidates.push(path.resolve(compilerOptions.baseUrl, spec));
      }
      for (const c of candidates) {
        const r = relOf(c);
        if (r) return r;
      }
      return null;
    }
    function patternModuleFile(spec) {
      const decl = checker.getSymbolAtLocation(spec)?.declarations?.[0];
      if (!decl || !ts.isModuleDeclaration(decl) || !ts.isStringLiteral(decl.name) || !decl.name.text.includes('*')) return null;
      return resolveToListedFile(spec.text, spec.getSourceFile().fileName);
    }
    function aliasPatternFile(alias) {
      for (const d of alias.declarations || []) {
        let n = d;
        while (n && !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n) && !ts.isSourceFile(n)) n = n.parent;
        const spec = n && !ts.isSourceFile(n) ? n.moduleSpecifier : undefined;
        if (spec && ts.isStringLiteral(spec)) return patternModuleFile(spec);
      }
      return null;
    }

    function targetOf(decl, from) {
      if (!isLinkTarget(decl)) return null;
      const dsf = decl.kind === SK.SourceFile ? decl : decl.getSourceFile();
      const rel = relOf(dsf.fileName);
      if (!rel) return null;
      // 自分自身のモジュール(JavaScript の exports など)は、リンクしても同じページの先頭に戻るだけなので付けない
      if (decl.kind === SK.SourceFile) return dsf === from.getSourceFile() ? null : { rel, line: 1 };
      const name = ts.getNameOfDeclaration(decl);
      if (name === from) return null;
      const pos = (name && name.pos >= 0 ? name : decl).getStart(dsf);
      return { rel, line: lineIndexOf(startsOf(dsf), pos) + 1 };
    }

    function definitionsOf(node) {
      let sym;
      if (node.kind === SK.StringLiteral || node.kind === SK.NoSubstitutionTemplateLiteral) {
        const viaPattern = patternModuleFile(node);
        if (viaPattern) return [{ rel: viaPattern, line: 1 }];
        sym = checker.getSymbolAtLocation(node);
      } else {
        const p = node.parent;
        if (p && ts.isShorthandPropertyAssignment(p) && p.name === node) sym = checker.getShorthandAssignmentValueSymbol(p);
        else if (isDefinitionName(node)) return [];
        else sym = checker.getSymbolAtLocation(node);
      }
      if (!sym) return [];
      // JavaScript の `exports.foo = …` や `this.foo = …` の左辺は定義そのものなので、リンク元にしない
      const sf = node.getSourceFile();
      if ((sym.declarations || []).some(d => (ts.isPropertyAccessExpression(d) || ts.isBinaryExpression(d)) && d.getSourceFile() === sf
        && d.pos <= node.pos && node.end <= (ts.isBinaryExpression(d) ? d.left.end : d.end))) return [];
      if (sym.flags & ts.SymbolFlags.Alias) {
        const viaPattern = aliasPatternFile(sym);
        if (viaPattern) return [{ rel: viaPattern, line: 1 }];
        sym = checker.getAliasedSymbol(sym);
      }
      // ユニオン型のプロパティなどは、元になった定義(複数)をすべて候補にする。
      // 同じ定義のオーバーロードや宣言のマージは、ファイルごとに最初の宣言だけを使う。
      const out = [];
      const seen = new Set();
      for (const s of checker.getRootSymbols(sym)) {
        // node_modules や標準ライブラリの定義を、リポジトリ内で拡張しているだけのもの(declare module 'fastify' { … } など)は、
        // 本来の定義が外部にあるのでリンクしない。拡張で追加したメンバー自体は、定義がリポジトリ内だけにあるのでリンクする。
        if ((s.declarations || []).some(d => !relOf((d.kind === SK.SourceFile ? d : d.getSourceFile()).fileName))) continue;
        const files = new Set();
        for (const d of s.declarations || []) {
          const t = targetOf(d, node);
          if (!t || files.has(t.rel)) continue;
          files.add(t.rel);
          const key = `${t.rel}:${t.line}`;
          if (!seen.has(key)) { seen.add(key); out.push(t); }
        }
      }
      return out;
    }

    let count = 0;
    for (const rel of own) {
      const sf = program.getSourceFile(path.join(root, rel));
      if (!sf) continue;
      const starts = startsOf(sf);
      const refs = [];
      const visit = node => {
        const k = node.kind;
        if (k === SK.Identifier || k === SK.PrivateIdentifier || ((k === SK.StringLiteral || k === SK.NoSubstitutionTemplateLiteral) && isModuleSpecifier(node))) {
          let found = [];
          try { found = definitionsOf(node); } catch { found = []; } // 構文の壊れたコードではコンパイラーが例外を出すことがある
          if (found.length) {
            // ハイライトでは # の後ろから名前の字句になるので、位置をそろえる
            const start = node.getStart(sf) + (k === SK.PrivateIdentifier ? 1 : 0);
            const line = lineIndexOf(starts, start);
            const ids = found.map(t => addTarget(t.rel, t.line));
            refs.push([line + 1, start - starts[line], node.end - start, ids.length === 1 ? ids[0] : ids]);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      done.set(rel, { hash: sourceHash(normalizeSource(sf.text)), refs });
      refCount += refs.length;
      count++;
    }
    programs.push({ label, files: count, seconds: (Date.now() - t0) / 1000 });
    log(`  ${label}: ${count} files (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  for (const c of configs) {
    let parsed = null;
    try { parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, c), undefined, host); } catch { parsed = null; }
    if (!parsed) { notes.push(`${c}: 読めない`); continue; }
    const own = [...new Set(parsed.fileNames.map(relOf).filter(r => r && analyzable.has(r) && !done.has(r)))];
    if (own.length) runProgram(c, parsed.fileNames.filter(isRoot), parsed.options, own);
  }
  const rest = scripts.filter(r => !done.has(r));
  if (rest.length) runProgram('(tsconfig の対象外)', rest.map(r => path.join(root, r)), inferredOptions(ts), rest);

  return {
    status: 'ok',
    engine: `typescript ${ts.version}`,
    files: Object.fromEntries(done),
    targets,
    stats: { files: done.size, refs: refCount, targets: targets.length, minified: minified.length, programs, seconds: (Date.now() - started) / 1000 },
    notes,
  };
}

export async function writeXref(outputDir, result) {
  const data = { version: XREF_VERSION, engine: result.engine, generatedAt: new Date().toISOString(), files: result.files, targets: result.targets };
  await fs.writeFile(path.join(outputDir, XREF_NAME), JSON.stringify(data));
}

export async function readXref(outputDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(outputDir, XREF_NAME), 'utf8'));
    return data?.version === XREF_VERSION ? data : null;
  } catch {
    return null;
  }
}

/**
 * ハイライトへ渡すリンクの表(本文の位置 → 字句の長さと <a> の開始タグ)を作る。
 * 記録した時と本文が違う(作り直し前に編集された、比較先の版が違う)ファイルには付けない。
 * resolve(rel, line) はリンク先 { href, label, blank } を返す。返さない(null)リンク先は使わない。
 */
export function xrefLinks(index, rel, normalized, resolve) {
  const f = index?.files?.[rel];
  if (!f || !f.refs.length || f.hash !== sourceHash(normalized)) return null;
  const starts = lineStarts(normalized);
  const links = new Map();
  for (const [line, col, len, t] of f.refs) {
    if (line > starts.length) continue;
    const dests = (Array.isArray(t) ? t : [t]).map(i => index.targets[i]).filter(Boolean).map(([r, l]) => resolve(r, l)).filter(Boolean);
    if (!dests.length) continue;
    const [first] = dests;
    const blank = first.blank ? ' target="_blank"' : '';
    const open = dests.length === 1
      ? `<a class="xref" href="${escapeHtml(first.href)}"${blank} title="${escapeHtml(`定義: ${first.label}`)}">`
      : `<a class="xref xm" href="${escapeHtml(first.href)}"${blank} title="${escapeHtml(`定義の候補: ${dests.map(d => d.label).join(', ')}`)}" data-xm="${escapeHtml(JSON.stringify(dests.map(d => [d.href, d.label, d.blank ? 1 : 0])))}">`;
    links.set(starts[line - 1] + col, { len, open });
  }
  return links;
}

// 定義の候補が複数あるリンクを押したときに、候補の一覧を出す(候補が複数あるページにだけ埋め込む)
export const XREF_MENU_SCRIPT = `(function(){var m=null;function close(){if(m){m.remove();m=null}}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a.xm');if(!a){if(m&&!m.contains(e.target))close();return}
if(e.ctrlKey||e.metaKey||e.shiftKey||e.button)return;e.preventDefault();close();m=document.createElement('div');m.className='xmenu';
m.innerHTML='<div class="xmh">定義の候補</div>'+JSON.parse(a.dataset.xm).map(function(d){return'<a href="'+esc(d[0])+'"'+(d[2]?' target="_blank"':'')+'>'+esc(d[1])+'</a>'}).join('');
document.body.appendChild(m);var r=a.getBoundingClientRect();m.style.left=Math.max(8,Math.min(r.left,innerWidth-m.offsetWidth-8))+'px';m.style.top=(r.bottom+2)+'px'});
document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});window.addEventListener('scroll',close,true)})();`;
