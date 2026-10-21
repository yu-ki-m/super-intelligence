---
name: business-model-to-system-spec
description: >
  何もシステムがない状態から、AS-ISを多面的かつ証拠ベースで徹底分析し、
  複数のTO-BE業務モデルを設計・比較・反証したうえで、
  最終的に実装可能なシステム仕様へ落とし込むClaude Code向けスキル。
  数時間規模の調査・整理を前提とし、短時間で結論を出さない。
---

# Business Model to System Spec

## 目的

このスキルは、最初から機能要件を作るためのものではない。

最初に現状の業務・組織・情報・判断・責任・顧客・コスト・制約・例外を徹底的に調査し、
次に複数のTO-BEモデルを作り、経営価値・顧客価値・現場負荷・実現可能性・経済性・リスクを比較する。

その後に初めて、必要なシステム能力を定義し、
データモデル、状態遷移、UI、API、イベント、権限、監査、非機能要件、移行要件へ落とす。

---





# Deep Interrogation Policy — 一見具体的な回答も未分解なら通過させない

このスキルでいう「曖昧」とは、
「いい感じに」「普通で」「任せる」といった露骨に曖昧な表現だけを指さない。

ユーザー本人にとって十分具体的でも、
第三者が業務実態を再現・監査・設計できない情報は、すべて未確定として扱う。

## 曖昧さの判定基準

次のような回答は、一見具体的でも未確定である。

### 例1

```text
申請はリーダーが確認し、問題なければ承認する。
```

これはまだ未確定である。

最低でも以下が残っている。

- どの申請を対象とするか
- リーダーとはどの役職か
- 代理者はいるか
- 「確認」とは何を確認することか
- 確認項目は固定か案件別か
- 「問題ない」の判定条件は何か
- 必須証拠は何か
- 1件の確認に通常何分かかるか
- 何件/日処理するか
- 期限はあるか
- 判断不能時は誰へ上げるか
- 却下条件は何か
- 差戻しと却下は区別するか
- 承認後に誰へ何が渡るか
- 承認記録はどこに残るか
- 後から承認理由を説明できる必要があるか
- 誤承認時に取り消せるか
- 緊急時に通常フローを迂回できるか
- 例外承認を誰が監査するか
- 休暇・退職・異動時に誰が引き継ぐか
- 同じ申請を複数人が同時に触った場合どうするか

このレベルまで具体化して初めて、
業務モデル・権限・状態遷移・データモデルを設計できる。

### 例2

```text
問い合わせはサポート担当が内容を見て担当部署へ振り分ける。
```

これも未確定である。

追加で最低限確認する。

- 問い合わせ経路は何か
- 受付時点で必須情報は何か
- 誰がサポート担当になるか
- 自動割当か手動割当か
- 振り分け単位は部署・チーム・個人のどれか
- 振り分け基準は何か
- 複数部署にまたがる場合どうするか
- 誤振り分け時に何が起きるか
- 再振り分け回数に上限があるか
- 顧客へ受付通知するか
- 優先度は誰が決めるか
- 緊急度と重要度を分けるか
- SLAはいつから計測するか
- 営業時間外はどう扱うか
- 顧客返信待ちはSLAから除外するか
- 解決責任者は誰か
- クローズ条件は何か
- 再オープン条件は何か
- 顧客が解決を否定した場合どうするか

## 回答受入テスト

各重要回答は、次の観点で十分かを評価する。

1. WHO — 誰が
2. WHAT — 何を
3. TARGET — 何に対して
4. TRIGGER — 何をきっかけに
5. PRECONDITION — 何が成立していれば
6. INPUT — 何を材料に
7. RULE — どのルールで
8. JUDGEMENT — 何を判断し
9. ACTION — 何を実行し
10. OUTPUT — 何を生成し
11. NEXT — 次に誰へ何を渡し
12. STATE — 状態がどう変わり
13. EVIDENCE — 何を証拠として残し
14. TIMING — いつ
15. DEADLINE — いつまでに
16. FREQUENCY — どの頻度で
17. VOLUME — 何件程度
18. DURATION — どのくらい時間がかかり
19. PRIORITY — 優先順位をどう決め
20. EXCEPTION — 例外時にどうし
21. FAILURE — 失敗時にどうし
22. RETRY — 再試行をどうし
23. CANCEL — 中止をどうし
24. REOPEN — 再開をどうし
25. ESCALATION — 誰へ上げ
26. OVERRIDE — 誰が例外的に上書きでき
27. PERMISSION — 誰が見て・触れて
28. BOUNDARY — どこまでが対象で
29. OUT-OF-SCOPE — 何が対象外で
30. DEPENDENCY — 何に依存し
31. SOURCE — 情報源は何で
32. SOURCE-OF-TRUTH — 正とする情報は何で
33. QUALITY — 情報精度をどう保証し
34. HISTORY — 履歴を残す必要があり
35. AUDIT — 後から説明可能で
36. OWNER — 最終責任者は誰で
37. COST — その処理にどの程度コストがかかり
38. CUSTOMER-IMPACT — 顧客へ何が起き
39. BUSINESS-IMPACT — 事業へ何が起き
40. MEASUREMENT — 何を測れば良否を判断できるか

