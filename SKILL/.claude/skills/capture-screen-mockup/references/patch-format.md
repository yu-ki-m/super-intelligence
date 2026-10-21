# 画面変更JSON

ルート: `version:1`, `operations:[]`, 任意の`css`と`annotations:[]`。

| type | 内容 | value |
|---|---|---|
| text | 対象の子要素を含めて文言を置換 | 文字列 |
| html | 対象の内側のHTMLを置換 | HTML文字列 |
| insert | 対象の前後・内側に挿入 | HTML文字列 |
| remove | 対象を削除 | 不要 |
| style | 対象のinline styleを更新 | CSSプロパティ名と値のobject |

各操作は`selector`必須。`expectedCount`既定値1。0件や想定数と不一致なら停止し、勝手に先頭だけ選ばない。操作は配列順。insertには`position`を指定（beforebegin / afterbegin / beforeend / afterend）。styleは`background-color`等のCSS記法を使用する。

例:

```json
{
  "version": 1,
  "operations": [
    {"type":"insert","selector":"#toolbar","position":"beforeend","value":"<button id='export'>CSV出力</button>"},
    {"type":"style","selector":"#export","value":{"margin-left":"12px","background":"#0f766e","color":"white"}}
  ],
  "annotations":[{"selector":"#export","text":"検索結果を出力するボタンを追加。"}]
}
```

annotationsは変更後DOMの一意・可視要素へ指定する。枠と番号を重ね、説明一覧をページ末尾に追加する。削除要素には注釈を付けられないため、残る親や関連要素を指す。矢印・フリーハンド編集UIは初版の範囲外。

HTML/CSS文字列をJSON.stringifyなどで正しくエスケープする。scriptやイベントハンドラを追加しても出力段階で除去される。画像・フォントはdata URLなどで内包する。http URLによる新しい素材はオフライン表示では読み込まれない。

実行が途中で失敗した場合、その出力ディレクトリは未完成扱い。修正後は新しい出力名で再実行する。原本は変わらない。
