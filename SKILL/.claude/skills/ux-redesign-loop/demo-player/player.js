/*
 * player.js — 仮説デモの再生
 *
 * デモの HTML で window.UX_DEMO（台本）を定義してから、このファイルを読み込む。
 * 台本の書き方は references/demo.md にある。画面は次の 2 つに分かれる。
 *   左：プロトタイプ（iframe）。台本の state を demo-bridge.js 経由で送り、画面を場面に合わせて切り替える。
 *   右：登場人物の発言・心の声・状況の説明・画面の操作、設計チームの仮説と未確認事項。
 * 操作：→ / Space 次へ、← 前へ、Home はじめ、End おわり、P 自動再生、M メモ、C 会話の表示の切り替え、1〜9 場面へ移る。
 * URL の #s=3&b=2 で「3 番目の場面の 2 手目」を直接開ける（スクリーンショット用）。
 */
(function () {
  'use strict';

  var D = window.UX_DEMO;
  if (!D || !Array.isArray(D.scenes)) {
    document.body.textContent = 'window.UX_DEMO（台本）が見つからない。player.js より前に台本を定義する。';
    return;
  }

  var EVIDENCE = ['[観察]', '[発言]', '[資料]'];
  var DESIGN = ['[推論]', '[仮定]', '[机上]', '[AI模擬]'];
  var TYPES = ['situation', 'say', 'think', 'do', 'hypothesis', 'question'];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 小さな道具 ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  function icon(name, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ds-icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#uxd-i-' + name);
    svg.appendChild(use);
    return svg;
  }
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 保存できない環境では、その場だけ */ } }

  var SPRITE = {
    'arrow-left': '<path d="M13 8H3M7 4L3 8l4 4"/>',
    'arrow-right': '<path d="M3 8h10M9 4l4 4-4 4"/>',
    'clock': '<circle cx="8" cy="8" r="7"/><path d="M8 4v4l3 2"/>',
    'pin': '<path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z"/><circle cx="8" cy="6.5" r="1.8"/>',
    'user': '<circle cx="8" cy="5" r="3"/><path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/>',
    'thought': '<path d="M4.5 10.5a3 3 0 0 1-.2-6A3.6 3.6 0 0 1 11 3.6a3 3 0 0 1 .6 5.9 2.4 2.4 0 0 1-2.6 1H4.5z"/><circle cx="3.6" cy="13" r="1"/><circle cx="1.9" cy="15" r=".4"/>',
    'cursor': '<path d="M3 2l9.5 5.2-4.1 1.1 2.4 4.6-1.9 1-2.4-4.6L3 12.3z"/>',
    'bulb': '<path d="M6 12.5h4M6.5 15h3M5.5 10.5C4.3 9.6 3.5 8.3 3.5 6.5a4.5 4.5 0 0 1 9 0c0 1.8-.8 3.1-2 4z"/>',
    'help': '<circle cx="8" cy="8" r="7"/><path d="M6 6a2 2 0 1 1 2.5 1.9c-.4.2-.5.5-.5.9v.5"/><circle cx="8" cy="11.9" r="1.1" fill="currentColor" stroke="none"/>',
    'play': '<path d="M4.5 2.5v11l9-5.5z"/>',
    'pause': '<path d="M5 3v10M11 3v10"/>',
    'sliders': '<path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>',
    'theme': '<circle cx="8" cy="8" r="6.5"/><path d="M8 1.5v13A6.5 6.5 0 0 0 8 1.5z" fill="currentColor"/>',
    'sun': '<circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1"/>',
    'moon': '<path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z"/>',
    'check': '<path d="M2.5 8.5l3.5 3.5 7.5-8"/>',
    'warning': '<path d="M8 1.5L15 14.5H1z"/><path d="M8 5.9v3.3"/><circle cx="8" cy="11.8" r="1.05" fill="currentColor" stroke="none"/>',
    'monitor': '<rect x="1.5" y="2.5" width="13" height="8.5" rx="1"/><path d="M5.5 14h5M8 11v3"/>',
    'copy': '<rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V2H2v9h3"/>',
    'download': '<path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11"/>',
    'target': '<circle cx="8" cy="8" r="7"/><circle cx="8" cy="8" r="4"/><circle cx="8" cy="8" r="1"/>',
    'compose': '<path d="M7 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9"/><path d="M12 1.5l2.5 2.5L8 10.5H5.5V8z"/>'
  };
  (function injectSprite() {
    var box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.display = 'none';
    box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + Object.keys(SPRITE).map(function (k) {
      return '<symbol id="uxd-i-' + k + '" viewBox="0 0 16 16">' + SPRITE[k] + '</symbol>';
    }).join('') + '</svg>';
    document.body.appendChild(box);
  })();

  /* ---------- 台本の点検（作り手向け。問題は「はじめに」の札と console に出す） ---------- */
  var cast = {};
  (D.cast || []).forEach(function (c, i) { cast[c.id] = c; if (!c.tone) c.tone = (i % 5) + 1; });
  var hyps = {};
  (D.hypotheses || []).forEach(function (x) { hyps[x.id] = x; });
  var problems = [];
  if (!D.prototype) problems.push('prototype（プロトタイプのパス）がない');
  if (!(D.hypotheses || []).length) problems.push('hypotheses（このデモで確かめる仮説）がない');
  D.scenes.forEach(function (sc, si) {
    if (!Array.isArray(sc.beats) || !sc.beats.length) { problems.push('場面 ' + (si + 1) + '：beats がない'); sc.beats = []; }
    sc.beats.forEach(function (b, bi) {
      var at = '場面 ' + (si + 1) + ' の ' + (bi + 1) + ' 手目';
      if (TYPES.indexOf(b.type) < 0) problems.push(at + '：type「' + b.type + '」は使えない');
      if ((b.type === 'say' || b.type === 'think' || b.type === 'do') && !cast[b.who]) problems.push(at + '：who「' + b.who + '」が cast にない');
      if (b.type === 'hypothesis' && b.ref && !hyps[b.ref]) problems.push(at + '：ref「' + b.ref + '」が hypotheses にない');
      if (b.label && EVIDENCE.indexOf(b.label) < 0 && DESIGN.indexOf(b.label) < 0) problems.push(at + '：label「' + b.label + '」は使えない');
      if ((b.type === 'say' || b.type === 'think') && !b.label) problems.push(at + '：label（根拠のラベル）がない');
      if (b.type === 'think' && EVIDENCE.indexOf(b.label) >= 0 && b.label !== '[発言]') problems.push(at + '：心の声に ' + b.label + ' は付けられない（本人が語った場合だけ [発言]）');
    });
  });
  if (problems.length && window.console) console.warn('[仮説デモ] 台本の問題', problems);

  /* ---------- 状態 ---------- */
  var settings = Object.assign({ say: true, think: true, notes: true, labels: true, highlight: true, speed: 1 }, load('uxdemo-settings', {}));
  var memoKey = 'uxdemo-memo:' + (D.id || '') + ':' + decodeURIComponent(location.pathname);
  var memos = Object.assign({ scenes: {}, hyps: {} }, load(memoKey, {}));
  var flat = [];
  var cur = -1;          // -1 = はじめに、flat.length = おわりに
  var lastSi = -2;
  var view = 'log';
  var playing = false, playTimer = 0;
  var choiceInputs = {};   // 表示の設定のチェック（「解説だけ」の切り替えと揃えるため）
  var applyId = 0, protoReady = false, readyTimer = 0;

  function visible(b) {
    if (b.type === 'say' && !settings.say) return false;
    if (b.type === 'think' && !settings.think) return false;
    if ((b.type === 'hypothesis' || b.type === 'question') && !settings.notes) return false;
    return true;
  }
  function buildFlat() {
    flat = [];
    D.scenes.forEach(function (sc, si) {
      var n = flat.length;
      sc.beats.forEach(function (b, bi) { if (visible(b)) flat.push({ si: si, bi: bi }); });
      // 見せる手が 1 つもない場面（会話だけの場面を「解説だけ」で見たとき）も飛ばさない。画面の切り替わりは見せる
      if (flat.length === n && sc.beats.length) flat.push({ si: si, bi: sc.beats.length - 1, empty: true });
    });
  }
  function pos(i) {
    if (i < 0) return { si: 0, bi: -1, intro: true };
    if (i >= flat.length) { var last = flat[flat.length - 1] || { si: D.scenes.length - 1, bi: -1 }; return { si: last.si, bi: D.scenes[last.si].beats.length - 1, end: true }; }
    return flat[i];
  }

  /* 画面の状態は、前の場面から引き継ぎ、書いたキーだけを上書きする（隠した手の state も当てる） */
  function effective(p) {
    var state = {}, screen = '', hl = null, hlLabel = '', spot = false;
    for (var si = 0; si <= p.si; si++) {
      var sc = D.scenes[si];
      if (sc.state) Object.assign(state, sc.state);
      if (sc.screen) screen = sc.screen;
      if (si === p.si) { hl = sc.highlight || null; hlLabel = sc.highlightLabel || ''; spot = !!sc.spot; }
      var upto = si < p.si ? sc.beats.length - 1 : p.bi;
      for (var bi = 0; bi <= upto; bi++) {
        var b = sc.beats[bi];
        if (b.state) Object.assign(state, b.state);
        if (b.screen) screen = b.screen;
        if (si === p.si && b.highlight !== undefined) {
          hl = b.highlight;
          hlLabel = b.tag || (b.type === 'do' && cast[b.who] ? cast[b.who].name + '：' + b.text : '');
          spot = !!b.spot;
        }
      }
    }
    if (p.intro) { hl = null; }
    return { state: state, screen: screen, highlight: settings.highlight ? hl : null, highlightLabel: hlLabel, spot: spot };
  }

  /* ---------- 骨組み ---------- */
  var refs = [D.refs && D.refs.case, D.refs && D.refs.scenario, D.refs && D.refs.iteration].filter(Boolean).join(' / ');
  var app = h('div', { class: 'uxd' });
  document.body.classList.add('ds-body');
  document.body.appendChild(app);

  var sceneList = h('ol', { class: 'uxd-scenes', 'aria-label': '場面' });
  var settingsMenu = h('details', { class: 'ds-menu ds-menu--end' },
    h('summary', { class: 'ds-btn ds-btn--icon', 'aria-label': '表示の設定', title: '表示の設定' }, icon('sliders')),
    h('div', { class: 'ds-menu__list' },
      h('p', { class: 'ds-menu__group', style: 'margin:0', text: '表示するもの' }),
      h('div', { class: 'uxd-settings' },
        choice('say', '発言'),
        choice('think', '心の声'),
        choice('notes', '仮説・未確認（設計チームの書き込み）'),
        choice('labels', '根拠のラベル'),
        choice('highlight', '画面の強調（操作する所の枠）'))));
  var themeMenu = h('details', { class: 'ds-menu ds-menu--end' },
    h('summary', { class: 'ds-btn ds-btn--icon', 'aria-label': '画面の明るさ', title: '画面の明るさ' }, icon('theme')),
    h('div', { class: 'ds-menu__list', role: 'menu', 'aria-label': '画面の明るさ' },
      h('p', { class: 'ds-menu__group', style: 'margin:0', text: '画面の明るさ' }),
      themeItem('auto', 'パソコンの設定に合わせる', 'theme'),
      themeItem('light', '明るい', 'sun'),
      themeItem('dark', '暗い', 'moon')));

  app.appendChild(h('header', { class: 'uxd-top' },
    h('span', { class: 'uxd-kind', title: '設計チームが仮説を立てるためのデモ。お客さんに見せるものではない' }, icon('bulb'), '仮説立案用'),
    h('div', { class: 'uxd-heading' }, h('h1', { text: D.title || '仮説デモ' }), h('p', { text: [D.id, refs].filter(Boolean).join('　') })),
    sceneList,
    h('div', { class: 'uxd-top__end' }, settingsMenu, themeMenu)));

  var frameFile = h('span', { class: 'uxd-frame__file', text: D.prototype || '' });
  var frameScreen = h('span', { class: 'uxd-frame__screen', hidden: true });
  var frameWarn = h('span', { class: 'uxd-frame__warn', role: 'status', hidden: true });
  var iframe = h('iframe', { title: 'プロトタイプ', src: D.prototype || 'about:blank' });
  var frame = h('div', { class: 'uxd-frame' },
    h('div', { class: 'uxd-frame__bar' }, h('span', { class: 'uxd-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), icon('monitor'), frameFile, frameScreen, frameWarn),
    iframe);
  var caption = h('div', { class: 'uxd-caption', 'aria-hidden': 'true' }, h('small'), h('strong'));
  var stage = h('section', { class: 'uxd-stage', 'aria-label': 'プロトタイプ' }, frame, caption);

  var tabLog = tabBtn('log', '会話と状況');
  var tabHyp = tabBtn('hyps', '仮説');
  var tabMemo = tabBtn('memos', 'メモ');
  var sceneHead = h('div', { class: 'uxd-scenehead' });
  var log = h('div', { class: 'uxd-log', 'aria-live': 'polite' });
  var listView = h('div', { class: 'uxd-list', hidden: true });
  var scroll = h('div', { class: 'uxd-scroll' }, log, listView);
  var progress = h('i');
  var memoBox = h('textarea', { class: 'ds-textarea', id: 'uxd-memo', placeholder: 'この場面で気付いたこと、別の解釈、確かめたいこと', oninput: function () { var sc = D.scenes[pos(cur).si]; setMemo('scenes', sc.id || String(pos(cur).si), memoBox.value); } });
  var memoLabel = h('label', { class: 'uxd-field-label', for: 'uxd-memo' });
  var memoPanel = h('div', { class: 'uxd-memo', hidden: true }, memoLabel, memoBox);
  var btnPrev = h('button', { class: 'ds-btn ds-btn--icon', type: 'button', 'aria-label': '前へ（←）', title: '前へ（←）', onclick: function () { stop(); go(cur - 1); } }, icon('arrow-left'));
  var btnNext = h('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: function () { stop(); go(cur + 1); } });
  var btnPlay = h('button', { class: 'ds-btn', type: 'button', 'aria-pressed': 'false', onclick: togglePlay });
  var speed = h('select', { class: 'ds-select', 'aria-label': '自動再生の速さ', onchange: function () { settings.speed = Number(speed.value); save('uxdemo-settings', settings); if (playing) schedule(); } },
    [0.75, 1, 1.5, 2].map(function (v) { return h('option', { value: String(v), selected: settings.speed === v, text: '×' + v }); }));
  var btnMemo = h('button', { class: 'ds-btn ds-btn--link uxd-btn-memo', type: 'button', 'aria-expanded': 'false', onclick: function () { toggleMemo(); } }, icon('compose'), 'メモ');
  var posText = h('span', { class: 'uxd-pos' });

  var pane = h('section', { class: 'uxd-pane', 'aria-label': '登場人物と状況' },
    h('div', { class: 'uxd-pane__tabs' }, h('div', { class: 'ds-tabs', role: 'tablist' }, tabLog, tabHyp, tabMemo)),
    sceneHead,
    scroll,
    h('div', { class: 'uxd-foot' },
      h('div', { class: 'uxd-progress', 'aria-hidden': 'true' }, progress),
      memoPanel,
      h('div', { class: 'uxd-controls' }, btnPrev, btnNext, btnPlay, speed, btnMemo, posText)));

  /* 会話の欄の幅を変える境目。ドラッグ、または焦点を当てて ← → で変える。ダブルクリックで元の幅に戻す */
  var PANE_DEFAULT = 460, PANE_MIN = 320, STAGE_MIN = 280;
  var resizer = h('div', { class: 'uxd-resizer', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical',
    'aria-label': '会話の欄の幅。← で広げ、→ で狭める。ダブルクリックで元の幅に戻す',
    title: 'ドラッグで会話の欄の幅を変える（ダブルクリックで元に戻す）' });
  var body = h('div', { class: 'uxd-body' }, stage, resizer, pane);
  app.appendChild(body);
  function paneMax() { return Math.max(PANE_MIN, body.clientWidth - STAGE_MIN - 8); }
  function setPane(w, persist) {
    w = Math.round(Math.max(PANE_MIN, Math.min(paneMax(), w)));
    app.style.setProperty('--uxd-pane', w + 'px');
    resizer.setAttribute('aria-valuemin', String(PANE_MIN));
    resizer.setAttribute('aria-valuemax', String(paneMax()));
    resizer.setAttribute('aria-valuenow', String(w));
    if (persist) save('uxdemo-pane', w);
    return w;
  }
  var paneWidth = Number(load('uxdemo-pane', PANE_DEFAULT)) || PANE_DEFAULT;
  var drag = null;
  resizer.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, w: pane.getBoundingClientRect().width };
    app.classList.add('is-resizing');
  });
  resizer.addEventListener('pointermove', function (e) {
    if (!drag) return;
    paneWidth = setPane(drag.w + (drag.x - e.clientX));
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    app.classList.remove('is-resizing');
    paneWidth = setPane(paneWidth, true);
  }
  resizer.addEventListener('pointerup', endDrag);
  resizer.addEventListener('pointercancel', endDrag);
  resizer.addEventListener('dblclick', function () { paneWidth = setPane(PANE_DEFAULT, true); });
  resizer.addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 120 : 40;
    var next = e.key === 'ArrowLeft' ? paneWidth + step : e.key === 'ArrowRight' ? paneWidth - step
      : e.key === 'Home' ? paneMax() : e.key === 'End' ? PANE_MIN : e.key === 'Enter' ? PANE_DEFAULT : null;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();   // ← → を「前へ・次へ」に使わせない
    paneWidth = setPane(next, true);
  });
  window.addEventListener('resize', function () { paneWidth = setPane(paneWidth); });

  function choice(key, text) {
    var input = choiceInputs[key] = h('input', { type: 'checkbox', checked: settings[key] !== false, onchange: function () { settings[key] = input.checked; save('uxdemo-settings', settings); applySettings(true); } });
    return h('label', { class: 'ds-choice' }, input, h('span', { text: text }));
  }
  function themeItem(value, text, ic) {
    var cur = document.documentElement.dataset.theme || 'auto';
    var b = h('button', { class: 'ds-menu__item', role: 'menuitemradio', 'data-theme-choice': value, 'aria-checked': String(cur === value) }, icon(ic), text);
    var chk = icon('check', 'ds-menu__check');
    b.appendChild(chk);
    return b;
  }
  function tabBtn(id, text) {
    var count = h('span', { class: 'uxd-count' });
    var b = h('button', { class: 'ds-tabs__tab', role: 'tab', type: 'button', 'aria-selected': String(id === view), onclick: function () { setView(id); } }, text, count);
    b._count = count;
    return b;
  }

  /* ---------- 描画 ---------- */
  function labelChip(label) {
    if (!label) return null;
    var ev = EVIDENCE.indexOf(label) >= 0;
    return h('span', { class: 'uxd-label ' + (ev ? 'uxd-label--evidence' : 'uxd-label--design'), title: ev ? '実際の証拠（観察・発言・資料）' : '設計チームが置いたもの（推論・仮定・机上・AI模擬）。実ユーザーの証拠ではない' }, label);
  }
  /* 人物の印は、簡単な顔の絵にする（台本の cast[].face で髪型・髪の色・肌・眼鏡を選ぶ。face: false で頭文字）。
     服の色は人物の色（tone）にし、吹き出しの線や印の輪と揃える */
  var HAIR_COLOR = { black: '#2f2723', brown: '#5b3b26', gray: '#9b9b9b', dark: '#3a3a44' };
  var SKIN = ['#f6dcc6', '#eac3a2', '#d9a982', '#b8835c'];
  var FRONT = {
    short: 'M10.8 15.6c-.4-5.4 2.9-8.9 7.2-8.9 4.4 0 7.7 3.3 7.2 8.9-1.1-2.7-3.4-4.3-6.2-4.6-.9 1.3-3 2.3-5.4 2.6-1.1.3-2.1 1-2.8 2z',
    side: 'M10.8 16c-.6-5.6 2.8-9.3 7.4-9.3 4.3 0 7.5 3.2 7 8.4-2.2-.8-4.7-2.4-6.4-4.6-1.8 2.6-4.5 4.4-8 5.5z',
    long: 'M10.6 16.4c-.3-5.8 3-9.5 7.4-9.5s7.7 3.7 7.4 9.5c-2.4-1.2-4.4-3.2-5.4-5.4-1.6 2.6-5 4.6-9.4 5.4z',
    bob: 'M10.6 15.8c-.2-5.5 3-9 7.4-9s7.6 3.5 7.4 9c-3-.6-6-1.1-7.4-3.6-1.4 2.5-4.4 3-7.4 3.6z'
  };
  var BACK = {
    long: 'M9.6 17.5c0-6.4 3.7-10.2 8.4-10.2s8.4 3.8 8.4 10.2v9.5H9.6z',
    bob: 'M10 17c0-6 3.6-9.6 8-9.6s8 3.6 8 9.6v4.6H10z'
  };
  function hashOf(s) { var n = 7; for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; }
  function faceSvg(c) {
    var f = c.face || {}, n = hashOf(String(c.id || c.name || ''));
    var hair = FRONT[f.hair] ? f.hair : ['short', 'side', 'long', 'bob'][n % 4];
    var hc = HAIR_COLOR[f.hairColor] || f.hairColor || HAIR_COLOR[['black', 'brown', 'dark'][(n >> 3) % 3]];
    var skin = typeof f.skin === 'number' ? SKIN[f.skin] : f.skin || SKIN[(n >> 5) % 2];
    var p = [];
    if (BACK[hair]) p.push('<path d="' + BACK[hair] + '" fill="' + hc + '"/>');
    p.push('<path d="M5 37c0-7.2 5.8-11.2 13-11.2S31 29.8 31 37z" style="fill:var(--tone)"/>');
    p.push('<path d="M15.6 21.5h4.8v4.6a2.4 2.4 0 0 1-4.8 0z" fill="' + skin + '"/>');
    p.push('<ellipse cx="18" cy="16.2" rx="7" ry="7.6" fill="' + skin + '"/>');
    p.push('<path d="' + FRONT[hair] + '" fill="' + hc + '"/>');
    p.push('<circle cx="15.4" cy="16.8" r=".95" fill="#2b2522"/><circle cx="20.6" cy="16.8" r=".95" fill="#2b2522"/>');
    p.push('<path d="M16 20q2 1.4 4 0" fill="none" stroke="#7a4a3a" stroke-width=".9" stroke-linecap="round"/>');
    if (f.glasses) p.push('<g fill="none" stroke="#33302e" stroke-width=".8"><circle cx="15.4" cy="16.8" r="2.3"/><circle cx="20.6" cy="16.8" r="2.3"/><path d="M17.7 16.6h.6"/></g>');
    return '<svg viewBox="3 3.5 30 30" aria-hidden="true" focusable="false">' + p.join('') + '</svg>';
  }
  function avatar(c) {
    if (c.face === false) return h('span', { class: 'uxd-avatar', 'data-tone': String(c.tone), 'aria-hidden': 'true', title: c.name }, c.initial || (c.name || '?').slice(0, 1));
    var el = h('span', { class: 'uxd-avatar uxd-avatar--face', 'data-tone': String(c.tone), 'aria-hidden': 'true', title: c.name });
    el.innerHTML = faceSvg(c);
    return el;
  }
  function whoLine(c, extra, label) {
    return h('div', { class: 'uxd-who' }, h('b', { text: c.name }), c.role ? h('span', { text: c.role }) : null, extra, labelChip(label));
  }
  function sceneMeta(sc) {
    return [sc.time ? h('span', null, icon('clock'), sc.time) : null, sc.place ? h('span', null, icon('pin'), sc.place) : null];
  }

  function renderBeat(b, si, bi, state) {
    var c = cast[b.who] || { name: b.who || '', tone: 0 };
    var cls = 'uxd-beat uxd-beat--' + b.type + (state ? ' ' + state : '');
    var el;
    if (b.type === 'say') {
      el = h('div', { class: cls, 'data-tone': String(c.tone) }, avatar(c),
        h('div', null, whoLine(c, null, b.label), h('p', { class: 'uxd-bubble', text: b.text })));
    } else if (b.type === 'think') {
      el = h('div', { class: cls, 'data-tone': String(c.tone) }, avatar(c),
        h('div', null, whoLine(c, h('span', { class: 'uxd-think-tag' }, icon('thought'), '心の声'), b.label), h('p', { class: 'uxd-bubble', text: b.text })));
    } else if (b.type === 'situation') {
      el = h('div', { class: cls + ' uxd-beat--wide' },
        h('div', { class: 'uxd-situation' },
          h('div', { class: 'uxd-situation__meta' }, icon('clock'), b.when || '状況', labelChip(b.label)),
          b.text));
    } else if (b.type === 'do') {
      var again = state && state.indexOf('is-current') >= 0 && b.highlight ? h('button', { class: 'ds-btn ds-btn--link', type: 'button', onclick: function (e) { e.stopPropagation(); send(true); } }, icon('target'), 'もう一度示す') : null;
      el = h('div', { class: cls, 'data-tone': String(c.tone) }, avatar(c),
        h('div', { class: 'uxd-do' }, icon('cursor'), h('span', { class: 'uxd-do__text' }, h('b', { text: c.name }), '：' + b.text), labelChip(b.label), again));
    } else if (b.type === 'hypothesis') {
      var hy = hyps[b.ref] || {};
      var falsify = b.falsify || hy.falsify, check = b.check || hy.check;
      el = h('div', { class: cls + ' uxd-beat--wide' },
        h('div', { class: 'uxd-note uxd-note--hypothesis' },
          h('div', { class: 'uxd-note__head' }, icon('bulb'), '仮説', b.ref ? h('span', { class: 'uxd-hid', text: b.ref }) : null, labelChip(b.label || hy.label || '[推論]')),
          h('p', { text: b.text || hy.text || '' }),
          (falsify || check) ? h('dl', null, falsify ? [h('dt', { text: '反証条件' }), h('dd', { text: falsify })] : null, check ? [h('dt', { text: '確かめ方' }), h('dd', { text: check })] : null) : null,
          b.ref ? h('div', null, h('button', { class: 'ds-btn ds-btn--link', type: 'button', onclick: function (e) { e.stopPropagation(); setView('hyps', b.ref); } }, '仮説の一覧で見る・メモする')) : null));
    } else if (b.type === 'question') {
      el = h('div', { class: cls + ' uxd-beat--wide' },
        h('div', { class: 'uxd-note uxd-note--question' },
          h('div', { class: 'uxd-note__head' }, icon('help'), '未確認', labelChip(b.label || '[仮定]')),
          h('p', { text: b.text }),
          b.to ? h('dl', null, h('dt', { text: '確認先' }), h('dd', { text: b.to })) : null));
    } else {
      el = h('div', { class: cls + ' uxd-beat--wide' }, h('p', { class: 'uxd-situation', text: String(b.text || '') }));
    }
    if (state && (state.indexOf('is-past') >= 0 || state.indexOf('is-future') >= 0)) {
      el.tabIndex = 0;
      el.title = state.indexOf('is-past') >= 0 ? 'ここまで戻る' : 'ここへ進む';
      el.style.cursor = 'pointer';
      var idx = flatIndex(si, bi);
      el.addEventListener('click', function () { stop(); go(idx); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { stop(); go(idx); } });
    }
    return el;
  }
  function flatIndex(si, bi) { for (var i = 0; i < flat.length; i++) if (flat[i].si === si && flat[i].bi === bi) return i; return -1; }

  function introCard() {
    var castList = h('ul', { class: 'uxd-cast' }, (D.cast || []).map(function (c) {
      return h('li', null, avatar(c), h('div', null,
        h('div', { class: 'uxd-cast__name' }, h('b', { text: c.name }), c.role ? h('span', { text: c.role }) : null, labelChip(c.label)),
        c.profile ? h('p', { class: 'uxd-cast__profile', text: c.profile }) : null));
    }));
    var hlist = h('ul', { class: 'uxd-hlist' }, (D.hypotheses || []).map(function (x) { return h('li', null, h('span', { class: 'uxd-hid', text: x.id }), h('span', { text: x.text })); }));
    return h('div', { class: 'uxd-card' },
      h('h2', { text: 'このデモで考えたいこと' }),
      D.purpose ? h('p', { text: D.purpose }) : null,
      h('div', { class: 'ds-alert ds-alert--warning' }, icon('warning'),
        h('div', { class: 'ds-alert__content', text: D.disclaimer || '登場人物・発言・心の声は、設計チームが根拠のラベルとともに置いたものである。[発言] [観察] [資料] 以外は実ユーザーの証拠ではなく、このデモで改善を確かめたことにはならない。' })),
      problems.length ? h('div', { class: 'ds-alert ds-alert--error' }, icon('warning'), h('div', { class: 'ds-alert__content' }, h('b', { text: '台本の問題（作り手向け）' }), h('ul', { style: 'margin:4px 0 0;padding-left:1.2em' }, problems.map(function (p) { return h('li', { text: p }); })))) : null,
      h('h3', { text: '登場人物' }), castList,
      h('h3', { text: '仮説' }), hlist,
      h('div', { class: 'uxd-legend', 'aria-label': '表示の見方' },
        h('span', null, h('span', { class: 'uxd-label uxd-label--evidence', text: '[発言]' }), '実際の証拠'),
        h('span', null, h('span', { class: 'uxd-label uxd-label--design', text: '[仮定]' }), '設計チームが置いたもの'),
        h('span', null, icon('thought'), '点線の吹き出しは心の声')),
      h('div', null, h('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: function () { go(0); } }, '始める', icon('arrow-right'))));
  }
  function endCard() {
    var sceneMemos = Object.keys(memos.scenes).filter(function (k) { return memos.scenes[k]; }).length;
    var hypMemos = Object.keys(memos.hyps).filter(function (k) { return memos.hyps[k]; }).length;
    return h('div', { class: 'uxd-card' },
      h('h2', { text: '最後の場面まで来た' }),
      h('p', { text: '場面へのメモ ' + sceneMemos + ' 件、仮説へのメモ ' + hypMemos + ' 件。書き出したメモは、設計の記録（未解決事項・前提台帳・次の反復）に反映する。' }),
      h('ul', { class: 'uxd-hlist' }, (D.hypotheses || []).map(function (x) {
        return h('li', null, h('span', { class: 'uxd-hid', text: x.id }), h('span', null, x.text, memos.hyps[x.id] ? h('span', { class: 'uxd-label uxd-label--design', style: 'margin-left:6px', text: 'メモあり' }) : null));
      })),
      h('div', { class: 'ds-btn-group' },
        h('button', { class: 'ds-btn', type: 'button', onclick: function () { setView('hyps'); } }, '仮説にメモする'),
        h('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: downloadMd }, icon('download'), 'メモを書き出す')));
  }

  /* 会話の欄には、台本の全体を並べる。今の場面は、これまでの手・今の手・この先の手を順に出し、この先の手は薄く出す。
     終わった場面とこれからの場面は畳んだ見出しにし、開けば読める。押した手へ移れるので、先の場面へもすぐ飛べる。
     畳んだ・開いたは、進めても描き直しても保つ */
  var openScenes = {};   // 開いている見出し（キー：'intro' または場面の番号）
  function foldable(key, cls, summaryKids, kids) {
    // 中身は間隔を付けた箱で包む。details の中身はブラウザが用意した 1 つの入れ物に入るので、
    // details 自体に gap を指定しても、中の手と手のあいだには効かない
    var d = h('details', { class: 'uxd-past ' + cls }, h('summary', { class: 'uxd-scene' }, summaryKids), h('div', { class: 'uxd-past__body' }, kids));
    if (openScenes[key]) d.open = true;
    d.addEventListener('toggle', function () { openScenes[key] = d.open; });
    return d;
  }
  function hiddenNote(isCur) {
    return h('p', { class: 'uxd-hidden-note' + (isCur ? ' is-current' : '') },
      'この場面の手は、いまの表示の設定ではすべて隠れている（発言・心の声など）。画面は場面に合わせて切り替えている。',
      h('button', { class: 'ds-btn ds-btn--link', type: 'button', onclick: function () { setConversation(true); } }, '会話も見る'));
  }
  function sceneLabel(si) {
    var sc = D.scenes[si];
    return '場面 ' + (si + 1) + (sc.time ? '　' + sc.time : '') + '　' + (sc.title || '');
  }
  function renderLog(animateCurrent) {
    var p = pos(cur);
    log.textContent = '';
    if (p.intro) log.appendChild(introCard());
    else log.appendChild(foldable('intro', 'uxd-done', 'はじめに　目的・登場人物・仮説', introCard()));
    D.scenes.forEach(function (sc, si) {
      var phase = p.intro ? 'future' : p.end || si < p.si ? 'past' : si === p.si ? 'current' : 'future';
      var beats = [];
      var aheadPlaced = false;
      sc.beats.forEach(function (b, bi) {
        if (!visible(b)) return;
        var state;
        if (phase === 'past') state = 'is-past';
        else if (phase === 'future') state = 'is-future';
        else if (bi < p.bi) state = 'is-past';
        else if (bi === p.bi) state = 'is-current' + (animateCurrent ? ' is-new' : '');
        else {
          state = 'is-future';
          if (!aheadPlaced) { beats.push(h('div', { class: 'uxd-ahead', role: 'separator' }, 'この先（まだ進めていない）')); aheadPlaced = true; }
        }
        beats.push(renderBeat(b, si, bi, state));
      });
      var visibleCount = sc.beats.filter(visible).length;
      if (!visibleCount) beats.push(hiddenNote(phase === 'current'));
      if (phase === 'current') {
        log.appendChild(h('div', { class: 'uxd-scene uxd-scene--current' }, sceneLabel(si)));
        beats.forEach(function (el) { log.appendChild(el); });
        return;
      }
      var first = flat.findIndex(function (f) { return f.si === si; });
      var jump = phase === 'future' && first >= 0
        ? h('div', null, h('button', { class: 'ds-btn ds-btn--link uxd-jump', type: 'button', onclick: function () { stop(); go(first); } }, icon('arrow-right'), 'この場面から見る'))
        : null;
      var summary = [sceneLabel(si), phase === 'future' ? h('span', { class: 'uxd-scene__tag', text: 'これから ・ ' + visibleCount + ' 手' }) : null];
      log.appendChild(foldable(String(si), phase === 'past' ? 'uxd-done' : 'uxd-future', summary, [jump].concat(beats)));
    });
    if (p.end) log.appendChild(endCard());
  }

  /* 会話（発言と心の声）を見せるか、状況・画面の操作・仮説などの解説だけを見せるかの切り替え。C キーでも切り替わる */
  function modeSwitch() {
    var all = settings.say && settings.think, only = !settings.say && !settings.think;
    var b1 = h('button', { type: 'button', 'aria-pressed': String(all), title: '発言・心の声も見せる（C）', onclick: function () { setConversation(true); } }, '会話と解説');
    var b2 = h('button', { type: 'button', 'aria-pressed': String(only), title: '状況・画面の操作・仮説だけを見せる（C）', onclick: function () { setConversation(false); } }, '解説だけ');
    return h('div', { class: 'ds-segmented ds-segmented--s uxd-mode', role: 'group', 'aria-label': '会話を見せるか' }, b1, b2);
  }
  function setConversation(on) {
    settings.say = on; settings.think = on;
    save('uxdemo-settings', settings);
    applySettings(true);
  }
  function renderSceneHead() {
    var p = pos(cur);
    sceneHead.textContent = '';
    sceneHead.appendChild(modeSwitch());
    if (p.intro) {
      sceneHead.appendChild(h('div', { class: 'uxd-scenehead__no', text: 'はじめに' }));
      sceneHead.appendChild(h('h2', { class: 'uxd-scenehead__title', text: D.title || '' }));
      return;
    }
    var sc = D.scenes[p.si];
    var present = sc.cast || sc.beats.reduce(function (a, b) { if (b.who && cast[b.who] && a.indexOf(b.who) < 0) a.push(b.who); return a; }, []);
    sceneHead.appendChild(h('div', { class: 'uxd-scenehead__no', text: p.end ? 'おわりに' : '場面 ' + (p.si + 1) + ' / ' + D.scenes.length }));
    sceneHead.appendChild(h('h2', { class: 'uxd-scenehead__title', text: sc.title || '' }));
    sceneHead.appendChild(h('div', { class: 'uxd-scenehead__meta' }, sceneMeta(sc),
      present.length ? h('span', { class: 'uxd-present', 'aria-label': 'この場面の人物：' + present.map(function (id) { return cast[id].name; }).join('、') }, present.map(function (id) { return avatar(cast[id]); })) : null));
  }

  function renderScenes() {
    var p = pos(cur);
    sceneList.textContent = '';
    D.scenes.forEach(function (sc, si) {
      var first = flat.findIndex(function (f) { return f.si === si; });
      var memo = memos.scenes[sc.id || String(si)];
      var btn = h('button', {
        type: 'button', title: '場面 ' + (si + 1) + '：' + (sc.title || '') + (si < 9 ? '（' + (si + 1) + ' キー）' : ''),
        class: (si < p.si || p.end ? 'is-done' : '') + (memo ? ' has-memo' : ''),
        'aria-current': !p.intro && !p.end && si === p.si ? 'step' : null,
        onclick: function () { stop(); go(first < 0 ? cur : first); }
      }, h('b', { text: String(si + 1) }), h('span', { text: sc.short || sc.title || '' }));
      sceneList.appendChild(h('li', null, btn));
    });
    var curBtn = sceneList.querySelector('[aria-current="step"]');
    if (curBtn) curBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderControls() {
    var p = pos(cur);
    btnPrev.disabled = cur <= -1;
    btnNext.textContent = '';
    if (p.end) { btnNext.append('最初から'); btnNext.appendChild(icon('arrow-left')); }
    else { btnNext.append(p.intro ? '始める' : '次へ'); var k = h('kbd', { class: 'ds-kbd', text: 'Space' }); btnNext.appendChild(k); }
    btnPlay.textContent = '';
    btnPlay.appendChild(icon(playing ? 'pause' : 'play'));
    btnPlay.append(playing ? '一時停止' : '自動再生');
    btnPlay.setAttribute('aria-pressed', String(playing));
    var n = flat.length;
    posText.textContent = p.intro ? 'はじめに' : p.end ? 'おわり' : (cur + 1) + ' / ' + n;
    progress.style.width = (p.intro ? 0 : p.end ? 100 : ((cur + 1) / n) * 100) + '%';
    var sc = D.scenes[p.si];
    var key = sc.id || String(p.si);
    memoLabel.textContent = p.intro ? 'デモ全体へのメモ' : 'この場面へのメモ（場面 ' + (p.si + 1) + '）';
    var memoKeyNow = p.intro ? '_intro' : key;
    memoBox.dataset.key = memoKeyNow;
    if (document.activeElement !== memoBox) memoBox.value = memos.scenes[memoKeyNow] || '';
    btnMemo.classList.toggle('has-memo', !!memos.scenes[memoKeyNow]);
  }

  function renderCounts() {
    tabHyp._count.textContent = String((D.hypotheses || []).length);
    var n = Object.keys(memos.scenes).filter(function (k) { return memos.scenes[k]; }).length + Object.keys(memos.hyps).filter(function (k) { return memos.hyps[k]; }).length;
    tabMemo._count.textContent = String(n);
  }

  function renderList(focusId) {
    listView.textContent = '';
    if (view === 'hyps') {
      (D.hypotheses || []).forEach(function (x) {
        var scenes = [];
        D.scenes.forEach(function (sc, si) { sc.beats.forEach(function (b, bi) { if (b.type === 'hypothesis' && b.ref === x.id) scenes.push({ si: si, bi: bi }); }); });
        var ta = h('textarea', { class: 'ds-textarea', id: 'uxd-h-' + x.id, placeholder: 'この仮説への反応、別の説明、反証になりそうな場面', oninput: function () { setMemo('hyps', x.id, ta.value); } });
        ta.value = memos.hyps[x.id] || '';
        var card = h('article', { class: 'uxd-hcard', id: 'uxd-hcard-' + x.id },
          h('div', { class: 'uxd-hcard__head' }, h('span', { class: 'uxd-hid', text: x.id }), labelChip(x.label || '[推論]')),
          h('p', { text: x.text }),
          h('dl', null,
            x.falsify ? [h('dt', { text: '反証条件' }), h('dd', { text: x.falsify })] : null,
            x.check ? [h('dt', { text: '確かめ方' }), h('dd', { text: x.check })] : null,
            x.alt ? [h('dt', { text: '代替説明' }), h('dd', { text: x.alt })] : null),
          scenes.length ? h('div', { class: 'uxd-jumps' }, h('span', { class: 'uxd-field-label', text: '出てくる場面' }), scenes.map(function (s) {
            return h('button', { type: 'button', onclick: function () { var i = flatIndex(s.si, s.bi); setView('log'); stop(); go(i >= 0 ? i : flat.findIndex(function (f) { return f.si === s.si; })); } }, '場面 ' + (s.si + 1));
          })) : null,
          h('label', { class: 'uxd-field-label', for: 'uxd-h-' + x.id, text: 'メモ' }), ta);
        listView.appendChild(card);
      });
      if (focusId) { var c = document.getElementById('uxd-hcard-' + focusId); if (c) { c.scrollIntoView({ block: 'start' }); var t = c.querySelector('textarea'); if (t) t.focus({ preventScroll: true }); } }
    } else if (view === 'memos') {
      var items = [];
      if (memos.scenes._intro) items.push(['デモ全体', memos.scenes._intro]);
      D.scenes.forEach(function (sc, si) { var m = memos.scenes[sc.id || String(si)]; if (m) items.push(['場面 ' + (si + 1) + '　' + (sc.title || ''), m]); });
      (D.hypotheses || []).forEach(function (x) { if (memos.hyps[x.id]) items.push([x.id + '　' + x.text, memos.hyps[x.id]]); });
      listView.appendChild(h('div', { class: 'ds-alert' }, icon('help'), h('div', { class: 'ds-alert__content', text: 'メモはこのブラウザの中だけに残る。チームで共有するときは書き出したファイルを使い、設計の記録に反映する。チームの反応は実ユーザーの証拠ではないので、記録では [推論] として扱う。' })));
      if (!items.length) listView.appendChild(h('p', { class: 'uxd-empty-note', text: 'まだメモはない。会話の欄の下にある「メモ」か、仮説の一覧から書ける。' }));
      items.forEach(function (it) { listView.appendChild(h('div', { class: 'uxd-memo-item' }, h('b', { text: it[0] }), h('p', { text: it[1] }))); });
      listView.appendChild(h('div', { class: 'ds-btn-group' },
        h('button', { class: 'ds-btn ds-btn--primary', type: 'button', onclick: downloadMd }, icon('download'), 'Markdown で保存'),
        h('button', { class: 'ds-btn', type: 'button', onclick: copyMd }, icon('copy'), 'コピー'),
        items.length ? h('button', { class: 'ds-btn ds-btn--link', type: 'button', onclick: clearMemos }, 'すべて消す') : null));
    }
  }

  function setView(v, focusId) {
    view = v;
    [tabLog, tabHyp, tabMemo].forEach(function (t, i) { t.setAttribute('aria-selected', String(['log', 'hyps', 'memos'][i] === v)); });
    log.hidden = v !== 'log';
    sceneHead.hidden = v !== 'log';
    listView.hidden = v === 'log';
    if (v !== 'log') { stop(); renderList(focusId); if (!focusId) scroll.scrollTop = 0; }
    else scrollToCurrent();
    writeHash();
  }

  function scrollToCurrent(instant) {
    var el = log.querySelector('.is-current') || (pos(cur).end ? log.lastElementChild : null);
    if (!el) { scroll.scrollTo({ top: 0, behavior: 'auto' }); return; }
    var box = scroll.getBoundingClientRect(), r = el.getBoundingClientRect();
    var top = r.top - box.top + scroll.scrollTop;          // 欄の中での位置
    var bottom = top + r.height;
    // 今の手が欄から外れたときだけ動かす。動かすときは、今の手を欄の上から 3 割ほどの所に置き、この先の手も見えるようにする
    if (top >= scroll.scrollTop + 8 && bottom <= scroll.scrollTop + scroll.clientHeight - 24) return;
    var want = r.height > scroll.clientHeight * 0.6 ? top - 16 : top - scroll.clientHeight * 0.3;
    scroll.scrollTo({ top: Math.max(0, want), behavior: instant || reduce ? 'auto' : 'smooth' });
  }

  /* ---------- プロトタイプとのやり取り ---------- */
  function send(replay) {   // replay：同じ画面でも、強調の枠をもう一度点滅させる
    var e = effective(pos(cur));
    frameScreen.hidden = !e.screen;
    frameScreen.textContent = '';
    if (e.screen) { frameScreen.append('画面：' + e.screen); }
    if (!iframe.contentWindow) return;
    applyId += 1;
    iframe.contentWindow.postMessage({ source: 'ux-demo-player', type: 'apply', id: applyId, state: e.state, highlight: e.highlight, highlightLabel: e.highlightLabel, spot: e.spot, replay: !!replay }, '*');
  }
  function warn(text) {
    frameWarn.hidden = !text;
    frameWarn.textContent = '';
    if (text) { frameWarn.appendChild(icon('warning')); frameWarn.append(text); }
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'ux-demo-proto' || e.source !== iframe.contentWindow) return;
    if (d.type === 'ready') {
      protoReady = true;
      clearTimeout(readyTimer);
      warn(d.hasApply ? '' : 'プロトタイプに window.uxDemoApply がない（画面を切り替えられない）');
      iframe.contentWindow.postMessage({ source: 'ux-demo-player', type: 'theme', theme: document.documentElement.dataset.theme || 'auto' }, '*');
      send();
    } else if (d.type === 'applied' && d.id === applyId) {
      if (!d.ok) warn('状態を当てられない：' + (d.error || ''));
      else if (d.highlight && d.found === false) warn('強調する対象が画面にない：' + d.highlight);
      else warn('');
    }
  });
  iframe.addEventListener('load', function () {
    protoReady = false;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(function () { if (!protoReady) warn('プロトタイプから応答がない（demo-bridge.js を読み込んでいるか確かめる）'); }, 2500);
  });
  document.addEventListener('ds-themechange', function (e) {
    if (iframe.contentWindow) iframe.contentWindow.postMessage({ source: 'ux-demo-player', type: 'theme', theme: (e.detail && e.detail.theme) || 'auto' }, '*');
  });

  /* ---------- 移動 ---------- */
  var captionTimer = 0;
  function showCaption(sc) {
    clearTimeout(captionTimer);
    caption.querySelector('small').textContent = [sc.time, sc.place].filter(Boolean).join('　・　');
    caption.querySelector('strong').textContent = sc.title || '';
    caption.classList.add('is-shown');
    frame.classList.add('is-changing');
    requestAnimationFrame(function () { requestAnimationFrame(function () { frame.classList.remove('is-changing'); }); });
    captionTimer = setTimeout(function () { caption.classList.remove('is-shown'); }, reduce ? 1200 : 1900);
  }

  function go(i) {
    if (pos(cur).end && i > cur) i = -1;            // おわりの次は最初へ
    i = Math.max(-1, Math.min(flat.length, i));
    var forward = i === cur + 1;
    cur = i;
    var p = pos(cur);
    if (!p.intro && !p.end && p.si !== lastSi) showCaption(D.scenes[p.si]);
    lastSi = p.intro ? -2 : p.si;
    if (view !== 'log') setView('log');
    renderAll(forward);
    send();
    writeHash();
    if (playing) schedule();
  }

  function renderAll(animate) {
    renderScenes();
    renderSceneHead();
    renderLog(animate);
    renderControls();
    renderCounts();
    requestAnimationFrame(function () { scrollToCurrent(!animate); });
  }

  function applySettings(rerender) {
    Object.keys(choiceInputs).forEach(function (k) { choiceInputs[k].checked = settings[k] !== false; });
    app.classList.toggle('hide-say', !settings.say);
    app.classList.toggle('hide-think', !settings.think);
    app.classList.toggle('hide-notes', !settings.notes);
    app.classList.toggle('hide-labels', !settings.labels);
    if (!rerender) return;
    var p = pos(cur);
    buildFlat();
    if (!p.intro && !p.end) {
      var j = -1;
      for (var k = 0; k < flat.length; k++) { var f = flat[k]; if (f.si < p.si || (f.si === p.si && f.bi <= p.bi)) j = k; }
      cur = j;
    } else if (p.end) cur = flat.length;
    renderAll(false);
    send();
  }

  /* ---------- 自動再生 ---------- */
  function dwell() {
    var p = pos(cur);
    if (p.intro) return 1200;
    var b = D.scenes[p.si].beats[p.bi] || {};
    var len = String(b.text || '').length + (b.type === 'hypothesis' ? 40 : 0);
    var base = 1100 + len * 70 + (p.bi === 0 ? 1200 : 0);
    return Math.min(14000, base) / (settings.speed || 1);
  }
  function schedule() {
    clearTimeout(playTimer);
    if (!playing) return;
    if (pos(cur).end) { stop(); return; }
    playTimer = setTimeout(function () { go(cur + 1); }, dwell());
  }
  function togglePlay() { playing = !playing; if (playing && pos(cur).end) cur = -1; renderControls(); if (playing) { if (cur === -1) go(0); else schedule(); } else clearTimeout(playTimer); }
  function stop() { if (!playing) return; playing = false; clearTimeout(playTimer); renderControls(); }

  /* ---------- メモ ---------- */
  function setMemo(kind, key, value) {
    if (kind === 'scenes') key = memoBox.dataset.key || key;
    memos[kind][key] = value;
    save(memoKey, memos);
    renderCounts();
    if (kind === 'scenes') { btnMemo.classList.toggle('has-memo', !!value); renderScenes(); }
  }
  function toggleMemo(force) {
    var open = force != null ? force : memoPanel.hidden;
    memoPanel.hidden = !open;
    btnMemo.setAttribute('aria-expanded', String(open));
    if (open) { stop(); memoBox.focus(); }
  }
  function markdown() {
    var now = new Date();
    var stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
    var out = ['# 仮説デモのメモ：' + (D.title || ''), '', '- デモ：' + [D.id, refs].filter(Boolean).join('（') + (refs ? '）' : ''), '- ファイル：' + decodeURIComponent(location.pathname.split('/').pop()), '- 書き出した日時：' + stamp, '- 扱い：チームの反応であり、実ユーザーの証拠ではない。設計の記録には [推論] として反映する', ''];
    out.push('## 場面へのメモ', '');
    var any = false;
    if (memos.scenes._intro) { out.push('### デモ全体', '', memos.scenes._intro, ''); any = true; }
    D.scenes.forEach(function (sc, si) { var m = memos.scenes[sc.id || String(si)]; if (m) { out.push('### 場面 ' + (si + 1) + '　' + [sc.time, sc.title].filter(Boolean).join('　') + (sc.id ? '（' + sc.id + '）' : ''), '', m, ''); any = true; } });
    if (!any) out.push('（なし）', '');
    out.push('## 仮説へのメモ', '');
    any = false;
    (D.hypotheses || []).forEach(function (x) { if (memos.hyps[x.id]) { out.push('### ' + x.id + '　' + x.text, '', memos.hyps[x.id], ''); any = true; } });
    if (!any) out.push('（なし）', '');
    return out.join('\n');
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function downloadMd() {
    var blob = new Blob([markdown()], { type: 'text/markdown;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: '仮説メモ_' + (D.id || 'demo') + '_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.md' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function copyMd() {
    var text = markdown();
    var done = function () { if (window.ds && ds.toast) ds.toast({ title: 'コピーした', message: 'メモを Markdown でクリップボードに入れた', tone: 'success' }); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() { var t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (_) { /* 何もしない */ } t.remove(); }
  }
  function clearMemos() {
    if (!confirm('このデモのメモをすべて消す。書き出していないメモは戻せない。')) return;
    memos = { scenes: {}, hyps: {} };
    save(memoKey, memos);
    memoBox.value = '';
    renderAll(false);
    renderList();
  }

  /* ---------- URL ---------- */
  function writeHash() {
    var p = pos(cur);
    var s = p.intro ? 'intro' : p.end ? 'end' : 's=' + (p.si + 1) + '&b=' + (p.bi + 1);
    if (view !== 'log') s += '&tab=' + view;
    try { history.replaceState(null, '', '#' + s); } catch (_) { /* file:// で使えない場合 */ }
  }
  function readHash() {
    var q = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) q[a[0]] = a[1] == null ? true : decodeURIComponent(a[1]); });
    if (q.end) return { i: flat.length, tab: q.tab };
    if (q.s) {
      var si = Number(q.s) - 1, bi = q.b ? Number(q.b) - 1 : 0;
      var i = flatIndex(si, bi);
      if (i < 0) i = flat.findIndex(function (f) { return f.si === si; });
      return { i: i, tab: q.tab };
    }
    return { i: -1, tab: q.tab };
  }

  /* ---------- キー操作 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) { if (e.key === 'Escape') { t.blur(); } return; }
    var onControl = t.closest && t.closest('button, summary, a');
    if ((e.key === ' ' || e.key === 'Enter') && onControl) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); stop(); go(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); stop(); go(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); stop(); go(-1); }
    else if (e.key === 'End') { e.preventDefault(); stop(); go(flat.length); }
    else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMemo(true); }
    else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); setConversation(!(settings.say || settings.think)); }
    else if (/^[1-9]$/.test(e.key)) { var si = Number(e.key) - 1; var i = flat.findIndex(function (f) { return f.si === si; }); if (i >= 0) { stop(); go(i); } }
  });

  /* ---------- 開始 ---------- */
  paneWidth = setPane(paneWidth);
  applySettings(false);
  buildFlat();
  var start = readHash();
  cur = start.i;
  var sp = pos(cur);
  lastSi = sp.intro ? -2 : sp.si;
  renderAll(false);
  if (start.tab === 'hyps' || start.tab === 'memos') setView(start.tab);
  window.addEventListener('hashchange', function () {
    var t = readHash();
    if (t.i === cur && (t.tab || 'log') === view) return;
    stop(); go(t.i);
    if (t.tab === 'hyps' || t.tab === 'memos') setView(t.tab);
  });
})();
