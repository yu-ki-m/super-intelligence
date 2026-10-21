#!/usr/bin/env node
// ガイド作成の下準備。AIが読む範囲を絞るための材料(変更行、変更された関数の呼び出し候補、入口の候補)を集め、
// guide.json の骨組みを作る。.codebase-guide-out が無い、または古い場合は通常生成も行う。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  git, execFileAsync, sourceSignature, sanitizeName, isLikelyBinary, splitLines, mapLimit, toPosix,
  OUTPUT_DIR_NAME, LEGACY_OUTPUT_DIR_NAMES, GUIDES_DIR_NAME, MANIFEST_NAME, MANIFEST_VERSION, EXCLUDE_OUTPUT_PATHSPECS,
} from './lib/common.mjs';
import { resolveDiffSpec, collectDiff, readTargetFiles, compressRanges } from './lib/diff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const root = path.resolve(opt('--root', process.cwd()));
const outputDir = path.join(root, OUTPUT_DIR_NAME);
const refreshBase = args.includes('--refresh-base');
const force = args.includes('--force');

const CALLER_LIMIT = 15;
const CALLER_SKIP_OVER = 200;
const ENTRY_LIMIT = 80;
const TRACE_DEPTH = 6; // 変更箇所から呼び出し元をさかのぼる段数
const TRACE_NAMES = 2000; // 1段でたどる名前の数
const TRACE_HITS = 40; // 1つの名前で調べる一致の数
const TRIGGER_LIMIT = 60;

// 入口(処理のきっかけ)を探すパターン。git grep -E (POSIX ERE)で使い、JS の正規表現に直して行の判定にも使う。
// バックエンド: HTTPルート、ジョブ、イベント受信、CLI
const ENTRY_PATTERNS = [
  String.raw`(app|router|server|api|route|routes|r)\.(get|post|put|patch|delete|all|route)\([[:space:]]*['"` + '`' + String.raw`]`,
  String.raw`@(Get|Post|Put|Patch|Delete|Request)Mapping`,
  String.raw`@(Get|Post|Put|Patch|Delete|All)\(`,
  String.raw`@[A-Za-z_]+\.(get|post|put|patch|delete|route|api_route)\(`,
  String.raw`\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\(`,
  String.raw`Route::(get|post|put|patch|delete|resource|apiResource)\(`,
  String.raw`(^|[^.[:alnum:]_])(re_)?path\([[:space:]]*r?['"]`,
  String.raw`@(Cron|Scheduled|EventPattern|MessagePattern|KafkaListener|RabbitListener|SqsListener|JmsListener)`,
  String.raw`(program|cli)\.command\(|@click\.command|cobra\.Command\{`,
];
// フロントエンド: 操作(JSX の onClick、Vue の @click、Angular の (click)、Svelte の on:click、addEventListener)と、
// 画面の初期表示(マウント時の処理、ページのデータ取得、画面のルート定義)
const UI_PATTERNS = [
  String.raw`[[:space:]{]on[A-Z][A-Za-z]*=\{`,
  String.raw`[[:space:]](@|v-on:)[a-z][A-Za-z.:-]*=`,
  String.raw`[[:space:]]\([a-z][A-Za-z.]*\)="`,
  String.raw`[[:space:]]on:[a-z]+[=|]`,
  String.raw`addEventListener\(`,
  String.raw`(useEffect|useLayoutEffect|onMounted|onBeforeMount|onMount|useQuery|useSWR)\(`,
  String.raw`(^|[^.[:alnum:]_])(componentDidMount|mounted|created|ngOnInit)[[:space:]]*\(`,
  String.raw`(getServerSideProps|getStaticProps)`,
  String.raw`<Route[[:space:]]`,
  String.raw`path:[[:space:]]*['"` + '`' + String.raw`]/`,
];
const toJsRegExp = p => new RegExp(p.replace(/\[:space:\]/g, '\\s').replace(/\[:alnum:\]/g, 'A-Za-z0-9'));
const TRIGGER_RES = [...ENTRY_PATTERNS, ...UI_PATTERNS].map(toJsRegExp);
// 圧縮されたコード(1行が極端に長い行や .min.js)は、定義やきっかけの判定に使わない(誤検出が多く、正規表現も遅い)
const MINIFIED_LINE = 1000;
const isMinifiedPath = rel => /\.min\.(?:[cm]?js|css)$/i.test(rel);
const isTriggerLine = text => text.length <= MINIFIED_LINE && TRIGGER_RES.some(re => re.test(text));
// テストのコードは、きっかけにもさかのぼりの経路にもしない
const isTestFile = rel => /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|cypress|fixtures?)\//i.test(rel)
  || /\.(test|spec|stories|cy)\.[cm]?[jt]sx?$/i.test(rel) || /Tests?\.(java|kt)$/.test(rel) || /(^|\/)test_[^/]*\.py$/.test(rel);

