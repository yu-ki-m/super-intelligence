// flow.ts が相対パスで import するデータ定義のファイル（型と定数）を読み、手順が混ざっていないかを検査する。
// 図と手順の検査は flow.ts だけを読むので、データ定義のファイルに書いた作業は図に出ない。

import fs from 'node:fs';
import path from 'node:path';
import { parseFlow } from './parse.mjs';

export const isRelative = spec => /^\.\.?(\/|$)/.test(spec);

function resolveImport(dir, spec) {
  const base = path.resolve(dir, spec);
  const candidates = [base, `${base}.ts`, `${base}.d.ts`, base.replace(/\.js$/, '.ts'), path.join(base, 'index.ts')];
  return candidates.find(c => fs.statSync(c, { throwIfNoEntry: false })?.isFile());
}

// データ定義のファイルが、さらに import するファイルもたどる。
// 返す files は flow.ts のフォルダーから見た名前（label）と絶対パス、findings は check.mjs と同じ形
export function loadDataFiles(model, flowFile) {
  const flowPath = path.resolve(flowFile);
  const flowDir = path.dirname(flowPath);
  const labelOf = file => path.relative(flowDir, file).split(path.sep).join('/');
  const files = [];
  const findings = [];
  const add = (severity, fn, line, message) => findings.push({ severity, fn, step: '', line, message });
  const seen = new Set([flowPath]);
  const queue = [{ model, dir: flowDir, label: '' }];
  while (queue.length) {
    const from = queue.shift();
    for (const im of from.model.imports) {
      if (!isRelative(im.spec)) continue;
      const file = resolveImport(from.dir, im.spec);
      if (!file) { add('エラー', from.label, im.line, `import 先のファイルが無い（${im.spec}）`); continue; }
      if (seen.has(file)) continue;
      seen.add(file);
      const label = labelOf(file);
      const dm = parseFlow(fs.readFileSync(file, 'utf8'));
      files.push({ path: file, label });
      for (const p of dm.problems) add('エラー', label, p.line, p.message);
      if (dm.stepLines.length) add('エラー', label, dm.stepLines[0], 'データ定義のファイルに実施か goto がある（手順は flow.ts に書く。ここに書いた作業は図と手順の検査に出ない）');
      else if (dm.functions.length) add('注意', label, dm.functions[0].line, `データ定義のファイルに関数（${dm.functions.map(f => f.name).join('、')}）がある（データ定義のファイルは型と定数だけにし、関数は flow.ts に置く）`);
      queue.push({ model: dm, dir: path.dirname(file), label });
    }
  }
  return { files, findings };
}
