// FlowTS 0.4 の静的検査（仕様 10 章）のうち構文から確かめられるものと、手順の抜けを見つけるための注意を出す。
// 重さは「エラー」（FlowTS として誤り）と「注意」（書き方は正しいが、手順に抜けがありそう）の2つ。

import { flowGraph } from './graph.mjs';

const WHO_VALUES = new Set(['model', 'tool', 'human']);
const VOID_TYPES = /^(void|undefined|Promise<\s*(void|undefined)\s*>)$/;

export function checkFlow(model) {
  const findings = [];
  const add = (severity, fn, step, line, message) => findings.push({ severity, fn, step, line, message });

  for (const p of model.problems) add('エラー', '', '', p.line, p.message);

  for (const f of model.functions) {
    if (!f.isFlow) {
      for (const g of f.gotos) add('エラー', f.name, '', g.line, `goto ${g.target} の行き先が、この関数のラベル付きブロックに無い`);
      if (!f.isAsync && f.awaits.length) add('エラー', f.name, '', f.awaits[0], 'async でない関数で await を使っている');
      for (const p of f.performs) checkPerform(p, f.name, '', add);
      for (const line of f.untyped) add('エラー', f.name, '', line, '実施に型引数が無い（実施<T>(…) の T を書く）');
      for (const line of f.vars) add('注意', f.name, '', line, 'var ではなく const・let を使う');
      continue;
    }

    const labels = f.segments.filter(s => s.kind === 'label');
    const labelByName = new Map(labels.map(s => [s.name, s]));
    const nested = new Set(f.nestedLabelTargets.map(l => l.label));
    labels.forEach((s, i) => {
      if (labels.findIndex(x => x.name === s.name) !== i) add('エラー', f.name, s.title, s.line, `ジャンプ先のラベル「${s.name}」が重複している`);
    });

    // ラベルの引数（仕様 5.4）
    const outer = new Set([...f.paramNames, ...f.topDecls.flatMap(d => d.names)]);
    for (const s of labels) {
      const seen = new Set();
      for (const p of s.params) {
        if (!p.ok) add('エラー', f.name, s.title, p.line ?? s.line, `ラベル「${s.name}」の引数「${p.text}」は「名前: 型」の形で書く（既定値・?・...・分割代入は使えない）`);
        if (seen.has(p.name)) add('エラー', f.name, s.title, p.line ?? s.line, `ラベル「${s.name}」の引数名「${p.name}」が重複している`);
        seen.add(p.name);
        if (outer.has(p.name)) add('エラー', f.name, s.title, p.line ?? s.line, `ラベル「${s.name}」の引数「${p.name}」が、関数の引数か関数直下の変数と同じ名前になっている`);
      }
    }

    let awaitLine = null;
    for (const seg of f.segments) {
      if (seg.awaits.length && awaitLine === null) awaitLine = seg.awaits[0];
      for (const g of seg.gotos) {
        if (!labelByName.has(g.target)) {
          add('エラー', f.name, seg.title, g.line, nested.has(g.target)
            ? `goto の行き先「${g.target}」が関数本体の直下に無い（ジャンプ先は関数本体の直下に置く）`
            : `goto の行き先「${g.target}」が、この関数のラベル付きブロックに無い`);
        }
        if (g.inTry) add('エラー', f.name, seg.title, g.line, `try・catch・finally の中から goto ${g.target} している`);
        const target = labelByName.get(g.target);
        if (target) {
          const n = target.params.length;
          const m = g.args.length;
          if (n === 0 && m > 0) add('エラー', f.name, seg.title, g.line, `引数の無いラベル「${g.target}」に、goto で引数を ${m} 個渡している`);
          else if (n > 0 && m !== n) add('エラー', f.name, seg.title, g.line, `goto ${g.target} の引数が ${m} 個ある（ラベルの引数は ${n} 個：${target.params.map(p => p.text).join('、')}）`);
        }
      }
      for (const g of seg.nestedGotos) add('エラー', f.name, seg.title, g.line, `関数やコールバックの中から goto ${g.target} している（関数の境界は越えられない）`);
      for (const line of seg.untyped) add('エラー', f.name, seg.title, line, '実施に型引数が無い（実施<T>(…) の T を書く）');
      for (const p of seg.items) if (p.kind === 'perform') checkPerform(p, f.name, seg.title, add);
      for (const line of seg.vars) add('注意', f.name, seg.title, line, 'var ではなく const・let を使う');
    }
    if (awaitLine !== null && !f.isAsync) add('エラー', f.name, '', awaitLine, 'async でない関数で await を使っている');

    // goto が宣言を飛び越えたり、宣言をもう一度評価させたりしないか（仕様 6.3）
    for (const seg of f.segments) {
      for (const g of seg.gotos) {
        const target = labelByName.get(g.target);
        if (!target || g.topIndex === undefined) continue;
        const i = g.topIndex;
        const j = target.topIndex;
        if (j > i) {
          const skipped = f.topDecls.filter(d => d.topIndex > i && d.topIndex < j).flatMap(d => d.names);
          const used = new Set(f.topRefs.slice(j).flat());
          const bad = [...new Set(skipped.filter(n => used.has(n)))];
          if (bad.length) add('エラー', f.name, seg.title, g.line, `goto ${g.target} が宣言（${bad.join('、')}）を飛び越え、行き先から後ろでその変数を使っている（初期化されていない変数を参照し得る）`);
        } else {
          const redo = f.topDecls.filter(d => d.topIndex >= j && d.topIndex < i && d.kind !== 'type').flatMap(d => d.names);
          if (redo.length) add('エラー', f.name, seg.title, g.line, `後ろへ戻る goto ${g.target} で、関数直下の宣言（${redo.join('、')}）をもう一度評価することになる（共有する変数は行き先より前で宣言する）`);
        }
      }
    }

    for (const d of f.topDecls) {
      if (d.kind === 'let' && !d.hasInit) add('注意', f.name, '', d.line, `変数「${d.names.join('、')}」に初期値が無い（goto を含むどの経路でも、参照より先に代入されるかは確かめていない）`);
    }

    graphFindings(f, add);
  }
  return findings;
}

