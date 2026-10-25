# HTML の構成と書式

目次
1. 作り方（部品ファイルと build）
2. 文書の構成（節と data-sec）
3. 概要・入力項目
4. 逐次処理表（3 列・行の種類・木の形）
5. 処理の中の項目（1. 2. …）と SQL・外部 API・判定表
6. 例外経路（E）・非同期経路（A）
7. レスポンス・データ変更のまとめ
8. 未確認事項・検証記録
9. スタイルの決まり
10. 複数の処理を 1 つの文書にする（タブとグループ）

---

## 1. 作り方（部品ファイルと build）

本文（`<main>` の中身）だけを**部品ファイル**に分けて書き、`ddoc.py build` で 1 つの HTML にする。
CSS・見出し・凡例はテンプレート（`assets/template.html`）から入るので、部品に `<html>`・`<head>`・`<style>` を書かない。

```bash
python "${CLAUDE_SKILL_DIR}/scripts/ddoc.py" init <作業ディレクトリ> [--procs N]   # 部品の雛形
python "${CLAUDE_SKILL_DIR}/scripts/ddoc.py" build <作業ディレクトリ> -o <出力.html> \
    --title "詳細設計書：注文登録（POST /api/orders）" --meta "作成日 2026-10-25" --meta "対象 order-system/src/main" \
    --src-root <ソースのルート>
```

- 部品はファイル名の昇順に連結される（`init` が作る名前：`01-p1-1-overview.html`、`01-p1-2-steps.html`、`01-p1-3-paths.html`、`01-p1-5-response.html`、`90-unconfirmed.html`、`95-verification.html`）。
  逐次処理が長い場合は `01-p1-2-steps.html` と `01-p1-2b-steps.html` のように分けてよい（表の途中で分けるなら、前の部品で `</tbody></table>` を閉じず、次の部品で閉じる）。
- build が自動で行うこと：
  - 処理行に `id`（`p1-s07`）と列の class（`no`・`c`・`src`）、字下げした行に `n`、ブロックを閉じる行（繰返終端・待機・try終端）に `close` を付ける。
  - 処理の中の項目（`<ol>` の `<li>`）に `id`（`p1-s29-3`）を付ける。
  - 処理内容の欄と `.go` の中の「→ 07」「→ E1」「07へ進む」、文書の中の「No.07」「No.29.3」（「No29.3」も可）をリンクにする（直前が数字・英字の「10 → 15」は値の変化とみなしリンクにしない）。
  - `pre.sql` の前に「実行SQL」「参考SQL」の見出しを、`pre.json` の前に `data-title` の見出しを付ける。
  - 処理が 2 つ以上なら、処理ごとのタブ（`data-group` のグループ付き）を作り、処理の外の「p2 No.05」をリンクにする（10 章）。
  - 構造の検査（`check` と同じ）。エラーが 0 件になるまで直す。

## 2. 文書の構成（節と data-sec）

```html
<section class="proc" id="p1" data-group="返金" data-tab="返金申請 POST /orders/{order_id}/refunds">
                                               <!-- 処理ごとに 1 つ。id は省略すると p1, p2…。data-group・data-tab は 10 章 -->
<h2>1. 返金申請（POST /orders/{order_id}/refunds）</h2>
  <section data-sec="overview">…処理概要…</section>       <!-- 必須 -->
  <section data-sec="input">…入力項目…</section>
  <section data-sec="vars">…主要な変数（任意）…</section>
  <section data-sec="steps">…逐次処理…</section>          <!-- 必須 -->
  <section data-sec="exceptions">…例外経路 E…</section>
  <section data-sec="async">…非同期経路 A…</section>
  <section data-sec="response">…レスポンス／処理結果…</section>  <!-- 必須 -->
  <section data-sec="data">…データ変更とトランザクション…</section>
</section>
<section data-sec="unconfirmed">…未確認事項…</section>    <!-- 必須（無ければ「なし」） -->
<section data-sec="verification">…検証記録…</section>     <!-- 必須 -->
```

見出しは `h2`（処理・文書全体の節）、`h3`（処理の中の節）、`h4`（経路など）。番号は「1.3 逐次処理」のように付ける。

## 3. 概要・入力項目

**処理概要**（`table.kv`）は必要最小限の項目に絞る：対象処理、種別、HTTP メソッド、エンドポイント（バッチは起動方法・ジョブ名）、入力、出力、認証、トランザクション、使用テーブル（読み・書き）、外部システム、非同期処理、起点（根拠）。該当しない行は消す。

