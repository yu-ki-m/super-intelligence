// 定義リンク(Java): JavaXref.java を JDK で動かし、結果(xref.mjs と同じ形の JSON)を読む。
// JDK(17 以降)が無い場合や解析が失敗した場合は { status: 'skip', reason } を返す。Java のファイルが無ければ null。

import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILD_FILES = new Set(['pom.xml', 'build.gradle', 'build.gradle.kts']);

export const isJavaFile = rel => /\.java$/i.test(rel);

function javaExecutable(explicit) {
  if (explicit) return explicit;
  const home = process.env.JAVA_HOME;
  if (home) {
    const p = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (existsSync(p)) return p;
  }
  return 'java';
}

export async function buildJavaXref({ root, files, java, log = () => {} }) {
  const sources = files.filter(f => isJavaFile(f) && path.posix.basename(f) !== 'module-info.java' && !f.split('/').includes('node_modules'));
  if (!sources.length) return null;
  // pom.xml / build.gradle のあるフォルダーをモジュールとみなす(同じ完全修飾名のクラスがあるときだけ、モジュールごとに解析する)
  const moduleDirs = files.filter(f => BUILD_FILES.has(path.posix.basename(f))).map(f => path.posix.dirname(f));
  const groupOf = rel => moduleDirs.filter(d => d === '.' || rel.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0] || '.';
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-guide-java-'));
  const listFile = path.join(tmp, 'files.txt');
  const outFile = path.join(tmp, 'result.json');
  try {
    await fs.writeFile(listFile, sources.map(rel => `${groupOf(rel)}\t${rel}`).join('\n'));
    const exe = javaExecutable(java);
    const run = await new Promise(resolve => {
      const child = spawn(exe, ['-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8', '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8', '-Dfile.encoding=UTF-8', '-Xss16m', path.join(here, 'JavaXref.java'), root, listFile, outFile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stderr = '';
      let pending = '';
      child.stdout.on('data', d => {
        pending += d.toString('utf8');
        for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
          log(pending.slice(0, i).replace(/\r$/, ''));
          pending = pending.slice(i + 1);
        }
      });
      child.stderr.on('data', d => { if (stderr.length < 20000) stderr += d.toString('utf8'); });
      child.on('error', error => resolve({ error }));
      child.on('close', code => resolve({ code, stderr }));
    });
    if (run.error) {
      return {
        status: 'skip',
        reason: run.error.code === 'ENOENT'
          ? 'java が見つからない。JDK 17 以降をインストールするか、--java で java の場所を指定する'
          : `java を起動できない: ${run.error.message}`,
      };
    }
    if (run.code !== 0) {
      const detail = run.stderr.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3).join(' / ');
      return { status: 'skip', reason: `Java の解析が失敗した(JDK 17 以降が必要。終了コード ${run.code}): ${detail}` };
    }
    return JSON.parse(await fs.readFile(outFile, 'utf8'));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
