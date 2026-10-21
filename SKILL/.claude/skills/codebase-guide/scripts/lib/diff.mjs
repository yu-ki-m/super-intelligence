// 差分の範囲の解釈と、変更行(新しい版の行番号)の抽出。

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git, isLikelyBinary, splitLines, EXCLUDE_OUTPUT_PATHSPECS } from './common.mjs';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const WORKING_ALIASES = new Set(['working', 'worktree', 'working-tree', 'uncommitted', '未コミット', '未コミットの変更']);

async function verifyRev(root, rev) {
  if (!rev || rev.startsWith('-') || /[\s\0]/.test(rev)) throw new Error(`Gitの参照として扱えない文字列: ${rev}`);
  try {
    return (await git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])).trim();
  } catch {
    throw new Error(`Gitの参照が見つからない: ${rev}`);
  }
}

// 指定方法: "working"(未コミットの変更) / "A..B" / "A...B"(merge-baseから) / "<rev>"(そのコミット1件)
export async function resolveDiffSpec(root, spec) {
  if (spec == null) return null;
  const s = String(spec).trim();
  if (!s || s === 'none') return null;
  if (WORKING_ALIASES.has(s)) {
    let head = null;
    try { head = await verifyRev(root, 'HEAD'); } catch { /* コミットが無いリポジトリ */ }
    return { spec: s, label: '未コミットの変更（HEAD との差分）', base: head || EMPTY_TREE, target: null, working: true };
  }
  const m = s.match(/^(.*?)(\.\.\.?)(.*)$/);
  if (m) {
    if (!m[1]) throw new Error(`比較元が指定されていない: ${s}`);
    const a = await verifyRev(root, m[1]);
    const b = await verifyRev(root, m[3] || 'HEAD');
    const base = m[2] === '...' ? (await git(root, ['merge-base', a, b])).trim() : a;
    return { spec: s, label: s, base, target: b, working: false };
  }
  const target = await verifyRev(root, s);
  const parents = (await git(root, ['rev-list', '--parents', '-n', '1', target, '--'])).trim().split(/\s+/).slice(1);
  return { spec: s, label: `${s}（1コミット）`, base: parents[0] || EMPTY_TREE, target, working: false };
}

