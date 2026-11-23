// 台本（Markdown）の〔スライド：…〕ごとに1枚を作り、その区切りの台詞をノートに入れる PowerPoint を組み立てる共通部分。
// 使い方は SKILL.md と references/components.md を読む。pptxgenjs と jszip は setup.ps1 が作業フォルダーに入れる。
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const JSZip = require("jszip");

// 日本語は BIZ UD 系。英字は下線（_）がはっきり出るフォントにする（BIZ UD の下線は小さい文字で消える）。
const FONTS = { ea: "BIZ UDPゴシック", latin: "Segoe UI", codeEa: "BIZ UDゴシック", codeLatin: "Consolas" };

// 既定の配色。題材に合わせて createDeck({ theme }) で差し替える。12色すべてを6桁の16進数で書く。
const DEFAULT_THEME = {
  name: "Script Deck",
  colors: {
    dk1: "1F2430", lt1: "FFFFFF", dk2: "1E2B45", lt2: "EEF1F6",
    accent1: "C8402A", // 強調（印・問い・注意）
    accent2: "2C7365", // 良い・正解・採用
    accent3: "9A6A12", // 次善・保留
    accent4: "8A3A66", // ひっかけ・注意の別系統
    accent5: "586274", // 補足の文字・誤り・見送り
    accent6: "C9D0DC", // 線・暗い背景の上の文字
    hlink: "2F5E9E", folHlink: "6B5A9E",
  },
};
const SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