すべての回答で40項目を機械的に質問する必要はない。

しかし、その回答が後続設計へ影響する重要度に応じて、
必要な観点が未確定なら質問を継続する。

## Semantic Completeness Score

主要論点ごとに、次の5段階で具体性を評価する。

```text
0 = 単語・願望だけ
1 = 主体または処理だけ分かる
2 = 基本フローは分かる
3 = 条件・責任・例外の一部まで分かる
4 = 通常運用を第三者が再現できる
5 = 例外・責任・証拠・数量・境界まで含め、設計・監査可能
```

重要論点は原則として `5` になるまで閉じない。

重要度が低い論点のみ、理由を記録したうえで `4` を許可する。

## 「具体例を1件ください」を多用する

一般論だけでは業務実態を把握できない。

ユーザーが業務を説明したら、必要に応じて具体的な1件を要求する。

例:

```text
一般的な流れは理解した。
次は直近で実際に発生した1件を時系列で確認したい。

1. 何がきっかけだったか
2. 最初に誰が何を受け取ったか
3. 次に誰が何をしたか
4. どこで判断が発生したか
5. 何分/何時間/何日待ったか
6. 例外や手戻りはあったか
7. 最終的に何をもって完了としたか
```

抽象フローと実例が一致しない場合、
実例側を重要な反証として扱う。

## 「いつも」「基本的に」「原則」の内訳を聞く

ユーザーが次の表現を使った場合は割合を確認する。

```text
いつも
だいたい
基本的に
原則
ほとんど
たまに
まれに
```

例:

```text
「基本的にはリーダーが承認する」とあるが、
全体100件のうち何件程度がこの通常系か。

残りは誰が承認するのか。
```

割合が分からない場合は、
具体的な件数・直近期間・代表例から推定可能か確認する。

## 「問題ない」「適切」「必要」の条件を分解する

以下は完成した判断基準として扱わない。

```text
問題ない
適切
必要
十分
妥当
重要
緊急
高リスク
複雑
特殊
```

必ず判定条件へ変換する。

例:

```text
「高リスク案件」とは何を満たす案件か。

候補としては、
- 金額
- 顧客影響人数
- 個人情報の有無
- SLA違反可能性
- 法令影響
- 本番環境変更
などが考えられる。

どの条件を満たした場合に高リスクと判定するのか。
AND / OR 条件も含めて定義したい。
```

## 業務主体を役職名だけで確定しない

「リーダー」「管理者」「担当者」だけでは不足する場合がある。

確認する。

- どの組織の
- どの役職の
- どの権限を持つ人か
- 複数いる場合の選定ルール
- 代理者
- 不在時
- 兼務時
- 組織変更時

## 終了条件を必ず聞く

「対応する」「処理する」「確認する」では完了状態が不明である。

各主要業務について、

```text
何が成立したら完了なのか
誰が完了を認定するのか
完了後に変更可能か
再オープン可能か
```

を確定する。

## 数量を聞く

システム仕様へ影響する業務では、最低限以下を聞く。

- 件数/日
- 件数/月
- ピーク時
- 同時処理数
- ユーザー数
- 組織数
- 顧客数
- データ保持期間
- 添付容量
- 増加率

「多い」「少ない」で済ませない。

## 時間を聞く

- 処理時間
- 待ち時間
- SLA
- 締切
- 営業時間
- タイムゾーン
- バッチ時間
- リードタイム

を区別する。

## 例外を最低3方向から探す

各主要フローについて最低限、

1. 入力が不完全
2. 実行主体が不在
3. 外部依存が失敗

を想定して質問する。

さらに対象業務固有の例外を掘る。

## 反対例を聞く

ルールが提示されたら、成立しないケースを聞く。

例:

```text
「50万円以上は部長承認」という理解である。

では、
- 49万円だが個人情報を含む案件
- 100万円だが既存契約内の定型案件
- 緊急障害対応
は同じ扱いか。
```

これにより隠れた条件を抽出する。

## 境界値を聞く

閾値がある場合は、

- ちょうど境界値
- 境界値の直下
- 境界値の直上
- 欠損
- 0
- 最大値

を確認する。

## 責任と作業を分離する

「担当する」という回答を受けたら、

```text
実際に作業する人
最終責任を持つ人
承認する人
相談される人
通知だけ受ける人
```

を分ける。

## 事実と理想を混ぜさせない

