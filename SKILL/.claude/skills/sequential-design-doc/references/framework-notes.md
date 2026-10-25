# フレームワーク別の暗黙の動作

コードに直接書かれていないが、実行される処理と結果に影響する動作の一覧。該当するものを逐次処理に書き、〔推定〕を付ける（根拠欄に「FW 仕様」と、注釈・設定の位置）。
版・設定で変わるものがあるので、プロジェクトの依存関係（`pom.xml`・`build.gradle`・`package.json`・`pyproject.toml`・`go.mod`）と設定ファイルが提供されていれば確認する。

目次
1. Java / Spring Boot（MVC・Security・トランザクション・JPA・MyBatis・JDBC・非同期・イベント）
2. Python / FastAPI・Starlette・SQLAlchemy・httpx・asyncio
3. Node.js / Express・NestJS・TypeORM・pg・mysql2・BullMQ
4. Go / net/http・database/sql
5. そのほか（Django・Laravel・Rails・ASP.NET Core）
6. 言語共通の注意

---

## 1. Java / Spring Boot

**リクエストの前処理（実行順）**

| 順 | 処理 | 結果に影響する動作 |
|---|---|---|
| 1 | サーブレットフィルター（`OncePerRequestFilter`・Spring Security のフィルターチェーン） | `@Order`・`FilterRegistrationBean` の順。フィルター内で応答を書いて return すると、以降は実行されない。Security の認証失敗は 401（`AuthenticationEntryPoint`）、認可失敗は 403（`AccessDeniedHandler`） |
| 2 | `HandlerInterceptor.preHandle` | false を返すとコントローラーは実行されない |
| 3 | 引数の変換 | `@PathVariable long id` の変換失敗は `MethodArgumentTypeMismatchException` → 既定で 400 |
| 4 | `@RequestBody` の読み取り | JSON の構文誤り・型不一致は `HttpMessageNotReadableException` → 既定で 400 |
| 5 | `@Valid` / `@Validated` | 違反は `MethodArgumentNotValidException` → 既定で 400。リスト要素の検証は `List<@Valid X>` または項目への `@Valid` が必要 |
| 6 | コントローラーのメソッド | |

既定の 400・500 の応答ボディは Spring Boot の `BasicErrorController`（`timestamp`・`status`・`error`・`path`）か、ProblemDetail（`spring.mvc.problemdetails.enabled`）。どちらかは設定次第〔推定〕。

**例外ハンドラー（`@ControllerAdvice` / `@RestControllerAdvice` の `@ExceptionHandler`）**

- 送出された例外の型に最も近い（継承の距離が最短の）ハンドラーが選ばれる。子クラス専用のハンドラーがあれば親クラスのハンドラーより優先。
- 一致するハンドラーが無ければ、原因例外（`getCause()`）を順にたどって一致するハンドラーを探す（Spring 5.3 以降は任意の深さ）。`CompletionException` に包まれた業務例外も、原因で一致すれば処理される〔推定〕。
- 複数の `@ControllerAdvice` は `@Order` の順。どれにも一致しない例外は、Spring 標準の例外なら既定の応答（400・405・415 など）、それ以外は 500。
- 例外クラスに `@ResponseStatus` があれば、そのステータス。

**トランザクション（`@Transactional`）**

- プロキシで実現される。**同じクラス内からの呼び出し（`this.method()`）や private メソッドでは効かない**。
- 開始はメソッドの入口、COMMIT はメソッドの正常終了時、ROLLBACK は**非検査例外（`RuntimeException`）と `Error`** がメソッドから出たとき（既定）。検査例外では COMMIT する（`rollbackFor` で変更可）。
- 伝播：`REQUIRED`（既存に参加、無ければ開始）、`REQUIRES_NEW`（既存を中断し新規に開始、**独立して COMMIT**）、`MANDATORY`（既存が無ければ `IllegalTransactionStateException`）、`NESTED`（セーブポイント）、`SUPPORTS`・`NOT_SUPPORTED`・`NEVER`。
- 参加した内側のメソッドから非検査例外が出ると、外側で catch しても全体が rollback-only になり、COMMIT 時に `UnexpectedRollbackException`。
- **トランザクションはスレッドに結び付く**。`CompletableFuture.supplyAsync`・`@Async` で別スレッドに渡した処理は、呼び出し元のトランザクションに参加しない（ロックも共有しない）。
- Spring Data のリポジトリのメソッド自体も `@Transactional`（参照系は readOnly）で、外側のトランザクションがあれば参加する。

