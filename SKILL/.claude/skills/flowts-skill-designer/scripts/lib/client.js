(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('flow-data').textContent);
  var WHO = { model: 'AI', tool: 'ツール', human: '人', subflow: 'サブフロー', unknown: '不明' };
  var current = 0;
  var selected = null;
  var detail = document.getElementById('detail');
  var canvases = Array.prototype.slice.call(document.querySelectorAll('.canvas'));
  var tables = Array.prototype.slice.call(document.querySelectorAll('.steps-table'));
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var viewers = canvases.map(function (c) { return makeViewer(c); });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function cssId(id) { return window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"'); }

  function makeViewer(canvas) {
    var svg = canvas.querySelector('svg');
    var W = +svg.getAttribute('data-w');
    var H = +svg.getAttribute('data-h');
    var s = 1, vx = 0, vy = 0, ready = false;
    var drag = null;
    var moved = false;
    function apply() {
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      svg.setAttribute('width', cw);
      svg.setAttribute('height', ch);
      svg.setAttribute('viewBox', [vx, vy, cw / s, ch / s].join(' '));
    }
    function fitWidth() {
      var cw = canvas.clientWidth;
      s = Math.max(0.12, Math.min(1.1, (cw - 24) / W));
      vx = (W - cw / s) / 2;
      vy = 0;
      apply();
    }
    function fitAll() {
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      s = Math.max(0.06, Math.min(1.1, (cw - 24) / W, (ch - 24) / H));
      vx = (W - cw / s) / 2;
      vy = (H - ch / s) / 2;
      apply();
    }
    function zoomAt(f, px, py) {
      var wx = vx + px / s, wy = vy + py / s;
      s = Math.max(0.06, Math.min(3, s * f));
      vx = wx - px / s;
      vy = wy - py / s;
      apply();
    }
    function focus(id) {
      var g = svg.querySelector('[data-id="' + cssId(id) + '"]');
      if (!g) return;
      var m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
      if (!m) return;
      var box = g.querySelector('.box');
      var w = +box.getAttribute('width');
      var h = +box.getAttribute('height');
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      var x = +m[1], y = +m[2];
      var inView = x >= vx && x + w <= vx + cw / s && y >= vy && y + Math.min(h, 200) <= vy + ch / s;
      if (inView) return;
      vx = x + w / 2 - cw / s / 2;
      vy = y - 40 / s;
      apply();
    }
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
      else { vx += e.deltaX / s; vy += e.deltaY / s; apply(); }
    }, { passive: false });
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vx: vx, vy: vy };
      moved = false;
    });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) { moved = true; canvas.classList.add('dragging'); }
      if (moved) { vx = drag.vx - dx / s; vy = drag.vy - dy / s; apply(); }
    });
    window.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      canvas.classList.remove('dragging');
      setTimeout(function () { moved = false; }, 0);
    });
    svg.addEventListener('click', function (e) {
      if (moved) return;
      var n = e.target.closest('.node');
      if (n) select(n.getAttribute('data-id'), false);
      else if (!e.target.closest('.edge') && !e.target.closest('.elabel')) select(null, false);
    });
    return {
      svg: svg,
      apply: apply, fitWidth: fitWidth, fitAll: fitAll, focus: focus,
      zoom: function (f) { zoomAt(f, canvas.clientWidth / 2, canvas.clientHeight / 2); },
      ensure: function () { if (!ready && canvas.clientWidth) { fitWidth(); ready = true; } else apply(); },
    };
  }

  function showFn(i) {
    current = i;
    canvases.forEach(function (c, k) { c.classList.toggle('hidden', k !== i); });
    tables.forEach(function (t, k) { t.classList.toggle('hidden', k !== i); });
    tabs.forEach(function (t, k) { t.classList.toggle('on', k === i); });
    viewers[i].ensure();
    select(null, false);
    if (DATA.views.length > 1) {
      try { history.replaceState(null, '', '#' + encodeURIComponent(DATA.views[i].name)); } catch (e) { /* file: で使えない環境もある */ }
    }
  }

  function select(id, focus) {
    selected = id;
    var view = DATA.views[current];
    var svg = viewers[current].svg;
    svg.classList.toggle('has-sel', !!id);
    Array.prototype.forEach.call(svg.querySelectorAll('.node'), function (n) {
      n.classList.remove('sel', 'nb');
    });
    Array.prototype.forEach.call(svg.querySelectorAll('.edge'), function (g) {
      var on = !!id && (g.getAttribute('data-from') === id || g.getAttribute('data-to') === id);
      g.classList.toggle('hl', on);
      var line = g.querySelector('.line');
      var mk = on ? 'h' : line.getAttribute('data-marker');
      line.setAttribute('marker-end', 'url(#m' + mk + current + ')');
      var lab = svg.querySelector('.elabel[data-i="' + g.getAttribute('data-i') + '"]');
      if (lab) lab.classList.toggle('hl', on);
      if (on) {
        [g.getAttribute('data-from'), g.getAttribute('data-to')].forEach(function (x) {
          var nn = svg.querySelector('.node[data-id="' + cssId(x) + '"]');
          if (nn) nn.classList.add('nb');
        });
      }
    });
    if (id) {
      var node = svg.querySelector('.node[data-id="' + cssId(id) + '"]');
      if (node) node.classList.add('sel');
      if (focus) viewers[current].focus(id);
    }
    Array.prototype.forEach.call(tables[current].querySelectorAll('tr[data-id]'), function (tr) {
      tr.classList.toggle('sel', tr.getAttribute('data-id') === id);
    });
    detail.innerHTML = id && view.nodes[id] ? nodeHtml(view, view.nodes[id]) : overviewHtml(view);
    detail.scrollTop = 0;
  }

  function stepLink(id, title) {
    return '<span class="link" data-go="' + esc(id) + '">' + esc(title) + '</span>';
  }

  function whoBadge(who) { return '<span class="who who-' + esc(who) + '">' + esc(WHO[who] || who) + '</span>'; }

  function rowHtml(view, r) {
    var pad = 'padding-left:' + (Math.min(r.depth, 8) * 18) + 'px';
    if (r.type === 'work') {
      var meta = [];
      if (r.parallel) meta.push('並行して行う');
      if (r.outType) meta.push('結果の型 <code>' + esc(r.outType) + '</code>');
      if (r.cap) meta.push('能力 <code>' + esc(r.cap) + '</code>');
      if (r.input) meta.push('入力 <code>' + esc(r.input) + '</code>');
      if (r.helper && r.helperInstr && r.helperInstr.length) meta.push('中の作業：' + esc(r.helperInstr.join('／')));
      meta.push(r.line + ' 行');
      var text = r.exprInstr ? '<code>' + esc(r.text) + '</code>' : esc(r.text);
      if (r.target) text = esc(r.target) + ' を実行する（' + '<span class="link" data-fn-go="' + esc(r.target) + '">図を開く</span>）';
      return '<li style="' + pad + '">' + whoBadge(r.who) + ' ' + text + '<div class="meta">' + meta.join('　') + '</div></li>';
    }
    if (r.type === 'cond') return '<li class="cond" style="' + pad + '">' + esc(r.text) + '</li>';
    if (r.type === 'note') return '<li class="note-row" style="' + pad + '">※ ' + esc(r.text) + '</li>';
    if (r.type === 'param') return '<li class="param-row" style="' + pad + '">' + esc(r.text) + '</li>';
    if (r.kind === 'goto') {
      var args = r.args && r.args.length ? '（渡す値：<code>' + r.args.map(esc).join('</code>、<code>') + '</code>）' : '';
      return '<li class="exit" style="' + pad + '">→ ' + stepLink('L:' + r.target, r.target) + ' へ' + args + '</li>';
    }
    return '<li class="exit" style="' + pad + '">' + esc(r.text) + '</li>';
  }

  function codeHtml(lines) {
    return '<pre class="code">' + lines.map(function (p) {
      var t = esc(p[1]);
      if (/^\s*\/\//.test(p[1])) t = '<span class="c-comment">' + t + '</span>';
      else t = t.replace(/\bgoto\s+[^\s;]+/g, function (m) { return '<span class="c-goto">' + m + '</span>'; }).replace(/実施/g, '<span class="c-perform">実施</span>');
      return '<span class="ln">' + p[0] + '</span>' + t;
    }).join('\n') + '</pre>';
  }

  function nodeHtml(view, n) {
    var h = [];
    if (n.kind === 'term') {
      h.push('<h2>' + esc(n.title) + '</h2>');
      h.push('<h3>ここへ来る経路</h3>' + incomingHtml(n.incoming));
      return h.join('');
    }
    var badges = '';
    if (n.entry) badges += '<span class="badge-inline b-entry">開始</span>';
    if (n.diff) badges += '<span class="badge-inline b-' + n.diff + '">' + (n.diff === 'added' ? '追加' : '変更') + '</span>';
    h.push('<h2>' + esc(n.title) + badges + '</h2>');
    h.push('<div class="muted">' + n.line + '〜' + n.endLine + ' 行　' + (n.kind === 'label' ? 'ラベル付きブロック' : 'ラベルの外の文') + '</div>');
    if (n.note) h.push('<div class="note">' + esc(n.note) + '</div>');
    h.push('<h3>手順</h3>');
    h.push(n.rows.length ? '<ol class="outline">' + n.rows.map(function (r) { return rowHtml(view, r); }).join('') + '</ol>' : '<div class="muted">作業・分岐なし</div>');
    h.push('<h3>行き先</h3>');
    h.push(n.exits.length ? '<ul class="list">' + n.exits.map(function (e) {
      var kind = e.kind === 'goto' ? 'goto' : e.kind === 'next' ? '次へ進む' : '終了';
      return '<li><span class="ek ek-' + e.kind + '">' + kind + '</span> ' + (view.nodes[e.to] ? stepLink(e.to, e.toTitle) : esc(e.toTitle)) + '<div class="muted">条件：' + e.conds.map(esc).join(' ／ ') + '（' + e.lines.join('・') + ' 行）</div></li>';
    }).join('') + '</ul>' : '<div class="muted">なし</div>');
    h.push('<h3>ここへ来る経路</h3>' + incomingHtml(n.incoming));
    if (n.throws.length) {
      h.push('<h3>例外で終わる経路</h3><ul class="list">' + n.throws.map(function (t) {
        return '<li><code>' + esc(t.expr) + '</code><div class="muted">条件：' + esc(t.cond) + '（' + t.line + ' 行）</div></li>';
      }).join('') + '</ul>');
    }
    h.push('<h3>検査</h3>');
    h.push(n.findings.length ? '<ul class="list">' + n.findings.map(function (x) {
      return '<li class="' + (x.severity === 'エラー' ? 'sev-err' : 'sev-warn') + '">' + esc(x.severity) + '：' + esc(x.message) + (x.line ? '（' + x.line + ' 行）' : '') + '</li>';
    }).join('') + '</ul>' : '<div class="muted">なし</div>');
    h.push('<h3>コード</h3>' + codeHtml(n.code));
    return h.join('');
  }

  function incomingHtml(list) {
    if (!list.length) return '<div class="muted">なし（関数の先頭）</div>';
    var view = DATA.views[current];
    return '<ul class="list">' + list.map(function (x) {
      var kind = x.kind === 'goto' ? 'goto' : x.kind === 'next' ? '次へ進む' : '終了';
      return '<li><span class="ek ek-' + x.kind + '">' + kind + '</span> ' + (view.nodes[x.id] ? stepLink(x.id, x.title) : esc(x.title)) + '<div class="muted">条件：' + esc(x.cond) + '</div></li>';
    }).join('') + '</ul>';
  }

  function overviewHtml(view) {
    var o = view.overview;
    var h = [];
    h.push('<h2>' + esc(o.name) + '</h2>');
    h.push('<pre class="code"><span class="ln">' + o.line + '</span>' + esc(o.signature) + '</pre>');
    h.push('<p class="muted">ノードか下の表の行を押すと、そのステップの詳細が出る。</p>');
    var who = Object.keys(WHO).filter(function (k) { return o.who[k]; }).map(function (k) { return whoBadge(k) + ' ' + o.who[k]; }).join('　');
    h.push('<div class="kv"><div>ステップ</div><div>' + o.stepCount + '</div><div>作業</div><div>' + (who || 'なし') + '</div>' +
      '<div>使う能力</div><div>' + (o.caps.length ? o.caps.map(function (c) { return '<code>' + esc(c[0]) + '</code> ' + c[1]; }).join('　') : 'なし') + '</div>' +
      '<div>呼び出すフロー</div><div>' + (o.calls.length ? o.calls.map(fnLink).join('　') : 'なし') + '</div>' +
      '<div>呼び出し元</div><div>' + (o.calledBy.length ? o.calledBy.map(fnLink).join('　') : 'なし') + '</div></div>');
    if (o.decls.length) {
      h.push('<h3>関数直下の宣言</h3><pre class="code">' + o.decls.map(function (d) { return '<span class="ln">' + d.line + '</span>' + esc(d.text); }).join('\n') + '</pre>');
    }
    if (o.findings.length) {
      h.push('<h3>関数全体の検査</h3><ul class="list">' + o.findings.map(function (x) {
        return '<li class="' + (x.severity === 'エラー' ? 'sev-err' : 'sev-warn') + '">' + esc(x.severity) + '：' + esc(x.message) + (x.line ? '（' + x.line + ' 行）' : '') + '</li>';
      }).join('') + '</ul>');
    }
    return h.join('');
  }

  function fnLink(name) { return '<span class="link" data-fn-go="' + esc(name) + '">' + esc(name) + '</span>'; }

  detail.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) { select(go.getAttribute('data-go'), true); return; }
    var fg = e.target.closest('[data-fn-go]');
    if (fg) {
      var idx = DATA.views.findIndex(function (v) { return v.name === fg.getAttribute('data-fn-go'); });
      if (idx >= 0) showFn(idx);
    }
  });
  tables.forEach(function (t) {
    t.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      select(tr.getAttribute('data-id'), true);
      document.querySelector('.split').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  tabs.forEach(function (t) { t.addEventListener('click', function () { showFn(+t.getAttribute('data-fn')); }); });
  Array.prototype.forEach.call(document.querySelectorAll('.toolbar button'), function (b) {
    b.addEventListener('click', function () {
      var v = viewers[current];
      var act = b.getAttribute('data-act');
      if (act === 'fit') v.fitAll();
      else if (act === 'width') v.fitWidth();
      else if (act === 'in') v.zoom(1.25);
      else if (act === 'out') v.zoom(0.8);
    });
  });
  window.addEventListener('resize', function () { viewers[current].apply(); });
  var fromHash = DATA.views.findIndex(function (v) { return v.name === decodeURIComponent(location.hash.slice(1)); });
  showFn(fromHash >= 0 ? fromHash : 0);
})();
