/*
 * sequence-diagram skill — core library
 *
 * 処理モデル(JSON)の正規化・検証と、Mermaid シーケンス図テキストの生成を行う。
 * Node.js の CLI (require) とブラウザのビューア (HTML へインライン埋め込み) の両方で
 * 同じコードを使うため、外部依存なし・DOM 非依存で書いている。
 *
 * 役割分担:
 *   normalize(model)            入力 JSON を正規化（既定値補完・ID 採番・索引作成）。例外を投げない。
 *   validate(model)             正規化済みモデルの整合性検査（errors / warnings / infos）。
 *   generate(model, id, opts)   1 つの図を Mermaid テキスト + 対応表(map) に変換する。
 *
 * map は「何番目の Mermaid メッセージ / ノート / フラグメントが、モデルのどのステップか」を
 * 表す。ビューアは描画後の SVG を data-et / data-id 属性の順序で map と突き合わせ、
 * クリック・検索・強調表示を実現する（Mermaid の構文そのものは変更しない）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeqCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var ZWSP = String.fromCharCode(0x200b); // 空ラベル用のゼロ幅スペース
  var MERMAID_VERSION = '11.17.2';

  // ---------------------------------------------------------------------------
  // 定数
  // ---------------------------------------------------------------------------

  /** 既定レイヤー（並び順 = 左から右）。model.layers で上書き・追加できる。 */
  var DEFAULT_LAYERS = [
    { id: 'client', label: 'クライアント', color: '#475569' },
    { id: 'batch', label: 'バッチ/スケジューラ', color: '#4f46e5' },
    { id: 'framework', label: 'フレームワーク', color: '#64748b' },
    { id: 'handler', label: '例外ハンドラ', color: '#e11d48' },
    { id: 'controller', label: 'Controller層', color: '#2563eb' },
    { id: 'service', label: 'Service層', color: '#059669' },
    { id: 'process', label: '処理', color: '#65a30d' }, // 設計書・仕様書の処理単位（クラスが無い場合）
    { id: 'domain', label: 'ドメイン/共通部品', color: '#0891b2' },
    { id: 'repository', label: 'Repository層', color: '#d97706' },
    { id: 'db', label: 'データベース', color: '#b45309' },
    { id: 'cache', label: 'キャッシュ', color: '#0d9488' },
    { id: 'integration', label: '外部連携', color: '#9333ea' },
    { id: 'external', label: '外部システム', color: '#7c3aed' },
    { id: 'messaging', label: 'メッセージング', color: '#db2777' },
    { id: 'other', label: 'その他', color: '#6b7280' }
  ];

  var LIFELINE_TYPES = ['method', 'actor', 'db', 'external', 'queue', 'framework', 'batch', 'cache', 'file', 'other'];

  /** type ごとの既定の種別表示（"種別：" 部分）と既定レイヤー。 */
  var TYPE_DEFAULTS = {
    method: { kind: '', layer: null },
    actor: { kind: '', layer: 'client' },
    db: { kind: 'DB', layer: 'db' },
    external: { kind: 'External API', layer: 'external' },
    queue: { kind: 'MQ', layer: 'messaging' },
    framework: { kind: 'Framework', layer: 'framework' },
    batch: { kind: 'Batch', layer: 'batch' },
    cache: { kind: 'Cache', layer: 'cache' },
    file: { kind: 'File', layer: 'other' },
    other: { kind: '', layer: 'other' }
  };

  /** 種別名(kind)からレイヤーを推定するための規則（先勝ち・大文字小文字無視）。 */
  var KIND_LAYER_RULES = [
    [/exception\s*handler|error\s*handler|controller\s*advice|exception\s*filter|exception\s*mapper/i, 'handler'],
    [/controller|handler|endpoint|resource|router|route|action|presenter|resolver|view|page|screen|graphql|grpc|api(?!\s*client)/i, 'controller'],
    [/repository|repo\b|dao|mapper|store|querier|query/i, 'repository'],
    [/client|adapter|gateway|connector|proxy/i, 'integration'],
    [/service|usecase|use case|interactor|application|facade|manager|workflow|orchestrator|listener|subscriber|consumer|job|task|command/i, 'service'],
    [/validator|helper|util|factory|entity|domain|model|policy|calculator|converter|mapper|builder|spec|rule|value/i, 'domain'],
    [/filter|interceptor|aspect|aop|middleware|dispatcher|framework|proxy|container|transaction/i, 'framework'],
    [/db|database|table/i, 'db'],
    [/queue|topic|kafka|rabbit|sqs|sns|pubsub|event\s*bus|broker|mq\b/i, 'messaging'],
    [/cache|redis|memcache/i, 'cache'],
    [/処理|手順|工程|ステップ|機能|process|step/i, 'process'],
    [/external|外部/i, 'external'],
    [/user|actor|client|browser|ユーザー|利用者|画面/i, 'client']
  ];

  var STEP_TYPES = ['call', 'self', 'db', 'return', 'throw', 'try', 'alt', 'opt', 'loop', 'par', 'critical',
    'break', 'ref', 'note', 'transaction', 'tx', 'lock', 'await', 'group'];

  var CALL_MODES = ['sync', 'async', 'event', 'message', 'callback'];
  var DB_OPS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'MERGE', 'CALL', 'LOCK', 'DDL', 'OTHER'];
  var EVIDENCE_STATUSES = ['confirmed', 'inferred', 'unverified'];
  var EVIDENCE_LABELS = { confirmed: '確認済み', inferred: '推定', unverified: '未確認' };

  /** Mermaid のフラグメントキーワード → 日本語表示（ビューアが SVG 描画後に置換する）。 */
  var FRAGMENT_LABELS = {
    alt: '条件分岐', opt: '条件付き実行', loop: '繰り返し', par: '並列処理',
    'break': '処理中断', critical: '排他処理', ref: '詳細参照',
    // try-catch は Mermaid 上は alt で描くが、ビューアでは対応表で try と判定できた枠だけ「例外処理」と表示する
    'try': '例外処理'
  };

  /** 矢印種別 → Mermaid の矢印記法（公式構文のみを使用）。 */
  var ARROWS = {
    sync: '->>', // 同期呼び出し（実線・塗り矢じり）
    reply: '-->>', // 戻り値（点線・塗り矢じり）
    async: '-)', // 非同期呼び出し / イベント発行 / メッセージ送信（実線・開いた矢じり）
    asyncReply: '--)', // コールバック / 非同期完了通知（点線・開いた矢じり）
    error: '--x' // 例外の送出・伝播（点線・×）
  };

  /** 図の中の背景帯(rect)の色。テーマ別。 */
  var RECT_COLORS = {
    light: { tx: 'rgba(14,165,233,0.07)', group: 'rgba(100,116,139,0.06)', fin: 'rgba(234,179,8,0.09)', tryOnly: 'rgba(249,115,22,0.05)' },
    dark: { tx: 'rgba(56,189,248,0.10)', group: 'rgba(148,163,184,0.08)', fin: 'rgba(250,204,21,0.10)', tryOnly: 'rgba(251,146,60,0.08)' }
  };

  var DEFAULT_GEN_OPTIONS = {
    lifelineMode: 'method', // 'method' | 'class'
    showArgs: false, // 矢印に引数名を表示
    showExpr: false, // フラグメント条件にコード上の条件式を併記
    showReturns: true, // 通常の戻り値矢印を表示
    hideMinor: false, // minor:true の自己メッセージを非表示
    collapsed: null, // 折りたたむ group ステップ ID の配列/Set（null = モデルの collapsed 指定に従う）
    expandRefs: null, // その場で展開する ref 付き call ステップ ID の配列/Set
    boxes: true, // レイヤーごとに box でグループ化
    autonumber: true,
    theme: 'light',
    maxLabelUnits: 44 // 矢印ラベルの 1 行あたり最大幅（半角=1, 全角=2）
  };

  // ---------------------------------------------------------------------------
  // 汎用ユーティリティ
  // ---------------------------------------------------------------------------

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]); }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function toSet(v) {
    if (!v) return new Set();
    if (v instanceof Set) return v;
    return new Set(arr(v));
  }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /** 表示幅（半角=1、それ以外=2）。 */
  function textUnits(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      n += (c < 0x2e80 || (c >= 0xff61 && c <= 0xff9f)) ? 1 : 2;
    }
    return n;
  }

  /**
   * 長いラベルを読みやすい位置で改行する（情報は削らない）。
   * 句読点・括弧・空白・区切り記号の直後を優先して折り返す。
   */
  function wrapText(s, maxUnits) {
    s = str(s);
    var paragraphs = s.split(/\r?\n/);
    var out = [];
    paragraphs.forEach(function (p) {
      var rest = p;
      // 〔推定〕〔未確認〕の付記ではみ出す場合は、付記の前で改行する
      var sfx = / 〔[^〕]+〕$/.exec(rest);
      if (sfx && textUnits(rest) > maxUnits + 4 && textUnits(rest.slice(0, sfx.index)) <= maxUnits + 4) {
        out.push(rest.slice(0, sfx.index));
        rest = rest.slice(sfx.index + 1);
      }
      // 数文字だけ次の行に送られる（「待／機」のような）折り返しは避け、少しのはみ出しを許す
      while (textUnits(rest) > maxUnits + 4) {
        var cut = -1, units = 0, lastGood = -1;
        for (var i = 0; i < rest.length; i++) {
          units += textUnits(rest[i]);
          if (units > maxUnits) { cut = i; break; }
          // 英語の語句の中の空白（"Internal Server Error" など）は区切りとして扱わない
          var inPhrase = /\s/.test(rest[i]) && /[A-Za-z0-9]/.test(rest[i - 1] || '') && /[A-Za-z0-9]/.test(rest[i + 1] || '');
          if (/[、。，．,）)\]】」』・／/：:\s＞>=]/.test(rest[i]) && !inPhrase && units > maxUnits * 0.45) lastGood = i + 1;
        }
        if (cut < 0) break;
        var pos = lastGood > 0 ? lastGood : cut;
        // 英数字の並び（識別子・型名・「500 Internal Server Error」など）の途中では切らず、並びの先頭まで戻す
        var asciiRun = /[A-Za-z0-9_<>.\-\[\]#\s]/;
        if (lastGood <= 0 && asciiRun.test(rest[pos - 1] || '') && asciiRun.test(rest[pos] || '') && /[A-Za-z0-9_<>]/.test(rest.slice(Math.max(0, pos - 2), pos + 2))) {
          var w = pos;
          while (w > 0 && asciiRun.test(rest[w - 1])) w--;
          while (w < pos && /\s/.test(rest[w])) w++;
          if (w > 0 && textUnits(rest.slice(0, w)) > maxUnits * 0.3) pos = w;
        }
        out.push(rest.slice(0, pos).replace(/\s+$/, ''));
        rest = rest.slice(pos).replace(/^\s+/, '');
      }
      out.push(rest);
    });
    return out.filter(function (l, i) { return l !== '' || i === 0; });
  }

  /**
   * Mermaid テキスト用のエスケープ。公式のエンティティコード(#数値; / #名前;)を使う。
   * ; は文の区切り、# はコメント/エンティティ、< > & は HTML として解釈されるため必ず置換する。
   */
  var ESC_MAP = { '#': '#35;', ';': '#59;', '<': '#lt;', '>': '#gt;', '&': '#38;', '%': '#37;', ':': '#58;', '\u0000': '' };
  function escText(s) {
    return str(s).replace(/[#;<>&%:\u0000]/g, function (c) { return ESC_MAP[c]; }).replace(/[\r\n\t]+/g, ' ');
  }
  /** フラグメント条件ではMermaidが < > の前で改行してしまうため全角に置き換える（表示のみ。詳細パネルは原文）。 */
  function escFragment(s) {
    return escText(str(s).replace(/</g, '＜').replace(/>/g, '＞'));
  }
  function escLines(lines) {
    return lines.map(escText).join('<br/>');
  }

  /** "path/to/File.java:42-48" / "docs/spec.md#3.2" 形式の参照文字列を分解する。 */
  function parseRef(r) {
    if (isObj(r)) {
      var o = clone(r);
      if (o.line !== undefined) o.line = Number(o.line);
      if (o.endLine !== undefined) o.endLine = Number(o.endLine);
      return o;
    }
    var s = str(r).trim();
    var m = /^(.*?):(\d+)(?:\s*-\s*(\d+))?$/.exec(s);
    if (m && m[1]) {
      var ref = { file: m[1], line: Number(m[2]) };
      if (m[3]) ref.endLine = Number(m[3]);
      return ref;
    }
    var h = /^([^#]+)#(.+)$/.exec(s);
    if (h && /\.[A-Za-z0-9]+$/.test(h[1])) return { file: h[1], anchor: h[2] };
    if (/\.[A-Za-z0-9]{1,8}$/.test(s) || s.indexOf('/') >= 0 || s.indexOf('\\') >= 0) return { file: s };
    return { text: s };
  }

  function refToString(r) {
    if (!r) return '';
    if (r.text && !r.file) return r.text;
    var s = r.file || '';
    if (r.line) s += ':' + r.line + (r.endLine && r.endLine !== r.line ? '-' + r.endLine : '');
    if (r.anchor) s += '#' + r.anchor;
    if (r.symbol) s += ' (' + r.symbol + ')';
    return s;
  }

  function sanitizeId(s) {
    var id = str(s).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[A-Za-z_]/.test(id)) id = 'x_' + id;
    return id || 'x';
  }

  // ---------------------------------------------------------------------------
  // 正規化
  // ---------------------------------------------------------------------------

  function inferLayer(ll) {
    if (ll.layer) return ll.layer;
    var td = TYPE_DEFAULTS[ll.type];
    if (td && td.layer) return td.layer;
    // 種別(kind)を優先し、決まらなければクラス名で判定する
    var probes = [ll.kind, ll['class']].filter(Boolean);
    for (var p = 0; p < probes.length; p++) {
      for (var i = 0; i < KIND_LAYER_RULES.length; i++) {
        if (KIND_LAYER_RULES[i][0].test(probes[p])) return KIND_LAYER_RULES[i][1];
      }
    }
    return 'other';
  }

  function normEvidence(ev, meta) {
    var e = isObj(ev) ? clone(ev) : {};
    var def = meta._defaultEvidence;
    var refs = arr(e.refs).map(parseRef);
    var explicit = !!e.status;
    var status = e.status;
    var inherited = false;
    if (!status) {
      if (refs.length) status = 'confirmed';
      else { status = def.status; inherited = true; if (def.refs.length) refs = def.refs.slice(); }
    }
    return { status: status, refs: refs, note: str(e.note), _explicit: explicit, _inherited: inherited };
  }

  function lifelineBody(ll) {
    if (ll.type === 'db' || ll.type === 'queue' || ll.type === 'actor' || ll.type === 'file' || ll.type === 'cache') {
      return ll.name || ll['class'] || ll.id;
    }
    var cls = ll['class'], m = ll.method;
    var body = cls && m ? cls + '.' + m : (m || cls || ll.name || ll.id);
    if (ll._showSig && ll.signature) {
      var sig = String(ll.signature);
      var p = sig.indexOf('(');
      body += p >= 0 ? sig.slice(p) : '(' + sig + ')';
    }
    return body;
  }

  function computeLifelineLabel(ll) {
    if (ll.label) return String(ll.label);
    var kind = ll.kind !== undefined ? str(ll.kind) : (TYPE_DEFAULTS[ll.type] || TYPE_DEFAULTS.other).kind;
    var body = lifelineBody(ll);
    return kind ? kind + '：' + body : body;
  }

  /** 子ステップ配列の一覧（汎用走査用）。 */
  function childLists(step) {
    var out = [];
    switch (step.type) {
      case 'call': if (step.steps) out.push({ key: 'steps', steps: step.steps }); break;
      case 'alt': case 'par':
        step.branches.forEach(function (b, i) { out.push({ key: 'branches.' + i, steps: b.steps, branch: b }); });
        break;
      case 'critical':
        out.push({ key: 'steps', steps: step.steps });
        step.options.forEach(function (o, i) { out.push({ key: 'options.' + i, steps: o.steps, branch: o }); });
        break;
      case 'try':
        out.push({ key: 'steps', steps: step.steps });
        step.catches.forEach(function (c, i) { out.push({ key: 'catches.' + i, steps: c.steps, branch: c }); });
        if (step['finally']) out.push({ key: 'finally', steps: step['finally'].steps, branch: step['finally'] });
        break;
      case 'opt': case 'loop': case 'break': case 'group': case 'transaction':
        out.push({ key: 'steps', steps: step.steps });
        break;
      default: break;
    }
    return out;
  }

  /** 全ステップを深さ優先で走査する。fn(step, parent, depth, ancestors) */
  function walkSteps(steps, fn, parent, depth, ancestors) {
    depth = depth || 0;
    ancestors = ancestors || [];
    (steps || []).forEach(function (s) {
      if (!isObj(s)) return;
      fn(s, parent || null, depth, ancestors);
      var anc = ancestors.concat([s]);
      childLists(s).forEach(function (cl) { walkSteps(cl.steps, fn, s, depth + 1, anc); });
    });
  }

  function normalize(input) {
    var issues = [];
    var m = isObj(input) ? clone(input) : {};
    if (!isObj(input)) issues.push({ level: 'error', code: 'model.notObject', message: 'モデルが JSON オブジェクトではありません。' });

    m.schemaVersion = m.schemaVersion || 1;
    m.meta = isObj(m.meta) ? m.meta : {};
    var meta = m.meta;
    meta.title = str(meta.title) || 'シーケンス図';
    meta.defaultEvidenceStatus = meta.defaultEvidenceStatus || (isObj(meta.defaultEvidence) && meta.defaultEvidence.status) || 'unverified';
    meta._defaultEvidence = {
      status: meta.defaultEvidenceStatus,
      refs: isObj(meta.defaultEvidence) ? arr(meta.defaultEvidence.refs).map(parseRef) : []
    };
    ['assumptions', 'unresolved', 'omissions', 'excluded', 'inputs', 'frameworks'].forEach(function (k) {
      if (meta[k] !== undefined && !Array.isArray(meta[k])) meta[k] = [meta[k]];
    });

    // --- レイヤー ---
    var layers = DEFAULT_LAYERS.map(function (l) { return Object.assign({}, l); });
    arr(m.layers).forEach(function (l) {
      if (!isObj(l) || !l.id) { issues.push({ level: 'error', code: 'layer.invalid', message: 'layers の要素に id がありません。' }); return; }
      var idx = layers.findIndex(function (x) { return x.id === l.id; });
      if (idx >= 0) {
        var merged = Object.assign({}, layers[idx], l);
        // 既存レイヤーに before を書いた場合は、その位置へ移動する
        if (typeof l.before === 'string' && l.before !== l.id) {
          layers.splice(idx, 1);
          var mi = layers.findIndex(function (x) { return x.id === l.before; });
          layers.splice(mi >= 0 ? mi : layers.length, 0, merged);
        } else layers[idx] = merged;
      } else if (typeof l.before === 'string') {
        var bi = layers.findIndex(function (x) { return x.id === l.before; });
        layers.splice(bi >= 0 ? bi : layers.length, 0, Object.assign({ label: l.id, color: '#6b7280' }, l));
      } else layers.push(Object.assign({ label: l.id, color: '#6b7280' }, l));
    });
    m.layers = layers;
    var layerIndex = new Map();
    layers.forEach(function (l, i) { l._rank = i; layerIndex.set(l.id, l); });

    // --- ライフライン ---
    var llIndex = new Map();
    m.lifelines = arr(m.lifelines).filter(function (ll, i) {
      if (!isObj(ll)) { issues.push({ level: 'error', code: 'lifeline.invalid', message: 'lifelines[' + i + '] がオブジェクトではありません。' }); return false; }
      return true;
    });
    m.lifelines.forEach(function (ll, i) {
      if (!ll.id) { ll.id = 'll_' + (i + 1); issues.push({ level: 'error', code: 'lifeline.noId', message: 'lifelines[' + i + '] に id がありません。', path: 'lifelines[' + i + ']' }); }
      ll.id = String(ll.id);
      if (!ll.type) {
        if (ll.table) { ll.type = 'db'; ll.name = ll.name || ll.table; }
        else ll.type = 'method';
      }
      if (ll.type === 'db' && !ll.name && ll.table) ll.name = ll.table;
      ll.layer = inferLayer(ll);
      if (!layerIndex.has(ll.layer)) {
        issues.push({ level: 'warning', code: 'lifeline.unknownLayer', message: 'ライフライン ' + ll.id + ' のレイヤー "' + ll.layer + '" は未定義のため "other" として扱います。', lifelineId: ll.id });
        ll.layer = 'other';
      }
      ll.evidence = normEvidence(ll.evidence, meta);
      ll.annotations = arr(ll.annotations).map(str);
      if (llIndex.has(ll.id)) issues.push({ level: 'error', code: 'lifeline.duplicateId', message: 'ライフライン ID "' + ll.id + '" が重複しています。', lifelineId: ll.id });
      llIndex.set(ll.id, ll);
    });

    function ensureDbLifeline(table) {
      var t = str(table);
      if (llIndex.has(t) && llIndex.get(t).type === 'db') return t;
      var found = m.lifelines.find(function (ll) { return ll.type === 'db' && (ll.name === t || ll.table === t); });
      if (found) return found.id;
      var id = 'db_' + sanitizeId(t);
      while (llIndex.has(id) && llIndex.get(id).type !== 'db') id += '_';
      if (!llIndex.has(id)) {
        var ll = { id: id, type: 'db', name: t, layer: 'db', _auto: true, annotations: [] };
        ll.evidence = normEvidence(null, meta);
        m.lifelines.push(ll);
        llIndex.set(id, ll);
      }
      return id;
    }

    // --- 図とステップ ---
    var stepIndex = new Map();
    var diagIndex = new Map();
    m.diagrams = arr(m.diagrams).filter(function (d, i) {
      if (!isObj(d)) { issues.push({ level: 'error', code: 'diagram.invalid', message: 'diagrams[' + i + '] がオブジェクトではありません。' }); return false; }
      return true;
    });
    if (!m.diagrams.length) issues.push({ level: 'error', code: 'diagram.none', message: 'diagrams が空です。少なくとも 1 つの図が必要です。' });

    var autoSeq = 0;
    function normSteps(list, diagram, path) {
      if (list === undefined || list === null) return [];
      if (!Array.isArray(list)) {
        issues.push({ level: 'error', code: 'steps.notArray', message: path + ' が配列ではありません。', diagramId: diagram.id });
        return [];
      }
      return list.filter(function (s, i) {
        if (!isObj(s)) { issues.push({ level: 'error', code: 'step.invalid', message: path + '[' + i + '] がオブジェクトではありません。', diagramId: diagram.id }); return false; }
        return true;
      }).map(function (s, i) { return normStep(s, diagram, path + '[' + i + ']'); });
    }

    function normBranches(list, diagram, path, condKey) {
      return arr(list).filter(isObj).map(function (b, i) {
        b.steps = normSteps(b.steps, diagram, path + '[' + i + '].steps');
        if (condKey && b[condKey] === undefined && b.label !== undefined) b[condKey] = b.label;
        b.evidence = b.evidence ? normEvidence(b.evidence, meta) : null;
        return b;
      });
    }

    function normStep(s, diagram, path) {
      if (!s.type) {
        issues.push({ level: 'error', code: 'step.noType', message: path + ' に type がありません。', diagramId: diagram.id });
        s.type = 'note';
        s.text = s.text || '(type 未指定のステップ)';
      }
      if (STEP_TYPES.indexOf(s.type) < 0) {
        issues.push({ level: 'error', code: 'step.unknownType', message: path + ' の type "' + s.type + '" は未対応です。', diagramId: diagram.id });
        s._invalidType = s.type;
        s.type = 'note';
        s.text = s.text || s.label || '(未対応のステップ)';
      }
      if (!s.id) s.id = diagram.id + '.s' + (++autoSeq);
      s.id = String(s.id);
      if (stepIndex.has(s.id)) {
        issues.push({ level: 'error', code: 'step.duplicateId', message: 'ステップ ID "' + s.id + '" が重複しています（' + path + '）。', diagramId: diagram.id, stepId: s.id });
        s.id = s.id + '#' + (++autoSeq);
      }
      s._path = path;
      s._diagram = diagram.id;
      stepIndex.set(s.id, s);
      var annotationOnly = s.type === 'note' || s.type === 'ref';
      s.evidence = annotationOnly && !s.evidence ? null : normEvidence(s.evidence, meta);

      switch (s.type) {
        case 'call':
          s.mode = s.mode || 'sync';
          s.args = arr(s.args).map(function (a) { return isObj(a) ? a : { name: str(a) }; });
          if (s.returns !== undefined && !isObj(s.returns)) s.returns = { name: str(s.returns) };
          s.returnArrow = s.returnArrow || 'auto';
          s.steps = normSteps(s.steps, diagram, path + '.steps');
          break;
        case 'db':
          s.op = str(s.op || 'OTHER').toUpperCase();
          if (!s.to && s.table) s.to = ensureDbLifeline(s.table);
          if (s.to && !s.table && llIndex.has(s.to)) s.table = llIndex.get(s.to).name;
          s.columns = arr(s.columns).map(str);
          s.joins = arr(s.joins).map(str);
          if (s.result !== undefined && !isObj(s.result)) s.result = { name: str(s.result) };
          s.returnArrow = s.returnArrow || 'auto';
          break;
        case 'alt':
          s.branches = normBranches(s.branches, diagram, path + '.branches', 'condition');
          break;
        case 'par':
          s.branches = normBranches(s.branches, diagram, path + '.branches', 'label');
          break;
        case 'critical':
          s.steps = normSteps(s.steps, diagram, path + '.steps');
          s.options = normBranches(s.options, diagram, path + '.options', 'condition');
          break;
        case 'try':
          s.steps = normSteps(s.steps, diagram, path + '.steps');
          s.catches = normBranches(s.catches, diagram, path + '.catches', 'label');
          if (s['finally'] !== undefined) {
            if (Array.isArray(s['finally'])) s['finally'] = { steps: s['finally'] };
            if (isObj(s['finally'])) s['finally'].steps = normSteps(s['finally'].steps, diagram, path + '.finally.steps');
            else s['finally'] = undefined;
          }
          break;
        case 'opt': case 'loop': case 'break': case 'group': case 'transaction':
          s.steps = normSteps(s.steps, diagram, path + '.steps');
          break;
        case 'throw':
          s.exception = str(s.exception || s.label || 'Exception');
          break;
        case 'lock':
          s.action = s.action || 'acquire';
          break;
        case 'tx':
          s.action = s.action || 'begin';
          break;
        case 'note':
          s.over = arr(s.over).map(str);
          break;
        case 'ref':
          s.over = arr(s.over).map(str);
          break;
        default: break;
      }
      return s;
    }

    m.diagrams.forEach(function (d, i) {
      if (!d.id) { d.id = 'diagram' + (i + 1); issues.push({ level: 'error', code: 'diagram.noId', message: 'diagrams[' + i + '] に id がありません。' }); }
      d.id = String(d.id);
      if (diagIndex.has(d.id)) issues.push({ level: 'error', code: 'diagram.duplicateId', message: '図 ID "' + d.id + '" が重複しています。', diagramId: d.id });
      diagIndex.set(d.id, d);
      d.title = str(d.title) || d.id;
      d.steps = normSteps(d.steps, d, 'diagrams[' + i + '].steps');
      if (d.participants !== undefined) d.participants = arr(d.participants).map(str);
    });

    // オーバーロード（同一クラス・同一メソッド名）を検出したらシグネチャ表示を有効にする
    var sigCount = new Map();
    m.lifelines.forEach(function (ll) {
      if (ll.type !== 'method' && ll.type !== 'external' && ll.type !== 'framework' && ll.type !== 'batch') return;
      var key = str(ll.kind) + '|' + str(ll['class']) + '|' + str(ll.method);
      sigCount.set(key, (sigCount.get(key) || 0) + 1);
    });
    m.lifelines.forEach(function (ll) {
      var key = str(ll.kind) + '|' + str(ll['class']) + '|' + str(ll.method);
      ll._showSig = ll.showSignature === true || (ll.showSignature !== false && (sigCount.get(key) || 0) > 1);
      ll._kind = ll.kind !== undefined ? str(ll.kind) : (TYPE_DEFAULTS[ll.type] || TYPE_DEFAULTS.other).kind;
      ll._label = computeLifelineLabel(ll);
      ll._classKey = (ll.type === 'method' || ll.type === 'external' || ll.type === 'framework' || ll.type === 'batch') && ll['class']
        ? 'C_' + sanitizeId(str(ll.kind) + '_' + ll['class']) : ll.id;
    });

    // ref 関係（親子）を作る
    m.diagrams.forEach(function (d) { d._children = []; d._parents = []; });
    m.diagrams.forEach(function (d) {
      walkSteps(d.steps, function (s) {
        var target = s.type === 'ref' ? s.diagram : (s.type === 'call' ? s.ref : null);
        if (target && diagIndex.has(target) && target !== d.id) {
          var child = diagIndex.get(target);
          if (d._children.indexOf(target) < 0) d._children.push(target);
          if (child._parents.indexOf(d.id) < 0) child._parents.push(d.id);
        }
      });
    });

    m._index = { lifelines: llIndex, diagrams: diagIndex, steps: stepIndex, layers: layerIndex };
    m._issues = issues;
    m._normalized = true;
    return m;
  }

  // ---------------------------------------------------------------------------
  // ラベル生成（矢印・フラグメント・ノートに表示する文字列）
  // ---------------------------------------------------------------------------

  function evidenceSuffix(ev) {
    if (!ev) return '';
    if (ev.status === 'inferred') return ' 〔推定〕';
    if (ev.status === 'unverified') return ' 〔未確認〕';
    return '';
  }

  function returnText(step) {
    if (step.returnLabel) return str(step.returnLabel);
    var r = step.returns;
    if (!r) return '';
    var name = r.jpName || r.label || r.name || '';
    if (r.type && name && name !== r.type) return name + '（' + r.type + '）';
    return name || str(r.type);
  }

  function dbResultText(step) {
    if (step.returnLabel) return str(step.returnLabel);
    var r = step.result;
    if (!r) return step.op === 'SELECT' ? '取得結果' : '';
    var name = r.jpName || r.label || r.name || '';
    var extra = r.rows ? '［' + r.rows + '］' : '';
    if (r.type && name && name !== r.type) return name + '（' + r.type + '）' + extra;
    return (name || str(r.type) || '結果') + extra;
  }

  function fragmentCondition(text, expr, ev, opts, suffix) {
    var t = str(text);
    if (opts.showExpr && expr) t = t ? t + ' 〔' + expr + '〕' : str(expr);
    if (!t) t = '（条件未記載）';
    return t + evidenceSuffix(ev) + (suffix || '');
  }

  /**
   * ステップ並びが必ず return / throw で終わるか（＝後続処理へ合流しない）を判定する。
   * 末尾が alt で、最後の分岐が else（"else": true）かつ全分岐が終端する場合も終端とみなす。
   * 戻り値: 'return' | 'throw' | null
   */
  function terminationOf(steps) {
    if (!steps || !steps.length) return null;
    for (var i = steps.length - 1; i >= 0; i--) {
      var s = steps[i];
      var t = s.type;
      if (t === 'note' || t === 'tx' || t === 'lock') continue;
      if (t === 'return') return 'return';
      if (t === 'throw') return 'throw';
      if (t === 'alt' && s.branches.length >= 2 && s.branches[s.branches.length - 1]['else'] === true) {
        var kinds = s.branches.map(function (b) { return terminationOf(b.steps); });
        if (kinds.every(Boolean)) return kinds.every(function (k) { return k === 'throw'; }) ? 'throw' : 'return';
      }
      return null;
    }
    return null;
  }
  function terminationSuffix(steps) {
    var t = terminationOf(steps);
    if (t === 'return') return ' ⇒ return';
    if (t === 'throw') return ' ⇒ 例外送出';
    return '';
  }

  // ---------------------------------------------------------------------------
  // Mermaid 生成
  // ---------------------------------------------------------------------------

  function Gen(model, diagram, opts) {
    this.model = model;
    this.d = diagram;
    this.opts = opts;
    this.ix = model._index;
    this.out = []; // 文字列 または {note:..} オブジェクト
    this.depth = 1;
    this.msgs = [];
    this.notes = [];
    this.frags = [];
    this.parts = new Map(); // key -> participant info
    this.partSeq = 0;
    this.act = new Map(); // mId -> 活性化数
    this.stack = [];
    this.warnings = [];
    this.collapsed = opts.collapsed ? toSet(opts.collapsed) : null;
    this.expandRefs = toSet(opts.expandRefs);
    this.theme = opts.theme === 'dark' ? 'dark' : 'light';
    this.counter = { call: 0, db: 0, self: 0, async: 0, throw: 0, fragments: 0 };
    this.deferStack = []; // finally 付き try の中で後回しにする例外伝播
    this.fragKinds = []; // 入れ子になっている枠の種類（break の表示に使う）
    this.txStack = []; // 入れ子になっている transaction（ROLLBACK ノートの位置に使う）
  }

  Gen.prototype.ll = function (id) { return this.ix.lifelines.get(id); };

  Gen.prototype.key = function (llId) {
    var ll = this.ll(llId);
    if (!ll) throw new GenError('未定義のライフライン ID "' + llId + '" が参照されています。');
    return this.opts.lifelineMode === 'class' ? ll._classKey : ll.id;
  };

  Gen.prototype.use = function (llId) {
    var k = this.key(llId);
    var p = this.parts.get(k);
    if (!p) {
      var ll = this.ll(llId);
      p = {
        key: k, mId: 'P' + (++this.partSeq), first: this.partSeq, llIds: [], layer: ll.layer, type: ll.type,
        label: this.opts.lifelineMode === 'class' && k !== ll.id ? (ll._kind ? ll._kind + '：' : '') + ll['class'] : ll._label,
        evidence: ll.evidence
      };
      this.parts.set(k, p);
    }
    if (p.llIds.indexOf(llId) < 0) p.llIds.push(llId);
    return p;
  };

  Gen.prototype.line = function (s) {
    this.out.push(new Array(this.depth + 1).join('  ') + s);
  };

  Gen.prototype.fmt = function (text, maxUnits) {
    var lines = wrapText(text || ZWSP, maxUnits || this.opts.maxLabelUnits);
    return { mermaid: escLines(lines), plain: lines.join('') };
  };

  /** メッセージ（矢印）を 1 本出力し、対応表に記録する。 */
  Gen.prototype.msg = function (fromId, toId, arrow, text, info, act) {
    var f = this.use(fromId), t = this.use(toId);
    var mark = '';
    if (act === '+') { mark = '+'; this.act.set(t.mId, (this.act.get(t.mId) || 0) + 1); }
    else if (act === '-') {
      var n = this.act.get(f.mId) || 0;
      if (n <= 0) throw new GenError('内部エラー: 非活性のライフライン ' + f.label + ' を非活性化しようとしました。');
      this.act.set(f.mId, n - 1);
      mark = '-';
    }
    var tx = this.fmt(text);
    this.line(f.mId + arrow + mark + t.mId + ': ' + tx.mermaid);

    var rec = Object.assign({ from: fromId, to: toId, mFrom: f.mId, mTo: t.mId, text: tx.plain, arrow: arrow }, info);
    this.msgs.push(rec);
    return rec;
  };

  Gen.prototype.activate = function (llId) {
    var p = this.use(llId);
    this.line('activate ' + p.mId);
    this.act.set(p.mId, (this.act.get(p.mId) || 0) + 1);
  };
  Gen.prototype.deactivate = function (llId) {
    var p = this.use(llId);
    var n = this.act.get(p.mId) || 0;
    if (n <= 0) throw new GenError('内部エラー: 非活性のライフライン ' + p.label + ' を非活性化しようとしました。');
    this.line('deactivate ' + p.mId);
    this.act.set(p.mId, n - 1);
  };

  /** ノート。over は後でライフラインの並び順が決まってから左右端に解決する。 */
  Gen.prototype.note = function (llIds, text, info, position) {
    var self = this;
    var parts = llIds.map(function (id) { return self.use(id); });
    var tx = this.fmt(text, 64);
    this.out.push({ note: true, parts: parts, text: tx.mermaid, position: position || 'over', indent: this.depth });
    this.notes.push(Object.assign({ text: tx.plain, lifelines: llIds.slice() }, info));
  };

  Gen.prototype.frame = function () { return this.stack[this.stack.length - 1]; };

  Gen.prototype.ctxLl = function (step, field) {
    var v = step[field || 'from'];
    if (v) {
      if (!this.ll(v)) throw new GenError('ステップ ' + step.id + ' の ' + (field || 'from') + ' "' + v + '" は未定義のライフラインです。', step.id);
      return v;
    }
    var fr = this.frame();
    if (!fr || !fr.ll) throw new GenError('ステップ ' + step.id + ' の呼び出し元を決定できません（from を指定してください）。', step.id);
    return fr.ll;
  };

  Gen.prototype.isCollapsed = function (step) {
    if (this.collapsed) return this.collapsed.has(step.id);
    return step.collapsed === true;
  };

  Gen.prototype.emitSteps = function (steps) {
    for (var i = 0; i < steps.length; i++) this.emit(steps[i]);
  };

  /** 空の分岐に「処理なし」を明示する（Mermaid 上で区画が潰れないようにする）。 */
  Gen.prototype.emitBranch = function (steps, ownerStep, label) {
    if (!steps || !steps.length) {
      var fr = this.frame();
      var on = fr && fr.ll ? fr.ll : null;
      if (on) this.note([on], label || this.emptyBranchLabel(), { role: 'placeholder', stepId: ownerStep.id });
      return;
    }
    this.emitSteps(steps);
  };

  /** 空の区画に出す文言。break は囲んでいる枠を抜ける（loop の直下なら繰り返しを抜ける）。 */
  Gen.prototype.emptyBranchLabel = function () {
    var k = this.fragKinds;
    if (k[k.length - 1] === 'break') return k[k.length - 2] === 'loop' ? '（繰り返しを抜ける）' : '（以降の処理を行わない）';
    return '（処理なし：後続処理へ合流）';
  };

  Gen.prototype.emit = function (s) {
    switch (s.type) {
      case 'call': return this.emitCall(s);
      case 'self': return this.emitSelf(s);
      case 'db': return this.emitDb(s);
      case 'return': return this.emitReturn(s);
      case 'throw': return this.emitThrow(s);
      case 'try': return this.emitTry(s);
      case 'alt': return this.emitAlt(s);
      case 'opt': return this.emitSimpleFrag('opt', s, s.condition);
      case 'loop': return this.emitSimpleFrag('loop', s, s.condition);
      case 'break': return this.emitSimpleFrag('break', s, s.condition);
      case 'par': return this.emitPar(s);
      case 'critical': return this.emitCritical(s);
      case 'ref': return this.emitRef(s);
      case 'note': return this.emitNote(s);
      case 'transaction': return this.emitTransaction(s);
      case 'tx': return this.emitTx(s);
      case 'lock': return this.emitLock(s);
      case 'await': return this.emitAwait(s);
      case 'group': return this.emitGroup(s);
      default: return undefined;
    }
  };

  Gen.prototype.callLabel = function (s) {
    var to = this.ll(s.to);
    var base = s.label || (to && to.method) || s.to;
    if (this.opts.showArgs && s.args.length) {
      base += '(' + s.args.map(function (a) { return a.name; }).join(', ') + ')';
    }
    if (this.opts.lifelineMode === 'class' && to && to.method && to._classKey !== to.id) {
      base = to.method + '()：' + base;
    }
    return base + evidenceSuffix(s.evidence);
  };

  Gen.prototype.emitCall = function (s) {
    var from = this.ctxLl(s, 'from');
    if (!s.to || !this.ll(s.to)) throw new GenError('call ステップ ' + s.id + ' の to "' + str(s.to) + '" は未定義のライフラインです。', s.id);
    var to = s.to;
    var mode = CALL_MODES.indexOf(s.mode) >= 0 ? s.mode : 'sync';
    var isAsync = mode !== 'sync';
    var arrow = mode === 'callback' ? ARROWS.asyncReply : (isAsync ? ARROWS.async : ARROWS.sync);
    var role = mode === 'sync' ? 'call' : mode;
    this.counter[isAsync ? 'async' : 'call']++;
    this.msg(from, to, arrow, this.callLabel(s), { stepId: s.id, role: role, kind: 'k-' + role, ev: s.evidence.status, forward: true }, '+');

    this.stack.push({ ll: to, caller: from, step: s });
    var inner = s.steps;
    var refInner = null;
    if (s.ref && (!inner || !inner.length)) {
      refInner = this.expandRefs.has(s.id) ? resolveRefInner(this.model, s) : null;
      if (refInner) inner = refInner;
      else {
        var rd = this.ix.diagrams.get(s.ref);
        var over = s.refOver && s.refOver.length ? s.refOver : [to];
        this.note(over, '詳細参照：' + (rd ? rd.title : s.ref), { role: 'ref', stepId: s.id, target: s.ref });
      }
    }
    var last = inner && inner.length ? inner[inner.length - 1] : null;
    var lastIsReturn = last && last.type === 'return';
    var body = lastIsReturn ? inner.slice(0, -1) : (inner || []);
    this.emitSteps(body);
    this.stack.pop();

    // 全経路が throw / 分岐内 return で終わる場合は通常の戻り矢印を出さない（二重表示を防ぐ）
    var term = lastIsReturn ? null : terminationOf(inner);
    if (term) { this.deactivate(to); return; }
    var replyArrow = isAsync ? ARROWS.asyncReply : ARROWS.reply;
    var showReply;
    if (lastIsReturn) showReply = true;
    else if (s.returnArrow === 'never') showReply = false;
    else if (s.returnArrow === 'always') showReply = true;
    else showReply = !isAsync && !!(s.returns || s.returnLabel) && !(s.returns && /^void$/i.test(str(s.returns.type)) && !s.returnLabel);
    if (!this.opts.showReturns && !lastIsReturn) showReply = false;
    if (showReply) {
      var text = lastIsReturn ? (last.label || returnText(last.value ? { returns: last.value } : {}) || returnText(s) || 'return')
        : (returnText(s) || 'return');
      var evStep = lastIsReturn ? last : s;
      this.msg(to, from, replyArrow, text + (lastIsReturn ? evidenceSuffix(last.evidence) : ''), {
        stepId: lastIsReturn ? last.id : s.id, callStepId: s.id, role: 'return', kind: isAsync ? 'k-callback' : 'k-return',
        ev: evStep.evidence ? evStep.evidence.status : 'confirmed'
      }, '-');
    } else {
      this.deactivate(to);
    }
  };

  Gen.prototype.emitSelf = function (s) {
    if (s.minor && this.opts.hideMinor) return;
    var on = this.ctxLl(s, 'on');
    this.counter.self++;
    this.msg(on, on, ARROWS.sync, str(s.label || s.detail || '処理') + evidenceSuffix(s.evidence), {
      stepId: s.id, role: 'self', kind: 'k-self' + (s.category ? ' cat-' + sanitizeId(s.category) : ''), ev: s.evidence.status
    });
  };

  Gen.prototype.emitDb = function (s) {
    var from = this.ctxLl(s, 'from');
    if (!s.to || !this.ll(s.to)) throw new GenError('db ステップ ' + s.id + ' の対象テーブルが不明です（table か to を指定してください）。', s.id);
    var label = s.op + (s.label ? '：' + s.label : '') + (s.lock ? ' ［' + s.lock + '］' : '');
    this.counter.db++;
    this.msg(from, s.to, ARROWS.sync, label + evidenceSuffix(s.evidence), { stepId: s.id, role: 'db', kind: 'k-db op-' + s.op.toLowerCase(), ev: s.evidence.status, forward: true }, '+');
    var show;
    if (s.returnArrow === 'never') show = false;
    else if (s.returnArrow === 'always') show = true;
    else show = s.op === 'SELECT' || !!s.result || !!s.returnLabel;
    if (!this.opts.showReturns && s.op !== 'SELECT' && s.returnArrow !== 'always') show = false;
    if (show) {
      this.msg(s.to, from, ARROWS.reply, dbResultText(s) || '結果', { stepId: s.id, role: 'db-return', kind: 'k-db-return', ev: s.evidence.status }, '-');
    } else {
      this.deactivate(s.to);
    }
  };

  /** 分岐内などメソッド末尾以外での return。活性化は他の経路のために維持する。 */
  Gen.prototype.emitReturn = function (s) {
    var fr = this.frame();
    if (!fr || !fr.caller) throw new GenError('return ステップ ' + s.id + ' は呼び出し（call）の内側に置く必要があります。', s.id);
    var text = s.label || returnText(s.value ? { returns: s.value } : {}) || 'return';
    var isAsync = fr.step && fr.step.mode && fr.step.mode !== 'sync';
    this.msg(fr.ll, fr.caller, isAsync ? ARROWS.asyncReply : ARROWS.reply, 'return：' + text + evidenceSuffix(s.evidence), {
      stepId: s.id, role: 'return-early', kind: 'k-return k-early', ev: s.evidence.status
    });
  };

  /**
   * 例外の送出と、呼び出し元への伝播（propagateTo まで 1 段ずつ矢印を引く）。
   * - rollbackAt: 例外がそのライフライン（@Transactional 境界）を抜ける時点に ROLLBACK を表示する。
   * - propagated: true のとき、この位置では「下位から伝播してきた例外」として表示する。
   * - finally 付き try の中で、そのメソッドを抜ける伝播は finally の後に描く（Java の実行順序に合わせる）。
   */
  Gen.prototype.emitThrow = function (s) {
    var self = this;
    if (this.stack.length < 2 && !s.to) {
      throw new GenError('throw ステップ ' + s.id + ' は呼び出し（call）の内側に置くか、to を指定してください。', s.id);
    }
    this.counter['throw']++;
    var head = (s.propagated ? '例外伝播 ' : '例外 ') + s.exception;
    var label = head + (s.label && s.label !== s.exception ? '：' + s.label : '');
    if (s.to) {
      var origin = s.from || this.frame().ll;
      this.msg(origin, s.to, ARROWS.error, label + evidenceSuffix(s.evidence), { stepId: s.id, role: 'throw', kind: 'k-throw', ev: s.evidence.status });
      return;
    }
    var target = s.propagateTo || null;
    // 送出したメソッド自身の catch で捕捉する（呼び出し元へは伝播しない）
    if (target && target === this.frame().ll) {
      this.msg(target, target, ARROWS.sync, label + '（このメソッドの catch で捕捉）' + evidenceSuffix(s.evidence), {
        stepId: s.id, role: 'throw', kind: 'k-throw', ev: s.evidence.status
      });
      return;
    }
    // メソッド内のブロックで開始したトランザクション（scope: block）の中か
    var blockTx = !!s.rollbackAt && this.txStack.some(function (t) { return t.owner === s.rollbackAt && t.scope === 'block'; });
    var hops = [];
    var i = this.stack.length - 1;
    var found = false;
    while (i >= 1) {
      var fr = this.stack[i];
      hops.push({ from: fr.ll, to: fr.caller, frameIndex: i });
      if (!target || fr.caller === target) { found = true; break; }
      i--;
    }
    if (target && !found) {
      throw new GenError('throw ステップ ' + s.id + ' の propagateTo "' + target + '" が呼び出し階層に存在しません。', s.id);
    }
    // finally による延期: 最も内側の finally 付き try のフレームを抜ける伝播以降を後回しにする
    var defer = this.deferStack.length ? this.deferStack[this.deferStack.length - 1] : null;
    var cut = hops.length;
    if (defer) {
      for (var k = 0; k < hops.length; k++) { if (hops[k].frameIndex === defer.frameIndex) { cut = k; break; } }
    }
    var now = hops.slice(0, cut);
    var later = hops.slice(cut);
    this.emitHops(s, now, label, 0, blockTx);
    if (later.length) {
      this.msg(later[0].from, later[0].from, ARROWS.sync, label + '（finally 実行後に呼び出し元へ伝播）' + evidenceSuffix(s.evidence), {
        stepId: s.id, role: 'throw-deferred', kind: 'k-throw', ev: s.evidence.status
      });
      defer.items.push({ step: s, hops: later, label: label, offset: now.length, blockTx: blockTx });
    }
  };

  /**
   * 伝播の矢印を描き、rollbackAt のライフラインを抜ける位置に ROLLBACK ノートを入れる。
   * メソッド単位のトランザクション（@Transactional のプロキシ）は抜ける矢印の後、
   * メソッド内のブロック（scope: block）は抜ける矢印の前（ブロックを出た時点）に置く。
   */
  Gen.prototype.emitHops = function (s, hops, label, offset, blockTx) {
    var self = this;
    hops.forEach(function (h, idx) {
      var n = idx + offset;
      if (blockTx && s.rollbackAt && h.from === s.rollbackAt) {
        self.note([h.from], 'ROLLBACK（例外がトランザクションのブロックを抜けた時点）' + (s.rollbackLabel ? '：' + s.rollbackLabel : '：' + s.exception + ' により'), { role: 'tx-rollback', stepId: s.id });
      }
      self.msg(h.from, h.to, ARROWS.error, (n === 0 ? label : '例外伝播 ' + s.exception) + (n === 0 ? evidenceSuffix(s.evidence) : ''), {
        stepId: s.id, role: n === 0 ? 'throw' : 'throw-propagate', kind: 'k-throw', ev: s.evidence.status
      });
      // 例外がトランザクション境界（rollbackAt）を抜けた時点で ROLLBACK される（時系列どおり矢印の後に置く）
      if (!blockTx && s.rollbackAt && h.from === s.rollbackAt) {
        self.note([h.from], 'ROLLBACK（例外が境界を抜けた時点）' + (s.rollbackLabel ? '：' + s.rollbackLabel : '：' + s.exception + ' により'), { role: 'tx-rollback', stepId: s.id });
      }
    });
  };

  Gen.prototype.fragStart = function (keyword, text) {
    this.line(keyword + ' ' + escFragment(text));
    this.depth++;
    this.fragKinds.push(keyword);
  };
  Gen.prototype.fragSection = function (keyword, text) {
    this.depth--;
    this.line(keyword + ' ' + escFragment(text));
    this.depth++;
  };
  Gen.prototype.fragEnd = function (info) {
    this.depth--;
    this.fragKinds.pop();
    this.line('end');
    this.counter.fragments++;
    this.frags.push(info);
  };

  Gen.prototype.emitSimpleFrag = function (keyword, s, cond) {
    var text = fragmentCondition(cond, s.expr, s.evidence, this.opts, keyword === 'loop' ? '' : terminationSuffix(s.steps));
    this.fragStart(keyword, text);
    this.emitBranch(s.steps, s);
    this.fragEnd({ stepId: s.id, keyword: keyword, role: keyword, sections: [text] });
  };

  Gen.prototype.emitAlt = function (s) {
    var self = this;
    if (!s.branches.length) { this.note([this.ctxLl(s, 'on')], '（条件分岐の分岐が未定義）', { role: 'placeholder', stepId: s.id }); return; }
    var texts = [];
    s.branches.forEach(function (b, i) {
      var t = fragmentCondition(b.condition || (b['else'] ? 'それ以外' : ''), b.expr, b.evidence || (i === 0 ? s.evidence : null), self.opts, terminationSuffix(b.steps));
      texts.push(t);
      if (i === 0) self.fragStart('alt', t); else self.fragSection('else', t);
      self.emitBranch(b.steps, s);
    });
    this.fragEnd({ stepId: s.id, keyword: 'alt', role: 'alt', sections: texts });
  };

  Gen.prototype.emitPar = function (s) {
    var self = this;
    if (!s.branches.length) return;
    var texts = [];
    s.branches.forEach(function (b, i) {
      var t = fragmentCondition(b.label || ('並列' + (i + 1)), null, b.evidence || (i === 0 ? s.evidence : null), self.opts, '');
      texts.push(t);
      if (i === 0) self.fragStart('par', t); else self.fragSection('and', t);
      self.emitBranch(b.steps, s);
    });
    this.fragEnd({ stepId: s.id, keyword: 'par', role: 'par', sections: texts });
  };

  Gen.prototype.emitCritical = function (s) {
    var self = this;
    var lockText = s.lock && (s.lock.mechanism || s.lock.resource) ? '（' + [s.lock.resource, s.lock.mechanism].filter(Boolean).join('／') + '）' : '';
    var head = fragmentCondition((s.label || s.condition || '排他区間') + lockText, s.expr, s.evidence, this.opts, '');
    var texts = [head];
    this.fragStart('critical', head);
    this.emitBranch(s.steps, s);
    s.options.forEach(function (o) {
      var t = fragmentCondition(o.condition, o.expr, o.evidence, self.opts, terminationSuffix(o.steps));
      texts.push(t);
      self.fragSection('option', t);
      self.emitBranch(o.steps, s);
    });
    this.fragEnd({ stepId: s.id, keyword: 'critical', role: 'critical', sections: texts });
  };

  /**
   * try/catch は alt（正常時 / 例外捕捉時）で、finally は背景帯 + ノートで表す。
   * finally がある場合、メソッドの外へ出ていく例外の伝播は finally の後に break 枠で描く。
   */
  Gen.prototype.emitTry = function (s) {
    var self = this;
    var on = this.frame() && this.frame().ll ? this.frame().ll : this.ctxLl(s, 'on');
    var defer = null;
    if (s['finally']) {
      defer = { frameIndex: this.stack.length - 1, items: [] };
      this.deferStack.push(defer);
    }
    if (s.catches.length) {
      var texts = [];
      var t0 = fragmentCondition('try：' + (s.label || '正常終了時'), null, s.evidence, this.opts, '');
      texts.push(t0);
      this.fragStart('alt', t0);
      this.emitBranch(s.steps, s);
      s.catches.forEach(function (c) {
        var t = fragmentCondition('catch ' + str(c.exception || 'Exception') + (c.label ? '：' + c.label : ''), null, c.evidence, self.opts, terminationSuffix(c.steps));
        texts.push(t);
        self.fragSection('else', t);
        self.emitBranch(c.steps, s);
      });
      this.fragEnd({ stepId: s.id, keyword: 'alt', role: 'try', sections: texts });
    } else {
      this.line('rect ' + RECT_COLORS[this.theme].tryOnly);
      this.depth++;
      this.note([on], 'try' + (s.label ? '：' + s.label : '') + '（catch なし）', { role: 'try', stepId: s.id });
      this.emitSteps(s.steps);
      this.depth--;
      this.line('end');
    }
    if (defer) this.deferStack.pop();
    if (s['finally']) {
      this.line('rect ' + RECT_COLORS[this.theme].fin);
      this.depth++;
      this.note([on], 'finally：例外の有無に関わらず実行' + (s['finally'].label ? '（' + s['finally'].label + '）' : ''), { role: 'finally', stepId: s.id });
      this.emitSteps(s['finally'].steps);
      this.depth--;
      this.line('end');
      defer.items.forEach(function (it) {
        var cond = it.step.exception + ' が送出された場合（finally の後に伝播）';
        self.fragStart('break', cond + evidenceSuffix(it.step.evidence));
        self.emitHops(it.step, it.hops, it.label, it.offset, it.blockTx);
        self.fragEnd({ stepId: it.step.id, keyword: 'break', role: 'deferred-throw', sections: [cond] });
      });
    }
  };

  Gen.prototype.emitRef = function (s) {
    var rd = this.ix.diagrams.get(s.diagram);
    var over = s.over.length ? s.over : [this.ctxLl(s, 'on')];
    this.note(over, '詳細参照：' + (s.label || (rd ? rd.title : s.diagram)), { role: 'ref', stepId: s.id, target: s.diagram });
  };

  Gen.prototype.emitNote = function (s) {
    var position = s.position === 'left' || s.position === 'right' ? s.position : 'over';
    var over = s.over.length ? s.over : [this.ctxLl(s, 'on')];
    // 注記にも根拠を付けられる（要確認の注記などで推定・未確認を明示するため）
    this.note(over, str(s.text || s.label) + evidenceSuffix(s.evidence), { role: s._invalidType ? 'invalid' : 'note', stepId: s.id }, position);
  };

  Gen.prototype.emitTransaction = function (s) {
    var owner = this.ctxLl(s, 'on');
    var attrs = [s.propagation, s.isolation, s.readOnly ? 'readOnly' : null, s.timeout ? 'timeout=' + s.timeout : null].filter(Boolean).join(', ');
    this.line('rect ' + RECT_COLORS[this.theme].tx);
    this.depth++;
    this.note([owner], 'TX開始：' + (s.label || 'トランザクション') + (attrs ? '［' + attrs + '］' : '') + evidenceSuffix(s.evidence), { role: 'tx-begin', stepId: s.id });
    this.txStack.push({ owner: owner, scope: s.scope === 'block' ? 'block' : 'method' });
    this.emitSteps(s.steps);
    this.txStack.pop();
    var end = s.end || 'commit';
    if (end === 'commit') this.note([owner], 'COMMIT' + (s.commitLabel ? '：' + s.commitLabel : '（正常終了時）'), { role: 'tx-commit', stepId: s.id });
    else if (end === 'rollback') this.note([owner], 'ROLLBACK' + (s.commitLabel ? '：' + s.commitLabel : ''), { role: 'tx-rollback', stepId: s.id });
    this.depth--;
    this.line('end');
  };

  Gen.prototype.emitTx = function (s) {
    var on = this.ctxLl(s, 'on');
    var names = { begin: 'TX開始', commit: 'COMMIT', rollback: 'ROLLBACK', savepoint: 'SAVEPOINT', flush: 'FLUSH' };
    var text = (names[s.action] || str(s.action).toUpperCase()) + (s.label ? '：' + s.label : '') + evidenceSuffix(s.evidence);
    this.note([on], text, { role: 'tx-' + sanitizeId(s.action), stepId: s.id });
  };

  Gen.prototype.emitLock = function (s) {
    var on = this.ctxLl(s, 'on');
    var verb = { acquire: 'ロック取得', release: 'ロック解放', wait: 'ロック待機' }[s.action] || ('ロック' + s.action);
    var text = verb + '：' + str(s.resource || s.label || '') + (s.mechanism ? '［' + s.mechanism + '］' : '');
    this.msg(on, on, ARROWS.sync, text + evidenceSuffix(s.evidence), { stepId: s.id, role: 'lock', kind: 'k-lock', ev: s.evidence.status });
  };

  /** 非同期処理の完了待ち。target（単数または配列）の完了通知を点線の開いた矢印で描く。 */
  Gen.prototype.emitAwait = function (s) {
    var self = this;
    var on = this.ctxLl(s, 'on');
    var targets = arr(s.target).map(function (t) { return self.ix.steps.get(t); }).filter(Boolean);
    var defLabel = targets.length ? targets.map(function (t) { return t.label || '非同期処理'; }).join('・') : '非同期処理';
    this.msg(on, on, ARROWS.sync, '完了待ち：' + str(s.label || defLabel) + evidenceSuffix(s.evidence), {
      stepId: s.id, role: 'await', kind: 'k-await', ev: s.evidence.status
    });
    if (s.showResults === false) return;
    targets.forEach(function (t) {
      if (!t.to) return;
      var r = (s.resultLabels && s.resultLabels[t.id]) || returnText(t) || '完了';
      self.msg(t.to, on, ARROWS.asyncReply, '完了：' + r, { stepId: s.id, role: 'await-result', kind: 'k-callback', ev: s.evidence.status });
    });
  };

  Gen.prototype.emitGroup = function (s) {
    var involved = collectLifelines(s.steps, this.frame() ? this.frame().ll : null);
    if (!involved.length) involved = [this.ctxLl(s, 'on')];
    if (this.isCollapsed(s)) {
      var c = countMessages(s.steps);
      this.note(involved, '▶ ' + str(s.label || 'グループ') + '（集約：' + c.messages + '件のメッセージ' + (c.db ? '・DB操作' + c.db + '件' : '') + '）', { role: 'group-collapsed', stepId: s.id });
      return;
    }
    this.line('rect ' + RECT_COLORS[this.theme].group);
    this.depth++;
    this.note(involved, '▼ ' + str(s.label || 'グループ'), { role: 'group', stepId: s.id });
    this.emitSteps(s.steps);
    this.depth--;
    this.line('end');
  };

  /**
   * ライフラインの並び順を決める。
   * レイヤー順（左: クライアント → 右: DB・外部）を第1キー、呼び出しの初出順（深さ優先）を第2キーにする。
   * 初出順は「呼び出し元が呼び出し先より左」になり、処理を左から右へ読める。距離最小化の入れ替えは
   * 主経路を押しのけて例外経路を優先することがあるため行わない（必要なら diagram.participants で明示）。
   */
  Gen.prototype.order = function () {
    var self = this;
    var parts = Array.from(this.parts.values());
    var ix = this.ix;
    var rankOf = function (p) { var l = ix.layers.get(p.layer); return l ? l._rank : 999; };
    var explicit = this.d.participants;
    var ordered;
    if (explicit && explicit.length) {
      var seen = new Set();
      ordered = [];
      explicit.forEach(function (id) {
        if (!self.ll(id)) { self.warnings.push('participants に未定義のライフライン "' + id + '" があります。'); return; }
        var k = self.key(id);
        if (self.parts.has(k) && !seen.has(k)) { seen.add(k); ordered.push(self.parts.get(k)); }
      });
      parts.sort(function (a, b) { return a.first - b.first; }).forEach(function (p) {
        if (!seen.has(p.key)) { ordered.push(p); seen.add(p.key); }
      });
      return ordered;
    }
    var entryKey = this.entry && this.ll(this.entry) ? this.key(this.entry) : null;
    ordered = parts.slice().sort(function (a, b) {
      if (a.key === entryKey) return -1;
      if (b.key === entryKey) return 1;
      return rankOf(a) - rankOf(b) || a.first - b.first;
    });
    return ordered;
  };

  Gen.prototype.participantLine = function (p) {
    // ライフライン自体の推定/未確認は明示指定された場合のみ表示する（実装クラス不明など）
    var label = p.label + (p.evidence && p.evidence._explicit && this.opts.lifelineMode === 'method' ? evidenceSuffix(p.evidence) : '');
    var alias = splitParticipantLabel(label).map(escText).join('<br/>');
    if (p.type === 'actor') return 'actor ' + p.mId + ' as ' + alias;
    // DB・キューも通常の participant で描く。Mermaid 11.17.2 の database / queue 型は、名前が長いと
    // アイコンとラベルが重なるため使わない（種別の区別は「DB：」等の表記とビューアの配色で行う）。
    return 'participant ' + p.mId + ' as ' + alias;
  };

  Gen.prototype.run = function () {
    var d = this.d;
    var entry = d.entry;
    if (!entry) {
      var first = null;
      walkSteps(d.steps, function (s) { if (!first && (s.type === 'call' || s.type === 'db') && s.from) first = s.from; });
      entry = first;
    }
    if (entry && !this.ll(entry)) throw new GenError('図 ' + d.id + ' の entry "' + entry + '" は未定義のライフラインです。');
    this.entry = entry || null;
    this.stack.push({ ll: entry || null, caller: null, step: null });
    if (entry) this.use(entry);
    this.emitSteps(d.steps);
    this.stack.pop();

    // 活性化の残りを閉じる（モデルの構造上は起きないが、安全側に倒す）
    var self = this;
    this.act.forEach(function (n, mId) {
      for (var i = 0; i < n; i++) { self.out.push('  deactivate ' + mId); self.warnings.push('活性化が閉じられていないライフライン ' + mId + ' を自動で閉じました。'); }
    });

    var ordered = this.order();
    var pos = new Map();
    ordered.forEach(function (p, i) { pos.set(p.mId, i); });

    var head = ['sequenceDiagram'];
    head.push('  %% generated by sequence-diagram skill core ' + VERSION + ' / diagram: ' + d.id);
    if (this.opts.autonumber) head.push('  autonumber');
    var layers = this.ix.layers;
    var theme = this.theme;
    var i = 0;
    while (i < ordered.length) {
      var p = ordered[i];
      var layer = layers.get(p.layer);
      var j = i;
      while (j + 1 < ordered.length && ordered[j + 1].layer === p.layer) j++;
      // 人（actor）だけのグループは囲まない（囲みの見出しとアクター名が二重に表示されるため）
      var onlyActors = true;
      for (var q = i; q <= j; q++) if (ordered[q].type !== 'actor') onlyActors = false;
      if (this.opts.boxes && layer && !onlyActors) {
        head.push('  box ' + boxColor(layer.color, theme) + ' ' + escText(layer.label));
        for (var k = i; k <= j; k++) head.push('    ' + this.participantLine(ordered[k]));
        head.push('  end');
      } else {
        for (var k2 = i; k2 <= j; k2++) head.push('  ' + this.participantLine(ordered[k2]));
      }
      i = j + 1;
    }

    var body = this.out.map(function (o) {
      if (typeof o === 'string') return o;
      var ind = new Array(o.indent + 1).join('  ');
      if (o.position === 'left' || o.position === 'right') {
        return ind + 'Note ' + o.position + ' of ' + o.parts[0].mId + ': ' + o.text;
      }
      var ps = o.parts.slice().sort(function (a, b) { return pos.get(a.mId) - pos.get(b.mId); });
      var a = ps[0].mId, b = ps[ps.length - 1].mId;
      return ind + 'Note over ' + (a === b ? a : a + ',' + b) + ': ' + o.text;
    });

    var participants = ordered.map(function (p) {
      return { key: p.key, mId: p.mId, label: p.label, layer: p.layer, type: p.type, lifelines: p.llIds.slice() };
    });
    return {
      text: head.concat(body).join('\n') + '\n',
      map: { messages: this.msgs, notes: this.notes, fragments: this.frags, participants: participants },
      stats: Object.assign({ messages: this.msgs.length, participants: participants.length, notes: this.notes.length }, this.counter),
      warnings: this.warnings
    };
  };

  /**
   * ライフライン名を「種別：」「クラス名.」「メソッド名」の位置で折り返し、横幅を抑える。
   * 表示形式（種別：クラス名.メソッド名）の文字列はそのまま保つ（改行位置を入れるだけ）。
   */
  var PARTICIPANT_LINE_UNITS = 24;
  function splitParticipantLabel(label) {
    if (textUnits(label) <= PARTICIPANT_LINE_UNITS) return [label];
    var lines = [];
    var rest = label;
    var c = rest.indexOf('：');
    if (c > 0 && c < rest.length - 1) { lines.push(rest.slice(0, c + 1)); rest = rest.slice(c + 1); }
    if (textUnits(rest) > PARTICIPANT_LINE_UNITS) {
      // 〔推定〕などの付記と、引数リストの前で区切る
      var paren = rest.indexOf('(');
      var head = paren > 0 ? rest.slice(0, paren) : rest;
      var dot = head.lastIndexOf('.');
      if (dot > 0) { lines.push(rest.slice(0, dot + 1)); rest = rest.slice(dot + 1); }
    }
    wrapText(rest, PARTICIPANT_LINE_UNITS + 6).forEach(function (l) { lines.push(l); });
    return lines;
  }

  function boxColor(hex, theme) {
    var rgb = hexToRgb(hex) || [100, 116, 139];
    return 'rgba(' + rgb.join(',') + ',' + (theme === 'dark' ? '0.07' : '0.045') + ')';
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(str(hex).trim());
    if (!m) {
      var s = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(str(hex).trim());
      if (!s) return null;
      return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)];
    }
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function GenError(message, stepId) {
    this.name = 'GenError';
    this.message = message;
    this.stepId = stepId;
  }
  GenError.prototype = Object.create(Error.prototype);

  function collectLifelines(steps, fallback) {
    var set = [];
    function add(id) { if (id && set.indexOf(id) < 0) set.push(id); }
    walkSteps(steps, function (s) {
      if (s.type === 'call' || s.type === 'db') { add(s.from || fallback); add(s.to); }
      else if (s.type === 'self' || s.type === 'lock' || s.type === 'await') add(s.on || fallback);
    });
    return set;
  }

  function countMessages(steps) {
    var c = { messages: 0, db: 0 };
    walkSteps(steps, function (s) {
      if (s.type === 'call') c.messages += 2;
      else if (s.type === 'db') { c.messages += 2; c.db++; }
      else if (s.type === 'self' || s.type === 'return' || s.type === 'throw' || s.type === 'lock' || s.type === 'await') c.messages++;
    });
    return c;
  }

  /** call.ref の参照先図から、同じ呼び出し先の内部処理（steps）を取り出す（その場展開用）。 */
  function resolveRefInner(model, callStep) {
    var d = model._index.diagrams.get(callStep.ref);
    if (!d) return null;
    var found = null;
    walkSteps(d.steps, function (s) {
      if (!found && s.type === 'call' && s.to === callStep.to && s.steps && s.steps.length) found = s.steps;
    });
    return found;
  }

  function generate(model, diagramId, options) {
    if (!model || !model._normalized) model = normalize(model);
    var d = model._index.diagrams.get(diagramId);
    if (!d) throw new GenError('図 "' + diagramId + '" は存在しません。');
    var opts = Object.assign({}, DEFAULT_GEN_OPTIONS, options || {});
    var g = new Gen(model, d, opts);
    return g.run();
  }

  // ---------------------------------------------------------------------------
  // 検証
  // ---------------------------------------------------------------------------

  function validate(model) {
    if (!model || !model._normalized) model = normalize(model);
    var errors = [], warnings = [], infos = [];
    function push(level, o) { (level === 'error' ? errors : level === 'warning' ? warnings : infos).push(o); }
    model._issues.forEach(function (i) { push(i.level, i); });

    var ix = model._index;
    var used = new Set();
    var idRe = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;

    model.lifelines.forEach(function (ll) {
      if (!idRe.test(ll.id)) push('warning', { code: 'lifeline.idFormat', message: 'ライフライン ID "' + ll.id + '" は英数字・_・-・. のみを推奨します。', lifelineId: ll.id });
      if (LIFELINE_TYPES.indexOf(ll.type) < 0) push('error', { code: 'lifeline.type', message: 'ライフライン ' + ll.id + ' の type "' + ll.type + '" は未対応です（' + LIFELINE_TYPES.join(', ') + '）。', lifelineId: ll.id });
      if (ll.type === 'method' && !ll.method && !ll.label) push('warning', { code: 'lifeline.noMethod', message: 'メソッド型ライフライン ' + ll.id + ' に method がありません（表示形式は「種別：クラス名.メソッド名」）。', lifelineId: ll.id });
      if (ll.type === 'db' && !ll.name) push('error', { code: 'lifeline.noTable', message: 'DB ライフライン ' + ll.id + ' にテーブル名(name)がありません。', lifelineId: ll.id });
      EVIDENCE_STATUSES.indexOf(ll.evidence.status) < 0 && push('error', { code: 'evidence.status', message: 'ライフライン ' + ll.id + ' の evidence.status が不正です。', lifelineId: ll.id });
    });

    function checkLl(id, step, field, d) {
      if (!id) return;
      used.add(id);
      if (!ix.lifelines.has(id)) push('error', { code: 'step.unknownLifeline', message: 'ステップ ' + step.id + ' の ' + field + ' "' + id + '" は未定義のライフラインです。', stepId: step.id, diagramId: d.id });
    }

    model.diagrams.forEach(function (d) {
      if (!/^[A-Za-z0-9_\-]+$/.test(d.id)) push('warning', { code: 'diagram.idFormat', message: '図 ID "' + d.id + '" は英数字・_・- のみを推奨します。', diagramId: d.id });
      if (d.entry) checkLl(d.entry, { id: '(entry)' }, 'entry', d);
      if (!d.steps.length) push('warning', { code: 'diagram.empty', message: '図 ' + d.id + ' にステップがありません。', diagramId: d.id });
      var stepCount = 0;
      walkSteps(d.steps, function (s, parent) {
        stepCount++;
        var where = { stepId: s.id, diagramId: d.id };
        if (s.evidence && EVIDENCE_STATUSES.indexOf(s.evidence.status) < 0) push('error', Object.assign({ code: 'evidence.status', message: 'ステップ ' + s.id + ' の evidence.status "' + s.evidence.status + '" が不正です（confirmed / inferred / unverified）。' }, where));
        if (s.evidence && s.evidence._explicit && s.evidence.status === 'confirmed' && !s.evidence.refs.length) push('warning', Object.assign({ code: 'evidence.noRefs', message: 'ステップ ' + s.id + ' は確認済み(confirmed)ですが根拠(refs)がありません。' }, where));
        switch (s.type) {
          case 'call':
            checkLl(s.from, s, 'from', d); checkLl(s.to, s, 'to', d);
            if (!s.to) push('error', Object.assign({ code: 'call.noTo', message: 'call ステップ ' + s.id + ' に to がありません。' }, where));
            if (CALL_MODES.indexOf(s.mode) < 0) push('error', Object.assign({ code: 'call.mode', message: 'call ステップ ' + s.id + ' の mode "' + s.mode + '" は未対応です（' + CALL_MODES.join(', ') + '）。' }, where));
            if (!s.label) push('warning', Object.assign({ code: 'call.noLabel', message: 'call ステップ ' + s.id + ' に label（処理概要）がありません。' }, where));
            if (s.label && textUnits(s.label) > 60) push('warning', Object.assign({ code: 'label.long', message: 'call ステップ ' + s.id + ' の label が長すぎます（矢印には概要のみ。詳細は purpose へ）。' }, where));
            if (s.ref && !ix.diagrams.has(s.ref)) push('error', Object.assign({ code: 'ref.unknown', message: 'call ステップ ' + s.id + ' の ref "' + s.ref + '" は存在しない図です。' }, where));
            if (s.ref && s.ref === d.id) push('error', Object.assign({ code: 'ref.self', message: 'call ステップ ' + s.id + ' が自分自身の図を参照しています。' }, where));
            if (s.ref && s.steps.length) push('warning', Object.assign({ code: 'call.refAndSteps', message: 'call ステップ ' + s.id + ' に ref と steps の両方があります（steps を優先して描画します）。' }, where));
            s.args.forEach(function (a, i) { if (!a.name) push('warning', Object.assign({ code: 'arg.noName', message: 'call ステップ ' + s.id + ' の args[' + i + '] に name がありません。' }, where)); });
            break;
          case 'db':
            checkLl(s.from, s, 'from', d); checkLl(s.to, s, 'to', d);
            if (!s.to) push('error', Object.assign({ code: 'db.noTable', message: 'db ステップ ' + s.id + ' に table がありません。' }, where));
            if (DB_OPS.indexOf(s.op) < 0) push('warning', Object.assign({ code: 'db.op', message: 'db ステップ ' + s.id + ' の op "' + s.op + '" は標準外です（' + DB_OPS.join(', ') + '）。' }, where));
            if ((s.op === 'UPDATE' || s.op === 'DELETE') && !s.where) push('warning', Object.assign({ code: 'db.noWhere', message: 'db ステップ ' + s.id + '（' + s.op + '）に where（対象条件）がありません。全件対象なら where に明記してください。' }, where));
            if (s.to && ix.lifelines.has(s.to) && ix.lifelines.get(s.to).type !== 'db') push('warning', Object.assign({ code: 'db.notDbLifeline', message: 'db ステップ ' + s.id + ' の対象 ' + s.to + ' は type=db のライフラインではありません。' }, where));
            break;
          case 'self': case 'lock': case 'await':
            checkLl(s.on, s, 'on', d);
            if (s.type === 'self' && !s.label) push('warning', Object.assign({ code: 'self.noLabel', message: '自己メッセージ ' + s.id + ' に label がありません。' }, where));
            if (s.type === 'await' && s.target) {
              arr(s.target).forEach(function (tid) {
                var t = ix.steps.get(tid);
                if (!t) push('error', Object.assign({ code: 'await.target', message: 'await ステップ ' + s.id + ' の target "' + tid + '" が見つかりません。' }, where));
                else if (t.type !== 'call' || t.mode === 'sync') push('warning', Object.assign({ code: 'await.notAsync', message: 'await ステップ ' + s.id + ' の target "' + tid + '" は非同期 call ではありません。' }, where));
              });
            }
            break;
          case 'alt':
            if (!s.branches.length) push('error', Object.assign({ code: 'alt.noBranches', message: 'alt ステップ ' + s.id + ' に branches がありません。' }, where));
            if (s.branches.length === 1) push('warning', Object.assign({ code: 'alt.single', message: 'alt ステップ ' + s.id + ' は分岐が 1 つだけです（else が無いなら opt、処理が終わるなら break を検討）。' }, where));
            s.branches.forEach(function (b, i) { if (!b.condition && !b['else']) push('warning', Object.assign({ code: 'alt.noCondition', message: 'alt ステップ ' + s.id + ' の branches[' + i + '] に condition がありません。' }, where)); });
            break;
          case 'par':
            if (s.branches.length < 2) push('warning', Object.assign({ code: 'par.single', message: 'par ステップ ' + s.id + ' の分岐が 2 未満です。並列処理でなければ par を使わないでください。' }, where));
            break;
          case 'critical':
            if (!s.lock) push('warning', Object.assign({ code: 'critical.noLock', message: 'critical（排他処理）ステップ ' + s.id + ' に lock（排他制御の仕組み・対象）がありません。排他制御が確認できない場合は critical を使わないでください。' }, where));
            break;
          case 'opt': case 'loop': case 'break':
            if (!s.condition) push('warning', Object.assign({ code: s.type + '.noCondition', message: s.type + ' ステップ ' + s.id + ' に condition がありません。' }, where));
            break;
          case 'ref':
            if (!s.diagram) push('error', Object.assign({ code: 'ref.noDiagram', message: 'ref ステップ ' + s.id + ' に diagram がありません。' }, where));
            else if (!ix.diagrams.has(s.diagram)) push('error', Object.assign({ code: 'ref.unknown', message: 'ref ステップ ' + s.id + ' の diagram "' + s.diagram + '" は存在しません。' }, where));
            s.over.forEach(function (o) { checkLl(o, s, 'over', d); });
            break;
          case 'note':
            s.over.forEach(function (o) { checkLl(o, s, 'over', d); });
            if (!s.text && !s.label) push('warning', Object.assign({ code: 'note.empty', message: 'note ステップ ' + s.id + ' に text がありません。' }, where));
            break;
          case 'transaction': case 'tx':
            checkLl(s.on, s, 'on', d);
            break;
          case 'throw':
            if (s.propagateTo) checkLl(s.propagateTo, s, 'propagateTo', d);
            if (s.rollbackAt) checkLl(s.rollbackAt, s, 'rollbackAt', d);
            if (s.to) checkLl(s.to, s, 'to', d);
            break;
          case 'group':
            if (!s.label) push('warning', Object.assign({ code: 'group.noLabel', message: 'group ステップ ' + s.id + ' に label がありません。' }, where));
            break;
          default: break;
        }
      });
      // 到達不能ステップ（同じ並びで return / throw の後ろにある処理）
      walkLists(d.steps, function (list) {
        var termAt = -1;
        list.forEach(function (s, i) {
          if (termAt >= 0 && ['note', 'tx', 'lock'].indexOf(s.type) < 0) {
            push('warning', { code: 'step.unreachable', message: 'ステップ ' + s.id + ' は同じ並びの return / throw の後ろにあり、実行されません。', stepId: s.id, diagramId: d.id });
          }
          if (termAt < 0 && (s.type === 'return' || s.type === 'throw')) termAt = i;
        });
      });
      void stepCount;
    });

    // 生成テスト（各図を既定オプションと class モードで生成できるか）
    model.diagrams.forEach(function (d) {
      ['method', 'class'].forEach(function (mode) {
        try {
          var g = generate(model, d.id, { lifelineMode: mode });
          if (mode === 'method') {
            g.warnings.forEach(function (w) { push('warning', { code: 'gen.warning', message: '図 ' + d.id + ': ' + w, diagramId: d.id }); });
            if (g.stats.participants > 24) push('warning', { code: 'diagram.manyLifelines', message: '図 ' + d.id + ' のライフラインが ' + g.stats.participants + ' 本あります。詳細図への分割（ref）を検討してください。', diagramId: d.id });
            if (g.stats.messages > 180) push('warning', { code: 'diagram.manyMessages', message: '図 ' + d.id + ' のメッセージが ' + g.stats.messages + ' 件あります。詳細図への分割（ref）または group の折りたたみを検討してください。', diagramId: d.id });
          }
        } catch (e) {
          push('error', { code: 'gen.error', message: '図 ' + d.id + '（' + mode + 'モード）の生成に失敗: ' + e.message, diagramId: d.id, stepId: e.stepId });
        }
      });
    });

    model.lifelines.forEach(function (ll) {
      if (!used.has(ll.id) && !ll._auto) {
        var referenced = model.diagrams.some(function (d) { return d.entry === ll.id || arr(d.participants).indexOf(ll.id) >= 0; });
        if (!referenced) push('warning', { code: 'lifeline.unused', message: 'ライフライン ' + ll.id + ' はどの図でも使われていません。', lifelineId: ll.id });
      }
    });

    // 根拠の集計
    var evCount = { confirmed: 0, inferred: 0, unverified: 0 };
    model._index.steps.forEach(function (s) { if (s.evidence) evCount[s.evidence.status] = (evCount[s.evidence.status] || 0) + 1; });
    if (evCount.unverified) push('info', { code: 'evidence.unverified', message: '未確認(unverified)のステップが ' + evCount.unverified + ' 件あります（図中に〔未確認〕と表示）。' });
    if (evCount.inferred) push('info', { code: 'evidence.inferred', message: '推定(inferred)のステップが ' + evCount.inferred + ' 件あります（図中に〔推定〕と表示）。' });

    return { ok: errors.length === 0, errors: errors, warnings: warnings, infos: infos, evidence: evCount };
  }

  /** すべてのステップ並び（配列）を走査する。 */
  function walkLists(steps, fn) {
    fn(steps);
    steps.forEach(function (s) { childLists(s).forEach(function (cl) { walkLists(cl.steps, fn); }); });
  }

  // ---------------------------------------------------------------------------
  // 検索用テキスト（ビューアとCLIの両方で使用）
  // ---------------------------------------------------------------------------

  function stepSearchText(model, s) {
    var parts = [s.id, s.type, s.label, s.purpose, s.detail, s.condition, s.expr, s.text, s.exception, s.op, s.table, s.where,
      s.sql, s.lock && JSON.stringify(s.lock), s.via, s.code, s.note, s.category];
    var ll = model._index.lifelines;
    ['from', 'to', 'on'].forEach(function (k) { if (s[k] && ll.has(s[k])) parts.push(ll.get(s[k])._label); });
    arr(s.args).forEach(function (a) { parts.push(a.name, a.jpName, a.type, a.description); });
    if (s.returns) parts.push(s.returns.name, s.returns.jpName, s.returns.type, s.returns.description);
    if (s.result) parts.push(s.result.name, s.result.jpName, s.result.type);
    arr(s.columns).forEach(function (c) { parts.push(c); });
    arr(s.joins).forEach(function (c) { parts.push(c); });
    arr(s.branches).forEach(function (b) { parts.push(b.condition, b.label, b.expr); });
    arr(s.catches).forEach(function (c) { parts.push(c.exception, c.label); });
    arr(s.options).forEach(function (o) { parts.push(o.condition, o.expr); });
    if (s.evidence) s.evidence.refs.forEach(function (r) { parts.push(refToString(r)); });
    return parts.filter(Boolean).join(' \u0001 ');
  }

  return {
    VERSION: VERSION,
    MERMAID_VERSION: MERMAID_VERSION,
    DEFAULT_LAYERS: DEFAULT_LAYERS,
    FRAGMENT_LABELS: FRAGMENT_LABELS,
    EVIDENCE_LABELS: EVIDENCE_LABELS,
    STEP_TYPES: STEP_TYPES,
    DEFAULT_GEN_OPTIONS: DEFAULT_GEN_OPTIONS,
    normalize: normalize,
    validate: validate,
    generate: generate,
    walkSteps: walkSteps,
    childLists: childLists,
    refToString: refToString,
    parseRef: parseRef,
    stepSearchText: stepSearchText,
    resolveRefInner: resolveRefInner,
    textUnits: textUnits,
    wrapText: wrapText,
    escText: escText,
    hexToRgb: hexToRgb
  };
});
