// フロー関数のステップ（ラベル付きブロックと、ラベルの外の文のまとまり）のつながりを組み立てる。
// つながりは3種類：goto、末尾まで進んだときの次のステップ（next）、終わり（return・関数の終わり）。

export function flowGraph(f) {
  const segs = f.segments;
  const labelSeg = new Map(segs.filter(s => s.kind === 'label').map(s => [s.name, s]));
  const nextVisible = i => {
    for (let j = i + 1; j < segs.length; j++) if (!segs[j].transparent) return segs[j];
    return null;
  };
  const visible = segs.filter(s => !s.transparent);
  const entry = segs.length ? (segs[0].transparent ? nextVisible(0) : segs[0]) : null;
  const edges = [];
  const terminals = new Map();
  const term = (id, label, kind) => { if (!terminals.has(id)) terminals.set(id, { id, label, kind }); return id; };

  segs.forEach((s, i) => {
    if (s.transparent) return;
    const byTarget = new Map();
    for (const g of s.gotos) {
      if (!labelSeg.has(g.target)) continue;
      if (!byTarget.has(g.target)) byTarget.set(g.target, []);
      byTarget.get(g.target).push(g);
    }
    for (const [t, gs] of byTarget) {
      edges.push({ kind: 'goto', from: s.id, to: labelSeg.get(t).id, conds: gs.map(g => g.conds), lines: gs.map(g => g.line), args: gs.map(g => g.args ?? []) });
    }
    if (!s.terminates) {
      const n = nextVisible(i);
      edges.push({ kind: 'next', from: s.id, to: n ? n.id : term('T:end', '関数の終わり', 'end'), conds: [[]], lines: [s.endLine] });
    }
    const byLabel = new Map();
    for (const r of s.returns) {
      if (!byLabel.has(r.label)) byLabel.set(r.label, []);
      byLabel.get(r.label).push(r);
    }
    for (const [label, rs] of byLabel) {
      edges.push({ kind: 'return', from: s.id, to: term(`T:${label}`, label, 'return'), conds: rs.map(r => r.conds), lines: rs.map(r => r.line) });
    }
  });
  return { entry, segments: visible, edges, terminals: [...terminals.values()] };
}

// 同じ行き先への複数の goto の条件を、1つのラベルにまとめる（「種類 が "a" / 種類 が "b"」→「種類 が "a" / "b"」）
export function edgeLabel(condsList) {
  const labels = [...new Set(condsList.map(condLabel).filter(Boolean))];
  if (labels.length !== condsList.length) return labels.join(' / ');
  const parts = labels.map(l => /^(.+?) が (.+)$/.exec(l));
  if (parts.length > 1 && parts.every(p => p && p[1] === parts[0][1])) return `${parts[0][1]} が ${parts.map(p => p[2]).join(' / ')}`;
  return labels.join(' / ');
}

// 条件の並びを、図の矢印に添える短い文にする
export function condLabel(conds) {
  const own = conds.filter(c => c.kind !== 'after');
  if (!own.length) return conds.some(c => c.kind === 'after' && !c.guard) ? 'それ以外' : '';
  return own.map(condText).join(' かつ ');
}

export function condText(c) {
  switch (c.kind) {
    case 'if': return c.text;
    case 'else': return `${c.text} でない`;
    case 'after': return `${c.text} でない`;
    case 'case': return `${shortDisc(c.disc)} が ${c.tests.join(' / ')}`;
    case 'default': return `${shortDisc(c.disc)} がそれ以外`;
    case 'loop': return `繰り返し中（${c.text}）`;
    case 'catch': return '例外が起きたとき';
    default: return '';
  }
}

// 矢印1本ぶんの条件を、goto で渡す値と合わせて並べる（詳細と表に使う）
export function edgeConds(e) {
  return e.conds.map((c, i) => {
    const args = e.args?.[i] ?? [];
    return args.length ? `${condFull(c)}　渡す値：${args.join('、')}` : condFull(c);
  });
}

// 省略せずに全部の条件を並べる（詳細の表示に使う）
export function condFull(conds) {
  const shown = conds.filter(c => !c.guard);
  return shown.length ? shown.map(condText).filter(Boolean).join(' かつ ') : '条件なし';
}

function shortDisc(disc) {
  const parts = disc.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : disc;
}
