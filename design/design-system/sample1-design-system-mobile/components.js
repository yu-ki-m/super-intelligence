/*
 * 汎用デザインシステム（スマートフォン版）— 部品の動き
 * <script src="components.js" defer></script> で読み込む。各画面の固有の動き（保存・計算など）はここに入れない。
 *
 * 構成
 *   1. 動きの土台（window.ds）: 前後の形を測って動かす関数と、重なる部品・画面の移動・お知らせの関数。画面の側からも呼べる。
 *   2. 部品の共通の動き: 見た目と明るさの切り替え、下のタブ、上のタブ、札、メニュー、数の増減など。
 *   3. 指の動き: シートを引いて閉じる、行を払う（スワイプ）、引いて更新、送りに合わせたアプリバーの変化。
 *
 * 重なる部品（シート・ダイアログ・スナックバー）は .ds-app の中に置き、position: absolute で表示する。
 * <dialog> の最前面を使わないのは、ブラウザで端末の枠（device.css）の中に表示するとき、枠の外まで覆ってしまうため。
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

  /** Web Animations で動かす。同じ要素の前の動きは止めてから始める。done は「最後まで動いたか」で解決する */
  const running = new WeakMap();
  const play = (el, keyframes, options) => {
    running.get(el)?.cancel();
    let a;
    options = { fill: 'backwards', ...options };
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

  /** 表示の倍率（端末の枠を縮めて表示しているとき 1 より小さい）。指の移動量を部品の大きさに直すのに使う */
  const scaleOf = el => (el.offsetHeight ? el.getBoundingClientRect().height / el.offsetHeight : 1) || 1;
  const appOf = el => el?.closest?.('.ds-app') || document.querySelector('.ds-app');
  const fire = (el, name, detail) => el.dispatchEvent(new CustomEvent(name, { bubbles: true, cancelable: true, detail }));

  /* ----- 削除: 縮んで消え、後ろの項目が詰まる ----- */
  const remove = el => {
    if (!el || !el.isConnected || el.dataset.dsRemoving) return Promise.resolve();
    el.dataset.dsRemoving = '1';
    if (reduce.matches) { el.remove(); return Promise.resolve(); }
    const cs = getComputedStyle(el);
    const h = el.getBoundingClientRect().height / scaleOf(el);
    el.classList.add('is-motion-clip');
    return play(el, [
      { height: h + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1 },
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0 },
    ], { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-standard'), fill: 'forwards' }).done.then(() => el.remove());
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
      const s = scaleOf(e);
      const dx = (a.left - b.left) / s;
      const dy = (a.top - b.top) / s;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      play(e, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-spring') });
    });
  };

  /* ----- details の開閉: メニューは浮かんで現れ、開閉できるまとまり（.ds-expandable）は高さが伸び縮みする ----- */
  const isDisclosure = d => d.matches('.ds-expandable');
  const heightFrames = (body, opening) => {
    const cs = getComputedStyle(body);
    const h = body.getBoundingClientRect().height / scaleOf(body);
    const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
    const full = { height: h + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 };
    return opening ? [shut, full] : [full, shut];
  };
  const openDetails = d => {
    if (d.open && !d.classList.contains('is-closing')) return;
    d.classList.remove('is-closing');
    d.open = true;
    const body = d.querySelector(':scope > :not(summary)');
    if (!body) return;
    if (isDisclosure(d)) {
      body.classList.add('is-motion-clip');
      play(body, heightFrames(body, true), { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-standard') })
        .done.then(() => body.classList.remove('is-motion-clip'));
    } else {
      play(body, [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }],
        { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-enter') });
    }
  };
  const closeDetails = d => {
    if (!d.open || d.classList.contains('is-closing')) return;
    const body = d.querySelector(':scope > :not(summary)');
    if (!body || reduce.matches) { d.open = false; return; }
    d.classList.add('is-closing');
    if (isDisclosure(d)) body.classList.add('is-motion-clip');
    const run = isDisclosure(d)
      ? play(body, heightFrames(body, false), { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-standard'), fill: 'forwards' })
      : play(body, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
        { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' });
    run.done.then(finished => {
      if (finished && d.classList.contains('is-closing')) { d.open = false; d.classList.remove('is-closing'); run.animation.cancel(); }
      body.classList.remove('is-motion-clip');
    });
  };

  /* ----- 重なる部品（シート・ダイアログ）----- */
  const layers = [];   // 開いている順
  const isSheet = el => el.classList.contains('ds-sheet');
  const isDrawer = el => el.classList.contains('ds-drawer');
  const open = (el, { returnFocus } = {}) => {
    if (!el || (!el.hidden && !el.classList.contains('is-closing'))) return Promise.resolve();
    const app = appOf(el);
    if (el.parentElement !== app) app.appendChild(el);   // 位置の基準を .ds-app にそろえる
    el.classList.remove('is-closing');
    el._dsReturn = returnFocus || document.activeElement;
    if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;

    const scrim = el._dsScrim || document.createElement('div');
    scrim.className = 'ds-scrim';
    scrim.onclick = () => close(el, 'scrim');
    el.before(scrim);
    el._dsScrim = scrim;
    // 後ろを押せない・読み上げないようにする（閉じたら元に戻す）
    el._dsInert = [...app.children].filter(c => c !== el && c !== scrim && !c.inert && !c.classList.contains('ds-snackbar-region'));
    el._dsInert.forEach(c => { c.inert = true; });

    el.hidden = false;
    el.style.transform = '';
    layers.push(el);
    play(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: ms('--ds-motion-duration-base'), easing: 'linear' });
    const run = isSheet(el)
      ? play(el, [{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-enter') })
      : isDrawer(el)
        ? play(el, [{ transform: 'translateX(-100%)' }, { transform: 'none' }], { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-enter') })
        : play(el, [{ opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1 }], { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-spring') });
    (el.querySelector('[autofocus]') || el).focus({ preventScroll: true });
    fire(el, 'ds-open');
    return run.done;
  };
  const close = (el, value) => {
    if (!el || el.hidden || el.classList.contains('is-closing')) return Promise.resolve();
    el.classList.add('is-closing');
    const scrim = el._dsScrim;
    const from = el._dsDragY || 0;
    el._dsDragY = 0;
    if (scrim) play(scrim, [{ opacity: getComputedStyle(scrim).opacity }, { opacity: 0 }], { duration: ms('--ds-motion-duration-base'), easing: 'linear', fill: 'forwards' });
    const run = isSheet(el)
      ? play(el, [{ transform: `translateY(${from}px)` }, { transform: 'translateY(100%)' }], { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' })
      : isDrawer(el)
        ? play(el, [{ transform: 'none' }, { transform: 'translateX(-100%)' }], { duration: ms('--ds-motion-duration-base'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' })
        : play(el, [{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.96 }], { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' });
    return run.done.then(() => {
      el.hidden = true;
      el.classList.remove('is-closing');
      el.style.transform = '';
      run.animation.cancel();
      scrim?.remove();
      (el._dsInert || []).forEach(c => { c.inert = false; });
      el._dsInert = [];
      layers.splice(layers.indexOf(el), 1);
      const back = el._dsReturn;
      if (back && back.isConnected && !back.closest('[inert]')) back.focus({ preventScroll: true });
      fire(el, 'ds-close', { value });
    });
  };

  /** 確かめるダイアログ。押したほうで true / false を返す。tone: 'primary' | 'danger' */
  const confirm = ({ title = '', message = '', ok = 'OK', cancel = 'キャンセル', tone = 'primary', icon = '', within } = {}) => new Promise(resolve => {
    const app = appOf(within);
    const d = document.createElement('div');
    const id = 'ds-dialog-' + Math.random().toString(36).slice(2, 8);
    d.className = 'ds-dialog';
    d.hidden = true;
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-labelledby', id);
    d.innerHTML = (icon ? `<svg class="ds-icon ds-dialog__icon" aria-hidden="true"><use href="#ds-i-${icon}"/></svg>` : '')
      + `<h2 class="ds-dialog__title" id="${id}"></h2><div class="ds-dialog__body"></div>`
      + '<div class="ds-dialog__actions"><button type="button" class="ds-btn ds-btn--link" data-close="cancel"></button>'
      + `<button type="button" class="ds-btn ds-btn--${tone === 'danger' ? 'danger' : 'primary'}" data-close="ok"></button></div>`;
    d.querySelector('.ds-dialog__title').textContent = title;
    const body = d.querySelector('.ds-dialog__body');
    if (message) body.textContent = message; else body.remove();
    const [c, o] = d.querySelectorAll('.ds-dialog__actions .ds-btn');
    c.textContent = cancel;
    o.textContent = ok;
    (tone === 'danger' ? c : o).autofocus = true;   // 取り消せない操作では、うっかり確定しないよう「キャンセル」を選んでおく
    app.appendChild(d);
    d.addEventListener('ds-close', e => { resolve(e.detail?.value === 'ok'); d.remove(); }, { once: true });
    open(d);
  });

  /* ----- 画面（.ds-screen）の進む・戻る ----- */
  const screensOf = app => [...app.querySelectorAll(':scope > .ds-app__stack > .ds-screen')];
  const activeScreen = app => screensOf(app).filter(s => !s.hidden).pop();
  const tabbarOf = app => app.querySelector(':scope > .ds-tabbar');
  const focusTitle = screen => {
    // 見出し（h1）を先に探す。大きな題名のアプリバーでは、小さな題名は aria-hidden なので選ばない
    const t = screen.querySelector('h1') || screen.querySelector('.ds-appbar__title:not([aria-hidden="true"])');
    if (!t) return;
    if (!t.hasAttribute('tabindex')) t.tabIndex = -1;
    t.focus({ preventScroll: true });
  };
  const slide = (incoming, outgoing, dir) => {
    const d = ms('--ds-motion-duration-screen');
    const e = ease('--ds-motion-ease-standard');
    incoming.style.zIndex = dir > 0 ? 2 : 1;
    outgoing.style.zIndex = dir > 0 ? 1 : 2;
    const a = play(incoming, dir > 0
      ? [{ transform: 'translateX(100%)', boxShadow: '0 0 24px var(--ds-color-shadow-strong)' }, { transform: 'none', boxShadow: '0 0 24px transparent' }]
      : [{ transform: 'translateX(-25%)', filter: 'brightness(0.92)' }, { transform: 'none', filter: 'none' }], { duration: d, easing: e });
    const b = play(outgoing, dir > 0
      ? [{ transform: 'none', filter: 'none' }, { transform: 'translateX(-25%)', filter: 'brightness(0.92)' }]
      : [{ transform: 'none' }, { transform: 'translateX(100%)' }], { duration: d, easing: e, fill: 'forwards' });
    return Promise.all([a.done, b.done]).then(() => {
      outgoing.hidden = true;
      b.animation.cancel();
      incoming.style.zIndex = outgoing.style.zIndex = '';
    });
  };
  /** 画面へ進む。進んだ先が data-tabbar="hidden" なら、下のタブを隠す */
  const push = target => {
    const app = appOf(target);
    const cur = activeScreen(app);
    if (!target || cur === target) return Promise.resolve();
    (app._dsHistory ||= []).push(cur);
    const tb = tabbarOf(app);
    if (tb && target.dataset.tabbar === 'hidden') tb.hidden = true;
    target.hidden = false;
    fire(target, 'ds-screenchange', { from: cur, to: target, dir: 1 });
    focusTitle(target);
    return slide(target, cur, 1);
  };
  /** 1 つ前の画面へ戻る。戻れたら true */
  const pop = app => {
    app = app?.matches?.('.ds-app') ? app : appOf(app);
    const prev = app?._dsHistory?.pop();
    if (!prev) return false;
    const cur = activeScreen(app);
    prev.hidden = false;
    const tb = tabbarOf(app);
    if (tb && prev.dataset.tabbar !== 'hidden') tb.hidden = false;
    fire(prev, 'ds-screenchange', { from: cur, to: prev, dir: -1 });
    focusTitle(prev);
    slide(prev, cur, -1);
    return true;
  };
  /** 「戻る」（端末の戻るボタン・戻るジェスチャー・Esc）: 開いている重なり → メニュー → 画面の順に閉じる。何か閉じたら true */
  const back = (scope = document) => {
    const within = el => scope === document || scope.contains(el);
    const top = [...layers].reverse().find(within);
    if (top) { close(top, 'back'); return true; }
    const menu = [...document.querySelectorAll('details.ds-menu[open]')].find(within);
    if (menu) { closeDetails(menu); return true; }
    const selecting = [...document.querySelectorAll('.is-selecting')].find(within);
    if (selecting && window.ds.selection) { window.ds.selection.exit(selecting); return true; }
    const app = scope.matches?.('.ds-app') ? scope : (scope.querySelector?.('.ds-app') || (scope === document ? null : appOf(scope)));
    return app ? pop(app) : false;
  };

  /* ----- スナックバー（操作の結果を下に短く出す） ----- */
  const safeBottom = app => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--ds-safe-bottom)';
    app.appendChild(probe);
    const h = probe.offsetHeight;
    probe.remove();
    return h;
  };
  const snackbar = ({ message = '', action = '', onAction, duration = 5000, within } = {}) => {
    const app = appOf(within);
    let region = app.querySelector(':scope > .ds-snackbar-region');
    if (!region) {
      region = document.createElement('div');
      region.className = 'ds-snackbar-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      app.appendChild(region);
    }
    // 下のタブ・下の操作帯・浮かぶボタンの上に出す
    const screen = activeScreen(app);
    const obstacles = [tabbarOf(app), screen?.querySelector('.ds-bottombar'), screen?.querySelector('.ds-fab')]
      .filter(o => o && !o.hidden && o.offsetParent !== null);
    const r = app.getBoundingClientRect();
    const top = Math.min(r.bottom, ...obstacles.map(o => o.getBoundingClientRect().top));
    const offset = obstacles.length ? (r.bottom - top) / scaleOf(app) : safeBottom(app);
    region.style.setProperty('--ds-snackbar-offset', offset + 'px');

    region.querySelectorAll('.ds-snackbar').forEach(old => old._dsClose?.());
    const s = document.createElement('div');
    s.className = 'ds-snackbar';
    s.innerHTML = '<div class="ds-snackbar__text"></div>'
      + (action ? '<button type="button" class="ds-btn ds-btn--link"></button>' : '')
      + '<button type="button" class="ds-btn ds-btn--icon" aria-label="お知らせを閉じる"><svg class="ds-icon"><use href="#ds-i-close"/></svg></button>';
    s.querySelector('.ds-snackbar__text').textContent = message;
    let timer;
    const dismiss = () => {
      if (s._dsGone) return;
      s._dsGone = true;
      clearTimeout(timer);
      play(s, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }],
        { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' }).done.then(() => s.remove());
    };
    s._dsClose = dismiss;
    if (action) {
      const b = s.querySelector('.ds-btn--link');
      b.textContent = action;
      b.onclick = () => { dismiss(); onAction?.(); };
    }
    s.querySelector('.ds-btn--icon').onclick = dismiss;
    // 触れている間・選んでいる間は消さない（読み終える前に消えないように）
    const arm = () => { clearTimeout(timer); if (duration > 0) timer = setTimeout(dismiss, duration); };
    s.addEventListener('pointerenter', () => clearTimeout(timer));
    s.addEventListener('pointerleave', arm);
    s.addEventListener('focusin', () => clearTimeout(timer));
    s.addEventListener('focusout', arm);
    region.appendChild(s);
    play(s, [{ opacity: 0, transform: 'translateY(100%) scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: ms('--ds-motion-duration-slow'), easing: ease('--ds-motion-ease-spring') });
    arm();
    return { element: s, close: dismiss };
  };

  return {
    ms, ease, play, transition, scaleOf, remove, enter, flip, openDetails, closeDetails,
    open, close, confirm, push, pop, back, snackbar, activeScreen, reduced: () => reduce.matches,
  };
})();

/* ========== 2. 部品の共通の動き ========== */
(() => {
  // 見た目（ミニマル・コンソール）: data-look-choice="minimal|console" の項目で選ぶ。選んだものは localStorage に残す（PC 版と同じ ds-look）
  const LOOK_KEY = 'ds-look';
  const currentLook = () => document.documentElement.dataset.look || 'minimal';
  const markLook = () => document.querySelectorAll('[data-look-choice]').forEach(x => {
    const on = x.dataset.lookChoice === currentLook();
    x.setAttribute(x.matches('.ds-segmented > button, .ds-chip') ? 'aria-pressed' : 'aria-checked', String(on));
  });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-look-choice]');
    if (!c) return;
    const l = c.dataset.lookChoice;
    ds.transition(() => {
      if (l === 'minimal') delete document.documentElement.dataset.look;
      else document.documentElement.dataset.look = l;
      try { localStorage.setItem(LOOK_KEY, l); } catch (_) { /* 保存できない環境では、その場だけ切り替える */ }
      markLook();
      document.dispatchEvent(new CustomEvent('ds-lookchange', { detail: { look: l } }));
    });
  });

  // 画面の明るさ: data-theme-choice="auto|light|dark" の項目で選ぶ（PC 版と同じ ds-theme）
  const THEME_KEY = 'ds-theme';
  const currentTheme = () => document.documentElement.dataset.theme || 'auto';
  const markTheme = () => document.querySelectorAll('[data-theme-choice]').forEach(x => {
    const on = x.dataset.themeChoice === currentTheme();
    x.setAttribute(x.matches('.ds-segmented > button, .ds-chip') ? 'aria-pressed' : 'aria-checked', String(on));
  });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-theme-choice]');
    if (!c) return;
    const t = c.dataset.themeChoice;
    ds.transition(() => {
      if (t === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = t;
      try { t === 'auto' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch (_) { /* その場だけ切り替える */ }
      markTheme();
      document.dispatchEvent(new CustomEvent('ds-themechange', { detail: { theme: t } }));
    });
  });
  const markAll = () => { markLook(); markTheme(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markAll); else markAll();

  // 重なる部品の開閉: data-open="id" で開き、中の data-close="値" で閉じる
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); ds.open(document.getElementById(o.dataset.open), { returnFocus: o }); return; }
    const c = e.target.closest('[data-close]');
    if (c) {
      const layer = c.closest('.ds-sheet, .ds-dialog, .ds-drawer');
      if (layer?._dsDragged) { layer._dsDragged = false; return; }   // つまみを引いて離したときの click は無視する
      if (layer) ds.close(layer, c.dataset.close || c.value || 'close');
    }
  });
  // 画面の進む・戻る: data-push="screen-id"、data-pop
  document.addEventListener('click', e => {
    const p = e.target.closest('[data-push]');
    if (p) { e.preventDefault(); ds.push(document.getElementById(p.dataset.push)); return; }
    const b = e.target.closest('[data-pop]');
    if (b) { e.preventDefault(); ds.pop(b); }
  });
  // Esc は「戻る」と同じ
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ds.back(document)) e.preventDefault();
  });

  // 下のタブ: 押した項目だけ aria-current="page"。data-screen="id" があれば、その画面を最上位として出す
  document.addEventListener('click', e => {
    const item = e.target.closest('.ds-tabbar__item');
    if (!item) return;
    const bar = item.closest('.ds-tabbar');
    const app = bar.closest('.ds-app');
    const target = item.dataset.screen && document.getElementById(item.dataset.screen);
    const already = item.getAttribute('aria-current') === 'page';
    if (already) {
      // 同じタブをもう一度押したら、最上位の画面へ戻り、さらに押したら先頭へ送る
      if (app?._dsHistory?.length) { app._dsHistory.length = 1; ds.pop(app); }
      else ds.activeScreen(app)?.querySelector('.ds-content')?.scrollTo({ top: 0, behavior: ds.reduced() ? 'auto' : 'smooth' });
      return;
    }
    bar.querySelectorAll('.ds-tabbar__item').forEach(x => x.removeAttribute('aria-current'));
    item.setAttribute('aria-current', 'page');
    if (target && app) {
      app.querySelectorAll(':scope > .ds-app__stack > .ds-screen').forEach(s => { s.hidden = s !== target; s.style.transform = ''; });
      app._dsHistory = [];
      ds.play(target, [{ opacity: 0 }, { opacity: 1 }], { duration: ds.ms('--ds-motion-duration-fast'), easing: 'linear' });
    }
    item.dispatchEvent(new CustomEvent('ds-tabchange', { bubbles: true, detail: { item, screen: target } }));
  });

  // 上のタブ: 押したものだけ aria-selected="true"。aria-controls の中身を出し、ほかを隠す
  document.addEventListener('click', e => {
    const t = e.target.closest('.ds-tabs__tab');
    if (!t) return;
    const tabs = [...t.parentElement.querySelectorAll('.ds-tabs__tab')];
    tabs.forEach(x => {
      x.setAttribute('aria-selected', String(x === t));
      const p = x.getAttribute('aria-controls') && document.getElementById(x.getAttribute('aria-controls'));
      if (p) p.hidden = x !== t;
    });
    t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: ds.reduced() ? 'auto' : 'smooth' });
  });

  // 切り替えボタン（.ds-segmented）: 押したものだけ aria-pressed="true"
  document.addEventListener('click', e => {
    const b = e.target.closest('.ds-segmented > button');
    if (!b || b.matches('[data-look-choice], [data-theme-choice]')) return;
    b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    b.dispatchEvent(new CustomEvent('ds-change', { bubbles: true, detail: { value: b.value || b.dataset.value || b.textContent.trim() } }));
  });

  // 札（.ds-chip[aria-pressed]）: 押すと選ぶ・外す。.ds-chips[data-single] の中では 1 つだけ選ぶ
  document.addEventListener('click', e => {
    const c = e.target.closest('.ds-chip[aria-pressed]');
    if (!c || c.matches('[data-look-choice], [data-theme-choice]')) return;
    const group = c.closest('.ds-chips');
    if (group?.hasAttribute('data-single')) group.querySelectorAll('.ds-chip[aria-pressed]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    else c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true'));
    c.dispatchEvent(new CustomEvent('ds-change', { bubbles: true, detail: { chip: c, pressed: c.getAttribute('aria-pressed') === 'true' } }));
  });

  // メニュー（details.ds-menu）: 開閉を動かす。外を押すか、項目を押したら閉じる
  document.addEventListener('click', e => {
    const s = e.target.closest('details.ds-menu > summary, details.ds-expandable > summary');
    if (s) { e.preventDefault(); const d = s.parentElement; d.open ? ds.closeDetails(d) : ds.openDetails(d); }
    document.querySelectorAll('details.ds-menu[open]').forEach(d => {
      if (!d.contains(e.target) || e.target.closest('.ds-menu__item')) ds.closeDetails(d);
    });
  });

  // 数の増減（.ds-number）: data-step の分だけ変える。min / max を超えない
  document.addEventListener('click', e => {
    const b = e.target.closest('.ds-number [data-step]');
    if (!b) return;
    const input = b.closest('.ds-number').querySelector('input');
    const v = (parseFloat(input.value) || 0) + parseFloat(b.dataset.step);
    const min = input.min === '' ? -Infinity : +input.min;
    const max = input.max === '' ? Infinity : +input.max;
    input.value = Math.min(max, Math.max(min, v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // 検索欄の消すボタン
  document.addEventListener('click', e => {
    const b = e.target.closest('.ds-search__clear');
    if (!b) return;
    const input = b.closest('.ds-search').querySelector('.ds-input');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
})();

/* ========== 3. 指の動き ========== */
(() => {
  const vibrate = ms => { try { navigator.vibrate?.(ms); } catch (_) { /* 震えない端末では何もしない */ } };

  // ----- シートを引いて閉じる（つまみ・見出しを下へ引く。3 割を超えるか、速く払うと閉じる） -----
  document.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.ds-sheet__handle, .ds-sheet__header');
    if (!grip || (e.target.closest('button, a, input, select, textarea') && !e.target.closest('.ds-sheet__handle'))) return;
    const sheet = grip.closest('.ds-sheet');
    if (!sheet || sheet.hidden || sheet.classList.contains('is-closing')) return;
    const s = ds.scaleOf(sheet);
    const y0 = e.clientY;
    let dy = 0, lastY = y0, lastT = e.timeStamp, v = 0;
    sheet._dsDragged = false;
    grip.setPointerCapture(e.pointerId);
    const scrim = sheet._dsScrim;
    const move = ev => {
      const raw = (ev.clientY - y0) / s;
      dy = raw >= 0 ? raw : raw * 0.15;   // 上へは少しだけ動く（引っ張れないことを伝える）
      if (Math.abs(raw) > 4) { sheet._dsDragged = true; sheet.classList.add('is-dragging'); }
      sheet.style.transform = `translateY(${dy}px)`;
      if (scrim) scrim.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
      v = (ev.clientY - lastY) / s / Math.max(1, ev.timeStamp - lastT);
      lastY = ev.clientY; lastT = ev.timeStamp;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      sheet.classList.remove('is-dragging');
      if (!sheet._dsDragged) return;
      if (dy > sheet.offsetHeight * 0.3 || v > 0.6) {
        sheet._dsDragY = dy;
        ds.close(sheet, 'drag');
      } else {
        ds.play(sheet, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: ds.ms('--ds-motion-duration-slow'), easing: ds.ease('--ds-motion-ease-spring') });
        sheet.style.transform = '';
        if (scrim) scrim.style.opacity = '';
      }
      setTimeout(() => { sheet._dsDragged = false; }, 0);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });

  // ----- 行を払う（.ds-swipe）。4 割を超えて離すと ds-swipe イベントを出す -----
  // 画面の側でイベントの preventDefault() を呼ぶと、行は戻らない（ds.remove で消すときなど）
  document.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.ds-swipe > .ds-cell');
    if (!cell || e.button > 0 || cell.closest('.is-selecting')) return;   // 選ぶ状態では払えない
    const row = cell.parentElement;
    const s = ds.scaleOf(row);
    const x0 = e.clientX, y0 = e.clientY;
    let state = 'pending', dx = 0, armed = false;
    const sides = { start: row.querySelector('.ds-swipe__action--start'), end: row.querySelector('.ds-swipe__action--end') };
    const move = ev => {
      const mx = (ev.clientX - x0) / s, my = (ev.clientY - y0) / s;
      if (state === 'pending') {
        if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my) * 1.2) { state = 'drag'; cell.setPointerCapture(ev.pointerId); }
        else if (Math.abs(my) > 8) { state = 'off'; return end(); }
        else return;
      }
      const dir = mx > 0 ? 'start' : 'end';
      dx = sides[dir] ? mx : mx * 0.15;
      row.dataset.swipeDir = dir;
      cell.style.transform = `translateX(${dx}px)`;
      const now = !!sides[dir] && Math.abs(dx) > row.offsetWidth * 0.4;
      if (now !== armed) { armed = now; row.classList.toggle('is-armed', armed); if (armed) vibrate(8); }
    };
    const end = () => {
      cell.removeEventListener('pointermove', move);
      cell.removeEventListener('pointerup', end);
      cell.removeEventListener('pointercancel', end);
      if (state !== 'drag') return;
      row._dsSuppressClick = true;
      setTimeout(() => { row._dsSuppressClick = false; }, 0);
      const dir = row.dataset.swipeDir;
      const back = () => {
        ds.play(cell, [{ transform: cell.style.transform || 'none' }, { transform: 'none' }], { duration: ds.ms('--ds-motion-duration-slow'), easing: ds.ease('--ds-motion-ease-spring') })
          .done.then(() => { row.classList.remove('is-armed'); delete row.dataset.swipeDir; });
        cell.style.transform = '';
      };
      if (!armed) return back();
      const w = row.offsetWidth * (dir === 'start' ? 1 : -1);
      ds.play(cell, [{ transform: `translateX(${dx}px)` }, { transform: `translateX(${w}px)` }], { duration: ds.ms('--ds-motion-duration-fast'), easing: ds.ease('--ds-motion-ease-exit'), fill: 'forwards' })
        .done.then(() => {
          cell.style.transform = `translateX(${w}px)`;
          const ok = row.dispatchEvent(new CustomEvent('ds-swipe', { bubbles: true, cancelable: true, detail: { side: dir, action: sides[dir]?.dataset.action, row, cell } }));
          if (ok) back();
        });
    };
    cell.addEventListener('pointermove', move);
    cell.addEventListener('pointerup', end);
    cell.addEventListener('pointercancel', end);
  });
  // マウスでリンクの行を引くと、ブラウザのリンクのドラッグが始まり、払う・引く動きが途中で切れる。アプリの中では止める
  document.addEventListener('dragstart', e => {
    if (e.target.closest?.('.ds-app') && !e.target.closest('[draggable="true"]')) e.preventDefault();
  });
  // 払ったあとの click で行が開かないようにする
  document.addEventListener('click', e => {
    const row = e.target.closest('.ds-swipe');
    if (row?._dsSuppressClick) { e.preventDefault(); e.stopPropagation(); row._dsSuppressClick = false; }
  }, true);

  // ----- 引いて更新（.ds-content[data-refresh]）。先頭で下へ引いて離すと ds-refresh イベントを出す -----
  // 画面の側で preventDefault() を呼んだら、読み込みが終わったときに detail.done() を呼ぶ。呼ばなければ 0.9 秒で戻る
  const PULL = 64;
  const ptrOf = content => {
    let p = content.querySelector(':scope > .ds-ptr');
    if (!p) {
      p = document.createElement('div');
      p.className = 'ds-ptr';
      p.setAttribute('aria-hidden', 'true');
      p.innerHTML = '<span class="ds-ptr__icon"><svg class="ds-icon"><use href="#ds-i-refresh"/></svg></span>';
      content.prepend(p);
    }
    return p;
  };
  const startPull = (content, y0, s) => {
    const p = ptrOf(content);
    if (p.classList.contains('is-refreshing')) return null;
    let dy = 0;
    return {
      move(y) {
        dy = Math.max(0, (y - y0) / s);
        const h = Math.min(96, dy * 0.5);
        p.style.height = h + 'px';
        p.style.setProperty('--ds-ptr-turn', (h / PULL) * 270 + 'deg');
        return dy > 2;
      },
      end() {
        const h = parseFloat(p.style.height) || 0;
        const reset = () => ds.play(p, [{ height: p.style.height || '0px' }, { height: '0px' }], { duration: ds.ms('--ds-motion-duration-base'), easing: ds.ease('--ds-motion-ease-standard') })
          .done.then(() => { p.style.height = ''; p.classList.remove('is-refreshing'); });
        if (h < PULL) { reset(); p.style.height = '0px'; return; }
        p.style.height = '56px';
        p.classList.add('is-refreshing');
        let finished = false;
        const done = () => { if (finished) return; finished = true; reset(); p.style.height = '0px'; };
        const ok = content.dispatchEvent(new CustomEvent('ds-refresh', { bubbles: true, cancelable: true, detail: { done } }));
        if (ok) setTimeout(done, 900);
      },
    };
  };
  // マウス（ブラウザでのデモ）: ポインターで引く
  document.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button > 0) return;
    const content = e.target.closest('.ds-content[data-refresh]');
    if (!content || content.scrollTop > 0 || e.target.closest('.ds-swipe, input, textarea, select, button.ds-btn')) return;
    const pull = startPull(content, e.clientY, ds.scaleOf(content));
    if (!pull) return;
    let moved = false;
    const move = ev => { moved = pull.move(ev.clientY) || moved; };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      if (moved) {
        pull.end();
        // 引いたあとの click で行が開かないようにする（click が来なかったときは、次の操作を止めないよう外す）
        const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
        addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', swallow, true), 0);
      } else {
        pull.end();
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  // 指（実機）: 先頭で下へ引いたときだけ、ブラウザの送りを止めて引く
  document.addEventListener('touchstart', e => {
    const content = e.target.closest('.ds-content[data-refresh]');
    if (!content || content.scrollTop > 0 || e.touches.length > 1 || e.target.closest('.ds-swipe')) return;
    const pull = startPull(content, e.touches[0].clientY, ds.scaleOf(content));
    if (!pull) return;
    const move = ev => {
      if (content.scrollTop > 0) return;
      if (pull.move(ev.touches[0].clientY) && ev.cancelable) ev.preventDefault();
    };
    const end = () => {
      content.removeEventListener('touchmove', move);
      content.removeEventListener('touchend', end);
      content.removeEventListener('touchcancel', end);
      pull.end();
    };
    content.addEventListener('touchmove', move, { passive: false });
    content.addEventListener('touchend', end);
    content.addEventListener('touchcancel', end);
  }, { passive: true });

  // ----- 送りに合わせたアプリバーと浮かぶボタンの変化 -----
  document.addEventListener('scroll', e => {
    const c = e.target;
    if (!(c instanceof Element) || !c.matches('.ds-content')) return;
    const screen = c.closest('.ds-screen') || c.parentElement;
    const bar = screen.querySelector(':scope > .ds-appbar');
    const y = c.scrollTop;
    if (bar) {
      bar.classList.toggle('is-scrolled', y > 0);
      if (bar.classList.contains('ds-appbar--large')) {
        // 行き来しないよう、畳む所と開く所をずらす
        if (y > 40) bar.classList.add('is-collapsed');
        else if (y < 4) bar.classList.remove('is-collapsed');
      }
    }
    const fab = screen.querySelector(':scope > .ds-fab--extended');
    if (fab) {
      const last = c._dsLastY || 0;
      if (y > last + 4 && y > 40) fab.classList.add('is-compact');
      else if (y < last - 4 || y < 8) fab.classList.remove('is-compact');
    }
    c._dsLastY = y;
  }, true);
})();

/* ========== 4. 追加した部品の動き ========== */
(() => {
  const onReady = fn => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  const fire = (el, name, detail) => el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  const vibrate = n => { try { navigator.vibrate?.(n); } catch (_) { /* 震えない端末 */ } };
  const pad = n => String(n).padStart(2, '0');

  /* ----- スライダー: 値に合わせて塗りと値の文字を変える（.ds-slider__value の data-unit を後ろに付ける） ----- */
  const paintSlider = input => {
    const min = input.min === '' ? 0 : +input.min;
    const max = input.max === '' ? 100 : +input.max;
    input.style.setProperty('--ds-fill', ((input.value - min) / (max - min || 1)) * 100 + '%');
    const out = input.closest('.ds-slider')?.querySelector('.ds-slider__value');
    if (out) out.textContent = input.value + (out.dataset.unit || '');
  };
  document.addEventListener('input', e => { if (e.target.matches?.('.ds-slider input[type="range"]')) paintSlider(e.target); });

  /* ----- カレンダー: data-month="2026-11"・data-value（選んだ日）・data-today・data-min・data-max・data-marks（印を付ける日をカンマ区切り） ----- */
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const renderCalendar = cal => {
    const today = cal.dataset.today || iso(new Date());
    const [y, m] = (cal.dataset.month || (cal.dataset.value || today).slice(0, 7)).split('-').map(Number);
    cal.dataset.month = `${y}-${pad(m)}`;
    const sel = cal.dataset.value || '';
    const marks = (cal.dataset.marks || '').split(',');
    const { min = '', max = '' } = cal.dataset;
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    let html = '<div class="ds-calendar__head">'
      + '<button type="button" class="ds-btn ds-btn--icon" data-cal-step="-1" aria-label="前の月"><svg class="ds-icon"><use href="#ds-i-angle-left"/></svg></button>'
      + `<p class="ds-calendar__month" aria-live="polite">${y}年${m}月</p>`
      + '<button type="button" class="ds-btn ds-btn--icon" data-cal-step="1" aria-label="次の月"><svg class="ds-icon"><use href="#ds-i-angle-right"/></svg></button></div>'
      + '<div class="ds-calendar__grid">'
      + [...'日月火水木金土'].map(d => `<span class="ds-calendar__dow" aria-hidden="true">${d}</span>`).join('')
      + '<span></span>'.repeat(first);
    for (let d = 1; d <= days; d++) {
      const v = `${y}-${pad(m)}-${pad(d)}`;
      const off = (min && v < min) || (max && v > max);
      html += `<button type="button" class="ds-calendar__day" data-date="${v}" aria-pressed="${v === sel}" aria-label="${m}月${d}日${v === today ? '（今日）' : ''}"`
        + `${v === today ? ' data-today' : ''}${marks.includes(v) ? ' data-mark' : ''}${off ? ' disabled' : ''}>${d}</button>`;
    }
    cal.innerHTML = html + '</div>';
  };
  document.addEventListener('click', e => {
    const step = e.target.closest('.ds-calendar [data-cal-step]');
    if (step) {
      const cal = step.closest('.ds-calendar');
      const [y, m] = cal.dataset.month.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(step.dataset.calStep), 1);
      cal.dataset.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      renderCalendar(cal);
      cal.querySelector(`[data-cal-step="${step.dataset.calStep}"]`)?.focus();
      return;
    }
    const day = e.target.closest('.ds-calendar__day');
    if (!day) return;
    const cal = day.closest('.ds-calendar');
    cal.dataset.value = day.dataset.date;
    cal.querySelectorAll('.ds-calendar__day').forEach(x => x.setAttribute('aria-pressed', String(x === day)));
    fire(cal, 'ds-change', { value: day.dataset.date });
  });

  /* ----- ホイール: 真ん中の帯に止まった項目を選ぶ。項目を押すとそこまで回る。↑ ↓ キーでも動く ----- */
  const ITEM = 44;
  const markWheel = col => {
    const items = col.querySelectorAll('.ds-wheel__item');
    const i = Math.max(0, Math.min(items.length - 1, Math.round(col.scrollTop / ITEM)));
    items.forEach((x, j) => { x.classList.toggle('is-selected', j === i); x.setAttribute('aria-selected', String(j === i)); });
    return items[i];
  };
  const settle = new WeakMap();
  document.addEventListener('scroll', e => {
    const col = e.target;
    if (!(col instanceof Element) || !col.matches('.ds-wheel__col')) return;
    markWheel(col);
    clearTimeout(settle.get(col));
    settle.set(col, setTimeout(() => {
      const it = markWheel(col);
      fire(col.closest('.ds-wheel'), 'ds-change', { column: col, value: it?.dataset.value ?? it?.textContent.trim() });
    }, 140));
  }, true);
  document.addEventListener('click', e => {
    const it = e.target.closest('.ds-wheel__item');
    if (!it) return;
    const col = it.parentElement;
    col.scrollTo({ top: [...col.children].indexOf(it) * ITEM, behavior: ds.reduced() ? 'auto' : 'smooth' });
  });
  document.addEventListener('keydown', e => {
    const col = e.target.closest?.('.ds-wheel__col');
    if (!col || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    col.scrollBy({ top: e.key === 'ArrowUp' ? -ITEM : ITEM, behavior: ds.reduced() ? 'auto' : 'smooth' });
  });
  const initWheel = col => {
    const items = [...col.querySelectorAll('.ds-wheel__item')];
    const i = Math.max(0, items.findIndex(x => x.classList.contains('is-selected') || (col.dataset.value && x.dataset.value === col.dataset.value)));
    col.scrollTop = i * ITEM;
    markWheel(col);
  };

  /* ----- 認証コード: 1 文字入れると次の枠へ、空で ← を押すと前の枠へ、貼り付けると全部に入る。揃うと ds-complete ----- */
  document.addEventListener('input', e => {
    const box = e.target.closest?.('.ds-otp input');
    if (!box) return;
    const otp = box.closest('.ds-otp');
    const boxes = [...otp.querySelectorAll('input')];
    const chars = box.value.replace(/\s/g, '');
    if (chars.length > 1) {
      let i = boxes.indexOf(box);
      for (const c of chars) { if (i >= boxes.length) break; boxes[i++].value = c; }
      boxes[Math.min(i, boxes.length - 1)].focus();
    } else if (chars) {
      box.value = chars;
      boxes[boxes.indexOf(box) + 1]?.focus();
    }
    otp.removeAttribute('aria-invalid');
    const code = boxes.map(b => b.value).join('');
    if (code.length === boxes.length) fire(otp, 'ds-complete', { code });
  });
  document.addEventListener('keydown', e => {
    const box = e.target.closest?.('.ds-otp input');
    if (!box) return;
    const boxes = [...box.closest('.ds-otp').querySelectorAll('input')];
    const i = boxes.indexOf(box);
    if (e.key === 'Backspace' && !box.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ''; boxes[i - 1].focus(); }
    if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
    if (e.key === 'ArrowRight' && i < boxes.length - 1) boxes[i + 1].focus();
  });
  /** 認証コードが違ったとき: 枠を揺らし、空にして最初の枠へ戻す */
  const otpError = otp => {
    otp.setAttribute('aria-invalid', 'true');
    otp.classList.remove('is-shake');
    void otp.offsetWidth;
    otp.classList.add('is-shake');
    vibrate([20, 40, 20]);
    otp.querySelectorAll('input').forEach(b => { b.value = ''; });
    otp.querySelector('input')?.focus();
  };

  /* ----- 札の入力: Enter・カンマ・読点で札にする。空で ← を押すと最後の札を外す ----- */
  const addTag = (wrap, text) => {
    text = text.trim();
    if (!text) return;
    const t = document.createElement('span');
    t.className = 'ds-tag';
    t.innerHTML = '<span></span><button type="button" class="ds-tag__remove"><svg class="ds-icon"><use href="#ds-i-close"/></svg></button>';
    t.firstChild.textContent = text;
    t.querySelector('button').setAttribute('aria-label', `${text} を外す`);
    wrap.insertBefore(t, wrap.querySelector('input'));
    ds.enter(t);
    fire(wrap, 'ds-change', { tags: tagsOf(wrap) });
  };
  const tagsOf = wrap => [...wrap.querySelectorAll('.ds-tag > span:first-child')].map(s => s.textContent);
  document.addEventListener('keydown', e => {
    const input = e.target.closest?.('.ds-tag-input input');
    if (!input) return;
    const wrap = input.closest('.ds-tag-input');
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(wrap, input.value); input.value = ''; }
    if (e.key === 'Backspace' && !input.value) {
      const last = [...wrap.querySelectorAll('.ds-tag')].pop();
      if (last) ds.remove(last).then(() => fire(wrap, 'ds-change', { tags: tagsOf(wrap) }));
    }
  });
  document.addEventListener('input', e => {
    const input = e.target.closest?.('.ds-tag-input input');
    if (!input || !/[,、，]/.test(input.value)) return;
    const parts = input.value.split(/[,、，]/);
    input.value = parts.pop();
    parts.forEach(p => addTag(input.closest('.ds-tag-input'), p));
  });
  document.addEventListener('click', e => {
    const rm = e.target.closest('.ds-tag__remove');
    if (rm) { const wrap = rm.closest('.ds-tag-input'); ds.remove(rm.closest('.ds-tag')).then(() => wrap && fire(wrap, 'ds-change', { tags: tagsOf(wrap) })); return; }
    const wrap = e.target.closest('.ds-tag-input');
    if (wrap && !e.target.closest('.ds-tag')) wrap.querySelector('input')?.focus();
  });

  /* ----- 添付: × で外す。＋ を押すと ds-attach イベント（ファイルを選ぶ処理は画面の側） ----- */
  document.addEventListener('click', e => {
    const rm = e.target.closest('.ds-attach__remove');
    if (rm) { ds.remove(rm.closest('.ds-attach__item')); return; }
    const add = e.target.closest('.ds-attach__add');
    if (add) fire(add.closest('.ds-attach'), 'ds-attach', {});
  });

  /* ----- 下の入力欄: 何か書くまで送るボタンを押せなくする。送ると ds-send イベント（detail.text）で、欄を空にする ----- */
  const syncComposer = c => {
    const t = c.querySelector('textarea');
    const send = c.querySelector('.ds-composer__send');
    if (t && send) send.disabled = !t.value.trim();
  };
  document.addEventListener('input', e => { const c = e.target.closest?.('.ds-composer'); if (c) syncComposer(c); });
  document.addEventListener('click', e => {
    const send = e.target.closest('.ds-composer__send');
    if (!send) return;
    const c = send.closest('.ds-composer');
    const t = c.querySelector('textarea');
    const text = t.value.trim();
    if (!text) return;
    t.value = '';
    syncComposer(c);
    fire(c, 'ds-send', { text });
  });

  /* ----- 続きを読む: 切れているときだけボタンを出す。押すと全文と短い形を切り替える ----- */
  const checkMore = m => {
    if (m.classList.contains('is-open')) return;
    const t = m.querySelector('.ds-more__text');
    m.classList.toggle('is-clamped', !!t && t.scrollHeight > t.clientHeight + 1);
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('.ds-more__toggle');
    if (!b) return;
    const m = b.closest('.ds-more');
    const open = m.classList.toggle('is-open');
    b.setAttribute('aria-expanded', String(open));
    b.textContent = open ? (b.dataset.closeLabel || '短く表示') : (b.dataset.openLabel || '続きを読む');
    if (!open) checkMore(m);
  });

  /* ----- 横に送るページとページの印: .ds-pager[data-dots="印の id"]。data-pager-next="ページの id" で次へ ----- */
  const pageOf = p => Math.round(p.scrollLeft / Math.max(1, p.clientWidth));
  const markDots = p => {
    const dots = p.dataset.dots && document.getElementById(p.dataset.dots);
    if (!dots) return;
    const i = pageOf(p);
    [...dots.children].forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
    fire(p, 'ds-pagechange', { index: i, last: i === p.children.length - 1 });
  };
  document.addEventListener('scroll', e => {
    const p = e.target;
    if (p instanceof Element && p.matches('.ds-pager')) { clearTimeout(p._dsT); p._dsT = setTimeout(() => markDots(p), 60); }
  }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-pager-next]');
    if (!b) return;
    const p = document.getElementById(b.dataset.pagerNext);
    const i = pageOf(p);
    if (i >= p.children.length - 1) { fire(p, 'ds-pager-end', {}); return; }
    p.scrollTo({ left: (i + 1) * p.clientWidth, behavior: ds.reduced() ? 'auto' : 'smooth' });
  });

  /* ----- 残り時間: data-seconds から 1 秒ずつ減らす。60 秒を切ると --warning、0 で --expired と ds-expire イベント ----- */
  const tickTimers = () => document.querySelectorAll('.ds-timer[data-seconds]').forEach(t => {
    let s = Number(t.dataset.seconds);
    if (t.dataset.started) s = Math.max(0, s - 1); else t.dataset.started = '1';
    t.dataset.seconds = s;
    const text = t.querySelector('.ds-timer__text') || t;
    text.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    t.classList.toggle('ds-timer--warning', s > 0 && s < 60);
    t.classList.toggle('ds-timer--expired', s === 0);
    if (s === 0 && !t.dataset.expired) { t.dataset.expired = '1'; fire(t, 'ds-expire', {}); }
  });
  setInterval(tickTimers, 1000);

  /* ----- 選ぶ状態: <ul class="ds-list" data-selectable> の行を長押し（0.5 秒）すると入る ----- */
  const scopeOf = el => el.closest('.ds-screen') || el.closest('.ds-app') || document.body;
  const cellsOf = scope => [...scope.querySelectorAll('[data-selectable] .ds-cell')];
  const selectedOf = scope => cellsOf(scope).filter(c => c.getAttribute('aria-selected') === 'true');
  const bars = scope => ({
    sel: scope.querySelector(':scope > .ds-appbar--selection'),
    normal: scope.querySelector(':scope > .ds-appbar:not(.ds-appbar--selection)'),
  });
  const update = scope => {
    const n = selectedOf(scope).length;
    scope.querySelectorAll('[data-selection-count]').forEach(x => { x.textContent = `${n} 件を選択中`; });
    if (n === 0) return exitSelection(scope);
    fire(scope, 'ds-selectionchange', { cells: selectedOf(scope) });
  };
  const enterSelection = (scope, cell) => {
    if (!scope.classList.contains('is-selecting')) {
      scope.classList.add('is-selecting');
      cellsOf(scope).forEach(c => c.setAttribute('aria-selected', 'false'));
      const { sel, normal } = bars(scope);
      if (sel) {
        if (normal) normal.hidden = true;
        sel.hidden = false;
        ds.play(sel, [{ opacity: 0 }, { opacity: 1 }], { duration: ds.ms('--ds-motion-duration-fast'), easing: 'linear' });
        sel.querySelector('[data-selection-cancel]')?.focus({ preventScroll: true });
      }
      vibrate(12);
    }
    if (cell) cell.setAttribute('aria-selected', 'true');
    update(scope);
  };
  const exitSelection = scope => {
    if (!scope.classList.contains('is-selecting')) return;
    scope.classList.remove('is-selecting');
    cellsOf(scope).forEach(c => c.removeAttribute('aria-selected'));
    const { sel, normal } = bars(scope);
    if (sel) sel.hidden = true;
    if (normal) normal.hidden = false;
    fire(scope, 'ds-selectionchange', { cells: [] });
  };
  ds.selection = { enter: enterSelection, exit: exitSelection, selected: selectedOf };

  document.addEventListener('pointerdown', e => {
    const cell = e.target.closest('[data-selectable] .ds-cell');
    if (!cell || e.button > 0) return;
    const scope = scopeOf(cell);
    if (scope.classList.contains('is-selecting')) return;
    const x0 = e.clientX, y0 = e.clientY;
    const cancel = () => {
      clearTimeout(timer);
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', cancel, true);
      removeEventListener('pointercancel', cancel, true);
    };
    const move = ev => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cancel(); };
    const timer = setTimeout(() => {
      cancel();
      cell._dsLongPressed = true;   // 指を離したときの click で、行が開かないようにする
      enterSelection(scope, cell);
    }, 500);
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', cancel, true);
    addEventListener('pointercancel', cancel, true);
  });
  document.addEventListener('contextmenu', e => { if (e.target.closest('[data-selectable] .ds-cell')) e.preventDefault(); });
  document.addEventListener('click', e => {
    const cell = e.target.closest('[data-selectable] .ds-cell');
    if (cell?._dsLongPressed) { cell._dsLongPressed = false; e.preventDefault(); e.stopPropagation(); return; }
    if (cell && scopeOf(cell).classList.contains('is-selecting')) {
      e.preventDefault(); e.stopPropagation();
      cell.setAttribute('aria-selected', String(cell.getAttribute('aria-selected') !== 'true'));
      update(scopeOf(cell));
      return;
    }
    const cancelBtn = e.target.closest('[data-selection-cancel]');
    if (cancelBtn) { exitSelection(scopeOf(cancelBtn)); return; }
    const all = e.target.closest('[data-selection-all]');
    if (all) { const scope = scopeOf(all); cellsOf(scope).forEach(c => c.setAttribute('aria-selected', 'true')); update(scope); }
  }, true);

  /* ----- 案内の吹き出し: ds.coach([{ target, text }], { within }) で、部品を順に指して説明する。'done' か 'skip' を返す ----- */
  ds.coach = (steps, { within } = {}) => new Promise(resolve => {
    const app = (within && (within.closest?.('.ds-app') || within)) || document.querySelector('.ds-app');
    const scrim = Object.assign(document.createElement('div'), { className: 'ds-coach-scrim' });
    const ring = Object.assign(document.createElement('div'), { className: 'ds-coach-ring' });
    const bubble = Object.assign(document.createElement('div'), { className: 'ds-coach' });
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-live', 'polite');
    app.append(scrim, ring, bubble);
    let i = 0;
    const end = how => {
      removeEventListener('keydown', onKey, true);
      [scrim, ring, bubble].forEach(x => x.remove());
      resolve(how);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); end('skip'); } };
    addEventListener('keydown', onKey, true);
    const show = () => {
      const st = steps[i];
      const target = typeof st.target === 'string' ? app.querySelector(st.target) : st.target;
      if (!target) { i++; return i < steps.length ? show() : end('done'); }
      target.scrollIntoView({ block: 'nearest' });
      const k = ds.scaleOf(app);
      const a = app.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const x = (r.left - a.left) / k, y = (r.top - a.top) / k, w = r.width / k, h = r.height / k;
      Object.assign(ring.style, { left: x - 4 + 'px', top: y - 4 + 'px', width: w + 8 + 'px', height: h + 8 + 'px' });
      const last = i === steps.length - 1;
      bubble.innerHTML = `<div class="ds-coach__step">${i + 1} / ${steps.length}</div><p class="ds-coach__text"></p>`
        + `<div class="ds-coach__actions"><button type="button" class="ds-btn ds-btn--link" data-coach="skip">${last ? '' : 'スキップ'}</button>`
        + `<button type="button" class="ds-btn ds-btn--link" data-coach="next">${last ? 'わかった' : '次へ'}</button></div>`;
      bubble.querySelector('.ds-coach__text').textContent = st.text;
      const bh = bubble.offsetHeight;
      const below = y + h + 14 + bh < app.offsetHeight - 16;
      bubble.classList.toggle('ds-coach--below', below);
      bubble.classList.toggle('ds-coach--above', !below);
      bubble.style.top = (below ? y + h + 14 : y - 14 - bh) + 'px';
      const bl = bubble.offsetLeft;
      bubble.style.setProperty('--ds-coach-arrow', Math.max(20, Math.min(bubble.offsetWidth - 20, x + w / 2 - bl)) + 'px');
      bubble.querySelector('[data-coach="next"]').focus({ preventScroll: true });
    };
    bubble.addEventListener('click', e => {
      const b = e.target.closest('[data-coach]');
      if (!b) return;
      if (b.dataset.coach === 'skip') return end('skip');
      i++;
      if (i >= steps.length) end('done'); else show();
    });
    show();
  });

  ds.calendar = renderCalendar;
  ds.otpError = otpError;

  // 隠れていた部品（タブの中身・シートの中）は、表示されて大きさが決まったときに測り直す
  const ro = new ResizeObserver(entries => entries.forEach(en => {
    const el = en.target;
    if (el.matches('.ds-more')) checkMore(el);
    if (el.matches('.ds-wheel__col') && !el._dsInit && el.clientHeight) { el._dsInit = true; initWheel(el); }
  }));
  /** 部品の初めの形を整える。あとから HTML を差し込んだときは、差し込んだ範囲で ds.init(要素) を呼ぶ */
  ds.init = (root = document) => {
    root.querySelectorAll('.ds-slider input[type="range"]').forEach(paintSlider);
    root.querySelectorAll('.ds-calendar').forEach(renderCalendar);
    root.querySelectorAll('.ds-wheel__col').forEach(initWheel);
    root.querySelectorAll('.ds-composer').forEach(syncComposer);
    root.querySelectorAll('.ds-more').forEach(checkMore);
    root.querySelectorAll('.ds-pager').forEach(markDots);
    root.querySelectorAll('.ds-more, .ds-wheel__col').forEach(el => ro.observe(el));
  };
  onReady(() => { ds.init(); tickTimers(); });
})();