**入力項目**（`table.sub`）：項目 ｜ 受け取り位置（パス・クエリ・ヘッダー・ボディ・引数・環境変数） ｜ 型 ｜ 必須 ｜ 検証内容（コード上の条件をそのまま） ｜ 値の例。
検証がフレームワークの注釈で行われる場合、どの時点で検証され、違反時に何が返るかは逐次処理の行に書く。

**JSON の例**：リクエストボディが JSON なら、入力項目の表の**前**に、送られてくる JSON の形を `pre.json` で示す（表だけでは入れ子・配列・null の形が分からないため）。

```html
<pre class="json" data-title="リクエストボディの例（Content-Type: application/json）">{
  "customerId": 1001,
  "lines": [
    { "productId": "P-001", "quantity": 2 }
  ],
  "note": null
}</pre>
```

- 値は逐次処理のシナリオと同じ値にする（架空の値）。2 文字の字下げで整形し、**JSON として正しく**書く（コメント・`…`・末尾のカンマを入れない。補足は表に書く）。
- 入れ子の項目は、表で `lines[].productId` のように経路で書く。JSON の例に出した項目はすべて表で説明する（`check` が照合する）。
- 任意項目は、省略した形で困らない限り含めて書き、表の「必須」で省略できることを示す。
- `data-title` は build が見出しにする。ボディが JSON でない（フォーム・multipart）場合は、表の前に「ボディは JSON ではない（multipart/form-data）」と書く。

**主要な変数**（任意、`data-sec="vars"`）：変数 ｜ 型 ｜ 設定・変更する No. ｜ 内容 ｜ 値の例。

## 4. 逐次処理表（3 列・行の種類・木の形）

列は **No. ｜ 処理内容 ｜ 根拠** の 3 つ。条件・結果の列は作らない（結果・行き先は処理内容に書く）。

```html
<table class="steps"><thead><tr><th>No.</th><th>処理内容</th><th>根拠</th></tr></thead><tbody>
<!-- 処理行 -->
<tr><td>28</td><td><span class="k">分岐</span><code>user.roles</code> に <code>"TICKET_ADMIN"</code> が含まれないか判定する（<code>!user.isAdmin()</code>）。</td><td>TicketService.java:41</td></tr>
<!-- 「〜のとき」行：No. なし・3 セル。分岐の 1 段下 -->
<tr class="arm"><td></td><td class="i1"><code>TICKET_ADMIN</code> が含まれないとき（管理者でないとき）<span class="of">（No.28 が成立）</span></td><td></td></tr>
<!-- その結果の処理：さらに 1 段下 -->
<tr><td>29</td><td class="i2"><span class="k">SQL</span>… <code>count</code> に格納する（例 1）。DB の例外 → E6 <ol class="db">…項目…</ol></td><td>ProjectMemberRepository.java:17-25</td></tr>
<tr><td>30</td><td class="i2"><span class="k">分岐</span><code>count</code>（No.29.3）が null または 0 以下か判定する。</td><td>ProjectMemberRepository.java:26</td></tr>
<tr class="arm"><td></td><td class="i3"><code>count</code> が null または 0 以下のとき<span class="of">（No.30 が成立）</span></td><td></td></tr>
<tr><td>31</td><td class="i4"><span class="k x">例外</span><code>ForbiddenException</code>（403）を送出する。→ E5</td><td>TicketService.java:42</td></tr>
<tr class="arm"><td></td><td class="i3"><code>count</code> が 1 以上のとき<span class="of">（No.30 が不成立）</span> → 32</td><td></td></tr>
<tr class="arm"><td></td><td class="i1"><code>TICKET_ADMIN</code> が含まれるとき<span class="of">（No.28 が不成立）</span> → 32</td><td></td></tr>
<tr><td>32</td><td><code>ticket.status</code> を <code>previousStatus</code> に格納する（例 OPEN）。</td><td>TicketService.java:45</td></tr>
</tbody></table>
```

**行の種類**

