# 段階ごとの手引き

SKILL.md の「進め方」の各段階で、何を読み、何をし、どの表を埋め、どこで止まるかを書く。
コマンドの `<台帳>` は台帳のフォルダー、`${CLAUDE_SKILL_DIR}` はこのスキルのフォルダーである。
各段階の終わりに `ledger.py validate <台帳> --gate <段階>` を通し、`ledger.py stage <台帳> <段階> done --next "…"` で進み具合を書く。
上の層に項目を足したら、その層から下の段階の関門を、もう一度すべて通す。

## 準備（prepare）

- 依頼の原文を、改変せずに `scope.toon` の request に書く。
- 新規（new）か、既存の改修（change）か、両方（mixed）かを決める。
  既存のリポジトリに新しい経路を足すときは mixed にする。
- `git rev-parse HEAD` と `git status --porcelain` を記録する（git_commit、git_dirty）。
- 範囲に入れるもの（in_scope）と入れないもの（out_of_scope、理由必須）を書く。
- コミットメッセージの規則を探し、commit_format と commit_format_source に書く（`references/granularity-rule.md` の「コミットメッセージ」）。
- 依頼の目的（誰の、何のため）がまったく読み取れないときだけ、最初に1問聞く（`references/questions-and-records.md`）。
  手段だけが書かれた依頼（「ボタンを無効化したい」など）は、守りたい目的を推測して仮置きし、要求の段階で確かめる。

## 現状の調査（current）

`references/methods/investigation.md` に従う。
新規のリポジトリでコードがまったくない場合を除き、新しい機能でも必ず行う。
新しい経路の段は、既存のコードの層（画面、API の呼び出し、コントローラー、サービス、リポジトリなど）から決めるためである。

- 調べた範囲ごとに調査台帳（investigations）を書く。
- 入口（entrypoints）、現行の仕様（behaviors）、影響先（impacts）を、コードの根拠付きで書く。
- 調べたファイルを `sources.toon` に書く（code・test・config・schema は reliability fact、文書は unreliable_doc）。
- 現行の仕様それぞれに処遇（keep／change／remove）を付ける。
  決められないものは unconfirmed にし、確認事項に回す。
- 大きなコードベースでは、入口の列挙や逆引きを、範囲を分けてサブエージェントに調べさせてよい。
  サブエージェントには、調べる範囲、記録の形（ファイル・行・引用）、出力のファイルを渡し、結果は本体が根拠の行を開いて確かめてから台帳に入れる。

## 要求（needs）

- 関係者（stakeholders）を、直接の利用者だけでなく、承認・管理・運用・サポート・監査をする人、外部システム、データの持ち主まで挙げる（`references/methods/analysis-methods.md` の M01）。
- 場面（scenes）を、通常に加えて、初回、例外、障害の最中と後、月末・年度末などの時期、移行、代理・不在のような、対象の実態から選ぶ（M03）。
- 関係者×場面の表（frame）の全組を埋める。
  欄の結果は need・none・out_of_scope・unconfirmed のどれかで、none と out_of_scope には理由を書く。
- 要求（needs）は、誰が・どの場面で・何をしたいか・なぜ・何が妨げか、の形で書く。
  依頼の分解、関係者×場面の表、現行の仕様の処遇（keep の振る舞いは暗黙の要求になる）、当たり前の品質（`references/methods/implicit-quality.md`）から出す。
- 解決策の形で書かれた要求は、守りたい目的に戻す。
- 現行の仕様を要求につなぐ（current_links）。
- 関門：要求の一覧と範囲を利用者に見せて承認を得る（`references/questions-and-records.md` の「段階の承認」）。
  承認の前に `validate --gate needs` を通す。

## 要件（requirements）

- 採用した要求ごとに、要求×観点の表（frame）の6観点（機能、データ、品質、運用、移行、制約）を埋める。
- 要件は、満たすべき条件・理由・受入条件（検証できる形）で書く。
  「適切に処理する」「速く」のような、測れない言葉で終わらせない。
  数値は根拠なしに作らず、決まっていなければ確認事項にする。
- 目的から成功条件と必要な能力に分解し（M02）、シナリオ（M03）、データの一生（M06）、インターフェースの契約（M07）からも要件を探す。
- 要件と要求を need_links でつなぐ（多対多）。
  親のない要件が出たら、隠れていた要求なので、要求の段階に戻って足す。
- 横断する観点の組合せ（`references/methods/cross-checks.md`）で、要件どうしの衝突を探す。
  衝突は、どちらかを黙って優先せず、確認事項にする。
- 関門：要件の一覧を利用者に見せて承認を得る。
  承認の前に `validate --gate requirements` を通す。

## 品質の観点（quality）

同梱のカタログ（9品質特性・40副特性・605観点・1,833確認項目）で、当たり前の品質の要件の漏れを探す。

