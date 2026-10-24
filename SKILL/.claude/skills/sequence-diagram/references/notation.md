# 表記規約 — 処理をどの要素で表すか

モデル（`model-schema.md`）の各要素を、どんな処理に使うかの判断基準。
目的は「コードを読まなくても、何がどの順で、どの条件で、どのデータに対して起きるか」が正確に分かること。
見栄えのために処理を削ったり、確認していない処理を足したりしない。

## 目次

1. ライフライン
2. メッセージ（呼び出し）と粒度
3. 自己メッセージ
4. 戻り値
5. DB アクセス
6. 条件分岐・繰り返し
7. 例外処理
8. 非同期と並列（区別する）
9. トランザクション・排他制御
10. 図の分割（全体図と詳細図）・集約
11. 文言の書き方
12. Mermaid 構文との対応と日本語表示

---

## 1. ライフライン

- **メソッド単位**。表示形式は `種別：クラス名.メソッド名`（種別が無ければ `クラス名.メソッド名`）。同一クラスでもメソッドが違えば別ライフライン。
- 同じメソッドは図の中で 1 本を再利用する（ID を使い回す）。オーバーロードは `signature` で区別（自動でシグネチャ表示）。
- 呼ばれる実体を書く。インターフェース経由なら**実装クラス**のメソッドをライフラインにし、`via` に「OrderService 経由（実装は 1 つ）」のように解決根拠を書く。実装が複数で特定できなければ、候補を `via` に列挙し `evidence.status: "inferred"` または `"unverified"`。
- DB は**テーブル単位**（`DB：orders`）。外部 API は `External API：サービス名.操作`、キュー/トピックは `Kafka：order-events` のように種別を付ける。
- フレームワークの暗黙処理（DispatcherServlet、AOP プロキシ、ミドルウェア、イベント配信）は、**処理の理解に必要なときだけ** type=framework のライフラインにする。コードに無い処理なので根拠は `inferred` とし、何から判断したか（アノテーション等）を note に書く。
  `class` には部品名（`DispatcherServlet`、`ValidationPipe`、`BullMQ Worker`）、`method` には操作名を入れる。操作名が無い・分からない場合は `method` を省略してよい（type が method 以外なら警告は出ない）。
- `type: "actor"`（人の形）は**人（利用者・オペレーター）だけ**に使う。ジョブスケジューラ・外部システム・別プロセスは `batch` / `external` / `framework` にする（人の形は名前が最初の矢印のラベルと近接して読みにくくなる）。
- 並び順は自動（レイヤー順 → 呼び出しの初出順）。呼び出し元が左、呼び出し先が右に並ぶので、通常は指定不要。
  主経路の矢印が多くのライフラインを横切る場合だけ、`layer` の変更や `participants` で調整する。

## 2. メッセージ（呼び出し）と粒度

- **別メソッドを呼ぶ処理はメッセージにする**のが原則。引数（プロパティ名・日本語名・型・説明）・戻り値・目的・同期/非同期を埋める。
- 例外として、次は呼び出し先ライフラインを作らず**自己メッセージに集約してよい**。ただし集約したことを `meta.omissions` に必ず書く。
  - 値オブジェクト・DTO の生成/変換（`toCommand()`、`from()`、`of()`）
  - 単純なゲッター・判定（`getId()`、`isSuspended()`）
  - ログ出力（`minor: true`）
  - 標準ライブラリの単純な操作（`stream().map(...)`、`BigDecimal.add`）
- 状態を変える・DB や外部と通信する・条件分岐や例外を含むメソッドは集約しない（ドメインメソッド `order.markPaid()` もメッセージにする）。
- 呼び出しの位置は `steps` の入れ子で表す。呼び出し先で起きることは必ずその call の `steps` の中へ。

## 3. 自己メッセージ

他メソッドを呼ばない処理のうち、**処理の意味を理解するのに必要なもの**を自己メッセージにする。1 行ずつではなく意味のまとまりで。

- 入れる：入力値の加工、計算（税額・合計）、条件判定の前提となる値の算出、オブジェクト生成、データ変換、内部状態・エンティティの状態変更（`stateChange` を付ける）。
- 省略してよい：単なる代入の受け渡し、デバッグ用の処理。
- 重要な条件判定は自己メッセージで済ませず `alt` / `opt` / `break` で分岐として描く。

## 4. 戻り値