// 関数・メソッド・クラス定義らしい行から名前を取り出す(言語をまたいだ簡易判定)。
const DEF_PATTERNS = [
  /\bfunction\*?\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[[(]/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/,
  /^\s*(?:[\w@]+\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/,
  /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
  /^\s*(?:(?:public|private|protected|static|readonly|override)\s+)*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::[^=]+)?=>/,
  /^\s*(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async|synchronized|sealed|extern|unsafe|partial)\s+)*(?:[\w<>[\],.?]+\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^{;=]+)?(?:throws\s+[\w.,\s]+)?\s*\{\s*$/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|struct|enum|trait)\s+([A-Za-z_$][\w$]*)/,
  // 定数・設定値(関数の中の変数は拾わないよう、字下げの無いものと static final に限る)
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/,
  /^(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_]\w*)\s*:/,
  /^\s*(?:(?:public|private|protected|internal)\s+)?const\s+val\s+([A-Za-z_]\w*)/,
  /^\s*(?:(?:public|private|protected)\s+)?static\s+final\s+[\w<>[\],.? ]+?\s+([A-Za-z_]\w*)\s*=/,
  /^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=(?!=)/,
];
const NOT_NAMES = new Set('if for while switch catch return else do try function new typeof sizeof await yield with elif except match case'.split(' '));

function definitionName(line) {
  if (line.length > MINIFIED_LINE) return null;
  for (const re of DEF_PATTERNS) {
    const m = line.match(re);
    if (m && !NOT_NAMES.has(m[1])) return m[1];
  }
  return null;
}

const indentOf = line => (line.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;

// 行 lineNo を含む関数(定義行の字下げが本体より浅いもの)を上へたどって探す。
function enclosingDefinition(lines, lineNo) {
  let bodyIndent = null;
  for (let k = lineNo; k <= Math.min(lines.length, lineNo + 5); k++) {
    if (lines[k - 1]?.trim()) { bodyIndent = indentOf(lines[k - 1]); break; }
  }
  for (let k = lineNo; k >= Math.max(1, lineNo - 400); k--) {
    const line = lines[k - 1];
    if (!line || !line.trim()) continue;
    const name = definitionName(line);
    if (name && (k === lineNo || bodyIndent === null || indentOf(line) < bodyIndent)) return { name, line: k, text: line.trim() };
  }
  return null;
}

// 行 lineNo を含む、きっかけ(onClick、useEffect、ルート定義など)か関数を上へたどって探す。
// 関数の直前のアノテーション・デコレーター(@PostMapping、@app.post など)がきっかけなら、そちらを返す。
function triggerOrDefinition(lines, lineNo) {
  const own = lines[lineNo - 1] || '';
  if (isTriggerLine(own)) return { trigger: { line: lineNo, text: own.trim() } };
  const ownName = definitionName(own);
  let limit = indentOf(own);
  for (let k = ownName ? lineNo : lineNo - 1; k >= Math.max(1, lineNo - 400); k--) {
    const line = lines[k - 1];
    if (!line || !line.trim() || (k !== lineNo && indentOf(line) >= limit)) continue;
    if (k !== lineNo && isTriggerLine(line)) return { trigger: { line: k, text: line.trim() } };
    const name = definitionName(line);
    if (name) {
      for (let a = k - 1; a >= Math.max(1, k - 8); a--) {
        const t = (lines[a - 1] || '').trim();
        if (!t.startsWith('@')) break;
        if (isTriggerLine(t)) return { trigger: { line: a, text: t }, via: name };
      }
      return { def: { name, line: k } };
    }
    if (!/^\s*[}\])]/.test(line)) limit = indentOf(line);
  }
  return null;
}

