# 解析ガイド — Phase 1（入力内容の解析）

ソースコード・設計書・処理仕様・自然言語の説明から、図にする処理の**事実**を集める手順。
ここで集めた事実だけをモデルに書く。確認できないことは「推定」「未確認」として区別する。

## 目次

1. 範囲を決める
2. ソースコードの追跡手順
3. 呼び出し先の解決（インターフェース・継承・DI・動的ディスパッチ）
4. フレームワークの暗黙処理チェックリスト
5. DB アクセスの特定（ORM・SQL マッパー）
6. 非同期・並列・トランザクション・ロックの見つけ方
7. 根拠の記録と確度の付け方
8. 設計書・仕様書・自然言語が入力の場合
9. 大きなコードベースでの進め方
10. 解析メモ（台帳）

---

## 1. 範囲を決める

- **起点**：API エンドポイント、画面のイベント、バッチジョブ、メッセージのコンシューマ、スケジューラなど。依頼文から特定できなければ、候補を挙げて利用者に確認する。
- **終点**：起点の処理が応答を返すまで。非同期で続く処理（コミット後の通知、キューのコンシューマ）は、依頼の範囲に含まれるかを判断し、含めるなら詳細図に分ける。
- **深さ**：自分たちのコードは呼び出し先の内部まで追う。ライブラリ・フレームワーク・外部サービスはブラックボックス（呼び出しと戻りのみ）とし、`traced: false` や `type: external` で示す。
- 範囲外にしたもの（認証フィルタ、共通ログ等）は `meta.excluded` に理由とともに書く。

## 2. ソースコードの追跡手順

起点メソッドから**深さ優先**で、各メソッドを次の手順で読む。

1. メソッド全体を Read する（シグネチャ・アノテーション・本体）。行番号を控える。
2. 本体を上から順に、次の「出来事」を拾う：
   - 他メソッドの呼び出し（引数の式・戻り値の使われ方も）
   - 条件分岐（if / switch / 三項演算子 / ガード節）と各分岐の処理
   - 繰り返し（for / while / stream / forEach）
   - 例外の送出（throw、`orElseThrow`、検証ライブラリの例外）と try / catch / finally
   - return（早期 return を含む）
   - 状態変更（フィールド・エンティティの更新、コレクションへの追加）
   - DB・外部 API・キュー・ファイル・キャッシュへのアクセス
   - 非同期実行・並列実行・待ち合わせ・ロック・トランザクション制御
3. 呼び出しごとに呼び出し先を解決（3 章）し、自分たちのコードなら 1. に戻って内部を読む。
4. 読み終えたメソッドは台帳（10 章）に「解析済み」と記録する。

**取りこぼし防止**：メソッドを読み終えたら、Grep でそのメソッドの行範囲にある `(` を含む行を見直し、拾い忘れた呼び出しが無いか確認する。
ラムダ・コールバック・メソッド参照（`Product::getId`）・プロパティアクセスに見えるメソッド呼び出し（C# のプロパティ、Kotlin の getter、Python の `@property`）も呼び出しとして扱う。

## 3. 呼び出し先の解決

| 状況 | 手順 | 確度 |
|---|---|---|
| 具象クラスのメソッド | 定義を Grep で特定 | confirmed |
| インターフェース・抽象クラス経由 | `implements X` / `extends X` / `: X` / `class .*X` を Grep。実装が 1 つならそれ | confirmed（`via` に「実装は 1 つ」） |
| 実装が複数 | DI 設定（`@Qualifier`、`@Primary`、`@Profile`、Bean 定義、DI コンテナの登録、ファクトリ）で特定 | 特定できれば confirmed、できなければ候補を `via` に列挙し inferred / unverified |
| 継承・オーバーライド | 実行時の型を、生成箇所・DI から特定。サブクラスで override されていないか確認 | 同上 |
| 動的な呼び出し（リフレクション、文字列でのディスパッチ、プラグイン） | 呼び出し候補を探す。確定できなければその旨を書く | unverified |
| 同じクラス内の呼び出し（`this.method()`） | 別メソッドのライフラインとして描く。**AOP（@Transactional・@Async 等）は自己呼び出しでは効かない**ことに注意 | confirmed |
| ライブラリ・フレームワークのメソッド | 中は追わない。挙動はドキュメントの仕様として inferred | inferred |

