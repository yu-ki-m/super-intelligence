# Deep Interrogation Checklist

このチェックリストは「一見具体的な回答」を業務設計可能な粒度まで詰めるために使う。

## A. Actor
- 誰が実行するか
- 誰が最終責任を持つか
- 誰が承認するか
- 誰が相談を受けるか
- 誰が通知だけ受けるか
- 代理者
- 不在時
- 兼務
- 異動時
- 権限付与者

## B. Object
- 何を処理するか
- 一件の単位
- 識別子
- 所有者
- 顧客との関係
- 他Entityとの関係
- 生命周期

## C. Trigger / Boundary
- 開始イベント
- 前提条件
- 対象範囲
- 対象外
- 終了条件
- 再開条件
- 中止条件

## D. Decision
- 判断内容
- 判断基準
- 必要情報
- 必要証拠
- 閾値
- AND/OR条件
- 境界値
- 判断不能時
- Appeal
- Override

## E. Flow
- 入力
- 操作
- 出力
- 次工程
- Handoff条件
- 受入条件
- 待ち時間
- 並行処理
- Queue
- Priority

## F. Exceptions
- 入力不足
- Actor不在
- 外部障害
- 重複
- 期限切れ
- 誤処理
- 誤承認
- 再試行
- 差戻し
- 再開
- 強制終了
- 緊急迂回

## G. Time / Volume
- 件数/日
- 件数/月
- Peak
- 同時件数
- 処理時間
- 待ち時間
- SLA
- 営業時間
- 締切
- 成長率

## H. Evidence / Data
- 情報源
- Source of Truth
- 入力者
- 更新者
- 精度
- 鮮度
- 履歴
- 監査
- 保存期間
- 削除

## I. Responsibility / Governance
- 作業責任
- 最終責任
- 承認責任
- Data Owner
- System Owner
- Escalation
- Separation of Duties

## J. Outcome
- 成功条件
- 失敗条件
- 顧客影響
- 事業影響
- KPI
- Counter Metric
- Gaming Risk
- Measurement Method