**JPA / Hibernate（Spring Data JPA）**

- `findById`：主キーの SELECT（同じ永続化コンテキストに既にあれば発行しない）。`Optional` を返す。
- `save(entity)`：ID が null（新規）なら `persist`、そうでなければ `merge`（SELECT ＋ 必要なら UPDATE）。
- `@GeneratedValue(IDENTITY)`：`persist` の時点で INSERT を発行して ID を得る。`SEQUENCE` なら INSERT は flush 時。
- 管理状態のエンティティの属性変更は、flush 時（COMMIT 直前、または JPQL 実行前の自動 flush）に UPDATE になる（変更検知）。
- `cascade = CascadeType.ALL` の子は親と一緒に INSERT・UPDATE・DELETE。
- 列名：Spring Boot の既定の命名規則で `customerId` → `customer_id`、`@ManyToOne Order order` → `order_id`〔推定〕。
- `findAllById(ids)`：`WHERE id IN (…)`。見つからない ID は単に結果に含まれない（例外にならない）。

**MyBatis**

- マッパーインターフェースのメソッド ＝ 同じ namespace・id の XML（またはアノテーション）の SQL。これは**実行SQL**。
- `#{x}` はバインド変数、`${x}` は文字列の置換。
- 単一行を返す select は 0 件で null、2 件以上で `TooManyResultsException`。update・insert・delete は影響行数を返す。

**JDBC / JdbcTemplate**：`update` は影響行数を返す。一意制約違反は `DuplicateKeyException`、その他の制約違反は `DataIntegrityViolationException`。`queryForObject` は 0 件で `EmptyResultDataAccessException`。

**非同期・イベント・メッセージ**

| 仕組み | 動作 |
|---|---|
| `CompletableFuture.supplyAsync(f, executor)` | 指定のスレッドプールで実行。`join()` は失敗を `CompletionException` に包んで送出。`allOf(a, b).join()` は両方が終わるまで待ち、どちらかが失敗していれば `CompletionException`（もう一方は最後まで実行される） |
| `@Async` | 別スレッドで実行し、呼び出し元は待たない。戻り値 void の例外は `AsyncUncaughtExceptionHandler`（既定はログ出力のみ） |
| `ApplicationEventPublisher.publishEvent` | `@EventListener` はその場で同期実行。`@TransactionalEventListener(AFTER_COMMIT)` は**COMMIT された場合だけ**、COMMIT 後に実行（ROLLBACK 時は実行されない。トランザクションが無いと既定では実行されない） |
| `KafkaTemplate.send` | 非同期に送信し `CompletableFuture` を返す。結果を確認しなければ送信失敗は呼び出し元に伝わらない |
| `RestClient` / `RestTemplate` の `retrieve()` | 4xx・5xx は既定で `HttpClientErrorException`・`HttpServerErrorException`（`onStatus` で変更可）。タイムアウトは Bean の設定次第 |
| `JavaMailSender.send` | 同期送信。失敗は `MailException` |

## 2. Python / FastAPI・Starlette・SQLAlchemy・httpx・asyncio

**FastAPI**

- 前処理の順：ミドルウェア（登録の逆順に外側）→ ルーティング → パス・クエリ・ボディの変換と検証（Pydantic）→ `Depends` の解決（引数の順。サブ依存が先）→ ハンドラー。
- 変換・検証の失敗は `RequestValidationError` → 既定で **422**、ボディ `{"detail": [...]}`。`order_id: int` に数字以外を渡した場合も 422。
- `response_model` で応答を検証・項目を絞り込む。`status_code` はデコレーターの値。
- `@app.exception_handler(X)`：送出された例外のクラスの MRO（継承順）で最初に見つかったハンドラーが使われる。`HTTPException` は `{"detail": …}`。どれにも一致しなければ 500（`Internal Server Error`）。
- `yield` を使う依存の後処理（セッションの close など）の実行時期は版で異なる〔推定〕。

**SQLAlchemy（同期・非同期の Session）**

