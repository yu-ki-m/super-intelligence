// 検査の結果とフローの図を、1つの HTML にまとめる。外部の CDN やライブラリは使わない。

import fs from 'node:fs';
import { flowGraph, condFull, edgeLabel, edgeConds } from './graph.mjs';
import { layout } from './layout.mjs';

const WHO = { model: 'AI', tool: 'ツール', human: '人', subflow: 'サブフロー', unknown: '不明' };
const NODE_W = 330;
const HEAD_H = 30;
const PAD = 10;
const INDENT = 14;
const BADGE_W = 52;
const MAX_ROWS = 36;

const here = new URL('.', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here), 'utf8');

export function renderHtml({ model, findings, title, typecheck, diff }) {
  const flows = model.functions.filter(f => f.isFlow);
  const views = flows.map((f, fi) => buildView(model, f, fi, findings, diff, flows));
  const counts = countWorks(flows);
  const errors = findings.filter(x => x.severity === 'エラー').length;
  const warns = findings.filter(x => x.severity === '注意').length;
  const data = {
    title,
    views: views.map(v => v.data),
    diffRows: diff?.rows ?? null,
  };
  const tc = typecheck.ran
    ? `済み（エラー ${typecheck.errors.length}）`
    : `していない（${typecheck.reason}）`;
  const chips = [
    `<span class="chip">フロー関数 ${flows.length}</span>`,
    `<span class="chip">ステップ ${views.reduce((s, v) => s + v.stepCount, 0)}</span>`,
    `<span class="chip">作業 ${['model', 'tool', 'human', 'subflow'].map(w => `<span class="who who-${w}">${WHO[w]}</span> ${counts[w] ?? 0}`).join(' ')}</span>`,
    `<span class="chip ${errors ? 'bad' : ''}">エラー ${errors}</span>`,
    `<span class="chip ${warns ? 'warnc' : ''}">注意 ${warns}</span>`,
    `<span class="chip">型検査 ${esc(tc)}</span>`,
    diff ? `<span class="chip">変更 ${diff.rows.length}</span>` : '',
  ].join('');

  const tabs = views.length > 1
    ? `<nav class="tabs">${views.map((v, i) => `<button type="button" class="tab${i ? '' : ' on'}" data-fn="${i}">${esc(v.name)}<span class="n">${v.stepCount}</span></button>`).join('')}</nav>`
    : '';

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${read('style.css')}</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <div class="chips">${chips}</div>
</header>
${tabs}
<main class="split">
  <section class="diagram" aria-label="フローの図">
    <div class="toolbar">
      <button type="button" data-act="fit">全体を表示</button>
      <button type="button" data-act="width">幅に合わせる</button>
      <button type="button" data-act="in" aria-label="拡大">＋</button>
      <button type="button" data-act="out" aria-label="縮小">－</button>
      <span class="hint">ドラッグで移動、Ctrl＋ホイールで拡大・縮小、ノードを押すと詳細</span>
    </div>
    ${views.map((v, i) => `<div class="canvas${i ? ' hidden' : ''}" data-fn="${i}">${v.svg}</div>`).join('\n')}
    <div class="legend">
      <span><span class="who who-model">AI</span> モデル</span>
      <span><span class="who who-tool">ツール</span> ツール</span>
      <span><span class="who who-human">人</span> 人の判断</span>
      <span><span class="who who-subflow">サブフロー</span> 別のフロー関数</span>
      <span><svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" class="lg-goto"/></svg> goto</span>
      <span><svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" class="lg-next"/></svg> 次へ進む</span>
      <span><svg width="34" height="10"><line x1="0" y1="5" x2="34" y2="5" class="lg-back"/></svg> 戻る（繰り返し）</span>
      <span><span class="box-sample anon"></span> ラベルの外の文</span>
      <span><span class="box-sample err"></span> エラー</span>
      <span><span class="box-sample warn"></span> 注意</span>
      ${diff ? '<span><span class="box-sample add"></span> 追加</span><span><span class="box-sample chg"></span> 変更</span>' : ''}
    </div>
  </section>
  <aside class="detail" id="detail" aria-live="polite"></aside>
</main>
<section class="tables">
  <h2>ステップ</h2>
  ${views.map((v, i) => `<div class="steps-table${i ? ' hidden' : ''}" data-fn="${i}">${v.table}</div>`).join('\n')}
  <h2>検査の結果</h2>
  ${findingsTable(findings)}
  ${diff ? `<h2>変更</h2>${diffTable(diff.rows)}` : ''}
</section>
<script type="application/json" id="flow-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>${read('client.js')}</script>
</body>
</html>
`;
}

function countWorks(flows) {
  const c = {};
  for (const f of flows) for (const s of f.segments) for (const it of s.items) {
    const who = it.kind === 'subflow' ? 'subflow' : it.kind === 'helper' ? 'tool' : it.who;
    c[who] = (c[who] ?? 0) + 1;
  }
  return c;
}

function itemInfo(model, it) {
  if (it.kind === 'perform') {
    return { who: it.who, text: it.instruction || '（指示なし）', cap: it.cap, outType: it.type, input: it.input, line: it.line, parallel: it.parallel, exprInstr: !it.instructionIsText };
  }
  if (it.kind === 'helper') {
    const works = model.helperWorks[it.helper] ?? [];
    const caps = [...new Set(works.map(w => w.cap).filter(Boolean))];
    return { who: works[0]?.who ?? 'unknown', text: `${it.helper}：${it.summary}`, cap: caps.join('・') || null, input: it.input, line: it.line, parallel: it.parallel, helper: it.helper, helperInstr: works.map(w => w.instruction) };
  }
  return { who: 'subflow', text: `${it.target} を実行する`, target: it.target, input: it.input, line: it.line, parallel: it.parallel };
}

function buildView(model, f, fi, findings, diff, flows) {
  const g = flowGraph(f);
  const segs = g.segments;
  const titles = new Map(segs.map(s => [s.id, s.title]));
  for (const t of g.terminals) titles.set(t.id, termTitle(t));
  const fnFindings = findings.filter(x => x.fn === f.name);
  const segOfLine = line => segs.find(s => line >= s.line && line <= s.endLine);
  const findingsOf = s => fnFindings.filter(x => x.step === s.title || (!x.step && x.line && segOfLine(x.line) === s));
  const d = diff?.byFn?.[f.name];
  const diffOf = s => (d?.added.includes(s.id) ? 'added' : d?.changed.includes(s.id) ? 'changed' : null);

  // ノードの中身を決めて大きさを測る
  const nodes = [];
  const order = g.entry ? [g.entry, ...segs.filter(s => s !== g.entry)] : segs;
  for (const s of order) {
    const rows = s.rows.map(r => rowInfo(model, r));
    const shown = rows.slice(0, MAX_ROWS);
    const lines = shown.map(r => measureRow(r));
    const extra = rows.length - shown.length;
    let h = HEAD_H + 6 + lines.reduce((sum, r) => sum + r.h, 0) + (extra > 0 ? 18 : 0) + 8;
    if (!rows.length) h = HEAD_H + 26;
    const fs_ = findingsOf(s);
    nodes.push({
      id: s.id,
      w: NODE_W,
      h,
      seg: s,
      rows: lines,
      extra,
      sev: fs_.some(x => x.severity === 'エラー') ? 'err' : fs_.length ? 'warn' : '',
      diff: diffOf(s),
      entry: s === g.entry,
    });
  }
  for (const t of g.terminals) {
    const label = termTitle(t);
    nodes.push({ id: t.id, w: Math.max(130, textWidth(label, 12.5) + 36), h: 34, term: t, label });
  }
  const edges = g.edges.map(e => ({ ...e, label: edgeLabel(e.conds) }));
  const L = layout(nodes.map(n => ({ id: n.id, w: n.w, h: n.h })), edges);

  // 詳細の表示に使うデータ
  const incoming = new Map();
  for (const e of edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push({ id: e.from, title: titles.get(e.from), kind: e.kind, cond: edgeConds(e).join(' / ') });
  }
  const detailNodes = {};
  for (const n of nodes) {
    if (n.term) {
      detailNodes[n.id] = { id: n.id, title: n.label, kind: 'term', incoming: incoming.get(n.id) ?? [] };
      continue;
    }
    const s = n.seg;
    detailNodes[n.id] = {
      id: s.id,
      title: s.title,
      kind: s.kind,
      note: s.note,
      line: s.line,
      endLine: s.endLine,
      entry: n.entry,
      rows: s.rows.map(r => rowInfo(model, r, true)),
      exits: edges.filter(e => e.from === s.id).map(e => ({ kind: e.kind, to: e.to, toTitle: titles.get(e.to), conds: edgeConds(e), lines: e.lines })),
      throws: s.throws.map(t => ({ expr: t.expr, cond: condFull(t.conds), line: t.line })),
      incoming: incoming.get(s.id) ?? [],
      findings: findingsOf(s).map(x => ({ severity: x.severity, message: x.message, line: x.line })),
      code: model.lines.slice(s.line - 1, s.endLine).map((text, i) => [s.line + i, text]),
      diff: n.diff,
    };
  }

  const calls = [...new Set(f.segments.flatMap(s => s.items.filter(i => i.kind === 'subflow').map(i => i.target)))];
  const calledBy = flows.filter(o => o !== f && o.segments.some(s => s.items.some(i => i.kind === 'subflow' && i.target === f.name))).map(o => o.name);
  const caps = new Map();
  const who = {};
  for (const s of f.segments) for (const it of s.items) {
    const info = itemInfo(model, it);
    who[info.who] = (who[info.who] ?? 0) + 1;
    if (info.cap) for (const c of info.cap.split('・')) caps.set(c, (caps.get(c) ?? 0) + 1);
  }
  const overview = {
    name: f.name,
    signature: `${f.exported ? 'export ' : ''}${f.isAsync ? 'async ' : ''}function ${f.name}(${f.params})${f.returnType ? `: ${f.returnType}` : ''}`,
    line: f.line,
    decls: f.topDecls.map(x => ({ text: x.text, line: x.line })),
    who,
    caps: [...caps].sort((a, b) => b[1] - a[1]),
    calls,
    calledBy,
    findings: fnFindings.filter(x => !x.step && !(x.line && segOfLine(x.line))).map(x => ({ severity: x.severity, message: x.message, line: x.line })),
    stepCount: segs.length,
  };

  return {
    name: f.name,
    stepCount: segs.length,
    svg: svgOf(fi, L, nodes, edges),
    table: stepsTable(model, order, edges, titles, findingsOf, diffOf),
    data: { name: f.name, overview, nodes: detailNodes, entry: g.entry?.id ?? null, width: L.width, height: L.height },
  };
}

function termTitle(t) { return t.kind === 'end' ? '関数の終わり' : `終了：${t.label}`; }

function rowInfo(model, r, full) {
  if (r.type === 'work') return { type: 'work', depth: r.depth, ...itemInfo(model, r.item) };
  if (r.type === 'exit') {
    return r.kind === 'goto'
      ? { type: 'exit', depth: r.depth, kind: 'goto', text: `→ ${r.target}${r.args?.length ? `(${r.args.join(', ')})` : ''} へ`, target: r.target, args: r.args ?? [], line: r.line }
      : { type: 'exit', depth: r.depth, kind: 'return', text: `→ 終了：${r.label}`, line: r.line };
  }
  if (r.type === 'param') return { type: 'param', depth: r.depth, text: r.text, line: r.line };
  if (r.type === 'note') return { type: 'note', depth: r.depth, text: full ? r.text : `※ ${r.text.split('\n')[0]}`, line: r.line };
  return { type: 'cond', depth: r.depth, text: r.text, line: r.line };
}

function measureRow(r) {
  const indent = PAD + Math.min(r.depth, 6) * INDENT;
  if (r.type === 'work') {
    const x = indent + BADGE_W + 6;
    const lines = wrap(r.parallel ? `並行：${r.text}` : r.text, NODE_W - x - PAD, 12, 2);
    return { ...r, x: indent, tx: x, lines, h: Math.max(20, lines.length * 16 + 4) };
  }
  const size = r.type === 'note' ? 11 : r.type === 'param' ? 11.5 : 12;
  const lines = wrap(r.text, NODE_W - indent - PAD, size, 1);
  return { ...r, x: indent, tx: indent, lines, h: 18 };
}

function svgOf(fi, L, nodes, edges) {
  const out = [];
  out.push(`<svg class="flow" xmlns="http://www.w3.org/2000/svg" data-w="${Math.ceil(L.width)}" data-h="${Math.ceil(L.height)}" viewBox="0 0 ${Math.ceil(L.width)} ${Math.ceil(L.height)}">`);
  out.push('<defs>');
  for (const [name, cls] of [['a', 'm-goto'], ['b', 'm-back'], ['h', 'm-hl'], ['n', 'm-next']]) {
    out.push(`<marker id="m${name}${fi}" class="${cls}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker>`);
  }
  out.push('</defs>');
  const placed = [];
  for (const n of nodes) { const p = L.nodes.get(n.id); placed.push([p.x - 2, p.y - 2, p.x + p.w + 2, p.y + p.h + 2]); }

  out.push('<g class="edges">');
  const labels = [];
  L.edges.forEach((e, i) => {
    const src = edges[e.k];
    const cls = `edge kind-${src.kind}${e.back ? ' back' : ''}`;
    const marker = e.back ? 'b' : src.kind === 'next' ? 'n' : 'a';
    const tip = edgeConds(src).join(' / ');
    out.push(`<g class="${cls}" data-from="${attr(src.from)}" data-to="${attr(src.to)}" data-i="${i}"><path class="line" d="${e.d}" marker-end="url(#m${marker}${fi})" data-marker="${marker}"/><path class="hit" d="${e.d}"/><title>${esc(tip)}</title></g>`);
    if (src.label) labels.push({ e, src, i });
  });
  out.push('</g>');

  out.push('<g class="nodes">');
  for (const n of nodes) {
    const p = L.nodes.get(n.id);
    if (n.term) {
      out.push(`<g class="node term kind-${n.term.kind}" data-id="${attr(n.id)}" transform="translate(${r1(p.x)},${r1(p.y)})"><rect class="box" width="${r1(p.w)}" height="${p.h}" rx="${p.h / 2}"/><text class="term-t" x="${r1(p.w / 2)}" y="21" text-anchor="middle">${esc(n.label)}</text><title>${esc(n.label)}</title></g>`);
      continue;
    }
    const s = n.seg;
    const cls = ['node', 'seg', s.kind !== 'label' ? 'anon' : '', n.entry ? 'entry' : '', n.sev ? `sev-${n.sev}` : '', n.diff ? `diff-${n.diff}` : ''].filter(Boolean).join(' ');
    const parts = [];
    parts.push(`<rect class="box" width="${n.w}" height="${r1(n.h)}" rx="8"/>`);
    parts.push(`<path class="head" d="M0,8 a8,8 0 0 1 8,-8 h${n.w - 16} a8,8 0 0 1 8,8 v${HEAD_H - 8} h-${n.w} z"/>`);
    const badges = [];
    if (n.entry) badges.push(['開始', 'b-entry']);
    if (s.throws.length) badges.push([`例外 ${s.throws.length}`, 'b-throw']);
    if (n.diff) badges.push([n.diff === 'added' ? '追加' : '変更', `b-${n.diff}`]);
    let bx = n.w - PAD;
    const badgeSvg = [];
    for (const [text, bc] of badges.reverse()) {
      const w = textWidth(text, 11) + 12;
      bx -= w;
      badgeSvg.push(`<g class="badge ${bc}"><rect x="${r1(bx)}" y="7" width="${r1(w)}" height="17" rx="8"/><text x="${r1(bx + w / 2)}" y="19.5" text-anchor="middle">${esc(text)}</text></g>`);
      bx -= 4;
    }
    const titleText = truncate(s.title, bx - PAD - 4, 13.5);
    parts.push(`<text class="title" x="${PAD}" y="20">${esc(titleText)}</text>`, ...badgeSvg);
    let y = HEAD_H + 6;
    for (const r of n.rows) {
      if (r.type === 'work') {
        parts.push(`<rect class="who-b who-${r.who}" x="${r.x}" y="${y + 2}" width="${BADGE_W}" height="16" rx="3"/><text class="who-t" x="${r.x + BADGE_W / 2}" y="${y + 14}" text-anchor="middle">${esc(WHO[r.who] ?? r.who)}</text>`);
        parts.push(`<text class="row work" x="${r.tx}" y="${y + 14}">${r.lines.map((l, i) => `<tspan x="${r.tx}" dy="${i ? 16 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
      } else {
        const cls2 = r.type === 'exit' ? `row exit exit-${r.kind}` : `row ${r.type}`;
        parts.push(`<text class="${cls2}" x="${r.tx}" y="${y + 13}">${esc(r.lines[0] ?? '')}</text>`);
      }
      y += r.h;
    }
    if (n.extra > 0) parts.push(`<text class="row more" x="${PAD}" y="${y + 13}">…ほか ${n.extra} 行（押すと詳細に出る）</text>`);
    if (!n.rows.length) parts.push(`<text class="row note" x="${PAD}" y="${HEAD_H + 18}">（作業・分岐なし）</text>`);
    const tip = [s.title, s.note].filter(Boolean).join('\n');
    out.push(`<g class="${cls}" data-id="${attr(s.id)}" transform="translate(${r1(p.x)},${r1(p.y)})">${parts.join('')}<title>${esc(tip)}</title></g>`);
  }
  out.push('</g>');

  // 矢印の条件。ノードやほかの条件と重ならない場所を探して置く
  out.push('<g class="labels">');
  for (const { e, src, i } of labels) {
    const text = truncateChars(src.label, 26);
    const w = textWidth(text, 11) + 10;
    const h = 16;
    const cands = [];
    if (e.back) {
      const [[ax, ay], [bx2]] = e.first;
      for (const t of [0, 0.25, 0.5]) cands.push([ax + 4 + (bx2 - ax) * t, ay - h / 2]);
    } else {
      const [[ax, ay], [bx2, by]] = e.first;
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const [px, py] = bezierPoint(ax, ay, bx2, by, t);
        cands.push([px - w / 2, py - h / 2]);
      }
    }
    let at = cands[0];
    for (const c of cands) {
      const box = [c[0], c[1], c[0] + w, c[1] + h];
      if (!placed.some(b => overlap(b, box))) { at = c; break; }
    }
    placed.push([at[0], at[1], at[0] + w, at[1] + h]);
    out.push(`<g class="elabel${e.back ? ' back' : ''}" data-i="${i}"><rect x="${r1(at[0])}" y="${r1(at[1])}" width="${r1(w)}" height="${h}" rx="4"/><text x="${r1(at[0] + 5)}" y="${r1(at[1] + 12)}">${esc(text)}</text><title>${esc(edgeConds(src).join(' / '))}</title></g>`);
  }
  out.push('</g></svg>');
  return out.join('');
}

