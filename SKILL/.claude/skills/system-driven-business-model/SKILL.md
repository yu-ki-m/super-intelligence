---
name: system-driven-business-model
description: >
  ユーザーが指定したシステムまたはリポジトリを徹底調査し、そのシステム固有の能力を起点として、
  経営者が管理可能になる対象、KPI、責任分界、業務状態遷移、運用ルールを逆算し、
  システムが業務運営上の中核になる新しい業務モデルを設計する。
  「このシステムを軸に新しい業務モデルを作る」「THE MODELのように製品から業務モデルを逆算する」
  「システム仕様から経営モデル・業務プロセスを設計する」といった依頼で使用する。
---

# System-Driven Business Model

## 目的

ユーザーが指定したシステムを起点に、新しい業務モデルを設計する。

このスキルでは、既存業務を単にシステムへ当てはめてはならない。
先にシステムの実装事実を調査し、そのシステムが可能にする「観測・制御・記録・自動化・標準化」を抽出する。
その能力から、経営者が新しく管理可能になる対象を定義し、管理指標、状態遷移、責任分界、業務プロセスへ逆算する。

設計順序は必ず次とする。

```text
システムの実装事実
  ↓
システム固有能力
  ↓
経営上、新たに観測・制御できる対象
  ↓
経営成果との因果関係
  ↓
管理単位・状態・KPI
  ↓
責任者・責任分界
  ↓
業務プロセス
  ↓
例外・フィードバックループ
  ↓
システムへの記録
  ↓
経営判断
```

業務モデルを先に考え、後からシステムを当てはめることを禁止する。

---

# 入力

ユーザーから与えられる情報は `$ARGUMENTS` として扱う。

入力には次のいずれかが含まれ得る。

- 対象リポジトリ
- システム名
- システムの説明
- 仕様書
- 設計書
- README
- URL
- 対象機能
- 想定顧客
- 現在の業務
- 経営課題
- 「このシステムを軸に業務モデルを作りたい」という目的だけ

情報不足を理由に最初から質問してはならない。
リポジトリ、ドキュメント、設定、テスト、Git履歴など、利用可能な証拠を先に探索する。
探索しても確定できず、業務モデルの分岐を大きく変える情報だけを質問する。

---

# 最重要原則

## 1. Phase 1が終わるまで業務モデルを発想しない

システム調査中に「このシステムなら○○業務モデルがよさそう」と考えてはならない。

先入観が探索対象を狭めるためである。

Phase 1では事実だけを集める。

## 2. READMEを仕様の正解とみなさない

優先順位は原則として次とする。

```text
実行可能な実装・テスト
  >
設定・スキーマ・API定義
  >
設計資料
  >
README・説明資料
  >
ユーザーの概略説明
  >
推測
```

矛盾した場合は両方を記録し、実装事実を優先する。

## 3. 機能一覧を作って終わらない

必要なのは「何ができるか」ではなく、

```text
誰の
何という対象を
どの粒度で
いつ
観測できるか

誰が
何を
どの条件で
制御できるか

何が
どの証拠として
残るか
```

である。

## 4. 既存の業務用語へ早期に寄せない

「営業」「承認」「チケット」「案件」「CS」など、既存モデルの名前を先に当てはめてはならない。

まずシステム内部の実体と状態をそのまま抽出する。

## 5. 経営者の便益を第一の設計軸にする

現場の操作性を無視してよい、という意味ではない。

ただし業務モデル設計の第一問は、

> このシステムによって、経営者・事業責任者が従来は管理できなかった何を管理可能にできるか

とする。

## 6. 「システムを使うこと」をKPIにしない

ログイン数、入力件数、機能利用率は、それ自体では経営成果ではない。

必ず、

```text
システム上の観測値
  ↓
業務状態の変化
  ↓
経営成果
```

の因果鎖を示す。

## 7. 新業務モデルはシステムなしでは運用困難であること

