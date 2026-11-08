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

  function place() {
    if (!target || !target.isConnected) { hide(); return; }
    var r = target.getBoundingClientRect();
    ring.style.top = r.top + 'px';
    ring.style.left = r.left + 'px';
    ring.style.width = r.width + 'px';
    ring.style.height = r.height + 'px';
    if (tag.textContent) {
      var th = tag.offsetHeight || 24;
      var below = r.top - th - 12 < 4;
      tag.style.top = (below ? r.bottom + 12 : r.top - th - 12) + 'px';
      tag.style.left = Math.max(4, Math.min(r.left, window.innerWidth - tag.offsetWidth - 4)) + 'px';
    }
    raf = requestAnimationFrame(place);
  }

  function highlight(selector, label, spot, quiet) {
    if (!selector) { hide(); return null; }
    var el = null;
    try { el = document.querySelector(selector); } catch (_) { el = null; }
    if (!el) { hide(); return false; }
    ensureRing();
    cancelAnimationFrame(raf);
    target = el;
    var r = el.getBoundingClientRect();
    if (quiet) {
      // 前の手と同じ画面・同じ対象：見えていれば動かさない。見えていないときだけ、すぐに移す
      if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } else {
      // 画面の高さの 7 割を超える要素は、中央に合わせると上端（見出しや説明）が隠れるので、上端に合わせる
      var tall = r.height > window.innerHeight * 0.7;
      el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
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