挙動の確認のために、手元にインストール済みのライブラリのソース（`node_modules/`、`site-packages/`、Maven/Gradle のソース jar 等）を読むのはよい
（ネットワークから新たに取得する場合は利用者の環境の方針に従う）。読んで確かめた挙動も、図の上ではライブラリ内部の処理なので `inferred` とし、
note に「ライブラリのソース（パス:行）で確認」と書く。ソースが手元に無く、公式ドキュメントや一般的な仕様の知識による場合は「仕様の知識による（ソース未確認）」と書き分ける。

## 4. フレームワークの暗黙処理チェックリスト

コードに直接書かれていないが処理の流れに影響するもの。該当するか確認し、図に必要なものだけを描く（根拠はトリガーとなる宣言の行）。

| 種類 | 例 | 確認すること |
|---|---|---|
| 入口の処理 | Spring MVC DispatcherServlet、Express/NestJS ミドルウェア・Guard・Pipe・Interceptor、ASP.NET Core ミドルウェア・Filter、Django ミドルウェア、Rails before_action | 入力の変換・検証（`@Valid`、Pipe、ModelState）、認証・認可で処理が止まる経路 |
| 例外の変換 | `@ControllerAdvice`/`@ExceptionHandler`、Exception Filter、`app.use((err, req, res, next))`、Rails `rescue_from` | どの例外がどの応答（ステータス）になるか。ハンドラが無い例外の既定動作 |
| AOP・プロキシ | `@Transactional`、`@Async`、`@Cacheable`、`@Retryable`、独自アスペクト（`@Around` のポイントカット） | 対象メソッドに適用されるか（自己呼び出し・private では効かない） |
| トランザクション | `@Transactional`（伝播・readOnly・rollbackFor）、`TransactionScope`、`transaction.atomic`、`DB::transaction` | 境界・伝播・どの例外でロールバックするか（Spring は既定で RuntimeException のみ） |
| ORM の暗黙 SQL | JPA の flush・dirty checking・cascade・lazy loading、EF Core `SaveChanges`、ActiveRecord コールバック、Django シグナル | 実際に SQL が出る位置と回数 |
| イベント | `ApplicationEventPublisher`、`@EventListener`、`@TransactionalEventListener`、ドメインイベント、Node EventEmitter | リスナーはどれか（Grep）、同期/非同期、コミット前/後 |
| 非同期 | `@Async`、`CompletableFuture`、`ExecutorService`、`async/await`、`Task.Run`、goroutine、Celery、ジョブキュー | 実行スレッド、待ち合わせの有無、例外の行き先 |
| メッセージング | KafkaTemplate、RabbitTemplate、SQS/SNS、`@KafkaListener` | 送信先トピック・キー、送信結果の確認有無、受信側 |
| スケジューラ | `@Scheduled`、cron、Quartz | 起点として扱うか |

## 5. DB アクセスの特定

1. アクセス手段を見分ける：ORM（JPA/Hibernate、EF Core、ActiveRecord、Django ORM、Prisma、TypeORM、Sequelize、GORM）、SQL マッパー（MyBatis、Dapper）、生 SQL（JdbcTemplate、`database/sql`、knex）。
2. テーブル名：エンティティのマッピング（`@Table`、`[Table]`、`db_table`、`@@map`）→ 無ければ命名規約（推定）。
3. SQL：
   - SQL マッパー・生 SQL：XML / アノテーション / 文字列から**実際の SQL を読む**（columns・where・lock）。
   - 派生クエリ（`findByStatusAndCreatedAtAfter`）：メソッド名から where を導く（inferred）。
   - `save` / `persist` / `SaveChanges`：新規か更新か（ID の有無・`isNew`）で INSERT / UPDATE を判断。判断できなければ inferred。
