# 部品の使い方（lib.js）

```js
const createDeck = require("./lib");
const D = createDeck({ title, subject, theme, tags });
const { C, X0, XW, W2, XR, T, R, ARW, CHIP, TAG, ROWS, NUM, CODE, BUL, HD, TABLE, CHEV, FLOW, BOX, QBOX, STAT, IMGPH, def } = D;
```

- `theme`：`{ name, colors: { dk1, lt1, dk2, lt2, accent1…accent6, hlink, folHlink } }`。省くと既定の配色（紺と朱）。
- `tags`：`TAG` のラベルと色の対応を足す（例：`{ "保留": D.C.accent3 }`）。既定は 最善策・次善策・ひっかけ・誤り・採用・見送り・注意。
- 色は `C.text1`（本文の黒）、`C.text2`（濃い紺）、`C.background1`（白）、`C.background2`（薄い灰色）、`C.accent1`〜`C.accent6` で指定する。16進数を直接書かない。配色を変えたときに追従しなくなるからだ。

## スライドの定義と組み立て

| 関数 | 使い方 |
| --- | --- |
| `def(cue, layout, title, src, fn)` | 台本の〔スライド：cue〕の1枚。layout は `"CONTENT"`（白）、`"DARK"`（紺）、`"TITLE"`（台本の指示そのものが表紙のとき。title が大見出し、src が副題）。src は出典の行（空文字で省く）。fn の中で部品を置く |
| `build({ md, out, coverTitle, coverLines, coverNotes })` | 台本を読み、表紙と def の順にスライドを作り、ノートとセクションを入れて書き出す。指示の数や順番が def と合わなければ止まる |
| `parseScript(md)` | 台本の区切りだけを取り出す（`{ section, cue, lines }` の配列と、最初の指示より前の台詞 `pre`）。def を書く前に、指示の一覧を出すのに使える |

最初の def が `"TITLE"` でなければ、表紙が自動で作られる（`coverTitle` と、`coverLines` の各行）。
最初の指示より前に台詞があれば、表紙のノートに入る。

## 部品

| 関数 | 何を置くか | 主な指定 |
| --- | --- | --- |
| `T(s, text, x, y, w, h, o)` | 文字 | `fontSize`, `bold`, `color`, `align`, `valign`, `fontFace`。text は文字列か runs の配列 |
| `R(s, x, y, w, h, o)` | 箱 | `fill`, `line`（枠の色）, `lineW`, `dash`, `r`（角の丸み）, `square` |
| `ARW(s, x1, y1, x2, y2, o)` | 矢印・線 | `color`, `width`, `dash`, `arrow: false`（矢じりなし） |
| `CHIP(s, label, x, y, o)` | 名前を等幅の枠で。幅を返す | `tone`: `"mark"`（朱の枠）`"grey"` `"good"`（緑の枠）`"filled"`（朱の塗り）, `pt`, `w`, `h` |
| `TAG(s, label, x, y, o)` | 色の塗りのラベル | `color`, `w`, `h`, `pt` |
| `ROWS(s, x, y, w, rows, o)` | ラベル付きの行の並び | rows: `[{ tag, text, note, color }]`, `inline`, `rh`（0.42 以上）, `head`（上の小見出し） |
| `NUM(s, n, x, y, d, fill)` | 番号の丸 | d は直径（0.38〜0.8） |
| `CODE(s, lines, x, y, w, h, o)` | コードの箱 | `pt`, `ls`（行の高さのポイント）, `fill`, `line`。lines は下の書き方 |
| `BUL(items, o)` | 箇条書きの runs | `T` の text や `BOX` の body に渡す |
| `HD(text)` | 表の見出しのセル | |
| `TABLE(s, rows, o)` | 表 | `x`, `y`, `w`, `colW`, `rowH`, `fontSize` |
| `CHEV(s, items, x, y, step, w, h, o)` | 矢羽根の並び | `pt`, `margin`, `fill` |
| `FLOW(s, items, x, y, w, h, gap, o)` | 箱と矢印の並び | items: `[[見出し, 説明, 強調]]`。強調は枠の色か `"dark"`。`pt`, `sub` |
| `BOX(s, head, body, x, y, w, h, o)` | 見出し付きの箱 | `fill`, `line`, `hc`（見出しの色）, `hpt`, `pt` |
| `QBOX(s, label, text, x, y, w, h, o)` | 問いの箱 | `pt`, `bold` |
| `STAT(s, value, unit, x, y, w, h, o)` | 大きな数字 | `pt`, `upt`, `color` |
| `IMGPH(s, label, x, y, w, h)` | 画像の置き場所（点線の枠） | label に差し替える画像を書く |

画像が手元にあるときは、`s.addImage({ path, x, y, w, h })` で直接置く。

## 文字の一部だけ書式を変える

```js
T(s, [
  { text: "問い　", options: { bold: true, color: C.accent1 } },
  { text: "その印は何か", options: { breakLine: true } },   // breakLine で改行
  { text: "答えは後で出す", options: { fontSize: 14, color: C.accent5 } },
], X0, 5.5, XW, 0.95, { fontSize: 18 });
```

改行の位置を決めたいときは、文字列に `\n` を入れてもよい。

## 表のセル

```js
TABLE(s, [
  [HD("設定"), HD("働き")],
  [{ text: "tools", options: { fontFace: D.FONTS.codeEa, bold: true } }, "使えるツールの範囲"],
  // 一部だけ書式を変えるセルは { text: [runs] } と書く。runs の配列をそのまま置くと、セルが空になる
  ["原因", { text: [{ text: "スクラッチパッド", options: { bold: true, color: C.accent2 } }, { text: "に残す" }] }],
], { x: X0, y: 1.75, w: XW, colW: [4, 8.133], rowH: [0.45, 0.6, 0.6] });
```

## コードの行

```js
CODE(s, [
  [["// .claude/settings.json", "mute"]],        // 灰色
  "{ \"hooks\": {",
  [["    \"matcher\": ", ""], ["\"mcp__hr__grant\"", "hl"], [",", ""]],   // 一部だけ朱の太字
  [["  \"strict\": ", ""], ["true", "ok"]],       // 緑の太字
], X0, 1.8, 6.6, 3.0, { pt: 13, ls: 20 });
```

- 先頭の空白は保たれる（字下げに使える）。
- コードの日本語は BIZ UDゴシック、英字は Consolas で表示される（書き出し後に差し替わる）。
- 箱の高さは、行数 × ls ÷ 72 ＋ 0.4 インチを目安にする。
