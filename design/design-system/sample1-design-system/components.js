/*
 * 汎用デザインシステム — 部品の動き
 * 見た目だけでは足りない部品の、共通の動きをまとめたもの。
 * <script src="components.js" defer></script> で読み込む。各画面の固有の動き（保存・計算など）はここに入れない。
 *
 * 構成
 *   1. 動きの土台（window.ds）: 開閉・削除・並べ替え・トーストなど、前後の形を測って動かす関数。画面の固有の処理からも呼べる。
 *   2. 部品の共通の動き: 見た目と明るさの切り替え、タブ、メニュー、パネルの開閉など（1 の関数で動かす）。
 *   3. 自動で付く動き: 選択の印が滑る、モーダル・メニュー・展開の開閉、表の並べ替え、数値の数え上げなど。
 * 動きを減らす設定（prefers-reduced-motion）では、長さが 0 になり、すぐに結果の形になる。
 */

/* ========== 1. 動きの土台（window.ds） ========== */
window.ds = (() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const token = name => getComputedStyle(root).getPropertyValue(name).trim();
  /** トークンの長さ（ミリ秒）。動きを減らす設定なら 0 */
  const ms = name => {
    if (reduce.matches) return 0;
    const v = token(name);
    if (!v) return 0;
    return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
  };
  const ease = name => token(name) || 'ease';

  /** Web Animations で動かす。同じ要素の前の動きは止めてから始める。finished は「最後まで動いたか」で解決する */
  const running = new WeakMap();
  const play = (el, keyframes, options) => {
    running.get(el)?.cancel();
    let a;
    options = { fill: 'backwards', ...options }; // 動き出す前のコマから、始まりの形を当てる（一瞬だけ最後の形が見えるのを防ぐ）
    try { a = el.animate(keyframes, options); }
    catch (_) { a = el.animate(keyframes, { ...options, easing: 'ease-out' }); } // linear() を受け付けない古いブラウザ
    running.set(el, a);
    return { animation: a, done: a.finished.then(() => true, () => false) };
  };

  /** 画面全体の切り替えを、なめらかに入れ替える（View Transitions が無い・動きを減らす設定なら、そのまま切り替える） */
  const transition = fn => {
    if (reduce.matches || !document.startViewTransition) { fn(); return Promise.resolve(); }
    return document.startViewTransition(fn).finished.catch(() => {});
  };

  /* ----- 開閉（details: メニュー・ポップオーバーは浮かんで現れ、展開・ファイルの一覧は高さが伸び縮みする） ----- */
  const detailsBody = d => d.querySelector(':scope > :not(summary)');
  const isDisclosure = d => d.matches('.ds-expandable, .ds-filetree details');
  const popFrom = d => `translateY(${d.classList.contains('ds-menu--up') ? 4 : -4}px) scale(0.97)`;
  const openDetails = d => {
    if (d.open && !d.classList.contains('is-closing')) return;
    d.classList.remove('is-closing');
    d.open = true;
    const body = detailsBody(d);
    if (!body) return;
    if (isDisclosure(d)) {
      const cs = getComputedStyle(body);
      const h = body.getBoundingClientRect().height;
      body.classList.add('is-motion-clip');
      play(body, [
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
        { height: h + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 },
      ], { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-standard') })
        .done.then(() => body.classList.remove('is-motion-clip'));
    } else {
      play(body, [{ opacity: 0, transform: popFrom(d) }, { opacity: 1, transform: 'none' }],
        { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-enter') });
    }
  };
  const closeDetails = d => {
    if (!d.open || d.classList.contains('is-closing')) return;
    const body = detailsBody(d);
    if (!body || reduce.matches) { d.open = false; return; }
    d.classList.add('is-closing');
    let run;
    if (isDisclosure(d)) {
      const cs = getComputedStyle(body);
      const h = body.getBoundingClientRect().height;
      body.classList.add('is-motion-clip');
      run = play(body, [
        { height: h + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      ], { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-standard'), fill: 'forwards' });
    } else {
      run = play(body, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: popFrom(d) }],
        { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' });
    }
    run.done.then(finished => {
      if (finished && d.classList.contains('is-closing')) {
        d.open = false;
        d.classList.remove('is-closing');
        run.animation.cancel();
      }
      body.classList.remove('is-motion-clip');
    });
  };

  /* ----- パネル（hidden の付け外し）: 下のパネルは高さ、横のパネルは幅が伸び縮みする。中身の形は保つ ----- */
  const panelAxis = el => el.matches('.ds-workbench__bottom') ? 'height'
    : el.matches('.ds-workbench__panel, .ds-help-panel, .ds-sidenav, .ds-workbench__sidebar') ? 'width' : null;
  const holdChildren = (el, axis) => {
    const kids = [...el.children];
    const sizes = kids.map(k => k.getBoundingClientRect()[axis]);
    kids.forEach((k, i) => {
      k.style.setProperty(axis === 'width' ? 'min-width' : 'min-height', sizes[i] + 'px');
      k.style.flexShrink = '0';
    });
    return () => kids.forEach(k => { k.style.removeProperty(axis === 'width' ? 'min-width' : 'min-height'); k.style.flexShrink = ''; });
  };
  const showPanel = el => {
    if (!el.hidden && !el.classList.contains('is-hiding')) return Promise.resolve();
    el.classList.remove('is-hiding');
    el.hidden = false;
    const axis = panelAxis(el);
    if (!axis) return play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: ms('--ds-motion-duration-base'), easing: 'linear' }).done;
    const size = el.getBoundingClientRect()[axis];
    const release = holdChildren(el, axis);
    el.classList.add('is-motion-clip');
    return play(el, [{ [axis]: '0px', opacity: 0 }, { [axis]: size + 'px', opacity: 1 }],
      { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-standard') })
      .done.then(() => { release(); el.classList.remove('is-motion-clip'); });
  };
  const hidePanel = el => {
    if (el.hidden || el.classList.contains('is-hiding')) return Promise.resolve();
    if (reduce.matches) { el.hidden = true; return Promise.resolve(); }
    el.classList.add('is-hiding');
    const axis = panelAxis(el);
    const size = axis ? el.getBoundingClientRect()[axis] : 0;
    const release = axis ? holdChildren(el, axis) : () => {};
    el.classList.add('is-motion-clip');
    const frames = axis ? [{ [axis]: size + 'px', opacity: 1 }, { [axis]: '0px', opacity: 0 }] : [{ opacity: 1 }, { opacity: 0 }];
    const run = play(el, frames, { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-standard'), fill: 'forwards' });
    return run.done.then(finished => {
      if (finished && el.classList.contains('is-hiding')) {
        el.hidden = true;
        el.classList.remove('is-hiding');
        run.animation.cancel();
      }
      release();
      el.classList.remove('is-motion-clip');
    });
  };

  /* ----- 削除: 縮んで消え、後ろの項目が詰まる（間の余白ごと縮める） ----- */
  const remove = el => {
    if (!el || !el.isConnected || el.dataset.dsRemoving) return Promise.resolve();
    el.dataset.dsRemoving = '1';
    if (reduce.matches) { el.remove(); return Promise.resolve(); }
    const parent = el.parentElement;
    const pcs = getComputedStyle(parent);
    const cs = getComputedStyle(el);
    const row = /flex/.test(pcs.display) && !pcs.flexDirection.startsWith('column');
    const gap = parseFloat(row ? pcs.columnGap : pcs.rowGap) || 0;
    const last = !el.nextElementSibling;
    const r = el.getBoundingClientRect();
    el.classList.add('is-motion-clip');
    const frames = row
      ? [
        { width: r.width + 'px', paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, marginLeft: cs.marginLeft, marginRight: cs.marginRight, opacity: 1, scale: 1 },
        { width: '0px', paddingLeft: '0px', paddingRight: '0px', marginLeft: last ? -gap + 'px' : '0px', marginRight: last ? '0px' : -gap + 'px', opacity: 0, scale: 0.9 },
      ]
      : [
        { height: r.height + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1, scale: 1 },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: last ? -gap + 'px' : '0px', marginBottom: last ? '0px' : -gap + 'px', opacity: 0, scale: 0.98 },
      ];
    return play(el, frames, { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-standard'), fill: 'forwards' })
      .done.then(() => el.remove());
  };

  /* ----- 現れる: 浮かび上がる ----- */
  const enter = el => play(el, [{ opacity: 0, translate: `0 ${token('--ds-motion-rise') || '8px'}` }, { opacity: 1, translate: '0 0' }],
    { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-enter') }).done;

  /* ----- 並べ替え（FLIP）: mutate で並びを変えると、各要素が前の位置から新しい位置へ滑る ----- */
  const flip = (els, mutate) => {
    const list = [...els];
    const first = new Map(list.map(e => [e, e.getBoundingClientRect()]));
    mutate();
    if (reduce.matches) return;
    list.forEach(e => {
      if (!e.isConnected) return;
      const a = first.get(e);
      const b = e.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      play(e, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-spring') });
    });
  };

  /* ----- 数え上げ: 要素の最初の数字を 0 から数え上げる（後ろの単位や子の要素はそのまま） ----- */
  const countUp = el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && !/\d/.test(node.nodeValue)) { /* 数字のある文字を探す */ }
    if (!node) return;
    const m = node.nodeValue.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/s);
    if (!m) return;
    const [, before, num, after] = m;
    const target = parseFloat(num);
    const digits = (num.split('.')[1] || '').length;
    const duration = ms('--ds-motion-duration-slower') * 1.6;
    if (!duration || !target) return;
    const start = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - start) / duration);
      const v = target * (1 - Math.pow(1 - t, 3));
      node.nodeValue = before + v.toFixed(digits) + after;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* ----- トースト ----- */
  let region;
  const ICON = { info: 'info', success: 'success', warning: 'warning', error: 'error' };
  const toast = ({ title = '', message = '', tone = 'info', duration = 4000 } = {}) => {
    if (!region || !region.isConnected) {
      region = document.createElement('div');
      region.className = 'ds-toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const t = document.createElement('div');
    t.className = `ds-toast ds-toast--${ICON[tone] ? tone : 'info'}`;
    t.innerHTML = `<svg class="ds-icon" aria-hidden="true"><use href="#ds-i-${ICON[tone] || 'info'}"/></svg>`
      + '<div class="ds-toast__content"><div class="ds-toast__title"></div><div class="ds-toast__message"></div></div>'
      + '<button class="ds-btn ds-btn--icon" type="button" aria-label="通知を閉じる" data-dismiss=".ds-toast"><svg class="ds-icon"><use href="#ds-i-close"/></svg></button>';
    t.querySelector('.ds-toast__title').textContent = title;
    const msg = t.querySelector('.ds-toast__message');
    if (message) msg.textContent = message; else msg.remove();
    if (duration > 0) {
      const timer = document.createElement('span');
      timer.className = 'ds-toast__timer';
      t.style.setProperty('--ds-toast-duration', duration + 'ms');
      timer.addEventListener('animationend', () => remove(t));
      t.appendChild(timer);
    }
    flip(region.children, () => region.appendChild(t));
    play(t, [{ opacity: 0, transform: 'translateY(12px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-spring') });
    return { element: t, close: () => remove(t) };
  };

  return { ms, ease, play, transition, openDetails, closeDetails, showPanel, hidePanel, remove, enter, flip, countUp, toast, reduced: () => reduce.matches };
})();

/* ========== 2. 部品の共通の動き（開閉・削除は 1 の関数で動かす） ========== */
(() => {
  // 見た目（ミニマル・コンソール）: data-look-choice="minimal|console" の項目で選ぶ。選んだものは localStorage に残す。
  // 何も付いていない <html> はミニマル。描画の前に当てる処理は、各ページの <head> に書く（README の「見た目の切り替え」）。
  const LOOK_KEY = 'ds-look';
  const currentLook = () => document.documentElement.dataset.look || 'minimal';
  const markLook = () => document.querySelectorAll('[data-look-choice]').forEach(x =>
    x.setAttribute('aria-checked', String(x.dataset.lookChoice === currentLook())));
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-look-choice]');
    if (!c) return;
    const l = c.dataset.lookChoice;
    const menu = c.closest('details');
    if (menu) ds.closeDetails(menu);
    ds.transition(() => {
      if (l === 'minimal') delete document.documentElement.dataset.look;
      else document.documentElement.dataset.look = l;
      try { localStorage.setItem(LOOK_KEY, l); } catch (_) { /* 保存できない環境では、その場だけ切り替える */ }
      markLook();
      document.dispatchEvent(new CustomEvent('ds-lookchange', { detail: { look: l } }));
    });
  });
  markLook();

  // 画面の明るさ: data-theme-choice="auto|light|dark" の項目で選ぶ。選んだものは localStorage に残す。
  // 描画の前に当てる処理（ちらつき防止）は、各ページの <head> に書く（README の「暗い画面」）。
  const THEME_KEY = 'ds-theme';
  const currentTheme = () => document.documentElement.dataset.theme || 'auto';
  const markTheme = () => document.querySelectorAll('[data-theme-choice]').forEach(x =>
    x.setAttribute('aria-checked', String(x.dataset.themeChoice === currentTheme())));
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-theme-choice]');
    if (!c) return;
    const t = c.dataset.themeChoice;
    const menu = c.closest('details');
    if (menu) ds.closeDetails(menu);
    ds.transition(() => {
      if (t === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = t;
      try { t === 'auto' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch (_) { /* 保存できない環境では、その場だけ切り替える */ }
      markTheme();
      document.dispatchEvent(new CustomEvent('ds-themechange', { detail: { theme: t } }));
    });
  });
  markTheme();
  // パソコンの設定が変わったときも知らせる（自動のときだけ見た目が変わる）
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () =>
    document.dispatchEvent(new CustomEvent('ds-themechange', { detail: { theme: currentTheme() } })));

  // 切り替えボタン（.ds-segmented）: 押したものだけ aria-pressed="true"
  document.addEventListener('click', e => {
    const b = e.target.closest('.ds-segmented > button');
    if (!b) return;
    b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });

  // タブ（.ds-tabs / .ds-code-tabs / .ds-panel-tab）: 押したものだけ aria-selected="true"
  document.addEventListener('click', e => {
    if (e.target.closest('.ds-code-tab__close')) return;
    const t = e.target.closest('.ds-tabs__tab, .ds-code-tab, .ds-panel-tab');
    if (!t) return;
    t.parentElement.querySelectorAll('.ds-tabs__tab, .ds-code-tab, .ds-panel-tab').forEach(x => x.setAttribute('aria-selected', String(x === t)));
  });

  // コードのタブを閉じる: 閉じたのが選択中なら隣を選ぶ
  document.addEventListener('click', e => {
    const c = e.target.closest('.ds-code-tab__close');
    if (!c) return;
    e.stopPropagation();
    const tab = c.closest('.ds-code-tab');
    const next = tab.nextElementSibling || tab.previousElementSibling;
    if (tab.getAttribute('aria-selected') === 'true' && next) next.setAttribute('aria-selected', 'true');
    ds.remove(tab);
  });

  // メニュー・ポップオーバー（details）: 外を押したら閉じる
  document.addEventListener('click', e => {
    document.querySelectorAll('details.ds-menu[open], details.ds-popover[open]').forEach(d => {
      if (!d.contains(e.target)) ds.closeDetails(d);
    });
  });

  // ファイルの一覧: 押したファイルを選択中にする
  document.addEventListener('click', e => {
    const f = e.target.closest('.ds-filetree a.ds-filetree__item');
    if (!f) return;
    e.preventDefault();
    f.closest('.ds-filetree').querySelectorAll('a.ds-filetree__item').forEach(x => x.removeAttribute('aria-current'));
    f.setAttribute('aria-current', 'true');
  });

  // 分割画面（.ds-split）: 境目をドラッグ、または ← → キーで幅を変える
  const MIN = 160;
  const clamp = (split, w) => Math.max(MIN, Math.min(w, split.clientWidth * 0.6));
  const setWidth = (split, handle, w) => {
    const v = Math.round(clamp(split, w));
    split.style.setProperty('--ds-split', v + 'px');
    handle.setAttribute('aria-valuenow', String(v));
  };
  document.querySelectorAll('.ds-split').forEach(split => {
    const handle = split.querySelector(':scope > .ds-split__handle');
    if (!handle) return;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('tabindex', '0');
    if (!handle.hasAttribute('aria-label')) handle.setAttribute('aria-label', '左右の幅を変える');
    handle.addEventListener('pointerdown', e => {
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-dragging');
      const left = split.getBoundingClientRect().left;
      const move = ev => setWidth(split, handle, ev.clientX - left);
      const up = () => {
        handle.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', e => {
      const step = e.shiftKey ? 64 : 16;
      const now = split.firstElementChild.getBoundingClientRect().width;
      if (e.key === 'ArrowLeft') { setWidth(split, handle, now - step); e.preventDefault(); }
      if (e.key === 'ArrowRight') { setWidth(split, handle, now + step); e.preventDefault(); }
    });
  });

  // パネルの開閉: data-toggle-panel / data-open-panel / data-close-panel に、パネルの id を書く。
  // 開閉のボタン（data-toggle-panel）は、パネルが開いているとき aria-pressed="true" になる。
  const syncPanel = (id, open) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    const shown = open ?? (!panel.hidden && !panel.classList.contains('is-hiding'));
    document.querySelectorAll(`[data-toggle-panel="${id}"]`).forEach(b => b.setAttribute('aria-pressed', String(shown)));
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-toggle-panel], [data-open-panel], [data-close-panel]');
    if (!b) return;
    const id = b.dataset.togglePanel || b.dataset.openPanel || b.dataset.closePanel;
    const panel = document.getElementById(id);
    if (!panel) return;
    const isOpen = !panel.hidden && !panel.classList.contains('is-hiding');
    const open = b.dataset.togglePanel ? !isOpen : !b.dataset.closePanel;
    if (open) ds.showPanel(panel); else ds.hidePanel(panel);
    syncPanel(id, open);
  });
  new Set([...document.querySelectorAll('[data-toggle-panel]')].map(b => b.dataset.togglePanel)).forEach(id => syncPanel(id));

  // 下のパネルの高さ: 上の端をドラッグ、または選んで ↑ ↓ キー
  document.querySelectorAll('.ds-workbench__bottom').forEach(panel => {
    const handle = panel.querySelector(':scope > .ds-workbench__bottom-handle');
    if (!handle) return;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('tabindex', '0');
    if (!handle.hasAttribute('aria-label')) handle.setAttribute('aria-label', '下のパネルの高さを変える');
    const setHeight = h => {
      const max = panel.parentElement.clientHeight * 0.75;
      const v = Math.round(Math.max(120, Math.min(h, max)));
      panel.style.setProperty('--ds-bottom-height', v + 'px');
      handle.setAttribute('aria-valuenow', String(v));
    };
    handle.addEventListener('pointerdown', e => {
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-dragging');
      const bottom = panel.getBoundingClientRect().bottom;
      const move = ev => setHeight(bottom - ev.clientY);
      const up = () => {
        handle.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    handle.addEventListener('keydown', e => {
      const step = e.shiftKey ? 64 : 16;
      const now = panel.getBoundingClientRect().height;
      if (e.key === 'ArrowUp') { setHeight(now + step); e.preventDefault(); }
      if (e.key === 'ArrowDown') { setHeight(now - step); e.preventDefault(); }
    });
  });
})();

/* ========== 3. 自動で付く動き ========== */
(() => {
  const { ms, ease, play, openDetails, closeDetails, remove, flip, countUp, enter } = window.ds;

  /* ----- 選択の印: 選んだ項目の見た目（面・枠・下線）を写した印を置き、選び直すと隣へ滑る ----- */
  const GROUPS = [
    ['.ds-tabs', '.ds-tabs__tab[aria-selected="true"]'],
    ['.ds-segmented', ':scope > button[aria-pressed="true"]'],
    ['.ds-panel-header', '.ds-panel-tab[aria-selected="true"]'],
    ['.ds-code-tabs', '.ds-code-tab[aria-selected="true"]'],
    ['.ds-pagination', 'button[aria-current="page"]'],
    ['.ds-stepper', ':scope > li[aria-current="step"]'],
  ];
  const COPY = ['backgroundColor', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'boxShadow'];
  const groups = [];
  const paint = (g, instant) => {
    const { el, ind, selector } = g;
    el.classList.remove('is-indicating');
    el.querySelectorAll('[data-ds-indicated]').forEach(x => x.removeAttribute('data-ds-indicated'));
    const sel = el.querySelector(selector);
    if (!sel || !sel.getClientRects().length) {
      ind.style.opacity = '0';
      el.classList.add('is-indicating');
      return;
    }
    // 選んだ項目の、本来の見た目を読む（印を出す前に読む）
    // 項目の色は「なめらかに変わる」途中かもしれないので、読む間だけ変化を止めて、行き先の色を読む
    const prevTransition = sel.style.transition;
    sel.style.transition = 'none';
    const cs = getComputedStyle(sel);
    const after = getComputedStyle(sel, '::after');
    const look = {};
    COPY.forEach(k => { look[k] = cs[k]; });
    const afterContent = after.content, afterBg = after.backgroundColor, afterHeight = after.height;
    sel.style.transition = prevTransition;
    if (afterContent && afterContent !== 'none' && afterBg !== 'rgba(0, 0, 0, 0)') {
      // 選んだ項目の上の線（::after）も写す
      const line = `inset 0 ${afterHeight} 0 ${afterBg}`;
      look.boxShadow = look.boxShadow && look.boxShadow !== 'none' ? `${line}, ${look.boxShadow}` : line;
    }
    const c = el.getBoundingClientRect();
    const r = sel.getBoundingClientRect();
    const x = r.left - c.left - el.clientLeft + el.scrollLeft;
    const y = r.top - c.top - el.clientTop + el.scrollTop;
    el.classList.add('is-indicating');
    sel.setAttribute('data-ds-indicated', '');
    ind.classList.toggle('is-instant', !!instant);
    Object.assign(ind.style, look, { width: r.width + 'px', height: r.height + 'px', transform: `translate(${x}px, ${y}px)`, opacity: '1' });
    if (instant) requestAnimationFrame(() => ind.classList.remove('is-instant'));
  };
  const queued = new Set();
  const schedule = (g, instant) => {
    if (queued.has(g)) return;
    queued.add(g);
    requestAnimationFrame(() => { queued.delete(g); paint(g, instant); });
  };
  const attach = el => {
    if (el.dataset.dsIndicator) return;
    const spec = GROUPS.find(([s]) => el.matches(s));
    if (!spec) return;
    el.dataset.dsIndicator = '1';
    const ind = document.createElement('span');
    ind.className = 'ds-motion-indicator';
    ind.setAttribute('aria-hidden', 'true');
    el.prepend(ind);
    const g = { el, ind, selector: spec[1] };
    groups.push(g);
    new MutationObserver(() => schedule(g)).observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'aria-current'] });
    new ResizeObserver(() => schedule(g, true)).observe(el);
    el.addEventListener('scroll', () => schedule(g, true), { passive: true });
    paint(g, true);
  };
  document.querySelectorAll(GROUPS.map(([s]) => s).join(',')).forEach(attach);
  const repaintAll = () => groups.forEach(g => schedule(g, true));
  ['ds-lookchange', 'ds-themechange'].forEach(t => document.addEventListener(t, () => { repaintAll(); setTimeout(repaintAll, ms('--ds-motion-duration-slow') + 50); }));
  document.fonts?.ready.then(repaintAll);

  /* ----- メニュー・ポップオーバー・展開・ファイルの一覧（details）: 開閉を動かす ----- */
  document.addEventListener('click', e => {
    const s = e.target.closest('summary');
    if (!s || e.defaultPrevented) return;
    const d = s.parentElement;
    if (!d.matches('details.ds-menu, details.ds-popover, details.ds-expandable, .ds-filetree details')) return;
    e.preventDefault();
    if (d.open && !d.classList.contains('is-closing')) closeDetails(d); else openDetails(d);
  });

  /* ----- モーダル（dialog.ds-modal）: 後ろを暗くしながら浮かび上がり、閉じるときは沈んで消える ----- */
  const modalIn = d => {
    play(d, [{ opacity: 0, transform: 'translateY(12px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-spring') });
    try { d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('--ds-motion-duration-base'), easing: 'linear', pseudoElement: '::backdrop' }); } catch (_) { /* ::backdrop を動かせないブラウザ */ }
  };
  const modalOut = (d, value) => {
    if (d.dataset.dsClosing) return;
    if (window.ds.reduced()) { d.close(value); return; }
    d.dataset.dsClosing = '1';
    try { d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms('--ds-motion-duration-fast'), easing: 'linear', fill: 'forwards', pseudoElement: '::backdrop' }); } catch (_) { /* 同上 */ }
    const run = play(d, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(0.98)' }],
      { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' });
    run.done.then(() => {
      delete d.dataset.dsClosing;
      d.close(value);
      d.getAnimations({ subtree: false }).forEach(a => a.cancel());
      try { d.getAnimations().forEach(a => a.cancel()); } catch (_) { /* 何もしない */ }
    });
  };
  new MutationObserver(list => list.forEach(m => {
    const d = m.target;
    if (d.matches?.('dialog.ds-modal') && d.open && m.oldValue === null) modalIn(d);
  })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });
  // Esc で閉じるとき
  document.addEventListener('cancel', e => {
    const d = e.target;
    if (!d.matches?.('dialog.ds-modal')) return;
    e.preventDefault();
    modalOut(d, '');
  }, true);
  // <form method="dialog"> のボタンで閉じるとき（押したボタンの value を returnValue にする）
  document.addEventListener('submit', e => {
    const f = e.target;
    if (f.method !== 'dialog') return;
    const d = f.closest('dialog.ds-modal');
    if (!d) return;
    e.preventDefault();
    modalOut(d, e.submitter?.value ?? '');
  }, true);

  /* ----- 閉じるボタン（data-dismiss）: 押したボタンを含む部品が縮んで消え、後ろが詰まる ----- */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-dismiss]');
    if (!b) return;
    const target = b.closest(b.dataset.dismiss || '.ds-flash, .ds-alert, .ds-chip, .ds-toast, .ds-hint');
    if (!target) return;
    e.preventDefault();
    remove(target);
  });

  /* ----- 並べ替えできる表: 列名を押すと、行を実際に並べ替え、各行が新しい位置へ滑る ----- */
  // aria-sort の付け替えは画面の側（または下の既定の処理）が行う。値の比べ方は、セルの data-sort-value があればそれを使う
  document.addEventListener('click', e => {
    const btn = e.target.closest('.ds-table th[aria-sort] button');
    if (!btn) return;
    const th = btn.closest('th');
    requestAnimationFrame(() => {
      const dir = th.getAttribute('aria-sort');
      if (dir !== 'ascending' && dir !== 'descending') return;
      const tbody = th.closest('table')?.tBodies[0];
      if (!tbody) return;
      const idx = th.cellIndex;
      const rows = [...tbody.rows];
      const key = r => r.cells[idx]?.dataset.sortValue ?? r.cells[idx]?.textContent.trim() ?? '';
      const sorted = [...rows].sort((a, b) => key(a).localeCompare(key(b), 'ja', { numeric: true }) * (dir === 'ascending' ? 1 : -1));
      if (sorted.every((r, i) => r === rows[i])) return;
      flip(rows, () => sorted.forEach(r => tbody.appendChild(r)));
    });
  });

  /* ----- 画面に入ったとき: 数値を数え上げ、棒・円・範囲を伸ばす（1 回だけ） ----- */
  const grow = (el, prop, from) => {
    const to = getComputedStyle(el)[prop];
    play(el, [{ [prop]: from }, { [prop]: to }], { duration: ms('--ds-motion-duration-slower'), easing: ease('--ds-motion-ease-standard') });
  };
  const reveal = el => {
    if (el.matches('.ds-value-large, .ds-meter__value')) countUp(el);
    if (el.matches('.ds-progress__bar, .ds-meter__fill')) grow(el, 'width', '0px');
    if (el.matches('.ds-meter__marker, .ds-version-range__marker')) grow(el, 'left', '0px');
    if (el.matches('.ds-version-range__affected')) play(el, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: ms('--ds-motion-duration-slower'), easing: ease('--ds-motion-ease-standard') });
    if (el.matches('.ds-score__ring')) {
      const target = parseFloat(el.style.getPropertyValue('--ds-value')) || 0;
      const value = el.querySelector('.ds-score__value');
      if (value) countUp(value);
      const duration = ms('--ds-motion-duration-slower') * 1.6;
      if (!duration) return;
      const start = performance.now();
      const tick = now => {
        const t = Math.min(1, (now - start) / duration);
        el.style.setProperty('--ds-value', (target * (1 - Math.pow(1 - t, 3))).toFixed(1));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  };
  if ('IntersectionObserver' in window && !window.ds.reduced()) {
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      reveal(en.target);
    }), { threshold: 0.25 });
    document.querySelectorAll('.ds-value-large, .ds-meter__value, .ds-progress__bar, .ds-meter__fill, .ds-meter__marker, .ds-version-range__marker, .ds-version-range__affected, .ds-score__ring').forEach(el => io.observe(el));
  }

  /* ----- あとから足された部品も浮かび上がる（ds.enter を画面の側からも呼べる） ----- */
  window.ds.enterAll = els => [...els].forEach(enter);
})();
