---
type: llm
focus: trace
weight: 1
---

決済代行への返金（payment_client.refund）が PaymentGatewayError で失敗した場合に RefundFailed を送出する経路と、finally での監査ログ記録が、正常系と区別して図示されている
