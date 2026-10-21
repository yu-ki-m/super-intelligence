// FlowTS 0.4（.flow.ts）のソースから、関数・ラベル付きブロック・goto・実施などを取り出す。
// TypeScript の完全な構文解析はしない。FlowTS の検査と図に要る範囲だけを読む。
//
// 図の単位（ここでは「ステップ」と呼ぶ）は、関数本体の直下にあるラベル付きブロックと、
// ラベルの外に続く文のまとまり（関数の先頭の「開始」、ラベルの後ろに続く文）。
// 0.4 で足された引数付きのラベル（`名前(引数: 型): { … }`）と goto（`goto 名前(式);`）も読む。

const ID_START = /[\p{L}\p{Nl}$_]/u;
const ID_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_‌‍]/u;
const PUNCT3 = new Set(['===', '!==', '...', '**=', '&&=', '||=', '??=']);
const PUNCT2 = new Set(['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**']);
// この字句の後の / は正規表現の始まり
const REGEX_AFTER = new Set([
  ...'(,=:[!&|?{};+-*%<>~^'.split(''),
  '=>', '&&', '||', '??', '==', '===', '!=', '!==', '+=', '-=',
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'await', 'yield',
]);
// 改行の後にこの語が来たら、前の文は終わっている（セミコロンの省略）
const STATEMENT_WORDS = new Set([
  'if', 'for', 'while', 'do', 'switch', 'try', 'return', 'throw', 'goto', 'const', 'let', 'var',
  'break', 'continue', 'function', 'class', 'interface', 'export', 'case', 'default',
]);
const OPENERS = new Set(['(', '[', '{']);
const CONTROL = new Set(['if', 'switch', 'loop', 'do', 'try']);

export function tokenize(src) {
  const tokens = [];
  const comments = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let prev = null;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿' || c === '　') { i++; continue; }
    const start = i;
    const startLine = line;
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      comments.push({ text: src.slice(start + 2, i).trim(), line: startLine, endLine: startLine, start, end: i });
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i = Math.min(n, i + 2);
      const text = src.slice(start + 2, i - 2).split('\n').map(s => s.replace(/^\s*\*?\s?/, '')).join('\n').trim();
      comments.push({ text, line: startLine, endLine: line, start, end: i });
      continue;
    }
    let type;
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++;
      type = 'string';
    } else if (c === '`') {
      i = skipTemplate(src, i);
      for (let k = start; k < i; k++) if (src[k] === '\n') line++;
      type = 'template';
    } else if (c === '/' && (prev === null || (REGEX_AFTER.has(prev.value) && prev.type !== 'string'))) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++;
      while (i < n && ID_PART.test(src[i])) i++;
      type = 'regex';
    } else if (ID_START.test(c)) {
      i++;
      while (i < n && ID_PART.test(src[i])) i++;
      type = 'ident';
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      i++;
      while (i < n && /[0-9a-zA-Z_.]/.test(src[i])) i++;
      type = 'number';
    } else {
      if (PUNCT3.has(src.substr(i, 3))) i += 3;
      else if (PUNCT2.has(src.substr(i, 2))) i += 2;
      else i += 1;
      type = 'punct';
    }
    const tok = { type, value: src.slice(start, i), start, end: i, line: startLine };
    tokens.push(tok);
    prev = tok;
  }
  return { tokens, comments };
}