function unquote(s) {
  if (!s.startsWith('"')) return s;
  const bytes = [];
  const named = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, '\\': 92 };
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch !== '\\') { bytes.push(...Buffer.from(ch, 'utf8')); continue; }
    const nx = s[++i];
    if (/[0-7]/.test(nx)) { bytes.push(parseInt(s.substr(i, 3), 8)); i += 2; }
    else bytes.push(named[nx] ?? nx.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

function parsePath(raw) {
  const s = unquote(raw.replace(/\t$/, ''));
  if (s === '/dev/null') return null;
  return s.replace(/^[ab]\//, '');
}

function newEntry(status = 'M') {
  return { status, path: null, oldPath: null, added: new Set(), modified: new Set(), deleted: new Map(), oldText: new Map(), hunks: [], plus: 0, minus: 0, binary: false };
}

// -U0 の統一diffを解析する。変更行は新しい版の行番号で持つ。
// 同じハンク内で削除と追加が両方ある行は「変更」、追加だけの行は「追加」とする。
// 削除された行は、新しい版のどの行の直前に表示するか(行番号)をキーにして持つ。
// 「変更」の行は、対になる変更前の行(ハンク内で同じ順番の削除行)を oldText に持つ。
export function parseUnifiedDiff(out) {
  const files = new Map();
  const lines = out.split('\n');
  let cur = null;
  const finish = () => {
    if (!cur) return;
    const key = cur.path || cur.oldPath || cur.headerPath;
    delete cur.headerPath;
    if (key) { cur.path = key; files.set(key, cur); }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      finish();
      cur = newEntry();
      // ---/+++ 行が無い場合(バイナリ、モード変更だけ)のために、ヘッダーからもパスを読む
      const rest = line.slice(11);
      const len = (rest.length - 5) / 2;
      if (Number.isInteger(len) && rest.startsWith('a/') && rest.slice(2, 2 + len) === rest.slice(5 + len)) cur.headerPath = rest.slice(2, 2 + len);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.status = 'A';
    else if (line.startsWith('deleted file mode')) cur.status = 'D';
    else if (line.startsWith('rename from ')) { cur.status = 'R'; cur.oldPath = unquote(line.slice(12)); }
    else if (line.startsWith('rename to ')) cur.path = unquote(line.slice(10));
    else if (line.startsWith('--- ')) { const p = parsePath(line.slice(4)); if (p && !cur.oldPath) cur.oldPath = p; }
    else if (line.startsWith('+++ ')) { const p = parsePath(line.slice(4)); if (p) cur.path = p; }
    else if (line.startsWith('Binary files ')) cur.binary = true;
    else if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (!m) continue;
      const oldStart = Number(m[1]); const oldLines = m[2] === undefined ? 1 : Number(m[2]);
      const newStart = Number(m[3]); const newLines = m[4] === undefined ? 1 : Number(m[4]);
      const dels = []; const adds = [];
      let j = i + 1;
      while (j < lines.length && (dels.length < oldLines || adds.length < newLines)) {
        const l = lines[j];
        if (l.startsWith('\\')) { j++; continue; }
        if (l.startsWith('-') && dels.length < oldLines) dels.push(l.slice(1));
        else if (l.startsWith('+') && adds.length < newLines) adds.push(l.slice(1));
        else break;
        j++;
      }
      while (j < lines.length && lines[j].startsWith('\\')) j++;
      i = j - 1;
      cur.hunks.push({ oldStart, oldLines, newStart, newLines, context: m[5].trim() });
      cur.plus += adds.length;
      cur.minus += dels.length;
      const modCount = Math.min(adds.length, dels.length);
      for (let k = 0; k < adds.length; k++) (k < modCount ? cur.modified : cur.added).add(newStart + k);
      for (let k = 0; k < modCount; k++) cur.oldText.set(newStart + k, dels[k]);
      if (dels.length) {
        const before = adds.length ? newStart : newStart + 1;
        cur.deleted.set(before, [...(cur.deleted.get(before) || []), ...dels]);
      }
    }
  }
  finish();
  return files;
}

export async function collectDiff(root, d) {
  const args = ['diff', '--no-color', '--no-ext-diff', '--relative', '--src-prefix=a/', '--dst-prefix=b/', '-U0', '-M', d.base];
  if (d.target) args.push(d.target);
  args.push('--', '.', ...EXCLUDE_OUTPUT_PATHSPECS);
  const files = parseUnifiedDiff(await git(root, args));
  if (d.working) {
    const others = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...EXCLUDE_OUTPUT_PATHSPECS])).split('\0').filter(Boolean);
    for (const rel of others) {
      const buf = await fs.readFile(path.join(root, rel)).catch(() => null);
      if (!buf) continue;
      const entry = newEntry('A');
      entry.path = rel;
      if (isLikelyBinary(buf)) entry.binary = true;
      else {
        const all = splitLines(buf.toString('utf8'));
        const n = all.at(-1) === '' ? all.length - 1 : all.length;
        for (let i = 1; i <= n; i++) entry.added.add(i);
        entry.plus = n;
        entry.hunks.push({ oldStart: 0, oldLines: 0, newStart: 1, newLines: n, context: '' });
      }
      files.set(rel, entry);
    }
  }
  return files;
}

// 差分の新しい版(コミット指定ならそのコミット、未コミットや差分なしなら作業ツリー)からファイルを読む。
// 複数のファイルをまとめて読む。比較先がコミットなら git cat-file --batch を1回だけ起動する(ファイルごとに git を起動すると遅い)。
export async function readTargetFiles(root, d, rels) {
  const out = new Map();
  if (!rels.length) return out;
  if (!(d && d.target)) {
    for (let i = 0; i < rels.length; i += 32) {
      await Promise.all(rels.slice(i, i + 32).map(async rel => out.set(rel, await readTargetFile(root, d, rel))));
    }
    return out;
  }
  const buf = await new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', root, '-c', 'core.quotepath=false', 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const chunks = [];
    child.stdout.on('data', c => chunks.push(c));
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`git cat-file が終了コード ${code} で終わった`))));
    child.stdin.on('error', () => {});
    child.stdin.end(`${rels.map(rel => `${d.target}:./${rel}`).join('\n')}\n`);
  });
  let pos = 0;
  for (const rel of rels) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) { out.set(rel, null); continue; }
    const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(buf.toString('utf8', pos, nl));
    pos = nl + 1;
    if (!m) { out.set(rel, null); continue; } // 「<名前> missing」など
    const size = Number(m[2]);
    out.set(rel, m[1] === 'blob' ? buf.subarray(pos, pos + size) : null);
    pos += size + 1;
  }
  return out;
}

export async function readTargetFile(root, d, rel) {
  if (d && d.target) {
    // "--" を付けないと、Windowsでは引数をファイル名として確かめようとして長いパスで失敗する
    try { return await git(root, ['show', `${d.target}:./${rel}`, '--'], { encoding: 'buffer' }); } catch { return null; }
  }
  try {
    const abs = path.join(root, rel);
    const st = await fs.lstat(abs);
    if (!st.isFile()) return null;
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

export function compressRanges(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return out.join(', ');
}
