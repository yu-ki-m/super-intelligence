---
type: llm
focus: trace
weight: 1
---

例外で session.begin() のトランザクションがロールバックされるため、refund の FAILED 状態や finally の監査ログも確定しない（コミットされない）ことが、図または補足に示されている
