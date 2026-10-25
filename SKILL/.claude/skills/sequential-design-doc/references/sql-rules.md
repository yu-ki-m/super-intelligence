# SQL・DB 操作の表現規則

目次
1. 原則
2. 実行SQL と参考SQL
3. DB 操作ブロックの構成（必須の表）
4. SELECT
5. UPDATE
6. INSERT
7. DELETE
8. 繰り返しの中の SQL・一括操作
9. 動的 SQL・文字列で組み立てる SQL
10. ORM 操作から SQL を示すとき（発行タイミング）
11. ロック
12. HTML の完全な例

---

## 1. 原則

- **SQL の全文を残す。** 日本語の要約に置き換えない。コード上の SQL の内容を変えない（読みやすくするための改行・字下げの調整は可）。
- SQL の直下（または横）に、その SQL で**取得・更新・登録・削除されるデータを表で**示す。SQL を読めない読者にも、データの変化が分かるようにする。
- SQL を書く行は、**実際に SQL が発行される位置**に置く。ORM の遅延 flush で発行されるなら、属性を変えた行ではなく flush・COMMIT の行に置く（属性を変えた行には「この時点では SQL は発行されない」と書く）。
- 次を必ず示す：実行条件（どの分岐・繰り返しの中か）、バインド変数と値の対応、想定件数、0 件のとき、複数件のとき（該当する場合）、NULL の扱い、取得したデータを後続のどの No. で使うか。

## 2. 実行SQL と参考SQL

| 種類 | 指定 | 対象 | 見出し（build が自動で付ける） |
|---|---|---|---|
| 実行SQL | `data-kind="exec"` | ソース・マッパー XML・アノテーション・SQL ファイルに**文字列として書かれている** SQL | 「実行SQL（ファイル:行 に記載）」 |
| 参考SQL | `data-kind="ref"` | ORM・クエリビルダーの操作から**推定した** SQL | 「参考SQL（…推定した SQL。実行される SQL そのものとしては確認していない）」 |

- 実際に発行される SQL が確認できない場合、推定した SQL を実行SQL として書かない。必ず `data-kind="ref"` にする。
- 参考SQL でも、表（取得列・更新列・登録列）はエンティティ・モデル・DDL から確認できる範囲で書く。確認できない列は〔未確認〕。
- 発行されるかどうか・回数が仕様や状態で変わる（1 次キャッシュ、lazy load、cascade、変更検知）場合は〔推定〕を付け、条件を書く。
- `data-src` には SQL が書かれた位置（実行SQL）または元の操作の位置（参考SQL）を書く。

## 3. DB 操作の行の構成（必須の表）

SQL を発行する処理行の処理内容に、文の後で `<ol class="db">` を置き、SQL と表を**項目（1. 2. …）**として並べる。
項目は処理の文より 1 段下がって表示され、`No.39.3`（No.39 の項目 3）のように参照できる。
1 つの `ol.db` に入れる SQL は 1 文（親子の SELECT のように一緒に発行されるものはまとめてよい）。

標準の項目の並び：

1. SQL（`pre.sql`。`data-kind` と `data-src` を付ける。見出しは build が付けるので書かない。実行条件・ロックなどの注記は `p.note`）
2. バインド変数（`table.bind`）
3. 取得データ（`table.rows`）／更新内容（`table.upd`）／登録データ（`table.ins`）／削除対象（`table.del`）
4. 件数ごとの処理（`table.cnt`）

`ddoc.py check` が、`ol.db` の中にある次の表の有無を検査する（無ければエラー）。

| 文 | 必須の表（class） |
|---|---|
| SELECT | `bind`（バインド変数がある場合）・`rows`（取得データ）・`cnt`（件数ごとの処理） |
| UPDATE | `bind`・`upd`（更新前後）・`cnt`（更新件数ごとの処理） |
| INSERT | `bind`・`ins`（登録データ） |
| DELETE | `bind`・`del`（削除対象）・`cnt` |

表の標準の列：

| 表 | 列 |
|---|---|
| `bind` | バインド変数 ｜ 値の取得元 ｜ 値の例 |
| `rows` | 取得列 ｜ 型 ｜ 値の例 ｜ 格納先 ｜ 後続の利用箇所（No.） |
| `cnt` | 件数・状態 ｜ 処理（行き先） |
| `upd` | 更新列 ｜ 更新前（例） ｜ 更新後（例） ｜ 値の取得元・計算 |
| `ins` | 登録列 ｜ 登録値（例） ｜ 値の取得元 |
| `del` | 削除対象の行の主要な列（例の行を 1〜2 行） |

