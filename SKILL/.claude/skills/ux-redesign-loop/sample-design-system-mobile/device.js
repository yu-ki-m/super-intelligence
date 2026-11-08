/*
 * 汎用デザインシステム（スマートフォン版）— 端末の動き（デモ用）
 * <script src="device.js" defer></script> で、components.js の後に読み込む。
 *
 * .dv-phone の中に、時刻の帯・カメラの穴・下の操作の帯・キーボード・ホーム画面を足し、端末らしく動かす。
 *   ・時計: 今の時刻を出す（data-time="9:41" で固定できる）。電池は data-battery="76"
 *   ・戻る: 3 つのボタンの「戻る」、画面の左右の端から内へ払う、Esc。アプリの ds.back() を呼び、戻れなければホーム画面へ
 *   ・ホーム: 3 つのボタンの「ホーム」、下のつまみを上へ払う。アプリのアイコンを押すと戻る
 *   ・キーボード: 画面の中の入力欄を選ぶと下から出て、アプリの表示面が縮む。キーを押すと入力欄に文字が入る
 *   ・台に合わせて縮める: .dv-stage の中の端末を、ブラウザの高さに収まるよう縮める（data-dv-scale="1" で縮めない）
 * 画面の側から使う関数: dv.notify()、dv.toast()、dv.permission()、dv.home()、dv.back()、dv.setFrame()、dv.setNav()
 * 幅の狭い画面（実機）では、端末の部品は表示せず、キーボードも出さない（device.css の「実機で開いたとき」）。
 */
