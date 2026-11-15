# 台帳（TOON）のスキーマ

このファイルは `python -X utf8 scripts/ledger.py schema --markdown` で生成する。手で直さない。

## 目次

- progress.toon（進み具合（再開の起点））：stages
- scope.toon（範囲と前提）：in_scope、out_of_scope
- sources.toon（情報源の台帳）：sources
- current.toon（現状の調査（既存の改修のとき））：investigations、entrypoints、behaviors、impacts
- needs.toon（要求）：stakeholders、scenes、needs、frame、current_links
- requirements.toon（要件）：requirements、need_links、frame
- quality.toon（品質の観点の台帳（quality.py が作る））：viewpoints、checks
- specs.toon（仕様）：paths、properties、path_properties、specs、acceptance、machines、states、events、transitions、decision_tables、conditions、rules、crud、errors
- design.toon（経路の設計）：steps、matrix
- impact.toon（影響範囲（変更する箇所からの逆引き））：changes、searches、hits、cochanges
- tasks.toon（タスク（1タスク＝1コミット））：tasks、task_specs
- reviews.toon（検証の記録）：rounds、reviewers、findings、desk_checks、coverage
- decisions.toon（確認事項と決定）：questions
- reconcile.toon（道具の成果物との突き合わせ（任意。道具を使った後））：artifacts、task_map、requirement_map

## progress.toon（進み具合（再開の起点））

| キー | 種類 | 説明 |
|-|-|-|
| skill | 文字列（空にできない） | スキル名 |
| topic | 文字列（空にできない） | 調査の題目 |
| status | 列挙：in_progress / provisional / complete | 全体の状態 |
| current_stage | 列挙：prepare / current / needs / requirements / quality / specs / design / impact / tasks / verify / output | 今の段階 |
| updated | 文字列（空にできない） | 最終更新日時 |
| next | 文字列（空でよい） | 次にやること（初めて読む人が続けられる具体さで） |

### stages（段階ごとの状態）

| 列 | 種類 | 説明 |
|-|-|-|
| key | 列挙：prepare / current / needs / requirements / quality / specs / design / impact / tasks / verify / output | 段階 |
| name | 文字列（空にできない） | 段階の名前 |
| status | 列挙：pending / in_progress / done / skipped | 状態 |
| note | 文字列（空でよい） | メモ（skipped は理由必須） |

## scope.toon（範囲と前提）

| キー | 種類 | 説明 |
|-|-|-|
| topic | 文字列（空にできない） | 題目 |
| request | 文字列（空にできない） | 依頼の原文（改変しない） |
| kind | 列挙：new / change / mixed | 新規か既存の改修か |
| repo_root | 文字列（空にできない） | 対象リポジトリの絶対パス |
| git_commit | 文字列（空でよい） | 調べた時点のコミット |
| git_dirty | true/false | 未コミットの変更があったか |
| output_dir | 文字列（空にできない） | 台帳の置き場所 |
| created | 文字列（空にできない） | 作成日 |
| commit_format | 文字列（空でよい） | コミットメッセージの形（例: feat(book): {token} {content}） |
| commit_format_source | 文字列（空でよい） | コミットメッセージの形の出所（設定・履歴・利用者の指示） |

### in_scope（範囲に入れるもの）

| 列 | 種類 | 説明 |
|-|-|-|
| item | 文字列（空にできない） | 対象 |
| reason | 文字列（空でよい） | 理由 |

### out_of_scope（範囲に入れないもの）

| 列 | 種類 | 説明 |
|-|-|-|
| item | 文字列（空にできない） | 対象 |
| reason | 文字列（空にできない） | 理由 |

## sources.toon（情報源の台帳）

### sources（調べた情報源）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（SRC001） |
| kind | 列挙：code / test / config / schema / doc / conversation / ticket / log / other | 種類 |
| path | 文字列（空にできない） | 場所 |
| version | 文字列（空でよい） | 版・コミット |
| reliability | 列挙：fact / unreliable_doc / claim / other | 信頼の扱い（doc は保守されていない前提で unreliable_doc） |
| note | 文字列（空でよい） | メモ |