`cnt` には、件数のほかに NULL・制約違反・ロック待ちなど、その SQL の結果で処理が分かれる状態をすべて書く。行き先は `<td class="go">→ 15</td>` のように書くとリンクになる。
ほかの行からこの SQL の結果を使うときは「`stock.version`（No.39.3）」のように項目の番号で参照する。

## 4. SELECT

- 取得列は**すべて** `rows` に書く。`SELECT *` やエンティティ全体の取得は、エンティティ・DDL から列を列挙する（分からなければ〔未確認〕）。
- 「後続の利用箇所」に、その値を使う No. を書く（`status` → 09 の判定、`version` → 15 の UPDATE 条件）。使わない列は「使用なし」。
- 件数：0 件 ／ 1 件 ／ 複数件 のそれぞれで何が起きるかを `cnt` に書く。コードが件数を確認しない場合はその結果も書く。
  - 例：`scalar_one_or_none()` は 2 件以上で `MultipleResultsFound` を送出 〔推定〕／ `findById` は主キー検索のため 0 件か 1 件 ／ `QueryRow().Scan` は 0 件で `sql.ErrNoRows`。
- NULL：NULL になりうる列について、後続の比較・計算でどうなるかを書く。
- JOIN・サブクエリ：結合条件と、結果が何行になるかを説明する。
- ORDER BY・LIMIT・OFFSET・カーソル：取得順と範囲、次の取得で範囲がどう変わるかを書く。
- COUNT・EXISTS などの集計：結果の値と、その後の判定の対応を書く。

## 5. UPDATE

- `upd` に SET の全列を書く。更新前は事前に取得した値の例、更新後は計算した値の例。式による更新（`available = available - #{quantity}`）は「更新後 = 更新前 − quantity」と計算も書く。
- WHERE 条件（主キー、楽観ロックの `version`、状態条件、テナント条件）の意味を文章で書く。
- `cnt` に、想定した更新件数と、件数が違う場合の処理を書く。コードが更新件数を確認しない場合は「件数を確認しない（0 件でも続行）」と書く。
- DB 側で自動的に変わる列（`ON UPDATE`、トリガー、`@Version` の自動加算）は、確認できた根拠とともに書く。確認できなければ〔未確認〕。

## 6. INSERT

- `ins` に、登録される 1 レコードの**全列**と値を書く。コードで指定しない列（自動採番の ID・DEFAULT・`created_at`）も、定義から分かる範囲で書き、取得元に「DB で採番」「DB の既定値」と書く。
- 採番された値を受け取る方法（RETURNING、`getGeneratedKeys`、flush 後の `entity.id`）と、その値を使う No. を書く。
- 一意制約・外部キー・NOT NULL の違反時に何が起きるか（どの例外になり、どこで処理されるか）を書く。
- 複数行を登録する場合は、行ごとの例を 2 行程度示し、件数を書く。

## 7. DELETE

- 削除対象の条件を文章で書き、`del` に対象レコードの例を示す。
- 削除件数と、0 件のときの処理を `cnt` に書く。
- 外部キーの `ON DELETE CASCADE` などで連動して消える行があれば書く（DDL が無ければ〔未確認〕）。
- 論理削除（実際は UPDATE）は UPDATE として書く。

## 8. 繰り返しの中の SQL・一括操作

- 繰り返しの中の SQL は、繰り返しの内側の行として書き、何回発行されるか（「明細の件数だけ」）を書く。
  `bind`・`rows`・`upd` の値の例は、1 件目と 2 件目のように 2 回分を示すと変化が分かりやすい。
- 一括操作（IN 句、`executemany`、`saveAll`、バルク INSERT）は、発行回数・IN の要素・件数を書く。
- 遅延読み込み（lazy load）で繰り返しの中に SELECT が発生する場合は、回数とともに〔推定〕で書く。

## 9. 動的 SQL・文字列で組み立てる SQL

- MyBatis の `<if>`・`<where>`・`<foreach>`・`<choose>` などは、**マッパー XML の原文**を `pre.sql`（`data-kind="exec"`）に残す（HTML では `&lt;` などにエスケープする）。
  その下に「条件 ｜ 付く句」の表を置き、シナリオの値で組み立てられる SQL を併記する。
