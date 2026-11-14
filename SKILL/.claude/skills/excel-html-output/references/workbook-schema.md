# ブックJSON（excel-html-workbook/v1）

`scripts/build.py --input` に渡すJSONの形式である。
ビルドとブラウザーは同じ検査（`assets/core.js` の `validate`）を使うので、ここに書いた制約を外れると、ビルドの時点で止まる。

```json
{
  "schema": "excel-html-workbook/v1",
  "id": "estimate-2026-acme",
  "revision": "draft",
  "title": "見積明細",
  "activeSheet": "main",
  "defaultStyle": {"font": "Yu Gothic", "size": 11},
  "view": {"zoom": 100},
  "sheets": [{
    "id": "main", "name": "見積", "rows": 60, "cols": 12,
    "colWidths": [90, 220, 70, 100, 110], "rowHeights": [32, 24, 24, 44],
    "freeze": {"rows": 3, "cols": 0}, "gridlines": true,
    "merges": [{"r1": 0, "c1": 0, "r2": 0, "c2": 4}],
    "cells": {
      "A1": {"t": "s", "v": "見積明細", "s": {"bold": true, "size": 16, "align": "center"}},
      "A3": {"t": "s", "v": "品番", "s": {"bold": true, "fill": "#e2efda", "borderBottom": "2px solid #217346"}},
      "A4": {"t": "s", "v": "00123", "s": {"numFmt": "@"}},
      "B4": {"t": "s", "v": "保守作業\n（月額）", "s": {"wrap": true}},
      "C4": {"t": "n", "v": 3},
      "D4": {"t": "n", "v": 12000, "s": {"numFmt": "¥#,##0"}},
      "E4": {"t": "f", "f": "=C4*D4", "s": {"numFmt": "¥#,##0"}}
    }
  }]
}
```

この例では、B4 の改行を見せるために `rowHeights[3]` を44にしている。
セルに収まらない文字を、余白を詰めたり文字を小さくしたりしてごまかさない。

## ブックとシート

- `id` はブックの恒久的なIDで、作り直しても変えない。
  `revision` はビルドのたびに内容のSHA-256から作り直されるので、`"draft"` のままでよい。
  ユーザーから戻ってきた編集状態は、このIDとリビジョンで元のHTMLと照合する。
- `activeSheet` は最初に開くシートのID。
  シートは1〜30枚。
  シート名はExcelと同じく31文字以内で、`\ / ? * [ ] :` を含まず、重複しない。
- `rows` と `cols` は表示する行数と列数で、上限は500行・100列。
  全セルを描画するので、大きな表は表示速度を確かめる。
- `colWidths` は列幅、`rowHeights` は行の高さで、CSSピクセルで書く。
  既定は列幅96px、行の高さ22px。
  `null` や省略は既定になる。
  幅は24〜800、高さは16〜600。
- `merges` は結合で、両端を含む0始まりの矩形（`r1,c1,r2,c2`）。
  重複は不可。
  左上以外のセルに値を置かない。
  結合範囲の書式（塗り・罫線を含む）は左上のセルに書く。
  左上以外のセルの書式は画面に出ず、Excelにも渡らない。
  結合が固定行・固定列の境界をまたぐことはできない。
- `freeze` は先頭から固定する行数と列数。
  `gridlines:false` で補助の枠線を隠す（セルの罫線は残る）。
- `view` は `zoom`（50〜200）、`active:[行,列]`、`selection:{r1,c1,r2,c2}`、`scrollTop`、`scrollLeft`。
  編集状態を書き出すと、その時点の位置が入る。

## セル

セルはA1形式の番地をキーにした辞書で、空のセルは書かなくてよい。

| t | 値 | 使いどころ |
|---|---|---|
| `s` | `v`: 文字列 | 文字。計算しない番号（管理番号、郵便番号、電話番号、コード）もここ。先頭ゼロがあれば `numFmt:"@"` |
| `n` | `v`: 有限の数値 | 数量・金額・比率・日付。表示は `numFmt` で決める |
| `b` | `v`: true / false | TRUE / FALSE |
| `f` | `f`: `=` で始まる式 | 合計・小計など。値はHTMLが計算する（キャッシュは持たない） |