module.exports = function createDeck({ title, subject = "", theme = DEFAULT_THEME, tags } = {}) {
  for (const k of SLOTS) {
    if (!/^[0-9A-Fa-f]{6}$/.test(String(theme.colors?.[k]))) throw new Error(`theme.colors.${k} が6桁の16進数ではない: ${theme.colors?.[k]}`);
  }
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 インチ
  pres.title = title;
  pres.subject = subject;
  pres.theme = { headFontFace: FONTS.latin, bodyFontFace: FONTS.latin };
  const C = pres.SchemeColor;
  const S = pres.shapes;
  // 本文の領域。タイトルの下 1.75 から、出典の行の上 6.8 まで。左右の余白は 0.6。
  const X0 = 0.6, XW = 12.133, Y0 = 1.75, YB = 6.8;
  const W2 = 5.9, XR = X0 + 6.233; // 2列のときの列の幅と右の列の左端

  let seq = 0;
  const on = (p) => `${p}-${++seq}`;
  const BASE = () => ({ isTextBox: true, margin: 0, fontSize: 16, color: C.text1, valign: "top", lang: "ja-JP" });

  // 空の文字列を取り除く。書式付きの文字（runs）に "" が混ざると、PowerPoint がファイルを開けなくなる。
  // 取り除いた run が改行を持っていたら、改行は一つ前の run に移す。
  function clean(text) {
    if (!Array.isArray(text)) return text === "" || text == null ? " " : text;
    const out = [];
    for (const r of text) {
      const t = typeof r === "string" ? r : r?.text;
      if (t === "" || t == null) {
        if (r?.options?.breakLine && out.length) { const p = out[out.length - 1]; out[out.length - 1] = { text: p.text, options: Object.assign({}, p.options, { breakLine: true }) }; }
        continue;
      }
      out.push(typeof r === "string" ? { text: r } : r);
    }
    return out.length ? out : " ";
  }
  // 文字。text は文字列か、{ text, options } の配列（太字や色を一部だけ変えるとき）。
  // スライドに文字を置くときは、s.addText を直接使わず、この T を使う（空の文字列を取り除くため）。
  function T(s, text, x, y, w, h, o = {}) {
    s.addText(clean(text), Object.assign(BASE(), { x, y, w, h, objectName: on("text") }, o));
  }
  // 箱。fill（塗り）、line（枠の色）、lineW、dash、r（角の丸み）、square（角を丸めない）。
  function R(s, x, y, w, h, o = {}) {
    const line = o.line ? { color: o.line, width: o.lineW ?? 1.25 } : { type: "none" };
    if (o.line && o.dash) line.dashType = o.dash;
    const opt = { x, y, w, h, fill: { color: o.fill ?? C.background2 }, line, objectName: on(o.name ?? "box") };
    if (!o.square) opt.rectRadius = o.r ?? 0.08;
    s.addShape(o.square ? S.RECTANGLE : S.ROUNDED_RECTANGLE, opt);
  }
  // 矢印・線。始点から終点へ。arrow:false で矢じりなし、dash: "dash" | "sysDot" など。
  function ARW(s, x1, y1, x2, y2, o = {}) {
    const line = { color: o.color ?? C.text1, width: o.width ?? 1.25 };
    if (o.arrow !== false) line.endArrowType = "triangle";
    if (o.dash) line.dashType = o.dash;
    s.addShape(S.LINE, {
      x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      line, flipH: x2 < x1, flipV: y2 < y1, objectName: on("arrow"),
    });
  }
  // 等幅フォントでの文字列の幅（インチ）。チップの幅を決めるのに使う。
  function cw(str, pt) { let u = 0; for (const ch of str) u += ch.charCodeAt(0) < 0x2000 ? 0.55 : 1; return (u * pt) / 72; }
  // チップ：コマンド名・設定名・項目名など「決まった形の名前」を等幅の枠で示す。幅を返す。
  // tone: "mark"（朱の枠、既定）| "grey" | "good"（緑の枠）| "filled"（朱の塗り）
  function CHIP(s, label, x, y, o = {}) {
    const pt = o.pt ?? 14;
    const w = o.w ?? cw(label, pt) + 0.3;
    const h = o.h ?? (pt / 72) * 1.9;
    const tone = { mark: [C.background1, C.accent1, C.accent1], grey: [C.background1, C.accent5, C.text1], good: [C.background1, C.accent2, C.accent2], filled: [C.accent1, C.accent1, C.background1] }[o.tone ?? "mark"];
    s.addText(label, Object.assign(BASE(), {
      x, y, w, h, shape: S.ROUNDED_RECTANGLE, rectRadius: 0.05,
      fill: { color: tone[0] }, line: { color: tone[1], width: 1.25 }, color: tone[2],
      fontFace: FONTS.codeEa, fontSize: pt, bold: true, align: "center", valign: "middle", objectName: on("chip"),
    }));
    return w;
  }
  // ラベル：判定や区分を色の塗りで示す（最善策・次善策・採用・見送りなど）。色は tags の対応か o.color。
  const TAGS = Object.assign({ "最善策": C.accent2, "次善策": C.accent3, "ひっかけ": C.accent4, "誤り": C.accent5, "採用": C.accent2, "見送り": C.accent5, "注意": C.accent1 }, tags || {});
  function TAG(s, label, x, y, o = {}) {
    s.addText(label, Object.assign(BASE(), {
      x, y, w: o.w ?? 1.05, h: o.h ?? 0.34, shape: S.ROUNDED_RECTANGLE, rectRadius: 0.05, fill: { color: o.color ?? TAGS[label] ?? C.accent5 },
      color: C.background1, fontSize: o.pt ?? 13, bold: true, align: "center", valign: "middle", objectName: on("tag"),
    }));
  }
  // ラベル付きの行の並び（選択肢と判定、案と評価など）。rows: [{ tag, text, note }]。
  // inline:true は「太字の text　灰色の note」を1行に、false は2段に書く。行の間隔 rh は 0.42 以上にする（ラベルがくっつく）。
  function ROWS(s, x, y, w, rows, o = {}) {
    const rh = o.rh ?? 0.8;
    if (o.head) T(s, o.head, x, y - 0.36, 4, 0.3, { fontSize: 14, bold: true, color: C.accent5 });
    rows.forEach((r, i) => {
      const yy = y + i * rh;
      TAG(s, r.tag, x, yy + 0.01, r.color ? { color: r.color } : {});
      const runs = o.inline
        ? [{ text: r.text, options: { bold: true } }, { text: r.note ? "　" + r.note : "", options: { color: C.accent5 } }]
        : [{ text: r.text, options: { bold: true, breakLine: !!r.note } }, ...(r.note ? [{ text: r.note, options: { color: C.accent5 } }] : [])];
      T(s, runs, x + 1.2, yy + 0.03, w - 1.2, rh - 0.08, { fontSize: o.pt ?? 14 });
    });
  }
  // 番号の丸。
  function NUM(s, n, x, y, d = 0.5, fill = C.text2) {
    s.addText(String(n), Object.assign(BASE(), {
      x, y, w: d, h: d, shape: S.OVAL, fill: { color: fill }, color: C.background1,
      fontSize: Math.round(d * 34), bold: true, align: "center", valign: "middle", objectName: on("num"),
    }));
  }
  // コードの行。行は文字列か [[文字列, 種類], ...]。種類 hl は朱の太字、ok は緑の太字、mute は灰色。先頭の空白は保たれる。
  function codeRuns(lines) {
    const runs = [];
    lines.forEach((ln, i) => {
      const segs = typeof ln === "string" ? [[ln]] : ln;
      segs.forEach(([t, st], j) => {
        const op = {};
        if (st === "hl") { op.color = C.accent1; op.bold = true; }
        if (st === "ok") { op.color = C.accent2; op.bold = true; }
        if (st === "mute") op.color = C.accent5;
        if (j === segs.length - 1 && i < lines.length - 1) op.breakLine = true;
        runs.push({ text: t.replace(/^ +/, (sp) => " ".repeat(sp.length)) || " ", options: op });
      });
    });
    return runs;
  }
  // コードの箱。行の高さは ls（ポイント）で固定する。行数 × ls / 72 + 0.4 が箱の高さの目安。
  function CODE(s, lines, x, y, w, h, o = {}) {
    R(s, x, y, w, h, { fill: o.fill ?? C.background2, line: o.line, lineW: o.lineW, name: "code" });
    T(s, codeRuns(lines), x + 0.25, y + 0.2, w - 0.5, h - 0.4, { fontFace: FONTS.codeEa, fontSize: o.pt ?? 14, lineSpacing: o.ls ?? 22, color: o.color ?? C.text1 });
  }
  // 箇条書きの runs。T の text に渡す。
  function BUL(items, o = {}) {
    return items.map((t, i) => ({ text: t, options: Object.assign({ bullet: { indent: 16 }, paraSpaceAfter: 6 }, o, i < items.length - 1 ? { breakLine: true } : {}) }));
  }
  // 表。見出しのセルは HD("…")。一部だけ書式を変えるセルは { text: [{text, options}, ...] } と書く（配列をそのまま置くと空になる）。
  const HD = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.text2 } } });
  function TABLE(s, rows, o) {
    s.addTable(rows, Object.assign({ fontSize: 14, color: C.text1, valign: "middle", border: { type: "solid", pt: 0.75, color: C.accent6 }, objectName: on("table") }, o));
  }
  // 横に並ぶ矢羽根（順番・段階）。文字は短く、2行に分けるなら \n を入れる（矢羽根の文字の領域は狭い）。
  function CHEV(s, items, x, y, step, w, h, o = {}) {
    items.forEach((t, i) => {
      s.addText(t, Object.assign(BASE(), {
        x: x + i * step, y, w, h, shape: S.CHEVRON, fill: { color: o.fill ?? C.background2 },
        fontSize: o.pt ?? 14, bold: true, align: "center", valign: "middle", margin: o.margin ?? 4, objectName: on("step"),
      }));
    });
  }
  // 横に並ぶ箱と矢印。items: [[見出し, 説明, 強調]]。強調は枠の色か "dark"（濃い塗り）。
  function FLOW(s, items, x, y, w, h, gap, o = {}) {
    items.forEach(([a, b, hot], i) => {
      const xx = x + i * (w + gap);
      const dark = hot === "dark";
      R(s, xx, y, w, h, { fill: dark ? C.text2 : hot ? C.background1 : C.background2, line: hot && !dark ? hot : undefined, lineW: 2 });
      const runs = [{ text: a, options: { bold: true, breakLine: !!b } }];
      if (b) runs.push({ text: b, options: { fontSize: o.sub ?? 13, bold: false, color: dark ? C.accent6 : C.accent5 } });
      T(s, runs, xx + 0.15, y, w - 0.3, h, { fontSize: o.pt ?? 15, align: "center", valign: "middle", color: dark ? C.background1 : C.text1 });
      if (i < items.length - 1) ARW(s, xx + w + 0.05, y + h / 2, xx + w + gap - 0.05, y + h / 2, { color: C.accent5, width: 1.5 });
    });
  }
  // 見出し付きの箱。body は文字列か runs の配列。
  function BOX(s, head, body, x, y, w, h, o = {}) {
    R(s, x, y, w, h, { fill: o.fill ?? C.background2, line: o.line, lineW: 2 });
    const rest = Array.isArray(body) ? body : [{ text: body, options: { fontSize: o.pt ?? 15 } }];
    T(s, [{ text: head, options: { bold: true, fontSize: o.hpt ?? 17, color: o.hc ?? C.text1, breakLine: true } }, ...rest], x + 0.25, y + 0.15, w - 0.5, h - 0.3, { color: o.color ?? C.text1 });
  }
  // 問い・一問の箱。答えは書かない（答えはノートの台詞にある）。
  function QBOX(s, label, text, x, y, w, h, o = {}) {
    R(s, x, y, w, h, { fill: o.fill ?? C.background2 });
    T(s, [{ text: label + "　", options: { bold: true, color: C.accent1 } }, { text, options: { bold: !!o.bold } }], x + 0.25, y, w - 0.5, h, { fontSize: o.pt ?? 16, valign: "middle" });
  }
  // 大きな数字と単位。数字は本文のフォント（等幅の 0 は斜線入りに見える）。
  function STAT(s, value, unit, x, y, w, h, o = {}) {
    T(s, [{ text: value, options: { fontSize: o.pt ?? 72, color: o.color ?? C.accent1 } }, { text: unit ? " " + unit : "", options: { fontSize: o.upt ?? 28, color: o.ucolor ?? o.color ?? C.accent1 } }], x, y, w, h, { bold: true, valign: "bottom" });
  }
  // 画像の置き場所。台本が画面写真や写真を指示していて、手元に画像がないときに使う。
  function IMGPH(s, label, x, y, w, h) {
    R(s, x, y, w, h, { fill: C.background1, line: C.accent5, lineW: 1.5, dash: "dash", name: "image-placeholder" });
    T(s, [{ text: "画像を差し替える", options: { bold: true, breakLine: true, color: C.accent5 } }, { text: label, options: { fontSize: 14 } }], x + 0.3, y, w - 0.6, h, { fontSize: 16, align: "center", valign: "middle" });
  }

  // ---------- レイアウト ----------
  const PH = (name, type, x, y, w, h, o) => ({ placeholder: { options: Object.assign({ name, type, x, y, w, h, margin: 0, align: "left" }, o), text: "" } });
  pres.defineSlideMaster({
    title: "TITLE", background: { color: C.text2 },
    objects: [
      PH("title", "title", 0.8, 2.3, 11.7, 1.6, { fontSize: 44, bold: true, color: C.background1, valign: "bottom" }),
      PH("subtitle", "body", 0.8, 4.15, 11.7, 1.5, { fontSize: 20, color: C.accent6, valign: "top" }),
    ],
  });
  pres.defineSlideMaster({
    title: "CONTENT", background: { color: C.background1 },
    objects: [
      PH("kicker", "body", X0, 0.32, 10.5, 0.36, { fontSize: 14, bold: true, color: C.accent1 }),
      PH("title", "title", X0, 0.7, XW, 0.85, { fontSize: 32, bold: true, color: C.text1, valign: "top" }),
      PH("source", "body", X0, 6.98, 11.0, 0.3, { fontSize: 11, color: C.accent5 }),
    ],
    slideNumber: { x: 12.13, y: 6.98, w: 0.6, h: 0.3, fontSize: 11, color: C.accent5, align: "right" },
  });
  pres.defineSlideMaster({
    title: "DARK", background: { color: C.text2 },
    objects: [
      PH("kicker", "body", X0, 0.32, 10.5, 0.36, { fontSize: 14, bold: true, color: C.accent6 }),
      PH("title", "title", X0, 0.7, XW, 0.85, { fontSize: 32, bold: true, color: C.background1, valign: "top" }),
      PH("source", "body", X0, 6.98, 11.0, 0.3, { fontSize: 11, color: C.accent6 }),
    ],
    slideNumber: { x: 12.13, y: 6.98, w: 0.6, h: 0.3, fontSize: 11, color: C.accent6, align: "right" },
  });

  // ---------- スライドの定義 ----------
  // def(台本の〔スライド：…〕の中身, "CONTENT" | "DARK" | "TITLE", タイトル, 出典の行, (s) => { 部品を置く })
  // "TITLE" は台本の指示そのものが表紙のとき。タイトルが大見出しに、出典の行の文字が副題（\n で改行）になる。
  // 最初の定義が "TITLE" なら、自動の表紙は作らない。
  const defs = [];
  const def = (cue, layout, title, src, fn = () => {}) => defs.push({ cue, layout, title, src, fn });

  // 台本を〔スライド：…〕で区切る。「## 台本」があればその節だけ、なければ全体を読む。
  // 区切りの見出しは、直前の ### か ## の見出し（「## 台本」自身は除く）。最初の指示より前の台詞は pre に入る。
  function parseScript(mdPath) {
    const md = fs.readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
    let body = md;
    const m = md.match(/\n## 台本[^\n]*\n([\s\S]*?)(?=\n## |\s*$)/);
    if (m) body = m[1];
    const segs = [];
    const pre = [];
    let section = null;
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      const h = line.match(/^#{2,3} (.+)$/);
      // 見出しの末尾の時間の目安（「（0:00〜1:30）」など）は、段階名に出さない
      if (h) { section = h[1].trim().replace(/\s*[（(]\s*\d{1,2}:\d{2}\s*[〜～~\-－]\s*\d{1,2}:\d{2}\s*[）)]\s*$/, ""); continue; }
      const c = line.match(/^〔スライド[：:](.*)〕$/);
      if (c) { segs.push({ section, cue: c[1].trim(), lines: [] }); continue; }
      if (!line) continue;
      if (segs.length) segs[segs.length - 1].lines.push(line); else pre.push(line);
    }
    segs.pre = pre;
    return segs;
  }

  async function build({ md, out, coverTitle, coverLines = [], coverNotes = "発表を始める前に映しておく。最初の台詞は次のスライドから。" }) {
    const segs = parseScript(md);
    if (!segs.length) throw new Error("台本に〔スライド：…〕の行がない。区切りを入れた写しを作ってから渡す");
    if (segs.length !== defs.length) throw new Error(`台本のスライド ${segs.length} 枚と定義 ${defs.length} 枚が合わない`);
    defs.forEach((d, i) => { if (segs[i].cue !== d.cue) throw new Error(`${i + 1} 枚目の対応がずれている: 台本「${segs[i].cue}」/ 定義「${d.cue}」`); });

    const titleLike = (s, title, sub, notes) => {
      s.addText(title, { placeholder: "title" });
      const lines = Array.isArray(sub) ? sub : String(sub || "").split("\n").filter(Boolean);
      if (lines.length) s.addText(clean(lines.map((t, i) => ({ text: t, options: i < lines.length - 1 ? { breakLine: true } : {} }))), { placeholder: "subtitle" });
      if (notes) s.addNotes(notes);
    };
    if (defs[0].layout !== "TITLE") {
      pres.addSection({ title: "表紙" });
      const cover = pres.addSlide({ masterName: "TITLE", sectionTitle: "表紙" });
      titleLike(cover, coverTitle, coverLines, segs.pre.length ? segs.pre.join("\n") : coverNotes);
    }

    let cur;
    defs.forEach((d, i) => {
      const seg = segs[i];
      const sec = seg.section || (d.layout === "TITLE" ? "表紙" : "本編");
      if (sec !== cur) { pres.addSection({ title: sec }); cur = sec; }
      const s = pres.addSlide({ masterName: d.layout, sectionTitle: sec });
      const lines = i === 0 && defs[0].layout === "TITLE" ? [...segs.pre, ...seg.lines] : seg.lines;
      if (d.layout === "TITLE") { titleLike(s, d.title, d.src, lines.join("\n")); d.fn(s); return; }
      if (seg.section) s.addText(seg.section, { placeholder: "kicker" });
      s.addText(d.title, { placeholder: "title" });
      if (d.src) s.addText(d.src, { placeholder: "source" });
      d.fn(s);
      if (lines.length) s.addNotes(lines.join("\n"));
    });

    await pres.writeFile({ fileName: out });
    await finish(out);
    console.log(`${defs.length + (defs[0].layout === "TITLE" ? 0 : 1)} slides -> ${out}`);
  }

  // 書き出した後の仕上げ。テーマの色と名前、日本語のフォント、コードの英字のフォントを書き込み、ZIP のフォルダー項目を取り除く。
  async function finish(out) {
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const part = "ppt/theme/theme1.xml";
    const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const scheme = `<a:clrScheme name="${esc(theme.name)}">` + SLOTS.map((k) => `<a:${k}><a:srgbClr val="${String(theme.colors[k]).toUpperCase()}"/></a:${k}>`).join("") + "</a:clrScheme>";
    let xml = await zip.file(part).async("string");
    xml = xml.replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => scheme)
      .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, head) => `${head}${esc(theme.name)}"`)
      .replace(/(<a:(?:major|minor)Font>[\s\S]*?)<a:ea typeface="[^"]*"\/>/g, (_, head) => `${head}<a:ea typeface="${FONTS.ea}"/>`)
      .replace(/<a:font script="Jpan" typeface="[^"]*"\/>/g, `<a:font script="Jpan" typeface="${FONTS.ea}"/>`);
    zip.file(part, xml);
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) { delete zip.files[name]; continue; }
      if (!name.endsWith(".xml")) continue;
      let x = await zip.file(name).async("string");
      const bad = x.match(/<a:srgbClr val="((?![0-9A-Fa-f]{6}")[^"]*)"/);
      if (bad) throw new Error(`${name} に6桁の16進数でない色 "${bad[1]}" がある。16進数しか受け付けない項目（影の色など）に配色の名前を渡していないか確かめる`);
      if (/^ppt\/(slides|slideLayouts)\//.test(name)) x = x.replaceAll(`<a:latin typeface="${FONTS.codeEa}"`, `<a:latin typeface="${FONTS.codeLatin}"`);
      zip.file(name, x);
    }
    fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  }

  return { pres, C, S, X0, XW, Y0, YB, W2, XR, FONTS, on, BASE, T, R, ARW, cw, CHIP, TAG, ROWS, NUM, codeRuns, CODE, BUL, HD, TABLE, CHEV, FLOW, BOX, QBOX, STAT, IMGPH, def, parseScript, build };
};
module.exports.DEFAULT_THEME = DEFAULT_THEME;