- `async with session.begin():` は、ブロックを正常に抜けると COMMIT、例外で抜けると ROLLBACK して例外を再送出する。既にトランザクションが始まっていると例外になる〔推定〕。
- `session.add(obj)` だけでは SQL は発行されない。`flush()`・COMMIT・autoflush（次の問い合わせの前）で INSERT。
- 取得したオブジェクトの属性を変更すると、次の flush（COMMIT 時を含む）で UPDATE。
- `select(...).with_for_update()` → `SELECT … FOR UPDATE`。`selectinload` は親の取得後に子の `SELECT … WHERE … IN (…)` を追加で発行する（子の SELECT には FOR UPDATE は付かない〔推定〕）。
- `scalar_one_or_none()`：0 件で None、2 件以上で `MultipleResultsFound`。`scalar_one()` は 0 件で `NoResultFound`。
- 一意制約違反は flush 時に `IntegrityError`。

**httpx**

- `AsyncClient(timeout=…)` の超過は `httpx.TimeoutException`（`ReadTimeout` など）、接続失敗は `httpx.ConnectError`。
- 4xx・5xx は**例外にならず**応答として返る。`raise_for_status()` を呼ぶと `httpx.HTTPStatusError`。
- `res.json()` は JSON でなければ `json.JSONDecodeError`。キーが無ければ `KeyError`。

**asyncio**

- `await asyncio.gather(a, b)`：a と b を同時に実行し、両方の結果を待つ。どちらかが例外になると**最初の例外がすぐ呼び出し元に伝わり**、もう一方は取り消されずに実行を続ける（`return_exceptions=False` の既定）。
- `asyncio.create_task` は待たなければ呼び出し元と並行して進み、例外は回収されない限り伝わらない。

**Python 共通**：`finally` は例外の有無にかかわらず実行され、finally 内の例外は元の例外を置き換える。`raise X from e` は `e` を原因として持つ。辞書の存在しないキーは `KeyError`。

## 3. Node.js / Express・NestJS・TypeORM・pg・mysql2・BullMQ

**Express**

- ミドルウェアとルートは登録順に評価される。`app.use('/api', mw)` は `/api` で始まるパスすべてに適用。
- `express.json()`：JSON の構文誤りは status 400 のエラー（`type: 'entity.parse.failed'`）としてエラーハンドラーへ。`Content-Type` が JSON でなければ `req.body` は `{}`（または undefined）。
- エラーハンドラーは引数 4 つの関数 `(err, req, res, next)`。`next(err)` で渡されたエラーを受け取る。
- **Express 4 は async 関数の reject を捕捉しない**（ラッパーや `express-async-errors` が無いと応答が返らない）。Express 5 は `next(err)` に渡す。どちらの版かは `package.json` で確認する。
- `res.status(...).json(...)` の後も、`return` しなければ関数の続きは実行される。

**pg（node-postgres）／ mysql2**

- pg：プレースホルダーは `$1, $2…`。結果は `rows`・`rowCount`。`RETURNING` で更新後の行を受け取れる。エラーの `code` は SQLSTATE（`23505` 一意制約違反、`23503` 外部キー違反、`22P02` 型変換失敗）。
- `pool.query` を個別に呼ぶと 1 文ずつ自動コミット。トランザクションは `pool.connect()` で得たクライアントで `BEGIN`／`COMMIT`／`ROLLBACK`、最後に `release()`。
- mysql2：プレースホルダーは `?`。結果は `affectedRows`・`insertId`。一意制約違反は `ER_DUP_ENTRY`（errno 1062）。

**NestJS**

- 実行順：ミドルウェア → ガード → インターセプター（前） → パイプ → コントローラー → インターセプター（後） → 例外フィルター。
- `ValidationPipe`：class-validator の違反は `BadRequestException`（400、`message` は違反内容の配列）。`whitelist: true` は DTO に無い項目を取り除き、`forbidNonWhitelisted: true` は DTO に無い項目があれば 400。`transform: true` が無ければ DTO のインスタンスに変換されない場合がある。
- `HttpException` の派生（`ConflictException` 409 など）は `{statusCode, message, error}` で応答。それ以外の例外は 500 `{statusCode: 500, message: "Internal server error"}`。
- `@HttpCode` で正常時のステータスを変更（POST の既定は 201）。

**TypeORM**