4. 発行タイミング：flush・カスケード・遅延ロードで呼び出し位置とずれる場合、実際の位置に `db` を置き `via` に説明。
5. 件数・ロック：主キー検索なら 0..1 件、`IN` なら最大 n 件、`FOR UPDATE` / `@Lock` はロック句として記録。

## 6. 非同期・並列・トランザクション・ロックの見つけ方

Grep の目安（言語に合わせて調整）：

- 非同期・並列：`@Async|CompletableFuture|supplyAsync|runAsync|ExecutorService|submit\(|parallelStream|Promise\.all|async |await |Task\.Run|Task\.WhenAll|go func|WaitGroup|asyncio\.gather|ThreadPool`
- トランザクション：`@Transactional|TransactionTemplate|beginTransaction|commit\(|rollback\(|TransactionScope|atomic|\$transaction`
- ロック：`FOR UPDATE|@Lock|LockModeType|synchronized|ReentrantLock|\.lock\(|SETNX|Redisson|advisory|pg_advisory|LOCK TABLE|@Version`
- イベント：`publishEvent|@EventListener|@TransactionalEventListener|emit\(|\.on\(|@KafkaListener|send\(`

見つけたら、`notation.md` 8・9 章の基準で par / async / critical などを選ぶ。

## 7. 根拠の記録と確度の付け方

- すべての call・db・self・分岐・throw・return に `evidence.refs` を付ける（`パス:開始行-終了行`）。行番号は Read / Grep -n の出力で確認した値だけを書く。**記憶や推測で行番号を書かない**。
- 確度：
  - `confirmed`：その行を読んで確認した。
  - `inferred`：フレームワークの仕様、命名規約、設定の既定値など、間接的な根拠からの推定。`note` に理由を書く。
  - `unverified`：確認できていない（ソースが無い、解決できない）。`meta.unresolved` にも書く。
- `build` / `validate` が行番号の範囲外・記号不一致を警告したら、必ずソースを読み直して直す（警告を消すために symbol を付けるのは、継承メソッドなど本当に行に名前が無い場合だけ）。
- ライフラインの根拠はメソッドの定義行（シグネチャの行）を指す。import 行や DI（コンストラクタ引数）の行ではない。
- 記号の照合は「確認済み（confirmed）のステップとライフライン」の「ソースコード」の根拠だけが対象で、参照行の前後 3 行まで探す。
  推定・未確認のステップ（暗黙の例外 `KeyError`、ライブラリの例外、JPA の SQL など）の根拠や、設計書（.md / .docx / .pdf 等）の根拠は照合しないので、symbol は不要。

## 8. 設計書・仕様書・自然言語が入力の場合

- 入力に書かれていることだけを `confirmed` にし、`refs` には資料の位置（`docs/仕様書.md#3.2`、ページ番号、表番号）を書く。会話で説明された仕様なら `"refs": ["利用者の説明（会話）"]`。
- 書かれていないが図にするために補った要素（呼び出し順の解釈、クラス名、テーブル名）は `inferred` とし、何から補ったかを note に書く。
- クラス名・メソッド名が資料に無い場合は、資料の機能名でライフラインを作る（`kind: "画面"`、`class: "注文登録画面"`、`method: "登録ボタン押下"` など）。存在しないクラス名を作らない。
  ライフラインの単位は「資料が処理を分けている単位」（節・処理ブロック・画面のボタン）にするのが基本。例：

  ```json
  { "id": "job", "type": "batch", "kind": "Batch", "class": "出荷指示バッチ", "method": "SHIP_INSTRUCTION", "evidence": { "refs": ["docs/仕様書.md:5-8"] } },
  { "id": "p_extract", "kind": "処理", "class": "出荷指示バッチ", "method": "対象受注の抽出", "evidence": { "refs": ["docs/仕様書.md:12-18"] } },
  { "id": "wms_stock", "type": "external", "class": "WMS", "method": "在庫照会 API", "evidence": { "refs": ["docs/仕様書.md:24"] } },
  { "id": "db_orders", "type": "db", "name": "orders", "evidence": { "refs": ["docs/仕様書.md:14"] } }
  ```

  複数の処理で共通の規則（再試行など）を 1 か所で描くために中間のライフライン（「WMS 呼び出し」）を置く場合は、それが資料に無い補完であることを
  `evidence.status: "inferred"` と note で示す。
