---
name: sequence-diagram
description: ソースコード・設計書・処理仕様・自然言語の説明から、メソッド単位のライフラインで処理を正確に追跡した Mermaid シーケンス図を作り、クリックで引数・戻り値・SQL・根拠のソース行を確認できる横長の HTML ビューア（単一ファイル）として出力する。条件分岐・繰り返し・例外・トランザクション・排他ロック・非同期と並列・DB アクセス・全体図と詳細図の分割に対応し、推定と確認済みを区別する。「シーケンス図を作って」「処理の流れを図にして」「この API／メソッドの呼び出し関係を可視化して」「Mermaid で処理フロー」「sequence diagram」など、処理の時系列や呼び出し関係を図で説明したい依頼では、言語・フレームワークを問わずこのスキルを使う。フローチャート・ER 図・クラス図だけが欲しい場合は対象外。
compatibility: Node.js 18 以上（scripts/seqdiag.cjs、外部パッケージ不要）。表示検証に Chrome / Edge / Chromium のいずれか。Node が無い環境では Python 3 の scripts/build_html.py で HTML の組み立てだけ行える。
---

# シーケンス図生成（sequence-diagram）

入力（ソースコード、設計書、処理仕様、会話での説明）から処理を正確に追跡し、
**処理モデル（JSON）→ Mermaid → 単一ファイルの HTML ビューア**の順に生成する。
最終成果物は HTML。Mermaid コードだけを成果物として渡さない。

```
入力 ──Phase1 解析──▶ 事実（根拠行つき）──Phase2──▶ 処理モデル JSON ──Phase3──▶ Mermaid
                                                         │                       │
                                                         └──────Phase4──────▶ HTML ビューア ──Phase5 検証
```

モデルが唯一の正（single source of truth）で、Mermaid と HTML はスクリプトが機械的に生成する。
このため HTML のデザインを変えても解析結果は変わらず、Mermaid の構文誤りも起きない。

スキルのディレクトリを `${CLAUDE_SKILL_DIR}` と書く（このファイルがあるディレクトリ）。

## 重要な原則

1. **正確性が最優先。** コード（資料）で確認した事実だけを `confirmed` で書く。フレームワーク仕様などからの推定は `inferred`、確認できないものは `unverified` とし、理由を残す。図には〔推定〕〔未確認〕が自動で表示される。
2. **根拠を残す。** すべての呼び出し・DB 操作・分岐・例外に `ファイル:行` を付ける。行番号は Read / Grep -n で確かめた値だけ。ビルド時にスクリプトが行番号とメソッド名を照合する。
3. **恣意的に省略しない。** 見やすさのために処理を削らない。集約・省略・対象外にしたものは `meta.omissions` / `meta.excluded` に必ず書く。大きい処理は削らずに詳細図へ分割する。
4. **Mermaid の構文を手書きしない。** 生成器が公式の構文だけを出力する（`ref` 枠など Mermaid に無い表現は、正式な構文とビューアの後処理で代替済み）。
5. **非同期と並列、排他処理と単なる分岐を取り違えない。** 判断基準は `references/notation.md`。

## 進め方

### Phase 1：入力内容の解析

1. 起点（エンドポイント・画面イベント・ジョブ等）と範囲を決める。依頼から特定できなければ候補を示して確認する。
2. `references/analysis-guide.md` を読み、その手順で起点から深さ優先に追跡する。
   - メソッドごとに全体を読み、呼び出し・分岐・繰り返し・例外・return・状態変更・DB/外部アクセス・非同期・トランザクション・ロックを拾う。
   - インターフェースの実装解決、DI、AOP、ORM の暗黙 SQL、イベントリスナー、例外ハンドラなど**コードに直接書かれていない処理**をチェックリストで確認する。
   - 追跡するメソッドがおおむね 10 以上なら、台帳 `<名前>.analysis.md` を出力先に作って進める（再開と網羅性確認のため）。
   - 入力が設計書・仕様書・会話だけの場合は、存在しないクラス名を作らず、資料の処理単位（節・画面・処理名）でライフラインを作る（analysis-guide 8 章）。