ユーザーが現状説明中に「本来は」「普通は」を使った場合、
現在実際に行われていることと分離する。

```text
AS-IS:
実際に何が起きているか

POLICY:
本来どうすることになっているか

TO-BE:
今後どうしたいか
```

を別々に記録する。

## 「一旦これで進めて」を重要論点では許可しない

次の論点が未確定な場合、
ユーザーが先へ進みたがっても確定版として進めない。

- Primary Management Object
- 主要Actor
- 責任分界
- 主要State
- State Transition
- Entry / Exit Criteria
- 主要Business Rule
- 主要Exception
- KPI定義
- KPI計算根拠
- Permission Boundary
- Source of Truth
- 顧客影響
- データ保持・監査
- 規模・件数
- 完了条件

仮説として先へ進むことはできるが、
`HYPOTHESIS` と明示し、後で必ず戻る。

## No Compromise Rule

ユーザーが疲れた、時間がない、細かすぎると感じても、
重要論点の具体性を下げてはならない。

質問量を減らす代わりに、

- 仮説を提示する
- 選択肢にする
- 具体例を出す
- 図式化する
- 1問ずつ聞く

ことで回答負荷を下げる。

品質基準そのものは下げない。

## Interview Closure Gate

各主要論点は、次を満たすまで `CLOSED` にしない。

```text
[ ] 主体が特定されている
[ ] 対象が特定されている
[ ] 開始条件が分かる
[ ] 終了条件が分かる
[ ] 判断基準が分かる
[ ] 正常系が分かる
[ ] 主要例外が分かる
[ ] 責任者が分かる
[ ] 証拠・記録が分かる
[ ] 前後工程が分かる
[ ] 数量または規模感が分かる
[ ] 時間制約が分かる
[ ] 境界条件が分かる
[ ] 情報源が分かる
[ ] 不明点がInterview Debtに残っていない
```

重要論点はこのGateを満たさずに完了扱いしない。


# User Interrogation Policy — 曖昧回答を通過させない

このスキルを利用するユーザーは、分析負荷を減らすために曖昧な回答、短い回答、
「適当に」「一般的に」「いい感じに」「普通で」「そこは任せる」などの回答をする可能性がある。

そのような回答を完成情報として扱ってはならない。

## 基本姿勢

ユーザーの回答が曖昧な場合は、必要な具体性に達するまで何度でも質問する。

ただし、単に同じ質問を繰り返してはならない。

毎回、以下の順序で対応する。

```text
1. 現在の理解を自分の言葉で具体化する
2. その理解のどこが未確定かを明示する
3. 具体例または候補を提示する
4. ユーザーに選択・修正・補足を求める
5. 回答を構造化して再提示する
6. まだ曖昧なら次の質問へ進む
```

### 悪い質問

```text
対象業務は何ですか？
```

### 良い質問

```text
今の説明からは、対象業務は「問い合わせ受付から解決までの一連の運用」
だと理解している。

ただし、次の3つが未確定である。

- 受付前の営業・契約も対象に含むのか
- 解決後の請求・報告も対象に含むのか
- 顧客側の作業も業務モデルの対象に含むのか

現時点では、
A. 受付〜解決だけ
B. 受付〜請求まで
C. 顧客側作業も含むEnd-to-End
のどれに近いか。
```

## ユーザーの「楽をする回答」をそのまま受け入れない

以下のような回答を受け取った場合は、追加確認を必須とする。

```text
だいたい
普通
一般的
適当に
いい感じに
任せる
全部
特になし
分からない
多分
そんな感じ
今と同じ
必要なもの全部
よしなに
特に決まっていない
```

ただし「分からない」は不誠実とは限らない。

その場合は、質問を止めるのではなく、
分析者側が候補・具体例・仮説を作り、ユーザーが答えやすい形へ変換する。

---

# Question Quality Rules

## 1. 一問で複数の曖昧概念を聞かない

悪い例:

```text
目的、利用者、KPI、制約を教えてください。
```

良い例:

```text
まず目的だけ確認する。
この仕組みを導入した結果、経営者が最初に変えたい数字は何か。
```

## 2. 抽象回答には具体例を要求する

ユーザー:

```text
効率化したい
```

そのまま受け入れてはならない。

次のように分解する。

```text
「効率化」だけでは仕様にできない。

ここでいう効率化は、たとえば次のどれか。

A. 1件あたりの処理時間を短くする
B. 待ち時間を短くする
C. 必要人数を減らす
D. 手戻り率を下げる
E. 判断回数を減らす
F. 顧客が完了まで待つ時間を短くする

どれを最優先にするか。
複数ある場合は順位を付ける。
```

## 3. 形容詞を測定可能な表現へ変換する

以下をそのまま受け入れない。

