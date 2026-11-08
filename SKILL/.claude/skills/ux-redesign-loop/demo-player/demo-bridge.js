/*
 * demo-bridge.js — プロトタイプの側に読み込む、デモとの連絡役
 *
 * デモの画面（player.js）は、プロトタイプを iframe に入れて表示する。file:// で開くと、
 * デモの画面からプロトタイプの中身（DOM）を直接触れないため、postMessage で次をやり取りする。
 *
 *   デモ → プロトタイプ  { source:'ux-demo-player', type:'apply', id, state, highlight, highlightLabel, spot, replay }
 *                        { source:'ux-demo-player', type:'theme', theme:'auto'|'light'|'dark' }
 *   プロトタイプ → デモ  { source:'ux-demo-proto', type:'ready', title, hasApply }
 *                        { source:'ux-demo-proto', type:'applied', id, ok, error, highlight, found }
 *
 * プロトタイプの側ですること
 *   1. window.uxDemoApply = function (state) { … } を定義する。state はデモの台本に書いた値で、
 *      プロトタイプの状態オブジェクトに当てて描画し直す。何度呼ばれても同じ結果になるように書く
 *      （デモでは前の場面へ戻ることがあり、そのたびに全体の状態が送られてくるため）。
 *   2. このファイルを読み込む。<script src="../demo/player/demo-bridge.js" defer></script>
 *   3. 検証用パネルは html[data-ux-demo] のときに隠す。デモの中では製品の画面だけを見せるため。
 *
 * iframe の中で開かれていないとき（プロトタイプを単独で開いたとき）は何もしない。
 *
 * 状態が前の手と同じとき（会話だけが進み、画面は変わらない手）も uxDemoApply は呼んで描き直すが、
 * 描き直しで新しく始まった動きは最後の形まで進め、強調の枠も点滅させない。画面が変わらないのに
 * 次へを押すたびに画面が動き直すと、見る人の目が会話から画面へ引っ張られるため。
 */