3. 図の分割単位（全体図＋詳細図）を決める。目安は 1 図あたりメッセージ 80 件・ライフライン 15〜20 本まで。

### Phase 2：処理モデルの構築

1. `references/model-schema.md`（項目の仕様）と `references/notation.md`（どの要素で表すか）を読む。
2. （任意）雛形を作る：`node "${CLAUDE_SKILL_DIR}/scripts/seqdiag.cjs" init <出力先>/<名前>.model.json`。実例をまねて直接書いてもよい。
3. ライフライン（メソッド単位・DB はテーブル単位）を定義し、図ごとに `steps` を**呼び出しの入れ子どおり**に書く。
   呼び出し先の処理は必ずその call の `steps` の中に置く（木構造がコールスタックになる）。
4. 矢印のラベルは日本語の処理概要（短く）、引数・戻り値・SQL・目的などの詳細は各項目に書く（詳細パネルに出る）。
5. `meta` に範囲・前提・未確認事項・集約/省略・対象外を書く。

完全な実例：`${CLAUDE_SKILL_DIR}/examples/order-system/`（Spring Boot の注文登録。ソース・モデル・生成 HTML 一式）。
モデルの書き方に迷ったら、まずこの例の該当箇所を見る。

### Phase 3：Mermaid 生成（検証）

```bash
node "${CLAUDE_SKILL_DIR}/scripts/seqdiag.cjs" validate <名前>.model.json
```

エラーは必ず直す。警告（根拠の行番号ずれ・記号不一致・到達不能ステップ・critical に lock が無い等）も読んで直す。
Mermaid テキストを確認・提出したい場合は `mmd <model.json> -o <dir>` で図ごとの `.mmd` を出力できる（HTML の「Mermaid」タブでも見られる）。

### Phase 4：HTML 生成

```bash
node "${CLAUDE_SKILL_DIR}/scripts/seqdiag.cjs" build <名前>.model.json -o <名前>.html
```

- Mermaid（11.17.2、MIT）とビューアを埋め込んだ単一 HTML（約 3.7MB）ができる。オフラインで開ける。
  ファイルを小さくしたい場合のみ `--mermaid cdn`（バージョン固定・SRI 付きで jsDelivr から読み込む）。
- 根拠ファイルの該当行の抜粋が HTML に埋め込まれ、詳細パネルで確認できる（`--no-embed-source` で無効化）。
- ビューアの機能：メッセージ／ライフライン／枠／注記のクリックで詳細表示、関連要素の強調、全図横断の検索と移動、
  ズーム・全体表示・幅合わせ、ドラッグでスクロール、スクロール時のライフライン名固定表示、全体図⇄詳細図の移動（パンくず・戻る）、
  詳細図のその場展開、group の折りたたみ、クラス単位への集約表示、引数名・条件式の表示切替、ライト／ダーク、
  SVG・PNG・Mermaid・モデル JSON の保存、表示の自己検証（検証タブ）。

### Phase 5：品質検証

`references/quality-checklist.md` に従う。最低限：

```bash
node "${CLAUDE_SKILL_DIR}/scripts/seqdiag.cjs" verify <名前>.html --screenshots <出力先>/shots --sizes 1600x900,1280x800 --full
```

- ヘッドレスブラウザで全図を描画し、対応付け（メッセージ・注記・枠・ライフラインの数と送受信者）、文字どうし・文字と連番の重なり、はみ出しを検査する。
- 出力されたスクリーンショット（`*@full.png` と `*@1600x900.png` など）を Read で見て、レイアウトと読みやすさを確認する。
  大きな図の細部は `--diagram <図ID> --select <ステップID>` でその箇所を選んだ画面を撮って確認する。
- ソースを開き直して、モデルの呼び出し・分岐・例外・DB 操作が正しいかを照合する（チェックリスト 2 章）。
- サブエージェントが使える場合は、構造（モデルとソースの一致）と表示（スクリーンショット・操作）の独立レビューを依頼する。
  使えない場合や、利用者の指示・実行環境の方針でサブエージェントの起動が制限されている場合（そちらを優先する）は起動せず、
  自分でチェックリストを再確認して「独立レビューは未実施（理由）」と報告する。