- 速い
- 簡単
- 柔軟
- 安全
- 便利
- 高品質
- 使いやすい
- 大規模
- リアルタイム
- 高可用性

例:

```text
「速い」とは、
画面応答が1秒以内なのか、
申請完了まで1日以内なのか、
判断まで5分以内なのか、
意味が異なる。

どの時間を短縮したいか。
```

## 4. 「全部」は優先順位を要求する

ユーザーが「全部重要」と答えた場合は完了扱いにしない。

最低でも、

```text
Must
Should
Could
Won't / Later
```

または順位を付けさせる。

## 5. 「任せる」は仮説提示に変換する

ユーザー:

```text
そこは任せる
```

分析者:

```text
任せられるが、勝手に確定はしない。

現時点では次の案が最も整合すると考える。

仮説:
- Ownerは現場リーダー
- 承認者は部門長
- SLAは2営業日
- 緊急時のみ管理者Override可

この案を採ると、
現場リーダーに日常責任が集まり、
部門長は例外判断だけ行う。

この責任分界で問題ないか。
問題がある場合は、どの責任を誰へ移したいか。
```

## 6. 「特になし」は反証する

ユーザーが「制約は特にない」と答えた場合も、最低限次を確認する。

- 法律・規制
- 契約
- セキュリティ
- 個人情報
- 予算
- 納期
- 人員
- 既存システム
- 外部システム
- 運用時間
- 監査
- データ保持
- 顧客要求

すべて該当しないことを確認して初めて「なし」とする。

---

# Mandatory Interview Loop

各主要Phaseの完了前に、ユーザー確認が必要な未確定事項を整理する。

形式:

```text
Confirmed:
- ...

Current Interpretation:
- ...

Unresolved:
- ...

Why It Matters:
- ...

My Working Hypothesis:
- ...

Question:
- ...
```

ユーザーの回答後に、必ず `Current Interpretation` を更新する。

## 質問を止めてよい条件

次のいずれかを満たすまで、その論点の質問を止めない。

1. 具体的な値・条件・境界・主体が決まった
2. ユーザーが「決められない理由」を具体的に説明した
3. 不確定なまま進めても後工程に影響しないと証明できた
4. 仮説として扱うことを明示し、検証方法と期限を定義した

「ユーザーが面倒そうだから」は停止理由にならない。

---

# Progressive Questioning

いきなり詳細100項目を質問してはならない。

質問は段階的に行う。

```text
Level 1: 目的・範囲
Level 2: 主体・責任
Level 3: 業務・状態
Level 4: 判断・例外
Level 5: KPI・データ
Level 6: 制約・非機能
Level 7: 運用・移行
```

各Levelで、後続設計を大きく変える質問から聞く。

---

# Contradiction Handling

過去の回答と現在の回答が矛盾した場合は、黙ってどちらかを採用してはならない。

次の形式で確認する。

```text
以前:
「承認は部門長だけが行う」

今回:
「現場リーダーも承認できる」

この2つはそのままでは両立しない。

考えられる整理は次の3つ。

A. 通常承認は現場リーダー、例外のみ部門長
B. 金額やリスクで承認者を分ける
C. 以前の回答を撤回し、全件現場リーダー承認へ変更する

どれが正しいか。
```

---

# Evidence-seeking Interview

ユーザーの認識を事実と仮説に分離する。

ユーザー:

```text
承認が遅いのが問題
```

分析者は次を確認する。

```text
これは、
A. 実測値がある事実
B. 現場の体感
C. 経営者の推測
D. 顧客からの苦情
のどれか。
```

可能であれば、

- 件数
- 平均
- 中央値
- 最大
- 分布
- 期間
- 母数
- 具体例

を要求する。

---

# Interview Debt

ユーザー都合で未確定のまま進む項目は `Interview Debt` として記録する。

形式:

```text
ID
Question
Why Needed
Current Hypothesis
Risk If Wrong
Owner
Validation Method
Deadline
```

Interview Debtを黙って未解決のままにしてはならない。

主要なInterview Debtが残る場合、最終仕様を確定版として扱わない。

---

# Anti-Shortcut Rules

ユーザーが次を要求しても、分析品質を下げてはならない。

```text
とりあえず作って
質問なしで進めて
細かいことは後で
一般的なのでいい
全部任せる
まず仕様だけ出して
```

その場合は、

1. 現時点の仮説を提示
2. 重大な未確定事項を明示
3. その未確定事項だけは質問
4. 仮仕様として進める場合は仮説ラベルを付与

する。

ただし、主要な業務モデル・責任・状態・KPI・権限・データ境界が未確定なら、
確定版仕様として完了させてはならない。

---

# User Assistance Rule

厳しく質問するだけでは不十分である。

ユーザーが考えやすくなるよう、分析者側が毎回以下のいずれかを提供する。