- 同期呼び出しで戻り値があれば `returns` を書く（`name`・`jpName`・`type`・`description`・`usage`）。点線の戻り矢印に「日本語名（型）」が出る。
- `void`、または戻り値を使っていない場合は戻り矢印を出さない（`returns: {"type":"void"}` または `returnArrow: "never"`）。活性区間は自動で閉じる。
- 分岐内の return は `return` ステップ。メソッドの最後の return を明示したいときは call の `steps` の末尾に `return` を置く（その label が戻り矢印になる）。
- 戻り値が後続の分岐判定に使われる場合は、`usage` にそれを書く（例：「1 件でなければ競合として例外」）。
- 応答が複数ある呼び出し（外部 API の 200 / 402 / 5xx、画面への正常応答とエラー応答）：call の `steps` に `alt` を置き、各分岐に `return`
  （`label`「200：承認結果」「402：承認拒否」）を書き、call には `returnArrow: "never"` を付ける（最後の戻り矢印が重複しないように）。

## 5. DB アクセス

- 「DB にアクセス」とまとめず、**1 回の SQL 発行を 1 つの `db` ステップ**にする（ループ内なら loop の中に）。
- 必ず書く：`op`、`table`、意味の `label`、`where`（更新・削除では必須）、主要 `columns`。分かれば `joins`・`limit`・`lock`・`set`・`stateChange`・`sql`。
- ORM：テーブルはエンティティのマッピング（`@Table`、命名規約）から特定し、SQL がコードに無い場合は `evidence.status: "inferred"` と理由（「JPA が生成」）を書く。
  発行タイミングが呼び出し位置と異なる場合（flush 時、カスケード、遅延ロード）は、**実際に発行される位置**に置いて `via` に説明を書く。
- リポジトリ等のメソッド（`orderRepository.save`）は call で描き、その `steps` に db を置く（呼び出しと SQL の両方が見えるように）。
- トランザクション境界・コミット・ロールバックは 9 章の要素で描く。

## 6. 条件分岐・繰り返し

| コード | 要素 |
|---|---|
| if / else if / else、switch | `alt`（分岐ごとに branch。else は `"else": true`） |
| else の無い if（処理を追加で行う） | `opt` |
| 条件を満たすとメソッドを抜ける（早期 return、ガード節の throw） | `break`（中に `return` / `throw`） |
| for / while / forEach / stream の要素ごとの処理 | `loop`（`condition` に「注文明細ごと」など） |

- `condition` は**業務上の意味**を日本語で（「在庫が足りない」）。コードの式は `expr` に（表示設定で併記できる）。
- 各分岐で実行される処理を必ず書く。何もしない分岐も削らず残す（「処理なし：後続処理へ合流」と表示される）。
- 分岐の後で処理が合流する場合は、分岐の外（後ろ）にステップを置く。早期 return・例外で終わる分岐は自動で「⇒ return」「⇒ 例外送出」と表示される。
- ネストはコードの構造どおりに入れ子にする。

## 7. 例外処理

- 送出箇所：例外を投げるメソッドの文脈に `throw`。`propagateTo` で**捕捉される場所まで**伝播を描く（途中の各メソッドを 1 段ずつ通る）。
- 捕捉：`try`（catches の各分岐に catch 内の処理）。catch で再送出するなら catch の最後に `throw`。
- **同じメソッドの中で送出して、同じメソッドの catch で捕まえる**（仕様書の「WMS がエラーなら受注単位でロールバックして次へ」など）：
  try の steps の中に `throw` を置き、`propagateTo` に**自分自身のライフライン**を指定する。自己メッセージ「例外 X（このメソッドの catch で捕捉）」が描かれ、呼び出し元へは伝播しない。
- finally：`try.finally`。メソッドの外へ出る伝播は自動で finally の後に描かれる。
- フレームワークの例外ハンドラ（`@ExceptionHandler`、エラーミドルウェア）：例外を受け取るフレームワークのライフラインで `try` を作り、catch でハンドラを `call` する。エラーレスポンスの生成はハンドラの戻り値として描く。
- 呼び出し先（詳細図側）で発生した例外を全体図で示すときは、呼び出しの直後に `break [在庫引当で例外]` → `throw`（`propagated: true`）とする。
- `@Transactional` 境界を抜ける例外は `rollbackAt` で ROLLBACK を描く。ロールバックされない例外（チェック例外など）は描かない。
- 正常系と異常系は色で区別される（例外は赤い×付き点線）。異常系を正常系の分岐と混ぜない。

## 8. 非同期と並列（区別する）

| 実態 | 表し方 |
|---|---|
| 別スレッド・別プロセスで実行させ、呼び出し元は待たずに進む（`@Async`、`supplyAsync`、`go`、`Task.Run`、fire-and-forget） | `call` の `mode: "async"` |
| イベント発行（`publishEvent`、EventEmitter） | `mode: "event"` |
| キュー / トピックへの送信 | キューのライフラインへ `mode: "message"` |
| キューから受信して処理（コンシューマ） | キューのライフラインから `mode: "async"`（または別の図） |
| コールバック・完了通知 | `mode: "callback"` |
| **複数の処理が同時に進む**（`allOf`、`Promise.all`、`parallelStream`、WaitGroup） | `par`（各 branch に処理） |
| 非同期処理の完了を待つ（`join`、`await`、`get()`） | `await`（target に非同期 call のステップ ID） |