| 行 | 書き方 | 表示 |
|---|---|---|
| 処理行 | `<tr><td>No.</td><td class="iN">処理内容</td><td>根拠</td></tr>` | 番号付きの行。字下げが深い行は上位の縦線の上に並ぶ |
| 「〜のとき」行 | `<tr class="arm"><td></td><td class="iN">…</td><td></td></tr>` | 番号なし。上位の縦線から横の枝（├─）が出る。分岐の結果・catch・except・finally・並列の各処理に使う |
| ブロックの終わりの行 | 処理行に `<span class="k">繰返終端</span>`・`待機`・`try終端` を付ける（build が `tr.close` を付ける）。コールバック型の TX の COMMIT など、ほかの行で閉じたいときは `<tr class="close">` | 縦線がここで止まり、枝が出る（└─） |

**字下げの決まり**（`writing-rules.md` 5.2）

- `class="i1"`〜`"i8"` を処理内容のセルに付ける（字下げなしは付けない）。
- 見出しの行（分岐・繰返・try・並列・コールバック型の TX）の内側は 1 段深く。
- 分岐の 1 段下には「〜のとき」行だけを置き、結果の処理はそのさらに 1 段下。
- try の 1 段下には try の本体の処理行と、catch・finally の「〜のとき」行（キーワードは `<span class="kw">catch (X e)</span>`）。catch・finally の処理はさらに 1 段下。
- ブロックの終わりの行は、見出しの 1 段下の最後。

**各セル**

- **No.**：実行順に `01, 02, …`（100 行を超える処理は `001` から 3 桁）。表の上から下へ昇順。飛ばし・重複をしない。「〜のとき」行は空。
- **処理内容**：`writing-rules.md` に従う。種別タグ `<span class="k">…</span>`、例外・終了は `<span class="k x">…</span>`。行き先は文の最後に「→ NN」。終了は `<span class="end">終了</span>`。
- **根拠**：`ファイル:行` または `ファイル:開始-終了`。複数は `<br>` で区切る。「〜のとき」行は空でよい。

## 5. 処理の中の項目（1. 2. …）と SQL・外部 API・判定表

処理の文の後に `<ol>` を 1 つ置き、項目を `<li>` で並べる。項目は 1 段下がって番号付きで表示され、`No.29.3` で参照できる。
1 つの処理行に置く `<ol>` は 1 つ（2 つ目以降は参照できない）。項目の見出しは `<b>…</b>`。

**SQL**：`<ol class="db">`。項目 1 に `pre.sql`（build が「実行SQL（…に記載）」「参考SQL（…推定…）」の見出しを付けるので、見出しは書かない）、項目 2 以降に表（`sql-rules.md` 3 章）。

```html
<ol class="db">
<li><pre class="sql" data-kind="exec" data-src="StockMapper.xml:5-10">SELECT product_id, available, version
  FROM stocks
 WHERE product_id = #{productId}
   FOR UPDATE</pre>
<p class="note">ロックは注文登録のトランザクションが終わるまで保持される（待ち時間の上限は DB 設定による<span class="uv">〔未確認: U2〕</span>）。</p></li>
<li><b>バインド変数</b><table class="sub bind">…</table></li>
<li><b>取得データ</b>（1 行）<table class="sub rows">…</table></li>
<li><b>件数ごとの処理</b><table class="sub cnt">…</table></li>
</ol>
```

**外部 API・メッセージ送信**：`<ol class="api">`。

```html
<ol class="api">
<li><b>送信</b>：POST <code>{settings.payment_base_url}/payments/{payment_id}/refunds</code>（タイムアウト 10 秒、再試行なし）</li>
<li><b>送信データ</b>（JSON）<table class="sub req"><tr><th>項目</th><th>型</th><th>値の例</th><th>値の取得元</th></tr>…</table></li>
<li><b>受信データ</b>（2xx のとき）<table class="sub res">…</table></li>
<li><b>応答ごとの処理</b><table class="sub cnt"><tr><th>応答</th><th>処理</th></tr>
<tr><td>2xx</td><td class="go">→ 20</td></tr><tr><td>400 以上</td><td class="go"><code>PaymentGatewayError</code> を送出 → except（No.17）</td></tr></table></li>
</ol>
```

- `req`（送信データ）・`cnt`（応答ごとの処理）は必須（送信データが無い場合は「なし」と書いた表）。受信データを使う場合は `res`。
- 送受信のボディが JSON なら、その項目の表の前に `pre.json`（`data-title="送信するボディ（JSON）"` など）を置く。受信は、コードが読む項目を含む形で書き、読まない項目は「（ほかの項目は使わない）」と表の後に書く。
- ベース URL が設定値なら、キー名を書く。

**判定表・状態遷移表**：判定の行の `<ol>` の項目に `<table class="sub dec">`。直前に原文の条件式と評価順を書く。