単に「システムがあると便利」なモデルは弱い。

良いモデルは、システムが提供する記録、状態管理、横断可視化、自動判定、履歴、権限制御などがなければ、
規模拡大時に運用が破綻する構造を持つ。

ただし、人工的に無駄な入力や依存を作ってはならない。
依存は経営管理上必要な情報から自然に生じるものに限定する。

---

# 成果物

作業ディレクトリに次を作成する。

```text
.business-model/
├── 00-goal.md
├── 01-system-inventory.md
├── 02-system-evidence.tsv
├── 03-capability-map.md
├── 04-management-opportunities.md
├── 05-causal-model.md
├── 06-business-model-candidates.md
├── 07-selected-business-model.md
├── 08-operating-model.md
├── 09-kpi-model.md
├── 10-system-dependency.md
├── 11-risks-and-counterevidence.md
└── 12-verification.md
```

既存ファイルを破壊しない。

---

# Workflow

# Phase 0 — Goal Contract

最初に `.business-model/00-goal.md` を作る。

最低限、次を記録する。

```text
Goal:
対象システム:
ユーザーが明示した前提:
対象顧客:
対象業務:
期待する成果物:
制約:
Non-Goals:
Required Evidence:
Unknowns:
```

不明項目は `UNKNOWN` とする。
推測で埋めない。

---

# Phase 1 — System Forensics

この工程を最優先で実行する。

## 1.1 リポジトリ全体を把握する

最初に構造を調査する。

確認対象:

- ルートディレクトリ
- サブプロジェクト
- package / module
- frontend
- backend
- batch
- worker
- CLI
- infrastructure
- migrations
- schema
- API definitions
- tests
- fixtures
- docs
- config
- CI/CD
- deployment
- feature flags
- authorization
- integrations

巨大リポジトリではファイルを一件ずつ読むのではなく、検索・ファイル一覧・言語別検索を使う。

生成物、依存物、キャッシュは原則除外する。

例:

```text
node_modules
vendor
dist
build
target
.next
coverage
.git
.cache
out
tmp
venv
.venv
```

ただし、生成物そのものがシステム仕様を規定する場合は除外しない。

## 1.2 エントリーポイントを特定する

以下を探索する。

- UI routes
- API routes
- controllers
- handlers
- commands
- scheduled jobs
- event consumers
- webhooks
- public SDK/API
- external integration endpoints

各入口から主要な処理経路を追う。

## 1.3 データモデルを調査する

必ず調べる。

- entity
- table
- document
- aggregate
- relation
- identifier
- status
- timestamps
- history
- audit log
- soft delete
- version
- tenant boundary
- ownership

特に `status`, `state`, `type`, `role`, `permission`, `event` を重点的に検索する。

## 1.4 状態遷移を抽出する

各主要エンティティについて、

```text
初期状態
→ 遷移条件
→ 次状態
→ 実行主体
→ 副作用
→ 保存される証拠
```

を抽出する。

状態名がコードに存在しない場合も、データ変化から実質的な状態を抽出する。

## 1.5 権限と責任境界を調査する

以下を調べる。

- role
- permission
- policy
- ACL
- tenant
- organization
- project boundary
- owner
- approver
- administrator
- visibility
- read/write boundary

「誰が何をできるか」を表にする。

## 1.6 観測可能性を調査する

システムが何を記録しているかを調べる。

- history
- audit
- timestamps
- events
- logs
- metrics
- counters
- dashboards
- reports
- exports
- search/filter
- aggregation

ここから「経営者が測定可能なもの」の候補が生まれる。

ただし、この時点では業務モデルへ変換しない。

## 1.7 自動化・制御能力を調査する

- validation
- workflow
- rule engine
- scheduler
- notification
- assignment
- routing
- scoring
- recommendation
- generation
- automatic transition
- integration
- webhook
- API action

を調べる。

## 1.8 例外経路を調査する