## current.toon（現状の調査（既存の改修のとき））

### investigations（調査台帳（何をどこまで調べたか））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（INV001） |
| area | 文字列（空にできない） | 調べた範囲（入口、呼び出し元、共有データなど） |
| method | 列挙：static / run / test / history | 方法 |
| status | 列挙：done / partial / not_done / out_of_scope | 状態 |
| boundary_reason | 文字列（空でよい） | 調査を止めた境界と理由（partial/not_done/out_of_scope は必須） |
| note | 文字列（空でよい） | メモ |

### entrypoints（入口（画面、API、一括処理、CSV、イベントなど））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（E001） |
| kind | 列挙：screen / api / batch / csv / event / cli / admin / external / other | 種類 |
| name | 文字列（空にできない） | 名前 |
| ev_path | 根拠のパス（リポジトリからの相対パス／conversation／doc:相対パス／none） | 根拠のファイル（リポジトリからの相対パス） |
| ev_line | 根拠の行（整数、なければ 0） | 根拠の行 |
| ev_quote | 根拠の文字列（その行の前後3行にある文字列をそのまま） | 根拠の行にある文字列（そのまま） |

### behaviors（現行の仕様（観察した振る舞い））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（C001） |
| entry | 参照（1つの ID）（entrypoints）、空でよい | 入口 |
| statement | 文字列（空にできない） | 振る舞い |
| ev_path | 根拠のパス（リポジトリからの相対パス／conversation／doc:相対パス／none） | 根拠のファイル |
| ev_line | 根拠の行（整数、なければ 0） | 根拠の行 |
| ev_quote | 根拠の文字列（その行の前後3行にある文字列をそのまま） | 根拠の文字列 |
| confidence | 列挙：fact / claim / hypothesis / decided / unconfirmed | 確からしさ |
| purpose | 文字列（空でよい） | 誰の何を守るための振る舞いか（分かる範囲） |
| treatment | 列挙：keep / change / remove / unconfirmed | 処遇 |
| reason | 文字列（空でよい） | 処遇の理由 |

### impacts（影響先）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（I001） |
| target | 文字列（空にできない） | 影響先 |
| relation | 列挙：direct / caller / callee / downstream / shared_data / shared_component / indirect | 関係 |
| ev_path | 根拠のパス（リポジトリからの相対パス／conversation／doc:相対パス／none） | 根拠のファイル |
| ev_line | 根拠の行（整数、なければ 0） | 根拠の行 |
| ev_quote | 根拠の文字列（その行の前後3行にある文字列をそのまま） | 根拠の文字列 |
| condition | 文字列（空でよい） | 影響が生じる条件 |
| classification | 列挙：must_change / keep_regression / no_impact / unconfirmed | 分類 |
| reason | 文字列（空にできない） | 分類の理由（no_impact は根拠必須） |
| specs | 参照（ID を空白区切り）（specs）、空でよい | 対応する仕様（影響範囲の段階で必須。must_change は実装が要る仕様、keep_regression は回帰を確かめる仕様） |

## needs.toon（要求）

### stakeholders（関係者）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（SH01） |
| name | 文字列（空にできない） | 名前 |
| kind | 列挙：direct_user / admin / operator / support / auditor / external_system / data_owner / developer / other | 種類 |
| note | 文字列（空でよい） | メモ |

### scenes（場面）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（SC01） |
| name | 文字列（空にできない） | 名前 |
| note | 文字列（空でよい） | メモ |