- 「非同期 = 並列」ではない。非同期呼び出し 1 本だけなら par は使わない。par は**同時に実行される複数の処理**があるときだけ。
- コミット後に実行されるリスナー（`@TransactionalEventListener(AFTER_COMMIT)`）は、発行位置ではなくコミットの後に呼び出しを置く。
- 別スレッドで実行される処理はトランザクションを引き継がないことが多い。その場合は note・`via` に書く。

### 言語ごとの対応（async / await を持つ言語）

| コード | 表し方 |
|---|---|
| `await f()`（その場で完了を待つ。Python / JS / C# / Kotlin） | **同期の `call`**（呼び出し元は先へ進まない）。`via` に「await（イベントループで待機）」と書いてよい |
| `asyncio.create_task(f())`、`f()` の Promise を待たずに進む、`Task.Run`（待たない） | `mode: "async"` |
| `asyncio.gather(a(), b())`、`Promise.all([...])`、`Task.WhenAll` | `par`（各 branch に `mode: "async"` の call）＋直後に `await`（target に各 call） |
| `async with session.begin():`、`dataSource.transaction(async (m) => ...)`、`using var tx = ...` | `transaction`（ブロックの範囲） |
| `await queue.add(...)`（キューへの登録完了は待つが、処理は待たない） | キューのライフラインへ `mode: "message"`、`returnArrow: "always"`、`returnLabel: "登録完了"` |

### 別プロセスのコンシューマ（キューの先の処理）

- コンシューマ（ワーカー、`@KafkaListener`、BullMQ の Processor）は**別の図**にし、図の `entry` をキュー（または `framework` 型のワーカー基盤）にする。
  最初の呼び出しは「キュー → コンシューマのメソッド」（`mode: "async"`）。
- 投入側の図では、キューへの送信の直後に `ref` ステップ（`over` はキュー）を置いて詳細図へつなぐ。呼び出しの対応（call.ref）では結べないので「この図の中で展開」は使えない。
- 図の先頭に note で「API とは別プロセス。投入側は処理の完了を待たない」と書く。

### フレームワークによる再実行・再試行

- コードの for / while による再試行：`loop`（`condition` に「最大 3 回（10 秒間隔）」）の中に、呼び出しと結果の判定を置く。
  「成功したら繰り返しを抜ける」は loop の中の `break`（`condition`「成功した場合」、steps は空でよい）で表す（UML の break は囲んでいる枠を抜ける意味）。
  break は loop の**直下**に置く（alt の中に置くと alt を抜ける意味になる）。steps が空の break には「（繰り返しを抜ける）」と表示される。上限超過で例外を投げる場合は、loop の後に `opt`「再試行の上限を超えた場合」→ `throw`。
- フレームワークの再試行（BullMQ の `attempts`、`@Retryable`、Kafka のリトライ、HTTP クライアントのリトライ設定）：処理全体を `loop`「試行ごと（最大 N 回、フレームワーク）」で囲み、最後に `alt`（完了／再試行を予約／失敗）。設定値の根拠行を付け、挙動は `inferred`。
- 再試行の間隔・回数の数え方（「最大 3 回再試行」が初回を含むか）が資料から決まらない場合は、解釈を note と `meta.assumptions` に書く。

例：キューのワーカー（別の図）とフレームワークの再試行（BullMQ の attempts: 3）。evidence は省略して示す。

```json
{ "id": "worker", "title": "ウェルカムメール送信（ワーカー）", "entry": "fw_worker", "steps": [
  { "id": "w-note", "type": "note", "over": ["fw_worker"], "text": "API とは別プロセス。投入側は完了を待たない" },
  { "id": "w-loop", "type": "loop", "condition": "試行ごと（最大 3 回、BullMQ の attempts）", "steps": [
    { "id": "w-proc", "type": "call", "from": "fw_worker", "to": "proc_process", "mode": "async", "label": "ジョブを処理", "steps": [] },
    { "id": "w-done", "type": "break", "condition": "処理が完了した場合", "steps": [] },
    { "id": "w-result", "type": "alt", "branches": [
      { "condition": "例外（試行回数が残っている）", "steps": [ { "id": "w-retry", "type": "self", "label": "再試行を予約（5 秒後）" } ] },
      { "condition": "例外（最後の試行）", "else": true, "steps": [ { "id": "w-failed", "type": "self", "label": "ジョブを失敗として記録" } ] } ] } ] } ] }
```

## 9. トランザクション・排他制御