**対応表（詰め替え・変換）**：変換の行の項目に `<table class="sub map">`（変換元 ｜ 変換先 ｜ 値の例）。

**原文の引用**（メール本文・メッセージ・ファイル形式）：項目に `<pre class="txt">`。

項目の中の表で行き先を書くセルは `<td class="go">→ 15</td>` にするとリンクになる。

## 6. 例外経路（E）・非同期経路（A）

```html
<section data-sec="exceptions">
<h3>1.4 例外発生時の処理</h3>
<section data-path="E1">
<h4>E1：No.08 で <code>OrderNotFound</code> が送出された場合</h4>
<table class="steps"><thead><tr><th>No.</th><th>処理内容</th><th>根拠</th></tr></thead><tbody>
<tr><td>E1-01</td><td><span class="k">TX</span><code>async with session.begin()</code> を例外で抜けるため ROLLBACK する。取り消されるデータ：なし。</td><td>refund_service.py:33</td></tr>
<tr><td>E1-02</td><td><span class="k">応答</span>例外ハンドラー <code>_not_found</code> が、ステータス 404、ボディ <code>{"code": "ORDER_NOT_FOUND"}</code> で応答する。404 応答で<span class="end">終了</span></td><td>errors.py:22-24</td></tr>
</tbody></table>
</section>
</section>
```

- 経路の No. は `E1-01`、`E1-02`…。経路の中の分岐・try も、逐次処理と同じ木の形で書く。
- 非同期経路は `data-sec="async"` の中に `<section data-path="A1">`、No. は `A1-01`…。見出しに起動条件（どの No. から、いつ、どこで）を書く。
- どこからも参照されない経路は check が警告する。送出する行に必ず「→ E1」を書く。

## 7. レスポンス・データ変更のまとめ

**レスポンス**（`data-sec="response"`）：

- 正常時：`<table class="sub resp">`（項目 ｜ 型 ｜ 設定する値（例） ｜ 値の取得元）。ステータス・ヘッダーも書く。
  表の前に、返す JSON の形を `pre.json` で示す（キーの順はシリアライズされる順：オブジェクトリテラル・フィールド宣言の順。確定できなければ〔推定〕）。ボディが無い応答（204 など）は「ボディなし」と書く。
- 異常時：`<table class="sub errs">`（発生条件（No.） ｜ ステータス ｜ 応答ボディ ｜ その時点のデータの状態）。「データの状態」には確定済み・取り消し済み・外部に送信済みのものを書く。
  表の前に、ボディの**形ごと**に JSON の例を 1 つずつ置き、横に並べる（全件ではなく、項目の構成が違うものごと。値の違いは表で示す）。

```html
<div class="jsons">
<div><pre class="json" data-title="異常時のボディ：入力検証の違反（400、errors.ts:37）">{
  "code": "VALIDATION_ERROR",
  "field": "title",
  "message": "title は必須です"
}</pre></div>
<div><pre class="json" data-title="異常時のボディ：それ以外（errors.ts:41・54）">{
  "code": "NOT_FOUND",
  "message": "task 42 not found"
}</pre></div>
</div>
```

- フレームワーク既定のエラー応答（Spring の `/error`、FastAPI の 422 の `detail` 配列など）も、形が決まっているなら例を置き、版によって違う部分は〔推定〕を付ける。
- バッチは「処理結果」として、終了コード・出力（ファイル・通知・ログ）を同じ形式で書く。

**データ変更とトランザクション**（`data-sec="data"`）：トランザクション ｜ 範囲（No.） ｜ 含まれる操作（No.） ｜ 正常終了時 ｜ 例外発生時。必要なら CRUD 表も置く。
まとめの表は逐次処理・例外経路の行から作り、書いた後で `check --refs` の一覧と見比べて食い違いが無いか確かめる（`verification.md`）。

## 8. 未確認事項・検証記録

```html
<section data-sec="unconfirmed">
<h2>未確認事項</h2>
<table class="sub uvlist"><thead><tr><th>ID</th><th>内容</th><th>影響する処理（No.）</th><th>確認方法</th></tr></thead><tbody>
<tr><td>U1</td><td><code>app.api.deps</code> が提供されていないため、認証処理を確認できない</td><td>p1 No.02</td><td><code>app/api/deps.py</code> を確認する</td></tr>
</tbody></table>
</section>

<section data-sec="verification">
<h2>検証記録</h2>
<p class="vstatus" data-status="open">検証状態：未完了（未確認事項 1 件）</p>
<table class="sub verify"><thead><tr><th>検証観点</th><th>結果</th><th>確認した内容</th></tr></thead><tbody>
<tr><td>処理網羅性</td><td>OK</td><td>…</td></tr>
…（11 観点すべて）…
</tbody></table>
</section>
```