### needs（要求）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（N001） |
| who | 参照（1つの ID）（stakeholders） | 誰が |
| scene | 参照（1つの ID）（scenes） | どの場面で |
| want | 文字列（空にできない） | 何をしたいか |
| why | 文字列（空にできない） | なぜ |
| obstacle | 文字列（空でよい） | 何が妨げか |
| origin | 列挙：request / stakeholder / current / quality / inferred | 由来 |
| confidence | 列挙：fact / claim / hypothesis / decided / unconfirmed | 確からしさ |
| adoption | 列挙：adopted / out_of_scope / pending | 扱い |
| reason | 文字列（空でよい） | 扱いの理由 |

### frame（関係者×場面の表（全組を埋める））

| 列 | 種類 | 説明 |
|-|-|-|
| stakeholder | 参照（1つの ID）（stakeholders） | 関係者 |
| scene | 参照（1つの ID）（scenes） | 場面 |
| result | 列挙：need / none / out_of_scope / unconfirmed | 結果 |
| needs | 参照（ID を空白区切り）（needs）、空でよい | 要求 |
| reason | 文字列（空でよい） | none/out_of_scope の理由 |

### current_links（現行の仕様から要求へ）

| 列 | 種類 | 説明 |
|-|-|-|
| behavior | 参照（1つの ID）（behaviors） | 現行の仕様 |
| needs | 参照（ID を空白区切り）（needs）、空でよい | 要求 |

## requirements.toon（要件）

### requirements（要件）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（R001） |
| kind | 列挙：function / data / quality / operation / migration / constraint | 種類 |
| statement | 文字列（空にできない） | 満たすべき条件 |
| reason | 文字列（空にできない） | 理由 |
| acceptance | 文字列（空にできない） | 受入条件 |
| status | 列挙：adopted / proposed / deferred / rejected | 採否 |
| confidence | 列挙：fact / claim / hypothesis / decided / unconfirmed | 確からしさ |

### need_links（要求と要件の対応（多対多））

| 列 | 種類 | 説明 |
|-|-|-|
| need | 参照（1つの ID）（needs） | 要求 |
| requirement | 参照（1つの ID）（requirements） | 要件 |

### frame（要求×観点の表（採用した要求ごとに6観点））

| 列 | 種類 | 説明 |
|-|-|-|
| need | 参照（1つの ID）（needs） | 要求 |
| viewpoint | 列挙：function / data / quality / operation / migration / constraint | 観点 |
| result | 列挙：requirement / not_needed / out_of_scope / unconfirmed | 結果 |
| requirements | 参照（ID を空白区切り）（requirements）、空でよい | 要件 |
| reason | 文字列（空でよい） | not_needed/out_of_scope の理由 |

## quality.toon（品質の観点の台帳（quality.py が作る））

| キー | 種類 | 説明 |
|-|-|-|
| catalog_version | 文字列（空にできない） | カタログの版 |

### viewpoints（605観点の一次選別）

| 列 | 種類 | 説明 |
|-|-|-|
| id | 文字列（空にできない） | 観点ID（Q01.01.001） |
| judgement | 列挙：unreviewed / applicable / not_applicable / unknown / out_of_scope | 判定 |
| requirements | 参照（ID を空白区切り）（requirements）、空でよい | 反映した要件 |
| reason | 文字列（空でよい） | 理由 |

### checks（適用あり・不明の観点の確認項目）

| 列 | 種類 | 説明 |
|-|-|-|
| id | 文字列（空にできない） | 確認項目ID（Q01.01.001.01） |
| viewpoint | 文字列（空にできない） | 観点ID |
| judgement | 列挙：reflected / not_needed / unknown / out_of_scope | 判定 |
| requirements | 参照（ID を空白区切り）（requirements）、空でよい | 反映した要件 |
| reason | 文字列（空でよい） | 理由 |

## specs.toon（仕様）

### paths（経路（利用者の1つの操作の始まりから終わりまで））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（P001） |
| name | 文字列（空にできない） | 名前 |
| trigger | 文字列（空にできない） | 始まり |
| end | 文字列（空にできない） | 終わり（戻りの表示まで） |
| kind | 列挙：new / change | 新しい経路か、既存の経路の変更か |
| requirements | 参照（ID を空白区切り）（requirements）、空でよい | 実現する要件 |

