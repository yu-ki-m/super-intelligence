// 見本：example_script.md から5枚＋表紙を作る。新しい台本では、この形を写して deck.js を書く。
// 使い方: node deck-example.js example_script.md example.pptx   （作業フォルダーで、NODE_PATH は不要）
const createDeck = require("./lib");
const [MD, OUT] = process.argv.slice(2);

// 配色は題材に合わせて選ぶ。ここでは既定の配色をそのまま使う。
const D = createDeck({ title: "朝会を15分から5分にした話", subject: "LT" });
const { C, X0, XW, W2, XR, T, R, ARW, CHIP, TAG, ROWS, NUM, CODE, BUL, HD, TABLE, CHEV, FLOW, BOX, QBOX, STAT, IMGPH, def } = D;

// 1. 掴み：暗い背景で、問いを大きく。答え（25時間）はノートにだけある
def("「朝会、毎日15分」", "DARK", "朝会、毎日15分", "", (s) => {
  STAT(s, "15", "分", 1.5, 1.9, 4.5, 1.6, { pt: 96, color: C.background1, upt: 36 });
  T(s, "毎日の朝会の長さ", 1.5, 3.55, 6, 0.45, { fontSize: 18, color: C.accent6 });
  R(s, 1.5, 4.5, 10.33, 1.1, { fill: C.background1 });
  T(s, [{ text: "問い　", options: { bold: true, color: C.accent1 } }, { text: "5人のチームで、一か月に何時間になるか" }], 1.8, 4.5, 9.8, 1.1, { fontSize: 22, bold: true, valign: "middle" });
});

// 2. 比較：左右の2列。良い方に枠を付ける
def("変える前と後の比較", "CONTENT", "全員が話す朝会から、困りごとだけの朝会へ", "", (s) => {
  BOX(s, "変える前", BUL(["全員が順番に話す", "昨日やったことを、口で説明する"], { fontSize: 16 }), X0, 1.85, W2, 2.6, { hpt: 20 });
  BOX(s, "変えた後", BUL(["困っていることがある人だけが話す", "やったことは、前の日に書いておく"], { fontSize: 16 }), XR, 1.85, W2, 2.6, { hpt: 20, fill: C.background1, line: C.accent2, hc: C.accent2 });
  ARW(s, X0 + W2 + 0.03, 3.15, XR - 0.03, 3.15, { color: C.accent5, width: 2 });
});

// 3. 流れ：箱と矢印
def("朝会の流れ。書く、読む、困りごとだけ話す", "CONTENT", "朝会の流れは三つ", "", (s) => {
  FLOW(s, [["前の日の夕方", "やったことを書く"], ["朝会の前", "書いたものを読む"], ["朝会", "困りごとだけ話す", C.accent2]], X0, 2.2, 3.6, 1.4, 0.665, { pt: 18, sub: 15 });
  T(s, "話すのは、書いても伝わらないことだけ", X0, 4.2, XW, 0.5, { fontSize: 20, bold: true });
});

// 4. 表：一部だけ書式を変えるセルは { text: [...] } と書く
def("時間と満足度の表", "CONTENT", "一か月試した結果", "数値は見本のための例", (s) => {
  TABLE(s, [
    [HD("項目"), HD("変える前"), HD("変えた後")],
    ["朝会の時間", "15分", { text: [{ text: "5分", options: { bold: true, color: C.accent2 } }] }],
    ["満足度（5段階）", "2.8", { text: [{ text: "4.1", options: { bold: true, color: C.accent2 } }] }],
  ], { x: X0, y: 1.85, w: 8.0, colW: [3.2, 2.4, 2.4], fontSize: 18, rowH: 0.6 });
  ROWS(s, X0, 4.4, XW, [
    { tag: "採用", text: "困りごとだけを話す", note: "時間が3分の1になった" },
    { tag: "見送り", text: "朝会をなくす", note: "困りごとを言う場がなくなる" },
  ], { inline: true, rh: 0.5, head: "比べた案" });
});

// 5. 持ち帰り：暗い背景で、次の行動を一つだけ
def("「明日の朝会で、困りごとだけ聞いてみる」", "DARK", "明日の朝会で、一度だけ", "", (s) => {
  R(s, 1.5, 2.3, 10.33, 1.6, { fill: C.background1, r: 0.15 });
  T(s, "困りごとだけを、聞いてみる", 1.5, 2.3, 10.33, 1.6, { fontSize: 36, bold: true, align: "center", valign: "middle" });
});

D.build({ md: MD, out: OUT, coverTitle: "朝会を15分から5分にした話", coverLines: ["LT　5分"] })
  .catch((e) => { console.error(e); process.exit(1); });