問題があればモデルを直して Phase 3 から繰り返す。

## 出力先

利用者の指定が無ければ、作業ディレクトリに `sequence-diagrams/<名前>/` を作り、次を置く：

- `<名前>.html` — 成果物（ビューア）
- `<名前>.model.json` — 処理モデル（再生成・修正用。HTML の「保存 → 処理モデル」でも取り出せる）
- `<名前>.analysis.md` — 解析台帳（作った場合）
- `shots/` — 検証用スクリーンショット（不要なら報告後に削除してよい）

`meta.sourceRoot` はモデルファイルから見たソースのルート（相対パス）にする。

## 報告

完了したら次を簡潔に伝える：HTML のパス、図の一覧（名前とメッセージ数）、検証結果（validate / verify / レビュー）、
推定・未確認の件数と利用者に確認してほしい事項、集約・省略・対象外にしたもの。

## 参照ファイル

| ファイル | 読むタイミング |
|---|---|
| `references/analysis-guide.md` | Phase 1。追跡手順、実装解決、フレームワークの暗黙処理、DB の特定、根拠の付け方 |
| `references/model-schema.md` | Phase 2。モデル JSON の全項目と生成規則 |
| `references/notation.md` | Phase 2。どの処理をどの要素で表すか（粒度・分岐・例外・非同期/並列・TX/ロック・分割） |
| `references/quality-checklist.md` | Phase 5。検証項目と報告内容 |
| `README.md` | 利用者向けの説明、設計方針、依存ライブラリとバージョン方針 |
| `examples/order-system/` | 実例（4 図・約 110 メッセージ。複数層・並列・非同期・例外・TX・排他ロック・詳細図） |

`evals/` はこのスキル自体の評価用テストケース（作業中に読む必要はない）。

## CLI

```
node seqdiag.cjs init     <out.model.json>
node seqdiag.cjs validate <model.json> [--source-root DIR] [--json]
node seqdiag.cjs mmd      <model.json> [-o DIR]
node seqdiag.cjs build    <model.json> [-o OUT.html] [--mermaid inline|cdn] [--source-root DIR] [--no-embed-source] [--force] [--verify]
node seqdiag.cjs verify   <OUT.html> [--screenshots DIR] [--sizes 1600x900,1280x800] [--full] [--diagram ID] [--select STEP_ID] [--theme light|dark] [--browser PATH] [--json]
```

- 終了コード：0 = 成功、1 = 検証エラー、2 = 引数・入力の誤り、3 = ブラウザが見つからない、4 = 表示検証が時間内に終わらない（`--budget` を増やす）。
- ブラウザの場所は自動検出（Chrome / Edge / Chromium / Playwright の Chromium）。見つからなければ `--browser` か環境変数 `SEQDIAG_BROWSER`。
- Node が無い場合：`python "${CLAUDE_SKILL_DIR}/scripts/build_html.py" <model.json> -o <out.html>`（検証と根拠の照合は行われず、ビューアを開いたときにモデル検証が行われる）。

## うまくいかないとき

- `validate` の「呼び出し元を決定できません」：最上位の call に `from` が無い。図の `entry` か `from` を指定する。
- 「propagateTo が呼び出し階層に存在しません」：throw がある位置から見た呼び出し元の連鎖に、そのライフラインが無い。throw の位置（どの call の steps の中か）を見直す。
- 「記号不一致」：参照行に呼び出し先のメソッド名が無い。行番号のずれを疑い、ソースを読み直す。継承メソッドなどで本当に名前が無い場合だけ ref に `symbol` を付ける。
- 図が横に長すぎる：詳細図への分割、`group` の折りたたみ、矢印ラベルの短縮。閲覧時は「表示設定 → クラス単位に集約」も使える。
- 文字の重なりが報告された：該当するラベル・分岐条件を短くする（詳細は purpose / detail へ移す）。