1. `python -X utf8 "${CLAUDE_SKILL_DIR}/scripts/quality.py" init <台帳>` で、605観点を unreviewed の状態で作る。
2. `references/quality/viewpoints.md`（605観点の一覧）を最後の Q09.05.009 まで全部読む。
   1回では読み切れないので、2回以上に分けて読む。
3. 副特性ごとに、観点を applicable（適用あり）・not_applicable（適用なし）・unknown（不明）・out_of_scope（対象外）に分け、小さな TOON ファイル（`viewpoints[N]{id,judgement,requirements,reason}:`）に書いて `quality.py set <台帳> --file <ファイル>` で反映する。
   not_applicable と out_of_scope には、この案件でそう言える理由を、観点ごとに書く。
   理由は、その観点が確かめる内容（観点の文言）を受けて、この案件でそれが起きない、または扱わない根拠を書く（例：「計算を含まない」ではなく「金額は入力値をそのまま保存し、税込み計算や端数処理をしないので、計算結果の丸め誤差は起きない」）。
   同じ文の理由を複数の観点に使い回すと（観点の文言や ID を前に付けただけのものを含む）、`validate --gate quality` がエラーにする。副特性ごとにまとめて判断してよいが、理由は1件ずつ書く。
   判断の根拠はコードである。依頼文や台帳の説明だけで判断しない。理由には、確かめたコードのファイルか、コードに無いことを確かめた検索（例：「`git grep -n tax` で税の計算は無い」）を書く。
   **判定をサブエージェントに分けるとき**は、指示にリポジトリの絶対パスと台帳の絶対パスを書き、「判定の前に、関係するコードを開いて読む。読んだファイルと検索を理由に書く」を必ず入れる。
   返ってきた判定は、本体が副特性ごとに最低2件（applicable と not_applicable があれば両方から）を抜き取り、理由のファイルや検索を自分で確かめる。
   抜き取りで誤りが1件でも見つかった副特性は、本体がその副特性の全件を判定し直す。
   抜き取った観点と結果は、`reviews.toon` の coverage に「品質の観点の抜き取り」として書く。
4. applicable と unknown の観点は、`quality.py show --ids <観点ID…>` で確認項目を読み、項目ごとに reflected（要件に反映した）・not_needed・out_of_scope・unknown を判定して、`checks[N]{id,judgement,requirements,reason}:` で反映する。
   要件がまだないものは、要件の段階に戻って要件を足し、reflected にする。
   unknown は確認事項にする。
5. `quality.py summary <台帳>` で残りを確かめ、`validate --gate quality` を通す。

カタログは要求候補を見つける手がかりであり、項目を一律に必須の要件にしない。
技術の例や数値をそのまま採らず、案件の根拠で判断する。

## 仕様（specs）

- 経路（paths）：採用した要件を実現する、利用者の1つの操作の始まりから終わり（戻りの表示まで）を挙げる。
  新しい経路か（new）、既存の経路の変更か（change）を決める。
- プロパティ（properties）：経路が運ぶ項目を定義する。
  型、必須、桁・範囲・形式、初期値、表示、既存データでの値を書く。
  既存のプロパティは、コードの識別子（code_name）と根拠の行を書く。
  名前は `references/granularity-rule.md` の「名前の出所」に従う。
- 経路とプロパティ（path_properties）：経路ごとに運ぶプロパティを挙げ、最初のプロパティを1つ決めて理由を書く。
- 仕様（specs）：外から観察できる振る舞いを書く。
  親の要件は必ず1つにし、理由の欄に「親の要件のどの条件のためか」を書く。
  仕様にだけ独立した目的・義務・保証が現れたら、要件の段階に戻って要件を足す。
  既存のままで満たす仕様は implementation を already_satisfied にする。
- 受入ケース（acceptance）：仕様ごとに1つ以上、前提・操作・結果（最終のデータ・応答・表示）を書く。
- 状態遷移（machines・states・events・transitions）：状態を持つ対象があれば、全状態×全出来事の欄を埋める（M04）。
- 決定表（decision_tables・conditions・rules）：条件の組合せで結果が変わる判定は、条件と値を挙げ、規則で全組合せを覆う（M05）。
  `validate` が、どの規則にも当たらない組合せと、結果の違う規則が重なる組合せを見つける。
- CRUD（crud）：エンティティ×経路で、作る・読む・更新・削除を Y／N で埋める（M06）。
- エラー（errors）：経路ごとに、失敗の種類（入力の誤り、存在しない、重複、権限、競合、外部の失敗、タイムアウトなど）と、検出する段・返す内容・画面の表示・記録を書く（M08）。
  表示しない、記録しないなら、その理由を書く。
- 関門：業務のルール（拒否するか、上書きするか、上限など）を確認事項にして利用者に決めてもらい、仕様の一覧の承認を得る。
  承認の前に `validate --gate specs` を通す。

## 経路の設計（design）