- 文字列連結・テンプレートで組み立てる SQL も同様に、組み立て後の全文と、どの条件でどの句が付くかを示す。
- `${}` などの文字列置換は、置換される値の取得元を書く。

## 10. ORM 操作から SQL を示すとき（発行タイミング）

参考SQL を書くときの目安。フレームワークの版・設定で変わるので〔推定〕を付ける。

| ORM | 操作 | 発行される SQL（参考） | 発行のタイミング |
|---|---|---|---|
| JPA / Hibernate | `findById` | 主キーの SELECT（1 次キャッシュにあれば発行しない） | 呼び出し時 |
| 〃 | `findAllById` | `SELECT … WHERE id IN (…)` | 呼び出し時 |
| 〃 | `save`（新規・`IDENTITY`） | INSERT（採番のため即時） | 呼び出し時 |
| 〃 | `save`（新規・`SEQUENCE`） | 採番の SELECT ＋ INSERT | INSERT は flush 時 |
| 〃 | 管理状態のエンティティの属性変更 | UPDATE（変更検知） | flush 時（COMMIT 直前、または問い合わせ前の自動 flush） |
| 〃 | `cascade = ALL` の子の追加 | 子の INSERT | 親の persist / flush 時 |
| Spring Data | `findByEmail` などの派生クエリ | 名前から組み立てた SELECT | 呼び出し時 |
| MyBatis | マッパーのメソッド | XML・アノテーションの SQL（**実行SQL**） | 呼び出し時 |
| JdbcTemplate・JDBC・pg・mysql2・database/sql・psycopg | 文字列の SQL | **実行SQL** | 呼び出し時 |
| SQLAlchemy | `select(...)` を `execute` | 参考SQL | 呼び出し時 |
| 〃 | `session.add` ＋ `flush` | INSERT | flush 時 |
| 〃 | 属性の変更 | UPDATE | flush 時（commit 時、または次の問い合わせ前の autoflush） |
| 〃 | `selectinload` | 親の SELECT の後に子の `SELECT … WHERE … IN (…)` | 親の取得時 |
| 〃 | `with_for_update()` | `… FOR UPDATE` | 呼び出し時 |
| TypeORM | `repo.save(entity)` | 主キーがあれば SELECT ＋ INSERT / UPDATE、無ければ INSERT | 呼び出し時 |
| 〃 | `count` / `findOne` / `insert` / `update` | `SELECT COUNT(*)` / `SELECT … LIMIT 1` / INSERT / UPDATE | 呼び出し時 |
| Django ORM | `objects.get` / `filter` | SELECT（`filter` は評価されたときに発行） | 評価時 |
| Laravel Eloquent / Rails ActiveRecord | `save` / `update` / `where()->get()` | INSERT・UPDATE / SELECT | 呼び出し時 |

- 1 つの操作で複数の SQL が発行される場合（`save` の SELECT ＋ INSERT、`selectinload` の 2 つの SELECT）は、すべて書く。
- flush の順序（複数の UPDATE / INSERT の順）は ORM が決める。順序がコードから確定できなければ〔推定〕と書く。

## 11. ロック

- `SELECT … FOR UPDATE`：ロックする行（WHERE の条件）、保持期間（COMMIT / ROLLBACK まで）、他のトランザクションが同じ行をロックしている場合の動作（待つ・タイムアウト・NOWAIT・SKIP LOCKED）。タイムアウト値がコードに無ければ〔未確認〕。
- 楽観ロック（`version` 条件付きの UPDATE）：取得時の `version` と、更新件数 0 件のときの処理。
- ロック中に行う外部通信など、ロックの保持時間が長くなる処理があれば書く。

## 12. HTML の完全な例

### SELECT（実行SQL、行ロック、繰り返しの中）

