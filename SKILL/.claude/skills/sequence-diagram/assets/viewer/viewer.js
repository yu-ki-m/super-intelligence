/*
 * sequence-diagram viewer
 *
 * 埋め込まれた処理モデル(JSON)を SeqCore で Mermaid テキストに変換して描画し、
 * 描画後の SVG を data-et / data-id 属性の順序で生成時の対応表(map)と突き合わせて、
 * クリック詳細・検索・強調・ズーム・図の切替・SVG保存などの操作を付与する。
 *
 * 方針:
 *   - Mermaid の構文には手を加えない。日本語化や色付けは描画後の SVG への後処理で行う。
 *   - フラグメント名の日本語化は、対応表で種別が一致した labelText 要素だけを置換する
 *     （図中の任意の文字列を置換しないので、ソースコード由来の同名文字列は影響を受けない）。
 *   - 対応付けに失敗した場合は図はそのまま表示し、検証タブに不一致を報告する。
 */
(function () {
  'use strict';

  var Core = window.SeqCore;
  // 英数字は下線（_）がはっきり見える欧文フォントで、日本語は日本語フォントで表示する（識別子の読み違い防止）
  var FONT = '"Segoe UI", "Helvetica Neue", "Noto Sans", "BIZ UDPGothic", "Yu Gothic UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans CJK JP", Meiryo, sans-serif';
  // 枠の種類ごとの線種（色だけに頼らず区別できるようにする）
  var FRAG_DASH = { alt: '7 3', opt: '2 3', loop: '10 3 2 3', par: 'none', critical: 'none', 'break': '4 2', 'try': '12 3 3 3' };
  var FRAG_WIDTH = { alt: 1.4, opt: 1.4, loop: 1.4, par: 1.6, critical: 2.4, 'break': 1.6, 'try': 1.6 };
  var FRAG_ICON = { alt: '◇', opt: '?', loop: '↻', par: '∥', critical: '■', 'break': '⤓', 'try': '⚡' };

  // ---------------------------------------------------------------------------
  // 小道具
  // ---------------------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function h(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function arr(v) { return Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]); }
  function lsGet(k, d) { try { var v = window.localStorage.getItem('seqdiag:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { window.localStorage.setItem('seqdiag:' + k, JSON.stringify(v)); } catch (e) { /* 保存できない環境では無視 */ } }
  function dataIdNum(el) { var m = /(\d+)$/.exec(el.getAttribute('data-id') || ''); return m ? Number(m[1]) : 0; }
  function normText(s) { return String(s || '').replace(/[\s\u200b]+/g, ''); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function mix(hex, other, ratio) {
    var a = Core.hexToRgb(hex) || [100, 116, 139], b = Core.hexToRgb(other) || [255, 255, 255];
    var c = a.map(function (v, i) { return Math.round(v * ratio + b[i] * (1 - ratio)); });
    return '#' + c.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  }

  // ---------------------------------------------------------------------------
  // 配色（テーマ別）
  // ---------------------------------------------------------------------------
  var PALETTE = {
    light: {
      bg: '#ffffff', text: '#0f172a', muted: '#64748b', line: '#cbd5e1',
      call: '#1e293b', ret: '#64748b', async: '#7c3aed', event: '#c026d3', db: '#0f766e', err: '#dc2626', self: '#334155',
      lock: '#b91c1c', inferred: '#b45309', unverified: '#be123c', sel: '#2563eb', hit: '#fde047',
      frag: { alt: '#b45309', opt: '#0369a1', loop: '#7c3aed', par: '#047857', critical: '#b91c1c', 'break': '#a21caf', 'try': '#9f1239' },
      note: { bg: '#fefce8', bd: '#eab308', tx: '#e0f2fe', txBd: '#0284c7', rb: '#fee2e2', ref: '#eff6ff', refBd: '#2563eb', grp: '#f1f5f9', grpBd: '#64748b', fin: '#fef9c3', finBd: '#ca8a04' },
      act: '#e2e8f0', actBd: '#64748b', seq: '#334155'
    },
    dark: {
      bg: '#0f1626', text: '#e5e9f0', muted: '#94a3b8', line: '#334155',
      call: '#e2e8f0', ret: '#94a3b8', async: '#c4b5fd', event: '#f0abfc', db: '#5eead4', err: '#f87171', self: '#cbd5e1',
      lock: '#fca5a5', inferred: '#fbbf24', unverified: '#fb7185', sel: '#60a5fa', hit: '#a16207',
      frag: { alt: '#fbbf24', opt: '#7dd3fc', loop: '#c4b5fd', par: '#6ee7b7', critical: '#fca5a5', 'break': '#f0abfc', 'try': '#fda4af' },
      note: { bg: '#2a2614', bd: '#a16207', tx: '#0c2a3d', txBd: '#38bdf8', rb: '#3b1518', ref: '#13233f', refBd: '#60a5fa', grp: '#1b2433', grpBd: '#64748b', fin: '#2d2610', finBd: '#ca8a04' },
      act: '#1e293b', actBd: '#64748b', seq: '#cbd5e1'
    }
  };

  function mermaidConfig(theme) {
    var p = PALETTE[theme];
    var dark = theme === 'dark';
    return {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      maxTextSize: 5000000,
      fontFamily: FONT,
      themeVariables: {
        darkMode: dark,
        background: p.bg,
        fontFamily: FONT,
        fontSize: '13px',
        primaryColor: dark ? '#1e293b' : '#f8fafc',
        primaryTextColor: p.text,
        primaryBorderColor: dark ? '#475569' : '#94a3b8',
        lineColor: p.call,
        secondaryColor: dark ? '#1e293b' : '#f1f5f9',
        tertiaryColor: dark ? '#111827' : '#ffffff',
        actorBkg: dark ? '#1e293b' : '#ffffff',
        actorBorder: dark ? '#64748b' : '#94a3b8',
        actorTextColor: p.text,
        actorLineColor: p.line,
        signalColor: p.call,
        signalTextColor: p.text,
        labelBoxBkgColor: dark ? '#1e293b' : '#ffffff',
        labelBoxBorderColor: dark ? '#64748b' : '#94a3b8',
        labelTextColor: p.text,
        loopTextColor: dark ? '#cbd5e1' : '#334155',
        noteBkgColor: p.note.bg,
        noteBorderColor: p.note.bd,
        noteTextColor: p.text,
        activationBkgColor: p.act,
        activationBorderColor: p.actBd,
        sequenceNumberColor: dark ? '#0f172a' : '#ffffff'
      },
      sequence: {
        useMaxWidth: false,
        mirrorActors: true,
        wrap: false,
        diagramMarginX: 24,
        diagramMarginY: 16,
        actorMargin: 36,
        width: 130,
        height: 62,
        boxMargin: 10,
        boxTextMargin: 6,
        noteMargin: 10,
        messageMargin: 36,
        messageAlign: 'center',
        rightAngles: false,
        labelBoxWidth: 98,
        labelBoxHeight: 22,
        activationWidth: 10,
        actorFontSize: 13,
        actorFontFamily: FONT,
        noteFontSize: 12.5,
        noteFontFamily: FONT,
        messageFontSize: 13,
        messageFontFamily: FONT
      }
    };
  }

  function svgStyle(sid, theme) {
    var p = PALETTE[theme];
    var S = '#' + sid;
    var L = function (sel) { return S + ' .sq-msg' + sel + ' .messageLine0, ' + S + ' .sq-msg' + sel + ' .messageLine1'; };
    var T = function (sel) { return S + ' .sq-msg' + sel + ' .messageText'; };
    var css = [];
    css.push(S + ' { --sq-sel: ' + p.sel + '; }');
    css.push(L('') + ' { stroke: ' + p.call + '; stroke-width: 1.5px; }');
    css.push(T('') + ' { fill: ' + p.text + '; }');
    css.push(L('.k-return') + ', ' + L('.k-db-return') + ' { stroke: ' + p.ret + '; }');
    css.push(T('.k-return') + ' { fill: ' + p.muted + '; }');
    css.push(L('.k-async') + ', ' + L('.k-message') + ', ' + L('.k-callback') + ' { stroke: ' + p.async + '; }');
    css.push(T('.k-async') + ', ' + T('.k-message') + ', ' + T('.k-callback') + ' { fill: ' + p.async + '; }');
    css.push(L('.k-event') + ' { stroke: ' + p.event + '; }');
    css.push(T('.k-event') + ' { fill: ' + p.event + '; }');
    css.push(L('.k-db') + ' { stroke: ' + p.db + '; }');
    css.push(T('.k-db') + ', ' + T('.k-db-return') + ' { fill: ' + p.db + '; }');
    css.push(L('.k-db-return') + ' { stroke: ' + p.db + '; stroke-opacity: 0.75; }');
    css.push(L('.k-throw') + ' { stroke: ' + p.err + '; stroke-width: 1.8px; }');
    css.push(T('.k-throw') + ' { fill: ' + p.err + '; }');
    css.push(L('.k-lock') + ' { stroke: ' + p.lock + '; }');
    css.push(T('.k-lock') + ' { fill: ' + p.lock + '; }');
    css.push(L('.k-await') + ' { stroke: ' + p.async + '; stroke-dasharray: 4 3; }');
    css.push(T('.k-await') + ' { fill: ' + p.async + '; }');
    css.push(T('.ev-inferred') + ' { fill: ' + p.inferred + '; font-style: italic; }');
    css.push(T('.ev-unverified') + ' { fill: ' + p.unverified + '; font-style: italic; }');
    css.push(S + ' .sq-msg { cursor: pointer; }');
    css.push(S + ' .sq-hit { stroke: transparent !important; fill: none !important; stroke-width: 14px !important; pointer-events: stroke; marker-end: none !important; marker-start: none !important; }');
    css.push(S + ' .sq-msg:hover .messageLine0, ' + S + ' .sq-msg:hover .messageLine1 { stroke-width: 2.6px; }');
    css.push(L('.is-related') + ' { stroke: ' + p.sel + '; stroke-width: 2.2px; }');
    css.push(L('.is-selected') + ' { stroke: ' + p.sel + ' !important; stroke-width: 3px !important; }');
    css.push(T('.is-selected') + ', ' + T('.is-related') + ' { fill: ' + p.sel + ' !important; }');
    css.push(S + '.sq-dim .sq-msg:not(.is-selected):not(.is-related), ' + S + '.sq-dim .sq-note:not(.is-related), ' + S + '.sq-dim .sq-frag { opacity: 0.25; }');
    css.push(S + ' .sq-hl { fill: ' + p.hit + '; opacity: ' + (theme === 'dark' ? '0.55' : '0.75') + '; pointer-events: none; }');
    css.push(S + ' .sq-hl.is-current { opacity: 1; stroke: ' + p.sel + '; stroke-width: 1.5px; }');
    // フラグメント
    Object.keys(p.frag).forEach(function (k) {
      var c = p.frag[k];
      var sel = S + ' .sq-frag.f-' + k;
      css.push(sel + ' .loopLine { stroke: ' + c + '; stroke-width: ' + FRAG_WIDTH[k] + 'px; stroke-dasharray: ' + FRAG_DASH[k] + '; }');
      css.push(sel + ' .labelBox { fill: ' + (theme === 'dark' ? mix(c, '#0f1626', 0.22) : mix(c, '#ffffff', 0.14)) + '; stroke: ' + c + '; stroke-width: 1.2px; }');
      css.push(sel + ' .labelText { fill: ' + (theme === 'dark' ? c : mix(c, '#000000', 0.78)) + '; font-weight: 700; }');
      css.push(sel + ' .loopText, ' + sel + ' .sectionTitle { fill: ' + (theme === 'dark' ? mix(c, '#ffffff', 0.7) : mix(c, '#0f172a', 0.55)) + '; }');
    });
    css.push(S + ' .sq-frag .labelBox, ' + S + ' .sq-frag .labelText, ' + S + ' .sq-frag .loopText, ' + S + ' .sq-frag .sectionTitle { cursor: pointer; }');
    css.push(S + ' .sq-frag.is-selected .loopLine { stroke-width: 2.6px; stroke-dasharray: none; }');
    css.push(S + ' .sq-frag.is-selected .labelBox { stroke-width: 2.4px; }');
    // 文字の縁取り（背景色）。ライフラインや枠線が文字を貫いて読みにくくなるのを防ぐ
    // （Mermaid 自身のスタイルより優先されるよう、親のクラスを含めて詳細度を上げる）
    css.push(S + ' .sq-msg .messageText, ' + S + ' .sq-frag .loopText, ' + S + ' .sq-frag .sectionTitle { paint-order: stroke; stroke: ' + p.bg + '; stroke-width: 3.5px; stroke-linejoin: round; }');
    css.push(S + ' .sq-frag .loopText, ' + S + ' .sq-frag .sectionTitle { font-size: 12.5px; }');
    // ノート
    var n = p.note;
    css.push(S + ' .sq-note { cursor: pointer; }');
    css.push(S + ' .sq-note .note { rx: 4px; }');
    css.push(S + ' .sq-note.role-ref .note { fill: ' + n.ref + '; stroke: ' + n.refBd + '; stroke-width: 1.8px; }');
    css.push(S + ' .sq-note.role-ref .noteText { fill: ' + n.refBd + '; text-decoration: underline; }');
    css.push(S + ' .sq-note.role-tx-begin .note, ' + S + ' .sq-note.role-tx-commit .note, ' + S + ' .sq-note.role-tx-savepoint .note, ' + S + ' .sq-note.role-tx-flush .note { fill: ' + n.tx + '; stroke: ' + n.txBd + '; }');
    css.push(S + ' .sq-note.role-tx-rollback .note { fill: ' + n.rb + '; stroke: ' + p.err + '; }');
    css.push(S + ' .sq-note.role-tx-rollback .noteText { fill: ' + p.err + '; }');
    css.push(S + ' .sq-note.role-group .note, ' + S + ' .sq-note.role-group-collapsed .note { fill: ' + n.grp + '; stroke: ' + n.grpBd + '; stroke-dasharray: 4 3; }');
    css.push(S + ' .sq-note.role-group-collapsed .note { stroke-dasharray: none; stroke-width: 1.6px; }');
    
    css.push(S + ' .sq-note.role-placeholder .note { fill: none; stroke: ' + p.muted + '; stroke-dasharray: 3 3; }');
    css.push(S + ' .sq-note.role-placeholder .noteText { fill: ' + p.muted + '; font-style: italic; }');
    css.push(S + ' .sq-note.role-finally .note, ' + S + ' .sq-note.role-try .note { fill: ' + n.fin + '; stroke: ' + n.finBd + '; }');
    css.push(S + ' .sq-note.is-selected .note { stroke: ' + p.sel + ' !important; stroke-width: 2.6px !important; }');
    // 参加者（ライフライン）
    css.push(S + ' .sq-part { cursor: pointer; }');
    css.push(S + ' .sq-part.is-selected rect, ' + S + ' .sq-part.is-selected path { stroke: ' + p.sel + ' !important; stroke-width: 2.6px !important; }');
    css.push(S + ' .sq-part.is-selected line, ' + S + ' .sq-part.is-selected circle { stroke: ' + p.sel + ' !important; stroke-width: 2.6px !important; }');
    css.push(S + ' .actor-line.is-selected { stroke: ' + p.sel + ' !important; stroke-width: 2px !important; stroke-opacity: 0.8; }');
    css.push(S + ' .sq-ll-hit { stroke: transparent; stroke-width: 12px; cursor: pointer; pointer-events: stroke; }');
    css.push(S + ' rect.rect { rx: 6px; }');
    css.push(S + ' text.sequenceNumber { font-weight: 700; }');
    return css.join('\n');
  }

  // ---------------------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------------------
  var raw, model, validation, build;
  var params = new URLSearchParams(location.search);
  var state = {
    diagramId: null,
    opts: {
      showReturns: true, showArgs: false, showExpr: false, hideMinor: false, lifelineMode: 'method', boxes: true
    },
    collapsed: {}, // diagramId -> Set(groupStepId)
    expandRefs: new Set(),
    theme: 'light',
    themePref: 'auto',
    zoom: 1,
    natural: { w: 0, h: 0 },
    gen: null,
    svg: null,
    els: null,
    selection: null,
    search: { q: '', results: [], index: -1, open: false },
    renderSeq: 0,
    navSeq: 0, // 利用者の操作（図の切替・選択）ごとに増やし、古い非同期処理を無効にする
    check: null,
    verifyAll: null,
    history: []
  };

  // ---------------------------------------------------------------------------
  // 初期化
  // ---------------------------------------------------------------------------
  function init() {
    try {
      raw = JSON.parse($('#seqdiag-model').textContent);
    } catch (e) {
      fatal('処理モデル(JSON)を読み込めませんでした: ' + e.message);
      return;
    }
    try { build = JSON.parse($('#seqdiag-build').textContent || '{}'); } catch (e) { build = {}; }
    if (!window.mermaid) { fatal('Mermaid ライブラリが読み込めませんでした（オフライン環境で CDN 版を開いた可能性があります）。'); return; }
    model = Core.normalize(raw);
    validation = Core.validate(model);

    document.title = model.meta.title;
    $('#docTitle').textContent = model.meta.title;
    $('#docSub').textContent = [model.meta.system, model.meta.entryPoint].filter(Boolean).join('  ·  ');

    // 図ごとの折りたたみ初期状態（モデルの collapsed:true）
    model.diagrams.forEach(function (d) {
      var set = new Set();
      Core.walkSteps(d.steps, function (s) { if (s.type === 'group' && s.collapsed === true) set.add(s.id); });
      state.collapsed[d.id] = set;
    });

    state.themePref = params.get('theme') || lsGet('theme', 'auto');
    applyTheme();
    var savedOpts = lsGet('opts', null);
    if (savedOpts && !params.has('verify')) Object.assign(state.opts, savedOpts);
    syncOptionInputs();
    if (params.get('shot')) $('#app').classList.add('shot-mode');
    var pw = lsGet('panelWidth', null);
    if (pw) document.documentElement.style.setProperty('--panel-w', pw + 'px');
    // 狭い画面ではナビ（重ね表示）とパネル（下部シート）を閉じた状態で開始し、図の表示領域を優先する
    // 1440px 未満では図の表示領域を広く取るため、ナビ（図一覧・アウトライン）を閉じた状態で始める（☰ で開く）
    var nw = lsGet('navWidth', null);
    if (nw) document.documentElement.style.setProperty('--nav-w', nw + 'px');
    if (lsGet('navHidden', false) || window.innerWidth < 1440) $('#app').classList.add('nav-hidden');
    if ((lsGet('panelHidden', false) || window.innerWidth <= 860) && !params.get('select')) $('#app').classList.add('panel-hidden');

    bindUi();
    buildSearchIndex();

    var hash = parseHash();
    var startDiagram = params.get('diagram') || hash.d || rootDiagrams()[0] || model.diagrams[0].id;
    if (!model._index.diagrams.has(startDiagram)) startDiagram = model.diagrams[0].id;
    state.diagramId = startDiagram;
    renderDiagramTree();

    if (params.get('verify')) {
      runVerifyAll().then(writeVerifyReport);
      return;
    }
    render({ initialZoom: true }).then(function () {
      var sel = params.get('select') || hash.s;
      if (sel) selectStep(sel, { scroll: true });
      else if (hash.l) selectLifeline(hash.l, { scroll: true });
      else showPanel('detail');
    });
  }

  function fatal(msg) {
    var host = $('#diagramHost');
    host.innerHTML = '<div class="diagram-error"><h3>表示できません</h3><p>' + h(msg) + '</p></div>';
    var chip = $('#chipVerify');
    chip.textContent = 'エラー';
    chip.className = 'chip err';
    window.__SEQDIAG_STATUS__ = { ready: true, fatal: msg };
  }

  function rootDiagrams() {
    var roots = model.diagrams.filter(function (d) { return !d._parents.length; }).map(function (d) { return d.id; });
    return roots.length ? roots : [model.diagrams[0].id];
  }

  function parseHash() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
  }
  function updateHash(push) {
    if (params.get('verify') || params.get('shot')) return;
    var parts = ['d=' + encodeURIComponent(state.diagramId)];
    var s = state.selection;
    if (s && s.stepId) parts.push('s=' + encodeURIComponent(s.stepId));
    else if (s && s.type === 'lifeline') parts.push('l=' + encodeURIComponent(s.llId));
    var url = location.pathname + location.search + '#' + parts.join('&');
    try {
      if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
    } catch (e) { /* file:// で失敗する環境では無視 */ }
  }

  // ---------------------------------------------------------------------------
  // テーマ
  // ---------------------------------------------------------------------------
  function applyTheme() {
    var pref = state.themePref;
    var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    state.theme = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
  }

  // ---------------------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------------------
  function genOptions() {
    return {
      lifelineMode: state.opts.lifelineMode,
      showArgs: state.opts.showArgs,
      showExpr: state.opts.showExpr,
      showReturns: state.opts.showReturns,
      hideMinor: state.opts.hideMinor,
      boxes: state.opts.boxes,
      collapsed: state.collapsed[state.diagramId],
      expandRefs: state.expandRefs,
      theme: state.theme
    };
  }

  function render(o) {
    o = o || {};
    var seq = ++state.renderSeq;
    var host = $('#diagramHost');
    var overlay = $('#renderOverlay');
    overlay.hidden = false;
    var keepScroll = o.keepScroll ? { x: $('#canvas').scrollLeft, y: $('#canvas').scrollTop } : null;
    var t0 = performance.now();
    var gen;
    try {
      gen = Core.generate(model, state.diagramId, genOptions());
    } catch (e) {
      overlay.hidden = true;
      showRenderError('処理モデルから Mermaid を生成できませんでした', e.message, null);
      return Promise.resolve(false);
    }
    state.gen = gen;
    mermaid.initialize(mermaidConfig(state.theme));
    var rid = 'sq-' + String(state.diagramId).replace(/[^A-Za-z0-9_-]/g, '_') + '-' + seq;
    return new Promise(function (r) { setTimeout(r, 16); }).then(function () {
      return mermaid.render(rid, gen.text);
    }).then(function (res) {
      if (seq !== state.renderSeq) return false;
      host.innerHTML = res.svg;
      var svg = host.querySelector('svg');
      state.svg = svg;
      var vb = svg.viewBox && svg.viewBox.baseVal;
      state.natural = { w: vb && vb.width ? vb.width : svg.getBBox().width, h: vb && vb.height ? vb.height : svg.getBBox().height };
      state.els = postProcess(svg, gen);
      state.check = selfCheck(svg, gen, state.els);
      state.check.durationMs = Math.round(performance.now() - t0);
      if (o.initialZoom) initialZoom(); else applyZoom(state.zoom);
      if (keepScroll) { $('#canvas').scrollLeft = keepScroll.x; $('#canvas').scrollTop = keepScroll.y; }
      buildSticky();
      renderOutline();
      renderCrumbs();
      renderDiagramTree();
      updateStatus();
      updateVerifyChip();
      if (state.search.q) applySearchHighlights();
      if (state.selection) reapplySelection();
      overlay.hidden = true;
      return true;
    }).catch(function (e) {
      if (seq !== state.renderSeq) return false;
      overlay.hidden = true;
      var stray = document.getElementById('d' + rid);
      if (stray) stray.remove();
      state.check = { diagramId: state.diagramId, ok: false, renderError: String(e && (e.message || e.str) || e) };
      showRenderError('Mermaid の描画に失敗しました', String(e && (e.message || e.str) || e), gen.text);
      updateVerifyChip();
      return false;
    });
  }

  function showRenderError(title, msg, text) {
    var host = $('#diagramHost');
    var lineNo = null;
    var m = /line (\d+)/i.exec(msg);
    if (m) lineNo = Number(m[1]);
    var src = '';
    if (text) {
      src = '<pre>' + text.split('\n').map(function (l, i) {
        var n = String(i + 1).padStart(4, ' ');
        return '<span class="' + (i + 1 === lineNo ? 'err-line' : '') + '">' + n + '  ' + h(l) + '</span>';
      }).join('\n') + '</pre>';
    }
    host.innerHTML = '<div class="diagram-error"><h3>' + h(title) + '</h3><pre>' + h(msg) + '</pre>' + src + '</div>';
    state.svg = null;
    state.els = null;
  }

  // ---------------------------------------------------------------------------
  // 描画後処理（SVG と対応表の突き合わせ）
  // ---------------------------------------------------------------------------
  function postProcess(svg, gen) {
    var sid = svg.id;
    var map = gen.map;
    var els = { msgs: [], notes: [], frags: [], parts: new Map(), problems: [], mode: 'data-et' };
    svg.classList.add('sq-svg');

    var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.setAttribute('class', 'sq-style');
    style.textContent = svgStyle(sid, state.theme);
    svg.insertBefore(style, svg.firstChild);

    var hasDataEt = !!svg.querySelector('[data-et]');
    if (!hasDataEt) {
      els.mode = 'fallback';
      els.problems.push({ level: 'warning', message: 'この Mermaid には data-et 属性がないため、要素の対応付け（クリック・検索連動）を行えません。日本語化はフラグメント名のみ行います。' });
      $$('.labelText', svg).forEach(function (t) {
        var k = t.textContent.trim();
        if (Core.FRAGMENT_LABELS[k]) t.textContent = Core.FRAGMENT_LABELS[k];
      });
      return els;
    }

    // --- 参加者（ライフライン） ---
    var partByMid = new Map(map.participants.map(function (p) { return [p.mId, p]; }));
    var layerOf = function (p) { return model._index.layers.get(p.layer) || { color: '#64748b' }; };
    $$('[data-et="participant"]', svg).forEach(function (g) {
      var mId = g.getAttribute('data-id');
      var rec = partByMid.get(mId);
      if (!rec) { els.problems.push({ level: 'error', message: '描画された参加者 ' + mId + ' が対応表にありません。' }); return; }
      g.classList.add('sq-part');
      g.setAttribute('data-sq', 'p:' + mId);
      colorParticipant(g, layerOf(rec).color, rec.type);
      var line = svg.querySelector('[data-et="life-line"][data-id="' + mId + '"]');
      var bb = g.getBBox();
      els.parts.set(mId, { rec: rec, top: g, bottoms: [], line: line, cx: bb.x + bb.width / 2, box: bb });
      if (line) {
        var hit = line.cloneNode(false);
        hit.removeAttribute('id');
        hit.removeAttribute('data-et');
        hit.setAttribute('class', 'sq-ll-hit');
        hit.setAttribute('data-sq', 'p:' + mId);
        line.parentNode.insertBefore(hit, line.nextSibling);
      }
    });
    map.participants.forEach(function (p) {
      if (!els.parts.has(p.mId)) els.problems.push({ level: 'error', message: '参加者 ' + p.label + ' が描画されていません。' });
    });
    // 下側（ミラー）の参加者は x 座標で対応付ける
    $$('.actor-bottom', svg).forEach(function (el) {
      var container = el.tagName.toLowerCase() === 'rect' ? el.parentNode : (el.querySelector('text') ? el : el.parentNode);
      var bb = container.getBBox();
      var cx = bb.x + bb.width / 2;
      var best = null, bestD = Infinity;
      els.parts.forEach(function (info, mId) {
        var d = Math.abs(info.cx - cx);
        if (d < bestD) { bestD = d; best = mId; }
      });
      if (best && bestD < 4) {
        var info = els.parts.get(best);
        if (info.bottoms.indexOf(container) < 0) {
          info.bottoms.push(container);
          container.classList.add('sq-part');
          container.setAttribute('data-sq', 'p:' + best);
          colorParticipant(container, layerOf(info.rec).color, info.rec.type);
        }
      }
    });

    // --- メッセージ ---
    var msgEls = $$('[data-et="message"]', svg).sort(function (a, b) { return dataIdNum(a) - dataIdNum(b); });
    if (msgEls.length !== map.messages.length) {
      els.problems.push({ level: 'error', message: 'メッセージ数が一致しません（期待 ' + map.messages.length + ' / 描画 ' + msgEls.length + '）。' });
    }
    var assoc = new Map();
    var parents = new Set(msgEls.map(function (e) { return e.parentNode; }));
    parents.forEach(function (parent) {
      var pending = [];
      var last = null;
      Array.prototype.slice.call(parent.children).forEach(function (el) {
        if (el.matches('text.messageText')) { pending.push(el); return; }
        if (el.getAttribute('data-et') === 'message') {
          assoc.set(el, { texts: pending, extras: [] });
          pending = [];
          last = el;
          return;
        }
        if (last && (el.matches('text.sequenceNumber') || (el.tagName.toLowerCase() === 'line' && el.getAttribute('marker-start')))) {
          assoc.get(last).extras.push(el);
          return;
        }
        if (!el.matches('text.messageText')) last = null;
      });
    });
    var markerCache = {};
    msgEls.forEach(function (el, i) {
      var rec = map.messages[i];
      if (!rec) return;
      var a = assoc.get(el) || { texts: [], extras: [] };
      if (el.getAttribute('data-from') !== rec.mFrom || el.getAttribute('data-to') !== rec.mTo) {
        els.problems.push({ level: 'error', message: (i + 1) + '番目のメッセージの送信元/送信先が一致しません（期待 ' + rec.mFrom + '→' + rec.mTo + '）。', stepId: rec.stepId });
      }
      var got = normText(a.texts.map(function (t) { return t.textContent; }).join(''));
      if (got !== normText(rec.text)) {
        els.problems.push({ level: 'warning', message: (i + 1) + '番目のメッセージの表示文字列が想定と異なります（期待「' + rec.text + '」/ 描画「' + got + '」）。', stepId: rec.stepId });
      }
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'sq-msg ' + rec.kind + ' ev-' + (rec.ev || 'confirmed') + ' role-' + rec.role);
      g.setAttribute('data-sq', 'm:' + i);
      var first = a.texts[0] || el;
      first.parentNode.insertBefore(g, first);
      var hit = el.cloneNode(false);
      hit.removeAttribute('data-et');
      hit.removeAttribute('data-id');
      hit.setAttribute('class', 'sq-hit');
      g.appendChild(hit);
      a.texts.forEach(function (t) { g.appendChild(t); });
      g.appendChild(el);
      a.extras.forEach(function (x) { g.appendChild(x); });
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = '#' + (i + 1) + ' ' + rec.text;
      g.insertBefore(title, g.firstChild);
      recolorMarker(svg, el, rec, markerCache);
      avoidNumberOverlap(a.texts, a.extras);
      els.msgs.push({ g: g, line: el, texts: a.texts, rec: rec, idx: i });
    });

    // --- ノート ---
    var noteEls = $$('[data-et="note"]', svg).sort(function (a, b) { return dataIdNum(a) - dataIdNum(b); });
    if (noteEls.length !== map.notes.length) {
      els.problems.push({ level: 'error', message: 'ノート数が一致しません（期待 ' + map.notes.length + ' / 描画 ' + noteEls.length + '）。' });
    }
    noteEls.forEach(function (g, i) {
      var rec = map.notes[i];
      if (!rec) return;
      var got = normText($$('.noteText', g).map(function (t) { return t.textContent; }).join(''));
      if (got !== normText(rec.text)) els.problems.push({ level: 'warning', message: (i + 1) + '番目のノートの表示文字列が想定と異なります。', stepId: rec.stepId });
      g.classList.add('sq-note');
      g.classList.add('role-' + rec.role);
      g.setAttribute('data-sq', 'n:' + i);
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = rec.role === 'ref' ? 'クリックで詳細図を表示' : (rec.role.indexOf('group') === 0 ? 'クリックで詳細表示（折りたたみ切替はパネルから）' : rec.text);
      g.insertBefore(title, g.firstChild);
      els.notes.push({ g: g, rec: rec, idx: i });
    });

    // --- フラグメント（alt / opt / loop / par / critical / break）---
    var fragEls = $$('[data-et="control-structure"]', svg).sort(function (a, b) { return dataIdNum(a) - dataIdNum(b); });
    if (fragEls.length !== map.fragments.length) {
      els.problems.push({ level: 'error', message: 'フラグメント数が一致しません（期待 ' + map.fragments.length + ' / 描画 ' + fragEls.length + '）。' });
    }
    fragEls.forEach(function (g, i) {
      var rec = map.fragments[i];
      var label = g.querySelector('.labelText');
      if (!rec || !label) return;
      var kw = label.textContent.trim();
      if (kw !== rec.keyword) {
        els.problems.push({ level: 'error', message: (i + 1) + '番目のフラグメント種別が一致しません（期待 ' + rec.keyword + ' / 描画 ' + kw + '）。日本語化を中止しました。', stepId: rec.stepId });
        return;
      }
      // 見出しの日本語化。try-catch（Mermaid 上は alt）は対応表で判定できた場合だけ「例外処理」とする
      var kind = rec.role === 'try' ? 'try' : rec.keyword;
      var ja = Core.FRAGMENT_LABELS[kind] || Core.FRAGMENT_LABELS[kw] || kw;
      label.textContent = (FRAG_ICON[kind] ? FRAG_ICON[kind] + ' ' : '') + ja;
      var tt = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      tt.textContent = ja + '（Mermaid: ' + kw + '）：' + (rec.sections || []).join(' ／ ');
      g.insertBefore(tt, g.firstChild);
      fitLabelBox(g, label);
      alignFragmentTexts(g);
      g.classList.add('sq-frag', 'f-' + kind);
      g.setAttribute('data-sq', 'f:' + i);
      els.frags.push({ g: g, rec: rec, idx: i });
    });

    shrinkTxBands(svg, els);
    return els;
  }

  /**
   * トランザクションの背景帯（Mermaid の rect）を、トランザクション内で実際に呼び出し・DB 操作を行う
   * ライフラインの範囲に狭める。例外の伝播先（フレームワーク・例外ハンドラ）まで帯が伸びて、
   * それらがトランザクションに参加しているように見えるのを防ぐ。広げることはしない。
   */
  function shrinkTxBands(svg, els) {
    try {
      var rects = $$(':scope > rect.rect', svg).concat($$(':scope > g > rect.rect', svg).filter(function (r) { return !r.parentNode.querySelector(':scope > text.text'); }));
      els.notes.filter(function (n) { return n.rec.role === 'tx-begin'; }).forEach(function (n) {
        var nb = n.g.querySelector('rect.note').getBBox();
        var best = null;
        rects.forEach(function (r) {
          var b = r.getBBox();
          if (b.y <= nb.y && b.y + b.height >= nb.y + nb.height && (!best || b.y > best.b.y)) best = { r: r, b: b };
        });
        if (!best) return;
        var top = best.b.y, bottom = best.b.y + best.b.height;
        var xs = [nb.x, nb.x + nb.width];
        els.msgs.forEach(function (m) {
          if (/throw/.test(m.rec.role)) return;
          var lb = m.line.getBBox();
          if (lb.y < top || lb.y > bottom) return;
          [m.rec.mFrom, m.rec.mTo].forEach(function (mid) { var p = els.parts.get(mid); if (p) xs.push(p.cx); });
        });
        var minX = Math.min.apply(null, xs) - 60, maxX = Math.max.apply(null, xs) + 60;
        var x = Math.max(best.b.x, minX), right = Math.min(best.b.x + best.b.width, maxX);
        if (right - x > 40 && (x > best.b.x + 1 || right < best.b.x + best.b.width - 1)) {
          best.r.setAttribute('x', String(x));
          best.r.setAttribute('width', String(right - x));
        }
      });
    } catch (e) { /* 調整に失敗しても描画は継続 */ }
  }

  /**
   * 枠の条件文を見出しのすぐ右（else / and / option の区間は区切り線の左端）に寄せる。
   * Mermaid は条件文を枠の中央に置くため、横に長い枠では見出しから数千 px 離れて読めなくなる。
   * 位置だけを変え、文字列・折り返しは Mermaid の結果をそのまま使う。
   */
  function alignFragmentTexts(g) {
    try {
      var poly = g.querySelector('polygon.labelBox');
      var lines = $$('line.loopLine', g);
      if (!poly || !lines.length) return;
      var pb = poly.getBBox();
      var left = Math.min.apply(null, lines.map(function (l) { return Math.min(Number(l.getAttribute('x1')), Number(l.getAttribute('x2'))); }));
      $$('text.loopText', g).forEach(function (t) {
        t.setAttribute('text-anchor', 'start');
        t.setAttribute('x', String(pb.x + pb.width + 10));
        $$('tspan', t).forEach(function (s) { if (s.hasAttribute('x')) s.setAttribute('x', String(pb.x + pb.width + 10)); });
      });
      $$('text.sectionTitle', g).forEach(function (t) {
        t.setAttribute('text-anchor', 'start');
        t.setAttribute('x', String(left + 10));
        $$('tspan', t).forEach(function (s) { if (s.hasAttribute('x')) s.setAttribute('x', String(left + 10)); });
      });
    } catch (e) { /* 配置の調整に失敗しても描画は継続 */ }
  }

  /** 自己メッセージなどで、連番の丸印がラベルに重なる場合はラベルを右へずらす。 */
  function avoidNumberOverlap(texts, extras) {
    var num = extras.filter(function (x) { return x.matches && x.matches('text.sequenceNumber'); })[0];
    if (!num || !texts.length) return;
    try {
      var nb = num.getBBox();
      var cx = nb.x + nb.width / 2, cy = nb.y + nb.height / 2, r = 11;
      var shift = 0;
      texts.forEach(function (t) {
        var b = t.getBBox();
        var overlapY = b.y < cy + r && b.y + b.height > cy - r;
        var overlapX = b.x < cx + r && b.x + b.width > cx - r;
        if (overlapX && overlapY) shift = Math.max(shift, cx + r + 4 - b.x);
      });
      if (shift > 0) texts.forEach(function (t) { t.setAttribute('x', String(Number(t.getAttribute('x') || 0) + shift)); });
    } catch (e) { /* 失敗しても表示は継続 */ }
  }

  function colorParticipant(g, color, type) {
    var dark = state.theme === 'dark';
    var fill = dark ? mix(color, '#111827', 0.28) : mix(color, '#ffffff', 0.10);
    $$('rect, path', g).forEach(function (s) {
      if (s.closest('defs')) return;
      s.style.fill = fill;
      s.style.stroke = color;
      s.style.strokeWidth = '1.4px';
      // DB テーブルは角を大きく丸め、キューは二重線にして通常のメソッドと見分けやすくする
      if (type === 'db' && s.tagName.toLowerCase() === 'rect') { s.setAttribute('rx', '14'); s.setAttribute('ry', '14'); s.style.strokeWidth = '2px'; }
      if (type === 'queue' && s.tagName.toLowerCase() === 'rect') { s.style.strokeDasharray = '6 2'; s.style.strokeWidth = '2px'; }
      if (type === 'external' && s.tagName.toLowerCase() === 'rect') { s.style.strokeDasharray = '3 2'; }
    });
    $$('line, circle', g).forEach(function (s) { s.style.stroke = color; s.style.strokeWidth = '1.6px'; if (s.tagName.toLowerCase() === 'circle') s.style.fill = fill; });
    $$('text', g).forEach(function (t) { t.style.fill = dark ? '#e5e9f0' : '#0f172a'; });
  }

  function recolorMarker(svg, line, rec, cache) {
    var p = PALETTE[state.theme];
    var colorByKind = { 'k-db': p.db, 'k-db-return': p.db, 'k-throw': p.err, 'k-async': p.async, 'k-message': p.async, 'k-callback': p.async, 'k-event': p.event, 'k-return': p.ret, 'k-lock': p.lock, 'k-await': p.async };
    var kind = (rec.kind || '').split(' ')[0];
    var color = colorByKind[kind];
    if (!color) return;
    var ref = line.getAttribute('marker-end');
    var m = ref && /url\(#([^)]+)\)/.exec(ref);
    if (!m) return;
    var key = m[1] + '|' + color;
    var id = cache[key];
    if (!id) {
      var orig = svg.querySelector('[id="' + m[1] + '"]');
      if (!orig) return;
      var cl = orig.cloneNode(true);
      id = m[1] + '--c' + Object.keys(cache).length;
      cl.setAttribute('id', id);
      $$('path, line, polygon, circle', cl).forEach(function (s) {
        if (s.getAttribute('fill') !== 'none' && s.style.fill !== 'none') s.style.fill = color;
        s.style.stroke = color;
      });
      orig.parentNode.appendChild(cl);
      cache[key] = id;
    }
    line.setAttribute('marker-end', 'url(#' + id + ')');
  }

  /** 日本語化したフラグメント名がラベル枠に収まるよう枠を広げる。 */
  function fitLabelBox(g, label) {
    var poly = g.querySelector('polygon.labelBox');
    if (!poly) return;
    try {
      var pts = poly.getAttribute('points').trim().split(/\s+/).map(function (p) { return p.split(',').map(Number); });
      var xs = pts.map(function (p) { return p[0]; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var need = label.getComputedTextLength() + 18;
      if (need <= maxX - minX) return;
      var grow = need - (maxX - minX);
      pts = pts.map(function (p) { return [p[0] > minX + 1 ? p[0] + grow : p[0], p[1]]; });
      poly.setAttribute('points', pts.map(function (p) { return p.join(','); }).join(' '));
      label.setAttribute('x', String(minX + need / 2));
    } catch (e) { /* 失敗しても表示は継続 */ }
  }

  // ---------------------------------------------------------------------------
  // 描画結果の自己検証（対応付け・文字の重なり・はみ出し）
  // ---------------------------------------------------------------------------
  function selfCheck(svg, gen, els) {
    var res = {
      diagramId: state.diagramId,
      options: { lifelineMode: state.opts.lifelineMode, showArgs: state.opts.showArgs, showExpr: state.opts.showExpr },
      ok: true,
      mapping: els.mode,
      counts: {
        messages: { expected: gen.map.messages.length, mapped: els.msgs.length },
        notes: { expected: gen.map.notes.length, mapped: els.notes.length },
        fragments: { expected: gen.map.fragments.length, mapped: els.frags.length },
        participants: { expected: gen.map.participants.length, mapped: els.parts.size }
      },
      problems: els.problems.slice(),
      overlaps: [],
      clipped: [],
      size: { w: Math.round(state.natural.w), h: Math.round(state.natural.h) }
    };
    try {
      var items = [];
      var owner = function (el) {
        var g = el.closest('[data-sq]');
        return g ? g.getAttribute('data-sq') : el.closest('[data-et]') ? 'et:' + el.closest('[data-et]').getAttribute('data-id') : 'x';
      };
      $$('text.messageText, text.noteText, text.labelText, text.loopText, text.sectionTitle', svg).forEach(function (t) {
        if (!t.textContent.trim() || t.textContent === '\u200b') return;
        var b = t.getBBox();
        if (b.width < 1 || b.height < 1) return;
        items.push({ el: t, b: b, owner: owner(t), cls: t.getAttribute('class'), kind: /labelText/.test(t.getAttribute('class')) ? 'label' : 'text' });
      });
      // \u9023\u756a\u306e\u4e38\u5370\uff08\u6570\u5b57\u306e\u5468\u308a\u306e\u5186\uff09\u3082\u691c\u67fb\u5bfe\u8c61\u306b\u3059\u308b
      $$('text.sequenceNumber', svg).forEach(function (t) {
        var nb = t.getBBox();
        if (nb.width < 1) return;
        var cx = nb.x + nb.width / 2, cy = nb.y + nb.height / 2;
        items.push({ el: t, b: { x: cx - 9, y: cy - 9, width: 18, height: 18 }, owner: owner(t), cls: 'sequenceNumber', kind: 'num' });
      });
      $$('.actor-top text, [data-et="participant"] text', svg).forEach(function (t) {
        var b = t.getBBox();
        if (b.width < 1) return;
        items.push({ el: t, b: b, owner: owner(t), cls: 'actor' });
      });
      items.sort(function (a, b) { return a.b.y - b.b.y; });
      for (var i = 0; i < items.length; i++) {
        var A = items[i];
        for (var j = i + 1; j < items.length; j++) {
          var B = items[j];
          if (B.b.y > A.b.y + A.b.height) break;
          // 同じ要素の中の文字どうし（複数行など）は除外。ただし見出し・連番と本文の重なりは検出する
          if (A.owner === B.owner && A.kind === B.kind) continue;
          if (A.owner === B.owner && A.kind === 'text' && B.kind === 'text') continue;
          if (A.kind === 'num' && B.kind === 'num') continue;
          if ((A.kind === 'num' || B.kind === 'num') && (A.kind === 'label' || B.kind === 'label')) continue;
          var ox = Math.min(A.b.x + A.b.width, B.b.x + B.b.width) - Math.max(A.b.x, B.b.x);
          var oy = Math.min(A.b.y + A.b.height, B.b.y + B.b.height) - Math.max(A.b.y, B.b.y);
          if (ox <= 1 || oy <= 1) continue;
          var area = ox * oy, small = Math.min(A.b.width * A.b.height, B.b.width * B.b.height);
          if (area > 12 && area > small * 0.15) {
            res.overlaps.push({ a: A.el.textContent.slice(0, 40), b: B.el.textContent.slice(0, 40), aOwner: A.owner, bOwner: B.owner, x: Math.round(A.b.x), y: Math.round(A.b.y) });
          }
        }
      }
      var W = state.natural.w, H = state.natural.h;
      var vb = svg.viewBox.baseVal;
      items.forEach(function (it) {
        var b = it.b;
        if (b.x < vb.x - 1 || b.y < vb.y - 1 || b.x + b.width > vb.x + W + 1 || b.y + b.height > vb.y + H + 1) {
          res.clipped.push({ text: it.el.textContent.slice(0, 40), owner: it.owner });
        }
      });
    } catch (e) {
      res.problems.push({ level: 'warning', message: '重なり検査に失敗: ' + e.message });
    }
    res.ok = !res.problems.some(function (p) { return p.level === 'error'; }) && res.overlaps.length === 0 && res.clipped.length === 0;
    return res;
  }

  // ---------------------------------------------------------------------------
  // ズーム・パン
  // ---------------------------------------------------------------------------
  function applyZoom(z, anchor) {
    var canvas = $('#canvas');
    var svg = state.svg;
    z = clamp(z, 0.08, 4);
    if (!svg) { state.zoom = z; return; }
    var prev = state.zoom;
    var ax, ay, cx, cy;
    if (anchor) {
      var rect = canvas.getBoundingClientRect();
      ax = anchor.x - rect.left; ay = anchor.y - rect.top;
      cx = (canvas.scrollLeft + ax - 28) / prev;
      cy = (canvas.scrollTop + ay - 28) / prev;
    }
    state.zoom = z;
    svg.setAttribute('width', String(Math.round(state.natural.w * z)));
    svg.setAttribute('height', String(Math.round(state.natural.h * z)));
    svg.style.width = Math.round(state.natural.w * z) + 'px';
    svg.style.height = Math.round(state.natural.h * z) + 'px';
    if (anchor) {
      canvas.scrollLeft = cx * z + 28 - ax;
      canvas.scrollTop = cy * z + 28 - ay;
    }
    $('#zoomReset').textContent = Math.round(z * 100) + '%';
    positionSticky();
    updateStatus();
    drawMinimap();
  }
  /** ボタン・キーでのズーム。選択中の要素（なければ表示領域の中央）を基準にして、見ていた場所を保つ。 */
  function zoomBy(factor) {
    var canvas = $('#canvas');
    var rect = canvas.getBoundingClientRect();
    var anchor = { x: rect.left + canvas.clientWidth / 2, y: rect.top + canvas.clientHeight / 2 };
    var sel = state.svg && state.svg.querySelector('.is-selected');
    if (sel) {
      var b = sel.getBoundingClientRect();
      var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      if (cx > rect.left && cx < rect.right && cy > rect.top && cy < rect.bottom) anchor = { x: cx, y: cy };
    }
    applyZoom(state.zoom * factor, anchor);
  }
  function fitZoom(mode) {
    var canvas = $('#canvas');
    var w = canvas.clientWidth - 70, hh = canvas.clientHeight - 90;
    var zw = w / state.natural.w, zh = hh / state.natural.h;
    var z = mode === 'width' ? zw : Math.min(zw, zh);
    applyZoom(clamp(z, 0.08, mode === 'width' ? 2 : 1.5));
    if (mode !== 'width') { canvas.scrollLeft = 0; canvas.scrollTop = 0; }
  }
  function initialZoom() {
    var z = params.get('zoom');
    if (z) { applyZoom(z === 'fit' ? 1 : Number(z) || 1); if (z === 'fit') fitZoom('all'); else if (z === 'width') fitZoom('width'); return; }
    var canvas = $('#canvas');
    var fw = (canvas.clientWidth - 70) / state.natural.w;
    // 文字が読める倍率(80%以上)を優先し、全体は「全体表示」で確認する
    applyZoom(clamp(fw, 0.8, 1));
  }

  // ---------------------------------------------------------------------------
  // 固定ヘッダー（スクロール時にライフライン名を上部に表示）
  // ---------------------------------------------------------------------------
  function buildSticky() {
    var box = $('#stickyHeads');
    box.innerHTML = '';
    if (!state.els || !state.els.parts.size) return;
    var bar = document.createElement('div');
    bar.className = 'sh-bar';
    box.appendChild(bar);
    state.els.parts.forEach(function (info, mId) {
      var layer = model._index.layers.get(info.rec.layer) || { color: '#64748b' };
      var d = document.createElement('div');
      d.className = 'sh-item';
      // 2 段表示: 上段にメソッド名（区別に必要な部分）、下段に「種別：クラス名」
      var ll = model._index.lifelines.get(info.rec.lifelines[0]) || {};
      var top = info.rec.lifelines.length > 1 || !ll.method || ll.type === 'db' || ll.type === 'queue' || ll.type === 'actor' ? info.rec.label : ll.method;
      var sub = top === info.rec.label ? '' : (ll._kind ? ll._kind + '：' : '') + (ll['class'] || '');
      var t1 = document.createElement('b'); t1.textContent = top;
      d.appendChild(t1);
      if (sub) { var t2 = document.createElement('span'); t2.textContent = sub; d.appendChild(t2); }
      d.title = info.rec.label;
      d.style.borderTopColor = layer.color;
      d.setAttribute('data-mid', mId);
      d.addEventListener('click', function () { selectParticipant(mId, { scroll: false }); });
      box.appendChild(d);
    });
    positionSticky();
  }
  function positionSticky() {
    var box = $('#stickyHeads');
    if (!state.els) return;
    var z = state.zoom;
    var bar = box.querySelector('.sh-bar');
    if (bar) bar.style.width = Math.round(state.natural.w * z) + 'px';
    $$('.sh-item', box).forEach(function (d) {
      var info = state.els.parts.get(d.getAttribute('data-mid'));
      if (!info) return;
      d.style.left = Math.round(info.cx * z) + 'px';
      d.style.maxWidth = Math.max(80, Math.round(info.box.width * z + 40)) + 'px';
    });
    updateStickyVisibility();
  }
  function updateStickyVisibility() {
    var box = $('#stickyHeads');
    if (!state.els || !state.els.parts.size) { box.classList.add('is-hidden'); return; }
    var maxBottom = 0;
    state.els.parts.forEach(function (info) { maxBottom = Math.max(maxBottom, info.box.y + info.box.height); });
    var show = $('#canvas').scrollTop > maxBottom * state.zoom + 20;
    box.classList.toggle('is-hidden', !show);
  }

  // ---------------------------------------------------------------------------
  // ミニマップ（図全体の縮図と現在の表示範囲。クリック・ドラッグで移動）
  // ---------------------------------------------------------------------------
  var mini = { scale: 1, w: 0, h: 0 };
  function drawMinimap() {
    var cv = $('#minimap');
    if (!cv || !state.els || !state.svg) return;
    var box = $('#minimapBox');
    var canvas = $('#canvas');
    var big = state.natural.w * state.zoom > canvas.clientWidth * 1.15 || state.natural.h * state.zoom > canvas.clientHeight * 1.15;
    box.hidden = !big || !lsGet('minimap', true);
    if (box.hidden) return;
    var maxW = 220, maxH = 170;
    var s = Math.min(maxW / state.natural.w, maxH / state.natural.h);
    mini.scale = s; mini.w = Math.max(40, Math.round(state.natural.w * s)); mini.h = Math.max(30, Math.round(state.natural.h * s));
    var dpr = window.devicePixelRatio || 1;
    cv.width = mini.w * dpr; cv.height = mini.h * dpr;
    cv.style.width = mini.w + 'px'; cv.style.height = mini.h + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var p = PALETTE[state.theme];
    var vb = state.svg.viewBox.baseVal;
    var X = function (x) { return (x - vb.x) * s; }, Y = function (y) { return (y - vb.y) * s; };
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, mini.w, mini.h);
    ctx.lineWidth = 1;
    state.els.frags.forEach(function (f) {
      try { var b = f.g.getBBox(); ctx.strokeStyle = p.frag[f.rec.role === 'try' ? 'try' : f.rec.keyword] || p.muted; ctx.strokeRect(X(b.x), Y(b.y), b.width * s, b.height * s); } catch (e) { /* 無視 */ }
    });
    state.els.parts.forEach(function (info) {
      var layer = model._index.layers.get(info.rec.layer) || { color: '#64748b' };
      ctx.strokeStyle = layer.color; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(X(info.cx), 0); ctx.lineTo(X(info.cx), mini.h); ctx.stroke();
      ctx.globalAlpha = 1;
    });
    var kindColor = { 'k-db': p.db, 'k-db-return': p.db, 'k-throw': p.err, 'k-async': p.async, 'k-message': p.async, 'k-callback': p.async, 'k-event': p.event };
    state.els.msgs.forEach(function (m) {
      var lb;
      try { lb = m.line.getBBox(); } catch (e) { return; }
      var x1 = lb.x, x2 = lb.x + Math.max(lb.width, 20), y1 = lb.y + lb.height / 2;
      ctx.strokeStyle = m.g.classList.contains('is-selected') ? p.sel : (kindColor[(m.rec.kind || '').split(' ')[0]] || p.call);
      ctx.lineWidth = m.g.classList.contains('is-selected') ? 2.5 : 1;
      ctx.beginPath(); ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y1)); ctx.stroke();
    });
    // 表示範囲
    var z = state.zoom;
    var vx = (canvas.scrollLeft - 28) / z, vy = (canvas.scrollTop - 28) / z;
    var vw = canvas.clientWidth / z, vh = canvas.clientHeight / z;
    ctx.lineWidth = 2; ctx.strokeStyle = p.sel; ctx.fillStyle = p.sel; ctx.globalAlpha = 0.12;
    ctx.fillRect(vx * s, vy * s, vw * s, vh * s);
    ctx.globalAlpha = 1;
    ctx.strokeRect(vx * s, vy * s, vw * s, vh * s);
  }
  function minimapJump(ev) {
    var cv = $('#minimap');
    var r = cv.getBoundingClientRect();
    var x = (ev.clientX - r.left) / mini.scale, y = (ev.clientY - r.top) / mini.scale;
    var canvas = $('#canvas');
    canvas.scrollLeft = x * state.zoom + 28 - canvas.clientWidth / 2;
    canvas.scrollTop = y * state.zoom + 28 - canvas.clientHeight / 2;
  }

  // ---------------------------------------------------------------------------
  // 選択・強調
  // ---------------------------------------------------------------------------
  function clearMarks() {
    if (!state.svg) return;
    $$('.is-selected, .is-related', state.svg).forEach(function (e) { e.classList.remove('is-selected', 'is-related'); });
    state.svg.classList.remove('sq-dim');
    $$('.ol-row.is-selected').forEach(function (e) { e.classList.remove('is-selected'); });
  }

  function msgIdxsForStep(stepId) {
    if (!state.els) return [];
    return state.els.msgs.filter(function (m) { return m.rec.stepId === stepId || m.rec.callStepId === stepId; }).map(function (m) { return m.idx; });
  }

  /**
   * 再描画後に選択を復元する。ただし選択が今の図に存在しない場合は復元しない
   * （別の図のステップを選び直すと、その図へ戻ってしまい、図の移動ができなくなるため）。
   */
  function reapplySelection() {
    var s = state.selection;
    if (!s) return;
    if (s.type === 'lifeline') {
      var inThis = state.gen && state.gen.map.participants.some(function (p) { return p.lifelines.indexOf(s.llId) >= 0; });
      if (inThis) selectLifeline(s.llId, { scroll: false, keepPanel: true }); else state.selection = null;
    } else if (s.type === 'participant') {
      if (state.els && state.els.parts.has(s.mId)) selectParticipant(s.mId, { scroll: false, keepPanel: true }); else state.selection = null;
    } else if (s.stepId) {
      var st = model._index.steps.get(s.stepId);
      var visibleHere = st && (st._diagram === state.diagramId || findStepElements(s.stepId).msgs.length > 0);
      if (visibleHere) selectStep(s.stepId, { scroll: false, keepPanel: true, msgIdx: s.msgIdx, noteIdx: s.noteIdx, fragIdx: s.fragIdx });
      else state.selection = null;
    }
  }

  function findStepElements(stepId) {
    var out = { msgs: [], notes: [], frags: [] };
    if (!state.els) return out;
    state.els.msgs.forEach(function (m) { if (m.rec.stepId === stepId || m.rec.callStepId === stepId) out.msgs.push(m); });
    state.els.notes.forEach(function (n) { if (n.rec.stepId === stepId) out.notes.push(n); });
    state.els.frags.forEach(function (f) { if (f.rec.stepId === stepId) out.frags.push(f); });
    return out;
  }

  /** ステップが現在の図で非表示（折りたたみ中）なら展開する。別の図なら図を切り替える。 */
  function ensureStepVisible(stepId) {
    var step = model._index.steps.get(stepId);
    if (!step) return Promise.resolve(false);
    var target = step._diagram;
    var p = Promise.resolve(true);
    // その場展開中の ref の内側にあるステップは現在の図で表示できる
    var shownHere = false;
    if (state.diagramId !== target && state.els) shownHere = findStepElements(stepId).msgs.length > 0;
    var switched = false;
    if (state.diagramId !== target && !shownHere) {
      state.diagramId = target;
      state.selection = null; // 前の図の選択を新しい図に持ち込まない
      switched = true;
      p = render({ initialZoom: true });
    }
    return p.then(function () {
      var col = state.collapsed[state.diagramId];
      var need = false;
      var d = model._index.diagrams.get(state.diagramId);
      Core.walkSteps(d.steps, function (s, parent, depth, anc) {
        if (s.id === stepId) anc.forEach(function (a) { if (a.type === 'group' && col.has(a.id)) { col.delete(a.id); need = true; } });
      });
      if (need) return render({ keepScroll: true }).then(function () { return switched; });
      return switched; // 図を切り替えたかどうか（履歴に積むかの判断に使う）
    });
  }

  function selectStep(stepId, o) {
    o = o || {};
    var step = model._index.steps.get(stepId);
    if (!step) { toast('ステップ ' + stepId + ' が見つかりません'); return Promise.resolve(); }
    // 非同期の描画を待つ間に別の操作（図の切替など）があれば、この選択は破棄する
    var nav = ++state.navSeq;
    return ensureStepVisible(stepId).then(function (switchedDiagram) {
      if (nav !== state.navSeq) return;
      clearMarks();
      var found = findStepElements(stepId);
      state.selection = { type: 'step', stepId: stepId, msgIdx: o.msgIdx, noteIdx: o.noteIdx, fragIdx: o.fragIdx };
      var firstEl = null, firstMsg = null;
      found.msgs.forEach(function (m) {
        m.g.classList.add(o.msgIdx === undefined || o.msgIdx === m.idx ? 'is-selected' : 'is-related');
        if (!firstEl || o.msgIdx === m.idx) { firstEl = m.g; firstMsg = m; }
      });
      found.notes.forEach(function (n) { n.g.classList.add('is-selected'); if (!firstEl) firstEl = n.g; });
      found.frags.forEach(function (f) { f.g.classList.add('is-selected'); if (!firstEl) firstEl = f.g; });
      // 送受信のライフラインも強調
      found.msgs.forEach(function (m) {
        [m.rec.mFrom, m.rec.mTo].forEach(function (mid) {
          var info = state.els.parts.get(mid);
          if (info && info.line) info.line.classList.add('is-selected');
        });
      });
      $$('.ol-row[data-step="' + cssEsc(stepId) + '"]').forEach(function (r) {
        r.classList.add('is-selected');
        if (o.scroll !== false) r.scrollIntoView({ block: 'nearest' });
      });
      if (!o.keepPanel) { revealPanel(); renderStepPanel(step, o); showPanel('detail'); }
      if (firstEl && o.scroll !== false) scrollToEl(firstEl, firstEl === (firstMsg && firstMsg.g) ? firstMsg : null);
      drawMinimap();
      if (!found.msgs.length && !found.notes.length && !found.frags.length && o.scroll !== false) {
        toast('このステップは現在の表示設定では図に表示されていません（詳細のみ表示）');
      }
      // 別の図へ移動した場合は履歴に積み、ブラウザの「戻る」で元の図に戻れるようにする
      updateHash(switchedDiagram === true);
    });
  }

  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

  function selectParticipant(mId, o) {
    o = o || {};
    var info = state.els && state.els.parts.get(mId);
    if (!info) return;
    var llId = info.rec.lifelines[0];
    if (info.rec.lifelines.length > 1) {
      // クラス単位表示: 参加者に複数のメソッドが集約されている
      clearMarks();
      state.selection = { type: 'participant', mId: mId };
      markParticipant(mId);
      if (!o.keepPanel) { revealPanel(); renderParticipantPanel(info); showPanel('detail'); }
      updateHash(false);
      return;
    }
    selectLifeline(llId, o);
  }

  function markParticipant(mId) {
    var info = state.els.parts.get(mId);
    if (!info) return;
    info.top.classList.add('is-selected');
    info.bottoms.forEach(function (b) { b.classList.add('is-selected'); });
    if (info.line) info.line.classList.add('is-selected');
    state.els.msgs.forEach(function (m) {
      if (m.rec.mFrom === mId || m.rec.mTo === mId) m.g.classList.add('is-related');
    });
    state.svg.classList.add('sq-dim');
  }

  function selectLifeline(llId, o) {
    o = o || {};
    var ll = model._index.lifelines.get(llId);
    if (!ll) return;
    clearMarks();
    state.selection = { type: 'lifeline', llId: llId };
    var mId = null;
    if (state.els) state.els.parts.forEach(function (info, k) { if (info.rec.lifelines.indexOf(llId) >= 0) mId = k; });
    if (mId) {
      markParticipant(mId);
      if (o.scroll !== false) {
        var info = state.els.parts.get(mId);
        scrollToX(info.cx);
      }
    }
    if (!o.keepPanel) { revealPanel(); renderLifelinePanel(ll); showPanel('detail'); }
    updateHash(false);
  }

  function clearSelection() {
    clearMarks();
    state.selection = null;
    renderEmptyDetail();
    updateHash(false);
  }

  /**
   * 要素が見えるようにスクロールする。長い矢印は両端（送信元・送信先）が収まるよう必要なら縮小し、
   * それでも収まらない場合は送信元の端を表示する。
   */
  function scrollToEl(el, msg) {
    var canvas = $('#canvas');
    var b = el.getBBox();
    var avail = canvas.clientWidth - 80;
    if (msg && b.width * state.zoom > avail) {
      var need = avail / b.width;
      if (need >= 0.5) applyZoom(Math.min(state.zoom, need));
    }
    var z = state.zoom;
    var x = b.x * z + 28, y = b.y * z + 28;
    var targetX = x - canvas.clientWidth / 2 + (b.width * z) / 2;
    if (msg && b.width * z > avail) {
      // 送信元の側を表示（右向きの矢印は左端、左向きは右端）
      var fromInfo = state.els.parts.get(msg.rec.mFrom), toInfo = state.els.parts.get(msg.rec.mTo);
      var fromX = fromInfo ? fromInfo.cx : b.x;
      var rightward = !toInfo || !fromInfo || toInfo.cx >= fromInfo.cx;
      targetX = rightward ? fromX * z + 28 - 60 : fromX * z + 28 - canvas.clientWidth + 60;
    }
    var targetY = y - canvas.clientHeight / 2.6;
    canvas.scrollTo({ left: Math.max(0, targetX), top: Math.max(0, targetY), behavior: params.get('verify') ? 'auto' : 'smooth' });
  }
  function scrollToX(cx) {
    var canvas = $('#canvas');
    var x = cx * state.zoom + 28 - canvas.clientWidth / 2;
    canvas.scrollTo({ left: Math.max(0, x), top: canvas.scrollTop, behavior: 'smooth' });
  }

  function moveSelection(delta) {
    if (!state.els || !state.els.msgs.length) return;
    var cur = -1;
    var s = state.selection;
    if (s && s.type === 'step') {
      if (s.msgIdx !== undefined) cur = s.msgIdx;
      else { var ix = msgIdxsForStep(s.stepId); if (ix.length) cur = ix[0]; }
    }
    var next = clamp(cur + delta, 0, state.els.msgs.length - 1);
    if (cur < 0) next = delta > 0 ? 0 : state.els.msgs.length - 1;
    var m = state.els.msgs[next];
    selectStep(m.rec.stepId, { msgIdx: next, scroll: true });
  }

  // ---------------------------------------------------------------------------
  // 詳細パネル
  // ---------------------------------------------------------------------------
  /** 狭い画面ではパネルを閉じているため、要素を選んだときに開く。 */
  function revealPanel() {
    if (window.innerWidth <= 860 && !params.get('verify')) $('#app').classList.remove('panel-hidden');
  }

  var currentTab = 'detail';
  function showPanel(tab) {
    currentTab = tab || currentTab;
    $$('.ptab').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-tab') === currentTab); });
    if (currentTab === 'overview') renderOverview();
    else if (currentTab === 'verify') renderVerifyPanel();
    else if (currentTab === 'source') renderSourcePanel();
    else if (!state.selection) renderEmptyDetail();
    else if (state.selection.type === 'step') renderStepPanel(model._index.steps.get(state.selection.stepId), state.selection);
    else if (state.selection.type === 'lifeline') renderLifelinePanel(model._index.lifelines.get(state.selection.llId));
    else if (state.selection.type === 'participant') renderParticipantPanel(state.els.parts.get(state.selection.mId));
  }
  function setPanel(html) {
    $('#panelBody').innerHTML = html;
    $('#panelBody').scrollTop = 0;
  }

  var STEP_TYPE_LABELS = {
    call: 'メソッド呼び出し', self: '自己メッセージ（内部処理）', db: 'DBアクセス', 'return': 'return（戻り）', 'throw': '例外送出',
    'try': '例外処理（try-catch）', alt: '条件分岐', opt: '条件付き実行', loop: '繰り返し', par: '並列処理', critical: '排他処理',
    'break': '処理中断', ref: '詳細参照', note: '注記', transaction: 'トランザクション', tx: 'トランザクション制御',
    lock: 'ロック操作', 'await': '非同期処理の完了待ち', group: '処理グループ'
  };
  var MODE_LABELS = { sync: '同期呼び出し', async: '非同期呼び出し', event: 'イベント発行', message: 'メッセージ送信（キュー）', callback: 'コールバック' };
  var CATEGORY_LABELS = { input: '入力値の加工', calc: '計算', condition: '条件判定', create: 'オブジェクト生成', convert: 'データ変換', state: '状態変更', log: 'ログ出力', validate: '入力チェック', other: 'その他' };

  function llLink(id) {
    var ll = model._index.lifelines.get(id);
    if (!ll) return h(id || '（不明）');
    return '<a class="ll-ref" data-act="ll" data-id="' + h(id) + '">' + wbr(ll._label) + '</a>';
  }
  /** 改行してよい位置（. ： < , の後）に <wbr> を入れ、長い識別子が途中で不自然に折れないようにする。 */
  function wbr(s) { return h(s).replace(/(\.|：|&lt;|,)/g, '$1<wbr>'); }
  function evBadge(ev) {
    if (!ev) return '';
    return '<span class="badge ev-' + h(ev.status) + '">' + h(Core.EVIDENCE_LABELS[ev.status] || ev.status) + '</span>';
  }
  function sec(title, body) { return body ? '<section class="pd-sec"><h4>' + h(title) + '</h4>' + body + '</section>' : ''; }
  function kv(rows) {
    var r = rows.filter(function (x) { return x[1] !== undefined && x[1] !== null && x[1] !== ''; });
    if (!r.length) return '';
    return '<dl class="kv">' + r.map(function (x) { return '<dt>' + h(x[0]) + '</dt><dd>' + (x[2] ? x[1] : h(x[1])) + '</dd>'; }).join('') + '</dl>';
  }
  function para(t) { return t ? '<p class="pd-text">' + h(t) + '</p>' : ''; }

  function argsTable(args) {
    if (!args || !args.length) return '';
    return '<table class="tbl"><thead><tr><th>プロパティ名</th><th>日本語名</th><th>型</th><th>説明</th></tr></thead><tbody>' +
      args.map(function (a) {
        var desc = [a.description, a.value !== undefined ? '値: ' + a.value : ''].filter(Boolean).join('\n');
        return '<tr><td class="mono">' + wbr(a.name) + '</td><td>' + h(a.jpName || '') + '</td><td class="mono type">' + wbr(a.type || '（不明）') + '</td><td style="white-space:pre-wrap">' + h(desc) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  function returnsBlock(r) {
    if (!r) return '';
    return kv([['名称', r.name], ['日本語名', r.jpName], ['型', r.type], ['意味', r.description], ['呼び出し元での利用目的', r.usage], ['件数・制約', r.rows]]);
  }

  function evidenceBlock(ev) {
    if (!ev) return '';
    var parts = [];
    var stTxt = Core.EVIDENCE_LABELS[ev.status] || ev.status;
    var note = ev._inherited && !ev.refs.length ? '（根拠が記載されていないため既定の「' + stTxt + '」として表示）' : '';
    parts.push('<div class="pd-head">' + evBadge(ev) + (note ? '<span class="muted">' + h(note) + '</span>' : '') + '</div>');
    if (ev.note) parts.push(para(ev.note));
    ev.refs.forEach(function (r) { parts.push(snippetHtml(r)); });
    return parts.join('');
  }

  function snippetHtml(r) {
    var label = Core.refToString(r);
    var link = '';
    if (r.file && build && build.sourceRootAbs && !/^https?:/.test(r.file)) {
      var abs = (build.sourceRootAbs.replace(/\\/g, '/').replace(/\/$/, '') + '/' + r.file.replace(/\\/g, '/').replace(/^\.\//, ''));
      link = '<a href="vscode://file/' + h(encodeURI(abs)) + (r.line ? ':' + r.line : '') + '" title="VS Code で開く">VS Codeで開く</a>';
    } else if (r.url || /^https?:/.test(r.file || '')) {
      link = '<a href="' + h(r.url || r.file) + '" target="_blank" rel="noopener">開く</a>';
    }
    var body = '';
    var seg = findSourceSegment(r);
    if (seg) {
      var from = Math.max(seg.start, (r.line || seg.start) - 1);
      var to = Math.min(seg.start + seg.lines.length - 1, (r.endLine || r.line || seg.start) + 1);
      var rows = [];
      for (var n = from; n <= to; n++) {
        var inRange = r.line && n >= r.line && n <= (r.endLine || r.line);
        rows.push('<tr' + (inRange ? ' style="background:var(--accent-weak)"' : '') + '><td class="ln">' + n + '</td><td>' + h(seg.lines[n - seg.start]) + '</td></tr>');
      }
      body = '<div class="snippet-body"><table>' + rows.join('') + '</table></div>';
    } else if (r.quote) {
      body = '<div class="snippet-body"><pre class="code wrap" style="border:0;border-radius:0">' + h(r.quote) + '</pre></div>';
    }
    return '<div class="snippet"><div class="snippet-head"><span>' + h(label) + '</span>' + link + '</div>' + body + '</div>';
  }
  function findSourceSegment(r) {
    if (!build || !build.sources || !r.file) return null;
    var segs = build.sources[r.file];
    if (!segs || !r.line) return null;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.start <= r.line && s.start + s.lines.length - 1 >= r.line) return s;
    }
    return null;
  }

  /** ステップの祖先（どの分岐・繰り返しの中か）を表示用に返す。 */
  function contextPath(step) {
    var d = model._index.diagrams.get(step._diagram);
    var path = [];
    Core.walkSteps(d.steps, function (s, parent, depth, anc) {
      if (s.id !== step.id) return;
      anc.forEach(function (a, i) {
        var next = anc[i + 1] || s;
        var label = STEP_TYPE_LABELS[a.type] || a.type;
        if (a.type === 'call') { path.push('呼出：' + (a.label || a.to)); return; }
        if (a.type === 'alt' || a.type === 'par') {
          var b = a.branches.filter(function (br) { return br.steps.indexOf(next) >= 0; })[0];
          path.push(label + '［' + (b ? (b.condition || b.label || 'それ以外') : '') + '］');
          return;
        }
        if (a.type === 'try') {
          var c = a.catches.filter(function (br) { return br.steps.indexOf(next) >= 0; })[0];
          var inFinally = a['finally'] && a['finally'].steps.indexOf(next) >= 0;
          path.push(c ? 'catch［' + c.exception + '］' : inFinally ? 'finally' : 'try');
          return;
        }
        if (a.type === 'critical') {
          var op = a.options.filter(function (br) { return br.steps.indexOf(next) >= 0; })[0];
          path.push(label + (op ? '／option［' + op.condition + '］' : '［' + (a.label || '') + '］'));
          return;
        }
        path.push(label + (a.condition || a.label ? '［' + (a.condition || a.label) + '］' : ''));
      });
    });
    return path;
  }

  function stepNumbers(stepId) {
    return msgIdxsForStep(stepId).map(function (i) { return '#' + (i + 1); });
  }

  function renderStepPanel(step, o) {
    if (!step) { renderEmptyDetail(); return; }
    o = o || {};
    var out = [];
    var nums = stepNumbers(step.id);
    var head = '<div class="pd-head">' + (nums.length ? '<span class="badge b-num">' + h(nums.join(' / ')) + '</span>' : '') +
      '<span class="badge b-kind">' + h(STEP_TYPE_LABELS[step.type] || step.type) + '</span>';
    if (step.type === 'call') head += '<span class="badge ' + (step.mode === 'sync' ? 'b-sync' : 'b-async') + '">' + h(MODE_LABELS[step.mode] || step.mode) + '</span>';
    if (step.type === 'db') head += '<span class="badge b-db">' + h(step.op) + '</span>';
    if (step.type === 'throw') head += '<span class="badge b-err">' + h(step.exception) + '</span>';
    head += evBadge(step.evidence) + '</div>';
    out.push(head);
    var title = step.label || step.condition || step.text || step.exception || (step.type === 'db' ? step.op + ' ' + step.table : '') || STEP_TYPE_LABELS[step.type];
    out.push('<div class="pd-title">' + h(title) + '</div>');
    var ctx = contextPath(step);
    if (ctx.length) out.push('<div class="ctx-path">' + ctx.map(function (c) { return '<span>' + h(c) + '</span>'; }).join('') + '</div>');

    var frameFrom = step.from || inferFrom(step);
    switch (step.type) {
      case 'call':
        out.push('<div class="pd-flow"><div>' + llLink(frameFrom) + '</div><div class="arrow">→</div><div>' + llLink(step.to) + '</div></div>');
        out.push(sec('呼び出しの目的', para(step.purpose)));
        out.push(sec('引数', argsTable(step.args) || '<p class="muted">引数なし（または記載なし）</p>'));
        out.push(sec('戻り値', returnsBlock(step.returns) || (step.mode === 'sync' ? '<p class="muted">戻り値なし（void）または記載なし</p>' : '')));
        out.push(sec('呼び出し方式', kv([['区分', MODE_LABELS[step.mode] || step.mode], ['ディスパッチ／経由', step.via], ['補足', step.note]])));
        if (step.ref) {
          var rd = model._index.diagrams.get(step.ref);
          var inner = Core.resolveRefInner(model, step);
          out.push(sec('詳細参照', '<p class="pd-text">内部処理は「' + h(rd ? rd.title : step.ref) + '」に分割されています。</p><div class="btn-row"><button class="link-btn" data-act="open-diagram" data-id="' + h(step.ref) + '">詳細図を開く →</button>' +
            (inner ? '<button class="link-btn" data-act="toggle-expand" data-id="' + h(step.id) + '">' + (state.expandRefs.has(step.id) ? 'この場の展開を戻す' : 'この図の中で展開') + '</button>' : '') + '</div>'));
        }
        break;
      case 'db':
        out.push('<div class="pd-flow"><div>' + llLink(frameFrom) + '</div><div class="arrow">→</div><div>' + llLink(step.to) + '</div></div>');
        out.push(sec('操作内容', kv([
          ['操作', step.op], ['対象テーブル', step.table], ['主要カラム', step.columns.join(', ')], ['WHERE条件', step.where],
          ['JOIN', step.joins.join('\n')], ['並び順', step.orderBy], ['取得件数の制約', step.limit], ['ロック', step.lock],
          ['設定値（SET/VALUES）', step.set || step.values], ['経由（ORM/Mapper）', step.via]
        ])));
        out.push(sec('目的', para(step.purpose)));
        if (step.stateChange) out.push(sec('更新前後の状態', kv([['更新前', step.stateChange.before], ['更新後', step.stateChange.after], ['補足', step.stateChange.note]])));
        out.push(sec('結果', returnsBlock(step.result)));
        if (step.sql) out.push(sec('SQL', '<pre class="code wrap">' + h(step.sql) + '</pre><div class="btn-row"><button class="copy-btn" data-act="copy" data-text="' + h(step.sql) + '">SQLをコピー</button></div>'));
        break;
      case 'self':
        out.push(kv([['実行ライフライン', llLink(step.on || frameFrom), true], ['分類', CATEGORY_LABELS[step.category] || step.category]]));
        out.push(sec('処理内容', para(step.detail)));
        if (step.code) out.push(sec('コード', '<pre class="code">' + h(step.code) + '</pre>'));
        if (step.stateChange) out.push(sec('状態変更', kv([['変更前', step.stateChange.before], ['変更後', step.stateChange.after]])));
        break;
      case 'return':
        out.push(sec('戻り値', returnsBlock(step.value) || para(step.label)));
        out.push(sec('条件・補足', para(step.detail || step.note)));
        break;
      case 'throw':
        out.push(sec('例外', kv([['例外の種類', step.exception], ['メッセージ', step.message], ['発生条件', step.condition], ['伝播先', step.propagateTo ? llLink(step.propagateTo) : '直接の呼び出し元', !!step.propagateTo], ['送出先（明示）', step.to ? llLink(step.to) : '', true]])));
        out.push(sec('補足', para(step.detail || step.note)));
        break;
      case 'alt': case 'par':
        out.push(sec(step.type === 'alt' ? '分岐' : '並列に実行される処理', '<table class="tbl"><thead><tr><th>' + (step.type === 'alt' ? '条件（業務上の意味）' : '処理') + '</th><th>コード上の条件式</th><th>区間内のステップ数</th></tr></thead><tbody>' +
          step.branches.map(function (b) {
            return '<tr><td>' + h(b.condition || b.label || (b['else'] ? 'それ以外' : '')) + '</td><td class="mono">' + h(b.expr || '') + '</td><td>' + countSteps(b.steps) + '</td></tr>';
          }).join('') + '</tbody></table>'));
        if (step.type === 'par') out.push(sec('並列化の仕組み', para(step.mechanism || step.note)));
        out.push(sec('補足', para(step.detail || (step.type === 'alt' ? step.note : ''))));
        break;
      case 'opt': case 'loop': case 'break':
        out.push(sec('条件', kv([['業務上の意味', step.condition], ['コード上の条件式', step.expr]])));
        out.push(sec('補足', para(step.detail || step.note)));
        break;
      case 'critical':
        out.push(sec('排他制御', kv([['対象リソース', step.lock && step.lock.resource], ['仕組み', step.lock && step.lock.mechanism], ['取得', step.lock && step.lock.acquire], ['解放', step.lock && step.lock.release], ['待機/タイムアウト', step.lock && step.lock.timeout]])));
        if (step.options.length) out.push(sec('例外的な状況（option）', '<ul class="list">' + step.options.map(function (o2) { return '<li>' + h(o2.condition) + '</li>'; }).join('') + '</ul>'));
        break;
      case 'try':
        out.push(sec('捕捉する例外', '<table class="tbl"><thead><tr><th>例外</th><th>対応</th></tr></thead><tbody>' + step.catches.map(function (c) { return '<tr><td class="mono">' + h(c.exception) + '</td><td>' + h(c.label || '') + '</td></tr>'; }).join('') + '</tbody></table>'));
        if (step['finally']) out.push(sec('finally', para(step['finally'].label || '例外の有無に関わらず実行される後処理')));
        break;
      case 'transaction':
        out.push(sec('トランザクション属性', kv([['名称', step.label], ['管理方式', step.manager], ['伝播', step.propagation], ['分離レベル', step.isolation], ['読み取り専用', step.readOnly ? 'はい' : ''], ['タイムアウト', step.timeout], ['ロールバック対象', arr(step.rollbackFor).join(', ')], ['終了', step.end === 'rollback' ? 'ROLLBACK' : 'COMMIT（正常終了時）']])));
        out.push(sec('補足', para(step.detail || step.note)));
        break;
      case 'tx': case 'lock':
        out.push(kv([['操作', step.action], ['対象', step.resource || step.label], ['仕組み', step.mechanism], ['補足', step.note || step.detail]]));
        break;
      case 'await':
        var tgt = step.target ? model._index.steps.get(step.target) : null;
        out.push(kv([['待ち合わせ対象', tgt ? (tgt.label || tgt.id) : step.target], ['方法', step.mechanism], ['補足', step.note || step.detail]]));
        if (tgt) out.push('<div class="btn-row"><button class="link-btn" data-act="step" data-id="' + h(tgt.id) + '">待ち合わせ対象の呼び出しへ</button></div>');
        break;
      case 'ref':
        var rd2 = model._index.diagrams.get(step.diagram);
        out.push(para(step.description || (rd2 && rd2.description) || ''));
        out.push('<div class="btn-row"><button class="link-btn" data-act="open-diagram" data-id="' + h(step.diagram) + '">「' + h(rd2 ? rd2.title : step.diagram) + '」を開く →</button></div>');
        break;
      case 'group':
        var col = state.collapsed[state.diagramId] && state.collapsed[state.diagramId].has(step.id);
        out.push(para(step.description || step.detail || ''));
        out.push(kv([['状態', col ? '折りたたみ中（' + countSteps(step.steps) + 'ステップを集約）' : '展開中'], ['含まれるステップ', countSteps(step.steps) + '件']]));
        out.push('<div class="btn-row"><button class="link-btn" data-act="toggle-group" data-id="' + h(step.id) + '">' + (col ? '展開する' : '折りたたむ') + '</button></div>');
        if (col) out.push(sec('集約されている処理', '<div class="msg-list">' + flatSteps(step.steps).map(function (s) {
          return '<button data-act="step" data-id="' + h(s.id) + '"><span class="n">' + h(typeIcon(s)) + '</span><span>' + h(stepSummary(s)) + '</span></button>';
        }).join('') + '</div>'));
        break;
      case 'note':
        out.push(para(step.text || step.label));
        break;
      default: break;
    }
    if (step.type !== 'note' && step.type !== 'ref' && step.type !== 'self' && step.type !== 'throw' && step.type !== 'return' && step.note && step.type !== 'call' && step.type !== 'group') out.push(sec('補足', para(step.note)));
    out.push(sec('根拠（ソースコード・資料）', evidenceBlock(step.evidence)));
    out.push('<details class="pd-internal"><summary>ステップ情報（モデル上の識別子）</summary>' + kv([['ステップID', step.id], ['所属する図', (model._index.diagrams.get(step._diagram) || {}).title], ['モデル上の位置', step._path]]) + '</details>');
    setPanel(out.join(''));
  }

  function inferFrom(step) {
    var d = model._index.diagrams.get(step._diagram);
    var res = null;
    Core.walkSteps(d.steps, function (s, parent, depth, anc) {
      if (s.id !== step.id) return;
      for (var i = anc.length - 1; i >= 0; i--) { if (anc[i].type === 'call') { res = anc[i].to; return; } }
      res = d.entry || null;
    });
    return res;
  }

  function countSteps(steps) { var n = 0; Core.walkSteps(steps, function () { n++; }); return n; }
  function flatSteps(steps) { var out = []; Core.walkSteps(steps, function (s) { out.push(s); }); return out; }
  function typeIcon(s) {
    return { call: s.mode && s.mode !== 'sync' ? '⇢' : '→', self: '↻', db: '⛁', 'return': '↩', 'throw': '⚠', alt: '◇', opt: '◇', loop: '⟳', par: '∥', critical: '🔒', 'break': '⛔', 'try': '⚑', ref: '↗', note: '✎', transaction: 'TX', tx: 'TX', lock: '🔒', 'await': '⏳', group: '▣' }[s.type] || '•';
  }
  function stepSummary(s) {
    if (s.type === 'call') return (s.label || s.to) + (s.to ? '  → ' + (model._index.lifelines.get(s.to) || {})._label : '');
    if (s.type === 'db') return s.op + ' ' + (s.table || '') + (s.label ? '：' + s.label : '');
    if (s.type === 'throw') return '例外 ' + s.exception + (s.label ? '：' + s.label : '');
    if (s.type === 'alt') return '条件分岐：' + s.branches.map(function (b) { return b.condition || b.label || 'それ以外'; }).join(' ／ ');
    if (s.type === 'par') return '並列処理：' + s.branches.map(function (b) { return b.label || ''; }).join(' ／ ');
    if (s.type === 'try') return 'try-catch：' + s.catches.map(function (c) { return c.exception; }).join(', ');
    if (s.type === 'critical') return '排他処理：' + (s.label || '');
    if (s.type === 'transaction') return 'トランザクション：' + (s.label || '');
    if (s.type === 'ref') { var d = model._index.diagrams.get(s.diagram); return '詳細参照：' + (s.label || (d ? d.title : s.diagram)); }
    return s.label || s.condition || s.text || s.exception || STEP_TYPE_LABELS[s.type];
  }

  function relatedMessagesHtml(llIds) {
    if (!state.els) return '';
    var rows = state.els.msgs.filter(function (m) { return llIds.indexOf(m.rec.from) >= 0 || llIds.indexOf(m.rec.to) >= 0; });
    if (!rows.length) return '<p class="muted">この図にはこのライフラインのメッセージはありません。</p>';
    return '<div class="msg-list">' + rows.map(function (m) {
      var dir = llIds.indexOf(m.rec.to) >= 0 && llIds.indexOf(m.rec.from) >= 0 ? '↻' : llIds.indexOf(m.rec.to) >= 0 ? '受' : '送';
      return '<button data-act="msg" data-idx="' + m.idx + '"><span class="n">#' + (m.idx + 1) + '</span><span>' + h(dir + ' ' + m.rec.text) + '</span></button>';
    }).join('') + '</div>';
  }

  function renderLifelinePanel(ll) {
    if (!ll) return;
    var layer = model._index.layers.get(ll.layer) || {};
    var out = [];
    out.push('<div class="pd-head"><span class="badge b-kind"><span class="lg-swatch" style="background:' + h(layer.color) + '"></span>' + h(layer.label || ll.layer) + '</span><span class="badge b-kind">' + h(typeLabel(ll.type)) + '</span>' + (ll.evidence._explicit || ll.evidence.refs.length ? evBadge(ll.evidence) : '') + '</div>');
    out.push('<div class="pd-title">' + h(ll._label) + '</div>');
    out.push(sec('ライフライン情報', kv([
      ['種別', ll.kind], ['クラス', ll['class']], ['メソッド', ll.method], ['シグネチャ', ll.signature], ['テーブル/名称', ll.name],
      ['ファイル', ll.file], ['アノテーション等', ll.annotations.join('\n')], ['解析状況', ll.traced === false ? '内部未解析（ブラックボックス扱い）' : ll.traced === true ? '内部まで解析済み' : ''],
      ['実装/ディスパッチ', ll.implementation || ll.via]
    ])));
    out.push(sec('説明', para(ll.description)));
    if (ll.type === 'db') out.push(sec('テーブル情報', kv([['主キー', ll.primaryKey], ['主要カラム', arr(ll.columns).join(', ')], ['補足', ll.note]])));
    out.push(sec('この図での送受信メッセージ', relatedMessagesHtml([ll.id])));
    var used = model.diagrams.filter(function (d) { var f = false; Core.walkSteps(d.steps, function (s) { if (s.from === ll.id || s.to === ll.id || s.on === ll.id) f = true; }); return f || d.entry === ll.id; });
    if (used.length) out.push(sec('登場する図', '<div class="btn-row">' + used.map(function (d) { return '<button class="link-btn" data-act="open-diagram" data-id="' + h(d.id) + '">' + h(d.title) + '</button>'; }).join('') + '</div>'));
    out.push(sec('根拠', ll.evidence._explicit || ll.evidence.refs.length ? evidenceBlock(ll.evidence) : '<p class="muted">定義位置の記載なし</p>'));
    setPanel(out.join(''));
  }

  function renderParticipantPanel(info) {
    if (!info) return;
    var out = [];
    out.push('<div class="pd-head"><span class="badge b-kind">クラス単位に集約</span></div>');
    out.push('<div class="pd-title">' + h(info.rec.label) + '</div>');
    out.push(sec('集約されているメソッド', '<div class="msg-list">' + info.rec.lifelines.map(function (id) {
      var ll = model._index.lifelines.get(id);
      return '<button data-act="ll" data-id="' + h(id) + '"><span class="n">⋯</span><span>' + h(ll ? ll._label : id) + '</span></button>';
    }).join('') + '</div>'));
    out.push(sec('この図での送受信メッセージ', relatedMessagesHtml(info.rec.lifelines)));
    setPanel(out.join(''));
  }

  function typeLabel(t) {
    return { method: 'メソッド', actor: 'アクター', db: 'DBテーブル', external: '外部システム', queue: 'メッセージキュー', framework: 'フレームワーク', batch: 'バッチ', cache: 'キャッシュ', file: 'ファイル', other: 'その他' }[t] || t;
  }

  function renderEmptyDetail() {
    if (currentTab !== 'detail') return;
    var d = model._index.diagrams.get(state.diagramId);
    var out = [];
    out.push('<div class="pd-title">' + h(d.title) + '</div>');
    out.push(para(d.description || ''));
    out.push('<p class="muted">図中のメッセージ（矢印）・ライフライン・分岐の見出し・注記をクリックすると、ここに詳細が表示されます。<br>↑/↓ キーでメッセージを順に移動、/ で検索、F で全体表示。</p>');
    if (d._children.length) out.push(sec('この図から参照している詳細図', '<div class="btn-row">' + d._children.map(function (c) { var cd = model._index.diagrams.get(c); return '<button class="link-btn" data-act="open-diagram" data-id="' + h(c) + '">' + h(cd.title) + ' →</button>'; }).join('') + '</div>'));
    if (d._parents.length) out.push(sec('この図を参照している図', '<div class="btn-row">' + d._parents.map(function (c) { var cd = model._index.diagrams.get(c); return '<button class="link-btn" data-act="open-diagram" data-id="' + h(c) + '">← ' + h(cd.title) + '</button>'; }).join('') + '</div>'));
    setPanel(out.join(''));
  }

  function renderOverview() {
    var m = model.meta;
    var d = model._index.diagrams.get(state.diagramId);
    var st = state.gen ? state.gen.stats : {};
    var out = [];
    out.push('<div class="pd-title">' + h(m.title) + '</div>');
    out.push(para(m.description));
    out.push(sec('対象', kv([['システム', m.system], ['起点', m.entryPoint], ['言語', m.language], ['フレームワーク', arr(m.frameworks).join(', ')], ['ソースルート', m.sourceRoot], ['解析日', m.analyzedAt], ['作成', m.analyzer]])));
    if (arr(m.inputs).length) out.push(sec('入力資料', '<ul class="list">' + arr(m.inputs).map(function (i) { return '<li>' + h(typeof i === 'string' ? i : [i.kind, i.path || i.name, i.note].filter(Boolean).join('：')) + '</li>'; }).join('') + '</ul>'));
    out.push(sec('この図（' + d.title + '）の統計', '<div class="stats">' + [
      ['メッセージ', st.messages], ['ライフライン', st.participants], ['呼び出し', st.call], ['DB操作', st.db], ['非同期', st.async], ['例外', st['throw']], ['自己メッセージ', st.self], ['フラグメント', st.fragments], ['注記', st.notes]
    ].map(function (x) { return '<div class="stat"><b>' + h(x[1] === undefined ? '-' : x[1]) + '</b><span>' + h(x[0]) + '</span></div>'; }).join('') + '</div>'));
    out.push(sec('根拠の状況（モデル全体）', kv([['確認済み', validation.evidence.confirmed + '件'], ['推定', validation.evidence.inferred + '件'], ['未確認', validation.evidence.unverified + '件']])));
    var lists = [['未確認事項・要確認', m.unresolved], ['前提・仮定', m.assumptions], ['集約・省略した処理', m.omissions], ['解析対象外', m.excluded]];
    lists.forEach(function (l) {
      if (arr(l[1]).length) out.push(sec(l[0], '<ul class="list">' + arr(l[1]).map(function (x) { return '<li>' + h(typeof x === 'string' ? x : [x.target || x.item || x.title, x.reason || x.note || x.detail].filter(Boolean).join('：')) + '</li>'; }).join('') + '</ul>'));
    });
    if (state.gen) {
      out.push(sec('この図のライフライン', '<div class="msg-list">' + state.gen.map.participants.map(function (p, i) {
        return '<button data-act="part" data-id="' + h(p.mId) + '"><span class="n">' + (i + 1) + '</span><span>' + h(p.label) + '</span></button>';
      }).join('') + '</div>'));
    }
    out.push(sec('生成情報', kv([['生成日時', build.generatedAt], ['スキル', 'sequence-diagram core ' + Core.VERSION], ['Mermaid', build.mermaidVersion || Core.MERMAID_VERSION], ['モデル', build.modelFile]])));
    setPanel(out.join(''));
  }

  function issueHtml(level, i) {
    var click = i.stepId ? ' clickable" data-act="step" data-id="' + h(i.stepId) : (i.lifelineId ? ' clickable" data-act="ll" data-id="' + h(i.lifelineId) : (i.diagramId ? ' clickable" data-act="open-diagram" data-id="' + h(i.diagramId) : ''));
    var lvl = { error: 'エラー', warning: '警告', info: '情報' }[level];
    return '<div class="issue ' + level + click + '"><span class="lvl">' + lvl + '</span><span>' + h(i.message) + '</span></div>';
  }

  function renderVerifyPanel() {
    var out = [];
    var c = state.check;
    out.push('<div class="pd-title">検証結果</div>');
    if (c) {
      var rows = [];
      if (c.renderError) rows.push(['描画', '失敗：' + c.renderError]);
      else {
        rows.push(['描画', '成功（' + c.size.w + '×' + c.size.h + 'px、' + c.durationMs + 'ms）']);
        rows.push(['対応付け', ['messages', 'notes', 'fragments', 'participants'].map(function (k) {
          var x = c.counts[k];
          return { messages: 'メッセージ', notes: '注記', fragments: 'フラグメント', participants: 'ライフライン' }[k] + ' ' + x.mapped + '/' + x.expected;
        }).join('、')]);
        rows.push(['文字の重なり', c.overlaps.length ? c.overlaps.length + '件' : 'なし']);
        rows.push(['はみ出し', c.clipped.length ? c.clipped.length + '件' : 'なし']);
      }
      out.push(sec('この図の表示検証', kv(rows)));
      if (c.problems && c.problems.length) out.push(sec('対応付けの問題', c.problems.map(function (p) { return issueHtml(p.level, p); }).join('')));
      if (c.overlaps && c.overlaps.length) out.push(sec('重なっている文字', '<ul class="list">' + c.overlaps.slice(0, 50).map(function (o) { return '<li>「' + h(o.a) + '」と「' + h(o.b) + '」（x=' + o.x + ', y=' + o.y + '）</li>'; }).join('') + '</ul>'));
    }
    out.push('<div class="btn-row"><button class="link-btn" data-act="verify-all">すべての図を検証する</button></div>');
    if (state.verifyAll) {
      out.push(sec('全図の検証', '<table class="tbl"><thead><tr><th>図</th><th>表示</th><th>結果</th></tr></thead><tbody>' + state.verifyAll.results.map(function (r) {
        var d = model._index.diagrams.get(r.diagramId);
        return '<tr><td>' + h(d ? d.title : r.diagramId) + '</td><td>' + h(r.options.lifelineMode === 'class' ? 'クラス単位' : 'メソッド単位') + '</td><td>' + (r.ok ? '✓ OK' : '✗ ' + h(r.renderError || ((r.problems || []).length + '件の問題 / 重なり' + (r.overlaps || []).length + '件'))) + '</td></tr>';
      }).join('') + '</tbody></table>'));
    }
    var v = validation;
    var bi = arr(build && build.issues);
    out.push(sec('モデルの検証（エラー ' + v.errors.length + ' / 警告 ' + (v.warnings.length + bi.length) + '）',
      (v.errors.map(function (i) { return issueHtml('error', i); }).join('') +
        v.warnings.map(function (i) { return issueHtml('warning', i); }).join('') +
        bi.map(function (i) { return issueHtml(i.level || 'warning', i); }).join('') +
        v.infos.map(function (i) { return issueHtml('info', i); }).join('')) || '<p class="muted">問題はありません。</p>'));
    setPanel(out.join(''));
  }

  function renderSourcePanel() {
    var text = state.gen ? state.gen.text : '';
    var lines = text.split('\n');
    var out = [];
    out.push('<div class="pd-title">Mermaid コード</div>');
    out.push('<p class="muted">処理モデルから自動生成された Mermaid の正式な構文です（表示設定を反映）。日本語のフラグメント名や色分けは、描画後の SVG に対してのみ適用しています。</p>');
    out.push('<div class="btn-row" style="margin-bottom:8px"><button class="copy-btn" data-act="copy-mmd">コピー</button><button class="copy-btn" data-act="save-mmd">.mmd を保存</button></div>');
    out.push('<div class="snippet"><div class="snippet-body" style="max-height:none"><table>' + lines.map(function (l, i) { return '<tr><td class="ln">' + (i + 1) + '</td><td>' + h(l) + '</td></tr>'; }).join('') + '</table></div></div>');
    setPanel(out.join(''));
  }

  // ---------------------------------------------------------------------------
  // 左ナビ: 図一覧・アウトライン・パンくず
  // ---------------------------------------------------------------------------
  var diagramCounts = {};
  function countFor(id) {
    if (diagramCounts[id] === undefined) {
      try { diagramCounts[id] = Core.generate(model, id, { theme: state.theme }).stats.messages; } catch (e) { diagramCounts[id] = '!'; }
    }
    return diagramCounts[id];
  }
  function renderDiagramTree() {
    var box = $('#diagramTree');
    var seen = new Set();
    var html = [];
    function walk(id, depth) {
      var d = model._index.diagrams.get(id);
      if (!d) return;
      var cyc = seen.has(id);
      html.push('<button class="tree-item' + (id === state.diagramId ? ' is-current' : '') + '" data-act="open-diagram" data-id="' + h(id) + '" style="padding-left:' + (8 + depth * 14) + 'px"><span class="ti-icon">' + (depth ? '└' : '◆') + '</span><span>' + h(d.title) + '</span><span class="ti-count">' + h(countFor(id)) + '</span></button>');
      if (cyc) return;
      seen.add(id);
      d._children.forEach(function (c) { walk(c, depth + 1); });
    }
    rootDiagrams().forEach(function (r) { walk(r, 0); });
    model.diagrams.forEach(function (d) { if (!seen.has(d.id)) walk(d.id, 0); });
    box.innerHTML = html.join('');
  }

  function renderCrumbs() {
    var chain = [];
    var cur = model._index.diagrams.get(state.diagramId);
    var guard = 0;
    while (cur && guard++ < 20) {
      chain.unshift(cur);
      cur = cur._parents.length ? model._index.diagrams.get(cur._parents[0]) : null;
      if (cur && chain.indexOf(cur) >= 0) break;
    }
    $('#crumbs').innerHTML = chain.map(function (d, i) {
      return (i ? '<span class="sep">›</span>' : '') + '<button class="' + (d.id === state.diagramId ? 'is-current' : '') + '" data-act="open-diagram" data-id="' + h(d.id) + '" title="' + h(d.title) + '">' + h(d.title) + '</button>';
    }).join('');
  }

  function renderOutline() {
    var d = model._index.diagrams.get(state.diagramId);
    var firstNum = {};
    if (state.els) state.els.msgs.forEach(function (m) {
      var id = m.rec.callStepId || m.rec.stepId;
      if (firstNum[id] === undefined) firstNum[id] = m.idx + 1;
      if (firstNum[m.rec.stepId] === undefined) firstNum[m.rec.stepId] = m.idx + 1;
    });
    var col = state.collapsed[state.diagramId];
    var count = 0;
    function rows(steps) {
      return steps.map(function (s) {
        count++;
        var children = Core.childLists(s);
        var hidden = s.type === 'group' && col.has(s.id);
        var num = firstNum[s.id] ? firstNum[s.id] : '';
        var isFrag = ['alt', 'opt', 'loop', 'par', 'critical', 'break', 'try', 'group', 'transaction'].indexOf(s.type) >= 0;
        var row = '<div class="ol-row" data-step="' + h(s.id) + '" data-act="step" data-id="' + h(s.id) + '">' +
          (children.length && !hidden ? '<button class="ol-toggle" data-act="fold" type="button">▾</button>' : '<span class="ol-toggle"></span>') +
          '<span class="ol-num">' + h(num) + '</span><span class="ol-ico">' + h(typeIcon(s)) + '</span><span class="ol-text" title="' + h(stepSummary(s)) + '">' + h(stepSummary(s)) + (hidden ? '（折りたたみ中）' : '') + '</span></div>';
        var inner = '';
        if (children.length && !hidden) {
          if (children.length === 1 && !children[0].branch) inner = rows(children[0].steps);
          else inner = children.map(function (cl) {
            var b = cl.branch || {};
            var label = cl.key === 'steps' ? (s.type === 'try' ? 'try' : (s.label || '本体')) : cl.key === 'finally' ? 'finally' :
              s.type === 'try' ? 'catch ' + (b.exception || '') : (b.condition || b.label || (b['else'] ? 'それ以外' : ''));
            return '<div class="ol-node ol-branch"><div class="ol-row" data-act="step" data-id="' + h(s.id) + '"><span class="ol-toggle"></span><span class="ol-num"></span><span class="ol-ico">┊</span><span class="ol-text">［' + h(label) + '］</span></div><div class="ol-children flat">' + rows(cl.steps) + '</div></div>';
          }).join('');
        }
        return '<div class="ol-node' + (isFrag ? ' ol-frag' : '') + '">' + row + (inner ? '<div class="ol-children">' + inner + '</div>' : '') + '</div>';
      }).join('');
    }
    $('#outline').innerHTML = rows(d.steps) || '<p class="muted">ステップがありません</p>';
    $('#outlineCount').textContent = count + '件';
  }

  function updateStatus() {
    var st = state.gen ? state.gen.stats : null;
    if (!st) { $('#statusbar').innerHTML = ''; return; }
    var evc = { inferred: 0, unverified: 0 };
    if (state.els) state.els.msgs.forEach(function (m) { if (m.rec.ev === 'inferred') evc.inferred++; if (m.rec.ev === 'unverified') evc.unverified++; });
    // 表示倍率と根拠の件数を先頭に置き、幅が足りないときは後ろの項目から省略される
    // （推定・未確認は「この図の矢印」の数。モデル全体のステップ数は概要タブに表示）
    $('#statusbar').innerHTML = [
      '表示 <b>' + Math.round(state.zoom * 100) + '%</b>',
      '<span class="sb-ev-inferred" title="この図で〔推定〕が付いた矢印の数">推定の矢印 <b>' + evc.inferred + '</b></span>',
      '<span class="sb-ev-unverified" title="この図で〔未確認〕が付いた矢印の数">未確認の矢印 <b>' + evc.unverified + '</b></span>',
      'メッセージ <b>' + st.messages + '</b>', 'ライフライン <b>' + st.participants + '</b>', 'DB操作 <b>' + st.db + '</b>',
      '非同期 <b>' + st.async + '</b>', '例外 <b>' + st['throw'] + '</b>', '枠 <b>' + st.fragments + '</b>',
      state.opts.lifelineMode === 'class' ? '<b>クラス単位表示</b>' : ''
    ].filter(Boolean).join('<span class="sb-sep">|</span>');
    // 補助的な自己メッセージ（minor）が無い図では設定を無効にして、効かない理由を示す
    var minorCount = 0;
    Core.walkSteps(model._index.diagrams.get(state.diagramId).steps, function (s) { if (s.type === 'self' && s.minor) minorCount++; });
    var mi = $('#optMinor');
    if (mi) { mi.disabled = minorCount === 0; mi.parentNode.title = minorCount ? '対象 ' + minorCount + ' 件（ログ出力など）' : 'この図には対象（minor の自己メッセージ）がありません'; }
  }

  function updateVerifyChip() {
    var chip = $('#chipVerify');
    var v = validation;
    var c = state.check;
    var buildIssues = arr(build && build.issues).length;
    var errs = v.errors.length + (c && (c.renderError || (c.problems || []).some(function (p) { return p.level === 'error'; })) ? 1 : 0);
    var warns = v.warnings.length + buildIssues + (c && c.overlaps ? c.overlaps.length : 0) + (c && c.clipped ? c.clipped.length : 0);
    chip.className = 'chip ' + (errs ? 'err' : warns ? 'warn' : 'ok');
    chip.textContent = errs ? '✗ エラー ' + errs : warns ? '⚠ 警告 ' + warns : '✓ 検証OK';
    window.__SEQDIAG_STATUS__ = { ready: true, diagramId: state.diagramId, check: c, validation: { errors: v.errors.length, warnings: v.warnings.length } };
  }

  // ---------------------------------------------------------------------------
  // 検索
  // ---------------------------------------------------------------------------
  var searchIndex = [];
  function buildSearchIndex() {
    searchIndex = [];
    model.diagrams.forEach(function (d) {
      Core.walkSteps(d.steps, function (s) {
        searchIndex.push({ kind: 'step', diagramId: d.id, id: s.id, title: stepSummary(s), sub: STEP_TYPE_LABELS[s.type], text: Core.stepSearchText(model, s).toLowerCase() });
      });
    });
    model.lifelines.forEach(function (ll) {
      searchIndex.push({ kind: 'lifeline', id: ll.id, title: ll._label, sub: 'ライフライン', text: [ll.id, ll._label, ll['class'], ll.method, ll.signature, ll.name, ll.description, ll.annotations.join(' ')].filter(Boolean).join(' ').toLowerCase() });
    });
  }
  function runSearch(q) {
    state.search.q = q;
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    var res = [];
    if (tokens.length) {
      searchIndex.forEach(function (e) {
        if (tokens.every(function (t) { return e.text.indexOf(t) >= 0; })) {
          var score = tokens.every(function (t) { return e.title.toLowerCase().indexOf(t) >= 0; }) ? 0 : 1;
          if (e.kind === 'step' && e.diagramId !== state.diagramId) score += 0.5;
          res.push({ e: e, score: score });
        }
      });
      res.sort(function (a, b) { return a.score - b.score; });
    }
    state.search.results = res.map(function (r) { return r.e; });
    state.search.index = -1;
    renderSearchResults();
    applySearchHighlights();
  }
  function renderSearchResults() {
    var box = $('#searchResults');
    var r = state.search.results;
    $('#searchCount').textContent = state.search.q ? (state.search.index >= 0 ? (state.search.index + 1) + '/' : '') + r.length + '件' : '';
    if (!state.search.q || !state.search.open) { box.hidden = true; return; }
    if (!r.length) { box.innerHTML = '<div class="empty">該当なし</div>'; box.hidden = false; return; }
    var tokens = state.search.q.split(/\s+/).filter(Boolean);
    var mark = function (s) {
      var out = h(s);
      tokens.forEach(function (t) {
        var re = new RegExp('(' + h(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
        out = out.replace(re, '<mark>$1</mark>');
      });
      return out;
    };
    var html = [];
    var lastGroup = null;
    r.slice(0, 200).forEach(function (e, i) {
      var group = e.kind === 'lifeline' ? 'ライフライン' : (model._index.diagrams.get(e.diagramId) || {}).title;
      if (group !== lastGroup) { html.push('<div class="sr-group">' + h(group) + '</div>'); lastGroup = group; }
      html.push('<div class="sr-item' + (i === state.search.index ? ' is-active' : '') + '" data-idx="' + i + '" role="option"><span>' + h(e.kind === 'lifeline' ? '⋮' : typeIcon(model._index.steps.get(e.id) || {})) + '</span><span class="sr-title">' + mark(e.title) + '</span><span class="sr-sub">' + h(e.sub) + '</span></div>');
    });
    if (r.length > 200) html.push('<div class="empty">ほか ' + (r.length - 200) + ' 件</div>');
    box.innerHTML = html.join('');
    box.hidden = false;
  }
  function applySearchHighlights() {
    if (!state.svg) return;
    $$('.sq-hl', state.svg).forEach(function (e) { e.remove(); });
    $$('.ol-row.is-hit').forEach(function (e) { e.classList.remove('is-hit'); });
    if (!state.search.q) return;
    var ids = new Set(state.search.results.filter(function (e) { return e.kind === 'step'; }).map(function (e) { return e.id; }));
    var cur = state.search.results[state.search.index];
    state.els && state.els.msgs.forEach(function (m) {
      if (ids.has(m.rec.stepId) || ids.has(m.rec.callStepId)) addHl(m.g, m.texts, cur && (cur.id === m.rec.stepId || cur.id === m.rec.callStepId));
    });
    state.els && state.els.notes.forEach(function (n) { if (ids.has(n.rec.stepId)) addHl(n.g, $$('.noteText', n.g), cur && cur.id === n.rec.stepId); });
    state.els && state.els.frags.forEach(function (f) { if (ids.has(f.rec.stepId)) addHl(f.g, $$('.loopText, .sectionTitle', f.g), cur && cur.id === f.rec.stepId); });
    ids.forEach(function (id) { $$('.ol-row[data-step="' + cssEsc(id) + '"]').forEach(function (r) { r.classList.add('is-hit'); }); });
  }
  function addHl(g, texts, current) {
    texts.forEach(function (t) {
      try {
        var b = t.getBBox();
        var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('class', 'sq-hl' + (current ? ' is-current' : ''));
        r.setAttribute('x', b.x - 3); r.setAttribute('y', b.y - 1); r.setAttribute('width', b.width + 6); r.setAttribute('height', b.height + 2); r.setAttribute('rx', 3);
        t.parentNode.insertBefore(r, t);
      } catch (e) { /* 非表示要素は無視 */ }
    });
  }
  function gotoSearch(delta, absolute) {
    var r = state.search.results;
    if (!r.length) return;
    var i = absolute !== undefined ? absolute : (state.search.index + delta + r.length) % r.length;
    state.search.index = i;
    var e = r[i];
    // 移動したらドロップダウンを閉じ、件数と ↑↓ だけを残す（図を隠さないため）
    state.search.open = false;
    renderSearchResults();
    if (e.kind === 'lifeline') {
      var inCurrent = state.gen && state.gen.map.participants.some(function (p) { return p.lifelines.indexOf(e.id) >= 0; });
      if (!inCurrent) {
        var target = model.diagrams.filter(function (d) { var f = false; Core.walkSteps(d.steps, function (s) { if (s.from === e.id || s.to === e.id || s.on === e.id) f = true; }); return f; })[0];
        if (target) {
          var nav = ++state.navSeq;
          state.diagramId = target.id;
          state.selection = null;
          render({ initialZoom: true }).then(function () { if (nav !== state.navSeq) return; selectLifeline(e.id, { scroll: true }); applySearchHighlights(); });
          return;
        }
      }
      selectLifeline(e.id, { scroll: true });
      applySearchHighlights();
    } else {
      selectStep(e.id, { scroll: true }).then(applySearchHighlights);
    }
  }

  // ---------------------------------------------------------------------------
  // 凡例
  // ---------------------------------------------------------------------------
  function renderLegend() {
    var p = PALETTE[state.theme];
    var arrow = function (color, dash, head, label) {
      var marker = head === 'x' ? '<path d="M62,3 l8,8 M70,3 l-8,8" stroke="' + color + '" stroke-width="1.6"/>' :
        head === 'open' ? '<path d="M60,2 L70,7 L60,12" fill="none" stroke="' + color + '" stroke-width="1.6"/>' :
          '<path d="M60,2 L70,7 L60,12 z" fill="' + color + '"/>';
      return '<div class="lg-row"><svg viewBox="0 0 72 14"><line x1="2" y1="7" x2="68" y2="7" stroke="' + color + '" stroke-width="1.6"' + (dash ? ' stroke-dasharray="4 3"' : '') + '/>' + marker + '</svg><span>' + h(label) + '</span></div>';
    };
    var html = ['<button class="icon-btn legend-close" data-act="legend-close" title="閉じる">✕</button>'];
    html.push('<h3>矢印</h3>');
    html.push(arrow(p.call, false, 'fill', '同期メソッド呼び出し'));
    html.push(arrow(p.ret, true, 'fill', '戻り値（return）'));
    html.push(arrow(p.async, false, 'open', '非同期呼び出し／メッセージ送信'));
    html.push(arrow(p.event, false, 'open', 'イベント発行'));
    html.push(arrow(p.async, true, 'open', 'コールバック／非同期の完了通知'));
    html.push(arrow(p.db, false, 'fill', 'DBアクセス（SELECT/INSERT/UPDATE/DELETE）'));
    html.push(arrow(p.err, true, 'x', '例外の送出・伝播'));
    html.push('<div class="lg-row"><svg viewBox="0 0 72 14"><path d="M20,3 h22 a4,4 0 0 1 0,8 h-18" fill="none" stroke="' + p.self + '" stroke-width="1.6"/></svg><span>自己メッセージ（内部処理）</span></div>');
    html.push('<h3>枠（フラグメント）</h3>');
    // 実際の枠と同じ「見出しタブ＋線種」で示す
    [['alt', '条件分岐', 'if / switch（Mermaid: alt）'], ['opt', '条件付き実行', 'else の無い if（opt）'], ['loop', '繰り返し', 'for / while（loop）'], ['par', '並列処理', '同時実行（par）'],
      ['critical', '排他処理', 'ロックで保護された区間（critical）'], ['break', '処理中断', '早期 return・例外で抜ける（break）'], ['try', '例外処理', 'try-catch（Mermaid 上は alt）']].forEach(function (f) {
      var c = p.frag[f[0]];
      var dash = FRAG_DASH[f[0]] === 'none' ? '' : ' stroke-dasharray="' + FRAG_DASH[f[0]] + '"';
      html.push('<div class="lg-row lg-frag"><svg viewBox="0 0 120 26" style="width:118px;height:26px"><rect x="1" y="3" width="117" height="21" fill="none" stroke="' + c + '" stroke-width="' + FRAG_WIDTH[f[0]] + '"' + dash + '/>' +
        '<polygon points="1,3 62,3 62,13 56,19 1,19" fill="' + (state.theme === 'dark' ? mix(c, '#0f1626', 0.22) : mix(c, '#ffffff', 0.14)) + '" stroke="' + c + '"/>' +
        '<text x="31" y="15" text-anchor="middle" font-size="10" font-weight="700" fill="' + (state.theme === 'dark' ? c : mix(c, '#000000', 0.78)) + '">' + h(FRAG_ICON[f[0]] + ' ' + f[1]) + '</text></svg><span>' + h(f[2]) + '</span></div>');
    });
    html.push('<h3>注記・背景帯</h3>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="background:' + p.note.ref + ';border-color:' + p.note.refBd + '"></span></span><span>詳細参照（クリックで詳細図へ）</span></div>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="background:' + p.note.tx + ';border-color:' + p.note.txBd + '"></span></span><span>トランザクション（開始・COMMIT）／青い背景帯が範囲</span></div>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="background:' + p.note.rb + ';border-color:' + p.err + '"></span></span><span>ROLLBACK</span></div>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="background:' + p.note.fin + ';border-color:' + p.note.finBd + '"></span></span><span>finally（必ず実行）</span></div>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="background:' + p.note.grp + ';border-color:' + p.note.grpBd + '"></span></span><span>処理グループ（▼展開中／▶集約中）</span></div>');
    html.push('<h3>根拠</h3>');
    html.push('<div class="lg-row"><span style="color:' + p.inferred + ';font-style:italic">〔推定〕</span><span>コードから直接確認できず推定した内容</span></div>');
    html.push('<div class="lg-row"><span style="color:' + p.unverified + ';font-style:italic">〔未確認〕</span><span>根拠を確認できていない内容</span></div>');
    var used = new Set(state.gen ? state.gen.map.participants.map(function (x) { return x.layer; }) : []);
    html.push('<h3>レイヤー（ライフラインの色）</h3>');
    model.layers.filter(function (l) { return used.has(l.id); }).forEach(function (l) {
      html.push('<div class="lg-row"><span><span class="lg-swatch" style="background:' + h(l.color) + '"></span></span><span>' + h(l.label) + '</span></div>');
    });
    html.push('<h3>ライフラインの枠</h3>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="border-radius:7px;border:2px solid ' + p.db + '"></span></span><span>DB テーブル（角丸）</span></div>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="border:2px dashed ' + p.event + '"></span></span><span>キュー／トピック（破線）</span></div>');
    html.push('<div class="lg-row"><span><span class="lg-swatch" style="border:1.5px dotted ' + p.muted + '"></span></span><span>外部システム（点線）</span></div>');
    $('#legend').innerHTML = html.join('');
  }

  // ---------------------------------------------------------------------------
  // 保存
  // ---------------------------------------------------------------------------
  function exportSvgString() {
    if (!state.svg) return null;
    var cl = state.svg.cloneNode(true);
    $$('.sq-hit, .sq-hl, .sq-ll-hit', cl).forEach(function (e) { e.remove(); });
    $$('.is-selected, .is-related', cl).forEach(function (e) { e.classList.remove('is-selected', 'is-related'); });
    cl.classList.remove('sq-dim');
    cl.setAttribute('width', String(Math.ceil(state.natural.w)));
    cl.setAttribute('height', String(Math.ceil(state.natural.h)));
    cl.style.width = ''; cl.style.height = '';
    cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    var vb = state.svg.viewBox.baseVal;
    bg.setAttribute('x', vb.x); bg.setAttribute('y', vb.y); bg.setAttribute('width', vb.width); bg.setAttribute('height', vb.height);
    bg.setAttribute('fill', PALETTE[state.theme].bg);
    var styleEl = cl.querySelector('style.sq-style');
    cl.insertBefore(bg, styleEl ? styleEl.nextSibling : cl.firstChild);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(cl);
  }
  function fileBase() { return String(state.diagramId).replace(/[^A-Za-z0-9_\-]/g, '_'); }
  function exportSvg() {
    var s = exportSvgString();
    if (!s) return toast('図が描画されていません');
    download(fileBase() + '.svg', new Blob([s], { type: 'image/svg+xml' }));
  }
  function exportPng() {
    var s = exportSvgString();
    if (!s) return toast('図が描画されていません');
    // 大きな図でメモリを使い切らないよう、画素数を約 4,000 万に抑えて倍率を決める
    var scale = Math.min(2, 16000 / Math.max(state.natural.w, state.natural.h), Math.sqrt(40000000 / (state.natural.w * state.natural.h)));
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = Math.ceil(state.natural.w * scale); c.height = Math.ceil(state.natural.h * scale);
        var ctx = c.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        c.toBlob(function (b) { if (b) download(fileBase() + '.png', b); else toast('PNG の生成に失敗しました（図が大きすぎる可能性があります）'); });
      } catch (e) { toast('PNG の生成に失敗しました: ' + e.message); }
    };
    img.onerror = function () { toast('PNG の生成に失敗しました'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }
  function mmdText() {
    return state.gen ? state.gen.text : '';
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('コピーしました'); }, function () { fallbackCopy(t); });
    } else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('コピーしました'); } catch (e) { toast('コピーできませんでした'); }
    ta.remove();
  }

  // ---------------------------------------------------------------------------
  // 全図の検証（?verify=1 またはボタン）
  // ---------------------------------------------------------------------------
  function runVerifyAll() {
    var results = [];
    var origDiagram = state.diagramId;
    var origOpts = Object.assign({}, state.opts);
    var jobs = [];
    model.diagrams.forEach(function (d) {
      jobs.push({ id: d.id, mode: 'method' });
      jobs.push({ id: d.id, mode: 'class' });
    });
    var p = Promise.resolve();
    jobs.forEach(function (j) {
      p = p.then(function () {
        state.diagramId = j.id;
        state.opts = Object.assign({}, origOpts, { lifelineMode: j.mode });
        return render({ initialZoom: true }).then(function () {
          var c = state.check || { diagramId: j.id, ok: false, renderError: 'no result' };
          c.options = { lifelineMode: j.mode };
          results.push(c);
        });
      });
    });
    return p.then(function () {
      state.opts = origOpts;
      state.diagramId = origDiagram;
      state.verifyAll = { results: results, at: new Date().toISOString() };
      return render({ initialZoom: true }).then(function () { return state.verifyAll; });
    });
  }
  function writeVerifyReport(all) {
    var report = {
      tool: 'sequence-diagram viewer', coreVersion: Core.VERSION, mermaidVersion: (build && build.mermaidVersion) || Core.MERMAID_VERSION,
      title: model.meta.title,
      validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, infos: validation.infos, evidence: validation.evidence },
      buildIssues: arr(build && build.issues),
      diagrams: all.results.map(function (r) {
        return { diagramId: r.diagramId, mode: r.options.lifelineMode, ok: r.ok, renderError: r.renderError || null, counts: r.counts, problems: r.problems, overlaps: r.overlaps, clipped: r.clipped, size: r.size, durationMs: r.durationMs };
      })
    };
    report.ok = validation.ok && report.diagrams.every(function (d) { return d.ok; });
    var s = document.createElement('script');
    s.type = 'application/json';
    s.id = 'seqdiag-verify-result';
    s.textContent = JSON.stringify(report).replace(/</g, '\\u003c');
    document.body.appendChild(s);
    document.documentElement.setAttribute('data-verify', 'done');
    window.__SEQDIAG_VERIFY__ = report;
  }

  // ---------------------------------------------------------------------------
  // UI イベント
  // ---------------------------------------------------------------------------
  function syncOptionInputs() {
    $('#optReturns').checked = state.opts.showReturns;
    $('#optArgs').checked = state.opts.showArgs;
    $('#optExpr').checked = state.opts.showExpr;
    $('#optMinor').checked = state.opts.hideMinor;
    $('#optClass').checked = state.opts.lifelineMode === 'class';
    $('#optBoxes').checked = state.opts.boxes;
  }

  function openDiagram(id, push) {
    if (!model._index.diagrams.has(id)) return;
    if (id === state.diagramId) return;
    state.navSeq++;
    state.diagramId = id;
    state.selection = null;
    render({ initialZoom: true }).then(function () { renderEmptyDetail(); showPanel(currentTab === 'detail' ? 'detail' : currentTab); updateHash(push !== false); });
  }

  function toggleGroup(id) {
    var col = state.collapsed[state.diagramId];
    if (col.has(id)) col.delete(id); else col.add(id);
    render({ keepScroll: true }).then(function () { selectStep(id, { scroll: false }); });
  }

  function onAct(act, el, ev) {
    var id = el.getAttribute('data-id');
    switch (act) {
      case 'll': selectLifeline(id, { scroll: true }); break;
      case 'part': selectParticipant(id, { scroll: true }); break;
      case 'step': selectStep(id, { scroll: true }); break;
      case 'msg': var m = state.els && state.els.msgs[Number(el.getAttribute('data-idx'))]; if (m) selectStep(m.rec.stepId, { msgIdx: m.idx, scroll: true }); break;
      case 'open-diagram': openDiagram(id); break;
      case 'toggle-group': toggleGroup(id); break;
      case 'toggle-expand':
        if (state.expandRefs.has(id)) state.expandRefs.delete(id); else state.expandRefs.add(id);
        render({ keepScroll: true }).then(function () { selectStep(id, { scroll: false }); });
        break;
      case 'copy': copyText(el.getAttribute('data-text') || ''); break;
      case 'copy-mmd': copyText(mmdText()); break;
      case 'save-mmd': download(fileBase() + '.mmd', new Blob([mmdText()], { type: 'text/plain' })); break;
      case 'verify-all': runVerifyAll().then(function () { showPanel('verify'); }); break;
      case 'legend-close': $('#legend').hidden = true; break;
      case 'fold':
        ev.stopPropagation();
        var node = el.closest('.ol-node');
        node.classList.toggle('is-folded');
        el.textContent = node.classList.contains('is-folded') ? '▸' : '▾';
        return true;
      default: return false;
    }
    return true;
  }

  function bindUi() {
    document.addEventListener('click', function (ev) {
      var actEl = ev.target.closest('[data-act]');
      if (actEl && !actEl.closest('svg')) {
        if (onAct(actEl.getAttribute('data-act'), actEl, ev)) { ev.preventDefault(); return; }
      }
      // メニューを閉じる
      if (!ev.target.closest('.dropdown')) $$('.menu').forEach(function (m) { m.hidden = true; });
      if (!ev.target.closest('.search-group')) { state.search.open = false; $('#searchResults').hidden = true; }
      // 重ね表示のナビは外側をクリックしたら閉じる
      if (window.innerWidth <= 1180 && !ev.target.closest('#nav') && !ev.target.closest('#btnNav')) $('#app').classList.add('nav-hidden');
    });

    // 図のクリック
    $('#diagramHost').addEventListener('click', function (ev) {
      if (panState.moved) return;
      var el = ev.target.closest('[data-sq]');
      if (!el) { clearSelection(); return; }
      var v = el.getAttribute('data-sq');
      var kind = v.slice(0, 1), key = v.slice(2);
      if (kind === 'm') {
        var m = state.els.msgs[Number(key)];
        selectStep(m.rec.stepId, { msgIdx: m.idx, scroll: false });
      } else if (kind === 'n') {
        var n = state.els.notes[Number(key)];
        if (n.rec.role === 'ref' && n.rec.target) {
          // 詳細参照: 参照先の図を開く（戻るボタンで元の図に戻れる）
          openDiagram(n.rec.target);
          return;
        }
        if (n.rec.role === 'group-collapsed') { toggleGroup(n.rec.stepId); return; }
        if (n.rec.stepId) selectStep(n.rec.stepId, { noteIdx: n.idx, scroll: false });
      } else if (kind === 'f') {
        var f = state.els.frags[Number(key)];
        selectStep(f.rec.stepId, { fragIdx: f.idx, scroll: false });
      } else if (kind === 'p') {
        selectParticipant(key, { scroll: false });
      }
    });

    // ツールバー
    $('#zoomIn').onclick = function () { zoomBy(1.2); };
    $('#zoomOut').onclick = function () { zoomBy(1 / 1.2); };
    $('#zoomReset').onclick = function () { applyZoom(1); };
    $('#zoomFit').onclick = function () { fitZoom('all'); };
    $('#zoomWidth').onclick = function () { fitZoom('width'); };
    $('#btnView').onclick = function (e) { e.stopPropagation(); toggleMenu('#menuView'); };
    $('#btnExport').onclick = function (e) { e.stopPropagation(); toggleMenu('#menuExport'); };
    $('#btnLegend').onclick = function () { var l = $('#legend'); if (l.hidden) renderLegend(); l.hidden = !l.hidden; };
    $('#expSvg').onclick = exportSvg;
    $('#expPng').onclick = exportPng;
    $('#expMmd').onclick = function () { download(fileBase() + '.mmd', new Blob([mmdText()], { type: 'text/plain' })); };
    $('#expMmdCopy').onclick = function () { copyText(mmdText()); };
    $('#expModel').onclick = function () { download((model.meta.id || 'sequence') + '.model.json', new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' })); };
    var optHandler = function () {
      state.opts.showReturns = $('#optReturns').checked;
      state.opts.showArgs = $('#optArgs').checked;
      state.opts.showExpr = $('#optExpr').checked;
      state.opts.hideMinor = $('#optMinor').checked;
      state.opts.lifelineMode = $('#optClass').checked ? 'class' : 'method';
      state.opts.boxes = $('#optBoxes').checked;
      lsSet('opts', state.opts);
      render({ keepScroll: true });
    };
    ['#optReturns', '#optArgs', '#optExpr', '#optMinor', '#optClass', '#optBoxes'].forEach(function (s) { $(s).addEventListener('change', optHandler); });
    $('#btnExpandAll').onclick = function () { state.collapsed[state.diagramId].clear(); render({ keepScroll: true }); };
    $('#btnCollapseAll').onclick = function () {
      var d = model._index.diagrams.get(state.diagramId);
      Core.walkSteps(d.steps, function (s) { if (s.type === 'group') state.collapsed[state.diagramId].add(s.id); });
      render({ keepScroll: true });
    };
    $('#btnNav').onclick = function () { var a = $('#app'); a.classList.toggle('nav-hidden'); lsSet('navHidden', a.classList.contains('nav-hidden')); };
    $('#btnPanel').onclick = function () { var a = $('#app'); a.classList.toggle('panel-hidden'); lsSet('panelHidden', a.classList.contains('panel-hidden')); setTimeout(drawMinimap, 50); };
    // ナビの幅の変更（右端のつまみをドラッグ）
    var navRz = $('#navResizer');
    if (navRz) navRz.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      navRz.setPointerCapture(e.pointerId);
      var move = function (ev) { document.documentElement.style.setProperty('--nav-w', clamp(ev.clientX, 220, 640) + 'px'); };
      var up = function () {
        navRz.removeEventListener('pointermove', move); navRz.removeEventListener('pointerup', up);
        lsSet('navWidth', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-w'), 10));
        positionSticky(); drawMinimap();
      };
      navRz.addEventListener('pointermove', move); navRz.addEventListener('pointerup', up);
    });
    var optMm = $('#optMinimap');
    if (optMm) { optMm.checked = lsGet('minimap', true); optMm.addEventListener('change', function () { lsSet('minimap', optMm.checked); drawMinimap(); }); }
    $('#btnTheme').onclick = function () {
      state.themePref = state.theme === 'dark' ? 'light' : 'dark';
      lsSet('theme', state.themePref);
      applyTheme();
      render({ keepScroll: true });
      if (!$('#legend').hidden) renderLegend();
    };
    $('#chipVerify').onclick = function () { $('#app').classList.remove('panel-hidden'); showPanel('verify'); };
    $$('.ptab').forEach(function (b) { b.onclick = function () { $('#app').classList.remove('panel-hidden'); showPanel(b.getAttribute('data-tab')); }; });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onMq = function () { if (state.themePref === 'auto') { applyTheme(); render({ keepScroll: true }); } };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
    }

    // 検索
    var input = $('#searchInput');
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.search.open = true; runSearch(input.value.trim()); }, 120);
    });
    input.addEventListener('focus', function () { if (state.search.q) { state.search.open = true; renderSearchResults(); } });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (state.search.q !== input.value.trim()) runSearch(input.value.trim()); gotoSearch(e.shiftKey ? -1 : 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); gotoSearch(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); gotoSearch(-1); }
      else if (e.key === 'Escape') {
        // 1 回目はドロップダウンを閉じるだけ、2 回目で検索語とハイライトを消す
        if (state.search.open) { state.search.open = false; renderSearchResults(); }
        else { input.value = ''; runSearch(''); state.search.open = false; renderSearchResults(); input.blur(); }
      }
    });
    $('#searchNext').onclick = function () { gotoSearch(1); };
    $('#searchPrev').onclick = function () { gotoSearch(-1); };
    $('#searchResults').addEventListener('click', function (e) {
      var it = e.target.closest('.sr-item');
      if (it) gotoSearch(0, Number(it.getAttribute('data-idx')));
    });

    // キャンバス: ズーム・パン・スクロール
    var canvas = $('#canvas');
    canvas.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        var f = Math.exp(-e.deltaY * 0.0015);
        applyZoom(state.zoom * f, { x: e.clientX, y: e.clientY });
      }
    }, { passive: false });
    var raf = null;
    canvas.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; updateStickyVisibility(); });
    });
    // ドラッグでのスクロール。Pointer Events とポインタキャプチャを使い、ブラウザ自身のドラッグ
    // （選択中の文字のドラッグ）に奪われてもパン状態が残らないようにする。
    var endPan = function () {
      if (!panState.active) return;
      panState.active = false;
      canvas.classList.remove('is-panning');
      try { if (panState.pid !== undefined) canvas.releasePointerCapture(panState.pid); } catch (e) { /* 無視 */ }
      setTimeout(function () { panState.moved = false; }, 0);
    };
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return; // タッチはブラウザ標準のスクロールに任せる
      if (e.button !== 0 && e.button !== 1) return;
      if (e.target.closest('[data-sq]') || e.target.closest('.sh-item') || e.target.closest('.minimap')) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
      panState.active = true; panState.moved = false; panState.pid = e.pointerId;
      panState.x = e.clientX; panState.y = e.clientY;
      panState.sl = canvas.scrollLeft; panState.st = canvas.scrollTop;
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!panState.active) return;
      if (e.buttons === 0) { endPan(); return; }
      var dx = e.clientX - panState.x, dy = e.clientY - panState.y;
      if (!panState.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        panState.moved = true;
        canvas.classList.add('is-panning');
        try { canvas.setPointerCapture(panState.pid); } catch (err) { /* 無視 */ }
      }
      if (panState.moved) { canvas.scrollLeft = panState.sl - dx; canvas.scrollTop = panState.st - dy; }
    });
    canvas.addEventListener('pointerup', endPan);
    canvas.addEventListener('pointercancel', endPan);
    canvas.addEventListener('lostpointercapture', endPan);
    canvas.addEventListener('dragstart', function (e) { e.preventDefault(); endPan(); });
    window.addEventListener('blur', endPan);
    canvas.addEventListener('scroll', function () { if (!raf2) raf2 = requestAnimationFrame(function () { raf2 = null; drawMinimap(); }); });
    var raf2 = null;
    var mm = $('#minimap');
    if (mm) {
      var mmDrag = false;
      mm.addEventListener('pointerdown', function (e) { mmDrag = true; mm.setPointerCapture(e.pointerId); minimapJump(e); e.preventDefault(); });
      mm.addEventListener('pointermove', function (e) { if (mmDrag && e.buttons) minimapJump(e); });
      mm.addEventListener('pointerup', function () { mmDrag = false; });
      $('#minimapClose').onclick = function () { lsSet('minimap', false); $('#minimapBox').hidden = true; toast('ミニマップは「表示設定」から再表示できます'); };
    }

    // パネル幅の変更
    var splitter = $('#splitter');
    splitter.addEventListener('mousedown', function (e) {
      e.preventDefault();
      splitter.classList.add('is-dragging');
      var move = function (ev) {
        var w = clamp(window.innerWidth - ev.clientX, 280, Math.min(900, window.innerWidth - 360));
        document.documentElement.style.setProperty('--panel-w', w + 'px');
      };
      var up = function () {
        splitter.classList.remove('is-dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        var w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'), 10);
        if (w) lsSet('panelWidth', w);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    // キーボード
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.altKey && e.key === '1') { $('#btnNav').click(); e.preventDefault(); return; }
      if (e.altKey && e.key === '2') { $('#btnPanel').click(); e.preventDefault(); return; }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); }
      else if (e.key === 'Escape') { $$('.menu').forEach(function (m) { m.hidden = true; }); $('#legend').hidden = true; clearSelection(); }
      else if (e.key === '+' || e.key === '=') zoomBy(1.2);
      else if (e.key === '-') zoomBy(1 / 1.2);
      else if (e.key === '0') applyZoom(1);
      else if (e.key === 'f' || e.key === 'F') fitZoom('all');
      else if (e.key === 'w' || e.key === 'W') fitZoom('width');
      else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveSelection(-1); }
    });

    window.addEventListener('popstate', function () {
      // 戻る／進む: 図・ステップ・ライフラインの選択を URL から一通り復元する
      var hsh = parseHash();
      var target = hsh.d || params.get('diagram') || rootDiagrams()[0];
      if (!model._index.diagrams.has(target)) return;
      var restore = function () {
        if (hsh.s && model._index.steps.has(hsh.s)) selectStep(hsh.s, { scroll: true });
        else if (hsh.l && model._index.lifelines.has(hsh.l)) selectLifeline(hsh.l, { scroll: true });
        else { clearMarks(); state.selection = null; renderEmptyDetail(); }
      };
      if (target !== state.diagramId) {
        state.navSeq++;
        state.diagramId = target;
        state.selection = null;
        render({ initialZoom: true }).then(restore);
      } else restore();
    });
    window.addEventListener('resize', function () { positionSticky(); });
  }
  var panState = { active: false, moved: false };

  function toggleMenu(sel) {
    var m = $(sel);
    var willOpen = m.hidden;
    $$('.menu').forEach(function (x) { x.hidden = true; });
    m.hidden = !willOpen;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
