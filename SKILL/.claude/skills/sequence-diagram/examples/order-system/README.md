# サンプル：注文登録処理（Spring Boot）

スキルの出力例と、モデルの書き方の手本。複雑な処理の表現力を検証するために作った架空のアプリケーション。

| ファイル | 内容 |
|---|---|
| `src/` | 解析対象のソース（Java 21 / Spring Boot 3 / Spring Data JPA / MyBatis / Spring Kafka。46 ファイル） |
| `order-create.model.json` | 処理モデル（解析結果）。4 図・メッセージ 116・ライフライン 40・根拠 159 件 |
| `order-create.html` | 生成したビューア（単一ファイル、オフラインで閲覧可） |

## 含まれる要素

| 要素 | 図・ステップ |
|---|---|
| 複数の Controller / Service / Repository / Mapper | 全体図。DispatcherServlet → OrderController → OrderServiceImpl → 各 Service / Repository |
| インターフェース経由の呼び出し・DI | `m-svc`（OrderService → OrderServiceImpl、via に解決根拠） |
| 複数の DB テーブル | customers / products / orders / order_lines / stocks / stock_movements / payments / audit_logs |
| 自己メッセージ | 入力検証、DTO 変換（集約）、小計・税額計算、状態変更 |
| ネストした条件分岐・早期終了 | 入力検証 → try/catch、顧客不在・利用停止・与信超過・在庫不足（break + throw） |
| 繰り返し | 明細ごとの在庫引当、見積計算、明細のカスケード保存 |
| 例外処理 | 例外の伝播（propagateTo）、GlobalExceptionHandler による 404 / 402 / 409、catch での再送出と finally（finally の後に伝播） |
| トランザクション | @Transactional（REQUIRED）の範囲と ROLLBACK、MANDATORY への参加、REQUIRES_NEW の監査ログ、JPA flush の UPDATE（推定） |
| 排他制御 | SELECT … FOR UPDATE による在庫行のロック（排他処理） |
| 並列処理と非同期処理 | CompletableFuture による与信照会と見積計算の並列実行＋完了待ち（par + await）、@Async のリスナー、Kafka 送信 |
| コミット後の処理 | @TransactionalEventListener(AFTER_COMMIT) |
| 戻り値 | 各呼び出しの戻り値（日本語名・型・利用目的） |
| 詳細図への参照 | 全体図 → 在庫引当処理・決済承認処理・コミット後の通知 |
| 推定と確認済みの区別 | JPA が生成する SQL、フレームワークの既定動作（〔推定〕）、未確認事項・集約した処理の一覧（概要タブ） |
| 異常系の網羅 | ハンドラの無い例外の 500、CompletionException の原因例外による 404／500、非同期リスナーの例外（AsyncUncaughtExceptionHandler）、メール送信失敗時に Kafka が送られない経路 |

## 再生成

```bash
cd examples/order-system
node ../../scripts/seqdiag.cjs validate order-create.model.json
node ../../scripts/seqdiag.cjs build order-create.model.json -o order-create.html
node ../../scripts/seqdiag.cjs verify order-create.html --screenshots shots --full
```