正常系だけで終わってはならない。

- cancel
- reject
- reopen
- retry
- rollback
- timeout
- expired
- failed
- suspended
- archived
- manual override
- delete
- permission denied

を探索する。

## 1.9 テストから暗黙仕様を抽出する

テストは重要な仕様証拠として扱う。

特に以下を確認する。

- boundary conditions
- authorization
- invalid transition
- concurrency
- retry
- idempotency
- tenant isolation
- validation
- exceptional behavior

## 1.10 Git履歴を必要に応じて調査する

現在のコードだけでは意図が不明な場合、

- git log
- git blame
- commit message
- removed behavior

を確認する。

過去仕様を現在仕様と混同してはならない。

---

# Phase 1 Completion Gate

`.business-model/01-system-inventory.md` に最低限次が存在するまでPhase 2へ進んではならない。

- システム境界
- 主要アクター
- 主要エンティティ
- 主要状態
- 状態遷移
- 入力
- 出力
- 権限
- 自動化
- 外部連携
- 記録される履歴
- 集計可能な値
- 例外経路
- 制約
- 未確認事項

`.business-model/02-system-evidence.tsv` には各主張の証拠を記録する。

列:

```text
ID
Claim
EvidenceType
File
LinesOrSymbol
Confidence
Notes
```

Confidenceは `HIGH / MEDIUM / LOW` のみ使用する。

`LOW` の事実を業務モデルの中核前提にしてはならない。

---

# Phase 2 — Capability Extraction

ここで初めて仕様を能力へ抽象化する。

各能力について次を記述する。

```text
Capability:
Actor:
Object:
Action:
Granularity:
Timing:
Persisted Evidence:
Cross-Entity Visibility:
Automation:
Constraint:
Source Evidence IDs:
```

能力を次の6種類に分類する。

1. Observe — 何を観測できるか
2. Record — 何を証拠として残せるか
3. Control — 何を制御できるか
4. Coordinate — 誰と誰を接続できるか
5. Automate — 何を自動化できるか
6. Standardize — 何を共通ルールにできるか

重要なのは機能名ではない。

悪い例:

```text
ダッシュボード機能
```

良い例:

```text
全プロジェクトの処理滞留時間を同一基準で集計し、
組織単位・担当者単位・状態単位で比較できる。
```

---

# Phase 3 — System-Specific Advantage

一般的なSaaSでも実現できる能力と、このシステムだから実現しやすい能力を分離する。

各能力を次で評価する。

```text
A. システム固有性
B. 経営上の重要性
C. 観測可能性
D. 制御可能性
E. 規模拡大時の価値
F. 模倣困難性
G. システム依存の自然さ
```

1〜5で評価する。

合計点だけで自動選択してはならない。
高得点の理由を説明する。

---

# Phase 4 — Management Opportunity

ここから経営側へ変換する。

各主要能力について次の問いに答える。

```text
この能力がなければ、経営者には何が見えないか？
この能力によって、何を比較できるか？
何を予測できるか？
何に介入できるか？
誰に責任を割り当てられるか？
どの異常を早期発見できるか？
どの資源配分を変えられるか？
```

出力は「管理可能な対象」とする。

例:

```text
機能:
各案件の状態変更時刻を保存する

        ↓

能力:
状態ごとの滞留時間を測定できる

        ↓

管理対象:
組織内の業務停滞

        ↓

経営判断:
人員不足なのか、承認待ちなのか、特定工程の構造問題なのかを比較できる
```

---

# Phase 5 — Causal Model

「測れるからKPIにする」を禁止する。

経営成果まで因果鎖を作る。

形式:

```text
System Capability
  ↓
Observable Operational Change
  ↓
Controllable Management Variable
  ↓
Behavior / Process Change
  ↓
Business Outcome
```

各矢印について、

```text
なぜ前段が後段を変えるのか
反対の説明はないか
外部要因は何か
実際に観測可能か
```

