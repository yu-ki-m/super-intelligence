/*
 * canvas.js — 画面一覧キャンバス
 *
 * プロトタイプの各画面を、スクロールした先まで含めた 1 画面の全体として 1 枚のフレームに描き、キャンバスの上に並べる。
 * Figma のキャンバスとフレームに近い見方で、画面の構成（どの情報がどこにあるか）を一度に見られるようにする。
 * HTML で window.UX_CANVAS（台本）を定義してから、このファイルを読み込む。台本の書き方は references/canvas.md。
 *
 * 仕組み：フレームごとにプロトタイプを iframe で開き、demo-bridge.js に { canvas: true, state, measure } を送る。
 * demo-bridge.js は状態を当て、スクロールする欄を伸ばし、ページ全体の高さと、印を付ける要素の位置を返す。
 *
 * 操作：ドラッグかホイールで移動、Ctrl（Mac は ⌘）＋ホイールで拡大・縮小、Shift＋1 で全体、Shift＋0 で 100%。
 *       フレームは見出しをドラッグして動かす。付箋とテキストは、ダブルクリックで書き、Delete で消す。
 */
(function () {
  'use strict';
  var C = window.UX_CANVAS;
  if (!C || !Array.isArray(C.screens)) { document.body.textContent = 'window.UX_CANVAS（台本）が見つからない。canvas.js より前に定義する。'; return; }

  var DEVICES = {
    pc: { w: 1280, h: 800, label: 'PC 1280 × 800' },
    phone: { w: 360, h: 780, label: 'スマートフォン 360 × 780' },
    'tablet-portrait': { w: 800, h: 1280, label: '縦のタブレット 800 × 1280' },
    'tablet-landscape': { w: 1280, h: 800, label: '横のタブレット 1280 × 800' }
  };
  var DEV = typeof C.device === 'object' ? C.device : (DEVICES[C.device] || DEVICES.pc);
  var LABEL_H = 56, GAP_X = 300, GAP_Y = 240, CALLOUT_W = 300, CALLOUT_GAP = 32;
  var COLORS = ['yellow', 'pink', 'blue', 'green'];
  var SWATCH = { yellow: '#fff3a8', pink: '#ffd1e3', blue: '#cfe5ff', green: '#d4f5d0' };

  /* ---------- 小さな道具 ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  function load(k, f) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (_) { return f; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* その場だけ */ } }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- 保存しておくもの（付箋・テキスト、フレームの位置、見ている範囲、表示の設定） ---------- */
  var KEY = 'uxcanvas:' + (C.id || '') + ':' + decodeURIComponent(location.pathname);
  var saved = load(KEY, null) || {};
  var notes = saved.notes || (C.notes || []).map(function (n, i) { return Object.assign({ id: 'n' + i, color: n.type === 'text' ? 'default' : 'yellow' }, n); });
  var framePos = saved.frames || {};
  var settings = Object.assign({ marks: true, flows: true, fold: true, notes: true }, saved.settings || {});
  var T = saved.view || null;   // { x, y, s }
  var userMoved = !!saved.view;
  function persist() { store(KEY, { notes: notes, frames: framePos, view: T, settings: settings }); }

  /* ---------- 骨組み ---------- */
  var app = h('div', { class: 'uxc' });
  document.body.classList.add('ds-body');
  document.body.appendChild(app);
  var zoomLabel = h('span', { class: 'uxc-zoom', text: '' });
  function tool(iconText, label, onclick, extra) { return h('button', Object.assign({ class: 'ds-btn', type: 'button', title: label, onclick: onclick }, extra || {}), iconText, label); }
  function choice(key, text) {
    var input = h('input', { type: 'checkbox', checked: settings[key] !== false, onchange: function () { settings[key] = input.checked; applySettings(); persist(); } });
    return h('label', { class: 'ds-choice' }, input, h('span', { text: text }));
  }
  var fileInput = h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: importJson });
  app.appendChild(h('header', { class: 'uxc-top' },
    h('span', { class: 'uxc-kind', text: '画面一覧キャンバス' }),
    h('div', { class: 'uxc-heading' }, h('h1', { text: C.title || '' }), h('p', { text: [C.id, C.refs && C.refs.case, C.refs && C.refs.iteration, DEV.label].filter(Boolean).join('　') })),
    h('div', { class: 'uxc-tools' },
      tool('', '付箋', function () { addNote('sticky'); }),
      tool('', 'テキスト', function () { addNote('text'); }),
      h('span', { class: 'uxc-sep' }),
      h('button', { class: 'ds-btn ds-btn--icon', type: 'button', 'aria-label': '縮小（−）', title: '縮小（−）', onclick: function () { zoomCenter(1 / 1.25); } }, '−'),
      zoomLabel,
      h('button', { class: 'ds-btn ds-btn--icon', type: 'button', 'aria-label': '拡大（＋）', title: '拡大（＋）', onclick: function () { zoomCenter(1.25); } }, '＋'),
      tool('', '全体を表示', function () { fit(); }, { title: '全体を表示（Shift＋1）' }),
      h('span', { class: 'uxc-sep' }),
      h('details', { class: 'ds-menu ds-menu--end' },
        h('summary', { class: 'ds-btn' }, '表示と保存'),
        h('div', { class: 'ds-menu__list' },
          h('div', { class: 'uxc-menu' },
            choice('marks', '情報の位置の印（番号と説明）'),
            choice('flows', '画面の移り方の矢印'),
            choice('fold', '最初に見える範囲の線'),
            choice('notes', '付箋とテキスト'),
            h('hr', { class: 'ds-divider' }),
            h('button', { class: 'ds-btn', type: 'button', onclick: copyNotes }, '付箋をテキストでコピー'),
            h('button', { class: 'ds-btn', type: 'button', onclick: exportJson }, '付箋と配置を書き出す（JSON）'),
            h('button', { class: 'ds-btn', type: 'button', onclick: function () { fileInput.click(); } }, '書き出したものを読み込む'),
            h('button', { class: 'ds-btn ds-btn--link', type: 'button', onclick: resetAll }, '台本の状態に戻す'),
            fileInput))))));

  var viewport = h('div', { class: 'uxc-viewport', tabindex: '0', 'aria-label': '画面一覧のキャンバス' });
  var world = h('div', { class: 'uxc-world' });
  var svgNS = 'http://www.w3.org/2000/svg';
  var flowsSvg = document.createElementNS(svgNS, 'svg');
  flowsSvg.setAttribute('class', 'uxc-flows');
  flowsSvg.innerHTML = '<defs><marker id="uxc-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0L12 6L0 12z"/></marker><marker id="uxc-dot" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="5" markerHeight="5"><circle cx="6" cy="6" r="5"/></marker></defs><g></g>';
  world.appendChild(flowsSvg);
  var labelsLayer = h('div', { class: 'uxc-flow-layer' });
  world.appendChild(labelsLayer);
  var notesLayer = h('div', { class: 'uxc-note-layer' });
  viewport.appendChild(world);
  var help = h('div', { class: 'uxc-help' },
    'ドラッグかホイールで移動 ・ ', h('kbd', { text: 'Ctrl' }), '＋ホイールで拡大・縮小 ・ ', h('kbd', { text: 'Shift' }), '＋', h('kbd', { text: '1' }), ' で全体 ・ フレームは見出しをドラッグで移動、「触る」で操作 ・ 付箋はダブルクリックで書き、', h('kbd', { text: 'Delete' }), ' で消す　',
    h('button', { class: 'ds-btn ds-btn--link', type: 'button', onclick: function () { help.hidden = true; } }, '閉じる'));
  viewport.appendChild(help);
  app.appendChild(viewport);

  /* ---------- フレーム ---------- */
  var frames = C.screens.map(function (sc, i) {
    var f = { sc: sc, i: i, h: DEV.h, rects: [], reqId: 0, tries: 0, ready: false };
    f.iframe = h('iframe', { title: (i + 1) + '. ' + (sc.title || ''), src: sc.prototype || C.prototype, scrolling: 'no', width: String(DEV.w), height: String(DEV.h), loading: 'eager' });
    f.marks = h('div');
    // 最初に見える範囲の線。中身が 1 画面に収まる画面（スクロールしない画面）では、線がフレームの下端と重なって意味が無いので出さない
    f.fold = h('div', { class: 'uxc-frame__fold', style: 'top:' + DEV.h + 'px', hidden: true }, h('span', { text: 'ここまでが最初に見える範囲' }));
    f.warn = h('span', { class: 'uxc-frame__warn', hidden: true });
    f.liveBtn = h('button', { class: 'uxc-live-btn', type: 'button', title: 'この画面を操作する（もう一度押すと元の状態に戻す）', onclick: function (e) { e.stopPropagation(); toggleLive(f); } }, '触る');
    f.callout = h('div', { class: 'uxc-callout' });
    f.body = h('div', { class: 'uxc-frame__body', style: 'width:' + DEV.w + 'px;height:' + DEV.h + 'px' }, f.iframe, f.marks, f.fold);
    f.label = h('div', { class: 'uxc-frame__label' }, h('span', { class: 'uxc-frame__no', text: String(i + 1) }), h('b', { text: sc.title || '' }), sc.desc ? h('span', { class: 'uxc-frame__meta', text: sc.desc }) : null, f.warn, f.liveBtn);
    f.el = h('div', { class: 'uxc-frame', 'data-id': sc.id }, f.label, f.body, f.callout);
    world.appendChild(f.el);
    f.iframe.addEventListener('load', function () {
      f.ready = false;
      setTimeout(function () { if (!f.ready) showWarn(f, 'プロトタイプから応答がない（demo-bridge.js を読み込んでいるか）'); }, 3000);
    });
    dragFrame(f);
    return f;
  });
  world.appendChild(notesLayer);
  var byId = {};
  frames.forEach(function (f) { byId[f.sc.id] = f; });

  function showWarn(f, text) { f.warn.hidden = !text; f.warn.textContent = text || ''; }
  function hasMarks(f) { return (f.sc.marks || []).length > 0; }
  function frameBox(f) { var p = f.pos; return { x: p.x, y: p.y, w: DEV.w, h: LABEL_H + f.h, right: p.x + DEV.w + (hasMarks(f) ? CALLOUT_GAP + CALLOUT_W : 0) }; }

  // 測る対象：情報の位置の印と、この画面から出る矢印の起点のボタン
  function measureList(f) {
    var list = (f.sc.marks || []).map(function (m) { return m.sel; });
    (C.flows || []).forEach(function (fl) { if (fl.from === f.sc.id && fl.trigger && list.indexOf(fl.trigger) < 0) list.push(fl.trigger); });
    return list;
  }
  function send(f) {
    if (!f.iframe.contentWindow) return;
    f.reqId += 1;
    f.iframe.contentWindow.postMessage({ source: 'ux-demo-player', type: 'apply', canvas: true, id: f.reqId, state: f.sc.state || {}, measure: measureList(f) }, '*');
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'ux-demo-proto') return;
    var f = frames.find(function (x) { return x.iframe.contentWindow === e.source; });
    if (!f) return;
    if (d.type === 'ready') {
      f.ready = true; f.tries = 0;
      if (!d.hasApply) { showWarn(f, 'window.uxDemoApply が無い'); return; }
      showWarn(f, '');
      f.iframe.contentWindow.postMessage({ source: 'ux-demo-player', type: 'theme', theme: document.documentElement.dataset.theme || 'auto' }, '*');
      send(f);
    } else if (d.type === 'measured') {
      if (d.ok === false) { showWarn(f, '状態を当てられない：' + (d.error || '')); return; }
      var nh = Math.max(DEV.h, d.height || 0);
      f.rects = d.rects || [];
      drawMarks(f);
      drawFlows();   // 説明の札の高さが決まったので、矢印の通る高さを引き直す
      // 高さを変えると、100vh を使う作りの高さも変わり、測り直した値が返る。4 回で打ち切る（伸び続ける作りへの備え）
      if (Math.abs(nh - f.h) > 2 && f.tries < 4) {
        f.tries += 1;
        f.h = nh;
        f.iframe.height = String(nh);
        f.body.style.height = nh + 'px';
        f.fold.hidden = nh <= DEV.h + 2;
        layout();
      }
    }
  });
  document.addEventListener('ds-themechange', function (e) {
    frames.forEach(function (f) { if (f.iframe.contentWindow) f.iframe.contentWindow.postMessage({ source: 'ux-demo-player', type: 'theme', theme: (e.detail && e.detail.theme) || 'auto' }, '*'); });
  });

  /* 情報の位置の印：番号つきの枠をフレームの上に、説明をフレームの右に置く */
  function drawMarks(f) {
    f.marks.textContent = '';
    f.callout.textContent = '';
    (f.sc.marks || []).forEach(function (m, k) {
      var r = f.rects.find(function (x) { return x.selector === m.sel; });
      var color = m.color ? { '--uxc-mark': m.color } : {};
      var style = Object.keys(color).map(function (c) { return c + ':' + color[c]; }).join(';');
      var box = null;
      if (r && r.found) {
        box = h('div', { class: 'uxc-mark', style: 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px;' + style }, h('span', { class: 'uxc-mark__no', text: String(k + 1) }));
        f.marks.appendChild(box);
      }
      var item = h('div', { class: 'uxc-callout__item' + (box ? '' : ' is-missing'), style: style }, h('b', { text: String(k + 1) }), h('span', { text: (m.text || m.sel) + (box ? '' : '（画面に見つからない：' + m.sel + '）') }));
      if (box) {
        item.addEventListener('mouseenter', function () { box.classList.add('is-hot'); });
        item.addEventListener('mouseleave', function () { box.classList.remove('is-hot'); });
      }
      f.callout.appendChild(item);
    });
    var marks = (f.sc.marks || []).map(function (m) { return m.sel; });
    if (f.rects.some(function (r) { return !r.found && marks.indexOf(r.selector) >= 0; })) showWarn(f, '印の対象が見つからない所がある');
  }

  /* ---------- 並べ方（行ごとに左から。動かしたフレームは、その位置を保つ） ---------- */
  function layout() {
    var rows = {};
    frames.forEach(function (f) { var r = f.sc.row || 0; (rows[r] = rows[r] || []).push(f); });
    var y = 0;
    Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
      var x = 0, rowH = 0;
      rows[r].forEach(function (f) {
        f.auto = { x: x, y: y };
        f.pos = framePos[f.sc.id] || f.auto;
        x += DEV.w + (hasMarks(f) ? CALLOUT_GAP + CALLOUT_W : 0) + GAP_X;
        rowH = Math.max(rowH, LABEL_H + f.h);
      });
      y += rowH + GAP_Y;
    });
    frames.forEach(function (f) {
      f.el.style.left = f.pos.x + 'px';
      f.el.style.top = f.pos.y + 'px';
      f.callout.style.left = (DEV.w + CALLOUT_GAP) + 'px';
      f.callout.style.top = LABEL_H + 'px';
    });
    drawFlows();
    renderNotes();
    if (!userMoved) fit();
  }

  /* 画面の移り方の矢印。FigJam のコネクターのように、縦と横の線を角を丸めてつなぐ。
     ・右にある画面へ：横に進む（高さが違えば、間で折れる）。操作の名前は線の上に置く
     ・下の行の画面へ：下へ出て、行の間を横に進み、相手の上から入る
     ・左や上の画面へ（戻る）：下へ出て、下を回り、相手の下から入る */
  function roundedPath(pts, r) {
    var d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 1; i < pts.length - 1; i++) {
      var p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      var l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (!l1 || !l2) continue;
      var rr = Math.min(r, l1 / 2, l2 / 2);
      d += ' L' + (p1[0] - (p1[0] - p0[0]) / l1 * rr) + ' ' + (p1[1] - (p1[1] - p0[1]) / l1 * rr) +
           ' Q' + p1[0] + ' ' + p1[1] + ' ' + (p1[0] + (p2[0] - p1[0]) / l2 * rr) + ' ' + (p1[1] + (p2[1] - p1[1]) / l2 * rr);
    }
    var last = pts[pts.length - 1];
    return d + ' L' + last[0] + ' ' + last[1];
  }
  function drawFlows() {
    var g = flowsSvg.querySelector('g');
    g.textContent = '';
    labelsLayer.textContent = '';
    (C.flows || []).forEach(function (fl) {
      var a = byId[fl.from], b = byId[fl.to];
      if (!a || !b || !a.pos || !b.pos) return;
      var A = frameBox(a), B = frameBox(b);
      var midA = A.y + LABEL_H + Math.min(a.h, DEV.h) / 2, midB = B.y + LABEL_H + Math.min(b.h, DEV.h) / 2;
      var xOut = A.x + DEV.w + 16;   // 画面の右端のすぐ外（説明の札の列との間）
      // 起点のボタン（トリガー）があれば、ボタンの右端（丸の印）から出して、画面の右端の外へ出す
      var tr = null, lead = null, ty = null;
      if (fl.trigger) {
        tr = (a.rects || []).find(function (r) { return r.selector === fl.trigger && r.found; }) || null;
        if (tr) {
          ty = A.y + LABEL_H + tr.y + tr.h / 2;
          lead = [[A.x + tr.x + tr.w + 2, ty], [xOut, ty]];
        } else if (a.rects && a.rects.length) showWarn(a, '矢印の起点のボタンが見つからない：' + fl.trigger);
      }
      var pts, label, side = false;
      if (B.x >= A.right) {
        var ex = B.x - 16, y, cy = midA;
        // 説明の札の列があるときは、札より下の高さ（通り道）を通して、札に重ねない
        var calloutBottom = hasMarks(a) ? A.y + LABEL_H + a.callout.offsetHeight + 24 : -Infinity;
        if (hasMarks(a)) { cy = Math.max(midA, calloutBottom + 32); if (cy > A.y + LABEL_H + a.h - 40) cy = null; }
        if (lead) {
          y = ty >= calloutBottom ? ty : (cy != null ? cy : ty);
          pts = lead.slice();
          if (Math.abs(y - ty) > 1) pts.push([xOut, y]);
        } else {
          y = cy != null ? cy : midA;
          pts = [[cy != null ? A.x + DEV.w + 6 : A.right + 16, y]];   // 札の列が画面より長いときは、札の列の右から出す
        }
        var ey = (y >= B.y + LABEL_H + 40 && y <= B.y + LABEL_H + b.h - 40) ? y : midB;
        if (Math.abs(y - ey) < 2) pts.push([ex, ey]);
        else { var xm = (A.right + ex) / 2; pts.push([xm, y], [xm, ey], [ex, ey]); }
        label = { x: (A.right + ex) / 2, y: y, w: ex - A.right - 24 };
        side = true;
      } else if (B.y >= A.y + A.h) {
        var cx1 = A.x + DEV.w / 2, cx2 = B.x + DEV.w / 2, yGap = B.y - GAP_Y / 2;
        pts = lead ? lead.concat([[xOut, yGap], [cx2, yGap], [cx2, B.y - 12]]) : [[cx1, A.y + A.h + 16], [cx1, yGap], [cx2, yGap], [cx2, B.y - 12]];
        label = { x: ((lead ? xOut : cx1) + cx2) / 2, y: yGap, w: 520 };
      } else {
        var c1 = A.x + DEV.w / 2, c2 = B.x + DEV.w / 2, low = Math.max(A.y + A.h, B.y + B.h) + 140;
        pts = lead ? lead.concat([[xOut, low], [c2, low], [c2, B.y + B.h + 16]]) : [[c1, A.y + A.h + 16], [c1, low], [c2, low], [c2, B.y + B.h + 16]];
        label = { x: ((lead ? xOut : c1) + c2) / 2, y: low, w: 520 };
      }
      var path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', roundedPath(pts, 40));
      path.setAttribute('marker-end', 'url(#uxc-arrow)');
      path.setAttribute('marker-start', 'url(#uxc-dot)');   // 出る所に丸を付け、どこから出ているかを示す
      if (fl.auto) path.setAttribute('class', 'is-auto');   // 押す操作ではなく、時間や出来事で移るときは点線
      g.appendChild(path);
      if (fl.label) {
        labelsLayer.appendChild(h('div', { class: 'uxc-flow-label' + (side ? ' uxc-flow-label--above' : '') + (fl.auto ? ' uxc-flow-label--auto' : ''), style: 'left:' + label.x + 'px;top:' + label.y + 'px;max-width:' + Math.max(160, label.w) + 'px', text: fl.label }));
      }
    });
  }

  /* ---------- 見ている範囲（移動・拡大・縮小） ---------- */
  function applyT() {
    world.style.transform = 'translate(' + T.x + 'px,' + T.y + 'px) scale(' + T.s + ')';
    zoomLabel.textContent = Math.round(T.s * 100) + '%';
  }
  function bounds() {
    var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    frames.forEach(function (f) { var B = frameBox(f); b.x1 = Math.min(b.x1, B.x); b.y1 = Math.min(b.y1, B.y); b.x2 = Math.max(b.x2, B.right); b.y2 = Math.max(b.y2, B.y + B.h); });
    if (settings.notes) notes.forEach(function (n) { var p = notePos(n); b.x1 = Math.min(b.x1, p.x); b.y1 = Math.min(b.y1, p.y); b.x2 = Math.max(b.x2, p.x + 300); b.y2 = Math.max(b.y2, p.y + 200); });
    return b;
  }
  function fit() {
    var b = bounds(), vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!isFinite(b.x1) || !vw) return;
    var s = clamp(Math.min((vw - 80) / (b.x2 - b.x1), (vh - 80) / (b.y2 - b.y1), 1), 0.03, 2);
    T = { s: s, x: (vw - (b.x2 - b.x1) * s) / 2 - b.x1 * s, y: (vh - (b.y2 - b.y1) * s) / 2 - b.y1 * s };
    applyT();
  }
  function zoomAt(px, py, factor) {
    var ns = clamp(T.s * factor, 0.03, 2);
    T.x = px - (px - T.x) * ns / T.s;
    T.y = py - (py - T.y) * ns / T.s;
    T.s = ns;
    userMoved = true;
    applyT();
    persistSoon();
  }
  function zoomCenter(factor) { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor); }
  var persistTimer = 0;
  function persistSoon() { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 300); }

  viewport.addEventListener('wheel', function (e) {
    if (e.target.closest('.uxc-note.is-editing')) return;
    e.preventDefault();
    var r = viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    else { T.x -= e.deltaX; T.y -= e.deltaY; userMoved = true; applyT(); persistSoon(); }
  }, { passive: false });

  var space = false;
  document.addEventListener('keydown', function (e) { if (e.code === 'Space' && !isTyping(e.target)) { space = true; } });
  document.addEventListener('keyup', function (e) { if (e.code === 'Space') space = false; });
  viewport.addEventListener('pointerdown', function (e) {
    var onItem = e.target.closest('.uxc-note, .uxc-frame__label, .uxc-help, .uxc-frame.is-live .uxc-frame__body');
    if (onItem && !space && e.button !== 1) return;
    if (e.button !== 0 && e.button !== 1) return;
    select(null);
    var sx = e.clientX, sy = e.clientY, ox = T.x, oy = T.y;
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('is-panning');
    function move(ev) { T.x = ox + ev.clientX - sx; T.y = oy + ev.clientY - sy; userMoved = true; applyT(); }
    function up() { viewport.classList.remove('is-panning'); viewport.removeEventListener('pointermove', move); viewport.removeEventListener('pointerup', up); persistSoon(); }
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
  });

  function dragFrame(f) {
    f.label.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button') || space) return;
      e.stopPropagation();
      var sx = e.clientX, sy = e.clientY, ox = f.pos.x, oy = f.pos.y;
      f.label.setPointerCapture(e.pointerId);
      function move(ev) {
        f.pos = { x: ox + (ev.clientX - sx) / T.s, y: oy + (ev.clientY - sy) / T.s };
        framePos[f.sc.id] = f.pos;
        f.el.style.left = f.pos.x + 'px'; f.el.style.top = f.pos.y + 'px';
        drawFlows(); renderNotes();
      }
      function up() { f.label.removeEventListener('pointermove', move); f.label.removeEventListener('pointerup', up); persist(); }
      f.label.addEventListener('pointermove', move);
      f.label.addEventListener('pointerup', up);
    });
  }
  function toggleLive(f) {
    var live = !f.el.classList.contains('is-live');
    frames.forEach(function (x) { if (x !== f && x.el.classList.contains('is-live')) { x.el.classList.remove('is-live'); x.liveBtn.textContent = '触る'; x.tries = 0; send(x); } });
    f.el.classList.toggle('is-live', live);
    f.liveBtn.textContent = live ? '元に戻す' : '触る';
    if (!live) { f.tries = 0; send(f); }   // 触って変わった画面を、台本の状態に戻す
  }

  /* ---------- 付箋とテキスト ---------- */
  var selected = null;
  function notePos(n) {
    if (n.near && byId[n.near] && byId[n.near].pos) { var p = byId[n.near].pos; return { x: p.x + (n.dx || 0), y: p.y + (n.dy || 0) }; }
    return { x: n.x || 0, y: n.y || 0 };
  }
  function isTyping(t) { return t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]'); }
  function renderNotes() {
    notesLayer.textContent = '';
    notes.forEach(function (n) { notesLayer.appendChild(noteEl(n)); });
  }
  function noteEl(n) {
    var p = notePos(n);
    var text = h('div', { class: 'uxc-note__text' });
    if (n.text) text.textContent = n.text; else text.appendChild(h('span', { class: 'uxc-note__empty', text: n.type === 'text' ? 'テキスト' : 'ダブルクリックで書く' }));
    var el = h('div', { class: 'uxc-note uxc-note--' + (n.type === 'text' ? 'text' : 'sticky') + (selected === n.id ? ' is-selected' : ''), 'data-color': n.color || 'yellow', style: 'left:' + p.x + 'px;top:' + p.y + 'px', tabindex: '0', role: 'note', 'aria-label': (n.type === 'text' ? 'テキスト' : '付箋') + '：' + (n.text || '空') }, text);
    if (selected === n.id) el.appendChild(noteBar(n));
    el.addEventListener('pointerdown', function (e) {
      if (el.classList.contains('is-editing') || e.button !== 0 || space) return;
      e.stopPropagation();
      select(n.id);
      var start = notePos(n), sx = e.clientX, sy = e.clientY, moved = false;
      var cur = el;
      cur.setPointerCapture(e.pointerId);
      function move(ev) {
        var dx = (ev.clientX - sx) / T.s, dy = (ev.clientY - sy) / T.s;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        if (n.near) { n.dx = start.x + dx - byId[n.near].pos.x; n.dy = start.y + dy - byId[n.near].pos.y; } else { n.x = start.x + dx; n.y = start.y + dy; }
        cur.style.left = (start.x + dx) + 'px'; cur.style.top = (start.y + dy) + 'px';
      }
      function up() { cur.removeEventListener('pointermove', move); cur.removeEventListener('pointerup', up); if (moved) persist(); }
      cur.addEventListener('pointermove', move);
      cur.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', function (e) { e.stopPropagation(); edit(n); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !el.classList.contains('is-editing')) { e.preventDefault(); edit(n); } });
    el.dataset.note = n.id;
    return el;
  }
  function noteBar(n) {
    return h('div', { class: 'uxc-note__bar', onpointerdown: function (e) { e.stopPropagation(); }, ondblclick: function (e) { e.stopPropagation(); } },
      COLORS.map(function (c) { return h('button', { type: 'button', 'aria-label': '色：' + c, 'aria-pressed': String((n.color || 'yellow') === c), style: 'background:' + SWATCH[c], onclick: function () { n.color = c; persist(); renderNotes(); } }); }),
      h('button', { class: 'uxc-del', type: 'button', onclick: function () { removeNote(n); } }, '消す'));
  }
  /* 選ぶときは、付箋の要素を作り直さず、印と道具の帯だけを付け替える（作り直すと、ダブルクリックの 2 回目が別の要素に当たる） */
  function select(id) {
    if (selected === id) return;
    selected = id;
    notesLayer.querySelectorAll('.uxc-note').forEach(function (el) {
      var on = el.dataset.note === id;
      el.classList.toggle('is-selected', on);
      var bar = el.querySelector('.uxc-note__bar');
      if (bar && !on) bar.remove();
      if (on && !bar) { var n = notes.find(function (x) { return x.id === id; }); if (n) el.appendChild(noteBar(n)); }
    });
  }
  function edit(n) {
    select(n.id);
    var el = notesLayer.querySelector('[data-note="' + n.id + '"]');
    if (!el) return;
    var t = el.querySelector('.uxc-note__text');
    el.classList.add('is-editing');
    t.textContent = n.text || '';
    t.setAttribute('contenteditable', 'true');
    t.focus();
    var range = document.createRange(); range.selectNodeContents(t); range.collapse(false);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    function done() {
      t.removeEventListener('blur', done);
      n.text = t.innerText.replace(/\n+$/, '');
      t.removeAttribute('contenteditable');
      el.classList.remove('is-editing');
      persist();
      renderNotes();
    }
    t.addEventListener('blur', done);
    t.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); t.blur(); } e.stopPropagation(); });
  }
  function addNote(type) {
    var cx = (viewport.clientWidth / 2 - T.x) / T.s, cy = (viewport.clientHeight / 2 - T.y) / T.s;
    var n = { id: 'u' + Date.now().toString(36), type: type, x: cx - 130, y: cy - 80, text: '', color: type === 'text' ? 'default' : 'yellow' };
    notes.push(n);
    if (!settings.notes) { settings.notes = true; applySettings(); }
    persist();
    renderNotes();
    edit(n);
  }
  function removeNote(n) {
    notes = notes.filter(function (x) { return x !== n; });
    selected = null;
    persist();
    renderNotes();
  }
  document.addEventListener('keydown', function (e) {
    if (isTyping(e.target)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { var n = notes.find(function (x) { return x.id === selected; }); if (n) { e.preventDefault(); removeNote(n); } }
    else if (e.key === 'Escape') select(null);
    else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); userMoved = true; fit(); persistSoon(); }
    else if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); zoomCenter(1 / T.s); }
    else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(1 / 1.25);
  });

  /* ---------- 書き出しと読み込み ---------- */
  function nearestFrame(n) {
    var p = notePos(n), best = null, bd = Infinity;
    frames.forEach(function (f) { var B = frameBox(f); var cx = clamp(p.x, B.x, B.right), cy = clamp(p.y, B.y, B.y + B.h); var d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = f; } });
    return best;
  }
  function copyNotes() {
    var lines = ['# ' + (C.title || '画面一覧') + ' の付箋', ''];
    frames.forEach(function (f) {
      var mine = notes.filter(function (n) { return n.text && nearestFrame(n) === f; });
      if (!mine.length) return;
      lines.push('## ' + (f.i + 1) + '. ' + (f.sc.title || ''));
      mine.forEach(function (n) { lines.push('- ' + n.text.replace(/\n/g, ' ')); });
      lines.push('');
    });
    var text = lines.join('\n');
    var ok = function () { if (window.ds && ds.toast) ds.toast({ title: 'コピーした', message: '付箋を、近い画面ごとにまとめた', tone: 'success' }); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
    function fallback() { var t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (_) { /* 何もしない */ } t.remove(); }
  }
  function exportJson() {
    var blob = new Blob([JSON.stringify({ canvas: C.id || '', title: C.title || '', savedAt: new Date().toISOString(), notes: notes, frames: framePos }, null, 2)], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: '画面一覧_' + (C.id || 'canvas') + '_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importJson() {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    file.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (Array.isArray(d.notes)) notes = d.notes;
      if (d.frames) framePos = d.frames;
      persist();
      layout();
    }).catch(function () { alert('読み込めない JSON だった'); });
    fileInput.value = '';
  }
  function resetAll() {
    if (!confirm('付箋・テキストとフレームの配置を、台本の状態に戻す。書き出していない付箋は消える。')) return;
    try { localStorage.removeItem(KEY); } catch (_) { /* 何もしない */ }
    location.reload();
  }

  function applySettings() {
    app.classList.toggle('hide-marks', !settings.marks);
    app.classList.toggle('hide-flows', !settings.flows);
    app.classList.toggle('hide-fold', !settings.fold);
    app.classList.toggle('hide-notes', !settings.notes);
    app.querySelectorAll('.uxc-menu input[type="checkbox"]').forEach(function (i, k) { i.checked = settings[['marks', 'flows', 'fold', 'notes'][k]] !== false; });
  }

  /* ---------- 開始 ---------- */
  applySettings();
  layout();
  if (T) applyT(); else fit();
  if (!T) { T = { x: 40, y: 40, s: 0.2 }; applyT(); }   // 画面の大きさがまだ分からず、全体に合わせられなかったとき
  window.addEventListener('resize', function () { if (!userMoved) fit(); });
})();
