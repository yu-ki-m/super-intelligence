/* page-explainer engine v1
 * ページの解説の案内（ページの部分を1つずつ枠で囲んで指し、吹き出しで説明する機能）を、任意の HTML の上に重ねて出す。
 * scripts/guide.py が HTML に埋め込む。埋め込むときに、下の const CSS の右辺を assets/guide-engine.css の中身（文字列）に置き換える。
 * ページの要素には手を加えない（クラスも属性も足さない）。吹き出し・暗幕・ボタンは Shadow DOM の中に作るので、
 * ページの CSS は案内に届かず、案内の CSS もページに届かない。
 * 案内を開いている間は、案内をモーダルの dialog（最前面の層）として出す。ページは操作できなくなり、
 * ページのキーボードの近道も案内の中では動かない。案内を閉じると、ページは元どおりに操作できる。 */
(() => {
  'use strict';
  const NS = 'page-explainer';
  if (window.__PAGE_EXPLAINER_DISABLED__ || window.pageExplainer) return;
  // ライブの案内（URL のページを Playwright で開いて解説するとき）は、scripts/live-tour.mjs が案内のデータを渡し、
  // 次へ・戻る・目次での移動・閉じるを受け取って、ページの操作と画面の移動を受け持つ
  const LIVE = !!(window.__PAGE_EXPLAINER_LIVE__ && window.__PAGE_EXPLAINER_LIVE__.guide);
  let G;
  if (LIVE) G = window.__PAGE_EXPLAINER_LIVE__.guide;
  else {
    const dataEl = document.getElementById(NS + '-data');
    if (!dataEl) return;
    try { G = JSON.parse(dataEl.textContent); } catch (e) { console.error('[page-explainer] 案内のデータ（JSON）を読めない。', e); return; }
  }
  const STEPS = (Array.isArray(G.steps) ? G.steps : []).map((s) => Object.assign({}, s, {
    levels: Array.isArray(s.levels) && s.levels.length ? s.levels : [{ blocks: [] }],
  }));
  const N = STEPS.length;
  if (!N) return;
  const CSS = __GUIDE_CSS__;

  // ---------- 保存（ブラウザーの localStorage。使えない環境では何も残さずに動く） ----------
  const KEY = NS + ':' + (G.id || location.pathname);
  const load = (k) => { if (LIVE) return null; try { const v = localStorage.getItem(KEY + ':' + k); return v == null ? null : JSON.parse(v); } catch (_) { return null; } };
  const save = (k, v) => { if (LIVE) return; try { if (v == null) localStorage.removeItem(KEY + ':' + k); else localStorage.setItem(KEY + ':' + k, JSON.stringify(v)); } catch (_) { /* 保存できなくても案内は動く */ } };

  // ---------- 小さな道具 ----------
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); return el; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  // 実際に見えている範囲（ビジュアルビューポート）。x, y は、固定配置の基準（ページの描画の枠）の左上からのずれ。
  // 幅の広いページを狭い画面で開くと、ブラウザーは描画の枠を広げ、見えている範囲だけを動かすことがある。
  // そのため、吹き出しや、案内を開くボタンは、描画の枠ではなく、見えている範囲を基準に置く。
  const vp = () => {
    const vv = window.visualViewport;
    if (vv && vv.width > 0 && vv.height > 0) return { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height };
    const de = document.documentElement;
    if (document.compatMode === 'CSS1Compat' && de.clientWidth) return { x: 0, y: 0, w: de.clientWidth, h: de.clientHeight };
    return { x: 0, y: 0, w: (document.body && document.body.clientWidth) || innerWidth, h: innerHeight };
  };
  // 描画の枠の座標（getBoundingClientRect の値）を、見えている範囲の左上を原点とする座標に直す
  const toView = (r, v) => (r ? { x: r.x - v.x, y: r.y - v.y, w: r.w, h: r.h } : null);
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  // null や false を飛ばして子を足す（Element.append に null を渡すと「null」という文字が入るため）
  const put = (parent, ...kids) => { for (const k of kids.flat()) if (k != null && k !== false) parent.append(k); return parent; };
  const num = (v) => (Math.round(v * 10) / 10).toString();

  // 文体：案内の本文と同じ文体で、エンジンの決まり文句も出す（plain: だ・である / polite: です・ます）
  const T = (plain, polite) => (G.style === 'polite' ? polite : plain);
  const LAUNCHER = G.launcher === false ? null : Object.assign({ label: '解説', position: 'bottom-right' }, G.launcher || {});
  const POS_WORD = { 'bottom-right': '右下', 'bottom-left': '左下', 'top-right': '右上', 'top-left': '左上' };
  if (LAUNCHER && !POS_WORD[LAUNCHER.position]) LAUNCHER.position = 'bottom-right';
  const chapterOf = (st) => { const c = (Array.isArray(G.chapters) ? G.chapters : []).find((x) => x && x.id === st.chapter); return c ? String(c.title || '') : ''; };

  // ---------- 言葉の一覧（term のブロックから集める。前の手順で説明した言葉は、後の手順で押すと意味が出る） ----------
  const GLOSS = [];
  STEPS.forEach((s, i) => s.levels.forEach((lv) => (Array.isArray(lv.blocks) ? lv.blocks : []).forEach((b) => {
    if (b && b.type === 'term' && b.term && !GLOSS.some((g) => g.term === String(b.term))) GLOSS.push({ term: String(b.term), text: String(b.text || ''), step: i });
  })));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const KATA = /[ァ-ヶー]/;
  const termCtx = (i) => {
    const own = new Set();
    STEPS[i].levels.forEach((lv) => (Array.isArray(lv.blocks) ? lv.blocks : []).forEach((b) => { if (b && b.type === 'term') own.add(String(b.term)); }));
    const list = GLOSS.filter((g) => g.step < i && !own.has(g.term) && g.term.length >= 2).sort((a, b) => b.term.length - a.term.length);
    if (!list.length) return null;
    return { re: new RegExp(list.map((g) => reEsc(g.term)).join('|'), 'g'), map: new Map(list.map((g) => [g.term, g])) };
  };

  // ---------- 状態 ----------
  const S = {
    open: false, mode: 'tour', i: 0, level: new Array(N).fill(0), expanded: new Array(N).fill(false), toc: false, handoff: false, resumeAt: null,
    targets: [], clips: [], tr: null, hole: null, tween: null, side: null, sideStep: -1, placeMode: 'center',
    raf: 0, frames: 0, settled: false, stable: 0, lastKey: '', waiters: [], token: 0, renderId: 0, nat: null,
    prevFocus: null, missing: false, lastAct: null, mt: 0, modal: true, notice: null, op: null,
  };

  // ---------- 部品の組み立て（すべて Shadow DOM の中） ----------
  const host = document.createElement(NS);
  host.setAttribute('style', 'all:initial;color-scheme:inherit;display:block;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;');
  const sr = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS;
  const root = h('div', { class: 'root' });
  sr.append(styleEl, root);

  let launcher = null;
  if (LAUNCHER) {
    launcher = h('button', {
      type: 'button', class: 'launcher pos-' + LAUNCHER.position,
      'aria-label': 'このページの解説を開く', 'aria-haspopup': 'dialog',
      onclick: () => {
        if (LIVE) { hostCall({ type: 'resume' }); return; }
        const last = load('last'); if (Number.isInteger(last) && last > 0 && last < N) openWelcome(last); else openTour(0);
      },
    }, h('span', { class: 'q', 'aria-hidden': 'true', text: '?' }), h('span', { text: String(LAUNCHER.label || '解説') }));
    root.append(launcher);
  }

  const svg = sv('svg', { class: 'dim', 'aria-hidden': 'true' });
  const dimPath = sv('path', { class: 'dim-path', 'fill-rule': 'evenodd', d: '' });
  const ring = sv('rect', { class: 'ring', rx: '8', ry: '8', x: '0', y: '0', width: '0', height: '0' });
  svg.append(dimPath, ring);
  const hd = h('header', { class: 'hd' });
  const body = h('div', { class: 'bd', tabindex: '0', role: 'region', 'aria-label': '説明' });
  const gran = h('div', { class: 'gran' });
  const ft = h('footer', { class: 'ft' });
  const card = h('div', { class: 'card' }, hd, body, gran, ft);
  const arrow = h('div', { class: 'arrow', 'aria-hidden': 'true', hidden: true });
  const balloon = h('div', { class: 'balloon' }, arrow, card);
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
  const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': 'g-ttl' }, svg, balloon, live);
  root.append(dlg);
  (document.documentElement || document.body).appendChild(host);

  // ---------- 説明の文字（**太字** と `コード` だけを解釈する。HTML としては解釈しない） ----------
  const termRef = (g) => {
    const def = h('span', { class: 'tdef', hidden: true, text: `（${g.term}：${g.text}　— 手順 ${g.step + 1} で説明した言葉）` });
    const btn = h('button', { type: 'button', class: 'tref', 'aria-expanded': 'false', title: '押すと、この言葉の意味を出す', text: g.term });
    btn.addEventListener('click', () => { const open = def.hidden; def.hidden = !open; btn.setAttribute('aria-expanded', String(open)); S.renderId++; S.nat = null; });
    return h('span', null, btn, def);
  };
  const linkTerms = (text, ctx) => {
    if (!ctx) return document.createTextNode(text);
    const frag = document.createDocumentFragment();
    let last = 0;
    ctx.re.lastIndex = 0;
    let m;
    while ((m = ctx.re.exec(text))) {
      if (ctx.used.has(m[0])) continue;
      // 「数式バー」の「数式」のように、カタカナが続く長い語の一部なら付けない
      const before = text[m.index - 1] || '', after = text[m.index + m[0].length] || '';
      if (KATA.test(after) || (KATA.test(before) && KATA.test(m[0][0]))) continue;
      ctx.used.add(m[0]);
      frag.append(text.slice(last, m.index), termRef(ctx.map.get(m[0])));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  };
  const rich = (text, ctx) => {
    const frag = document.createDocumentFragment();
    String(text == null ? '' : text).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).forEach((part, k) => {
      if (!part) return;
      if (k % 2 === 1) {
        if (part.startsWith('**')) frag.append(h('strong', null, linkTerms(part.slice(2, -2), ctx)));
        else frag.append(h('code', { text: part.slice(1, -1) }));
      } else frag.append(linkTerms(part, ctx));
    });
    return frag;
  };

  // 冒頭の 1〜2 文（summary）には札を付けない。背景の色と太字で、最初に読む文だと分かるようにする
  const LABEL = { premise: '前提', term: '言葉の意味', example: '例', cause: 'なぜそうなるか', do: '操作と結果', note: '注意' };
  function renderBlocks(blocks, base) {
    const out = [];
    let group = null;
    const ctxFor = () => (base ? { re: base.re, map: base.map, used: new Set() } : null);
    blocks.forEach((b, idx) => {
      if (!b || typeof b !== 'object') return;
      if (b.type !== 'do') group = null;
      const c = ctxFor();
      const lbl = (t) => h('span', { class: 'lbl', text: t });
      switch (b.type) {
        case 'summary':
          out.push(h('div', { class: 'blk b-summary', id: idx === 0 ? 'g-sum' : null }, h('p', null, rich(b.text, c))));
          break;
        case 'premise':
          out.push(h('div', { class: 'blk b-premise' }, lbl(LABEL.premise), h('p', null, rich(b.text, c))));
          break;
        case 'term':
          out.push(h('div', { class: 'blk b-term' }, lbl(LABEL.term), h('dl', null, h('dt', { text: String(b.term || '') }), h('dd', null, rich(b.text, c)))));
          break;
        case 'example':
          out.push(h('div', { class: 'blk b-example' }, lbl(LABEL.example), h('p', null, rich(b.text, c))));
          break;
        case 'cause':
          out.push(h('div', { class: 'blk b-cause' }, lbl(LABEL.cause),
            b.title ? h('p', { class: 'ctitle' }, rich(b.title, c)) : null,
            h('ol', { class: 'chain' }, (Array.isArray(b.steps) ? b.steps : []).map((s) => h('li', null, rich(s, c))))));
          break;
        case 'do': {
          if (!group) { group = h('div', { class: 'blk b-do' }, lbl(LABEL.do)); out.push(group); }
          const no = group.querySelectorAll('.do-step').length + 1;
          group.append(h('div', { class: 'do-step' },
            h('span', { class: 'do-no', 'aria-hidden': 'true', text: String(no) }),
            h('p', { class: 'act' }, h('span', { class: 'who', text: 'あなた' }), rich(b.action, c)),
            b.result ? h('p', { class: 'res' }, h('span', { class: 'who', text: '結果' }), rich(b.result, c)) : null));
          break;
        }
        case 'note':
          out.push(h('div', { class: 'blk b-note' }, lbl(LABEL.note), h('p', null, rich(b.text, c))));
          break;
        default:
          out.push(h('div', { class: 'blk b-text' }, h('p', null, rich(b.text, c))));
      }
    });
    out.forEach((el) => { if (el.classList.contains('b-do')) { const st = el.querySelectorAll('.do-step'); if (st.length === 1) st[0].classList.add('single'); } });
    return out;
  }

  // ---------- 表示の中身を作る ----------
  function render() {
    S.renderId++; S.nat = null;
    hd.replaceChildren(); body.replaceChildren(); gran.replaceChildren(); ft.replaceChildren();
    root.classList.toggle('on-dark', hostIsDark());
    if (S.mode === 'welcome') renderWelcome();
    else if (S.mode === 'op') renderOp();
    else if (S.toc) renderToc();
    else renderStep();
    body.scrollTop = 0;
    if (!reduced()) { body.classList.remove('fresh'); void body.offsetWidth; body.classList.add('fresh'); }
  }

  function renderStep() {
    const st = STEPS[S.i];
    const lvN = st.levels.length;
    const lv = clamp(S.level[S.i] || 0, 0, lvN - 1);
    const L = st.levels[lv] || { blocks: [] };
    const chap = chapterOf(st);
    put(hd,
      h('div', { class: 'meta' },
        h('span', { text: `手順 ${S.i + 1} / ${N}` }),
        chap ? h('span', { class: 'chap', text: '・' + chap }) : null,
        h('span', { class: 'sp' }),
        lvN > 1 ? h('span', { class: 'lvl', text: `説明の細かさ ${lv + 1} / ${lvN}` }) : null,
        h('button', { type: 'button', class: 'btn lnk small', 'data-act': 'toc', onclick: () => { S.toc = true; render(); focusSoon('[data-act="toc-close"]'); } }, '目次')),
      h('h2', { class: 'ttl', id: 'g-ttl', tabindex: '-1', text: String(st.title || '') }),
      lv > 0 && L.added ? h('p', { class: 'added', text: 'この細かさで足した説明：' + L.added }) : null);
    if (S.notice) body.append(h('div', { class: 'missing', role: 'alert', text: S.notice }));
    if (S.missing) {
      body.append(h('div', { class: 'missing', role: 'note' },
        T('この手順で指す部分が、今の画面には見えていない。', 'この手順で指す部分が、今の画面には見えていません。'),
        st.missing ? rich(st.missing, null) : T('画面の幅や、開いているタブ・パネルによっては表示されない部分である。説明は、その部分が見えていなくても読める。', '画面の幅や、開いているタブ・パネルによっては表示されない部分です。説明は、その部分が見えていなくても読めます。')));
    }
    // 冒頭の 1〜2 文（summary）だけを最初に見せ、残りのまとまりは「詳細」を押すと開く（依頼者の指示）。
    // 読み手は、まず冒頭の文で、指した部分が何かをつかみ、知りたいときだけ、前提・例・理由・読み方や使い方を読む
    const blocks = Array.isArray(L.blocks) ? L.blocks : [];
    const els = renderBlocks(blocks, termCtx(S.i));
    const first = blocks[0] && blocks[0].type === 'summary' ? els.shift() : null;
    if (first) body.append(first);
    // 読み手が自分でページを操作する手順では、案内を開いたまま操作できることを、冒頭の文のすぐ下に書く
    if (st.interactive) body.append(h('p', { class: 'self-op', role: 'note', text: T('この手順では、吹き出しを開いたまま、ページを自分で操作できる。', 'この手順では、吹き出しを開いたまま、ページを自分で操作できます。') }));
    // 「分からない」の行（1段細かい説明に切り替えるボタン・前の細かさに戻るボタン・その説明）。
    // 依頼者の指示で、詳細の中の最後に置く。読み手は、冒頭の文と詳細を読んでも分からないときに押す
    const deepest = lv >= lvN - 1;
    const granItems = () => [
      h('button', { type: 'button', class: 'btn ask', 'data-act': 'deeper', onclick: deeper }, '分からない'),
      lv > 0 ? h('button', { type: 'button', class: 'btn small', 'data-act': 'shallower', onclick: shallower }, '前の細かさに戻る') : null,
      h('span', { class: 'hint', text: deepest
        ? T('最も細かい説明である。押すと、作った人に聞く質問文を作る。', '最も細かい説明です。押すと、作った人に聞く質問文を作ります。')
        : T('押すと、前提と途中の理由を足した説明になる。', '押すと、前提と途中の理由を足した説明になります。') })];
    if (els.length && first) {
      const open = !!S.expanded[S.i];
      const det = h('div', { class: 'details', id: 'g-det', hidden: !open }, ...els, h('div', { class: 'gran' }, granItems()));
      const btn = h('button', { type: 'button', class: 'more', 'data-act': 'details', 'aria-expanded': String(open), 'aria-controls': 'g-det' },
        h('span', { class: 'more-label', text: open ? '詳細を閉じる' : '詳細' }), h('span', { class: 'chev', 'aria-hidden': 'true' }));
      btn.addEventListener('click', () => toggleDetails(btn, det));
      body.append(btn, det);
    } else {
      if (els.length) body.append(...els);
      // 詳細が無い（冒頭の文のほかにまとまりが無い）ときは、「分からない」の行を吹き出しの下に出して、押せなくならないようにする
      put(gran, granItems());
    }
    if (S.handoff) body.append(renderHandoff(st, lv, lvN));
    const nextOps = LIVE && S.i < N - 1 ? (Array.isArray(STEPS[S.i + 1].actions) ? STEPS[S.i + 1].actions : []).filter((a) => a && a.say && a.do !== 'wait') : [];
    if (nextOps.length) {
      body.append(h('div', { class: 'op-next', role: 'note' },
        h('p', { class: 'op-next-lead', text: T('「次へ」を押すと、案内が次の操作を自動で行う。', '「次へ」を押すと、案内が次の操作を自動で行います。') }),
        h('ol', null, nextOps.map((a) => h('li', { text: String(a.say) })))));
    }
    put(ft,
      progress(),
      h('button', { type: 'button', class: 'btn lnk', 'data-act': 'skip', onclick: () => userClose() }, 'やめる'),
      h('button', { type: 'button', class: 'btn', 'data-act': 'prev', disabled: S.i === 0, onclick: prev }, '戻る'),
      h('button', { type: 'button', class: 'btn pri', 'data-act': 'next', onclick: next }, S.i === N - 1 ? '案内を終える' : '次へ'));
  }

  // ライブの案内で、これから自動で行う操作を見せる吹き出し（ボタンは置かない。操作が終わると、次の手順の吹き出しに変わる）
  function renderOp() {
    const o = S.op || { say: '', index: 0, total: 1, hasTarget: false };
    put(hd,
      h('div', { class: 'meta' },
        h('span', { class: 'op-badge', text: '自動で操作中' }),
        o.total > 1 ? h('span', { text: `操作 ${o.index + 1} / ${o.total}` }) : null),
      h('h2', { class: 'ttl', id: 'g-ttl', tabindex: '-1', text: o.say }));
    body.append(h('p', { class: 'op-lead', text: o.hasTarget
      ? T('案内が、橙の枠で囲んだ部分を、このあと自動で操作する。操作のあと、画面が変わることがある。', '案内が、橙の枠で囲んだ部分を、このあと自動で操作します。操作のあと、画面が変わることがあります。')
      : T('案内が、このあと自動で操作する。操作のあと、画面が変わることがある。', '案内が、このあと自動で操作します。操作のあと、画面が変わることがあります。') }));
  }

  function progress() {
    if (N <= 12) return h('div', { class: 'dots', 'aria-hidden': 'true' }, STEPS.map((_, k) => h('span', { class: k === S.i ? 'on' : null })));
    return h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round(((S.i + 1) / N) * 100)}%` }));
  }

  function renderToc() {
    hd.append(
      h('div', { class: 'meta' }, h('span', { text: '目次' }), h('span', { class: 'sp' }),
        h('button', { type: 'button', class: 'btn lnk small', 'data-act': 'toc-close', onclick: closeToc }, '説明に戻る')),
      h('h2', { class: 'ttl', id: 'g-ttl', tabindex: '-1', text: String(G.title || 'この案内') }));
    const list = h('ol', { class: 'toc-list' });
    let lastChap = null;
    STEPS.forEach((s, i) => {
      const c = chapterOf(s);
      if (c && c !== lastChap) { list.append(h('li', { class: 'toc-chap', text: c })); lastChap = c; }
      list.append(h('li', null, h('button', {
        type: 'button', class: 'toc-item' + (i === S.i ? ' cur' : ''), 'aria-current': i === S.i ? 'step' : null, 'data-i': i,
        onclick: () => {
          S.toc = false;
          if (LIVE) {
            if (i !== S.i && hostCall({ type: 'goto', to: i, from: S.i })) { render(); setBusy(T('その手順の画面へ移している。', 'その手順の画面へ移しています。')); } else render();
            return;
          }
          show(i);
        },
      }, h('span', { class: 'toc-no', text: String(i + 1) }), h('span', { text: String(s.title || '') }))));
    });
    body.append(h('p', { class: 'toc-h', text: T('手順の一覧（押すと、その手順へ移る）', '手順の一覧（押すと、その手順へ移ります）') }), list);
    if (GLOSS.length) {
      const dl = h('dl', { class: 'gloss' });
      GLOSS.forEach((g) => dl.append(h('dt', { text: g.term }), h('dd', null, rich(g.text, null), ' ', h('span', { class: 'from', text: `（手順 ${g.step + 1} で説明）` }))));
      body.append(h('p', { class: 'toc-h', text: `言葉の意味（${GLOSS.length} 語）` }), dl);
    }
    ft.append(h('span', { class: 'sp' }), h('button', { type: 'button', class: 'btn pri', 'data-act': 'toc-close', onclick: closeToc }, '説明に戻る'));
  }

  function renderWelcome() {
    const resume = Number.isInteger(S.resumeAt) ? S.resumeAt : null;
    hd.append(
      h('div', { class: 'meta' }, h('span', { text: 'このページの解説' })),
      h('h2', { class: 'ttl', id: 'g-ttl', tabindex: '-1', text: String(G.title || 'このページの解説') }));
    if (G.summary) body.append(h('div', { class: 'blk b-summary', id: 'g-sum' }, h('p', null, rich(G.summary, null))));
    if (G.reader) body.append(h('p', { class: 'wel-p', text: T(`この案内は、${G.reader}に向けて書いている。`, `この案内は、${G.reader}に向けて書いています。`) }));
    body.append(h('p', { class: 'wel-p', text: T(`案内は全部で ${N} 手順ある。ページの部分を1つずつ枠で囲んで指し、最初に、その部分が何で、何を示す（何をする）ものかを 1〜2 文で示す。前提・言葉の意味・例・理由・読み方や使い方は、「詳細」を押すと出る。それでも分からないときは、詳細の最後にある「分からない」を押すと、同じ手順を1段細かく説明し直す。`, `案内は全部で ${N} 手順あります。ページの部分を1つずつ枠で囲んで指し、最初に、その部分が何で、何を示す（何をする）ものかを 1〜2 文で示します。前提・言葉の意味・例・理由・読み方や使い方は、「詳細」を押すと出ます。それでも分からないときは、詳細の最後にある「分からない」を押すと、同じ手順を1段細かく説明し直します。`) }));
    const acts = h('div', { class: 'wel-actions' });
    if (resume != null) {
      acts.append(
        h('button', { type: 'button', class: 'btn pri', 'data-act': 'resume', onclick: () => show(resume) }, `続きから（手順 ${resume + 1}）`),
        h('button', { type: 'button', class: 'btn', 'data-act': 'restart', onclick: () => show(0) }, '最初から'));
    } else {
      acts.append(h('button', { type: 'button', class: 'btn pri', 'data-act': 'start', onclick: () => show(0) }, '案内を始める'));
    }
    acts.append(h('button', { type: 'button', class: 'btn lnk', 'data-act': 'later', onclick: () => userClose() }, 'あとで'));
    body.append(acts);
    if (LAUNCHER) body.append(h('p', { class: 'wel-note', text: T(`あとで開くときは、画面の${POS_WORD[LAUNCHER.position]}にある「${LAUNCHER.label || '解説'}」を押す。途中でやめても、次に開いたときに続きから読める。`, `あとで開くときは、画面の${POS_WORD[LAUNCHER.position]}にある「${LAUNCHER.label || '解説'}」を押してください。途中でやめても、次に開いたときに続きから読めます。`) }));
  }

  function questionText(st, lv, lvN) {
    let file = '';
    try { file = decodeURIComponent(location.pathname.split('/').pop() || ''); } catch (_) { file = location.pathname; }
    return [
      '【案内で分からない所】',
      `ページ: ${document.title || '（題名なし）'}（${file || location.href}）`,
      `案内: ${G.title || ''}（id: ${G.id || ''}）`,
      `手順: ${S.i + 1} / ${N}「${st.title || ''}」（id: ${st.id || ''}）`,
      `読んだ説明の細かさ: ${lv + 1} / ${lvN}（この手順で最も細かい説明）`,
      '分からない所:',
      T('（ここに、分からない言葉や文と、どこで迷ったかを書く）', '（ここに、分からない言葉や文と、どこで迷ったかを書いてください）'),
    ].join('\n');
  }

  function renderHandoff(st, lv, lvN) {
    const q = questionText(st, lv, lvN);
    const msg = h('p', { class: 'copied', 'aria-live': 'polite' });
    const ta = h('textarea', { readonly: true, rows: '7', 'aria-label': '質問文' });
    ta.value = q;
    return h('div', { class: 'handoff', 'data-part': 'handoff' },
      h('p', { text: T(`この手順に用意した説明は、ここまで（細かさ ${lv + 1} / ${lvN}）である。`, `この手順に用意した説明は、ここまで（細かさ ${lv + 1} / ${lvN}）です。`) }),
      h('p', { text: T('「質問文をコピー」を押すと、どの手順のどの細かさで止まったかを書いた質問文をコピーできる。Claude Code（またはこのページを作った人）に貼り、「分からない所:」の下に、分からない言葉や文を書き足して送ると、この手順に、もう1段細かい説明を足してもらえる。', '「質問文をコピー」を押すと、どの手順のどの細かさで止まったかを書いた質問文をコピーできます。Claude Code（またはこのページを作った人）に貼り、「分からない所:」の下に、分からない言葉や文を書き足して送ると、この手順に、もう1段細かい説明を足してもらえます。') }),
      h('button', {
        type: 'button', class: 'btn pri', 'data-act': 'copy',
        onclick: async () => { const ok = await copyText(q, ta); msg.textContent = ok ? T('コピーした。貼り付けて、「分からない所:」の下に書き足して送る。', 'コピーしました。貼り付けて、「分からない所:」の下に書き足して送ってください。') : T('コピーできなかった。下の欄の文字を選んでコピーする。', 'コピーできませんでした。下の欄の文字を選んでコピーしてください。'); },
      }, '質問文をコピー'),
      msg, ta);
  }

  async function copyText(t, ta) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch (_) { /* 次の方法を試す */ }
    try { ta.focus(); ta.select(); return !!document.execCommand('copy'); } catch (_) { return false; }
  }

  // ---------- 操作 ----------
  // ライブの案内では、操作と画面の移動を受け持つ側（live-tour.mjs）に伝える。伝えられなければ、この画面の中だけで動く
  function hostCall(msg) {
    try {
      const f = window.__pageExplainerHost;
      if (typeof f === 'function') { const r = f(msg); if (r && r.catch) r.catch(() => {}); return true; }
    } catch (e) { console.warn('[page-explainer] 操作を受け持つ側に伝えられない。', e); }
    return false;
  }
  // 受け持つ側が次の画面を出すまでの間、吹き出しのボタンを押せなくし、操作中であることを示す
  function setBusy(text) {
    card.classList.add('busy');
    for (const b of card.querySelectorAll('button')) b.disabled = true;
    const nb = card.querySelector('[data-act="next"]');
    if (nb) nb.textContent = '操作中…';
    live.textContent = text;
  }
  const next = () => {
    if (LIVE && hostCall({ type: S.i >= N - 1 ? 'end' : 'next', from: S.i })) {
      if (S.i >= N - 1) closeTour(); else setBusy(T('次の手順へ進めている。必要な操作を自動で行う。', '次の手順へ進めています。必要な操作を自動で行います。'));
      return;
    }
    if (S.i >= N - 1) { save('last', null); closeTour(); } else show(S.i + 1);
  };
  const prev = () => {
    if (S.i <= 0) return;
    if (LIVE && hostCall({ type: 'goto', to: S.i - 1, from: S.i })) { setBusy(T('前の手順の画面に戻している。', '前の手順の画面に戻しています。')); return; }
    show(S.i - 1);
  };
  // 読み手が案内を閉じたとき（やめる・Esc・あとで）。ライブの案内では、受け持つ側にも伝える
  const userClose = () => { if (LIVE) hostCall({ type: 'close', at: S.i }); closeTour(); };
  const closeToc = () => { S.toc = false; render(); focusSoon('[data-act="toc"]'); };
  function toggleDetails(btn, det) {
    const open = det.hidden;
    det.hidden = !open;
    S.expanded[S.i] = open;
    btn.setAttribute('aria-expanded', String(open));
    btn.querySelector('.more-label').textContent = open ? '詳細を閉じる' : '詳細';
    S.renderId++; S.nat = null;
    live.textContent = open ? T('詳細を開いた。', '詳細を開きました。') : T('詳細を閉じた。', '詳細を閉じました。');
  }
  // 「分からない」は、読み手がもっと説明を求めたときに押すので、1段細かい説明を、詳細を開いた状態で出す
  function deeper() {
    const lvN = STEPS[S.i].levels.length;
    S.expanded[S.i] = true;
    if ((S.level[S.i] || 0) < lvN - 1) {
      S.level[S.i] = (S.level[S.i] || 0) + 1; S.handoff = false;
      render();
      live.textContent = T(`説明の細かさを ${S.level[S.i] + 1} / ${lvN} にした。`, `説明の細かさを ${S.level[S.i] + 1} / ${lvN} にしました。`);
      focusSoon('[data-act="deeper"]');
    } else {
      S.handoff = true;
      render();
      requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; focusSoon('[data-act="copy"]'); });
    }
  }
  function shallower() {
    if ((S.level[S.i] || 0) > 0) {
      S.level[S.i]--; S.handoff = false;
      render();
      live.textContent = T(`説明の細かさを ${S.level[S.i] + 1} / ${STEPS[S.i].levels.length} にした。`, `説明の細かさを ${S.level[S.i] + 1} / ${STEPS[S.i].levels.length} にしました。`);
      focusSoon(S.level[S.i] > 0 ? '[data-act="shallower"]' : '[data-act="deeper"]');
    }
  }
  const focusSoon = (sel) => requestAnimationFrame(() => { const el = card.querySelector(sel); if (el && !el.disabled) el.focus({ preventScroll: true }); });
  card.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-act]'); if (b) S.lastAct = b.getAttribute('data-act'); });

  // ---------- 指す部品を探す ----------
  function findAll(t) {
    if (t == null) return [];
    try {
      if (typeof t === 'string') return Array.from(document.querySelectorAll(t)).filter((el) => el !== host);
      if (typeof t === 'object') {
        let list = Array.from(document.querySelectorAll(t.selector || '*')).filter((el) => el !== host);
        if (t.text) {
          const want = norm(t.text);
          const has = (el) => [el.textContent, el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('title'), el.value].some((x) => typeof x === 'string' && norm(x).includes(want));
          list = list.filter(has);
          list = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
        }
        if (Number.isInteger(t.nth)) list = list[t.nth] ? [list[t.nth]] : [];
        return list;
      }
    } catch (e) { console.warn('[page-explainer] 部品の指定（セレクター）が正しくない:', t, e); }
    return [];
  }
  function clipAncestors(els) {
    const out = [];
    for (const el of els) {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        if (out.includes(p)) continue;
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push(p);
      }
    }
    return out;
  }
  // 部品の見えている部分の四角（入れ物の外に出ている部分を切り落とす）
  function visibleRect(el, clips) {
    const r = el.getBoundingClientRect();
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (const p of clips) {
      if (!p.contains(el)) continue;
      const pr = p.getBoundingClientRect();
      const cl = pr.left + p.clientLeft, ct = pr.top + p.clientTop;
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible') { x1 = Math.max(x1, cl); x2 = Math.min(x2, cl + (p.clientWidth || pr.width)); }
      if (cs.overflowY !== 'visible') { y1 = Math.max(y1, ct); y2 = Math.min(y2, ct + (p.clientHeight || pr.height)); }
    }
    if (x2 - x1 < 1 || y2 - y1 < 1) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // 高さか幅が 0 の入れ物（たたんだパネル）の中にある部品は、見えていないとみなす
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        if (pr.width < 2 || pr.height < 2) return false;
      }
    }
    return true;
  }
  function resolveTargets(st) {
    const vis = findAll(st.target).filter(isVisible);
    return st.targetAll ? vis : vis.slice(0, 1);
  }
  // 指す部品（複数なら全部を囲む四角）。画面の外にあっても返す
  function targetRect() {
    let u = null;
    for (const el of S.targets) {
      if (!el.isConnected) continue;
      const r = visibleRect(el, S.clips);
      if (!r) continue;
      if (!u) u = { ...r };
      else { const x2 = Math.max(u.x + u.w, r.x + r.w), y2 = Math.max(u.y + u.h, r.y + r.h); u.x = Math.min(u.x, r.x); u.y = Math.min(u.y, r.y); u.w = x2 - u.x; u.h = y2 - u.y; }
    }
    return u;
  }
  const onScreen = (r, v) => !!r && !(r.x + r.w < 0 || r.y + r.h < 0 || r.x > v.w || r.y > v.h);
  // 部品と吹き出しの両方が画面に入るように、ページを送る。
  // 部品が見えていて、周りに吹き出しの場所があれば送らない。場所が無ければ、部品を画面の上の方へ送り、下に吹き出しの場所を空ける
  // （横に吹き出しを置けるときは、部品を縦の中央に送る）。
  function scrollToTarget() {
    const el = S.targets[0];
    if (!el) return;
    const v = vp();
    // 判定には、入れ物で切り取る前の位置を使う（入れ物の中で画面の外へ送られている部品も、送れば見える）
    let r = null;
    for (const t of S.targets) {
      const b = t.getBoundingClientRect();
      if (!r) r = { x: b.left, y: b.top, w: b.width, h: b.height };
      else { const x2 = Math.max(r.x + r.w, b.right), y2 = Math.max(r.y + r.h, b.bottom); r.x = Math.min(r.x, b.left); r.y = Math.min(r.y, b.top); r.w = x2 - r.x; r.h = y2 - r.y; }
    }
    r = toView(r, v);
    const vis = toView(targetRect(), v);
    const sheet = v.w < SHEET_W;
    const nat = naturalHeight(v.h);
    const need = Math.min(nat, S.chrome + MIN_BODY);
    const w = sheet ? v.w - 16 : balloon.offsetWidth;
    const unclipped = !!vis && vis.w >= r.w - 2 && vis.h >= r.h - 2;
    const inView = unclipped && r.y >= 8 && r.y + r.h <= v.h - 8 && r.x >= -1 && r.x + r.w <= v.w + 1;
    const sideRoom = !sheet && ((v.w - (r.x + r.w) - GAP - M >= w) || (r.x - GAP - M >= w));
    const room = sheet
      ? (v.h - (r.y + r.h) - 24 >= need || r.y - 24 >= need)
      : ((v.h - (r.y + r.h) - GAP - M >= need) || (r.y - GAP - M >= need) || sideRoom);
    if (inView && room) return;
    const block = sideRoom && r.h < v.h * 0.8 ? 'center' : 'start';
    // 部品の上に少し余白を空けるため、送る瞬間だけ scroll-margin-top を付け、すぐ元に戻す（送り先は呼んだ時点で決まる）
    const hadStyle = el.hasAttribute('style');
    const prevMargin = el.style.scrollMarginTop;
    if (block === 'start') el.style.scrollMarginTop = '20px';
    try { el.scrollIntoView({ block, inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { el.scrollIntoView(); }
    if (block === 'start') { el.style.scrollMarginTop = prevMargin; if (!hadStyle && !el.getAttribute('style')) el.removeAttribute('style'); }
  }
  const waitFor = (fn, ms) => new Promise((res) => {
    const t0 = performance.now();
    const loop = () => { let ok = false; try { ok = fn(); } catch (_) { ok = false; } if (ok || performance.now() - t0 > ms) res(ok); else requestAnimationFrame(loop); };
    loop();
  });

  // ---------- 手順を出す ----------
  // expanded を渡したときだけ、その手順の詳細の開閉を決める（渡さなければ、前に開いたかどうかを覚えたまま出す）
  async function show(i, level, expanded) {
    i = clamp(Number.isInteger(i) ? i : 0, 0, N - 1);
    const from = S.open && S.hole ? { ...S.hole } : null;
    S.mode = 'tour'; S.toc = false; S.handoff = false; S.notice = null;
    if (Number.isInteger(level)) S.level[i] = clamp(level, 0, STEPS[i].levels.length - 1);
    if (typeof expanded === 'boolean') S.expanded[i] = expanded;
    S.i = i;
    save('last', i);
    root.classList.remove('operating');
    if (!S.open || !dlg.open) openDialog();
    ensureModality();
    const token = ++S.token;
    S.settled = false; S.stable = 0; S.lastKey = '';
    const st = STEPS[i];
    // 部品が隠れているときだけ、見えるようにするための部品（タブ・開閉のボタン）を順に押す
    if (Array.isArray(st.reveal) && st.reveal.length && resolveTargets(st).length === 0) {
      for (const a of st.reveal) {
        if (resolveTargets(st).length) break;
        const el = a && a.click != null ? findAll(a.click).find(isVisible) : null;
        if (!el) { console.warn('[page-explainer] 部品を見せるために押す部品が見つからない:', a && a.click); continue; }
        try { el.click(); } catch (e) { console.warn('[page-explainer] 部品を見せるための操作で失敗した。', e); }
        await waitFor(() => resolveTargets(st).length > 0, 700);
        if (token !== S.token) return;
      }
      reshow();
    }
    if (token !== S.token) return;
    S.settled = false; S.stable = 0; S.lastKey = '';
    S.targets = resolveTargets(st);
    S.clips = clipAncestors(S.targets);
    S.missing = st.target != null && S.targets.length === 0;
    render();
    scrollToTarget();
    S.tween = from && !reduced() ? { from, t0: performance.now(), dur: 280 } : null;
    S.side = null;
    balloon.classList.add('moving');
    clearTimeout(S.mt); S.mt = setTimeout(() => balloon.classList.remove('moving'), 340);
    const keep = (S.lastAct === 'prev' || S.lastAct === 'next') ? S.lastAct : 'next';
    S.lastAct = null;
    focusSoon(`[data-act="${keep}"]:not([disabled]), [data-act="next"]`);
    const sum = (st.levels[S.level[i] || 0].blocks || []).find((b) => b && b.type === 'summary');
    live.textContent = `手順 ${i + 1} / ${N}：${st.title || ''}。${sum ? norm(sum.text).replace(/\*\*|`/g, '') : ''}`;
  }

  function openTour(i) { show(Number.isInteger(i) && i >= 0 ? i : 0); }
  function openWelcome(resumeAt) {
    S.mode = 'welcome'; S.resumeAt = Number.isInteger(resumeAt) ? resumeAt : null; S.toc = false; S.handoff = false;
    S.targets = []; S.clips = []; S.missing = false;
    if (!S.open || !dlg.open) openDialog();
    S.settled = false; S.stable = 0; S.lastKey = '';
    render();
    focusSoon('.btn.pri');
    live.textContent = String(G.title || '');
  }
  // 読み手が自分でページを操作する手順（interactive）では、暗幕を出さず、ページを操作できるまま吹き出しを出す。
  // ライブの案内で自動の操作を見せている間（op）は、暗幕を出したまま、案内の層がクリックを受け取らないようにする
  // （Playwright のクリックや入力が、照らしている部分にそのまま届くように）
  const isInteractive = () => S.mode === 'tour' && !!(STEPS[S.i] && STEPS[S.i].interactive);
  const nonModal = () => S.mode === 'op' || isInteractive();
  const syncLayer = () => { root.classList.toggle('interactive', isInteractive()); root.classList.toggle('op', S.mode === 'op'); };
  function ensureModality() {
    const modal = !nonModal();
    syncLayer();
    if (dlg.open && S.modal !== modal) { try { dlg.close(); if (modal) dlg.showModal(); else dlg.show(); } catch (_) { /* そのまま */ } }
    S.modal = modal;
  }
  function openDialog() {
    S.prevFocus = deepActive();
    root.classList.add('is-open');
    const modal = !nonModal();
    syncLayer();
    S.modal = modal;
    if (!dlg.open) { try { if (modal) dlg.showModal(); else dlg.show(); } catch (_) { dlg.setAttribute('open', ''); } }
    S.open = true; S.hole = null; S.tween = null; S.placed = false;
    if (!S.raf) S.raf = requestAnimationFrame(tick);
  }
  // ページが自分のダイアログを開いたときも、案内を最前面に戻す（最前面の層は、後から開いたものが上に来る）
  function reshow() { if (!dlg.open) return; try { dlg.close(); if (S.modal) dlg.showModal(); else dlg.show(); } catch (_) { /* そのまま */ } }
  // 閉じたことの後始末は、その場で行う（close イベントは後から届くので、その間に開き直すと状態が食い違う）
  function closeTour() { if (dlg.open) dlg.close(); onClosed(); }
  dlg.addEventListener('close', () => { if (!dlg.open) onClosed(); });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); userClose(); });
  function onClosed() {
    if (!S.open) return;
    S.open = false;
    root.classList.remove('is-open');
    cancelAnimationFrame(S.raf); S.raf = 0;
    S.tween = null; S.hole = null; S.side = null;
    S.waiters.splice(0).forEach((f) => f());
    const f = S.prevFocus; S.prevFocus = null;
    if (f && f.isConnected && f !== document.body && typeof f.focus === 'function') { try { f.focus({ preventScroll: true }); } catch (_) { /* 戻せなくてもよい */ } }
    else if (launcher) launcher.focus({ preventScroll: true });
  }

  // 案内の外（暗幕）を押したときは閉じずに、吹き出しを小さく揺らして、案内が開いていることを示す
  const pulse = () => { if (reduced()) return; card.classList.remove('pulse'); void card.offsetWidth; card.classList.add('pulse'); };
  svg.addEventListener('click', pulse);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) pulse(); });

  // キー操作：→ 次へ、← 戻る、Esc 閉じる。案内の中で押したキーは、ページの近道へ届けない
  const onKey = (e) => {
    if (!S.open) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(host)) return;
    e.stopImmediatePropagation();
    if (e.type !== 'keydown' || e.isComposing) return;
    const tag = path[0] && path[0].tagName;
    if (tag === 'TEXTAREA') { if (e.key === 'Escape') { e.preventDefault(); userClose(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); userClose(); }
    else if (S.mode === 'tour' && !S.toc && e.key === 'ArrowRight' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); S.lastAct = 'next'; next(); }
    else if (S.mode === 'tour' && !S.toc && e.key === 'ArrowLeft' && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); S.lastAct = 'prev'; prev(); }
  };
  for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, onKey, true);
  addEventListener('resize', () => { S.nat = null; }, { passive: true });
  // 案内を開くボタンを、見えている範囲の隅に置く（描画の枠の隅に置くと、狭い画面では見えない所に出ることがある）
  let launcherRaf = 0;
  function placeLauncher() {
    launcherRaf = 0;
    if (!launcher) return;
    const v = vp(), m = 16, lw = launcher.offsetWidth, lh = launcher.offsetHeight;
    const pos = LAUNCHER.position;
    const x = pos.endsWith('left') ? v.x + m : v.x + v.w - lw - m;
    const y = pos.startsWith('top') ? v.y + m : v.y + v.h - lh - m;
    const tf = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (launcher.style.transform !== tf) launcher.style.transform = tf;
  }
  const queueLauncher = () => { if (!launcherRaf) launcherRaf = requestAnimationFrame(placeLauncher); };
  if (launcher) {
    launcher.style.left = '0'; launcher.style.top = '0'; launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
    placeLauncher();
    addEventListener('resize', queueLauncher, { passive: true });
    addEventListener('load', queueLauncher);
    if (window.visualViewport) { visualViewport.addEventListener('resize', queueLauncher, { passive: true }); visualViewport.addEventListener('scroll', queueLauncher, { passive: true }); }
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueLauncher); } catch (_) { /* なくてよい */ }
  }
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { S.nat = null; }); } catch (_) { /* なくてよい */ }

  // ---------- 置き場所の計算（毎コマ。部品が動いても、暗幕の穴と吹き出しが付いていく） ----------
  // M: 画面の端との間、GAP: 部品と吹き出しの間、PAD: 暗幕の穴を部品より広げる幅、SHEET_W: これより狭い画面では下（か上）に敷く、
  // MIN_BODY: 吹き出しを部品の横に置くとき、本文に最低限見せる高さ（これより低くなる場所には置かない）
  const M = 12, GAP = 14, PAD = 6, RADIUS = 8, SHEET_W = 600, MIN_BODY = 150;
  function tick() {
    S.raf = 0;
    if (!S.open) return;
    try { frame(); } catch (e) { console.warn('[page-explainer] 位置の計算で失敗した。', e); }
    S.raf = requestAnimationFrame(tick);
  }
  function frame() {
    const v = vp();
    if (++S.frames % 30 === 0) root.classList.toggle('on-dark', hostIsDark());
    const raw = (S.mode === 'tour' || S.mode === 'op') && !S.missing ? toView(targetRect(), v) : null;
    const tr = onScreen(raw, v) ? raw : null;
    S.tr = tr;
    const live2 = raw ? { x: raw.x - PAD, y: raw.y - PAD, w: raw.w + PAD * 2, h: raw.h + PAD * 2 } : { x: v.w / 2, y: v.h / 2, w: 0, h: 0 };
    let hole = live2;
    if (S.tween) {
      const t = clamp((performance.now() - S.tween.t0) / S.tween.dur, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const f = S.tween.from;
      hole = { x: f.x + (live2.x - f.x) * e, y: f.y + (live2.y - f.y) * e, w: f.w + (live2.w - f.w) * e, h: f.h + (live2.h - f.h) * e };
      if (t >= 1) S.tween = null;
    }
    S.hole = hole;
    drawDim(v, hole, !!tr);
    // 部品へ移る途中で部品がまだ画面の外にある間は、吹き出しを前の位置に留める（中央へ跳ばない）。
    // 動きが止まっても部品が画面の外にあるときは、中央に出す
    if (!(raw && !tr && !S.settled && S.placed)) { placeBalloon(v, tr); S.placed = true; }
    const key = tr ? `${Math.round(tr.x)},${Math.round(tr.y)},${Math.round(tr.w)},${Math.round(tr.h)}` : 'none';
    if (key === S.lastKey && !S.tween && !balloon.classList.contains('moving')) {
      if (++S.stable >= 5 && !S.settled) { S.settled = true; S.waiters.splice(0).forEach((f) => f()); }
    } else { S.stable = 0; S.lastKey = key; }
  }
  function drawDim(v, r, hasTarget) {
    const shift = `translate(${num(v.x)} ${num(v.y)})`;
    dimPath.setAttribute('transform', shift); ring.setAttribute('transform', shift);
    let d = 'M-100000 -100000H100000V100000H-100000Z';
    if (r.w > 0.5 && r.h > 0.5) {
      const k = Math.min(RADIUS, r.w / 2, r.h / 2);
      const x = r.x, y = r.y, w = r.w, hh = r.h;
      d += `M${num(x + k)} ${num(y)}H${num(x + w - k)}A${num(k)} ${num(k)} 0 0 1 ${num(x + w)} ${num(y + k)}V${num(y + hh - k)}A${num(k)} ${num(k)} 0 0 1 ${num(x + w - k)} ${num(y + hh)}H${num(x + k)}A${num(k)} ${num(k)} 0 0 1 ${num(x)} ${num(y + hh - k)}V${num(y + k)}A${num(k)} ${num(k)} 0 0 1 ${num(x + k)} ${num(y)}Z`;
    }
    dimPath.setAttribute('d', d);
    ring.setAttribute('x', num(r.x)); ring.setAttribute('y', num(r.y));
    ring.setAttribute('width', num(Math.max(0, r.w))); ring.setAttribute('height', num(Math.max(0, r.h)));
    ring.style.opacity = hasTarget ? '1' : '0';
  }
  // 吹き出しの自然な高さ（本文を送らずに全部見せたときの高さ）と、本文以外（見出し・下の帯など）の高さ
  function naturalHeight(vh) {
    const key = S.renderId + ':' + balloon.offsetWidth + ':' + vh;
    if (S.nat && S.nat.key === key) return S.nat.h;
    const prev = balloon.style.maxHeight;
    balloon.style.maxHeight = 'none';
    const hNat = balloon.offsetHeight;
    S.chrome = Math.max(0, hNat - body.offsetHeight);
    balloon.style.maxHeight = prev;
    S.nat = { key, h: hNat };
    return hNat;
  }
  function setMaxH(px) {
    // 切り捨てると、内容が端数だけはみ出して本文にスクロールバーが出ることがあるので、切り上げる
    const s = Math.max(120, Math.ceil(px)) + 'px';
    if (balloon.style.maxHeight !== s) balloon.style.maxHeight = s;
  }
  function placeBalloon(v, tr) {
    const sheet = v.w < SHEET_W;
    balloon.classList.toggle('sheet', sheet);
    let x, y, side = null, mode;
    S.forced = false;
    if (sheet) {
      const w = v.w - 16;
      if (balloon.style.width !== w + 'px') { balloon.style.width = w + 'px'; S.nat = null; }
      const nat = naturalHeight(v.h);
      // 部品を隠さない範囲で、画面の高さの 8 割まで使う（本文の見える高さを確保する）
      let maxH = Math.min(nat, Math.round(v.h * 0.8));
      mode = 'sheet-bottom';
      if (tr) {
        // 部品の下（か上）の空きに収まるように、敷く高さを縮める。どちらにも収まらない大きな部品なら、重ねる
        const need = Math.min(maxH, S.chrome + MIN_BODY);
        const below = v.h - (tr.y + tr.h) - GAP - 8, above = tr.y - GAP - 8;
        if (below >= need) maxH = Math.min(maxH, below);
        else if (above >= need) { maxH = Math.min(maxH, above); mode = 'sheet-top'; }
        else S.forced = true;
      }
      setMaxH(maxH);
      const bh = balloon.offsetHeight;
      x = 8; y = mode === 'sheet-top' ? 8 : v.h - bh - 8;
    } else {
      if (balloon.style.width) { balloon.style.width = ''; S.nat = null; }
      const w = balloon.offsetWidth;
      const nat = Math.min(naturalHeight(v.h), v.h - M * 2);
      if (!tr) {
        setMaxH(v.h - M * 2);
        const bh = balloon.offsetHeight;
        x = (v.w - w) / 2; y = Math.max(M, (v.h - bh) / 2); mode = 'center';
      } else {
        const space = { below: v.h - (tr.y + tr.h) - GAP - M, above: tr.y - GAP - M, right: v.w - (tr.x + tr.w) - GAP - M, left: tr.x - GAP - M };
        const need = Math.min(nat, S.chrome + MIN_BODY);
        const fits = (d, full) => (d === 'below' || d === 'above') ? space[d] >= (full ? nat : need) : space[d] >= w;
        const stp = S.mode === 'tour' ? STEPS[S.i].placement : null;
        const pref = stp && stp !== 'auto' ? [stp] : [];
        const order = pref.concat(['below', 'above', 'right', 'left']).filter((d, k, a) => a.indexOf(d) === k);
        let d = S.sideStep === S.i && S.side && S.side !== 'over' && fits(S.side, false) ? S.side : null;
        if (!d) d = order.find((o) => fits(o, true)) || order.find((o) => fits(o, false)) || 'over';
        S.side = d; S.sideStep = S.i;
        if (d === 'below' || d === 'above') {
          setMaxH(Math.min(nat, space[d]));
          const bh = balloon.offsetHeight;
          x = clamp(tr.x + tr.w / 2 - w / 2, M, v.w - w - M);
          y = d === 'below' ? tr.y + tr.h + GAP : tr.y - GAP - bh;
          side = d === 'below' ? 'top' : 'bottom';
          placeArrow(side, tr.x + tr.w / 2 - x, 0, w, bh, tr, x, y);
        } else if (d === 'right' || d === 'left') {
          setMaxH(v.h - M * 2);
          const bh = balloon.offsetHeight;
          y = clamp(tr.y + tr.h / 2 - bh / 2, M, v.h - bh - M);
          x = d === 'right' ? tr.x + tr.w + GAP : tr.x - GAP - w;
          side = d === 'right' ? 'left' : 'right';
          placeArrow(side, 0, tr.y + tr.h / 2 - y, w, bh, tr, x, y);
        } else {
          // 部品の周りのどこにも置けない（部品が大きい）。部品の中心から遠い隅に重ねて置く
          S.forced = true;
          setMaxH(Math.min(nat, Math.round(v.h * 0.6)));
          const bh = balloon.offsetHeight;
          const cx = tr.x + tr.w / 2, cy = tr.y + tr.h / 2;
          x = cx < v.w / 2 ? v.w - w - M : M;
          y = cy < v.h / 2 ? v.h - bh - M : M;
        }
        mode = d;
      }
    }
    if (!side) arrow.hidden = true;
    S.placeMode = mode;
    const tf = `translate(${Math.round(x + v.x)}px, ${Math.round(y + v.y)}px)`;
    if (balloon.style.transform !== tf) balloon.style.transform = tf;
  }
  function placeArrow(side, ax, ay, w, bh, tr, x, y) {
    const A = 7;
    if (side === 'top' || side === 'bottom') {
      const px = clamp(ax, 18, w - 18);
      const abs = x + px;
      if (abs < tr.x - 2 || abs > tr.x + tr.w + 2) { arrow.hidden = true; return; }
      arrow.style.left = (px - A) + 'px';
      arrow.style.top = (side === 'top' ? -A : bh - A) + 'px';
    } else {
      const py = clamp(ay, 18, bh - 18);
      const abs = y + py;
      if (abs < tr.y - 2 || abs > tr.y + tr.h + 2) { arrow.hidden = true; return; }
      arrow.style.top = (py - A) + 'px';
      arrow.style.left = (side === 'left' ? -A : w - A) + 'px';
    }
    arrow.hidden = false;
  }

  function hostIsDark() {
    const lum = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el).backgroundColor || '';
      const m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
      if (!m) return null;
      const a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      if (a < 0.5) return null;
      const f = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
    };
    let L = lum(document.body);
    if (L == null) L = lum(document.documentElement);
    if (L == null) {
      const cs = getComputedStyle(document.documentElement).colorScheme || '';
      if (!/dark/.test(cs)) return false;
      if (!/light/.test(cs)) return true;
      try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return false; }
    }
    return L < 0.2;
  }

  // ---------- 確かめるための窓口（scripts/check-guide.mjs が使う） ----------
  const waitSettled = (ms) => new Promise((res) => {
    if (S.settled) { res(true); return; }
    const f = () => { clearTimeout(t); res(S.settled); };
    const t = setTimeout(() => { const k = S.waiters.indexOf(f); if (k >= 0) S.waiters.splice(k, 1); res(false); }, ms);
    S.waiters.push(f);
  });
  const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  function layoutInfo() {
    const v = vp();
    const st = STEPS[S.i];
    const all = st.target == null ? [] : findAll(st.target);
    const b0 = balloon.getBoundingClientRect();
    const b = { left: b0.left - v.x, top: b0.top - v.y, right: b0.right - v.x, bottom: b0.bottom - v.y, width: b0.width, height: b0.height };
    const lr = launcher ? launcher.getBoundingClientRect() : null;
    const tr = S.tr;
    const R = (r) => r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w != null ? r.w : r.width), h: Math.round(r.h != null ? r.h : r.height) } : null;
    const ov = tr ? Math.max(0, Math.min(b.right, tr.x + tr.w) - Math.max(b.left, tr.x)) * Math.max(0, Math.min(b.bottom, tr.y + tr.h) - Math.max(b.top, tr.y)) : 0;
    return {
      step: S.i, id: st.id, title: st.title, level: S.level[S.i] || 0, levels: st.levels.length, mode: S.mode === 'tour' ? S.placeMode : S.mode,
      viewport: v,
      target: { expected: st.target != null, count: all.length, visible: !!tr, rect: R(tr), area: tr ? Math.round(tr.w * tr.h) : 0 },
      balloon: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
      arrow: !arrow.hidden, overlap: Math.round(ov), forced: !!S.forced,
      overflowX: Math.max(card.scrollWidth - card.clientWidth, body.scrollWidth - body.clientWidth) > 1,
      body: { client: body.clientHeight, scroll: body.scrollHeight },
      settled: S.settled, missing: S.missing, handoff: S.handoff,
      launcher: lr ? { x: Math.round(lr.left - v.x), y: Math.round(lr.top - v.y), w: Math.round(lr.width), h: Math.round(lr.height) } : null,
      expanded: !!S.expanded[S.i], detailsHidden: (() => { const d = body.querySelector('#g-det'); return d ? d.hidden : null; })(),
      // 「分からない」のボタンが描かれているか（詳細を閉じていれば、詳細の中にあるので描かれない）
      deeperVisible: (() => { const b = card.querySelector('[data-act="deeper"]'); if (!b) return null; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })(),
    };
  }

  // ---------- ライブの案内：これから自動で行う操作を見せる ----------
  // 解説の手順と同じ暗幕と枠で、操作する部分を照らし、その横の吹き出しに操作の中身（例：「検索」を押す）を出す。
  // 暗幕は閉じずに、照らす所を、前に指していた部分から操作する部分へ動かす。読み手が、急に画面が変わって驚かないようにするためである。
  // 暗幕・枠・吹き出しはクリックを受け取らないので、Playwright のクリックや入力は、照らしている部分にそのまま届く
  async function operate(a) {
    const from = S.open && S.hole ? { ...S.hole } : null;
    const el = a && a.target != null ? (findAll(a.target).find(isVisible) || null) : null;
    S.mode = 'op'; S.toc = false; S.handoff = false; S.notice = null;
    S.op = {
      say: String((a && a.say) || T('操作している', '操作しています')),
      index: Number.isInteger(a && a.index) ? a.index : 0,
      total: Number.isInteger(a && a.total) ? a.total : 1,
      hasTarget: !!el,
    };
    root.classList.remove('operating');
    if (!S.open || !dlg.open) openDialog();
    ensureModality();
    const token = ++S.token;
    S.settled = false; S.stable = 0; S.lastKey = '';
    S.targets = el ? [el] : [];
    S.clips = clipAncestors(S.targets);
    S.missing = false;
    render();
    scrollToTarget();
    S.tween = from && !reduced() ? { from, t0: performance.now(), dur: 320 } : null;
    S.side = null;
    balloon.classList.add('moving');
    clearTimeout(S.mt); S.mt = setTimeout(() => balloon.classList.remove('moving'), 380);
    live.textContent = '自動で操作する：' + S.op.say;
    await waitSettled(3000);
    if (token === S.token) await twoFrames();
    return { found: !!el };
  }
  // 確かめる道具や、見せずに操作をやり直すときは、案内の層を閉じ、隅のボタンも隠す
  // （操作する部品へのクリックを、モーダルの案内の層やボタンがさえぎらないように）
  function hide() { closeTour(); root.classList.add('operating'); }
  // 自動の操作を見せる表示をやめる（吹き出しを閉じる）
  function idle() { if (S.mode === 'op') closeTour(); root.classList.remove('operating'); }

  window.pageExplainer = Object.freeze({
    version: 1,
    open: (step) => { const i = typeof step === 'string' ? STEPS.findIndex((s) => s.id === step) : step; openTour(Number.isInteger(i) && i >= 0 ? i : 0); },
    close: () => closeTour(),
    next: () => { if (S.open && S.mode === 'tour') next(); },
    prev: () => { if (S.open && S.mode === 'tour') prev(); },
    get state() { return { open: S.open, mode: S.mode, step: S.i, level: S.level[S.i] || 0, expanded: !!S.expanded[S.i], toc: S.toc, handoff: S.handoff }; },
    __test: Object.freeze({
      root: sr,
      meta: () => ({ id: G.id, title: G.title, start: G.start || 'welcome', launcher: !!LAUNCHER, steps: STEPS.map((s) => ({ id: s.id, title: s.title, levels: s.levels.length, target: s.target == null ? null : s.target, targetAll: !!s.targetAll, missing: !!s.missing, reveal: Array.isArray(s.reveal) && s.reveal.length > 0 })) }),
      show: async (i, level, expanded) => { await show(i, Number.isInteger(level) ? level : 0, typeof expanded === 'boolean' ? expanded : undefined); await waitSettled(3000); await twoFrames(); return layoutInfo(); },
      layout: () => layoutInfo(),
    }),
    // ライブの案内で、scripts/live-tour.mjs が使う窓口
    __live: Object.freeze({
      show: async (i, o) => { await show(i, Number.isInteger(o && o.level) ? o.level : 0, !!(o && o.expanded)); await waitSettled(3000); await twoFrames(); return layoutInfo(); },
      operate: (a) => operate(a),
      hide: () => hide(),
      idle: () => idle(),
      notice: (text) => { S.notice = String(text || ''); if (S.open && S.mode === 'tour') render(); },
      findOne: (spec) => { const all = findAll(spec); return all.find(isVisible) || all[0] || null; },
      state: () => ({ open: S.open, step: S.i, mode: S.mode }),
    }),
  });

  // 初めて開いたときだけ、案内への誘いを出す（start が "manual" なら出さない）
  if (!LIVE && (G.start || 'welcome') === 'welcome' && !load('seen')) {
    setTimeout(() => { if (!S.open && !load('seen')) { save('seen', true); openWelcome(null); } }, 500);
  }
})();