- `dataSource.transaction(async (manager) => …)`：BEGIN し、コールバックが正常に終われば COMMIT、例外なら ROLLBACK して再送出。コールバックの中では `manager` を使った操作だけがトランザクションに入る（`dataSource.getRepository` を使うと別コネクション）。
- `repo.save(entity)`：主キーが無ければ INSERT（生成列は RETURNING または追加の SELECT で取得）、あれば SELECT ＋ INSERT／UPDATE〔推定〕。`insert`・`update`・`count`・`findOne` はそれぞれ 1 文。
- 一意制約違反は `QueryFailedError`（ドライバーのエラーコードを含む）。

**BullMQ**：`queue.add(name, data, { attempts, backoff })` は Redis にジョブを登録する（Redis に接続できなければ例外）。ワーカー（`WorkerHost.process`）は別プロセスで実行され、例外を送出すると `attempts` の回数まで `backoff` の間隔で再試行される。

**JavaScript 共通**：`Promise.all` は最初の reject で reject し、ほかの処理は止まらない。`Promise.allSettled` は全部の結果を待つ。`JSON.parse` の失敗は `SyntaxError`。

## 4. Go / net/http・database/sql

- `db.QueryContext`：`rows.Next()` で 1 行ずつ読み、`rows.Err()` で途中のエラーを確認し、`rows.Close()` で閉じる。`QueryRowContext(...).Scan` は 0 件で `sql.ErrNoRows`。
- `ExecContext` の `RowsAffected()` で更新件数を得る。
- `db.BeginTx` → `tx`。`defer tx.Rollback()` は `Commit` 済みなら何もしない（`sql.ErrTxDone` を返す）。`tx` を使わない `db.ExecContext` はトランザクション外（自動コミット）。
- プレースホルダーはドライバーで違う（pgx・lib/pq は `$1`、MySQL は `?`）。
- `http.Client{Timeout: d}` の超過は `client.Do` のエラー（`net.Error` の `Timeout()` が true）。**4xx・5xx はエラーにならない**（`resp.StatusCode` で判定する）。`resp.Body.Close()` が必要。
- `context.WithTimeout` の期限切れは `context.DeadlineExceeded`。
- `os.Exit`・`log.Fatal` は **defer を実行せずに**終了する。
- goroutine 内の panic はプロセス全体を終了させる（recover しない限り）。`sync.WaitGroup`・`errgroup` で完了を待つ。
- map の存在しないキーはゼロ値（int なら 0）を返す（例外にならない）。

## 5. そのほか

| フレームワーク | 主な暗黙の動作 |
|---|---|
| Django | ミドルウェアは `MIDDLEWARE` の順。`transaction.atomic` はブロック終了で COMMIT、例外で ROLLBACK。`ATOMIC_REQUESTS` でリクエスト全体がトランザクション。QuerySet は評価されたときに SQL を発行。`get` は 0 件で `DoesNotExist`、複数で `MultipleObjectsReturned` |
| Laravel | ミドルウェアは `Kernel`・ルートの順。`FormRequest` の検証違反は 422（API）またはリダイレクト。`DB::transaction` はクロージャの例外で ROLLBACK。`findOrFail` は 404。例外は `Handler`（`render`）で応答に変換 |
| Rails | `before_action` の順。`ActiveRecord::Base.transaction`。`find` は 0 件で `RecordNotFound` → 404。`rescue_from` |
| ASP.NET Core | ミドルウェアは登録順。`[ApiController]` はモデル検証の違反で自動的に 400。EF Core は `SaveChanges` で INSERT・UPDATE をまとめて発行（その時点まで SQL は出ない）。`TransactionScope` |

## 6. 言語共通の注意

- try / finally：finally は return・例外の後にも実行される。finally の中の return・例外は、元の戻り値・例外を置き換える。
- 例外を catch してログだけ出して続行するコードは、例外経路ではなく通常の続行として書く。
- 型変換（文字列 → 数値、日付の解析）、配列・辞書の存在しない要素、NULL の参照、ゼロ除算は、コードに明示されていなくても例外・異常値になりうる。発生しうる位置で書く。
- タイムアウト・再試行・接続数などの値がコードの外（設定・Bean 定義・環境変数）にある場合、キー名を書いて〔未確認〕にする。