function skipTemplate(src, i) {
  const n = src.length;
  i++;
  while (i < n) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') return i + 1;
    if (ch === '$' && src[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        const d = src[i];
        if (d === '"' || d === "'") {
          i++;
          while (i < n && src[i] !== d) { if (src[i] === '\\') i++; i++; }
          i++;
          continue;
        }
        if (d === '`') { i = skipTemplate(src, i); continue; }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return n;
}

function unquote(tok) {
  const v = tok.value;
  const body = v.length > 1 && v.endsWith(v[0]) ? v.slice(1, -1) : v.slice(1);
  if (tok.type === 'template') return body;
  return body.replace(/\\(.)/g, (_, ch) => ({ n: '\n', t: '\t' }[ch] ?? ch));
}

// 文が goto・return・throw で必ず終わるか（末尾へ抜けないか）
export function terminates(s) {
  if (!s) return false;
  switch (s.kind) {
    case 'goto': case 'return': case 'throw': return true;
    case 'block': return s.body.some(terminates);
    case 'if': return !!s.else && terminates(s.then) && terminates(s.else);
    case 'switch': {
      if (!s.cases.some(c => c.isDefault)) return false;
      if (s.cases.some(c => hasBreak(c.body))) return false;
      const last = s.cases[s.cases.length - 1];
      return last.body.length > 0 && s.cases.filter(c => c.body.length).every(c => c.body.some(terminates));
    }
    case 'loop': return s.infinite && !hasBreak([s.body]);
    case 'do': return terminates(s.body) && !hasBreak([s.body]);
    case 'try':
      return (terminates(s.block) && (!s.handler || terminates(s.handler))) || (!!s.finalizer && terminates(s.finalizer));
    case 'labeled': return terminates(s.body);
    default: return false;
  }
}

// ループや switch の中を除いて、ラベルの無い break があるか
function hasBreak(stmts) {
  for (const s of stmts) {
    if (!s) continue;
    switch (s.kind) {
      case 'break': if (!s.label) return true; break;
      case 'block': if (hasBreak(s.body)) return true; break;
      case 'if': if (hasBreak([s.then, s.else])) return true; break;
      case 'try': if (hasBreak([s.block, s.handler, s.finalizer])) return true; break;
      case 'labeled': if (hasBreak([s.body])) return true; break;
      default: break;
    }
  }
  return false;
}

export function parseFlow(src) {
  const { tokens, comments } = tokenize(src);
  const problems = [];
  const match = matchBrackets(tokens, problems);
  return new Parser(src, tokens, comments, match, problems).parseModule();
}

function matchBrackets(tokens, problems) {
  const match = new Array(tokens.length).fill(-1);
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  tokens.forEach((t, i) => {
    if (t.type !== 'punct') return;
    if (OPENERS.has(t.value)) { stack.push(i); return; }
    if (!pairs[t.value]) return;
    const j = stack.pop();
    if (j === undefined || tokens[j].value !== pairs[t.value]) {
      problems.push({ line: t.line, message: `括弧の対応が取れない（${t.value}）` });
      if (j !== undefined) stack.push(j);
      return;
    }
    match[i] = j;
    match[j] = i;
  });
  for (const j of stack) problems.push({ line: tokens[j].line, message: `閉じていない括弧がある（${tokens[j].value}）` });
  return match;
}

class Parser {
  constructor(src, tokens, comments, match, problems) {
    this.src = src;
    this.tokens = tokens;
    this.comments = comments;
    this.match = match;
    this.problems = problems;
    this.lines = src.split(/\r?\n/);
  }

  v(i) { return this.tokens[i]?.value; }

  text(a, b) {
    if (a >= b || a < 0) return '';
    return this.src.slice(this.tokens[a].start, this.tokens[b - 1].end);
  }

  flat(a, b) { return this.text(a, b).replace(/\s+/g, ' ').trim(); }

  close(i) { return this.match[i] > i ? this.match[i] : i; }

  // < から対応する > の次の位置
  angleEnd(k) {
    let depth = 0;
    while (k < this.tokens.length) {
      const v = this.v(k);
      if (v === '<') depth++;
      else if (v === '>') { depth--; if (depth === 0) return k + 1; }
      else if (OPENERS.has(v)) { k = this.close(k) + 1; continue; }
      else if (v === ';') return k;
      k++;
    }
    return k;
  }

  // 型注釈の終わり（関数本体の { か、アロー関数の =>）
  typeEnd(k, stopAtArrow) {
    const start = k;
    let angle = 0;
    while (k < this.tokens.length) {
      const t = this.tokens[k];
      if (t.value === '<') angle++;
      else if (t.value === '>') angle--;
      else if (t.value === '=>' && angle === 0 && stopAtArrow) return k;
      else if (t.value === '{') {
        const prev = this.tokens[k - 1];
        const endsType = ['ident', 'string', 'number', 'template'].includes(prev.type)
          ? !['keyof', 'typeof', 'is', 'extends', 'infer', 'readonly'].includes(prev.value)
          : [')', ']', '}', '>'].includes(prev.value);
        if (angle === 0 && k > start && endsType) return k;
        k = this.close(k) + 1;
        continue;
      } else if (t.value === '(' || t.value === '[') { k = this.close(k) + 1; continue; }
      k++;
    }
    return k;
  }

  typeEndUntil(k, stop) {
    let angle = 0;
    while (k < this.tokens.length) {
      const v = this.v(k);
      if (v === '<') angle++;
      else if (v === '>') angle--;
      else if (v === stop && angle === 0) return k;
      else if (OPENERS.has(v)) { k = this.close(k) + 1; continue; }
      k++;
    }
    return k;
  }

  parseModule() {
    const fns = [];
    let i = 0;
    while (i < this.tokens.length) {
      const r = this.tryFunction(i);
      if (r) { fns.push(r.fn); i = r.next; continue; }
      if (OPENERS.has(this.v(i)) && this.match[i] > i) { i = this.match[i] + 1; continue; }
      i++;
    }

    // 図にする関数（フロー関数）：ラベル付きブロックか goto がある、export されている、
    // 実施が2つ以上ある、条件や繰り返しの中に実施がある。それ以外で実施を含むものは補助関数として扱う
    for (const f of fns) {
      f.labels = f.body.filter(isLabelBlock).map(s => s.label);
      const own = this.countWord(f.bOpen + 1, f.bClose, '実施');
      const gotos = this.countWord(f.bOpen + 1, f.bClose, 'goto');
      f.isFlow = f.labels.length > 0 || gotos > 0 || f.exported || own >= 2 || (own >= 1 && f.body.some(s => CONTROL.has(s.kind)));
    }
    this.flowNames = new Set(fns.filter(f => f.isFlow).map(f => f.name));

    // 補助関数の中の実施を先に調べる（ステップから呼んだときに担当を示すため）
    this.helperWorks = new Map();
    const helpers = fns.filter(f => !f.isFlow);
    for (let round = 0; round < 3; round++) {
      for (const f of helpers) {
        const ctx = newCtx();
        this.walk(f.body, [], ctx, { inTry: false }, 0, this.tokens[f.bOpen].end);
        f.ctx = ctx;
        const works = [];
        for (const it of ctx.items) {
          if (it.kind === 'perform') works.push(it);
          else if (it.kind === 'helper' && it.helper !== f.name && this.helperWorks.has(it.helper)) works.push(...this.helperWorks.get(it.helper));
        }
        if (works.length) this.helperWorks.set(f.name, works);
      }
    }

    for (const f of fns) {
      if (f.isFlow) this.analyzeFlow(f);
      else {
        f.performs = f.ctx.items.filter(x => x.kind === 'perform');
        f.gotos = [...f.ctx.gotos, ...f.ctx.nestedGotos];
        f.awaits = f.ctx.awaits;
        f.untyped = f.ctx.untyped;
        f.vars = f.ctx.vars;
      }
    }
    return {
      src: this.src,
      lines: this.lines,
      functions: fns.map(cleanFunction),
      helperWorks: Object.fromEntries([...this.helperWorks].map(([k, v]) => [k, v.map(w => ({ who: w.who, cap: w.cap, instruction: w.instruction }))])),
      problems: this.problems,
    };
  }

  countWord(a, b, word) {
    let n = 0;
    for (let k = a; k < b; k++) if (this.tokens[k].type === 'ident' && this.tokens[k].value === word && this.v(k - 1) !== '.') n++;
    return n;
  }

  tryFunction(i) {
    const T = this.tokens;
    let k = i;
    let exported = false;
    let isAsync = false;
    if (this.v(k) === 'export') { exported = true; k++; if (this.v(k) === 'default') k++; }
    if (this.v(k) === 'declare') return null;
    if (this.v(k) === 'async' && this.v(k + 1) === 'function') { isAsync = true; k++; }
    if (this.v(k) === 'function') {
      k++;
      if (this.v(k) === '*') k++;
      const nameTok = T[k];
      if (!nameTok || nameTok.type !== 'ident') return null;
      k++;
      if (this.v(k) === '<') k = this.angleEnd(k);
      if (this.v(k) !== '(') return null;
      return this.functionFrom(k, nameTok, isAsync, exported, false);
    }
    if (['const', 'let', 'var'].includes(this.v(k)) && T[k + 1]?.type === 'ident') {
      const nameTok = T[k + 1];
      let j = k + 2;
      if (this.v(j) === ':') j = this.typeEndUntil(j + 1, '=');
      if (this.v(j) !== '=') return null;
      j++;
      if (this.v(j) === 'async') { isAsync = true; j++; }
      if (this.v(j) === 'function') {
        j++;
        if (this.v(j) === '*') j++;
        if (T[j]?.type === 'ident') j++;
        if (this.v(j) === '<') j = this.angleEnd(j);
        if (this.v(j) !== '(') return null;
        return this.functionFrom(j, nameTok, isAsync, exported, false);
      }
      if (this.v(j) === '<') j = this.angleEnd(j);
      if (this.v(j) === '(') {
        let m = this.close(j) + 1;
        if (this.v(m) === ':') m = this.typeEnd(m + 1, true);
        if (this.v(m) === '=>') return this.functionFrom(j, nameTok, isAsync, exported, true);
      }
    }
    return null;
  }

  functionFrom(pOpen, nameTok, isAsync, exported, arrow) {
    const pClose = this.close(pOpen);
    let k = pClose + 1;
    let returnType = '';
    if (this.v(k) === ':') {
      const e = this.typeEnd(k + 1, arrow);
      returnType = this.flat(k + 1, e);
      k = e;
    }
    if (arrow) { if (this.v(k) !== '=>') return null; k++; }
    if (this.v(k) !== '{' || this.match[k] < 0) return null;
    const bOpen = k;
    const bClose = this.match[k];
    const fn = {
      name: nameTok.value,
      line: nameTok.line,
      endLine: this.tokens[bClose].line,
      isAsync,
      exported,
      params: this.flat(pOpen + 1, pClose),
      paramNames: this.splitArgs(pOpen + 1, pClose).map(([s]) => this.tokens[s]).filter(t => t?.type === 'ident').map(t => t.value),
      returnType,
      bOpen,
      bClose,
      bOpenEnd: this.tokens[bOpen].end,
      bCloseStart: this.tokens[bClose].start,
      body: this.parseStatements(bOpen + 1, bClose),
    };
    let next = bClose + 1;
    if (arrow && this.v(next) === ';') next++;
    return { fn, next };
  }

  parseStatements(a, b) {
    const out = [];
    let k = a;
    while (k < b) {
      const [s, next] = this.parseStatement(k, b);
      const n = Math.max(next, k + 1);
      s.startTok = k;
      s.endTok = n - 1;
      s.endLine = this.tokens[n - 1].line;
      out.push(s);
      k = n;
    }
    return out;
  }

  parseStatement(i, end) {
    const T = this.tokens;
    const t = T[i];
    const v = t.value;
    const one = (s, next) => { s.startTok = i; s.endTok = Math.max(i, next - 1); s.endLine = T[s.endTok].line; return [s, next]; };
    if (v === ';') return one({ kind: 'empty', line: t.line }, i + 1);
    if (v === '{') {
      const j = this.close(i);
      return one({ kind: 'block', a: i, b: j, body: this.parseStatements(i + 1, j), line: t.line }, j + 1);
    }
    if (t.type === 'ident') {
      // 引数付きのラベル：名前(引数: 型, …): { … }
      if (this.isParamLabel(i)) {
        const pc = this.close(i + 1);
        const [body, next] = this.parseStatement(pc + 2, end);
        return one({ kind: 'labeled', label: v, labelIdx: i, params: this.labelParams(i + 2, pc), body, line: t.line }, next);
      }
      if (this.v(i + 1) === ':' && v !== 'case' && v !== 'default' && i + 2 < end) {
        const [body, next] = this.parseStatement(i + 2, end);
        return one({ kind: 'labeled', label: v, labelIdx: i, body, line: t.line }, next);
      }
      switch (v) {
        case 'if': {
          const c = i + 1;
          if (this.v(c) !== '(') break;
          const cc = this.close(c);
          const [then, n2] = this.parseStatement(cc + 1, end);
          let els = null;
          let next = n2;
          if (this.v(n2) === 'else' && n2 < end) {
            const [e, n3] = this.parseStatement(n2 + 1, end);
            els = e;
            next = n3;
          }
          return one({ kind: 'if', condA: c + 1, condB: cc, then, else: els, line: t.line }, next);
        }
        case 'switch': {
          const c = i + 1;
          if (this.v(c) !== '(') break;
          const cc = this.close(c);
          const bo = cc + 1;
          if (this.v(bo) !== '{') break;
          const bc = this.close(bo);
          return one({ kind: 'switch', discA: c + 1, discB: cc, cases: this.parseCases(bo + 1, bc), line: t.line }, bc + 1);
        }
        case 'for':
        case 'while': {
          let c = i + 1;
          if (this.v(c) === 'await') c++;
          if (this.v(c) !== '(') break;
          const cc = this.close(c);
          const head = this.flat(c + 1, cc).replace(/\s/g, '');
          const infinite = v === 'for' ? head === ';;' : head === 'true' || head === '1';
          const [body, next] = this.parseStatement(cc + 1, end);
          return one({ kind: 'loop', loopKind: v, headA: c + 1, headB: cc, body, infinite, line: t.line }, next);
        }
        case 'do': {
          const [body, n2] = this.parseStatement(i + 1, end);
          let next = n2;
          let condA = n2;
          let condB = n2;
          if (this.v(n2) === 'while' && this.v(n2 + 1) === '(') {
            const cc = this.close(n2 + 1);
            condA = n2 + 2;
            condB = cc;
            next = cc + 1;
            if (this.v(next) === ';') next++;
          }
          return one({ kind: 'do', body, condA, condB, line: t.line }, next);
        }
        case 'try': {
          if (this.v(i + 1) !== '{') break;
          const [block, n2] = this.parseStatement(i + 1, end);
          let k = n2;
          let handler = null;
          let finalizer = null;
          if (this.v(k) === 'catch') {
            k++;
            if (this.v(k) === '(') k = this.close(k) + 1;
            const [h, n3] = this.parseStatement(k, end);
            handler = h;
            k = n3;
          }
          if (this.v(k) === 'finally') {
            const [f, n4] = this.parseStatement(k + 1, end);
            finalizer = f;
            k = n4;
          }
          return one({ kind: 'try', block, handler, finalizer, line: t.line }, k);
        }
        case 'return':
        case 'throw': {
          const e = this.exprEnd(i + 1, end);
          const b = this.v(e - 1) === ';' && e - 1 >= i + 1 ? e - 1 : e;
          return one({ kind: v, a: i + 1, b, line: t.line }, e);
        }
        case 'goto': {
          const n = T[i + 1];
          if (n && n.type === 'ident' && n.line === t.line) {
            const g = this.readGotoArgs(i);
            let next = g.end;
            if (this.v(next) === ';') next++;
            return one({ kind: 'goto', target: n.value, a: i, b: next, args: g.args, argsOpen: g.open, argsClose: g.close, commas: g.commas, line: t.line }, next);
          }
          break;
        }
        case 'break':
        case 'continue': {
          let k = i + 1;
          let label = null;
          if (T[k]?.type === 'ident' && T[k].line === t.line && k < end && !STATEMENT_WORDS.has(T[k].value)) { label = T[k].value; k++; }
          if (this.v(k) === ';') k++;
          return one({ kind: v, label, line: t.line }, k);
        }
        case 'let':
        case 'const':
        case 'var': {
          const e = this.exprEnd(i + 1, end);
          const b = this.v(e - 1) === ';' ? e - 1 : e;
          return one({ kind: 'decl', declKind: v, a: i, b: e, names: this.declNames(i + 1, b), hasInit: this.hasTopLevel(i + 1, b, '='), line: t.line }, e);
        }
        case 'type': {
          if (T[i + 1]?.type === 'ident' && ['=', '<'].includes(this.v(i + 2))) {
            const e = this.exprEnd(i + 1, end);
            return one({ kind: 'typeDecl', a: i, b: e, names: [this.v(i + 1)], line: t.line }, e);
          }
          break;
        }
        case 'interface': {
          let k = i + 1;
          while (k < end && this.v(k) !== '{') k++;
          const e = k < end ? this.close(k) + 1 : end;
          return one({ kind: 'typeDecl', a: i, b: e, names: [this.v(i + 1)], line: t.line }, e);
        }
        case 'async':
        case 'function':
        case 'class': {
          if (v === 'async' && this.v(i + 1) !== 'function') break;
          let k = i;
          while (k < end && this.v(k) !== '{') { if (this.v(k) === '(' || this.v(k) === '[') k = this.close(k); k++; }
          const e = k < end ? this.close(k) + 1 : end;
          return one({ kind: 'func', a: i, b: e, line: t.line }, e);
        }
        default:
          break;
      }
    }
    const e = this.exprEnd(i, end);
    return one({ kind: 'expr', a: i, b: e, line: t.line }, Math.max(e, i + 1));
  }

  parseCases(a, b) {
    const cases = [];
    let k = a;
    let cur = null;
    while (k < b) {
      const v = this.v(k);
      if (v === 'case' || (v === 'default' && this.v(k + 1) === ':')) {
        const testA = k + 1;
        let testB = testA;
        if (v === 'default') k += 2;
        else {
          let j = k + 1;
          let q = 0;
          while (j < b) {
            const w = this.v(j);
            if (OPENERS.has(w)) { j = this.close(j) + 1; continue; }
            if (w === '?') q++;
            else if (w === ':') { if (q === 0) break; q--; }
            j++;
          }
          testB = j;
          k = j + 1;
        }
        cur = { isDefault: v === 'default', testA, testB, body: [], line: this.tokens[testA - 1].line, colonEnd: this.tokens[k - 1].end };
        cases.push(cur);
        continue;
      }
      if (!cur) { k++; continue; }
      const [s, next] = this.parseStatement(k, b);
      cur.body.push(s);
      k = Math.max(next, k + 1);
    }
    return cases;
  }

  exprEnd(i, end) {
    let k = i;
    while (k < end) {
      const t = this.tokens[k];
      if (t.value === ';') return k + 1;
      if (k > i) {
        const prev = this.tokens[k - 1];
        if (t.line > prev.line && this.startsStatement(k) && !continuesExpression(prev)) return k;
      }
      if (OPENERS.has(t.value) && this.match[k] > k) { k = this.match[k] + 1; continue; }
      if (t.value === '}') return k;
      k++;
    }
    return end;
  }

  startsStatement(k) {
    const t = this.tokens[k];
    if (t.type !== 'ident') return false;
    if (STATEMENT_WORDS.has(t.value)) return true;
    return (this.v(k + 1) === ':' && this.v(k + 2) === '{') || this.isParamLabel(k);
  }

  // 名前(…): { の形なら、引数付きのラベル
  isParamLabel(k) {
    const t = this.tokens[k];
    if (t?.type !== 'ident' || STATEMENT_WORDS.has(t.value) || this.v(k + 1) !== '(') return false;
    const pc = this.close(k + 1);
    return pc > k + 1 && this.v(pc + 1) === ':' && this.v(pc + 2) === '{';
  }

  // ラベルの引数。「名前: 型」以外の書き方（既定値・?・...・分割代入）は ok: false にする
  labelParams(a, b) {
    return this.splitArgs(a, b).map(([s, e]) => {
      const name = this.tokens[s];
      const text = this.flat(s, e);
      const ok = name?.type === 'ident' && this.v(s + 1) === ':' && e > s + 2 && !this.hasTopLevel(s + 2, e, '=');
      return { name: name?.type === 'ident' ? name.value : text, type: ok ? this.flat(s + 2, e) : '', text, ok, line: name?.line };
    });
  }

  // goto 名前(式, …) の引数。k は goto の位置。引数が無ければ args は空で open は -1
  readGotoArgs(k) {
    const n = this.tokens[k + 1];
    if (this.v(k + 2) !== '(' || this.tokens[k + 2].line !== n.line) return { args: [], open: -1, close: -1, commas: [], end: k + 2 };
    const close = this.close(k + 2);
    const parts = this.splitArgs(k + 3, close);
    const commas = parts.slice(1).map(([s]) => s - 1);
    return { args: parts.map(([s, e]) => ({ text: this.flat(s, e), a: s, b: e })), open: k + 2, close, commas, end: close + 1 };
  }

  hasTopLevel(a, b, value) {
    for (let k = a; k < b; k++) {
      if (OPENERS.has(this.v(k))) { k = this.close(k); continue; }
      if (this.v(k) === '<') { k = this.angleEnd(k) - 1; continue; }
      if (this.v(k) === value) return true;
    }
    return false;
  }

  // let a = 1, { b, c: d } = x のような宣言から、宣言される名前を取り出す
  declNames(a, b) {
    const names = [];
    for (const [s, e] of this.splitArgs(a, b)) {
      const t = this.tokens[s];
      if (!t) continue;
      if (t.type === 'ident') { names.push(t.value); continue; }
      if (OPENERS.has(t.value)) {
        const c = this.close(s);
        for (let k = s + 1; k < c; k++) {
          const u = this.tokens[k];
          if (u.type === 'ident' && this.v(k + 1) !== ':' && this.v(k - 1) !== '.') names.push(u.value);
        }
      }
      void e;
    }
    return names;
  }

  splitArgs(a, b) {
    const args = [];
    let s = a;
    for (let k = a; k < b; k++) {
      const v = this.v(k);
      if (OPENERS.has(v)) { k = this.close(k); continue; }
      if (v === '<' && this.tokens[k - 1]?.type === 'ident' && /^[A-Z\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}]/u.test(this.tokens[k - 1].value)) {
        const e = this.angleEnd(k);
        if (this.v(e) === '(' || this.v(e) === ',' || e >= b) { k = e - 1; continue; }
      }
      if (v === ',') { if (k > s) args.push([s, k]); s = k + 1; }
    }
    if (b > s) args.push([s, b]);
    return args;
  }

  // 文字列の連結なら中身を、それ以外は式のまま返す
  literalText(a, b) {
    const parts = [];
    for (let k = a; k < b; k++) {
      const t = this.tokens[k];
      if (t.type === 'string' || t.type === 'template') parts.push(unquote(t));
      else if (t.value === '+') continue;
      else return this.flat(a, b);
    }
    return parts.join('');
  }

  argSummary(pOpen) {
    const pClose = this.close(pOpen);
    const parts = [];
    for (let k = pOpen + 1; k < pClose; k++) {
      const t = this.tokens[k];
      if (t.type === 'string' || t.type === 'template') parts.push(unquote(t).replace(/\s+/g, ' '));
    }
    return parts.length ? parts.join(' ') : this.flat(pOpen + 1, pClose);
  }

  inParallel(k, ctx) { return ctx.parallel.some(([p, q]) => p < k && k < q); }

  readPerform(k, conds, ctx) {
    let j = k + 1;
    let typeText = null;
    if (this.v(j) === '<') {
      const e = this.angleEnd(j);
      typeText = this.flat(j + 1, e - 1);
      j = e;
    }
    if (this.v(j) !== '(') return null;
    const close = this.close(j);
    const args = this.splitArgs(j + 1, close);
    const [a0, a1, a2] = args;
    const settings = a2 ? this.flat(a2[0], a2[1]) : '';
    let who = 'model';
    let cap = null;
    if (a2) {
      if (this.v(a2[0]) === '{') {
        const m = settings.match(/担当\s*:\s*["'`]([^"'`]*)["'`]/);
        if (m) who = m[1];
        else if (/担当\s*:/.test(settings)) who = 'unknown';
        const c = settings.match(/能力\s*:\s*["'`]([^"'`]*)["'`]/);
        if (c) cap = c[1];
        else if (/能力\s*:/.test(settings)) cap = '（式で指定）';
      } else who = 'unknown';
    }
    const instrTok = a0 ? this.tokens[a0[0]] : null;
    return {
      kind: 'perform',
      type: typeText,
      instruction: a0 ? this.literalText(a0[0], a0[1]) : '',
      instructionIsText: !!instrTok && (instrTok.type === 'string' || instrTok.type === 'template'),
      input: a1 ? this.flat(a1[0], a1[1]) : '',
      settings,
      who,
      cap,
      line: this.tokens[k].line,
      conds: [...conds],
      parallel: this.inParallel(k, ctx),
      argCount: args.length,
    };
  }

  // 式の中の実施・補助関数・サブフロー・await・goto・増減を拾い、見つけた作業を返す
  scanRange(a, b, conds, ctx) {
    const T = this.tokens;
    const found = [];
    for (let k = a; k < b; k++) {
      const t = T[k];
      if (t.type !== 'ident') {
        if (t.value === '++' || t.value === '--') {
          if (T[k - 1]?.type === 'ident') ctx.incs.add(T[k - 1].value);
          else if (T[k + 1]?.type === 'ident') ctx.incs.add(T[k + 1].value);
        } else if ((t.value === '+=' || t.value === '-=') && T[k - 1]?.type === 'ident') ctx.incs.add(T[k - 1].value);
        continue;
      }
      const prev = T[k - 1];
      if (prev && (prev.value === '.' || prev.value === '?.')) continue;
      if (t.value === 'var') ctx.vars.push(t.line);
      if (t.value === 'Promise' && this.v(k + 1) === '.' && this.v(k + 2) === 'all' && this.v(k + 3) === '(') {
        ctx.parallel.push([k + 3, this.close(k + 3)]);
        continue;
      }
      if (t.value === 'await') { ctx.awaits.push(t.line); continue; }
      if (t.value === 'goto' && T[k + 1]?.type === 'ident' && T[k + 1].line === t.line) {
        const g = this.readGotoArgs(k);
        const last = this.v(g.end) === ';' ? g.end : g.end - 1;
        ctx.nestedGotos.push({ target: T[k + 1].value, line: t.line, start: t.start, end: T[last].end, args: g.args.map(x => x.text) });
        k = last;
        continue;
      }
      if (t.value === '実施') {
        const p = this.readPerform(k, conds, ctx);
        if (p) { ctx.items.push(p); found.push(p); } else if (this.v(k + 1) === '(') ctx.untyped.push(t.line);
        continue;
      }
      if (this.v(k + 1) === '(' && prev?.value !== 'function') {
        let it = null;
        if (this.flowNames.has(t.value)) {
          it = { kind: 'subflow', target: t.value, line: t.line, conds: [...conds], parallel: this.inParallel(k, ctx), input: this.flat(k + 2, this.close(k + 1)) };
        } else if (this.helperWorks?.has(t.value)) {
          it = { kind: 'helper', helper: t.value, line: t.line, conds: [...conds], parallel: this.inParallel(k, ctx), summary: this.argSummary(k + 1), input: this.flat(k + 2, this.close(k + 1)) };
        }
        if (it) { ctx.items.push(it); found.push(it); }
      }
    }
    return found;
  }

  condIdents(a, b, ctx) {
    for (let k = a; k < b; k++) {
      const t = this.tokens[k];
      if (t.type === 'ident' && this.v(k - 1) !== '.') ctx.condVars.add(t.value);
    }
  }

  // 文と文の間にあるコメントを、手順のメモとして拾う
  notesBetween(from, to, depth) {
    return this.comments.filter(c => c.start >= from && c.end <= to).map(c => ({ type: 'note', depth, text: c.text, line: c.line }));
  }

  // 文の並びをたどり、条件を付けて作業・行き先・終わりを集め、図に出す手順の行を返す
  walk(stmts, conds, ctx, flags, depth, startOffset) {
    const rows = [];
    let local = [...conds];
    let prevEnd = startOffset;
    for (const s of stmts) {
      const fl = s.topIndex !== undefined ? { ...flags, topIndex: s.topIndex } : flags;
      if (prevEnd !== undefined) rows.push(...this.notesBetween(prevEnd, this.tokens[s.startTok].start, depth));
      rows.push(...this.walkOne(s, local, ctx, fl, depth));
      prevEnd = this.tokens[s.endTok].end;
      // then で必ず抜ける if の後ろは、その条件が成り立たなかったときに通る。
      // then が throw だけで抜ける if は前提の確認なので、後ろの流れの条件として図に出さない
      if (s.kind === 'if' && !s.else && terminates(s.then)) local = [...local, { kind: 'after', text: this.flat(s.condA, s.condB), guard: !hasExit(s.then) }];
    }
    return rows;
  }

  blockRows(s, conds, ctx, flags, depth) {
    if (s?.kind === 'block') return this.walk(s.body, conds, ctx, flags, depth, this.tokens[s.a].end);
    return this.walkOne(s, conds, ctx, flags, depth);
  }

  workRows(items, depth) { return items.map(item => ({ type: 'work', depth, item })); }

  walkOne(s, conds, ctx, flags, depth) {
    if (!s) return [];
    switch (s.kind) {
      case 'expr': case 'decl': case 'func':
        if (s.kind === 'decl' && s.declKind === 'var') ctx.vars.push(s.line);
        return this.workRows(this.scanRange(s.kind === 'decl' ? s.a + 1 : s.a, s.b, conds, ctx), depth);
      case 'block':
        return this.walk(s.body, conds, ctx, flags, depth, this.tokens[s.a].end);
      case 'if': {
        const text = this.flat(s.condA, s.condB);
        const rows = this.workRows(this.scanRange(s.condA, s.condB, conds, ctx), depth);
        this.condIdents(s.condA, s.condB, ctx);
        const thenRows = this.blockRows(s.then, [...conds, { kind: 'if', text }], ctx, flags, depth + 1);
        if (thenRows.length) rows.push({ type: 'cond', depth, text: `もし ${text}`, line: s.line }, ...thenRows);
        if (s.else) {
          if (s.else.kind === 'if') {
            const elseRows = this.walkOne(s.else, [...conds, { kind: 'else', text }], ctx, flags, depth);
            if (elseRows[0]?.type === 'cond' && thenRows.length) elseRows[0] = { ...elseRows[0], text: `そうでなく、${elseRows[0].text}` };
            rows.push(...elseRows);
          } else {
            const elseRows = this.blockRows(s.else, [...conds, { kind: 'else', text }], ctx, flags, depth + 1);
            if (elseRows.length) rows.push({ type: 'cond', depth, text: thenRows.length ? 'そうでなければ' : `もし ${text} でなければ`, line: s.line }, ...elseRows);
          }
        }
        return rows;
      }
      case 'switch': {
        const disc = this.flat(s.discA, s.discB);
        const rows = this.workRows(this.scanRange(s.discA, s.discB, conds, ctx), depth);
        this.condIdents(s.discA, s.discB, ctx);
        let pending = [];
        for (const c of s.cases) {
          if (c.body.length === 0) { pending.push(c); continue; }
          const group = [...pending, c];
          pending = [];
          const isDefault = group.some(g => g.isDefault);
          const tests = group.filter(g => !g.isDefault).map(g => this.flat(g.testA, g.testB));
          const cond = isDefault ? { kind: 'default', disc } : { kind: 'case', disc, tests };
          const body = this.walk(c.body, [...conds, cond], ctx, flags, depth + 1, c.colonEnd);
          if (body.length) {
            rows.push({ type: 'cond', depth, text: isDefault ? `${shortDisc(disc)} がそれ以外のとき` : `${shortDisc(disc)} が ${tests.join(' / ')} のとき`, line: c.line }, ...body);
          }
        }
        return rows;
      }
      case 'loop': {
        const head = this.flat(s.headA, s.headB);
        const rows = this.workRows(this.scanRange(s.headA, s.headB, conds, ctx), depth);
        this.condIdents(s.headA, s.headB, ctx);
        const label = `${s.loopKind} (${head})`;
        const body = this.blockRows(s.body, [...conds, { kind: 'loop', text: label }], ctx, flags, depth + 1);
        if (body.length) rows.push({ type: 'cond', depth, text: `繰り返す：${label}`, line: s.line }, ...body);
        return rows;
      }
      case 'do': {
        const head = this.flat(s.condA, s.condB);
        const label = `do … while (${head})`;
        const body = this.blockRows(s.body, [...conds, { kind: 'loop', text: label }], ctx, flags, depth + 1);
        const rows = [];
        if (body.length) rows.push({ type: 'cond', depth, text: `繰り返す：${label}`, line: s.line }, ...body);
        rows.push(...this.workRows(this.scanRange(s.condA, s.condB, conds, ctx), depth));
        this.condIdents(s.condA, s.condB, ctx);
        return rows;
      }
      case 'try': {
        const inner = { ...flags, inTry: true };
        const rows = this.blockRows(s.block, conds, ctx, inner, depth);
        if (s.handler) {
          const h = this.blockRows(s.handler, [...conds, { kind: 'catch' }], ctx, inner, depth + 1);
          if (h.length) rows.push({ type: 'cond', depth, text: '例外が起きたとき', line: s.handler.line }, ...h);
        }
        if (s.finalizer) {
          const f = this.blockRows(s.finalizer, conds, ctx, inner, depth + 1);
          if (f.length) rows.push({ type: 'cond', depth, text: '最後に必ず', line: s.finalizer.line }, ...f);
        }
        return rows;
      }
      case 'goto': {
        // 引数の式の中の作業は、移る前に行う
        const rows = s.args.flatMap(x => this.workRows(this.scanRange(x.a, x.b, conds, ctx), depth));
        const T = this.tokens;
        ctx.gotos.push({
          target: s.target,
          args: s.args.map(x => x.text),
          line: s.line,
          conds,
          inTry: flags.inTry,
          topIndex: flags.topIndex,
          start: T[s.a].start,
          end: T[s.b - 1].end,
          argsOpenEnd: s.argsOpen >= 0 ? T[s.argsOpen].end : -1,
          argsCloseStart: s.argsClose >= 0 ? T[s.argsClose].start : -1,
          commas: s.commas.map(c => [T[c].start, T[c].end]),
        });
        rows.push({ type: 'exit', depth, kind: 'goto', target: s.target, args: s.args.map(x => x.text), line: s.line });
        return rows;
      }
      case 'return': {
        const rows = this.workRows(this.scanRange(s.a, s.b, conds, ctx), depth);
        const expr = this.flat(s.a, s.b);
        const label = returnLabel(expr);
        ctx.returns.push({ expr, label, line: s.line, conds });
        rows.push({ type: 'exit', depth, kind: 'return', label, line: s.line });
        return rows;
      }
      case 'throw':
        ctx.throws.push({ expr: this.flat(s.a, s.b), line: s.line, conds });
        return this.workRows(this.scanRange(s.a, s.b, conds, ctx), depth);
      case 'labeled':
        ctx.nestedLabels.push({ label: s.label, line: s.line });
        return this.blockRows(s.body, conds, ctx, flags, depth);
      default:
        return [];
    }
  }

  // 識別子の参照（プロパティ名とオブジェクトのキーを除く）
  refsOf(a, b) {
    const out = new Set();
    for (let k = a; k <= b && k < this.tokens.length; k++) {
      const t = this.tokens[k];
      if (t.type !== 'ident') continue;
      const prev = this.v(k - 1);
      if (prev === '.' || prev === '?.') continue;
      if (this.v(k + 1) === ':' && prev !== '?') continue;
      out.add(t.value);
    }
    return out;
  }

  // ラベルの直前のコメントを、ステップの説明にする
  noteAbove(line, startOffset) {
    const out = [];
    let want = line - 1;
    const cs = this.comments.filter(c => c.end <= startOffset);
    for (let i = cs.length - 1; i >= 0; i--) {
      if (cs[i].endLine !== want) break;
      out.unshift(cs[i].text);
      want = cs[i].line - 1;
    }
    return out.join('\n');
  }

  analyzeFlow(f) {
    f.body.forEach((s, idx) => { s.topIndex = idx; });
    const groups = [];
    let cur = { kind: 'start', stmts: [] };
    for (const s of f.body) {
      if (isLabelBlock(s)) {
        if (cur.stmts.length) groups.push(cur);
        groups.push({ kind: 'label', name: s.label, node: s });
        cur = { kind: 'after', after: s.label, stmts: [] };
        continue;
      }
      if (s.kind !== 'empty') cur.stmts.push(s);
    }
    if (cur.stmts.length) groups.push(cur);

    f.segments = groups.map((g, gi) => {
      const ctx = newCtx();
      let rows;
      let first;
      let lastTok;
      let term;
      if (g.kind === 'label') {
        const s = g.node;
        first = s;
        lastTok = s.endTok;
        rows = this.walk(s.body.body, [], ctx, { inTry: false, topIndex: s.topIndex }, 0, this.tokens[s.body.a].end);
        if (s.params?.length) rows.unshift({ type: 'param', depth: 0, text: `引数：${s.params.map(p => p.text).join('、')}`, line: s.line });
        term = terminates(s.body);
      } else {
        first = g.stmts[0];
        lastTok = g.stmts[g.stmts.length - 1].endTok;
        const prevLabel = groups[gi - 1]?.node;
        const from = prevLabel ? this.tokens[prevLabel.endTok].end : this.tokens[f.bOpen].end;
        rows = this.walk(g.stmts, [], ctx, { inTry: false }, 0, from);
        term = g.stmts.some(terminates);
      }
      const startOffset = this.tokens[first.startTok].start;
      const seg = {
        id: g.kind === 'label' ? `L:${g.name}` : g.kind === 'start' ? 'S:start' : `S:after:${g.after}`,
        kind: g.kind,
        name: g.kind === 'label' ? g.name : null,
        after: g.after ?? null,
        title: g.kind === 'label' ? g.name : g.kind === 'start' ? '開始' : `${g.after} の後`,
        params: g.kind === 'label' ? (g.node.params ?? []) : [],
        line: first.line,
        endLine: this.tokens[lastTok].line,
        topIndex: first.topIndex,
        topEnd: g.kind === 'label' ? first.topIndex : g.stmts[g.stmts.length - 1].topIndex,
        labelStart: g.kind === 'label' ? this.tokens[first.labelIdx].start : null,
        labelEnd: g.kind === 'label' ? this.tokens[first.body.a].end : null,
        note: g.kind === 'label' ? this.noteAbove(first.line, startOffset) : '',
        terminates: term,
        rows,
        items: ctx.items,
        gotos: ctx.gotos,
        nestedGotos: ctx.nestedGotos,
        returns: ctx.returns,
        throws: ctx.throws,
        awaits: ctx.awaits,
        untyped: ctx.untyped,
        vars: ctx.vars,
        incs: [...ctx.incs],
        condVars: [...ctx.condVars],
        nestedLabels: ctx.nestedLabels,
        bodyText: this.text(first.startTok, lastTok + 1),
      };
      seg.transparent = g.kind !== 'label' && !rows.some(r => r.type !== 'note') && !ctx.throws.length && !ctx.nestedGotos.length;
      return seg;
    });

    // 関数直下の宣言（ラベル付きブロックの外）。goto が宣言を飛び越えないかの検査と、概要の表示に使う
    f.topDecls = f.body.filter(s => s.kind === 'decl' || s.kind === 'typeDecl').map(s => ({
      kind: s.kind === 'decl' ? s.declKind : 'type',
      names: s.names,
      text: this.flat(s.startTok, s.endTok + 1).replace(/;$/, ''),
      line: s.line,
      topIndex: s.topIndex,
      hasInit: s.kind === 'decl' ? s.hasInit : true,
    }));
    // 関数直下の文ごとの参照（goto の行き先から後ろで、飛び越えた宣言を使っていないかを見る）
    f.topRefs = f.body.map(s => [...this.refsOf(s.startTok, s.endTok)]);
    f.topStarts = f.body.map(s => this.tokens[s.startTok].start);
    f.nestedLabelTargets = [];
    const collectLabels = (s, top) => {
      if (!s) return;
      if (s.kind === 'labeled' && !top) f.nestedLabelTargets.push({ label: s.label, line: s.line });
      for (const c of [s.body, s.then, s.else, s.block, s.handler, s.finalizer].filter(Boolean)) {
        if (Array.isArray(c)) c.forEach(x => collectLabels(x, false));
        else collectLabels(c, false);
      }
      if (s.cases) s.cases.forEach(c => c.body.forEach(x => collectLabels(x, false)));
    };
    f.body.forEach(s => (isLabelBlock(s) ? s.body.body.forEach(x => collectLabels(x, false)) : collectLabels(s, true)));
  }
}

function isLabelBlock(s) { return s.kind === 'labeled' && s.body?.kind === 'block'; }

// goto か return を含むか（throw だけで抜けるものと区別する）
function hasExit(s) {
  if (!s) return false;
  if (s.kind === 'goto' || s.kind === 'return') return true;
  const kids = [s.body, s.then, s.else, s.block, s.handler, s.finalizer].filter(Boolean).flatMap(c => (Array.isArray(c) ? c : [c]));
  if (s.cases) kids.push(...s.cases.flatMap(c => c.body));
  return kids.some(hasExit);
}

function newCtx() {
  return { items: [], gotos: [], nestedGotos: [], returns: [], throws: [], awaits: [], untyped: [], vars: [], incs: new Set(), condVars: new Set(), parallel: [], nestedLabels: [] };
}

function continuesExpression(prev) {
  if (prev.type === 'punct') return ![')', ']', '}', '++', '--'].includes(prev.value);
  return ['typeof', 'new', 'await', 'in', 'of', 'instanceof', 'extends', 'keyof'].includes(prev.value);
}

function shortDisc(disc) {
  const parts = disc.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : disc;
}

export function returnLabel(expr) {
  if (!expr) return '値なし';
  const m = expr.match(/([\p{L}\p{N}_$]+)\s*:\s*["'`]([^"'`]+)["'`]/u);
  if (m) return `${m[1]}: ${m[2]}`;
  return expr.length > 32 ? `${expr.slice(0, 31)}…` : expr;
}

function cleanFunction(f) {
  const out = { ...f };
  delete out.body;
  delete out.ctx;
  return out;
}