- 日付は、1899-12-30 を0日目とするシリアル値（2026-01-01 は 46023）に `yyyy/mm/dd` を付ける。
  1900年のうるう年の互換やタイムゾーン付きの日時は扱わない。
- 比率は 0.25 のように小数で持ち、`0%` か `0.00%` を付ける。
- `link` に http(s) のURLを書くとリンクになる。
- セルの文字列はHTMLやJavaScriptとして実行されない。

## 書式（`s`）

書式は「既定 → `workbook.defaultStyle` → `sheet.defaultStyle` → セルの `s`」の順に重ねる。
既定は日本語版Excelの標準と同じである。

| キー | 値 | 既定 |
|---|---|---|
| `font` | フォント名（埋め込まない） | `Yu Gothic` |
| `size` | 6〜96（pt） | 11 |
| `bold`, `italic`, `underline`, `strike` | true / false | false |
| `color` | `#rrggbb` | `#000000` |
| `fill` | `#rrggbb`、または `none` | `none`（塗りなし） |
| `align` | `general` / `left` / `center` / `right` | `general`（数値は右、文字は左、真偽値は中央） |
| `valign` | `top` / `middle` / `bottom` | `middle` |
| `wrap` | true / false | false |
| `indent` | 0〜15（`align` は `left` か `right` と組み合わせる） | 0 |
| `borderTop`, `borderRight`, `borderBottom`, `borderLeft` | `none` または下の表の線＋色（例 `1px solid #808080`） | `none` |
| `numFmt` | `General` / `@` / `0` / `0.00` / `#,##0` / `#,##0.00` / `0%` / `0.00%` / `¥#,##0` / `yyyy/mm/dd` | `General` |

罫線は、Excelで表せる次の線だけを受け付ける。

| 値 | Excelの線 |
|---|---|
| `0.5px solid` | 極細 |
| `1px solid` | 細線 |
| `2px solid` | 中太線 |
| `3px solid` | 太線 |
| `1px dashed` / `2px dashed` | 破線（細）/ 破線（中） |
| `1px dotted` | 点線 |
| `3px double` | 二重線 |

Excelはセルの辺ごとに線を1本しか持てない。
隣り合うセルの境界（A1の下とA2の上など）に違う線を書くと、Excelではどちらか一方になる。
境界の線は片方のセルにだけ書くか、同じ線にそろえる。

一覧にない表示形式や線を通すと、画面とExcelの表示がずれる。
増やすときは、画面の表示（`display`・`css`）、クリップボードの書き出し（`xlCss`）、読み取り（`styleFromDecls`）を同時に実装し、`verify_excel_paste.py` で確かめる。

## 数式

HTMLで計算できるのは、同じシートのA1参照（`$` 付きを含む）と範囲、四則演算、べき乗、`%`、比較、`&`、括弧、文字列である。
関数は SUM / AVERAGE / MIN / MAX / COUNT / COUNTA / IF / IFERROR / AND / OR / NOT / ROUND / ROUNDDOWN / ROUNDUP / INT / ABS / MOD に限る。
未対応の関数は `#NAME?`、不正な引数は `#VALUE!`、循環参照は `#CIRC!` と表示する。
式の評価に `eval` や `Function` は使っていない。

Excelに貼ると、参照先がすべてコピー範囲の中にある数式は、数式のまま入る。
範囲の外を参照する数式は、HTMLが計算した値で入る。

## 編集状態（AIに渡すテキスト）

```text
EXCEL_HTML_STATE_V1
{"schema":"excel-html-state/v1","workbookId":"…","baseRevision":"sha256:…","exportedAt":"…","workbook":{…ブック全体…}}
```

差分ではなく、ブック全体の写しである。
値、型、数式、書式、空セル、結合、寸法、シートの順、表示位置を含む。
途中で切れたテキストは拒否し、推測で補わない。
更新しないセルや、知らない業務用の項目を削除しない。
