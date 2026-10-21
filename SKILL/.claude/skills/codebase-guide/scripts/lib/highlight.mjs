// 生成時にHTMLへ埋め込むシンタックスハイライト。ブラウザ表示時に外部CDNやnpmパッケージを必要としない。

import path from 'node:path';
import { escapeHtml } from './common.mjs';

const HIGHLIGHT_KEYWORDS = {
  javascript: new Set('as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield true false null undefined'.split(' ')),
  python: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case'.split(' ')),
  java: new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null record sealed permits var'.split(' ')),
  c: new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool true false null'.split(' ')),
  go: new Set('break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var true false nil'.split(' ')),
  rust: new Set('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(' ')),
  sql: new Set('select from where join inner left right full outer on group by order having limit offset insert into values update set delete create alter drop table view index distinct union all as and or not null is in exists between like case when then else end asc desc primary key foreign references constraint default true false'.split(' ')),
  shell: new Set('if then else elif fi for while until do done case esac function in select time coproc export local readonly declare typeset unset shift return break continue true false'.split(' ')),
  css: new Set('@media @supports @import @font-face @keyframes @layer @container inherit initial unset revert important'.split(' ')),
};

function highlightFamily(file) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file).toLowerCase();
  if (['.ts','.tsx','.js','.jsx','.mjs','.cjs','.vue','.svelte'].includes(ext)) return 'javascript';
  if (ext === '.py') return 'python';
  if (['.java','.kt','.kts','.gradle'].includes(ext)) return 'java';
  if (['.c','.h','.cpp','.cc','.cxx','.hpp','.hh','.cs'].includes(ext)) return 'c';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  if (ext === '.sql') return 'sql';
  if (['.sh','.bash','.zsh','.ps1','.bat','.cmd'].includes(ext) || base === 'dockerfile') return 'shell';
  if (['.css','.scss','.sass','.less'].includes(ext)) return 'css';
  if (['.html','.htm','.xml','.svg'].includes(ext)) return 'markup';
  if (ext === '.json') return 'json';
  if (['.yaml','.yml','.toml','.ini','.properties'].includes(ext)) return 'config';
  if (ext === '.md') return 'markdown';
  if (['.graphql','.gql'].includes(ext)) return 'graphql';
  return 'plain';
}

function keywordSetFor(family) {
  if (family === 'graphql') return new Set('query mutation subscription fragment on schema type interface union enum input scalar directive extend implements true false null'.split(' '));
  return HIGHLIGHT_KEYWORDS[family] || new Set();
}

// links は本文の位置 → { len, open }(xref.mjs の xrefLinks)。字句の位置と長さが一致したときだけ <a> で囲み、使ったものに used を付ける。
export function highlightCode(text, file, links = null) {
  const family = highlightFamily(file);
  if (family === 'plain') return escapeHtml(text);
  if (family === 'markup') return highlightMarkup(text);
  if (family === 'markdown') return highlightMarkdown(text);
  if (family === 'config') return highlightConfig(text);
  return highlightCStyle(text, family, links);
}

function span(cls, value) {
  return escapeHtml(value).split('\n').map(part => `<span class="tok-${cls}">${part}</span>`).join('\n');
}

function highlightMarkup(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const j = end < 0 ? text.length : end + 3;
      out += span('comment', text.slice(i, j)); i = j; continue;
    }
    if (text[i] === '<') {
      const end = text.indexOf('>', i + 1);
      const j = end < 0 ? text.length : end + 1;
      const raw = text.slice(i, j);
      const escaped = escapeHtml(raw)
        .replace(/(&lt;\/?)([A-Za-z][\w:-]*)/, '$1<span class="tok-tag">$2</span>')
        .replace(/\s([A-Za-z_:][-\w:.]*)(=)/g, ' <span class="tok-attr">$1</span>$2')
        .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="tok-string">$1</span>');
      out += escaped; i = j; continue;
    }
    const next = text.indexOf('<', i);
    const j = next < 0 ? text.length : next;
    out += escapeHtml(text.slice(i, j)); i = j;
  }
  return out;
}