- 本文の〔未確認〕はすべて未確認事項の表に載せる。無い場合は `<tr><td colspan="4">なし</td></tr>`。
- 検証状態：未確認事項が 1 件でもあれば `data-status="open"`（未完了）。すべて確認できたときだけ `done`。
- **NG を残したまま出力しない**（直してから OK にする）。

## 9. スタイルの決まり

- CSS はテンプレートのものを使い、部品に `<style>` や `style=""` を書かない。独自の装飾（カード・影・色付きの背景・アイコン・絵文字）を足さない。
- 横の罫線・縦線・枝は CSS が描く。罫線を消したり、記号（├ └ │）を文字で書いたりしない。
- JavaScript は使わない。外部のフォント・CSS・画像・スクリプトを読み込まない。
- 印刷：A4 横向き（テンプレートで設定済み）。

## 10. 複数の処理を 1 つの文書にする（タブとグループ）

処理（`section.proc`）が 2 つ以上あると、build が**処理ごとのタブ**を作る。読み手はブラウザのタブのように処理を切り替え、1 画面に 1 つの処理だけを見る。

```
 文書                    タスクの参照          タスクの変更
 ──────────────────     ─────────────────    ──────────────────────────────────────────────────────
[一覧][未確認事項・検証記録] [取得 GET /api/tasks/:id] [登録 POST /api/tasks][更新 PUT /api/tasks/:id][削除 DELETE …]
```

- **タブのグループ（関心事）**：`section.proc` の `data-group` に、処理を関心事でまとめた名前を書く。同じ名前の処理は同じグループのタブとして並び、グループ名がタブの上に出る。
  グループは読み手が探す単位で決める：対象のリソース・業務（「注文」「返金」「会員」）、参照と変更（「タスクの参照」「タスクの変更」）、利用者の種類（「利用者向け」「管理者向け」）、バッチの段階（「取込」「集計」「連携」）など。1 つのグループに 1〜6 程度。すべてが同じグループになるなら、もう一段細かい観点で分ける。
- **タブの名前**：`data-tab` に「処理名＋メソッド・パス」（例 `登録 POST /api/tasks`）、バッチはジョブ名。h2 の見出しは従来どおり「2. タスクの登録（POST /api/tasks）」と書く。
- グループの順は、最初に出てきた処理の順。部品のファイル名の順（＝処理の順）をグループごとにまとまるように並べる。
- 自動で作られるタブ：「一覧」（最初の処理より前の部品＝`00-toc.html` の中身。開いたときに表示される）、「未確認事項・検証記録」（最後の処理より後の部品）。
- `00-toc.html` には、文書全体の一覧表（グループ ｜ No. ｜ 処理（`<a href="#p2">` のリンク） ｜ メソッド・パス ｜ 使用テーブル ｜ 起点）と、処理に共通する前提（ミドルウェアの順・DB の扱い・テーブル定義など）を置く。`init --procs N`（N≥2）が雛形を作る。
- 処理番号・経路番号は処理ごとに 01・E1 から振り直す（リンクは処理の中で解決される）。同じ種類の例外経路は、処理をまたいでなるべく同じ番号にそろえる（E2 は入力検証、E3 は 404 など）。
- 処理の間で共通する手順（認証・入力検証など）も、処理ごとに展開して書く（`writing-rules.md` 4 章）。
- 未確認事項と検証記録は文書全体で 1 つずつ。処理の外から処理の行を指すときは `p2 No.05`・`p2 No.29.3`・`p2 No.E3` と処理 id を付ける。build がリンクにし、押すとその処理のタブに切り替わって行が強調される。参照先が無いと check がエラーにする。
- タブは JavaScript を使わない（URL の `#p2` で切り替わるので、ブラウザの戻る・リンクの共有もそのまま使える）。印刷するとすべての処理が処理ごとに改ページして出る。縦に並べたい場合は build に `--no-tabs`。
- `render` は計測ではすべてのパネルを表示する。スクリーンショットで 1 つのタブを確かめるときは `--tab p2`。