(function () {
  'use strict';
  if (window.parent === window) return;

  var root = document.documentElement;
  root.setAttribute('data-ux-demo', '');

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ring = null, tag = null, target = null, raf = 0;

  function post(msg) {
    msg.source = 'ux-demo-proto';
    try { window.parent.postMessage(msg, '*'); } catch (_) { /* 親が閉じている */ }
  }

  function ensureRing() {
    if (ring) return;
    var style = document.createElement('style');
    style.textContent = [
      '.uxdemo-ring{position:fixed;z-index:2147483646;pointer-events:none;border-radius:10px;',
      'outline:3px solid var(--ds-color-coach-ring,#60a5fa);outline-offset:3px;',
      'transition:top .28s cubic-bezier(.2,.8,.2,1),left .28s cubic-bezier(.2,.8,.2,1),width .28s cubic-bezier(.2,.8,.2,1),height .28s cubic-bezier(.2,.8,.2,1),opacity .2s;}',
      '.uxdemo-ring[data-spot]{box-shadow:0 0 0 100vmax var(--ds-color-coach-dim,rgba(9,9,11,.45));}',
      '.uxdemo-ring::after{content:"";position:absolute;inset:-3px;border-radius:12px;border:3px solid var(--ds-color-coach-ring,#60a5fa);opacity:0;}',
      '.uxdemo-ring[data-pulse]::after{animation:uxdemo-pulse 1.1s ease-out 2;}',
      '@keyframes uxdemo-pulse{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(1.08)}}',
      '.uxdemo-tag{position:fixed;z-index:2147483647;pointer-events:none;max-width:320px;padding:4px 10px;border-radius:8px;',
      'background:var(--ds-color-coach-bg,#18181b);color:#fff;font:600 12px/1.5 system-ui,"Noto Sans JP",sans-serif;',
      'box-shadow:0 4px 14px rgba(0,0,0,.25);transition:top .28s,left .28s,opacity .2s;}',
      '@media (prefers-reduced-motion: reduce){.uxdemo-ring,.uxdemo-tag{transition:none}.uxdemo-ring[data-pulse]::after{animation:none}}'
    ].join('');
    document.head.appendChild(style);
    ring = document.createElement('div');
    ring.className = 'uxdemo-ring';
    ring.setAttribute('aria-hidden', 'true');
    tag = document.createElement('div');
    tag.className = 'uxdemo-tag';
    tag.setAttribute('aria-hidden', 'true');
    hide();
    document.body.appendChild(ring);
    document.body.appendChild(tag);
  }

  function hide() {
    target = null;
    if (ring) { ring.style.opacity = '0'; ring.removeAttribute('data-spot'); }
    if (tag) tag.style.opacity = '0';
    cancelAnimationFrame(raf);
  }

  /* 枠はページの一番上の層に描くので、そのままでは、対象を切り取っている枠（スマートフォンの端末の画面、スクロールする欄）の
     外にも出てしまう。対象の祖先のうち、はみ出しを隠すものをたどり、その範囲と重なる部分だけを見せる */
  var clipFor = null, clippers = [];
  function clipAncestors(el) {
    var list = [], n = el.parentElement;
    while (n && n !== document.documentElement) {
      var cs = getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') list.push(n);
      n = n.parentElement;
    }
    return list;
  }
  function visibleBox() {
    var b = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    clippers.forEach(function (c) {
      var r = c.getBoundingClientRect();
      b.top = Math.max(b.top, r.top); b.left = Math.max(b.left, r.left);
      b.right = Math.min(b.right, r.right); b.bottom = Math.min(b.bottom, r.bottom);
    });
    return b;
  }

  function place() {
    if (!target || !target.isConnected) { hide(); return; }
    if (clipFor !== target) { clippers = clipAncestors(target); clipFor = target; }
    var r = target.getBoundingClientRect();
    var c = visibleBox();
    var v = { top: Math.max(r.top, c.top), left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom) };
    var shown = v.right - v.left > 2 && v.bottom - v.top > 2;   // 対象が少しでも見えているか
    ring.style.top = r.top + 'px';
    ring.style.left = r.left + 'px';
    ring.style.width = r.width + 'px';
    ring.style.height = r.height + 'px';
    ring.style.visibility = shown ? 'visible' : 'hidden';
    // 見えている部分だけを残す。切り取られていない辺は、枠の線（外側に約 8px）が見えるよう、少し外まで残す
    ring.style.clipPath = ring.hasAttribute('data-spot') ? 'none' : 'inset(' + [
      v.top > r.top ? v.top - r.top : -10,
      r.right > v.right ? r.right - v.right : -10,
      r.bottom > v.bottom ? r.bottom - v.bottom : -10,
      v.left > r.left ? v.left - r.left : -10
    ].map(function (x) { return x + 'px'; }).join(' ') + ')';
    if (tag.textContent) {
      tag.style.visibility = shown ? 'visible' : 'hidden';
      // 説明の札も、見えている範囲の中に置く（上に置けなければ下、どちらも無理なら見えている部分の内側の上）
      var th = tag.offsetHeight || 24, tw = tag.offsetWidth || 120;
      var top = v.top - th - 12 >= c.top ? v.top - th - 12 : v.bottom + 12 + th <= c.bottom ? v.bottom + 12 : v.top + 6;
      tag.style.top = top + 'px';
      tag.style.left = Math.max(c.left + 4, Math.min(v.left, c.right - tw - 4)) + 'px';
    }
    raf = requestAnimationFrame(place);
  }

  /* 対象が見えるようにスクロールする。scrollIntoView は使わない。scrollIntoView は、はみ出しを隠しているだけの枠
     （overflow: hidden。スマートフォンの端末の画面など）までスクロールし、枠の中身をずらしてしまう。端末の画面がずれると、
     画面の下に隠してあるキーボードの部品が見えてしまう。ここでは、縦や横に送れる欄（overflow: auto / scroll）とページだけを動かす。
     mode：'center' は欄の中央へ（欄の高さの 7 割を超える要素は上端へ。中央に合わせると見出しが隠れるため）、
           'ifneeded' は欄から外れているときだけ中央へ */
  function reveal(el, mode, smooth) {
    var shift = 0;   // 内側の欄を動かした分、外側から見た要素の位置がずれる
    var node = el.parentElement;
    var boxes = [];
    while (node && node !== document.body && node !== document.documentElement) {
      var cs = getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) boxes.push(node);
      node = node.parentElement;
    }
    var se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 1) boxes.push(null);   // null はページ
    boxes.forEach(function (box) {
      var r = el.getBoundingClientRect();
      var top = r.top - shift, bottom = r.bottom - shift;
      var bt = box ? box.getBoundingClientRect().top : 0;
      var bh = box ? box.clientHeight : window.innerHeight;
      var visible = top >= bt && bottom <= bt + bh;
      if (mode === 'ifneeded' && visible) return;
      var dy = r.height > bh * 0.7 ? top - bt - 12 : (top + r.height / 2) - (bt + bh / 2);
      var cur = box ? box.scrollTop : se.scrollTop;
      var max = (box ? box.scrollHeight : se.scrollHeight) - bh;
      var next = Math.max(0, Math.min(max, cur + dy));
      if (Math.abs(next - cur) < 1) return;
      (box || window).scrollTo({ top: next, behavior: smooth ? 'smooth' : 'auto' });
      shift += next - cur;
    });
  }

  function highlight(selector, label, spot, quiet) {
    if (!selector) { hide(); return null; }
    var el = null;
    try { el = document.querySelector(selector); } catch (_) { el = null; }
    if (!el) { hide(); return false; }
    ensureRing();
    cancelAnimationFrame(raf);
    target = el;
    // 前の手と同じ画面・同じ対象（quiet）なら、見えていれば動かさず、見えていないときだけすぐに移す
    reveal(el, quiet ? 'ifneeded' : 'center', !quiet && !reduce);
    tag.textContent = label || '';
    tag.style.opacity = label ? '1' : '0';
    ring.style.opacity = '1';
    if (spot) ring.setAttribute('data-spot', ''); else ring.removeAttribute('data-spot');
    if (!quiet) {
      ring.removeAttribute('data-pulse');
      void ring.offsetWidth;
      ring.setAttribute('data-pulse', '');
    }
    place();
    return true;
  }

  /* 前の手と同じ状態かを比べるための文字列。キーの順番に左右されないよう、並べ替えて作る */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  /* 描き直しで新しく始まった動き（現れるときの浮かび上がり、数え上げ、選択の印の移動など）を、
     最後の形にすぐ進める。終わりのない動き（読み込み中の回転）は残す */
  function settle(before) {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(function (a) {
      if (before.has(a)) return;
      try {
        var t = a.effect && a.effect.getComputedTiming();
        if (!t || t.endTime === Infinity) return;
        a.finish();
      } catch (_) { /* 進められない動きは、そのままにする */ }
    });
  }

  var lastState = null, lastHighlight = null;

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'ux-demo-player') return;
    if (d.type === 'theme') {
      if (d.theme === 'light' || d.theme === 'dark') root.dataset.theme = d.theme; else delete root.dataset.theme;
      return;
    }
    if (d.type !== 'apply') return;
    // 状態が前の手と同じなら、描き直しはするが、動きは付けない（次へを押すたびに同じ画面が動き直すのを防ぐ）
    var stateKey = stable(d.state || {});
    var hlKey = stable([d.highlight || null, d.highlightLabel || '', !!d.spot]);
    var still = stateKey === lastState;
    var quiet = still && hlKey === lastHighlight && !d.replay;
    lastState = stateKey;
    lastHighlight = hlKey;
    var before = still && document.getAnimations ? new Set(document.getAnimations()) : null;
    // 描き直しで囲んでいた要素が入れ替わると、枠の追従が「対象が消えた」と見て枠を隠し、すぐ出し直す（ちらつく）。
    // 対象を探し直すまで追従を止め、枠は今の位置に置いたままにする
    cancelAnimationFrame(raf);
    target = null;
    var ok = true, error = null;
    try {
      if (typeof window.uxDemoApply === 'function') window.uxDemoApply(d.state || {});
      else if (d.state && d.state.hash) location.hash = d.state.hash;
      else { ok = false; error = 'window.uxDemoApply が定義されていない'; }
    } catch (ex) { ok = false; error = String(ex && ex.message || ex); }
    if (before) settle(before);
    // 描画が終わってから対象を探す（描画し直しで要素が入れ替わるため、2 コマ待つ）
    requestAnimationFrame(function () {
      if (before) settle(before);   // 描き直しのあとで始まる動き（選択の印など）も止める
      requestAnimationFrame(function () {
        if (before) settle(before);
        var found = highlight(d.highlight, d.highlightLabel, d.spot, quiet);
        post({ type: 'applied', id: d.id, ok: ok, error: error, highlight: d.highlight || null, found: found });
      });
    });
  });

  function ready() { post({ type: 'ready', title: document.title, hasApply: typeof window.uxDemoApply === 'function' }); }
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
})();
