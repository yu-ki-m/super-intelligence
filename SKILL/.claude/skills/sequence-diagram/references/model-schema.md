# 処理モデル（JSON）仕様 — schemaVersion 1

解析結果（Phase 2 の成果物）を表す JSON の仕様。HTML・Mermaid はすべてこのモデルから
`scripts/lib/core.cjs` が機械的に生成する。**図の見た目を変えたいときもモデルの意味を変えない**こと。
表記の判断（何をどの要素で表すか）は `notation.md` を参照。

## 目次

1. [全体構造](#1-全体構造)
2. [meta](#2-meta)
3. [layers](#3-layers)
4. [lifelines](#4-lifelines)
5. [diagrams](#5-diagrams)
6. [steps（共通項目）](#6-steps共通項目)
7. [ステップ種別ごとの項目](#7-ステップ種別ごとの項目)
8. [evidence（根拠）](#8-evidence根拠)
9. [生成規則（どう描かれるか）](#9-生成規則どう描かれるか)
10. [最小例](#10-最小例)

---

## 1. 全体構造

```json
{
  "schemaVersion": 1,
  "meta": { ... },
  "layers": [ ... ],        // 省略可（既定レイヤーを上書き・追加するときだけ）
  "lifelines": [ ... ],
  "diagrams": [ ... ]       // 1 つ以上。最初の「親を持たない図」が全体図として開く
}
```

- ID（ライフライン・図・ステップ）は英数字と `_` `-` `.` を推奨。図の中では使われない（Mermaid 上の ID は自動採番）。
- ステップ ID は省略すると `図ID.s連番` が付く。**ref・await・検索のリンク先になるステップには明示的に付ける**。
- 不明な項目は無視されずに詳細パネルにも出ないので、規定の項目名を使う。

## 2. meta

| 項目 | 型 | 説明 |
|---|---|---|
| `title` | string | 文書タイトル（HTML のタイトル） |
| `system` | string | 対象システム名 |
| `entryPoint` | string | 起点（例 `POST /api/orders → OrderController.createOrder`） |
| `description` | string | 何を、どこからどこまで追跡したか |
| `sourceRoot` | string | 根拠ファイルのパスの基準ディレクトリ。**モデルファイルからの相対**または絶対パス |
| `language` / `frameworks` | string / string[] | 言語・フレームワーク |
| `inputs` | (string \| {kind, path, note})[] | 入力資料（ソース・設計書・会話など） |
| `analyzedAt` / `analyzer` | string | 解析日・作成者 |
| `defaultEvidenceStatus` | `"unverified"`（既定） \| `"inferred"` \| `"confirmed"` | 根拠 refs が無いステップの既定状態 |
| `defaultEvidence` | {status, refs} | 設計書だけが入力のときなど、全体に共通の根拠（例：仕様書のファイル名）を与える |
| `assumptions` | string[] | 前提・仮定 |
| `unresolved` | string[] | 未確認事項・要確認事項（利用者に確認すべきこと） |
| `omissions` | string[] | **集約・省略した処理とその理由**（例：DTO 変換は自己メッセージに集約） |
| `excluded` | ({target, reason} \| string)[] | 解析対象外としたもの |

`unresolved` / `omissions` / `excluded` は「恣意的に省略していない」ことを利用者に示す欄。空にせず正直に書く。

## 3. layers

ライフラインの色分け・横方向の並び（左→右）・枠（box）を決める。kind（種別）で判定し、決まらなければ class で判定する。既定値（この順に左から並ぶ）：

| id | 表示名 | 主な対象（kind / type から自動推定） |
|---|---|---|
| `client` | クライアント | type=actor、User、Browser、画面 |
| `batch` | バッチ/スケジューラ | type=batch |
| `framework` | フレームワーク | type=framework、Filter、Interceptor、Dispatcher、AOP |
| `handler` | 例外ハンドラ | ExceptionHandler、ControllerAdvice、ExceptionFilter |
| `controller` | Controller層 | Controller、Handler、Resource、Router、Resolver |
| `service` | Service層 | Service、UseCase、Facade、Listener、Consumer、Job |
| `process` | 処理 | 処理、手順、工程、機能、Process、Step（設計書・仕様書の処理単位。クラスが無い場合） |
| `domain` | ドメイン/共通部品 | Entity、Domain、Validator、Factory、Helper、Util |
| `repository` | Repository層 | Repository、DAO、Mapper |
| `db` | データベース | type=db |
| `cache` | キャッシュ | type=cache、Redis |
| `integration` | 外部連携 | Client、Adapter、Gateway（自システム内の外部APIクライアント） |
| `external` | 外部システム | type=external |
| `messaging` | メッセージング | type=queue、Kafka、RabbitMQ、SQS |
| `other` | その他 | 上記以外 |

追加・変更する場合：

```json
"layers": [
  { "id": "springEvent", "label": "イベント配信（Spring）", "color": "#c026d3", "before": "repository" },
  { "id": "service", "label": "アプリケーション層" }
]
```

`before` を付けるとその直前に挿入する。既存 id を書くと上書きになり、既存 id に `before` を書くとそのレイヤーを移動する（例：`{ "id": "process", "before": "db" }`）。

## 4. lifelines

ライフラインは**メソッド単位**（DB はテーブル単位）。同じメソッドは図の中で 1 本に再利用される。

| 項目 | 必須 | 説明 |
|---|---|---|
| `id` | ✔ | 一意の ID |
| `type` | | `method`（既定）/ `actor` / `db` / `external` / `queue` / `framework` / `batch` / `cache` / `file` / `other` |
| `kind` | | 表示上の種別（`Controller`、`Service` など）。表示形式は `種別：クラス名.メソッド名` |
| `class` / `method` | method 型は method 必須 | クラス名（関数ならモジュール名）とメソッド名。framework / external 型では method を省略してよい |
| `signature` | | オーバーロードの区別用（例 `save(Order)`）。同一 kind・class・method が複数あると自動で表示 |
| `showSignature` | | true/false でシグネチャ表示を強制 |
| `name` | db・queue・actor は必須 | テーブル名・キュー/トピック名・アクター名 |
| `layer` | | レイヤー ID（省略時は type・kind・class から推定） |
| `label` | | 表示名を完全に上書き（通常は使わない） |
| `description` | | 役割の説明 |
| `annotations` | | `@Transactional` などの宣言 |
| `implementation` / `via` | | インターフェースの実装解決・DI の説明 |
| `traced` | | `false` なら「内部は未解析（ブラックボックス）」と表示 |
| `primaryKey` / `columns` | | DB テーブルの情報 |
| `evidence` | | 定義位置（[8 章](#8-evidence根拠)）。`status` を明示した場合だけ図のライフライン名に〔推定〕〔未確認〕を付ける |

表示名の例：`Controller：OrderController.createOrder`、`DB：orders`、`External API：PaymentGatewayAPI.authorize`、`Kafka：order-events`。
長い名前は「種別：」「クラス名.」「メソッド名」の位置で自動的に改行される（文字列は変えない）。

**DB ライフラインは自動生成できる**：`db` ステップに `"table": "orders"` と書けば、同名の type=db ライフラインが無い場合に `DB：orders` が作られる。

## 5. diagrams

| 項目 | 必須 | 説明 |
|---|---|---|
| `id` | ✔ | 図 ID（URL の `#d=` にも使う） |
| `title` | ✔ | 図の名前（「全体処理」「在庫引当処理」など） |
| `description` | | 図の範囲の説明 |
| `entry` | | 起点ライフライン（最初の呼び出し元）。省略時は最初の call/db の `from` |
| `participants` | | ライフラインの並びを明示する場合の ID 配列（未記載のものは後ろに初出順で追加） |
| `steps` | ✔ | ステップの配列 |

**全体図と詳細図**：`call` ステップに `"ref": "詳細図ID"` を付けると、その呼び出しの内部が「詳細参照」ノートになり、
クリックで詳細図に移動できる。詳細図は、同じ呼び出し（`from`→`to` が同じ call）を最上位に置き、その `steps` に内部処理を書く。
ビューアの「この図の中で展開」も、この対応を使う。

## 6. steps（共通項目）

すべてのステップに使える項目：

| 項目 | 説明 |
|---|---|
| `id` | ステップ ID |
| `type` | ステップ種別（7 章） |
| `evidence` | 根拠（8 章）。`note` / `ref` 以外は**必ず書く**（無いと〔未確認〕表示になる） |
| `note` / `detail` | 補足説明（詳細パネルに表示） |

**呼び出しの文脈**：`call` の `steps` は呼び出し先メソッドの内部処理。内側のステップの `from` / `on` を省略すると
「いま実行中のメソッド（＝囲んでいる call の `to`）」になる。木構造がそのままコールスタックになるので、
**呼び出し先の処理は必ずその call の `steps` の中に入れる**（並べて書くと呼び出し元の処理になってしまう）。

## 7. ステップ種別ごとの項目

### call — メソッド呼び出し

```json
{ "id": "m-svc", "type": "call", "from": "ctl_create", "to": "svc_register",
  "label": "注文を登録する", "mode": "sync",
  "args": [{ "name": "command", "jpName": "注文登録コマンド", "type": "CreateOrderCommand", "description": "顧客ID・明細", "value": "request.toCommand()" }],
  "returns": { "name": "result", "jpName": "注文登録結果", "type": "OrderResult", "description": "注文ID・合計", "usage": "レスポンス生成に使用" },
  "purpose": "顧客・在庫・決済を確認して注文を確定する",
  "via": "OrderService インターフェース経由（実装は OrderServiceImpl のみ）",
  "evidence": { "refs": ["src/.../OrderController.java:34"] },
  "steps": [ ... 呼び出し先の内部処理 ... ] }
```

| 項目 | 説明 |
|---|---|
| `from` | 呼び出し元（省略時は文脈） |
| `to` | 呼び出し先ライフライン（必須） |
| `label` | 矢印に出す**処理の概要**（日本語・短く。目安 30 文字以内）。詳細は `purpose` へ |
| `mode` | `sync`（既定）/ `async`（別スレッド・非同期実行）/ `event`（イベント発行）/ `message`（キュー送信）/ `callback` |
| `args[]` | `name`（プロパティ名）・`jpName`（日本語名）・`type`・`description`・`value`（実引数の式） |
| `returns` | `name`・`jpName`・`type`・`description`（意味）・`usage`（呼び出し元での利用目的）・`rows`。`type:"void"` なら戻り矢印なし |
| `returnLabel` | 戻り矢印の文言を上書き |
| `returnArrow` | `auto`（既定：同期で returns があれば描く）/ `always` / `never` |
| `purpose` / `via` | 呼び出しの目的 / ディスパッチ・DI・AOP・プロキシ経由などの説明 |
| `steps` | 呼び出し先の内部処理 |
| `ref` | 内部処理を別の図に分けた場合の図 ID（`steps` とは併用しない） |
| `refOver` | 詳細参照ノートを掛けるライフライン ID の配列（既定は呼び出し先のみ） |

`steps` の最後が `return` ステップなら、それが通常の戻り矢印になる（文言はその `label`）。

### self — 自己メッセージ（他メソッドを呼ばない内部処理）

```json
{ "type": "self", "label": "消費税（10%・切り捨て）を計算", "category": "calc",
  "code": "tax = subtotal × 0.10", "detail": "...", "minor": false, "evidence": {...} }
```

`category`：`input`（入力値の加工）/ `calc`（計算）/ `condition`（条件判定）/ `create`（オブジェクト生成）/
`convert`（データ変換）/ `state`（状態変更）/ `validate`（入力チェック）/ `log`（ログ）/ `other`。
`stateChange: {before, after}` で状態変更を示せる。`minor: true` は「補助的な自己メッセージを隠す」設定で非表示になる（ログ等）。
`on` で実行ライフラインを明示できる（通常は省略）。

### db — DB アクセス

```json
{ "type": "db", "table": "stocks", "op": "UPDATE", "label": "有効在庫を減算",
  "columns": ["available", "version"], "set": "available = available - :qty", "where": "product_id = :id AND version = :v",
  "joins": [], "orderBy": "", "limit": "0 または 1 件", "lock": "FOR UPDATE",
  "stateChange": { "before": "available = n", "after": "available = n − 数量" },
  "sql": "UPDATE stocks SET ...", "via": "MyBatis（StockMapper.xml#decreaseAvailable）",
  "result": { "name": "updated", "jpName": "更新件数", "type": "int", "rows": "0..1" },
  "purpose": "...", "evidence": {...} }
```

| 項目 | 説明 |
|---|---|
| `table` | テーブル名（`to` で DB ライフライン ID を直接指定してもよい） |
| `op` | `SELECT` / `INSERT` / `UPDATE` / `DELETE` / `UPSERT` / `MERGE` / `CALL` / `LOCK` / `DDL` / `OTHER` |
| `label` | 操作の意味（矢印は `操作：label ［lock］`） |
| `columns` / `where` / `joins` / `orderBy` / `limit` / `set` / `values` | SQL の要点。UPDATE / DELETE で `where` が無いと警告 |
| `lock` | `FOR UPDATE` などのロック句 |
| `stateChange` | 更新前後の重要な状態 |
| `sql` | SQL 全文（図には出さず詳細パネルに表示） |
| `result` | 戻り（SELECT は既定で「取得結果」の矢印を描く。更新系は `result` がある時だけ） |
| `via` | ORM・Mapper・発行タイミング（flush 時など） |

### return — 分岐内などメソッド途中の return

`{ "type": "return", "label": "400 Bad Request", "value": {returns と同じ形}, "evidence": {...} }`
呼び出し元へ点線矢印「return：…」を描く。**call の `steps` の最後に置いた return は通常の戻り矢印**になる。

### throw — 例外の送出と伝播

```json
{ "type": "throw", "exception": "OutOfStockException", "label": "在庫不足",
  "propagateTo": "fw_dispatcher", "rollbackAt": "svc_register", "rollbackLabel": "...",
  "propagated": false, "detail": "...", "evidence": {...} }
```

| 項目 | 説明 |
|---|---|
| `exception` | 例外クラス名 |
| `propagateTo` | 例外が届く（捕捉される）ライフライン。省略時は直接の呼び出し元。呼び出し階層を 1 段ずつ ×付き点線で描く。**送出したメソッド自身**を指定すると「このメソッドの catch で捕捉」の自己メッセージになる（try の中で送出して同じメソッドで捕まえる場合） |
| `rollbackAt` | トランザクションを持つメソッドのライフライン。例外がそこを抜ける矢印の直後に ROLLBACK ノートを描く（`scope: "block"` の transaction の中で送出した場合は、抜ける矢印の直前） |
| `propagated` | true なら「例外伝播」と表示（下位メソッドで発生した例外をこの位置で表す場合） |
| `to` / `from` | 呼び出し階層と無関係な送出先を明示する場合のみ |

`try` に `finally` がある場合、try（または catch）の中で送出され、**その try を持つメソッドの外まで伝播する**例外（catch されないもの、catch で再送出したもの）は、
メソッドを抜ける矢印が finally の後に「処理中断」枠で描かれる（Java・Python 等の実行順序どおり）。メソッドの中で捕まる例外は延期されない。

詳細図（ref）に分けた呼び出しの中で発生し、全体図側の catch で捕まる例外は、全体図の呼び出しの直後に `throw`（`propagated: true`、`propagateTo` に自分自身）を置くと
「例外伝播 X（このメソッドの catch で捕捉）」と描ける。詳細図の中では、図の起点（entry）より上へは伝播を描けないので、起点まで描いて note で「全体図の X へ伝播」と書く。

`break`（処理中断）の steps が空の場合、loop の中なら「（繰り返しを抜ける）」、それ以外は「（以降の処理を行わない）」と表示される。

### alt / opt / loop / break — 条件分岐・条件付き実行・繰り返し・処理中断

```json
{ "type": "alt", "branches": [
    { "condition": "在庫が足りる", "expr": "stock >= qty", "steps": [...], "evidence": {...} },
    { "condition": "それ以外（在庫不足）", "else": true, "steps": [...] } ] }
{ "type": "opt",   "condition": "通知設定が ON", "expr": "user.notify", "steps": [...] }
{ "type": "loop",  "condition": "注文明細ごと", "expr": "for (line : lines)", "steps": [...] }
{ "type": "break", "condition": "顧客が存在しない", "expr": "customer == null", "steps": [ {"type":"throw", ...} ] }
```

- `condition` は**業務上の意味**（日本語）、`expr` はコード上の条件式（表示設定で併記できる）。
- alt の最後の分岐が else なら `"else": true` を付ける（全分岐が return/throw で終わる場合の判定に使う）。
- 分岐が return / throw で終わると、見出しに「⇒ return」「⇒ 例外送出」が自動で付く。
- 空の分岐には「（処理なし：後続処理へ合流）」が自動で入る。

### par — 並列処理

`{ "type": "par", "mechanism": "CompletableFuture.supplyAsync × 2", "branches": [ { "label": "与信照会", "steps": [...] }, { "label": "見積計算", "steps": [...] } ] }`
**実際に同時実行される場合だけ**使う（非同期呼び出し 1 本は call の mode で表す）。完了待ちは `await`。

### await — 非同期処理の完了待ち

`{ "type": "await", "target": ["m-credit", "m-quote"], "label": "両方の完了を待機", "mechanism": "allOf().join()" }`
自己メッセージ「完了待ち：…」と、各 target（非同期 call のステップ ID）からの「完了：戻り値」の点線矢印を描く。
`showResults: false` で完了矢印を省略、`resultLabels: {stepId: "文言"}` で文言を上書き。

### critical — 排他処理

```json
{ "type": "critical", "label": "在庫行の排他ロック区間",
  "lock": { "resource": "stocks（product_id の行）", "mechanism": "SELECT … FOR UPDATE", "acquire": "...", "release": "COMMIT / ROLLBACK 時", "timeout": "..." },
  "steps": [...], "options": [ { "condition": "ロック待ちタイムアウト", "steps": [...] } ] }
```

**排他制御が実際に確認できる場合だけ**使う（`lock` が無いと警告）。通常の分岐・同期処理に使わない。

### try — 例外処理（try / catch / finally）

```json
{ "type": "try", "label": "決済承認", "steps": [...],
  "catches": [ { "exception": "PaymentDeclinedException", "label": "決済が拒否された", "steps": [...] } ],
  "finally": { "label": "", "steps": [...] } }
```

Mermaid 上は `alt`（try：… / catch …）で描き、finally は黄色の背景帯とノートで描く。

### transaction / tx / lock — トランザクション・ロック

```json
{ "type": "transaction", "label": "注文登録トランザクション", "on": "svc_register",
  "propagation": "REQUIRED", "isolation": "", "readOnly": false, "timeout": "",
  "manager": "Spring @Transactional（AOP プロキシ）", "rollbackFor": ["RuntimeException"], "scope": "method",
  "end": "commit", "steps": [...] }
{ "type": "tx",   "action": "commit | rollback | begin | savepoint | flush", "label": "...", "on": "..." }
{ "type": "lock", "action": "acquire | release | wait", "resource": "...", "mechanism": "synchronized / Redis SETNX ..." }
```

transaction は青い背景帯の範囲＋「TX開始」「COMMIT（正常終了時）」ノート。例外経路のロールバックは throw の `rollbackAt` で表す。
`propagation` / `isolation` は自由記述（Spring の値でなくてよい。空なら表示しない）。
`scope`：`method`（既定。`@Transactional` などメソッド単位でプロキシが開始・終了）/ `block`（`dataSource.transaction(cb)`、`async with session.begin()` などメソッド内のブロック）。ROLLBACK ノートの位置が変わる。
`tx` は手動のトランザクション制御（`connection.commit()` 等）に使う。`lock` は自己メッセージで描く。

### ref / note / group

```json
{ "type": "ref",   "diagram": "payment", "label": "決済承認処理", "over": ["svc_payment"] }
{ "type": "note",  "text": "Propagation.MANDATORY：…", "over": ["svc_inventory"], "position": "over | left | right" }
{ "type": "group", "id": "g-post", "label": "後処理", "collapsed": false, "steps": [...] }
```

- `ref`：呼び出しに紐づかない詳細参照（call に `ref` を付けるのが基本。別プロセスのコンシューマの図へつなぐ場合など）。
- `note`：`evidence` を付けると、推定・未確認の注記に〔推定〕〔未確認〕が付き、詳細パネルに根拠が出る（「要確認」の注記などに使う）。
- `group`：処理のまとまり。灰色の背景帯＋「▼ 見出し」。`collapsed: true` だと 1 つのノート「▶ 見出し（集約：N 件）」に畳まれ、
  クリックで展開できる。**大きな図の可読性のために使い、集約内容は詳細パネルに一覧表示される**。

## 8. evidence（根拠）

```json
"evidence": {
  "status": "confirmed | inferred | unverified",
  "refs": [
    "src/main/java/.../OrderServiceImpl.java:51-52",
    { "file": "src/.../OrderRepository.java", "line": 7, "endLine": 7, "symbol": "JpaRepository#save（継承）", "quote": "" },
    "docs/処理仕様書.md#3.2 注文登録"
  ],
  "note": "推定・未確認の理由"
}
```

- `status` 省略時：`refs` があれば `confirmed`、無ければ `meta.defaultEvidenceStatus`（既定 `unverified`）。
- `confirmed`：入力資料で直接確認した事実。`inferred`：フレームワークの仕様・命名規約などから推定（**理由を note に書く**）。
  `unverified`：確認できていない。
- 図の矢印・分岐見出しに〔推定〕〔未確認〕が自動で付き、詳細パネルにステータスと根拠（ソース抜粋）が出る。
- `refs` のパスは `meta.sourceRoot` からの相対。行番号は 1 始まりで、**Grep -n や Read の行番号で確認した値だけを書く**。
- `build` / `validate` は、ファイルの存在・行番号の範囲・**参照行（前後 3 行まで）に呼び出し先メソッド名や例外名が含まれるか**を照合する。
  記号の照合は confirmed のステップのソースコードの根拠だけが対象（設計書などの資料、推定・未確認のステップは対象外）。
  継承メソッドなど参照行に名前が現れない場合は `symbol` を書くと照合を省略する（説明として表示される）。
- ライフラインの `evidence.refs` は**メソッドの定義行**（シグネチャ・`def` / `async` の行）を指す。method 型・batch 型の確認済みライフラインも、参照行の前後 3 行にメソッド名があるか照合される（import 行や DI の行を指すと不一致になる）。
- 件数の数え方：`validate` の「根拠 確認済み・推定・未確認」は**ステップ数**（モデル全体）。ビューアのステータスバーの「推定の矢印・未確認の矢印」は**その図の矢印の数**。
  報告にはモデル全体のステップ数（validate の値）を使う。

## 9. 生成規則（どう描かれるか）

| モデル | Mermaid | 図での見え方 |
|---|---|---|
| call（sync） | `A->>+B` / 戻り `B-->>-A` | 実線・塗り矢じり / 点線の戻り |
| call（async / event / message） | `A-)+B` | 実線・開いた矢じり（紫、イベントは桃色） |
| call（callback）、await の完了 | `B--)A` | 点線・開いた矢じり |
| self / lock / await | `A->>A` | 自己メッセージ |
| db | `A->>+DB` / `DB-->>-A` | 緑の矢印。ラベル `操作：概要 ［ロック］` |
| throw | `B--xA` | 赤い点線・× |
| alt / opt / loop / par / critical / break | 同名の構文 | 枠。見出しは描画後に日本語化（条件分岐・条件付き実行・繰り返し・並列処理・排他処理・処理中断） |
| try | `alt` + `else`、finally は `rect` + `Note` | 見出し「例外処理」、区間 [try：…] / [catch …]。finally の外へ出る例外は finally の後の「処理中断」枠 |
| transaction / group | `rect` + `Note` | 背景帯 |
| ref / call.ref | `Note over` | 「詳細参照：図名」（クリックで移動） |
| 全メッセージ | `autonumber` | 番号は詳細パネル・アウトラインと共通 |

Mermaid に存在しない構文（`ref` 枠など）は使わず、正式な構文＋ビューアの後処理で代替している。

## 10. 最小例

```json
{
  "schemaVersion": 1,
  "meta": { "title": "ログイン処理", "sourceRoot": "../..", "defaultEvidenceStatus": "unverified" },
  "lifelines": [
    { "id": "client", "type": "actor", "name": "利用者" },
    { "id": "ctl_login", "kind": "Controller", "class": "AuthController", "method": "login", "evidence": { "refs": ["src/auth/AuthController.ts:20-41"] } },
    { "id": "svc_auth", "kind": "Service", "class": "AuthService", "method": "authenticate", "evidence": { "refs": ["src/auth/AuthService.ts:12-30"] } }
  ],
  "diagrams": [
    { "id": "main", "title": "ログイン", "entry": "client", "steps": [
      { "id": "s1", "type": "call", "from": "client", "to": "ctl_login", "label": "POST /login",
        "returns": { "name": "res", "jpName": "応答", "type": "200 / 401" }, "evidence": { "refs": ["src/auth/AuthController.ts:20"] },
        "steps": [
          { "id": "s2", "type": "call", "to": "svc_auth", "label": "認証する",
            "args": [{ "name": "email", "jpName": "メールアドレス", "type": "string" }],
            "returns": { "name": "user", "jpName": "利用者", "type": "User | null" }, "evidence": { "refs": ["src/auth/AuthController.ts:25"] },
            "steps": [ { "id": "s3", "type": "db", "table": "users", "op": "SELECT", "label": "利用者を取得", "where": "email = ?", "evidence": { "refs": ["src/auth/AuthService.ts:14"] } } ] },
          { "id": "s4", "type": "alt", "evidence": { "refs": ["src/auth/AuthController.ts:26"] }, "branches": [
            { "condition": "認証に失敗", "expr": "user == null", "steps": [ { "id": "s5", "type": "return", "label": "401 Unauthorized", "evidence": { "refs": ["src/auth/AuthController.ts:27"] } } ] },
            { "condition": "認証に成功", "else": true, "steps": [ { "id": "s6", "type": "self", "label": "トークンを発行", "category": "create", "evidence": { "refs": ["src/auth/AuthController.ts:29"] } } ] } ] }
        ] }
    ] }
  ]
}
```

完全な例は `examples/order-system/order-create.model.json`（4 図・約 100 メッセージ）。
