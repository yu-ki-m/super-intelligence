// 有向グラフを上から下へ並べる（層に分けて並べる方法の簡易版）。
// 1. 深さ優先で戻る矢印（繰り返し）を見分ける  2. 残りの矢印で層を決める  3. 層をまたぐ矢印に中継点を置く
// 4. 交差が減るように層の中の順番を並べ替える  5. 横位置をつながる先の中央へ寄せる  6. 矢印の通り道を作る

const GAP_X = 44;
const GAP_Y = 70;
const DUMMY_W = 12;
const MARGIN = 24;

export function layout(nodes, edges) {
  const ids = nodes.map(n => n.id);
  const N = new Map(nodes.map((n, i) => [n.id, { ...n, order0: i }]));
  const E = edges.map((e, k) => ({ ...e, k })).filter(e => N.has(e.from) && N.has(e.to));
  const out = new Map(ids.map(id => [id, []]));
  for (const e of E) out.get(e.from).push(e);

  // 1. 戻る矢印
  const state = new Map();
  const disc = new Map();
  let t = 0;
  const back = new Set();
  const visit = u => {
    state.set(u, 1);
    disc.set(u, t++);
    for (const e of out.get(u)) {
      const s = state.get(e.to);
      if (e.to === u || s === 1) back.add(e.k);
      else if (!s) visit(e.to);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);

  // 2. 層（最長経路）
  const fwd = E.filter(e => !back.has(e.k));
  const indeg = new Map(ids.map(id => [id, 0]));
  const fo = new Map(ids.map(id => [id, []]));
  for (const e of fwd) { indeg.set(e.to, indeg.get(e.to) + 1); fo.get(e.from).push(e); }
  const rank = new Map(ids.map(id => [id, 0]));
  const queue = ids.filter(id => indeg.get(id) === 0);
  while (queue.length) {
    const u = queue.shift();
    for (const e of fo.get(u)) {
      rank.set(e.to, Math.max(rank.get(e.to), rank.get(u) + 1));
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  const R = Math.max(0, ...rank.values()) + 1;

  // 3. 中継点
  const layers = Array.from({ length: R }, () => []);
  const V = new Map();
  for (const id of ids) {
    const v = { id, w: N.get(id).w, h: N.get(id).h, layer: rank.get(id), dummy: false, key: disc.get(id) ?? N.get(id).order0 };
    V.set(id, v);
    layers[v.layer].push(v);
  }
  const chains = new Map();
  for (const e of fwd) {
    const a = rank.get(e.from);
    const b = rank.get(e.to);
    const chain = [e.from];
    for (let r = a + 1; r < b; r++) {
      const vid = `d:${e.k}:${r}`;
      const v = { id: vid, w: DUMMY_W, h: 0, layer: r, dummy: true, key: V.get(e.from).key + 0.5 };
      V.set(vid, v);
      layers[r].push(v);
      chain.push(vid);
    }
    chain.push(e.to);
    chains.set(e.k, chain);
  }
  const up = new Map([...V.keys()].map(k => [k, []]));
  const down = new Map([...V.keys()].map(k => [k, []]));
  for (const chain of chains.values()) {
    for (let i = 0; i + 1 < chain.length; i++) { down.get(chain[i]).push(chain[i + 1]); up.get(chain[i + 1]).push(chain[i]); }
  }

  // 4. 層の中の順番
  for (const L of layers) { L.sort((p, q) => p.key - q.key); L.forEach((v, i) => { v.pos = i; }); }
  const crossings = () => {
    let c = 0;
    for (let r = 0; r + 1 < R; r++) {
      const segs = [];
      for (const v of layers[r]) for (const w of down.get(v.id)) segs.push([v.pos, V.get(w).pos]);
      for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
        if ((segs[i][0] - segs[j][0]) * (segs[i][1] - segs[j][1]) < 0) c++;
      }
    }
    return c;
  };
  let best = crossings();
  let bestOrder = layers.map(L => L.map(v => v.id));
  for (let it = 0; it < 16 && best > 0; it++) {
    const downward = it % 2 === 0;
    const seq = downward ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const L of seq) {
      const nb = downward ? up : down;
      const bary = new Map(L.map(v => {
        const ns = nb.get(v.id);
        return [v, ns.length ? ns.reduce((s, n) => s + V.get(n).pos, 0) / ns.length : v.pos];
      }));
      L.sort((p, q) => bary.get(p) - bary.get(q) || p.pos - q.pos);
      L.forEach((v, i) => { v.pos = i; });
    }
    const c = crossings();
    if (c < best) { best = c; bestOrder = layers.map(L => L.map(v => v.id)); }
  }
  bestOrder.forEach((order, r) => {
    layers[r] = order.map(id => V.get(id));
    layers[r].forEach((v, i) => { v.pos = i; });
  });

  // 5. 横位置
  const gapOf = (a, b) => (a.dummy || b.dummy ? 18 : GAP_X);
  for (const L of layers) {
    let x = 0;
    L.forEach((v, i) => { if (i) x += gapOf(L[i - 1], v); v.x = x; x += v.w; });
  }
  const center = v => v.x + v.w / 2;
  const resolve = (L, want) => {
    const n = L.length;
    const a = want.slice();
    for (let i = 1; i < n; i++) a[i] = Math.max(a[i], a[i - 1] + L[i - 1].w + gapOf(L[i - 1], L[i]));
    const b = want.slice();
    for (let i = n - 2; i >= 0; i--) b[i] = Math.min(b[i], b[i + 1] - L[i].w - gapOf(L[i], L[i + 1]));
    const z = a.map((ai, i) => (ai + b[i]) / 2);
    for (let i = 1; i < n; i++) z[i] = Math.max(z[i], z[i - 1] + L[i - 1].w + gapOf(L[i - 1], L[i]));
    L.forEach((v, i) => { v.x = z[i]; });
  };
  for (let it = 0; it < 10; it++) {
    const downward = it % 2 === 0;
    const seq = downward ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const L of seq) {
      const nb = downward ? up : down;
      resolve(L, L.map(v => {
        const ns = nb.get(v.id);
        if (!ns.length) return v.x;
        return ns.reduce((s, n) => s + center(V.get(n)), 0) / ns.length - v.w / 2;
      }));
    }
  }
  const minX = Math.min(...[...V.values()].map(v => v.x));
  for (const v of V.values()) v.x += MARGIN - minX;

  // 縦位置
  const layerH = layers.map(L => Math.max(0, ...L.filter(v => !v.dummy).map(v => v.h)));
  const layerY = [];
  let y = MARGIN;
  for (let r = 0; r < R; r++) { layerY[r] = y; y += layerH[r] + GAP_Y; }
  for (const v of V.values()) v.y = layerY[v.layer];
  let right = Math.max(...[...V.values()].map(v => v.x + v.w));

  // 6. 矢印の通り道。出口と入口を、つながる先の横位置の順に並べる
  const backEdges = E.filter(e => back.has(e.k)).sort((p, q) => (rank.get(p.from) - rank.get(p.to)) - (rank.get(q.from) - rank.get(q.to)));
  const laneX = new Map();
  backEdges.forEach((e, i) => laneX.set(e.k, right + 28 + i * 14));
  const portsOut = new Map(ids.map(id => [id, []]));
  const portsIn = new Map(ids.map(id => [id, []]));
  for (const e of E) {
    if (back.has(e.k)) {
      portsOut.get(e.from).push({ k: e.k, x: laneX.get(e.k) });
      portsIn.get(e.to).push({ k: e.k, x: laneX.get(e.k) });
    } else {
      const chain = chains.get(e.k);
      portsOut.get(e.from).push({ k: e.k, x: center(V.get(chain[1])) });
      portsIn.get(e.to).push({ k: e.k, x: center(V.get(chain[chain.length - 2])) });
    }
  }
  const portX = new Map();
  for (const [id, list] of portsOut) assignPorts(V.get(id), list, 'out', portX);
  for (const [id, list] of portsIn) assignPorts(V.get(id), list, 'in', portX);

  const paths = new Map();
  for (const e of E) {
    const u = V.get(e.from);
    const w = V.get(e.to);
    const x0 = portX.get(`out:${e.k}`);
    const x1 = portX.get(`in:${e.k}`);
    const y0 = u.y + u.h;
    const y1 = w.y;
    if (back.has(e.k)) {
      const lane = laneX.get(e.k);
      const idx = backEdges.findIndex(b => b.k === e.k);
      const yA = layerY[u.layer] + layerH[u.layer] + 14 + (idx % 3) * 7;
      const yB = layerY[w.layer] - 14 - (idx % 3) * 7;
      const pts = [[x0, y0], [x0, yA], [lane, yA], [lane, yB], [x1, yB], [x1, y1]];
      paths.set(e.k, { d: roundedPath(pts, 8), back: true, first: [[x0, yA], [lane, yA]], labelAt: { x: x0 + 6, y: yA, anchor: 'start' } });
      right = Math.max(right, lane);
    } else {
      const chain = chains.get(e.k);
      const pts = [[x0, y0]];
      for (const vid of chain.slice(1, -1)) {
        const d = V.get(vid);
        pts.push([center(d), layerY[d.layer]], [center(d), layerY[d.layer] + layerH[d.layer]]);
      }
      pts.push([x1, y1]);
      let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
      for (let i = 1; i < pts.length; i++) {
        const [px, py] = pts[i - 1];
        const [qx, qy] = pts[i];
        if (px === qx && i % 2 === 0 && i < pts.length - 1) d += ` L${f(qx)},${f(qy)}`;
        else { const my = (py + qy) / 2; d += ` C${f(px)},${f(my)} ${f(qx)},${f(my)} ${f(qx)},${f(qy)}`; }
      }
      paths.set(e.k, { d, back: false, first: [pts[0], pts[1]] });
    }
  }

  const height = y - GAP_Y + MARGIN;
  return {
    width: right + MARGIN + 8,
    height,
    nodes: new Map(ids.map(id => [id, { x: V.get(id).x, y: V.get(id).y, w: V.get(id).w, h: V.get(id).h }])),
    edges: E.map(e => ({ ...e, ...paths.get(e.k) })),
  };
}

function assignPorts(v, list, side, portX) {
  list.sort((a, b) => a.x - b.x);
  const span = Math.min(v.w * 0.7, Math.max(0, (list.length - 1) * 22));
  list.forEach((p, i) => {
    const x = list.length === 1 ? v.x + v.w / 2 : v.x + v.w / 2 - span / 2 + (span * i) / (list.length - 1);
    portX.set(`${side}:${p.k}`, x);
  });
}

function roundedPath(pts, r) {
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay);
    const l2 = Math.hypot(cx - bx, cy - by);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = [bx - ((bx - ax) / (l1 || 1)) * rr, by - ((by - ay) / (l1 || 1)) * rr];
    const p2 = [bx + ((cx - bx) / (l2 || 1)) * rr, by + ((cy - by) / (l2 || 1)) * rr];
    d += ` L${f(p1[0])},${f(p1[1])} Q${f(bx)},${f(by)} ${f(p2[0])},${f(p2[1])}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${f(last[0])},${f(last[1])}`;
}

function f(n) { return Math.round(n * 10) / 10; }