### properties（プロパティの定義）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（PR001） |
| name | 文字列（空にできない） | 文言に使う名前（既存コードの表示名、なければ識別子） |
| code_name | 文字列（空でよい） | コード上の識別子 |
| origin | 列挙：existing_code / new | 既存のコードにあるか |
| type | 文字列（空にできない） | 型 |
| required | 列挙：yes / no / conditional | 必須か |
| constraint | 文字列（空にできない） | 桁・範囲・形式（なければ「なし」と理由） |
| default_value | 文字列（空でよい） | 初期値 |
| display | 文字列（空でよい） | 表示の仕方 |
| existing_data | 文字列（空でよい） | 既存データでの値・移行の扱い |
| ev_path | 根拠のパス（リポジトリからの相対パス／conversation／doc:相対パス／none） | 根拠のファイル（existing_code は必須） |
| ev_line | 根拠の行（整数、なければ 0） | 根拠の行 |
| ev_quote | 根拠の文字列（その行の前後3行にある文字列をそのまま） | 根拠の文字列 |
| confidence | 列挙：fact / claim / hypothesis / decided / unconfirmed | 確からしさ |

### path_properties（経路が運ぶプロパティ）

| 列 | 種類 | 説明 |
|-|-|-|
| path | 参照（1つの ID）（paths） | 経路 |
| property | 参照（1つの ID）（properties） | プロパティ |
| first | true/false | 経路の最初のプロパティか（経路ごとに1つ） |
| reason | 文字列（空でよい） | 最初のプロパティに選んだ理由 |

### specs（仕様（外から観察できる振る舞い。親の要件は1つ））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（S001） |
| requirement | 参照（1つの ID）（requirements） | 親の要件 |
| path | 参照（1つの ID）（paths）、空でよい | 経路 |
| property | 参照（1つの ID）（properties）、空でよい | プロパティ |
| kind | 列挙：behavior / validation / error / state / permission / data / display / crosscut / migration / operation | 種類 |
| statement | 文字列（空にできない） | 振る舞い |
| reason | 文字列（空にできない） | 親の要件のどの条件のためか |
| implementation | 列挙：needed / already_satisfied | 実装が要るか |
| confidence | 列挙：fact / claim / hypothesis / decided / unconfirmed | 確からしさ |

### acceptance（受入ケース）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（A001） |
| spec | 参照（1つの ID）（specs） | 仕様 |
| given | 文字列（空にできない） | 前提 |
| when | 文字列（空にできない） | 操作 |
| then | 文字列（空にできない） | 結果（データ・応答・表示） |

### machines（状態遷移の対象）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（SM01） |
| entity | 文字列（空にできない） | 対象 |
| name | 文字列（空にできない） | 名前 |

### states（状態）

| 列 | 種類 | 説明 |
|-|-|-|
| machine | 参照（1つの ID）（machines） | 対象 |
| state | 文字列（空にできない） | 状態 |

### events（出来事）

| 列 | 種類 | 説明 |
|-|-|-|
| machine | 参照（1つの ID）（machines） | 対象 |
| event | 文字列（空にできない） | 出来事 |

### transitions（状態×出来事の表（全組を埋める））

| 列 | 種類 | 説明 |
|-|-|-|
| machine | 参照（1つの ID）（machines） | 対象 |
| state | 文字列（空にできない） | 状態 |
| event | 文字列（空にできない） | 出来事 |
| result | 列挙：transition / reject / ignore / not_applicable / unconfirmed | 結果 |
| to_state | 文字列（空でよい） | 遷移先（transition は必須） |
| specs | 参照（ID を空白区切り）（specs）、空でよい | 仕様 |
| reason | 文字列（空でよい） | ignore/not_applicable の理由 |

### decision_tables（決定表）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（DT01） |
| name | 文字列（空にできない） | 名前 |
| path | 参照（1つの ID）（paths）、空でよい | 経路 |

