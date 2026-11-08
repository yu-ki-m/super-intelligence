# review.json と feedback.json の形式

エージェントは review.json（マニフェスト）を書いてレビュー画面に渡し、利用者の判定とコメントを feedback.json として受け取る。この文書は両方の形を定める。毎回同じ形で書けば、サーバーの検査（`--check`）がそのまま通り、前回の feedback.json も次の版に引き継げる。

## 目次

1. review.json の全体像
2. 項目（items）
3. ファイル（files）と表示のされ方
4. グループ（groups）
5. 判定欄（verdict）
6. 前回のレビューの引き継ぎ（previous_feedback）
7. feedback.json の形
8. 例：判定欄を変える・消す

## 1. review.json の全体像

```json
{
  "title": "ログイン画面の改善案レビュー",
  "instructions": "案Aと案Bのどちらを残すかを決めてください。迷う項目は未判定のままでかまいません。",
  "verdict": { "options": [ ... ] },
  "groups": [ {"id": "A", "label": "案A"}, {"id": "B", "label": "案B"} ],
  "items": [ ... ],
  "previous_feedback": "../round-1/feedback.json"
}
```

| キー | 必須 | 内容 |
| --- | --- | --- |
| `title` | 任意 | 画面の上部とタブに出る名前。省略すると「成果物レビュー」 |
| `instructions` | 任意 | レビュー全体の説明。書くと、画面は最初に「概要」を開き、この説明と項目の一覧を見せる |
| `items` | 必須 | レビューしてもらう項目の配列（1件以上） |
| `groups` | 任意 | 項目を分類する見出し。案ごと、反復ごとなど |
| `verdict` | 任意 | 判定欄の設定。省略すると「採用／要修正／不採用」 |
| `previous_feedback` | 任意 | 前回の feedback.json のパス。各項目に前回の判定とコメントを参考として出す |

相対パスはすべて review.json のあるフォルダを基準に解決する。ファイルは UTF-8 で書く（BOM 付きでも読める）。

## 2. 項目（items）

```json
{
  "id": "a-screen",
  "title": "案Aの画面",
  "group": "A",
  "description": "初めての利用者が、迷わずにログインボタンまでたどり着けるかを見てください。\nエラー文の言い回しにも意見があれば書いてください。",
  "files": ["案A/画面.html", "案A/style-notes.md"]
}
```

| キー | 必須 | 内容 |
| --- | --- | --- |
| `id` | 必須 | 項目を区別する文字列。重複は不可。feedback.json の照合と、前回のレビューとの対応に使うので、版を重ねても同じ成果物には同じ id を付ける |
| `title` | 任意 | 一覧と見出しに出る名前。省略すると id |
| `group` | 任意 | `groups` の id。`groups` に無い値を書くと、その値を名前にしたグループが末尾に足される |
| `description` | 任意だが書く | 利用者に「何を見て、何を判断してほしいか」。改行はそのまま表示される |
| `files` | 任意 | 表示するファイルのパスの配列。空でもよい（説明だけを読んで判断してもらう場合） |

`description` は、利用者が成果物を開く前に読む唯一の手がかりになる。「確認してください」だけでは、利用者は何を基準に判定すればよいか分からず、判定がばらつく。判断の観点（例：「見出しが30字以内か」「数字の根拠が本文にあるか」）と、判定の意味（例：「要修正なら直す点をコメントに」）を書く。

一覧と前後の移動の順序は、`groups` に書いた順 → 同じグループの中では `items` に書いた順 → グループの無い項目、になる。

## 3. ファイル（files）と表示のされ方

各要素はパスの文字列か、オブジェクト `{"path": "...", "label": "...", "type": "..."}` で書く。`label` は表示名（省略するとパス）、`type` は表示方法を拡張子から決めずに指定したいときに使う（`markdown` `html` `image` `table` `text` `binary`）。フォルダを指定すると、中のファイル（隠しファイルを除き、最大50件）に展開する。

| 種類 | 拡張子の例 | 表示 |
| --- | --- | --- |
| Markdown | `.md` `.markdown` | 整形して表示。「原文」に切り替えられる |
| HTML | `.html` `.htm` | sandbox 付きの iframe で表示。成果物のスクリプトは動くが、レビュー画面と保存 API には触れられない。サーバー表示では、HTML と同じフォルダ以下の CSS・画像を相対パスで読める |
| 画像 | `.png` `.jpg` `.gif` `.svg` `.webp` など | そのまま表示。クリックで実寸に切り替え |
| 表 | `.csv` `.tsv` | 等幅で表示。「表」に切り替えられる |
| テキスト・コード | 上記以外の文字のファイル（`.json` `.py` `.txt` など） | 行番号付きの等幅で表示 |
| バイナリ | 文字として読めないファイル（`.pdf` `.xlsx` など） | 表示せず、ファイルを開くリンクだけを出す |

表示の上限：テキストは先頭 256 KB、HTML は 2 MB、画像は 8 MB まで埋め込む。超えた分は「全文を開く」リンクから見てもらう。UTF-8 で読めない文字のファイルは cp932（Excel が書く CSV など）として読み、そのことを画面に示す。存在しないファイルは画面にエラーとして出るだけで、ページは壊れない（起動時に警告も出る）。

制約：静的表示（`--static`）では、HTML の相対パスの CSS・画像と、Markdown の相対パスの画像は読めない。見せたい場合は HTML に CSS を埋め込むか、サーバー表示を使う。

## 4. グループ（groups）

```json
"groups": [
  {"id": "A", "label": "案A", "description": "入力欄の順序を変える案"},
  {"id": "B", "label": "案B"}
]
```