async function readRequest() {
  const file = opt('--request-file');
  if (file) return (await fs.readFile(path.resolve(file), 'utf8')).trim();
  return (opt('--request', '') || '').trim();
}

async function ensureBase() {
  const manifestPath = path.join(outputDir, MANIFEST_NAME);
  let manifest = null;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { /* 未生成または古い形式 */ }
  const sig = await sourceSignature(root);
  let reason = null;
  if (!manifest) reason = '.codebase-guide-out が無い、または記録ファイルの無い古い形式';
  else if (refreshBase) reason = '--refresh-base の指定';
  else if (manifest.version !== MANIFEST_VERSION) reason = 'スキルの更新で出力の形式が変わった（定義リンクなど）';
  else if (sig && manifest.source?.signature !== sig.signature) reason = '前回の生成からソースが変わっている';
  if (!reason) return { action: '既存の .codebase-guide-out をそのまま使う', manifest };
  const opts = manifest?.options || {};
  const genArgs = [path.join(here, 'generate-html-code.mjs'), '--root', root];
  if (opts.includeIgnored) genArgs.push('--include-ignored');
  for (const d of opts.includeDirs || []) genArgs.push('--include-dir', d);
  for (const f of opts.includeFiles || []) genArgs.push('--include-file', f);
  if (opts.xref === false) genArgs.push('--no-xref');
  if (opts.typescript) genArgs.push('--typescript', opts.typescript);
  if (opts.java) genArgs.push('--java', opts.java);
  try {
    await execFileAsync(process.execPath, genArgs, { maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`通常生成(generate-html-code.mjs)が失敗した:\n${err.stdout || ''}${err.stderr || err.message}`);
  }
  manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  return { action: `通常生成をやり直した（${reason}）`, manifest };
}

async function grepLines(argsForGrep, target) {
  const gitArgs = ['grep', '-n', '-I', ...argsForGrep];
  if (target) gitArgs.push(target);
  gitArgs.push('--', '.', ...EXCLUDE_OUTPUT_PATHSPECS);
  try {
    const out = await git(root, gitArgs);
    const prefix = target ? `${target}:` : '';
    return out.split('\n').filter(Boolean).map(l => (prefix && l.startsWith(prefix) ? l.slice(prefix.length) : l));
  } catch (err) {
    if (err.code === 1) return []; // 一致なし
    throw err;
  }
}

// 名前の一致を探すための、比較先の版の全テキスト。名前ごとに git grep を起動すると遅い(Windows では1回 0.5 秒前後。
// 複数の名前を1回の git grep -w に渡すとさらに遅くなる)ため、一度だけ読み、単語に分けて照らす。
const CORPUS_FILE_MAX = 1024 * 1024;
async function loadCorpus(diff) {
  const listed = diff?.target
    ? await git(root, ['ls-tree', '-r', '-z', '--name-only', diff.target])
    : await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const skipDirs = new Set([OUTPUT_DIR_NAME, ...LEGACY_OUTPUT_DIR_NAMES]);
  const rels = [...new Set(listed.split('\0').filter(Boolean))].filter(rel => !skipDirs.has(rel.split('/')[0])).sort();
  const bufs = await readTargetFiles(root, diff, rels);
  const files = [];
  for (const rel of rels) {
    const buf = bufs.get(rel);
    if (buf && buf.length <= CORPUS_FILE_MAX && !isLikelyBinary(buf)) files.push({ rel, lines: splitLines(buf.toString('utf8')) });
  }
  return files;
}

// 名前ごとの一致行("ファイル:行:本文"。git grep -n -w と同じ単語単位)。圧縮されたコードの行は除く。
function findWords(corpus, names) {
  const wanted = new Set(names);
  const result = new Map(names.map(n => [n, []]));
  for (const { rel, lines } of corpus) {
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (text.length > MINIFIED_LINE) continue;
      const hit = new Set();
      for (const w of text.match(/[A-Za-z0-9_$]+/g) || []) {
        if (wanted.has(w) && !hit.has(w)) { hit.add(w); result.get(w).push(`${rel}:${i + 1}:${text}`); }
      }
    }
  }
  return result;
}