function checkPerform(p, fnName, stepName, add) {
  if (!p.type) add('エラー', fnName, stepName, p.line, '実施に型引数が無い（実施<T>(…) の T を書く）');
  if (!p.instruction) add('エラー', fnName, stepName, p.line, '実施に指示が無い');
  if (p.argCount > 3) add('エラー', fnName, stepName, p.line, `実施の引数が ${p.argCount} 個ある（指示・入力・設定の3つまで）`);
  if (p.who === 'unknown') return;
  if (!WHO_VALUES.has(p.who)) add('エラー', fnName, stepName, p.line, `担当「${p.who}」は model・tool・human のどれでもない`);
  else if ((p.who === 'tool' || p.who === 'human') && !p.cap) add('エラー', fnName, stepName, p.line, `担当が ${p.who} なのに能力が無い`);
}

function graphFindings(f, add) {
  const g = flowGraph(f);
  if (!g.entry) return;
  const byId = new Map(g.segments.map(s => [s.id, s]));
  const next = new Map(g.segments.map(s => [s.id, []]));
  for (const e of g.edges) if (byId.has(e.to)) next.get(e.from).push(e.to);
  for (const [k, v] of next) next.set(k, [...new Set(v)]);

  // 引数のあるラベルには goto でだけ入る（仕様 5.4）
  if (g.entry.params?.length) add('エラー', f.name, g.entry.title, g.entry.line, `引数のあるラベル「${g.entry.name}」が関数の先頭にあり、goto を通らずに入る`);
  for (const e of g.edges) {
    const t = byId.get(e.to);
    if (e.kind === 'next' && t?.params?.length) add('エラー', f.name, t.title, t.line, `引数のあるラベル「${t.name}」に、goto を通らずに入る経路がある（${byId.get(e.from).title} の末尾から流れ込む）`);
  }

  const reached = new Set([g.entry.id]);
  const queue = [g.entry.id];
  while (queue.length) for (const t of next.get(queue.shift())) if (!reached.has(t)) { reached.add(t); queue.push(t); }
  for (const s of g.segments) if (!reached.has(s.id)) add('注意', f.name, s.title, s.line, '関数の先頭からたどり着かない');

  // 関数の終わりまで return せずに届くのに、戻り値の型が void でない
  const endEdges = g.edges.filter(e => e.to === 'T:end' && reached.has(e.from));
  if (endEdges.length && f.returnType && !VOID_TYPES.test(f.returnType)) {
    const s = byId.get(endEdges[0].from);
    add('エラー', f.name, s.title, s.endLine, `関数の終わりまで return せずに届く経路がある（戻り値の型は ${f.returnType}）`);
  }

  // 終わり（return・throw・関数の終わり）にたどり着けないステップ
  const prev = new Map(g.segments.map(s => [s.id, []]));
  for (const [from, tos] of next) for (const t of tos) prev.get(t).push(from);
  const canEnd = new Set(g.segments.filter(s => s.returns.length || s.throws.length || g.edges.some(e => e.from === s.id && e.to.startsWith('T:'))).map(s => s.id));
  const back = [...canEnd];
  while (back.length) for (const p of prev.get(back.shift())) if (!canEnd.has(p)) { canEnd.add(p); back.push(p); }
  for (const s of g.segments) if (reached.has(s.id) && !canEnd.has(s.id)) add('注意', f.name, s.title, s.line, '終わり（return・throw・関数の終わり）にたどり着く経路が無い');

  // 上限の見当たらない繰り返し：回数を数えて比べる変数が、繰り返しの中に無い
  const ids = g.segments.map(s => s.id);
  const cycles = simpleCycles(ids, next, 400).sort((a, b) => a.length - b.length);
  const reported = [];
  for (const c of cycles) {
    const members = c.map(id => byId.get(id));
    const incs = new Set(members.flatMap(m => m.incs));
    const conds = new Set(members.flatMap(m => m.condVars));
    if ([...incs].some(v => conds.has(v))) continue;
    const set = new Set(c);
    if (reported.some(r => [...r].every(n => set.has(n)))) continue;
    reported.push(set);
    const path = [...members, members[0]].map(m => m.title).join(' → ');
    add('注意', f.name, members[0].title, members[0].line, `上限の見当たらない繰り返しがある：${path}（回数を数えて上限と比べる変数が無い）`);
  }
}

// 単純な閉路を列挙する（ステップ数は少ないので、上限付きの深さ優先で足りる）
function simpleCycles(ids, next, limit) {
  const index = new Map(ids.map((n, i) => [n, i]));
  const out = [];
  for (let s = 0; s < ids.length && out.length < limit; s++) {
    const start = ids[s];
    const stack = [start];
    const onPath = new Set([start]);
    const dfs = u => {
      for (const v of next.get(u)) {
        if (out.length >= limit) return;
        if (v === start) out.push([...stack]);
        else if (index.get(v) > s && !onPath.has(v)) {
          stack.push(v);
          onPath.add(v);
          dfs(v);
          stack.pop();
          onPath.delete(v);
        }
      }
    };
    dfs(start);
  }
  return out;
}