### conditions（決定表の条件と取りうる値（値は空白区切り））

| 列 | 種類 | 説明 |
|-|-|-|
| table | 参照（1つの ID）（decision_tables） | 決定表 |
| condition | 文字列（空にできない） | 条件名（空白なし） |
| values | 文字列（空にできない） | 値（空白区切り、各値に空白なし） |

### rules（決定表の規則（全組合せを覆い、重ならない））

| 列 | 種類 | 説明 |
|-|-|-|
| table | 参照（1つの ID）（decision_tables） | 決定表 |
| when | 文字列（空にできない） | 条件（cond=値 を空白区切り、値 * は任意） |
| outcome | 文字列（空にできない） | 結果 |
| specs | 参照（ID を空白区切り）（specs）、空でよい | 仕様 |

### crud（CRUD の表（Y/N/?））

| 列 | 種類 | 説明 |
|-|-|-|
| entity | 文字列（空にできない） | エンティティ |
| path | 参照（1つの ID）（paths） | 経路 |
| create | 列挙：Y / N / ? | 作る |
| read | 列挙：Y / N / ? | 読む |
| update | 列挙：Y / N / ? | 更新 |
| delete | 列挙：Y / N / ? | 削除 |
| reason | 文字列（空でよい） | メモ |

### errors（エラーの表）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（ER001） |
| path | 参照（1つの ID）（paths） | 経路 |
| failure | 文字列（空にできない） | 失敗の種類 |
| detect_step | 参照（1つの ID）（steps） | 検出する段 |
| response | 文字列（空にできない） | 返す内容 |
| display | 文字列（空にできない） | 画面の表示（表示しないなら理由） |
| record | 文字列（空にできない） | 記録（ログ等。しないなら理由） |
| specs | 参照（ID を空白区切り）（specs）、空でよい | 仕様 |

## design.toon（経路の設計）

### steps（経路の段（コードの層。戻りの段まで））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（ST001） |
| path | 参照（1つの ID）（paths） | 経路 |
| order | 整数 | 経路の中の順番（1から） |
| name | 文字列（空にできない） | 段の名前（例: バックエンド（コントローラー）） |
| responsibility | 文字列（空にできない） | 責務 |
| origin | 列挙：existing / changed / new | 既存か |
| ev_path | 根拠のパス（リポジトリからの相対パス／conversation／doc:相対パス／none） | 根拠のファイル（existing/changed は必須） |
| ev_line | 根拠の行（整数、なければ 0） | 根拠の行 |
| ev_quote | 根拠の文字列（その行の前後3行にある文字列をそのまま） | 根拠の文字列 |

### matrix（段×プロパティの表（経路ごとに全組を埋める））

| 列 | 種類 | 説明 |
|-|-|-|
| path | 参照（1つの ID）（paths） | 経路 |
| property | 参照（1つの ID）（properties） | プロパティ |
| step | 参照（1つの ID）（steps） | 段 |
| action | 列挙：input / send / receive / validate / convert / save / load / return / display / other / none | その段がそのプロパティに行うこと |
| result | 列挙：change / existing_ok / not_handled / unconfirmed | 要る作業 |
| specs | 参照（ID を空白区切り）（specs）、空でよい | 関係する仕様 |
| reason | 文字列（空でよい） | not_handled/existing_ok の理由 |

## impact.toon（影響範囲（変更する箇所からの逆引き））

### changes（変更する箇所（既存のコードは根拠必須））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（CH001） |
| kind | 列挙：file / function / class / api / table / column / field / message / config / screen / event / other | 種類 |
| name | 文字列（空にできない） | 名前（識別子、テーブル.列、API のパスなど） |
| origin | 列挙：existing / new | 既存か |
| ev_path | 根拠のパス（リポジトリからの相対パス／conversation／doc:相対パス／none） | 根拠のファイル（existing は必須） |
| ev_line | 根拠の行（整数、なければ 0） | 根拠の行 |
| ev_quote | 根拠の文字列（その行の前後3行にある文字列をそのまま） | 根拠の文字列 |
| note | 文字列（空でよい） | メモ |