function stepsTable(model, order, edges, titles, findingsOf, diffOf) {
  const rows = order.map(s => {
    const works = s.items.map(it => {
      const info = itemInfo(model, it);
      const cond = condFull(it.conds);
      return `<div class="cell-line"${cond !== '条件なし' ? ` title="${attr(`条件：${cond}`)}"` : ''}><span class="who who-${info.who}">${esc(WHO[info.who] ?? info.who)}</span> ${info.parallel ? '並行：' : ''}${esc(info.text)}${info.cap ? ` <span class="cap">${esc(info.cap)}</span>` : ''}</div>`;
    }).join('') || '<div class="muted">なし</div>';
    const exits = edges.filter(e => e.from === s.id).map(e => {
      const cond = edgeConds(e).join(' / ');
      const kind = e.kind === 'goto' ? 'goto' : e.kind === 'next' ? '次へ' : '終了';
      return `<div class="cell-line"><span class="ek ek-${e.kind}">${kind}</span> ${esc(titles.get(e.to) ?? e.to)}${cond !== '条件なし' ? `<span class="muted">（${esc(cond)}）</span>` : ''}</div>`;
    }).join('') || '<div class="muted">なし</div>';
    const fs_ = findingsOf(s).map(x => `<div class="cell-line sev-${x.severity === 'エラー' ? 'err' : 'warn'}">${esc(x.severity)}：${esc(x.message)}</div>`).join('');
    const df = diffOf(s);
    return `<tr data-id="${attr(s.id)}"><td class="name">${esc(s.title)}${df ? ` <span class="badge-inline b-${df}">${df === 'added' ? '追加' : '変更'}</span>` : ''}<div class="muted">${s.line}〜${s.endLine} 行</div></td><td>${works}</td><td>${exits}</td><td>${fs_ || '<div class="muted">なし</div>'}</td></tr>`;
  }).join('');
  return `<table class="grid"><thead><tr><th class="c-name">ステップ</th><th>作業</th><th>行き先</th><th class="c-check">検査</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function findingsTable(findings) {
  if (!findings.length) return '<p class="muted">エラーも注意も無い。</p>';
  const sorted = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'エラー' ? -1 : 1) || (a.line ?? 0) - (b.line ?? 0));
  const rows = sorted.map(x => `<tr><td class="sev-${x.severity === 'エラー' ? 'err' : 'warn'}">${esc(x.severity)}</td><td>${esc(x.fn || '（ファイル全体）')}</td><td>${esc(x.step || '')}</td><td class="num">${x.line ?? ''}</td><td>${esc(x.message)}</td></tr>`).join('');
  return `<table class="grid"><thead><tr><th class="c-sev">重さ</th><th class="c-fn">関数</th><th class="c-step">ステップ</th><th class="c-line">行</th><th>内容</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function diffTable(rows) {
  if (!rows.length) return '<p class="muted">ステップの増減と変更は無い。</p>';
  const body = rows.map(r => `<tr><td class="kind-${r.kind}">${esc(r.kind)}</td><td>${esc(r.fn)}</td><td>${esc(r.step)}</td><td>${r.text.split('\n').map(l => `<div class="cell-line">${esc(l)}</div>`).join('')}</td></tr>`).join('');
  return `<table class="grid"><thead><tr><th class="c-sev">種類</th><th class="c-fn">関数</th><th class="c-step">ステップ</th><th>内容</th></tr></thead><tbody>${body}</tbody></table>`;
}

function bezierPoint(ax, ay, bx, by, t) {
  const my = (ay + by) / 2;
  const p0 = [ax, ay];
  const p1 = [ax, my];
  const p2 = [bx, my];
  const p3 = [bx, by];
  const u = 1 - t;
  return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
}

function overlap(a, b) { return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }

function charW(ch, size) {
  const c = ch.codePointAt(0);
  if ((c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x3000 && c <= 0x303f)) return size;
  if (/[A-Z0-9@#%&mwMW]/.test(ch)) return size * 0.66;
  if (/[il.,:;'|!]/.test(ch)) return size * 0.32;
  return size * 0.56;
}

export function textWidth(s, size) { let w = 0; for (const ch of s) w += charW(ch, size); return w; }

function wrap(text, maxW, size, maxLines) {
  const lines = [];
  let cur = '';
  let w = 0;
  const chars = [...text.replace(/\s+/g, ' ')];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cw = charW(ch, size);
    if (w + cw > maxW && cur) {
      lines.push(cur);
      cur = '';
      w = 0;
      if (lines.length === maxLines) {
        lines[maxLines - 1] = truncate(`${lines[maxLines - 1]}${chars.slice(i).join('')}`, maxW, size);
        return lines;
      }
      if (ch === ' ') continue;
    }
    cur += ch;
    w += cw;
  }
  if (cur) lines.push(cur);
  return lines;
}

function truncate(text, maxW, size) {
  if (textWidth(text, size) <= maxW) return text;
  let out = '';
  let w = charW('…', size);
  for (const ch of text) {
    const cw = charW(ch, size);
    if (w + cw > maxW) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}

function truncateChars(text, n) { const a = [...text]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : text; }

function r1(n) { return Math.round(n * 10) / 10; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function attr(s) { return esc(s); }