文字列だけ（`"groups": ["案A", "案B"]`）でも書ける。その場合は id と表示名が同じになる。一覧ではグループごとに見出しと「n/m 判定済み」が出る。

## 5. 判定欄（verdict）

省略した場合の選択肢：

| value | label | 色 |
| --- | --- | --- |
| `adopt` | 採用 | 緑（good） |
| `revise` | 要修正 | 橙（warn） |
| `reject` | 不採用 | 赤（bad） |

選択肢を変える場合：

```json
"verdict": {
  "options": [
    {"value": "keep", "label": "残す", "tone": "good"},
    {"value": "hold", "label": "保留"},
    {"value": "drop", "label": "捨てる", "tone": "bad"}
  ]
}
```

- `value` は feedback.json に保存される値。エージェントが分岐に使うので、英数字の短い語にすると扱いやすい。文字列だけ（`"保留"`）を書くと value と label が同じになる。
- `tone` は色。`good` `warn` `bad` `neutral`（省略時）のいずれか。
- 画面では選択肢の順に数字キー 1〜9 が割り当てられる。

判定欄を出さない場合（文章への感想だけがほしいときなど）：

```json
"verdict": false
```

または `"verdict": {"enabled": false}`。このとき feedback.json の `verdict` は常に `null` になり、完了時の「未判定」の確認も出ない。

## 6. 前回のレビューの引き継ぎ（previous_feedback）

次の版をレビューしてもらうときは、新しいフォルダに review.json を作り、前回の feedback.json を指定する。

```json
"previous_feedback": "../round-1/feedback.json"
```

起動時の `--previous-feedback <パス>` でも指定でき、こちらが優先される。前回の判定とコメントは、同じ `id` の項目に「前回のレビュー（参考）」として出る。前回の全体コメントは概要に出る。同じフォルダで続けて起動すると、前回の feedback.json が「今回の入力」として復元されてしまうため、版ごとにフォルダを分ける。

## 7. feedback.json の形

サーバーは、判定やコメントが変わるたびに全項目をまとめて保存する（`status: "in_progress"`）。利用者が「レビュー完了」を押すと `status: "complete"` で最後に保存し、サーバーは終了する。保存先は既定で review.json と同じフォルダの `feedback.json`（`--feedback` で変更できる）。日本語はエスケープせずにそのまま書かれる。

```json
{
  "status": "complete",
  "updated_at": "2026-11-08T13:14:23+09:00",
  "title": "ログイン画面の改善案レビュー",
  "manifest": "C:\\work\\review\\round-1\\review.json",
  "verdict_enabled": true,
  "verdict_options": [{"value": "adopt", "label": "採用", "tone": "good"}, ...],
  "overall_comment": "案Aを基本に進めてください。",
  "summary": {
    "total": 5,
    "counts": {"adopt": 1, "revise": 1, "reject": 0},
    "unjudged": 3,
    "commented": 2,
    "untouched": 2,
    "not_viewed": 1
  },
  "reviews": [
    {
      "id": "a-doc",
      "title": "案Aの提案書",
      "group": "A",
      "verdict": "revise",
      "verdict_label": "要修正",
      "comment": "目標値の根拠を追記してください。",
      "viewed": true,
      "previous_verdict": null
    },
    {
      "id": "b-logo",
      "title": "案Bのロゴ",
      "group": "B",
      "verdict": null,
      "verdict_label": null,
      "comment": "",
      "viewed": false,
      "previous_verdict": null
    }
  ]
}
```

| キー | 内容 |
| --- | --- |
| `status` | `in_progress`（途中）か `complete`（利用者が完了を押した） |
| `reviews` | マニフェストの全項目。判定もコメントもない項目も含む |
| `reviews[].verdict` | 選んだ選択肢の value。選ばなかった項目は `null`（＝未判定） |
| `reviews[].viewed` | 利用者がその項目を画面に表示したか。`false` は「見ていない」 |
| `reviews[].previous_verdict` | 前回の判定（引き継いだ場合） |
| `summary.unjudged` | 未判定の件数。判定欄が無いときは `null` |
| `summary.untouched` | 判定もコメントもない項目の件数 |
| `summary.not_viewed` | 一度も表示されなかった項目の件数 |
| `removed_items` | （ある場合のみ）レビュー中にマニフェストから消えた項目に付いていた判定とコメント |

`verdict: null` とコメント空の組み合わせは「問題なし」ではない。`viewed: false` なら利用者はその項目を見ていない。`viewed: true` でも、迷って判定しなかった可能性がある。どちらも未確認として扱う。

## 8. 例：判定欄を変える・消す

見出し案を5つ並べて、残すものを選んでもらう：

```json
{
  "title": "記事の見出し案",
  "instructions": "残したい見出しに「残す」を付けてください。複数でもかまいません。",
  "verdict": {"options": [{"value": "keep", "label": "残す", "tone": "good"}, {"value": "drop", "label": "残さない", "tone": "bad"}]},
  "items": [
    {"id": "h1", "title": "見出し案1", "description": "検索から来た人が内容を想像できるか。", "files": ["headlines/1.md"]},
    {"id": "h2", "title": "見出し案2", "description": "同上。", "files": ["headlines/2.md"]}
  ]
}
```

文章に感想だけをもらう（判定は要らない）：

```json
{
  "title": "設計書の下書きへのコメント",
  "verdict": false,
  "items": [
    {"id": "ch1", "title": "1章 背景", "description": "前提に誤りや抜けがないか。", "files": ["draft/01-background.md"]},
    {"id": "ch2", "title": "2章 方式", "description": "方式の選び方に納得できるか。", "files": ["draft/02-design.md"]}
  ]
}
```