を記載する。

因果関係を説明できない指標は主要KPIから除外する。

---

# Phase 6 — Generate Business Model Candidates

ここで初めて業務モデル案を作る。

最低3案作る。

各案は名前だけ変えた類似案にしてはならない。

各案について次を定義する。

```text
Model Name:
Management Thesis:
Primary Management Object:
System Capability Used:
Actors:
State Machine:
Handoffs:
KPIs:
Management Decisions:
Feedback Loops:
System Dependency:
Field Burden:
Failure Modes:
```

既存の業務モデル名を流用する場合も、システム仕様から導出できることを示す。

---

# Phase 7 — Adversarial Comparison

各候補を反証する。

最低限、次を問う。

1. システムなしでもExcelで十分ではないか
2. 単に既存業務をデジタル化しただけではないか
3. 現場入力を増やしただけではないか
4. KPIが代理指標化し、目的化しないか
5. 部門最適を促進しないか
6. 責任境界で顧客・案件が落ちないか
7. 数字を良くするためのゲーム行動が起きないか
8. 管理可能性と顧客価値が切断されていないか
9. 経営者が実際に意思決定を変えられるか
10. システム固有能力を本当に利用しているか
11. システムへのロックインだけが価値になっていないか
12. 規模が10倍になったとき成立するか

反証後に候補を修正する。

---

# Phase 8 — Select Model

最終案を1つ選ぶ。

選定基準:

```text
経営上の価値
システム固有性
因果関係の明確さ
測定可能性
介入可能性
責任分界の明確さ
規模拡張性
現場負荷との釣り合い
顧客価値との整合
システム依存の自然さ
```

選ばなかった案についても棄却理由を残す。

---

# Phase 9 — Define the New Business Model

`.business-model/07-selected-business-model.md` に完成モデルを書く。

必須構成:

## 1. つまり何なのか

1〜2文で定義する。

## 2. このモデルが解決する経営問題

「現場が困っている」だけではなく、経営上何が管理不能なのかを書く。

## 3. システムが作る新しい管理可能性

システムのどの仕様が、何を新しく管理可能にするのかを書く。

## 4. 管理対象

何を一単位として管理するかを明確にする。

例:

- 案件
- 要求
- 判断
- リスク
- 作業
- 顧客成果
- 変更
- 仮説

ただし実際のシステム仕様から導く。

## 5. 状態遷移

```text
State A
  ↓ 条件
State B
  ↓ 条件
State C
```

各遷移に次を付ける。

- Entry Criteria
- Exit Criteria
- Owner
- Required Evidence
- System Record
- SLA / Threshold
- Exception

## 6. 責任分界

各管理変数にOwnerを割り当てる。

「全員で責任を持つ」で終わらせない。

## 7. KPI

KPIは次の4層に分ける。

```text
Outcome KPI
↑
Process KPI
↑
Transition KPI
↑
System Observation
```

各KPIについて式、データ源、測定周期、Owner、悪化時のActionを書く。

## 8. 経営ダッシュボード

経営者が最初に見るべき数字を定義する。

「見える化」で終わらず、

```text
この数字がXなら、誰が何を判断する
```

まで定義する。

## 9. フィードバックループ

失敗・保留・差戻し・解約・未達などを捨てず、どの工程へ戻すか定義する。

## 10. 現場業務

各役割について、

```text
入力
判断
操作
出力
次工程
```

を書く。

## 11. システムが必須になる理由

システムなしで運用した場合、

```text
何件までは運用可能か
どこから破綻するか
何が観測不能になるか
何が同期不能になるか
何が監査不能になるか
```

を説明する。

恣意的なロックインを設計してはならない。

---

# Phase 10 — Operating Model

業務モデルを実際に運用可能な形へ落とす。

必須:

- role definition
- RACIまたは同等の責任表
- daily operation
- weekly review
- monthly management review
- escalation
- exception handling
- data quality rule
- KPI review rule
- model revision rule

会議を増やすことを運用設計とみなしてはならない。

各レビューには、

```text
Input
Decision
Owner
Output
System Update
```

を定義する。

---

# Phase 11 — System Dependency Map

業務モデルとシステム仕様を1対1で接続する。

表:

```text
Business Model Element
Required System Capability
Implementation Evidence
Without System
Alternative
Dependency Strength
```

Dependency Strength:

```text
ESSENTIAL
STRONG
OPTIONAL
```

`ESSENTIAL` に実装証拠がない場合、モデルを修正する。

---

# Phase 12 — Independent Verification

設計者とは別コンテキストのサブエージェントを利用可能なら使用する。

検証者には完成案だけでなく、

- system inventory
- evidence table
- capability map
- selected model
- dependency map

を渡す。

検証者の目的は賛成することではない。

次を探す。

```text
仕様の読み違い
未調査領域
存在しない機能への依存
因果飛躍
測れないKPI
責任の空白
状態遷移の欠落
例外経路の欠落
現場負荷の過小評価
既存モデルの焼き直し
システムなしでも成立する部分
経営価値と顧客価値の断絶
```

Critical / Major が存在する場合はPhase 2以降へ戻って修正する。

最大3回まで再検証する。
3回で解消しない場合は未解決事項として明示し、成功扱いにしない。

---

# Completion Ledger

`.business-model/12-verification.md` に次を作る。

```text
ID
Requirement
Status
Evidence
Verification Method
Remaining Work
```

Status:

```text
PASS
FAIL
UNVERIFIED
NOT_APPLICABLE
```

`UNVERIFIED` を `PASS` とみなしてはならない。

---

# Stop Condition

次のすべてを満たした場合のみ完了とする。

- システム全体の主要領域を探索した
- 主要アクターを特定した
- 主要エンティティを特定した
- 主要状態遷移を特定した
- 権限境界を調査した
- 例外経路を調査した
- テストから暗黙仕様を調査した
- システム能力を証拠付きで抽出した
- システム固有能力を特定した
- 経営管理可能性へ変換した
- 因果モデルを作成した
- 3つ以上の異なる候補を比較した
- 反証を実施した
- 最終モデルを選定した
- 状態遷移を定義した
- KPIと計算方法を定義した
- KPI悪化時の経営Actionを定義した
- 責任者を定義した
- フィードバックループを定義した
- システム依存関係を実装証拠へ接続した
- 独立検証を実施した
- Critical / Major の未解決事項がない
- Completion LedgerにUNVERIFIEDが残っていない

条件を満たさない場合は「完了」と報告してはならない。

---

# 出力時の説明ルール

ユーザーへの最終説明は次の順序にする。

1. 新業務モデルを1〜2文で説明
2. システムのどの仕様から導いたか
3. 経営者が新しく何を管理できるか
4. 業務の状態遷移
5. KPI
6. 責任分界
7. システムが必要になる理由
8. 反証結果
9. 未解決事項

抽象語だけで説明しない。

「AによってBが可能になる」と書く場合は、
Aのどの仕様が、Bをどのように可能にするかを書く。

主語を省略しない。

根拠のない断定をしない。

---

# 禁止事項

- 仕様調査前に業務モデルを決める
- READMEだけ読んで調査完了とする
- ユーザー説明だけを実装事実として扱う
- 一般的な業務モデルをそのまま当てはめる
- 機能一覧を業務モデルと呼ぶ
- KPIを測定可能性だけで選ぶ
- ログイン数などを経営成果として扱う
- 現場への無意味な入力を増やす
- 架空のシステム機能を前提にする
- 正常系だけで設計する
- 例外・差戻し・失敗を捨てる
- 「全員が責任者」とする
- AI自身の「調査した」という宣言を証拠にする
- 証拠なしに完了扱いする