- 選択肢
- 具体例
- 仮説
- 比較
- 図式化
- 現在理解の言い換え
- 想定される副作用
- 決めた場合の結果

ユーザーへ「自分で全部整理してから回答してください」と丸投げしてはならない。

このスキルの役割は、
ユーザーが曖昧にしか説明できない知識を、質問と仮説提示によって仕様化可能な形まで引き出すことである。


# 最重要原則

## 1. 短時間で結論を出さない

このスキルは「数時間規模の分析」を前提とする。

時間そのものを完了条件にはしないが、以下の調査パスをすべて実施するまで結論を出してはならない。

最低限:

- AS-IS事実収集パス
- 例外・失敗パス
- 経営・KPIパス
- 顧客・価値パス
- 組織・責任パス
- 情報・データパス
- コスト・経済性パス
- 規制・監査パス
- 代替手段パス
- TO-BE候補生成パス
- 反証パス
- 独立レビュー

可能ならサブエージェントを並列に使う。

## 2. AS-IS調査中にTO-BEを決めない

AS-ISの調査中に「こうすべき」と決めてはならない。

事実と解釈を分ける。

```text
FACT
INFERENCE
HYPOTHESIS
DECISION
```

を明確に区別する。

## 3. 現行業務を正解とみなさない

現行手順は「現在そうしている」という事実であり、将来も必要という意味ではない。

## 4. TO-BEは最低5案作る

微差ではなく、原理が異なる案を作る。

例:

- 人中心
- ルール中心
- データ中心
- 自動化中心
- プラットフォーム中心
- 分散自治型
- 集中統制型

少なくとも5案を作り、統合案を別に作ってもよい。

## 5. システムなし案を必ず含める

以下を比較対象に含める。

- 何も作らない
- 業務変更だけ
- 既存SaaS
- 複数SaaS連携
- 一部自作
- 全面自作

## 6. TO-BEは経営者だけでなく顧客・現場・運用も評価する

経営者にとって管理しやすくても、現場が回らないモデルは不採用にする。

## 7. 仕様は上流の意図へ完全にトレースできること

すべての主要要件は、

```text
Business Goal
→ Problem
→ Management Requirement
→ Business Rule
→ State
→ KPI
→ Capability
→ Functional Requirement
→ Data / Permission / Interface / NFR
→ Acceptance Criteria
```

へ接続する。

---

# 成果物

```text
.system-design/
├── 00-analysis-charter.md
├── 01-as-is-context.md
├── 02-as-is-stakeholders.md
├── 03-as-is-value-stream.md
├── 04-as-is-processes.md
├── 05-as-is-decisions.md
├── 06-as-is-information.md
├── 07-as-is-systems-and-tools.md
├── 08-as-is-data.md
├── 09-as-is-controls-and-permissions.md
├── 10-as-is-exceptions.md
├── 11-as-is-costs.md
├── 12-as-is-customer-and-market.md
├── 13-as-is-metrics.md
├── 14-as-is-pain-and-root-causes.md
├── 15-as-is-constraints.md
├── 16-as-is-evidence.tsv
├── 17-to-be-design-principles.md
├── 18-to-be-candidates.md
├── 19-to-be-comparison.md
├── 20-to-be-selected-model.md
├── 21-to-be-state-machine.md
├── 22-to-be-kpi-and-decision-model.md
├── 23-to-be-operating-model.md
├── 24-capability-requirements.md
├── 25-system-boundary.md
├── 26-domain-model.md
├── 27-event-model.md
├── 28-use-cases.md
├── 29-functional-spec.md
├── 30-permission-and-audit.md
├── 31-data-and-integration.md
├── 32-ui-api-event-batch-spec.md
├── 33-non-functional-requirements.md
├── 34-exception-abuse-and-resilience.md
├── 35-rollout-and-migration.md
├── 36-economics-and-business-case.md
├── 37-acceptance-criteria.md
├── 38-traceability-matrix.tsv
├── 39-independent-review.md
└── 40-verification.md
├── 41-interview-ledger.md
```

---

# Phase 0 — Analysis Charter

最初に分析範囲と成功条件を定義する。

必須項目:

```text
Goal
Decision to be made
Business domain
Scope IN
Scope OUT
Time horizon
Target customer
Primary users
Economic buyer
Executive sponsor
Primary stakeholders
Known assumptions
Unknowns
Constraints
Available evidence
Missing evidence
Analysis risks
Definition of Done
```

---

# Phase 1 — AS-IS Context

現状の事業・組織・サービスの文脈を調べる。

## 調査観点

- 事業目的
- 収益構造
- 顧客構造
- サービス構造
- 契約形態
- 提供価値
- 競争優位
- 事業上の制約
- 経営上の重点
- 成長段階
- 組織規模
- 拠点
- 市場特性
- 季節性
- 外部依存
- 規制環境
- 既存投資
- 経営会議で見ている指標
- 事業責任者が困っていること
- 現場責任者が困っていること