- 段（steps）：経路の始まりから終わりまで、責務ごとに段を並べる（順番は1から連番）。
  戻りの段（サービスが応答を作る、コントローラーが応答を返す、画面が結果を受け取って表示する）と、その後に続く処理（一覧の更新、通知など）も段にする。
  段の名前と分け方は、このリポジトリにある層から取り、一般的な構成から推測しない。
  既存の段（existing、changed）は、コードの根拠を書く。
- 段×プロパティの表（matrix）：経路ごとに、運ぶプロパティ×段のすべての欄を埋める。
  欄には、その段がそのプロパティに行うこと（action）と、要る作業（change／existing_ok／not_handled）と、関係する仕様（specs）を書く。
  existing_ok と not_handled には理由を書く。
- change の欄に、関係する仕様が書けないときは、仕様の漏れである。
  仕様の段階に戻って仕様を足す。
- 仕様が、どの欄にも現れないときは、どの段で実現するかが決まっていない。
  欄に書き足すか、仕様の誤りを直す。
- 終わりに `validate --gate design` を通す。

## 影響範囲（impact）

経路の設計で変更する箇所が決まったので、変更する箇所から逆にたどって影響範囲を確定する。
手順は `references/methods/investigation.md` の「影響範囲の確定」にある。
要点は次のとおりである。

1. 変更する箇所を `impact.toon` の changes に一覧にする（既存のものは根拠付き）。
2. 既存の変更する箇所ごとに `impact.py search … --variants` で逆引きし、当たりをすべて判断する。
3. `impact.py cochange` で一緒に変更されてきたファイルを挙げ、すべて判断する。
4. 調査台帳に「リポジトリの外の利用者」の行を書く（他のサービス、DB を直接読む集計・帳票、外部連携、手作業）。
5. 影響先を current.toon の impacts に足し、要変更は実装が要る仕様に、回帰確認は回帰を確かめる仕様につなぐ。
   仕様が足りなければ仕様の段階に戻り、経路の設計を導き直してから、ここに戻る。
6. `validate --gate impact` を通す。

既存のコードに触れない、まったく新しいリポジトリでは、この段階は何も記録せずに検査を通る。

## タスク（tasks）

1. `python -X utf8 "${CLAUDE_SKILL_DIR}/scripts/ledger.py" derive-tasks <台帳>` で、規則が求めるタスクの行と、タスクと仕様の対応（task_specs）を足す。
   既にある行と文は残り、文言の連番は実装の順に振り直される。
2. 空の欄を埋める：内容（content）、変更するファイル（files）、同じコミットに入れるテスト（tests）、コミットメッセージ（message。commit_format に沿い、文言を含める）、対応ごとの内容（task_specs の content）。
3. プロパティを運ばないタスク（設定、共通部品など）が要るときは、non_property の行を足し、仕様につなぐ。
4. タスクごとに `references/methods/oversight-viewpoints.md` の観点で、そのコミットで扱いが決まっていないことがないかを確かめる。
   見つけた漏れはタスクに黙って足さず、仕様や要件の段階に戻って足してから、もう一度 derive-tasks する。
5. 最初のプロパティの選び方と、規則の解釈（`references/granularity-rule.md`）を、確認事項として利用者に見せる。
6. `validate --gate tasks` を通す。

## 検証（verify）

`references/verification-protocol.md` に従い、8つの役割の独立した検証、机上実行、直した後の再検証を行う。
`validate --final` のうち、検証の記録に関わるエラーがなくなるまで続ける。

## 出力（output）

1. 確認事項に未回答（open）が残っていないことを確かめる。
   利用者が答えられない事項は deferred にし、関係する項目の確からしさを unconfirmed にして targets に入れる。
2. 未確認・保留が残るなら progress の status を provisional、残らないなら complete にする。
   `ledger.py stage <台帳> output done` で出力の段階を終える。
3. `ledger.py validate <台帳> --final --write` を通す（validation.toon ができる）。
4. `render_html.py render <台帳>` で report.html を作り、`render_html.py check <台帳>` で一致を確かめる。
5. この後で台帳を1文字でも直したら、3と4をやり直す。
   HTML は手で直さない。

## 道具の成果物との突き合わせ（任意。道具を使った後）

spec-kit、superpowers、mattpocock-skills などの道具が、この台帳を入力にして仕様・計画・タスクを作った後に、このスキルをもう一度呼ばれたら行う。

1. 道具の成果物（spec-kit の spec.md・tasks.md、superpowers の設計書・計画書、mattpocock-skills の仕様・チケットなど）を読む。
   道具のファイルは読むだけで、書き換えない。
2. `reconcile.toon` を作り、artifacts に読んだ成果物を、task_map に台帳のタスクと道具の項目の対応を、requirement_map に台帳の要件と道具の要件の対応を書く。
   関係は same・merged（まとめられた）・split（分けられた）・missing（道具で落ちた）・extra（道具だけにある）・changed（中身が変わった）で書く。
3. missing、merged（粒度の違反）、extra、changed を利用者に見せ、直し先（道具の文書に戻す、台帳に足す、採らない）を決めてもらう。
4. 出力の段階の手順で、検査と HTML を作り直す。