### searches（逆引きの検索（impact.py search が書く））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（SR001） |
| change | 参照（1つの ID）（changes） | 変更する箇所 |
| term | 文字列（空にできない） | 検索した文字列 |
| scope | 文字列（空にできない） | 範囲 |
| tool | 文字列（空にできない） | 道具 |
| hit_count | 整数 | 当たりの数 |
| status | 列挙：done / not_done | 状態 |
| note | 文字列（空でよい） | メモ（not_done は理由必須） |

### hits（検索の当たり（すべてを判断する））

| 列 | 種類 | 説明 |
|-|-|-|
| search | 参照（1つの ID）（searches） | 検索 |
| path | 文字列（空にできない） | ファイル |
| line | 整数 | 行 |
| text | 文字列（空でよい） | その行 |
| disposition | 列挙：unclassified / impact / same_change / test / definition / irrelevant | 判断 |
| impact | 参照（1つの ID）（impacts）、空でよい | 影響先（impact のとき） |
| reason | 文字列（空でよい） | 理由（irrelevant は必須） |

### cochanges（一緒に変更されてきたファイル（impact.py cochange が書く））

| 列 | 種類 | 説明 |
|-|-|-|
| file | 文字列（空にできない） | 変更するファイル |
| partner | 文字列（空にできない） | 一緒に変更されてきたファイル |
| count | 整数 | 一緒に変更された回数 |
| percent | 整数 | 割合（%） |
| disposition | 列挙：unclassified / impact / checked_no_impact / same_change / irrelevant | 判断 |
| impact | 参照（1つの ID）（impacts）、空でよい | 影響先（impact のとき） |
| reason | 文字列（空でよい） | 理由（checked_no_impact と irrelevant は必須） |

## tasks.toon（タスク（1タスク＝1コミット））

### tasks（タスク）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（T001） |
| order | 整数 | 実装の順番 |
| token | 文字列（空にできない） | 文言（_プロパティ名_連番_） |
| unit | 列挙：responsibility / property / non_property | 概念単位 |
| path | 参照（1つの ID）（paths）、空でよい | 経路 |
| property | 参照（1つの ID）（properties）、空でよい | プロパティ |
| step | 参照（1つの ID）（steps）、空でよい | 段（responsibility のとき） |
| content | 文字列（空にできない） | 内容 |
| files | 文字列（空にできない） | 変更するファイル |
| tests | 文字列（空にできない） | 同じコミットに入れるテスト（ないなら理由） |
| message | 文字列（空にできない） | コミットメッセージ（文言を含む） |

### task_specs（タスクと仕様の対応（多対多））

| 列 | 種類 | 説明 |
|-|-|-|
| task | 参照（1つの ID）（tasks） | タスク |
| spec | 参照（1つの ID）（specs） | 仕様 |
| content | 文字列（空にできない） | その仕様についてそのタスクで行うこと |

## reviews.toon（検証の記録）

### rounds（検証の回）

| 列 | 種類 | 説明 |
|-|-|-|
| round | 整数 | 回 |
| kind | 列挙：machine / independent / desk / reverify | 種類 |
| date | 文字列（空にできない） | 日時 |
| note | 文字列（空でよい） | メモ |

### reviewers（検証したエージェント）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（RV01） |
| round | 整数 | 回 |
| role | 列挙：builder / tester / operator / end_user / adversary / evidence_auditor / trace_auditor / impact_auditor / other | 役割 |
| scope | 文字列（空にできない） | 見た範囲 |
| status | 列挙：done / failed / skipped | 状態 |
| output | 文字列（空でよい） | 結果のファイル |

