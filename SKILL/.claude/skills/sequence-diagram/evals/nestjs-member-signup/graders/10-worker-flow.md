---
type: llm
focus: trace
weight: 1
---

ワーカー側の処理（MailProcessor.process：job 名の判定、findById、会員が存在しない場合の早期 return、sendMail、markWelcomeSent による members の UPDATE）が、別の図または別の区画で確認できる