---

# Phase 2 — Stakeholder Analysis

関係者を漏れなく整理する。

最低限:

- 経営
- 事業責任者
- 管理職
- 現場担当者
- バックオフィス
- 顧客
- 顧客管理者
- 顧客利用者
- 監査
- 法務
- セキュリティ
- 情報システム
- 運用
- サポート
- 外部委託
- パートナー
- 規制当局
- データ所有者

各Stakeholderについて:

```text
Goal
Responsibility
Decision Right
Information Need
Pain
Benefit
Burden
Incentive
Conflict
Risk
Required Control
Required Visibility
```

---

# Phase 3 — AS-IS Value Stream

顧客価値が生まれる一連の流れを調べる。

各工程:

```text
Input
Actor
Action
Decision
Output
Customer Value
Business Value
Wait
Rework
Handoff
System Used
Evidence Generated
Exception
```

以下を明示する。

- Value Added
- Necessary Non-Value Added
- Pure Waste

さらに:

- 待ち時間
- 手戻り
- 二重入力
- 承認待ち
- 照合作業
- 情報探索
- 調整
- 再入力
- 再確認
- 再承認
- 顧客待ち
- 外部依存待ち

を計測する。

---

# Phase 4 — AS-IS Process Analysis

主要業務ごとに詳細フローを作る。

各プロセス:

```text
Trigger
Precondition
Actor
Step
Decision
Business Rule
Input
Output
System
Manual Work
Handoff
Wait
Exception
Evidence
Completion Condition
```

最低限:

- 正常系
- 差戻し
- 保留
- 中止
- 失敗
- 再試行
- 再開
- エスカレーション
- 緊急処理
- 例外承認
- 手動Override

を整理する。

---

# Phase 5 — Decision Analysis

重要な判断をすべて抽出する。

各判断:

```text
Decision
Decision Owner
Trigger
Input Information
Decision Rule
Judgement Criteria
Evidence
Frequency
Latency
Alternative
Appeal / Override
Downstream Impact
```

分類:

- deterministic
- policy-based
- expert judgement
- approval
- prioritization
- allocation
- risk judgement
- customer judgement
- exception judgement

属人的判断を単純に悪いものと扱わない。

---

# Phase 6 — Information Flow Analysis

情報の生成・変換・伝達を分析する。

各情報:

```text
Information
Producer
Consumer
Channel
Format
Timing
Source of Truth
Freshness
Accuracy
Sensitivity
Duplication
Transformation
Loss Risk
Manual Copy
```

以下を調べる。

- Slack/Teams
- Email
- Excel
- Spreadsheet
- PDF
- Paper
- Ticket
- CRM
- ERP
- Database
- BI
- 人の記憶
- 口頭

「人の頭の中」を情報源として明示してよい。

---

# Phase 7 — Existing Systems and Tooling

既存システムがある場合は、業務単位で対応付ける。

調査観点:

- system owner
- supported process
- unsupported process
- data owned
- integrations
- manual workaround
- licensing
- cost
- availability
- performance
- vendor lock-in
- customization
- upgrade difficulty
- security
- auditability
- usability
- shadow IT
- spreadsheet dependency
- duplicate systems
- end-of-life risk

---

# Phase 8 — AS-IS Data Analysis

データ単位で整理する。

各Data:

```text
Meaning
Owner
Source
Source of Truth
Created By
Updated By
Consumer
Quality
Freshness
Retention
Sensitivity
Identifier
Relationships
Duplicate Risk
Missing Risk
Derived Values
```

データ品質:

- completeness
- accuracy
- consistency
- timeliness
- uniqueness
- validity
- traceability

---

# Phase 9 — Control, Permission, Governance

現状の統制を調べる。

- 誰が閲覧できるか
- 誰が更新できるか
- 誰が承認できるか
- 誰が強制変更できるか
- 誰が削除できるか
- 誰が監査できるか
- 誰が設定変更できるか
- 権限付与者
- 職務分離
- 代理承認
- 緊急権限
- 一時権限
- 退職・異動時処理
- テナント境界
- 組織境界
- 顧客境界
- 情報分類
- 証跡
- 監査頻度

---

# Phase 10 — Exceptions and Failure Analysis

正常系より例外を重視する。

分類:

- process exception
- customer exception
- organizational exception
- data exception
- permission exception
- external dependency failure
- human error
- policy conflict
- concurrency
- duplicate
- stale data
- missing data
- partial completion
- fraud
- abuse
- force majeure

各例外:

```text
Trigger
Frequency
Impact
Detection
Current Response
Owner
Recovery
Permanent Fix
Evidence
```

---

# Phase 11 — Cost and Effort Model

AS-ISコストを定量化する。

