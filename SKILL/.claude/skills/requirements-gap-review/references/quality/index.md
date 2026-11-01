# 品質観点カタログ

このカタログを、案件固有の要求候補を発見するために使う。各項目の適用条件・必要性・代替手段を確認し、一律に必須要件としない。技術例や数値をそのまま採用せず、案件の根拠に基づいて判断する。規格・法令・期限を判断に用いる場合は適用範囲と最新性を確認する。

カタログ版：`2026-11-01.2`

9品質特性・40副特性・605観点・1833確認項目。

副特性名の一覧だけでは分析済みにならない。適用がある、または不明な分野の詳細ファイルを開き、観点と詳細確認項目を読む。未読・未分析の項目は台帳に残す。

IDはこの版のカタログ内で一意。カタログ更新時は、旧台帳をIDだけで流用せず、項目内容・前提を照合して移行する。

| ID | 品質副特性 | 観点数 | 確認項目数 | 詳細 |
|---|---|---:|---:|---|
| Q01.01 | 機能完全性(Functional Completeness) | 25 | 76 | [機能適合性(Functional Suitability)](q01.md#Q01-01) |
| Q01.02 | 機能正確性(Functional Correctness) | 30 | 92 | [機能適合性(Functional Suitability)](q01.md#Q01-02) |
| Q01.03 | 機能適切性(Functional Appropriateness) | 16 | 48 | [機能適合性(Functional Suitability)](q01.md#Q01-03) |
| Q02.01 | 時間効率性(Time Behaviour) | 23 | 70 | [性能効率性(Performance Efficiency)](q02.md#Q02-01) |
| Q02.02 | 資源効率性(Resource Utilization) | 20 | 61 | [性能効率性(Performance Efficiency)](q02.md#Q02-02) |
| Q02.03 | 容量満足性(Capacity) | 17 | 51 | [性能効率性(Performance Efficiency)](q02.md#Q02-03) |
| Q03.01 | 共存性(Co-existence) | 12 | 36 | [互換性(Compatibility)](q03.md#Q03-01) |
| Q03.02 | 相互運用性(Interoperability) | 21 | 63 | [互換性(Compatibility)](q03.md#Q03-02) |
| Q04.01 | 適切度認識性(Appropriateness Recognizability) | 10 | 30 | [相互作用性(Interaction Capability)](q04.md#Q04-01) |
| Q04.02 | 習得性(Learnability) | 11 | 33 | [相互作用性(Interaction Capability)](q04.md#Q04-02) |
| Q04.03 | 運用操作性(Operability) | 23 | 69 | [相互作用性(Interaction Capability)](q04.md#Q04-03) |
| Q04.04 | ユーザーエラー防止性(User Error Protection) | 15 | 45 | [相互作用性(Interaction Capability)](q04.md#Q04-04) |
| Q04.05 | ユーザエンゲージメント（利用者関与性）(User Engagement) | 12 | 36 | [相互作用性(Interaction Capability)](q04.md#Q04-05) |
| Q04.06 | インクルーシビティ（包摂性）(Inclusivity) | 14 | 42 | [相互作用性(Interaction Capability)](q04.md#Q04-06) |
| Q04.07 | ユーザー支援性(User Assistance) | 14 | 42 | [相互作用性(Interaction Capability)](q04.md#Q04-07) |
| Q04.08 | 自己記述性(Self-descriptiveness) | 11 | 34 | [相互作用性(Interaction Capability)](q04.md#Q04-08) |
| Q05.01 | 無障害性(Faultlessness) | 14 | 42 | [信頼性(Reliability)](q05.md#Q05-01) |
| Q05.02 | 可用性(Availability) | 17 | 52 | [信頼性(Reliability)](q05.md#Q05-02) |
| Q05.03 | 障害許容性(Fault Tolerance) | 16 | 49 | [信頼性(Reliability)](q05.md#Q05-03) |
| Q05.04 | 回復性(Recoverability) | 15 | 45 | [信頼性(Reliability)](q05.md#Q05-04) |
| Q06.01 | 機密性(Confidentiality) | 19 | 60 | [セキュリティ(Security)](q06.md#Q06-01) |
| Q06.02 | インテグリティ(Integrity) | 14 | 42 | [セキュリティ(Security)](q06.md#Q06-02) |
| Q06.03 | 否認防止性(Non-repudiation) | 8 | 24 | [セキュリティ(Security)](q06.md#Q06-03) |
| Q06.04 | 責任追跡性(Accountability) | 11 | 33 | [セキュリティ(Security)](q06.md#Q06-04) |
| Q06.05 | 真正性(Authenticity) | 10 | 31 | [セキュリティ(Security)](q06.md#Q06-05) |
| Q06.06 | 耐攻撃性(Resistance) | 14 | 45 | [セキュリティ(Security)](q06.md#Q06-06) |
| Q07.01 | モジュール性(Modularity) | 12 | 36 | [保守性(Maintainability)](q07.md#Q07-01) |
| Q07.02 | 再利用性(Reusability) | 24 | 72 | [保守性(Maintainability)](q07.md#Q07-02) |
| Q07.03 | 解析性(Analysability) | 14 | 42 | [保守性(Maintainability)](q07.md#Q07-03) |
| Q07.04 | 修正性(Modifiability) | 24 | 73 | [保守性(Maintainability)](q07.md#Q07-04) |
| Q07.05 | テスト可能性（試験性）(Testability) | 17 | 52 | [保守性(Maintainability)](q07.md#Q07-05) |
| Q08.01 | 適応性(Adaptability) | 15 | 45 | [柔軟性(Flexibility)](q08.md#Q08-01) |
| Q08.02 | 拡張性(Scalability) | 13 | 39 | [柔軟性(Flexibility)](q08.md#Q08-02) |
| Q08.03 | 設置性(Installability) | 14 | 42 | [柔軟性(Flexibility)](q08.md#Q08-03) |
| Q08.04 | 置換性(Replaceability) | 13 | 40 | [柔軟性(Flexibility)](q08.md#Q08-04) |
| Q09.01 | 運用制約性(Operational Constraint) | 9 | 27 | [安全性(Safety)](q09.md#Q09-01) |
| Q09.02 | リスク特定性(Risk Identification) | 11 | 33 | [安全性(Safety)](q09.md#Q09-02) |
| Q09.03 | フェイルセーフ(Fail Safe) | 9 | 27 | [安全性(Safety)](q09.md#Q09-03) |
| Q09.04 | 危険警告性(Hazard Warning) | 9 | 27 | [安全性(Safety)](q09.md#Q09-04) |
| Q09.05 | 統合時安全性(Safe Integration) | 9 | 27 | [安全性(Safety)](q09.md#Q09-05) |

[全観点の一次選別一覧](viewpoints.md)

[台帳の使用方法](../coverage-workflow.md)
