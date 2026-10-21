// 改善前と改善後の flow.ts を比べ、ステップと作業・行き先の増減をまとめる。

import { flowGraph, condLabel, edgeConds } from './graph.mjs';

const WHO = { model: 'AI', tool: 'ツール', human: '人', subflow: 'サブフロー', unknown: '不明' };

export function diffModels(before, after) {
  const res = { byFn: {}, rows: [] };
  const beforeFlows = new Map(before.functions.filter(f => f.isFlow).map(f => [f.name, f]));
  const afterFlows = new Map(after.functions.filter(f => f.isFlow).map(f => [f.name, f]));

  for (const [name, f] of afterFlows) {
    const d = { added: [], changed: [] };
    res.byFn[name] = d;
    const segs = f.segments.filter(s => !s.transparent);
    const old = beforeFlows.get(name);
    if (!old) {
      d.added = segs.map(s => s.id);
      res.rows.push({ kind: '追加', fn: name, step: '', text: 'フロー関数を追加した' });
      continue;
    }
    const oldSegs = new Map(old.segments.filter(s => !s.transparent).map(s => [s.id, s]));
    const oldEdges = edgeTexts(old);
    const newEdges = edgeTexts(f);
    for (const s of segs) {
      const p = oldSegs.get(s.id);
      if (!p) {
        d.added.push(s.id);
        res.rows.push({ kind: '追加', fn: name, step: s.title, text: summarizeWorks(s).join('\n') || 'ステップを追加した' });
        continue;
      }
      if (norm(p.bodyText) === norm(s.bodyText)) continue;
      d.changed.push(s.id);
      const lines = [];
      const ow = summarizeWorks(p);
      const nw = summarizeWorks(s);
      for (const w of nw) if (!ow.includes(w)) lines.push(`作業を追加：${w}`);
      for (const w of ow) if (!nw.includes(w)) lines.push(`作業を削除：${w}`);
      const oe = oldEdges.get(s.id) ?? [];
      const ne = newEdges.get(s.id) ?? [];
      for (const e of ne) if (!oe.includes(e)) lines.push(`行き先を追加：${e}`);
      for (const e of oe) if (!ne.includes(e)) lines.push(`行き先を削除：${e}`);
      if (!lines.length) lines.push('作業と行き先は同じで、条件・入力・式などを変えた');
      res.rows.push({ kind: '変更', fn: name, step: s.title, text: lines.join('\n') });
    }
    for (const [id, p] of oldSegs) {
      if (!segs.some(s => s.id === id)) res.rows.push({ kind: '削除', fn: name, step: p.title, text: summarizeWorks(p).join('\n') || 'ステップを削除した' });
    }
    const oldDecls = old.topDecls.map(x => x.text.replace(/\s+/g, ' '));
    const newDecls = f.topDecls.map(x => x.text.replace(/\s+/g, ' '));
    const declLines = [
      ...newDecls.filter(x => !oldDecls.includes(x)).map(x => `宣言を追加：${x}`),
      ...oldDecls.filter(x => !newDecls.includes(x)).map(x => `宣言を削除：${x}`),
    ];
    if (declLines.length) res.rows.push({ kind: '変更', fn: name, step: '関数直下の宣言', text: declLines.join('\n') });
  }
  for (const name of beforeFlows.keys()) {
    if (!afterFlows.has(name)) res.rows.push({ kind: '削除', fn: name, step: '', text: 'フロー関数を削除した' });
  }
  return res;
}

function summarizeWorks(seg) {
  return seg.items.map(it => {
    if (it.kind === 'perform') return `[${WHO[it.who] ?? it.who}] ${it.instruction}`;
    if (it.kind === 'helper') return `[補助] ${it.helper}：${it.summary}`;
    return `[サブフロー] ${it.target}`;
  });
}

function edgeTexts(f) {
  const g = flowGraph(f);
  const titles = new Map(f.segments.map(s => [s.id, s.title]));
  for (const t of g.terminals) titles.set(t.id, t.kind === 'end' ? '関数の終わり' : `終了：${t.label}`);
  const out = new Map();
  for (const e of g.edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    const label = e.args?.some(a => a.length) ? edgeConds(e).join(' / ') : e.conds.map(condLabel).filter(Boolean).join(' / ');
    out.get(e.from).push(`→ ${titles.get(e.to) ?? e.to}${label ? `（${label}）` : ''}`);
  }
  return out;
}

function norm(text) {
  return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
}