```html
<tr><td>39</td><td class="i1"><span class="k">SQL</span><code>stocks</code> から <code>line.productId</code> の行を行ロック付きで取得し、<code>stock</code> に格納する。
<ol class="db">
<li><pre class="sql" data-kind="exec" data-src="StockMapper.xml:5-10">SELECT product_id, available, version
  FROM stocks
 WHERE product_id = #{productId}
   FOR UPDATE</pre>
<p class="note">ロックは注文登録のトランザクションが終わる（COMMIT / ROLLBACK）まで保持される。他の注文が同じ商品をロック中なら待つ（待ち時間の上限は DB 設定による<span class="uv">〔未確認: U2〕</span>）。</p></li>
<li><b>バインド変数</b>
<table class="sub bind"><thead><tr><th>バインド変数</th><th>値の取得元</th><th>値の例（1 件目／2 件目）</th></tr></thead>
<tbody><tr><td><code>#{productId}</code></td><td>明細の <code>productId</code>（No.38）</td><td>P-001 ／ P-002</td></tr></tbody></table></li>
<li><b>取得データ</b>（1 行）
<table class="sub rows"><thead><tr><th>取得列</th><th>型</th><th>値の例</th><th>格納先</th><th>後続の利用箇所</th></tr></thead>
<tbody><tr><td>product_id</td><td>String</td><td>P-001</td><td><code>stock.productId</code></td><td>使用なし</td></tr>
<tr><td>available</td><td>int</td><td>10</td><td><code>stock.available</code></td><td>No.42 の判定、No.44.3 の更新前</td></tr>
<tr><td>version</td><td>long</td><td>7</td><td><code>stock.version</code></td><td>No.44.2 のバインド変数</td></tr></tbody></table></li>
<li><b>件数ごとの処理</b>
<table class="sub cnt"><thead><tr><th>件数</th><th>処理</th></tr></thead>
<tbody><tr><td>1 件</td><td class="go">取得した行を <code>stock</code> に格納 → 40</td></tr>
<tr><td>0 件</td><td class="go"><code>stock</code> は null → 40 で判定し 41 で例外</td></tr>
<tr><td>2 件以上</td><td>発生しない（<code>product_id</code> は主キー〔推定〕）</td></tr></tbody></table></li>
</ol></td><td>StockMapper.xml:5-10<br>InventoryService.java:25</td></tr>
```

### UPDATE（楽観ロック）の項目

```html
<li><b>更新内容</b>（1 行）
<table class="sub upd"><thead><tr><th>更新列</th><th>更新前（例）</th><th>更新後（例）</th><th>値の取得元・計算</th></tr></thead>
<tbody><tr><td>available</td><td>10</td><td>8</td><td>更新前 − <code>quantity</code>（2）</td></tr>
<tr><td>version</td><td>7</td><td>8</td><td>更新前 ＋ 1</td></tr>
<tr><td>updated_at</td><td>2026-10-24 18:00:00</td><td>2026-10-25 10:15:30</td><td>DB の <code>CURRENT_TIMESTAMP</code></td></tr></tbody></table></li>
<li><b>更新件数ごとの処理</b>
<table class="sub cnt"><thead><tr><th>更新件数</th><th>処理</th></tr></thead>
<tbody><tr><td>1 件</td><td class="go">→ 45</td></tr>
<tr><td>0 件（<code>version</code> 不一致）</td><td class="go"><code>ConcurrentUpdateException</code> → E8</td></tr></tbody></table></li>
```

### INSERT の項目

```html
<li><b>登録データ</b>（1 行）
<table class="sub ins"><thead><tr><th>登録列</th><th>登録値（例）</th><th>値の取得元</th></tr></thead>
<tbody><tr><td>id</td><td>90001</td><td>DB で採番（IDENTITY）</td></tr>
<tr><td>product_id</td><td>P-001</td><td>明細の <code>productId</code></td></tr>
<tr><td>delta</td><td>-2</td><td><code>-quantity</code></td></tr>
<tr><td>reason</td><td>ALLOCATE</td><td>定数</td></tr>
<tr><td>created_at</td><td>2026-10-25 10:15:30</td><td>DB の <code>CURRENT_TIMESTAMP</code></td></tr></tbody></table></li>
```

### DELETE の項目

```html
<li><b>削除対象</b>：<code>id</code> がパスの <code>taskId</code> と一致し、かつ <code>tenant_id</code> が認証済みクライアントのテナントと一致する行。
<table class="sub del"><thead><tr><th>id</th><th>tenant_id</th><th>title</th><th>status</th></tr></thead>
<tbody><tr><td>42</td><td>3</td><td>見積書を送る</td><td>DOING</td></tr></tbody></table></li>
<li><b>削除件数ごとの処理</b>
<table class="sub cnt"><thead><tr><th>削除件数</th><th>処理</th></tr></thead>
<tbody><tr><td>1 件</td><td class="go">→ 09（204 応答）</td></tr><tr><td>0 件</td><td class="go">→ 08（404 応答）</td></tr></tbody></table></li>
```