function highlightMarkdown(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let fenced = false;
  return lines.map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return span('keyword', line); }
    if (fenced) return escapeHtml(line);
    let e = escapeHtml(line);
    e = e.replace(/^(\s{0,3}#{1,6}\s+)(.*)$/,'<span class="tok-keyword">$1</span><span class="tok-title">$2</span>');
    e = e.replace(/(`[^`]+`)/g,'<span class="tok-string">$1</span>');
    e = e.replace(/(\*\*[^*]+\*\*|__[^_]+__)/g,'<span class="tok-title">$1</span>');
    e = e.replace(/(\[[^\]]+\]\([^\)]+\))/g,'<span class="tok-link">$1</span>');
    return e;
  }).join('\n');
}

function highlightConfig(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(line => {
    const m = line.match(/^(\s*)(#|;)(.*)$/);
    if (m) return escapeHtml(m[1]) + span('comment', m[2] + m[3]);
    const kv = line.match(/^(\s*)([^:=\s][^:=]*?)(\s*[:=]\s*)(.*)$/);
    if (kv) return escapeHtml(kv[1]) + span('attr', kv[2]) + escapeHtml(kv[3]) + highlightCStyle(kv[4], 'json');
    return highlightCStyle(line, 'json');
  }).join('\n');
}

// 言語ごとの真偽値・空値。大文字小文字は区別する(Java の TRUE のような定数名を true と同じ扱いにしない)。設定ファイルの値だけは TRUE も真偽値とみなす。
const LITERALS = {
  javascript: /^(true|false|null|undefined)$/,
  python: /^(True|False|None)$/,
  go: /^(true|false|nil)$/,
  rust: /^(true|false)$/,
  json: /^(true|false|null)$/i,
  default: /^(true|false|null)$/,
};

// 正規表現リテラルを始められる直前の字句(これ以外の後ろの / は割り算とみなす)
// } の後ろは、JSX の {…} /> と区別できないので含めない
const REGEX_AFTER_PUNCT = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '~', '^', '=>']);
const REGEX_AFTER_KEYWORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

// テンプレートリテラルの ${ の後ろから、対応する } の位置を返す(無ければ本文の末尾)
function templateExpressionEnd(text, from) {
  let depth = 1;
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (j++; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return text.length;
}

// base は text が元の本文のどこから始まるか(テンプレートリテラルの ${ … } を再帰で色付けするときに、リンクの位置を合わせる)
function highlightCStyle(text, family, links = null, base = 0) {
  const keywords = keywordSetFor(family);
  const js = family === 'javascript';
  const linked = (at, len, html) => {
    const link = links && links.get(base + at);
    if (!link || link.len !== len || html.includes('\n')) return html;
    link.used = true;
    return `${link.open}${html}</a>`;
  };
  let out = '';
  let i = 0;
  let blockComment = false;
  // 直前の意味のある字句(空白とコメントを除く)。正規表現リテラルと、. の後ろのプロパティ名の判定に使う。
  let prev = null;
  const hashComments = ['python','shell','graphql'].includes(family);
  const slashComments = !['python','shell','graphql','sql','css','json'].includes(family);
  while (i < text.length) {
    if (blockComment) {
      const end = text.indexOf('*/', i);
      const j = end < 0 ? text.length : end + 2;
      out += span('comment', text.slice(i, j)); i = j; blockComment = end < 0; continue;
    }
    if (text.startsWith('/*', i) && !['python','shell','graphql','json'].includes(family)) {
      const end = text.indexOf('*/', i + 2);
      const j = end < 0 ? text.length : end + 2;
      out += span('comment', text.slice(i, j)); i = j; blockComment = end < 0; continue;
    }
    if ((slashComments && text.startsWith('//', i)) || (family === 'sql' && text.startsWith('--', i)) || (hashComments && text[i] === '#')) {
      const end = text.indexOf('\n', i);
      const j = end < 0 ? text.length : end;
      out += span('comment', text.slice(i, j)); i = j; continue;
    }
    const ch = text[i];
    if (js && ch === '`') {
      // テンプレートリテラル: ${ … } の中はコードとして色付けする
      let j = i + 1;
      let seg = i;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '`') { j++; break; }
        if (text[j] === '$' && text[j + 1] === '{') {
          out += span('string', text.slice(seg, j)) + span('keyword', '${');
          const end = templateExpressionEnd(text, j + 2);
          out += highlightCStyle(text.slice(j + 2, end), family, links, base + j + 2);
          if (end < text.length) out += span('keyword', '}');
          j = seg = end + 1;
          continue;
        }
        j++;
      }
      j = Math.min(j, text.length);
      out += seg === i ? linked(i, j - i, span('string', text.slice(i, j))) : span('string', text.slice(seg, j));
      i = j; prev = 'value'; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch; let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === quote) { j++; break; }
        // JavaScript の '…' と "…" は行をまたがない(閉じ忘れや JSX の文中の ' で、以降の行の色がずれるのを防ぐ)
        if (js && text[j] === '\n') break;
        j++;
      }
      out += linked(i, j - i, span('string', text.slice(i, j))); i = j; prev = 'value'; continue;
    }
    if (js && ch === '/' && text[i + 1] !== '>' && (prev === null || REGEX_AFTER_PUNCT.has(prev) || REGEX_AFTER_KEYWORD.has(prev))) {
      // 正規表現リテラル(同じ行の中で閉じるものだけ)
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n') {
        const c = text[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j++;
      }
      if (j < text.length && text[j] === '/') {
        j++;
        while (j < text.length && /[a-z]/i.test(text[j])) j++;
        out += span('regex', text.slice(i, j)); i = j; prev = 'value'; continue;
      }
    }
    const num = text.slice(i).match(/^(?:0x[0-9a-fA-F]+|0b[01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (num) { out += span('number', num[0]); i += num[0].length; prev = 'value'; continue; }
    const word = text.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const w = word[0];
      // obj.get や obj.delete のように . の後ろにある名前は、予約語と同じつづりでもプロパティ名
      const property = js && prev === '.';
      if (!property && keywords.has(family === 'sql' ? w.toLowerCase() : w)) { out += span('keyword', w); prev = w; }
      else if (!property && (LITERALS[family] || LITERALS.default).test(w)) { out += span('literal', w); prev = 'value'; }
      else {
        const tail = text.slice(i + w.length);
        out += linked(i, w.length, /^\s*\(/.test(tail) ? span('function', w) : escapeHtml(w));
        prev = 'value';
      }
      i += w.length; continue;
    }
    if (!/\s/.test(ch)) prev = ch === '>' && text[i - 1] === '=' ? '=>' : ch;
    out += escapeHtml(ch); i++;
  }
  return out;
}

export function languageFor(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.ts':'TypeScript','.tsx':'TSX','.js':'JavaScript','.jsx':'JSX','.mjs':'JavaScript','.cjs':'JavaScript',
    '.java':'Java','.kt':'Kotlin','.kts':'Kotlin','.py':'Python','.rb':'Ruby','.go':'Go','.rs':'Rust',
    '.c':'C','.h':'C Header','.cpp':'C++','.cc':'C++','.hpp':'C++ Header','.cs':'C#','.php':'PHP',
    '.html':'HTML','.htm':'HTML','.css':'CSS','.scss':'SCSS','.sass':'Sass','.less':'Less',
    '.json':'JSON','.yaml':'YAML','.yml':'YAML','.xml':'XML','.toml':'TOML','.ini':'INI','.properties':'Properties',
    '.md':'Markdown','.sql':'SQL','.sh':'Shell','.bash':'Shell','.zsh':'Shell','.ps1':'PowerShell','.bat':'Batch','.cmd':'Batch',
    '.gradle':'Gradle','.graphql':'GraphQL','.gql':'GraphQL','.vue':'Vue','.svelte':'Svelte'
  };
  return map[ext] || (path.basename(file).toLowerCase() === 'dockerfile' ? 'Dockerfile' : 'Plain Text');
}
