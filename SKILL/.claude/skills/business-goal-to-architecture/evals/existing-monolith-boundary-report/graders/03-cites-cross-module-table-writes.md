---
type: llm
focus: trace
weight: 1
---

報告書は、注文側のコード（src/orders/service.py）が invoices テーブルに直接 INSERT していること、または請求側のコード（src/billing/service.py）が orders テーブルの status を直接更新していることを、ファイル名を示して指摘している