const clip = (s, n = 150) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function main() {
  const started = Date.now();
  const request = await readRequest();
  if (!request) {
    console.error('--request "<依頼文>" または --request-file <ファイル> を指定する');
    process.exit(1);
  }
  const date = new Date();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const name = sanitizeName(opt('--name') || `${ymd}-${request.slice(0, 30)}`);
  const guideDir = path.join(outputDir, GUIDES_DIR_NAME, name);
  const guideFile = path.join(guideDir, 'guide.json');

  const base = await ensureBase();
  const diff = await resolveDiffSpec(root, opt('--diff'));
  const diffFiles = diff ? await collectDiff(root, diff) : new Map();
  const reviewGuess = /レビュー|指摘|review|問題点|バグ|懸念|不具合/i.test(request);

  // 変更ファイルごとに、変更行・削除位置・変更を含む関数・追加された定義を集める
  const changed = [];
  const symbols = new Map(); // name -> {definedAt}
  const changedFiles = [...diffFiles.entries()].sort(([a], [b]) => a.localeCompare(b));
  const buffers = await readTargetFiles(root, diff, changedFiles.filter(([, f]) => f.status !== 'D' && !f.binary).map(([rel]) => rel));
  for (const [rel, f] of changedFiles) {
    const item = { rel, f, hunks: [] };
    changed.push(item);
    if (f.status === 'D' || f.binary) continue;
    const buf = buffers.get(rel);
    if (!buf || isLikelyBinary(buf)) continue;
    const lines = splitLines(buf.toString('utf8'));
    if (isMinifiedPath(rel) || lines.some(l => l.length > MINIFIED_LINE)) { item.minified = true; continue; }
    for (const h of f.hunks) {
      const at = h.newLines > 0 ? h.newStart : Math.max(1, h.newStart);
      const enclosing = enclosingDefinition(lines, at);
      const defs = [];
      for (let n = h.newStart; n < h.newStart + h.newLines; n++) {
        const d = definitionName(lines[n - 1] || '');
        if (d) defs.push({ name: d, line: n });
      }
      item.hunks.push({ h, enclosing, defs });
      for (const d of [enclosing, ...defs].filter(Boolean)) {
        if (d.name.length < 3 || symbols.has(d.name) || isTestFile(rel)) continue;
        symbols.set(d.name, { file: rel, line: d.line });
      }
    }
  }

  // 変更された関数・追加された定義を、名前の一致で呼んでいそうな箇所(git grep -w)
  const corpus = symbols.size ? await loadCorpus(diff) : [];
  const corpusLines = new Map(corpus.map(f => [f.rel, f.lines]));
  const symbolHits = findWords(corpus, [...symbols.keys()]);
  const callers = [...symbols].map(([sym, def]) => ({ sym, def, hits: symbolHits.get(sym).filter(l => !l.startsWith(`${def.file}:${def.line}:`)) }));
  callers.sort((a, b) => a.sym.localeCompare(b.sym));

  const target = diff?.target || null;
  const notTest = h => !isTestFile(h.slice(0, h.indexOf(':')));
  const entryHits = (await grepLines(['-E', ...ENTRY_PATTERNS.flatMap(p => ['-e', p])], target)).filter(notTest);
  const uiHits = (await grepLines(['-E', ...UI_PATTERNS.flatMap(p => ['-e', p])], target)).filter(notTest);

  // 変更箇所から、名前の一致で呼び出し元を段々にさかのぼり、たどり着いたきっかけ(入口の候補)を集める
  const triggers = new Map();
  const commonNames = [];
  let traceCut = false;
  if (diff && symbols.size) {
    const seen = new Set(symbols.keys());
    let frontier = [...symbols.entries()].map(([name, def]) => ({ name, def, chain: [name] }));
    for (let depth = 0; depth < TRACE_DEPTH && frontier.length; depth++) {
      if (frontier.length > TRACE_NAMES) traceCut = true;
      const batch = frontier.slice(0, TRACE_NAMES);
      const hitsOf = depth === 0 ? symbolHits : findWords(corpus, batch.map(f => f.name));
      const work = [];
      for (const f of batch) {
        const hits = hitsOf.get(f.name);
        if (hits.length > CALLER_SKIP_OVER) { commonNames.push(f.name); continue; }
        if (hits.length > TRACE_HITS) traceCut = true;
        for (const h of hits.slice(0, TRACE_HITS)) {
          const m = /^(.+?):(\d+):/.exec(h);
          if (!m) continue;
          const rel = m[1]; const line = Number(m[2]);
          if (isTestFile(rel) || isMinifiedPath(rel) || h.length > MINIFIED_LINE + rel.length + 12 || (rel === f.def.file && line === f.def.line)) continue;
          work.push({ f, rel, line });
        }
      }
      const next = [];
      for (const { f: { name, chain }, rel, line } of work) {
        const lines = corpusLines.get(rel);
        const ctx = lines && triggerOrDefinition(lines, line);
        if (ctx?.trigger) {
          const key = `${rel}:${ctx.trigger.line}`;
          if (!triggers.has(key)) triggers.set(key, { at: key, text: ctx.trigger.text, chain: ctx.via && ctx.via !== name ? [...chain, ctx.via] : chain });
        } else if (ctx?.def && ctx.def.name.length >= 3 && !seen.has(ctx.def.name)) {
          seen.add(ctx.def.name);
          next.push({ name: ctx.def.name, def: { file: rel, line: ctx.def.line }, chain: [...chain, ctx.def.name] });
        }
      }
      frontier = next;
    }
    if (frontier.length) traceCut = true;
  }

  // guide.json の骨組み(既にあれば --force 以外では上書きしない)
  await fs.mkdir(guideDir, { recursive: true });
  let skeletonNote;
  const exists = await fs.access(guideFile).then(() => true, () => false);
  if (exists && !force) {
    skeletonNote = '既存の guide.json を残した（作り直す場合は --force）';
  } else {
    const skeleton = {
      title: '',
      request,
      diff: diff ? diff.spec : null,
      review: reviewGuess,
      summary: [],
      steps: [],
      notes: [],
      unverified: [],
    };
    await fs.writeFile(guideFile, `${JSON.stringify(skeleton, null, 2)}\n`);
    skeletonNote = '骨組みを作成した';
  }

  // AIが読むための下準備メモ
  const relRoot = p => toPosix(path.relative(root, p));
  const out = [];
  out.push('# ガイド作成の下準備', '');
  out.push(`- ガイド名: ${name}`);
  out.push(`- guide.json: ${relRoot(guideFile)}（${skeletonNote}）`);
  out.push(`- 依頼文: ${request}`);
  out.push(`- レビュー依頼かどうか（依頼文からの推定）: ${reviewGuess ? 'レビュー依頼と推定（review: true）' : 'レビュー依頼ではないと推定（review: false）'}。依頼文を読んで判断し、guide.json の review を確定する`);
  out.push(`- .codebase-guide-out: ${base.action}（${base.manifest.files.length} ファイル）`);
  out.push('');
  if (diff) {
    const plus = changed.reduce((s, c) => s + c.f.plus, 0);
    const minus = changed.reduce((s, c) => s + c.f.minus, 0);
    out.push(`## 差分: ${diff.label}`, '');
    out.push(`比較元 ${diff.base.slice(0, 10)} → 比較先 ${diff.target ? diff.target.slice(0, 10) : '作業ツリー'}、${changed.length} ファイル、+${plus} −${minus}`, '');
    if (!changed.length) out.push('変更は無い。', '');
    else {
      out.push('| 状態 | ファイル | +/− | 変更行（新しい版の行番号） |', '|---|---|---|---|');
      for (const c of changed) {
        const lines = c.f.binary ? 'バイナリ' : c.f.status === 'D' ? '削除されたファイル' : compressRanges([...c.f.added, ...c.f.modified]) || '（削除だけ）';
        const name2 = c.f.status === 'R' ? `${c.f.oldPath} → ${c.rel}` : c.rel;
        out.push(`| ${c.f.status} | ${name2} | +${c.f.plus} −${c.f.minus} | ${lines} |`);
      }
      out.push('');
      out.push('### 変更を含む関数（字下げからの推定）', '');
      for (const c of changed) {
        if (c.minified) out.push(`- ${c.rel}: 圧縮されたコードのため、関数の推定と呼び出し元のさかのぼりをしていない`);
        for (const { h, enclosing, defs } of c.hunks) {
          const range = h.newLines ? `${h.newStart}-${h.newStart + h.newLines - 1}` : `${h.newStart} の後ろ（削除だけ）`;
          const where = enclosing ? `${enclosing.name}（${enclosing.line} 行目: \`${clip(enclosing.text, 100)}\`）` : '関数を特定できない';
          const added = defs.length ? `／追加された定義: ${defs.map(d => `${d.name}（${d.line} 行目）`).join(', ')}` : '';
          out.push(`- ${c.rel}:${range}（−${h.oldLines} +${h.newLines}） ${where}${added}`);
        }
      }
      out.push('');
    }
    out.push(`### 呼び出し候補（名前が一致する箇所。各 ${CALLER_LIMIT} 件まで）`, '');
    if (!callers.length) out.push('対象の名前が無い。', '');
    for (const c of callers) {
      if (c.hits.length > CALLER_SKIP_OVER) { out.push(`- \`${c.sym}\`（定義 ${c.def.file}:${c.def.line}）: ${c.hits.length} 件。一般的な名前のため省略`); continue; }
      out.push(`- \`${c.sym}\`（定義 ${c.def.file}:${c.def.line}）: ${c.hits.length} 件`);
      for (const h of c.hits.slice(0, CALLER_LIMIT)) out.push(`  - ${clip(h.replace(/\s+/g, ' '))}`);
      if (c.hits.length > CALLER_LIMIT) out.push(`  - …ほか ${c.hits.length - CALLER_LIMIT} 件`);
    }
    out.push('');
    out.push(`### 変更箇所からさかのぼった入口の候補（名前の一致で呼び出し元を ${TRACE_DEPTH} 段までたどった推定。${TRIGGER_LIMIT} 件まで）`, '');
    out.push('順路はこの中の入口（きっかけ）から始め、変更箇所まで実行される順に並べる。変更箇所にたどり着くと確かめた入口は、全部ステップ（kind: "entry"）にする（入口ごとにルートになる）。経路は「入口側 → … → 変更箇所」の順。', '');
    const found = [...triggers.values()];
    if (!found.length) out.push('見つからない。変更箇所の呼び出し元をコードで読んでさかのぼる（DI・イベント・動的な呼び出しでは名前がつながらない）。');
    for (const t of found.slice(0, TRIGGER_LIMIT)) out.push(`- ${t.at}: ${clip(t.text.replace(/\s+/g, ' '), 110)}（経路: ${[...t.chain].reverse().join(' → ')}）`);
    if (found.length > TRIGGER_LIMIT) out.push(`- …ほか ${found.length - TRIGGER_LIMIT} 件`);
    if (commonNames.length) out.push(`- 一般的な名前のため、たどらなかった名前: ${[...new Set(commonNames)].map(n => `\`${n}\``).join(', ')}`);
    if (traceCut) out.push('- 候補が多いため、途中で打ち切った経路がある。');
    out.push('');
  } else {
    out.push('## 差分: 指定なし', '', '依頼文が差分を対象にしている場合は --diff で範囲を指定して実行し直す。', '');
  }
  out.push(`## 入口の候補: バックエンド（ルート定義・ジョブ・イベント受信・CLI。${ENTRY_LIMIT} 件まで）`, '');
  if (!entryHits.length) out.push('見つからない。');
  for (const h of entryHits.slice(0, ENTRY_LIMIT)) out.push(`- ${clip(h.replace(/\s+/g, ' '))}`);
  if (entryHits.length > ENTRY_LIMIT) out.push(`- …ほか ${entryHits.length - ENTRY_LIMIT} 件（git grep で絞り込む）`);
  out.push('');
  out.push(`## 入口の候補: フロントエンド（ボタンなどの操作・画面の初期表示・画面のルート定義。${ENTRY_LIMIT} 件まで）`, '');
  if (!uiHits.length) out.push('見つからない。');
  for (const h of uiHits.slice(0, ENTRY_LIMIT)) out.push(`- ${clip(h.replace(/\s+/g, ' '))}`);
  if (uiHits.length > ENTRY_LIMIT) out.push(`- …ほか ${uiHits.length - ENTRY_LIMIT} 件（git grep で絞り込む）`);
  out.push('');
  out.push('## 次にやること', '');
  out.push('1. 上の変更行・呼び出し候補・入口の候補を起点に、必要な範囲だけを読む（候補は名前の一致による推定。呼び出し関係はコードで確かめる）。');
  out.push(`   順路は入口（ボタン操作・画面の初期表示・エンドポイントなど、処理のきっかけ）から始め、実行される順に並べる。対象にたどり着く入口は全部ステップにする（入口ごとにルートになる）。${diff ? '差分でも変更箇所から始めず、「変更箇所からさかのぼった入口の候補」を確かめて、入口から変更箇所までをつなぐ。' : ''}`);
  if (reviewGuess) out.push(`   レビュー依頼なら、順路の各ステップの関数全体${diff ? 'と、上の「変更を含む関数」すべて' : ''}を読み、references/guide-format.md の「確かめる観点」を全部確かめる。件数の目安は無い。見つけたものは全部書く。`);
  out.push('2. guide.json に steps・notes・summary を書く（書式は references/guide-format.md）。');
  out.push(`3. node "${toPosix(path.join(here, 'build-guide.mjs'))}" --root "${toPosix(root)}" --name "${name}" を実行し、エラーが出たら guide.json を直して再実行する。`);
  const brief = out.join('\n');
  await fs.writeFile(path.join(guideDir, 'guide.brief.md'), `${brief}\n`);
  console.log(brief);
  console.log(`\n(下準備 ${((Date.now() - started) / 1000).toFixed(2)}s。このメモは ${relRoot(path.join(guideDir, 'guide.brief.md'))} にも保存した)`);
}

main().catch(err => {
  console.error(err?.message || err);
  process.exit(1);
});