### findings（指摘）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（FD001） |
| round | 整数 | 回 |
| reviewer | 文字列（空にできない） | 指摘した者（reviewers の ID、または main） |
| layer | 列挙：scope / current / need / requirement / quality / spec / design / impact / task / evidence | 層 |
| targets | 参照（ID を空白区切り）（台帳の任意の ID）、空でよい | 対象（台帳の ID） |
| kind | 列挙：omission / error / contradiction / ambiguity / unsupported / granularity / other | 種類 |
| severity | 列挙：critical / high / medium / low | 重さ |
| statement | 文字列（空にできない） | 指摘 |
| scenario | 文字列（空でよい） | 具体的な場面（入力と結果） |
| evidence | 文字列（空でよい） | 根拠 |
| status | 列挙：open / fixed / rejected / escalated | 状態 |
| resolution | 文字列（空でよい） | 対処（fixed/rejected/escalated は必須） |
| verified_by | 文字列（空でよい） | 直したことを確かめた reviewers の ID（fixed は必須） |

### desk_checks（机上実行（経路×場面））

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（DC001） |
| path | 参照（1つの ID）（paths） | 経路 |
| scenario | 列挙：normal / reject / boundary / existing_data / concurrent / partial_failure / permission / retry / other | 場面 |
| result | 列挙：determined / undetermined / not_applicable | 結果 |
| walk | 文字列（空にできない） | 段ごとにたどった結果（最終のデータ・応答・表示） |
| findings | 参照（ID を空白区切り）（findings）、空でよい | 指摘 |
| reason | 文字列（空でよい） | not_applicable の理由 |

### coverage（確かめた範囲と確かめていない範囲）

| 列 | 種類 | 説明 |
|-|-|-|
| area | 文字列（空にできない） | 領域 |
| checked | 文字列（空にできない） | 確かめたこと |
| not_checked | 文字列（空にできない） | 確かめていないこと（なければ「なし」） |

## decisions.toon（確認事項と決定）

### questions（利用者・依頼者に決めてもらうこと）

| 列 | 種類 | 説明 |
|-|-|-|
| id | ID（台帳全体で一意） | ID（Q001） |
| layer | 列挙：scope / current / need / requirement / quality / spec / design / impact / task / verify | 層 |
| question | 文字列（空にできない） | 問い |
| why | 文字列（空にできない） | 答えで何が変わるか |
| options | 文字列（空にできない） | 選択肢 |
| recommendation | 文字列（空にできない） | 推奨と理由 |
| answer | 文字列（空でよい） | 答え（利用者の言葉のまま） |
| answered_by | 列挙：user / requester / claude_provisional / none | 答えた人 |
| status | 列挙：open / answered / deferred / provisional | 状態 |
| targets | 参照（ID を空白区切り）（台帳の任意の ID）、空でよい | 関係する台帳の ID |

## reconcile.toon（道具の成果物との突き合わせ（任意。道具を使った後））　※任意

| キー | 種類 | 説明 |
|-|-|-|
| tool | 文字列（空にできない） | 道具（spec-kit、superpowers など） |

### artifacts（読んだ成果物）

| 列 | 種類 | 説明 |
|-|-|-|
| path | 文字列（空にできない） | 場所 |
| kind | 文字列（空にできない） | 種類 |
| note | 文字列（空でよい） | メモ |

### task_map（台帳のタスクと道具のタスク）

| 列 | 種類 | 説明 |
|-|-|-|
| ledger_task | 文字列（空でよい） | 台帳のタスク ID（extra は空） |
| tool_item | 文字列（空でよい） | 道具の項目（missing は空） |
| relation | 列挙：same / merged / split / missing / extra / changed | 関係 |
| note | 文字列（空でよい） | メモ |

### requirement_map（台帳の要件と道具の要件）

| 列 | 種類 | 説明 |
|-|-|-|
| ledger_requirement | 文字列（空でよい） | 台帳の要件 ID |
| tool_item | 文字列（空でよい） | 道具の項目 |
| relation | 列挙：same / merged / split / missing / extra / changed | 関係 |
| note | 文字列（空でよい） | メモ |

