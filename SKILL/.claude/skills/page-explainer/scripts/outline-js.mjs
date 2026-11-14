// 指せる部品の候補（見出し・領域・ボタン・入力欄）を、ページの中で集める式。
// check-guide.mjs の --outline と、live-tour.mjs の --outline が、ページの中で評価する。
export const OUTLINE_JS = `(() => {
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const uniq = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch (_) { return false; } };
  const txt = (el) => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || el.textContent || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 50);
  const selectorFor = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && uniq('#' + esc(el.id))) return '#' + esc(el.id);
    for (const a of el.getAttributeNames()) {
      if (!/^(data-|aria-label$|name$|role$|for$|href$|type$|placeholder$|title$|aria-controls$)/.test(a)) continue;
      const v = el.getAttribute(a); if (!v || v.length > 60) continue;
      const s = tag + '[' + a + '="' + v.replace(/"/g, '\\\\"') + '"]';
      if (uniq(s)) return s;
    }
    const cls = [...el.classList].filter((c) => !/^(is-|has-|js-)/.test(c)).slice(0, 3);
    for (let n = 1; n <= cls.length; n++) { const s = tag + cls.slice(0, n).map((c) => '.' + esc(c)).join(''); if (uniq(s)) return s; }
    const parts = []; let cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      if (cur.id && uniq('#' + esc(cur.id))) { parts.unshift('#' + esc(cur.id)); break; }
      let p = cur.tagName.toLowerCase();
      const cc = [...cur.classList].filter((c) => !/^(is-|has-|js-)/.test(c)).slice(0, 1);
      if (cc.length) p += '.' + esc(cc[0]);
      const sib = cur.parentElement ? [...cur.parentElement.children].filter((x) => x.matches(p)) : [];
      if (sib.length > 1) p += ':nth-of-type(' + ([...cur.parentElement.children].filter((x) => x.tagName === cur.tagName).indexOf(cur) + 1) + ')';
      parts.unshift(p); cur = cur.parentElement;
    }
    const s = parts.join(' > ');
    return s && uniq(s) ? s : null;
  };
  const kind = (el) => {
    if (/^H[1-4]$/.test(el.tagName)) return '見出し';
    if (el.matches('header,nav,main,aside,footer,form,section,table,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=search],[role=toolbar],[role=tablist],[role=dialog],[role=menu],[role=grid],[role=table],details')) return '領域';
    if (el.matches('button,a[href],input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[contenteditable=""],[contenteditable=true]')) return '操作';
    return 'id';
  };
  const Q = 'h1,h2,h3,h4,header,nav,main,aside,footer,form,section[aria-label],section[id],table,details,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=search],[role=toolbar],[role=tablist],[role=tab],[role=dialog],[role=menu],[role=grid],[role=table],button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=checkbox],[role=switch],[contenteditable=""],[contenteditable=true],[id]';
  const rank = { '見出し': 0, '領域': 1, '操作': 2, 'id': 3 };
  const found = [];
  for (const el of document.querySelectorAll(Q)) {
    if (el.closest('page-explainer, svg, template, script, style, noscript')) continue;
    found.push({ el, kind: kind(el) });
  }
  // 番号だけが違う id（#cell-A1、#cell-B1 …）は、まとめて 1 行にする
  const groups = new Map();
  for (const f of found) {
    if (f.kind !== 'id') continue;
    const key = f.el.id.replace(/[A-Za-z]{0,3}\\d+$/, '');
    if (key === f.el.id) continue;
    (groups.get(key) || groups.set(key, []).get(key)).push(f);
  }
  const collapsed = new Set();
  for (const [key, list] of groups) if (list.length > 8) list.slice(1).forEach((f) => collapsed.add(f.el));
  const picked = found.filter((f) => !collapsed.has(f.el)).sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 400);
  const items = picked.map(({ el, kind: k }) => {
    const r = el.getBoundingClientRect();
    const vis = (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) && r.width >= 1 && r.height >= 1;
    const key = k === 'id' ? el.id.replace(/[A-Za-z]{0,3}\\d+$/, '') : null;
    const many = key && key !== el.id && groups.get(key) && groups.get(key).length > 8 ? groups.get(key).length : 0;
    return { kind: k, tag: el.tagName.toLowerCase(), selector: selectorFor(el), text: (many ? '（同じ形の id が ' + many + ' 個ある。例として最初の 1 つ）' : '') + txt(el), visible: vis, rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) } };
  });
  return { title: document.title, scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, total: found.length, items };
})()`;