- 資料の誤記らしき箇所（存在しない章の参照など）は、解釈を `meta.assumptions` に、確認したい点を `meta.unresolved` に書く。
- 曖昧な点（分岐の条件、例外時の挙動、トランザクション範囲）は `meta.unresolved` に質問の形で書く。
- `meta.defaultEvidence` に資料全体を指定しておくと、個別の refs を省略したステップにも資料名が出る（ただし具体的な節を書く方がよい）。

## 9. 大きなコードベースでの進め方

- 起点から呼び出し関係を段階的にたどり、関係の無いファイルは読まない。まず Grep で定義位置を特定してから、その範囲だけを Read する。
- ただし次は必ず確認する：インターフェースの全実装、適用されるアスペクト、送出される例外を捕捉する箇所（呼び出し元・例外ハンドラ）、発行されるイベントのリスナー、使われる SQL の定義。
- 追跡対象が多い（目安：メソッド 30 以上）場合は、全体図の粒度（どこで ref に分けるか）を先に決め、詳細図ごとに追跡する。
- サブエージェントが使える場合は、詳細図ごとの追跡を並列に任せてもよい（モデルの断片と根拠行を返してもらい、統合後に validate で照合する）。

## 10. 解析メモ（台帳）

追跡するメソッドがおおむね 10 以上になる場合は、出力先に `<名前>.analysis.md` を作り、次の表を更新しながら進める（少なくても作ってよい）。
セッションが途切れても再開でき、Phase 5 の網羅性チェックにも使う。

```markdown
| メソッド | ファイル:行 | 状態 | 呼び出し（行: 呼び出し先 → 扱い） |
|---|---|---|---|
| OrderServiceImpl.registerOrder | service/OrderServiceImpl.java:47-85 | 解析済み | 51: CustomerRepository.findById → call m-cust / 53: isSuspended → self に集約 / 59: CreditCheckClient.check → call m-credit … |
| PricingService.quote | service/PricingService.java:26-41 | 解析済み | 28: ProductRepository.findAllById → call / 33: Map.get → 省略（標準ライブラリ） |
| PaymentGatewayClient.authorize | infra/PaymentGatewayClient.java:18-27 | 外部呼び出しのみ | 19-26: RestClient → ext_payment |
```

「扱い」は `call <ステップID>` / `self に集約` / `省略（理由）` / `範囲外（理由）` のいずれか。省略・集約は meta にも転記する。

入力が設計書・仕様書の場合は、メソッドの代わりに資料の行（記述）ごとに台帳を作り、どのステップで表したか（または表さなかった理由）を書く。

```markdown
| 資料の箇所 | 記述（要約） | 扱い | 確度・メモ |
|---|---|---|---|
| 仕様書.md:12-14 | 2.1-1 status=PAID の受注を 500 件ずつ抽出 | db s-extract（loop m-batch の中） | 確認済み |
| 仕様書.md:22 | WMS がタイムアウトしたら最大 3 回再試行 | loop s-retry + break s-ok | 推定（初回を含むか不明 → unresolved） |
| 仕様書.md:40-44 | 4 章 排他制御（方式未決） | 範囲外（未決のため図にしない → meta.excluded） | — |
```