対象:

- 人件費
- 処理時間
- 待ち時間
- 手戻り
- 監査
- 教育
- 問い合わせ
- 運用
- 外注
- ライセンス
- インフラ
- データ入力
- 集計
- 照合
- 調整
- エラー対応
- 障害
- 顧客離脱
- 機会損失
- リスク期待損失

可能なら:

```text
Volume × Unit Cost × Frequency
```

で算出する。

---

# Phase 12 — Customer and Market Analysis

顧客側の現状を調査する。

- Customer Job
- Desired Outcome
- Current Alternative
- Switching Cost
- Adoption Barrier
- Buying Process
- Decision Maker
- User
- Influencer
- Procurement
- Security Review
- Legal Review
- Budget Owner
- Renewal Driver
- Churn Driver
- Expansion Driver
- Customer Effort
- Time to Value
- Trust Requirement
- Evidence Requirement

---

# Phase 13 — Metrics Analysis

現状KPIを棚卸しする。

各KPI:

```text
Name
Purpose
Formula
Owner
Source
Frequency
Target
Actual
Action Triggered
Gaming Risk
Known Distortion
Data Cost
```

評価:

- useful
- misleading
- redundant
- missing
- lagging only
- leading
- vanity
- uncontrollable
- gameable

---

# Phase 14 — Pain and Root Cause Analysis

表面的な不満と根本原因を分ける。

必須手法:

- 5 Whys
- cause-effect chain
- constraint analysis
- bottleneck analysis
- failure demand analysis
- rework analysis
- dependency analysis
- policy analysis

各Pain:

```text
Symptom
Observed Evidence
Immediate Cause
Root Cause
Contributing Factors
Affected Stakeholders
Business Impact
Customer Impact
Frequency
Severity
Controllability
```

---

# Phase 15 — Constraints

TO-BEを制約する条件を整理する。

- law
- regulation
- contract
- security
- privacy
- budget
- staffing
- timeline
- existing platform
- architecture
- data residency
- compatibility
- procurement
- vendor
- skills
- organizational politics
- union / labor rule where applicable
- change capacity
- training capacity
- customer contract
- migration window

制約と単なる慣習を分ける。

---

# Phase 16 — AS-IS Evidence Gate

`.system-design/16-as-is-evidence.tsv`

列:

```text
ID
Claim
Type
Source
Location
Confidence
Contradiction
Notes
```

Type:

```text
FACT
INFERENCE
HYPOTHESIS
```

Confidence:

```text
HIGH
MEDIUM
LOW
```

AS-ISの主要主張がMEDIUM以上になるまでTO-BEへ進まない。
LOWしかない場合は未確定事項として残す。

---

# Phase 17 — TO-BE Design Principles

TO-BEを作る前に設計原則を決める。

例:

- 顧客価値を悪化させない
- 入力は自然発生を優先する
- 監査可能性を確保する
- 管理単位は明確にする
- 状態遷移は有限にする
- Ownerを一意にする
- KPIは行動を歪めにくくする
- 例外を隠さない
- 人間判断が必要な箇所を明示する
- ロックインを目的にしない
- 段階導入可能にする

---

# Phase 18 — TO-BE Candidate Generation

最低5案作る。

各案:

```text
Model Name
Core Principle
Primary Management Object
Customer Value
Management Value
Field Value
Organization Structure
State Machine
Decision Model
KPI Model
Information Model
Automation Level
System Dependency
Expected Benefit
Expected Cost
Major Risk
Assumptions
```

候補同士は構造的に異なること。

---

# Phase 19 — TO-BE Comparison

各候補を最低30観点で比較する。

必須比較軸:

1. 経営価値
2. 顧客価値
3. 現場価値
4. 観測可能性
5. 制御可能性
6. 予測可能性
7. 責任明確性
8. データ生成コスト
9. 入力負荷
10. 教育負荷
11. 組織変更量
12. システム依存度
13. 実装複雑性
14. 運用複雑性
15. 例外耐性
16. 監査可能性
17. セキュリティ
18. プライバシー
19. 可用性依存
20. 外部依存
21. 拡張性
22. スケーラビリティ
23. 変更容易性
24. 段階導入性
25. 移行容易性
26. 可逆性
27. ロックイン
28. 経済性
29. Time to Value
30. Failure Blast Radius
31. KPI Gaming Risk
32. Customer Switching Cost
33. Organizational Resistance
34. Data Quality Sensitivity
35. AI依存性（該当時）
36. Compliance Fit
37. Offline / degraded operation
38. Global / localization fit
39. Multi-tenant suitability
40. Long-term maintainability

---

# Phase 20 — Selected TO-BE

選定案について、他候補を棄却した理由を記録する。

選定理由は「一番良さそう」では不可。

---

# Phase 21 — TO-BE State Machine