- `transaction`：トランザクションの開始〜終了の範囲（宣言的なら付与されたメソッドの内部処理を囲む）。伝播属性（REQUIRED / REQUIRES_NEW / MANDATORY …）を書く。
  `propagation` は自由記述（Spring 以外は「ブロック（dataSource.transaction）」「session.begin()」など、仕組みを短く書くか省略）。
  メソッドの中のブロックで開始・終了する方式（`dataSource.transaction(cb)`、`async with session.begin()`、`using var tx`）は `scope: "block"` を付ける。
  - REQUIRES_NEW など独立したトランザクションは別の `transaction` として入れ子にする。
  - 既存トランザクションへの参加（MANDATORY / SUPPORTS）は note で示す。
- ROLLBACK の描き分け：
  - トランザクションの**境界を例外が抜けて**ロールバックされる → throw の `rollbackAt`（トランザクションを持つメソッドのライフライン）。
    `@Transactional` などメソッド単位（プロキシ）の場合は、そのメソッドを抜ける矢印の直後に ROLLBACK の注記が入る。
    `scope: "block"` の transaction の中で送出された場合は、ブロックを抜ける時点（メソッドから呼び出し元へ伝播する矢印の直前）に入る。
  - 同じメソッドの中で例外を**捕捉してから**ロールバックする（catch で `rollback()` を呼ぶ、受注 1 件ごとに戻して次へ進む）→ catch 節の中に `tx`（`action: "rollback"`）。
  - 1 件ごとにコミットする繰り返し → `loop` の中に `transaction` を置く。
- 手動のトランザクション制御（`connection.commit()`、`session.beginTransaction()`）は `tx` ステップ。
- **`critical`（排他処理）は排他制御が実際に確認できる場合だけ**：`SELECT … FOR UPDATE`、`@Lock(PESSIMISTIC_WRITE)`、`synchronized`、`ReentrantLock`、分散ロック（Redis SETNX、Redisson）、DB のアドバイザリロック、テーブルロック。
  `lock` に資源・仕組み・取得/解放のタイミングを書く。
- 楽観ロック（`@Version`、`WHERE version = ?`）は排他区間ではない。UPDATE の where と、競合時の例外分岐で表す。
- 単なる条件分岐・同期処理・トランザクションを critical にしない。

## 10. 図の分割（全体図と詳細図）・集約

- 1 つの図の目安：**メッセージ 80 件程度・ライフライン 15〜20 本まで**。超える場合や、処理が意味のまとまりに分かれる場合は分割する。
- 分割の単位は業務上の意味（注文検証・在庫引当・決済・注文確定通知など）。全体図ではその呼び出しに `ref` を付け、詳細図に内部を書く。
  詳細図には、全体図と同じ呼び出し（`from` → `to` が同じ call）を置き、その `steps` に内部処理を書く。最上位でなくてもよい
  （par の中の複数の呼び出しを 1 つの詳細図にまとめる場合は、詳細図にも同じ par を置く）。同じ呼び出しがあれば「この図の中で展開」も使える。
- 全体図にも、詳細図で起こる**例外の伝播・トランザクションへの影響**は残す（break + propagated の throw）。
- 1 つの図の中でまとまりを示したいときは `group`。初期状態で畳む場合は `collapsed: true`（集約した内容は詳細パネルに一覧される）。
- 集約・省略したものは必ず `meta.omissions` に書く。

## 11. 文言の書き方

- 矢印の `label` は**日本語の処理概要**（「注文を登録する」「在庫行をロックして取得」）。30 文字程度まで。メソッド名はライフラインに出ているので繰り返さない。
  HTTP 呼び出しは `POST /v1/authorizations` のようにメソッドとパスを書く。
- 分岐の `condition` は業務の言葉で、肯定形を基本に（「在庫が足りない」）。
- `jpName` はドメインの用語（「注文明細」「与信残高」）。推測で業務用語を作らない（不明ならプロパティ名をそのまま使い、description に「意味は未確認」と書く）。
- `<` `>` `;` `#` などの記号はそのまま書いてよい（生成器がエスケープする）。改行は `\n`。

## 12. Mermaid 構文との対応と日本語表示

| Mermaid | 日本語表示 | 用途 |
|---|---|---|
| alt | 条件分岐（try-catch から生成した枠は「例外処理」） | if / switch、try-catch |
| opt | 条件付き実行 | else の無い if |
| loop | 繰り返し | for / while / 要素ごとの処理 |
| par | 並列処理 | 同時実行 |
| break | 処理中断 | 早期 return・例外で抜ける |
| critical | 排他処理 | ロックで保護された区間 |
| （ref は Mermaid に無い） | 詳細参照 | `Note over` で描き、ビューアがリンクにする |

日本語化は描画後の SVG で、生成時の対応表と種別が一致した見出し（labelText 要素）だけを置き換える。
図中の他の文字列（ソースコード由来の `alt` などの文字）は置き換わらない。Mermaid コード（保存・コピー）は正式な英語の構文のまま。
