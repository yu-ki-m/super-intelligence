---
type: llm
focus: trace
weight: 1
---

WMS 異常時の再試行（タイムアウト・5xx は 10 秒間隔で最大 3 回）と、失敗時のロールバック・batch_errors 登録・次の受注へ、および 4xx は再試行しないことが区別して図示されている