window.dv = (() => {
  const real = matchMedia('(max-width: 540px)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const phones = () => [...document.querySelectorAll('.dv-phone')];
  const phoneOf = el => el?.closest?.('.dv-phone') || document.querySelector('.dv-phone');
  const screenOf = phone => phone.querySelector('.dv-screen');
  const icon = (id, cls = 'dv-icon') => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><use href="#${id}"/></svg>`;
  const anim = (el, frames, opt) => reduce.matches ? { finished: Promise.resolve() } : el.animate(frames, { fill: 'both', ...opt });
  const scaleOf = el => (el.offsetHeight ? el.getBoundingClientRect().height / el.offsetHeight : 1) || 1;
  const pad = n => String(n).padStart(2, '0');
  const timeText = phone => {
    if (phone.dataset.time) return phone.dataset.time;
    const d = new Date();
    return `${d.getHours()}:${pad(d.getMinutes())}`;
  };

  /* ----- 端末の部品を作る ----- */
  const build = phone => {
    if (phone._dv) return;
    phone._dv = {};
    if (!phone.querySelector('.dv-phone__glass')) {
      const glass = document.createElement('div');
      glass.className = 'dv-phone__glass';
      const screen = phone.querySelector('.dv-screen') || Object.assign(document.createElement('div'), { className: 'dv-screen' });
      glass.appendChild(screen);
      phone.prepend(glass);
    }
    const screen = screenOf(phone);
    screen.insertAdjacentHTML('beforeend', `
      <div class="dv-statusbar" aria-hidden="true">
        <div class="dv-statusbar__left"><span class="dv-time"></span><span class="dv-notif-icons"></span></div>
        <div class="dv-statusbar__right">${icon('dv-i-wifi')}${icon('dv-i-signal')}<span class="dv-battery"></span></div>
      </div>
      <div class="dv-camera" aria-hidden="true"></div>
      <div class="dv-home dv-wallpaper" hidden>
        <div class="dv-home__clock"></div>
        <div class="dv-home__date"></div>
        <div class="dv-home__dock"><button type="button" class="dv-home__app" data-dv="open-app"><span class="dv-home__app-icon"></span><span class="dv-home__app-name"></span></button></div>
        <div class="dv-home__hint">アイコンを押すと、アプリに戻ります</div>
      </div>
      <div class="dv-back-arrow" aria-hidden="true">${icon('ds-i-angle-left')}</div>
      <div class="dv-keyboard" aria-hidden="true"></div>
      <div class="dv-navbar">
        <button type="button" class="dv-navbar__handle" data-dv="home-handle" aria-label="ホーム（上へ払う）" tabindex="-1"></button>
        <div class="dv-navbar__buttons">
          <button type="button" class="dv-navbar__btn" data-dv="back" aria-label="戻る">${icon('dv-i-nav-back')}</button>
          <button type="button" class="dv-navbar__btn" data-dv="home" aria-label="ホーム">${icon('dv-i-nav-home')}</button>
          <button type="button" class="dv-navbar__btn" data-dv="recents" aria-label="最近使ったアプリ">${icon('dv-i-nav-recents')}</button>
        </div>
      </div>`);
    const name = phone.dataset.appName || document.title || 'アプリ';
    screen.querySelector('.dv-home__app-name').textContent = name;
    screen.querySelector('.dv-home__app-icon').textContent = phone.dataset.appIcon || name.trim().charAt(0);
    tick(phone);
    renderKeyboard(phone, 'alpha');
  };

  /* ----- 時計と電池 ----- */
  const tick = phone => {
    const s = screenOf(phone);
    s.querySelector('.dv-time').textContent = timeText(phone);
    s.querySelector('.dv-home__clock').textContent = timeText(phone);
    const d = new Date();
    s.querySelector('.dv-home__date').textContent = `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`;
    const b = s.querySelector('.dv-battery');
    const level = Math.max(0, Math.min(100, +(phone.dataset.battery || 80)));
    b.style.setProperty('--dv-battery', level);
    b.toggleAttribute('data-low', level <= 15);
  };
  setInterval(() => phones().forEach(p => p._dv && tick(p)), 15000);

  /* ----- 台に合わせて縮める ----- */
  const fit = () => phones().forEach(p => {
    const stage = p.closest('.dv-stage');
    if (!stage || p.dataset.dvScale === '1' || real.matches) { p.style.removeProperty('--dv-scale'); return; }
    const avail = window.innerHeight - 48;
    const h = p.offsetHeight;
    p.style.setProperty('--dv-scale', String(Math.min(1, Math.max(0.5, avail / h))));
  });
  addEventListener('resize', fit);
  real.addEventListener('change', fit);

  /* ----- ホーム画面 ----- */
  const home = (phone = phoneOf()) => {
    const s = screenOf(phone);
    const h = s.querySelector('.dv-home');
    if (!h.hidden) return;
    document.activeElement?.blur?.();
    h.hidden = false;
    s.classList.add('is-home');
    const v = s.querySelector('.dv-viewport');
    if (v) anim(v, [{ transform: 'none', opacity: 1 }, { transform: 'scale(0.86)', opacity: 0, borderRadius: '24px' }], { duration: 280, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
    anim(h, [{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    phone.dispatchEvent(new CustomEvent('dv-home', { bubbles: true }));
  };
  const openApp = (phone = phoneOf()) => {
    const s = screenOf(phone);
    const h = s.querySelector('.dv-home');
    if (h.hidden) return;
    const v = s.querySelector('.dv-viewport');
    if (v) anim(v, [{ transform: 'scale(0.6)', opacity: 0, borderRadius: '24px' }, { transform: 'none', opacity: 1, borderRadius: '0px' }], { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
      .finished.then(() => v.getAnimations().forEach(a => a.cancel()));
    anim(h, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.then(() => { h.hidden = true; h.getAnimations().forEach(a => a.cancel()); });
    s.classList.remove('is-home');
  };

  /* ----- 戻る ----- */
  const back = (phone = phoneOf()) => {
    const s = screenOf(phone);
    if (s.classList.contains('has-perm')) return;            // 許可のダイアログは、選ぶまで閉じない
    if (s.classList.contains('is-kb')) { document.activeElement?.blur?.(); return; }
    if (!s.querySelector('.dv-home').hidden) return;
    const v = s.querySelector('.dv-viewport');
    let handled = false;
    if (v?.tagName === 'IFRAME') {
      try { handled = !!v.contentWindow.ds?.back?.(v.contentDocument); } catch (_) { /* 別のオリジンのページには届かない */ }
    } else {
      handled = !!window.ds?.back?.(v || s);
    }
    if (!handled) home(phone);   // 最上位の画面で戻ると、アプリを離れてホーム画面へ
  };

  /* ----- 端末のボタン ----- */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-dv]');
    if (!b || !b.closest('.dv-phone')) return;
    const phone = phoneOf(b);
    const act = b.dataset.dv;
    if (act === 'back') back(phone);
    else if (act === 'home') home(phone);
    else if (act === 'open-app') openApp(phone);
    else if (act === 'recents') toast('最近使ったアプリの一覧は、このデモでは開きません', phone);
  });

  /* ----- ジェスチャー: 下のつまみを上へ払うとホーム、左右の端から内へ払うと戻る ----- */
  document.addEventListener('pointerdown', e => {
    const s = e.target.closest('.dv-screen');
    if (!s || real.matches || e.button > 0) return;
    const phone = phoneOf(s);
    if (phone.dataset.nav === 'buttons') return;
    const k = scaleOf(s);
    const r = s.getBoundingClientRect();
    const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
    const w = s.offsetWidth;
    // 下のつまみ
    if (e.target.closest('.dv-navbar__handle')) {
      const y0 = e.clientY;
      const up = ev => {
        removeEventListener('pointerup', up);
        if ((y0 - ev.clientY) / k > 40) home(phone);
      };
      addEventListener('pointerup', up);
      return;
    }
    // 左右の端（16px）
    const side = x < 16 ? 'left' : x > w - 16 ? 'right' : null;
    if (!side || e.target.closest('.dv-keyboard, .dv-home, .dv-perm')) return;
    e.stopPropagation();     // アプリの「行を払う」などより先に受け取る
    if (e.pointerType === 'mouse') e.preventDefault();   // マウスで引いたときに、文字が選ばれないようにする
    const arrow = s.querySelector('.dv-back-arrow');
    arrow.dataset.side = side;
    arrow.style.left = side === 'left' ? '0' : 'auto';
    arrow.style.right = side === 'right' ? '0' : 'auto';
    arrow.style.top = y + 'px';
    const x0 = e.clientX;
    let pull = 0;
    const move = ev => {
      const dx = ((ev.clientX - x0) / k) * (side === 'left' ? 1 : -1);
      pull = Math.max(0, Math.min(36, dx * 0.5));
      arrow.style.setProperty('--dv-back-pull', pull + 'px');
      arrow.style.setProperty('--dv-back-opacity', String(Math.min(1, dx / 40)));
      arrow.classList.toggle('is-armed', dx > 56);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      const armed = arrow.classList.contains('is-armed');
      arrow.classList.remove('is-armed');
      arrow.style.setProperty('--dv-back-pull', '0px');
      arrow.style.setProperty('--dv-back-opacity', '0');
      if (armed) back(phone);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }, true);

  /* ----- 画面のキーボード ----- */
  const LAYOUT = {
    alpha: [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'], ['?123', '、', ' ', '。', '↵']],
    symbol: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['@', '#', '¥', '_', '&', '-', '+', '(', ')', '/'], ['=', '*', '"', "'", ':', ';', '!', '?', '⌫'], ['ABC', ',', ' ', '.', '↵']],
    numeric: [['1', '2', '3', '-'], ['4', '5', '6', ','], ['7', '8', '9', '⌫'], ['*', '0', '.', '↵']],
  };
  const keyHtml = k => {
    const fn = { '⇧': ['fn', icon('ds-i-shift'), 'shift'], '⌫': ['fn', icon('ds-i-backspace'), 'backspace'], '↵': ['enter', icon('ds-i-enter'), 'enter'], '?123': ['fn', '?123', 'symbol'], 'ABC': ['fn', 'ABC', 'alpha'], ' ': ['space', 'space', 'space'] }[k];
    if (fn) return `<button type="button" tabindex="-1" class="dv-key dv-key--${fn[0]}" data-key="${fn[2]}">${fn[1]}</button>`;
    return `<button type="button" tabindex="-1" class="dv-key" data-char="${k.replace(/"/g, '&quot;')}">${k}</button>`;
  };
  const renderKeyboard = (phone, mode) => {
    const kb = screenOf(phone).querySelector('.dv-keyboard');
    kb.dataset.mode = mode;
    kb.classList.toggle('dv-keyboard--numeric', mode === 'numeric');
    kb.innerHTML = '<div class="dv-keyboard__strip"><span></span><span></span><span>' + icon('ds-i-mic') + '</span></div>'
      + LAYOUT[mode].map((row, i) => `<div class="dv-keyboard__row${mode === 'alpha' && i === 1 ? ' dv-keyboard__row--offset' : ''}">${row.map(keyHtml).join('')}</div>`).join('');
    updateStrip(phone);
  };
  const isText = el => el && el.matches?.('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="number"], input[type="password"], [contenteditable="true"]')
    && !el.readOnly && !el.disabled;
  const modeFor = el => (/^(numeric|decimal|tel)$/.test(el.inputMode) || /^(number|tel)$/.test(el.type)) ? 'numeric' : 'alpha';
  const updateStrip = phone => {
    const el = document.activeElement;
    const spans = screenOf(phone).querySelectorAll('.dv-keyboard__strip span');
    if (spans.length < 2) return;
    const word = (isText(el) && typeof el.value === 'string') ? (el.value.slice(0, el.selectionEnd ?? el.value.length).match(/[^\s、。,.]*$/) || [''])[0] : '';
    spans[0].textContent = word;
    spans[1].textContent = word ? word + '…' : '';
  };
  const showKeyboard = (phone, el) => {
    const s = screenOf(phone);
    const kb = s.querySelector('.dv-keyboard');
    const mode = modeFor(el);
    if (kb.dataset.mode !== mode && !(mode === 'alpha' && kb.dataset.mode === 'symbol')) renderKeyboard(phone, mode);
    s.classList.add('is-kb');
    s.style.setProperty('--dv-kb-h', kb.offsetHeight + 'px');
    updateStrip(phone);
    // 縮んだ表示面の中で、選んだ入力欄が見えるようにする
    setTimeout(() => el.scrollIntoView?.({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' }), reduce.matches ? 0 : 340);
  };
  const hideKeyboard = phone => {
    const s = screenOf(phone);
    s.classList.remove('is-kb');
    s.style.setProperty('--dv-kb-h', '0px');
  };
  document.addEventListener('focusin', e => {
    const phone = e.target.closest?.('.dv-phone');
    if (!phone || real.matches || phone.dataset.dvKeyboard === 'off' || !e.target.closest('.dv-viewport')) return;
    // 入力欄でないものに焦点が移ったときは、下の focusout の処理が、指を離すのを待ってから閉じる
    if (isText(e.target)) showKeyboard(phone, e.target);
  });
  // 実機では、キーボードは指を離したあとに閉じる。押している間に閉じると、押したボタンが指の下から動き、押せなくなる
  let pressing = false;
  addEventListener('pointerdown', () => { pressing = true; }, true);
  addEventListener('pointerup', () => { setTimeout(() => { pressing = false; }, 0); }, true);
  addEventListener('pointercancel', () => { pressing = false; }, true);
  document.addEventListener('focusout', e => {
    const phone = e.target.closest?.('.dv-phone');
    if (!phone) return;
    const check = () => {
      if (pressing) return setTimeout(check, 30);
      if (!isText(document.activeElement) || !phone.contains(document.activeElement)) hideKeyboard(phone);
    };
    setTimeout(check, 0);
  });
  document.addEventListener('input', e => { const p = e.target.closest?.('.dv-phone'); if (p) updateStrip(p); });
  // キーを押しても入力欄から選択が外れないよう、pointerdown の既定の動きを止める
  document.addEventListener('pointerdown', e => {
    const key = e.target.closest('.dv-key');
    if (!key) return;
    e.preventDefault();
    key.classList.add('is-down');
    const phone = phoneOf(key);
    const kb = key.closest('.dv-keyboard');
    const el = document.activeElement;
    const release = () => { key.classList.remove('is-down'); removeEventListener('pointerup', release); };
    addEventListener('pointerup', release);
    try { navigator.vibrate?.(5); } catch (_) { /* 震えない端末 */ }
    const k = key.dataset.key;
    if (k === 'shift') { key.setAttribute('aria-pressed', String(key.getAttribute('aria-pressed') !== 'true')); return; }
    if (k === 'symbol' || k === 'alpha') { renderKeyboard(phone, k); return; }
    if (!isText(el)) return;
    if (k === 'enter') {
      if (el.tagName === 'TEXTAREA') return insert(el, '\n');
      const ok = el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      if (ok) { if (el.form) el.form.requestSubmit?.(); else el.blur(); }
      return;
    }
    if (k === 'backspace') return erase(el);
    let ch = k === 'space' ? ' ' : key.dataset.char;
    const shift = kb.querySelector('[data-key="shift"][aria-pressed="true"]');
    if (shift) { ch = ch.toUpperCase(); shift.setAttribute('aria-pressed', 'false'); }
    insert(el, ch);
  });
  const fireInput = el => el.dispatchEvent(new Event('input', { bubbles: true }));
  const insert = (el, ch) => {
    try { el.setRangeText(ch, el.selectionStart, el.selectionEnd, 'end'); }
    catch (_) { el.value += ch; }   // type="number" などは選択位置を持たない
    fireInput(el);
  };
  const erase = el => {
    try {
      const a = el.selectionStart, b = el.selectionEnd;
      if (a === b && a > 0) el.setRangeText('', a - 1, b, 'end'); else el.setRangeText('', a, b, 'end');
    } catch (_) { el.value = String(el.value).slice(0, -1); }
    fireInput(el);
  };

  /* ----- 通知（画面の上に出る） ----- */
  const notify = ({ app, title = '', text = '', icon: letter, time = '今', duration = 6000, onTap, phone } = {}) => {
    phone = phone || phoneOf();
    const s = screenOf(phone);
    s.querySelectorAll('.dv-heads-up').forEach(n => n.remove());
    const n = document.createElement('div');
    n.className = 'dv-heads-up';
    n.setAttribute('role', 'alert');
    const appName = app || phone.dataset.appName || 'アプリ';
    n.innerHTML = '<span class="dv-heads-up__icon"></span><span class="dv-heads-up__app"></span><span class="dv-heads-up__time"></span><span class="dv-heads-up__title"></span><span class="dv-heads-up__text"></span>';
    n.querySelector('.dv-heads-up__icon').textContent = letter || phone.dataset.appIcon || appName.charAt(0);
    n.querySelector('.dv-heads-up__app').textContent = appName;
    n.querySelector('.dv-heads-up__time').textContent = time;
    n.querySelector('.dv-heads-up__title').textContent = title;
    n.querySelector('.dv-heads-up__text').textContent = text;
    s.appendChild(n);
    // 時刻の帯に通知の印を出す
    s.querySelector('.dv-notif-icons').innerHTML = icon('ds-i-bell', 'ds-icon');
    try { navigator.vibrate?.([30, 60, 30]); } catch (_) { /* 震えない端末 */ }
    anim(n, [{ transform: 'translateY(-130%)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    let gone = false;
    const dismiss = (dy = 0) => {
      if (gone) return; gone = true;
      clearTimeout(timer);
      anim(n, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(-130%)', opacity: 0.6 }], { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)' }).finished.then(() => n.remove());
    };
    const timer = setTimeout(() => dismiss(), duration);
    // 上へ払うと消える。押すと開く
    n.addEventListener('pointerdown', e => {
      const k = scaleOf(n), y0 = e.clientY;
      let dy = 0;
      n.setPointerCapture(e.pointerId);
      const move = ev => { dy = Math.min(0, (ev.clientY - y0) / k); n.style.transform = `translateY(${dy}px)`; };
      const up = () => {
        n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up);
        if (dy < -24) return dismiss(dy);
        n.style.transform = '';
        if (dy > -4) { dismiss(); s.querySelector('.dv-notif-icons').innerHTML = ''; openApp(phone); onTap?.(); }
      };
      n.addEventListener('pointermove', move); n.addEventListener('pointerup', up);
    });
    return { element: n, close: () => dismiss() };
  };

  /* ----- 端末の短い知らせ（トースト） ----- */
  const toast = (text, phone) => {
    phone = phone || phoneOf();
    const s = screenOf(phone);
    s.querySelectorAll('.dv-toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'dv-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    s.appendChild(t);
    anim(t, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200 });
    setTimeout(() => anim(t, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.then(() => t.remove()), 2600);
  };

  /* ----- 端末の許可のダイアログ。選んだ文字を返す ----- */
  const permission = ({ app, text = '通知の送信を許可しますか？', iconId = 'ds-i-bell', options = ['許可', '許可しない'], phone } = {}) => new Promise(resolve => {
    phone = phone || phoneOf();
    const s = screenOf(phone);
    document.activeElement?.blur?.();
    const scrim = document.createElement('div');
    scrim.className = 'dv-perm-scrim';
    const d = document.createElement('div');
    d.className = 'dv-perm';
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-modal', 'true');
    d.innerHTML = `${icon(iconId, 'ds-icon dv-perm__icon')}<p class="dv-perm__title">「<b></b>」に${''}<span></span></p><div class="dv-perm__choices"></div>`;
    d.querySelector('b').textContent = app || phone.dataset.appName || 'アプリ';
    d.querySelector('.dv-perm__title span').textContent = text;
    options.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dv-perm__choice';
      b.textContent = o;
      b.onclick = () => {
        anim(d, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 160 });
        anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished.then(() => { scrim.remove(); d.remove(); s.classList.remove('has-perm'); });
        resolve(o);
      };
      d.querySelector('.dv-perm__choices').appendChild(b);
    });
    s.classList.add('has-perm');
    s.append(scrim, d);
    anim(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    anim(d, [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    d.querySelector('.dv-perm__choice').focus({ preventScroll: true });
  });

  /* ----- 枠の色・下の操作の帯の切り替え（localStorage に残す） ----- */
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* その場だけ切り替える */ } };
  const load = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const setFrame = (frame, phone) => { (phone ? [phone] : phones()).forEach(p => { p.dataset.frame = frame; }); save('dv-frame', frame); mark(); };
  const setNav = (nav, phone) => { (phone ? [phone] : phones()).forEach(p => { p.dataset.nav = nav; }); save('dv-nav', nav); mark(); };
  const mark = () => {
    const p = phoneOf();
    if (!p) return;
    document.querySelectorAll('[data-dv-frame]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dvFrame === (p.dataset.frame || 'mint'))));
    document.querySelectorAll('[data-dv-nav]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dvNav === (p.dataset.nav || 'gesture'))));
  };
  document.addEventListener('click', e => {
    const f = e.target.closest('[data-dv-frame]');
    if (f) setFrame(f.dataset.dvFrame);
    const n = e.target.closest('[data-dv-nav]');
    if (n) setNav(n.dataset.dvNav);
  });

  /* ----- 始める ----- */
  const init = () => {
    const f = load('dv-frame'), n = load('dv-nav');
    phones().forEach(p => {
      if (f && !p.hasAttribute('data-frame-fixed')) p.dataset.frame = f;
      if (n && !p.hasAttribute('data-nav-fixed')) p.dataset.nav = n;
      build(p);
    });
    mark();
    fit();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { notify, toast, permission, home, openApp, back, setFrame, setNav, fit, build };
})();