各管理対象について完全な状態遷移を定義する。

```text
State
Meaning
Entry Criteria
Exit Criteria
Owner
Allowed Actors
Required Evidence
Allowed Next States
Timeout
SLA
Escalation
Cancellation
Reopen
Override
Parallelism
```

---

# Phase 22 — TO-BE KPI and Decision Model

KPIを4層へ分ける。

```text
Business Outcome
Management KPI
Process / Transition KPI
Raw Observation
```

各KPI:

```text
Purpose
Formula
Owner
Threshold
Frequency
Triggered Decision
Action
Required Data
Gaming Risk
Counter Metric
Data Cost
Controllability
```

---

# Phase 23 — TO-BE Operating Model

各Role:

```text
Input
Decision
Action
Output
Next Owner
Exception
Escalation
Data Ownership
```

Review:

```text
Input
Decision
Owner
Output
System Update
Follow-up
```

---

# Phase 24 — Capability Requirements

初めてシステム能力へ落とす。

分類:

- Observe
- Record
- Control
- Coordinate
- Automate
- Standardize
- Explain
- Verify
- Recover

前回より以下を追加:

### Explain
判断根拠を説明できる。

### Verify
業務結果・証拠・状態の正当性を検証できる。

### Recover
障害・誤操作・不正状態から回復できる。

---

# Phase 25 — System Boundary

各能力を:

```text
BUILD
BUY
INTEGRATE
MANUAL
DEFER
```

へ分類する。

また:

```text
IN
OUT
EXTERNAL
HUMAN
FUTURE
```

で境界を定義する。

---

# Phase 26以降 — System Specification

以下を順番に設計する。

- Domain Model
- Event Model
- Use Cases
- Functional Requirements
- Permission
- Audit
- Data
- Integration
- UI
- API
- Event
- Batch
- NFR
- Exception
- Abuse
- Resilience
- Rollout
- Migration
- Economics
- Acceptance Criteria
- Traceability

詳細は `references/to-be-and-system-checklist.md` を参照する。

---

# Independent Review

最低2種類の独立レビューを行う。

## Review A — Business Red Team

目的:

- 問題設定の誤り
- 顧客価値の欠落
- KPI歪曲
- 組織抵抗
- 経済性不足
- 現場負荷
- 管理しすぎ

## Review B — System Red Team

目的:

- 状態遷移漏れ
- 認可漏れ
- データ不整合
- 監査不足
- 例外不足
- NFR不足
- 移行不能
- 運用不能

両方のMajor以上を解消するまで完了しない。

---

# Completion Gate

以下を満たすまで完了禁止。

## AS-IS
- 事業文脈
- Stakeholder
- Value Stream
- Process
- Decision
- Information Flow
- Existing Systems
- Data
- Control
- Exception
- Cost
- Customer
- Metrics
- Root Cause
- Constraints
- Evidence

## TO-BE
- Design Principles
- 5候補以上
- 30観点以上の比較
- 選定理由
- State Machine
- KPI
- Operating Model
- Capability
- System Boundary

## SYSTEM
- Domain
- Event
- Use Case
- Functional
- Permission
- Audit
- Data
- Integration
- UI/API/Event/Batch
- NFR
- Exception
- Abuse
- Resilience
- Rollout
- Migration
- Economics
- Acceptance
- Traceability
- Independent Review

---


## Interview Completeness
- 主要論点のSemantic Completeness Scoreが原則5である
- Interview Closure Gateを主要論点ごとに満たしている
- 主要論点についてConfirmed / Unresolvedが整理されている
- 曖昧回答を具体化せずに採用していない
- 「全部」「任せる」「特になし」を無検証で採用していない
- 主要な矛盾が解消されている
- 主要なInterview Debtが残っていない
- 仮説として残す項目には検証方法がある

# 禁止事項

- AS-ISを数ページで終える
- ユーザーの不満をそのまま要件にする
- 現行組織図を前提固定する
- 正常系だけで業務モデルを作る
- KPIを測れるから採用する
- 顧客価値を無視する
- 現場入力を無制限に増やす
- TO-BEを1案しか作らない
- システム導入ありきで考える
- AI利用ありきで考える
- 既存SaaS比較を省く
- Build / Buy比較を省く
- 経済性を無視する
- 移行・教育・運用を後回しにする
- 証拠のないAS-IS主張を確定扱いする
- トレーサビリティのない機能を残す


- ユーザーが短く答えたという理由だけで確定扱いする
- 曖昧語を具体化せず仕様へ転記する
- 同じ質問を言い換えずに繰り返す
- ユーザーに整理作業を丸投げする
- 矛盾する回答のどちらかを勝手に選ぶ
- 「任せる」を無条件の設計権委譲として扱う
- 主要なInterview Debtを残したまま確定版を出す
