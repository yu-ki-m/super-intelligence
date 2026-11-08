/*
 * 汎用デザインシステム（スマートフォン版）— 部品の動き
 * <script src="components.js" defer></script> で読み込む。各画面の固有の動き（保存・計算など）はここに入れない。
 *
 * 構成
 *   1. 動きの土台（window.ds）: 前後の形を測って動かす関数と、重なる部品・画面の移動・知らせの関数。画面の側からも呼べる。
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

  /* ----- メニュー（details）: 浮かんで現れる ----- */
  const openDetails = d => {
    if (d.open && !d.classList.contains('is-closing')) return;
    d.classList.remove('is-closing');
    d.open = true;
    const body = d.querySelector(':scope > :not(summary)');
    if (body) play(body, [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }],
      { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-enter') });
  };
  const closeDetails = d => {
    if (!d.open || d.classList.contains('is-closing')) return;
    const body = d.querySelector(':scope > :not(summary)');
    if (!body || reduce.matches) { d.open = false; return; }
    d.classList.add('is-closing');
    const run = play(body, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
      { duration: ms('--ds-motion-duration-fast'), easing: ease('--ds-motion-ease-exit'), fill: 'forwards' });
    run.done.then(finished => {
      if (finished && d.classList.contains('is-closing')) { d.open = false; d.classList.remove('is-closing'); run.animation.cancel(); }
    });
  };

  /* ----- 重なる部品（シート・ダイアログ）----- */
  const layers = [];   // 開いている順
  const isSheet = el => el.classList.contains('ds-sheet');
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
      + '<button type="button" class="ds-btn ds-btn--icon" aria-label="知らせを閉じる"><svg class="ds-icon"><use href="#ds-i-close"/></svg></button>';
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
      const layer = c.closest('.ds-sheet, .ds-dialog');
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
    const s = e.target.closest('details.ds-menu > summary');
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
    if (!cell || e.button > 0) return;
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
