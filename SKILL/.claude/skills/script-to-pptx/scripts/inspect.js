// できた pptx の中身を確かめる。スライドごとに、本文の先頭、ノートの行数、空の表のセルを出し、問題を最後にまとめる。
// 使い方: node inspect.js <deck.pptx> [--full]   （--full でスライドの文字とノートを全部出す）
const fs = require("fs");
const JSZip = require("jszip");

const [file, flag] = process.argv.slice(2);
const full = flag === "--full";
const texts = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));

(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const problems = [];
  for (const name of slides) {
    const no = +name.match(/\d+/)[0];
    const xml = await zip.file(name).async("string");
    const t = texts(xml);
    // スライドに付いているノートを、関係の定義からたどる
    const rels = await zip.file(name.replace("slides/", "slides/_rels/") + ".rels")?.async("string");
    const target = rels?.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
    let notes = [];
    if (target) notes = texts(await zip.file("ppt/notesSlides/" + target).async("string")).filter((x) => !/^\d+$/.test(x.trim())).flatMap((x) => x.split(/\r?\n/)).filter((x) => x.trim());
    const emptyCells = [...xml.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].filter((m) => !/<a:t>[^<]+<\/a:t>/.test(m[1])).length;
    const bad = t.filter((x) => /undefined|\[object Object\]|NaN/.test(x));
    const emptyRuns = (xml.match(/<a:r>(?:(?!<\/a:r>)[\s\S])*?<a:t><\/a:t><\/a:r>/g) || []).length;
    if (emptyRuns) problems.push(`${no} 枚目に空の文字の部分が ${emptyRuns} 個ある（PowerPoint で開けないことがある。T を使うか、空の文字列を入れない）`);
    console.log(`--- ${no}: ${t.slice(0, 3).join(" / ").slice(0, 90)}  | ノート ${notes.length} 行${emptyCells ? ` | 空のセル ${emptyCells}` : ""}`);
    if (full) { console.log(t.join("\n")); if (notes.length) console.log("[ノート]\n" + notes.join("\n")); }
    if (!notes.length) problems.push(`${no} 枚目にノートがない`);
    if (emptyCells) problems.push(`${no} 枚目の表に空のセルが ${emptyCells} 個ある（意図したものか確かめる）`);
    if (bad.length) problems.push(`${no} 枚目に壊れた文字がある: ${bad.join(" / ")}`);
  }
  console.log(`\nスライド ${slides.length} 枚`);
  console.log(problems.length ? "確かめること:\n- " + problems.join("\n- ") : "問題は見つからなかった");
})().catch((e) => { console.error(e); process.exit(1); });
