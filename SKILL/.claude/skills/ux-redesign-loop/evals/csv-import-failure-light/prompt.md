---
tags: [skill-creator]
max_turns: 200
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
---

うちのB2B SaaS（顧客管理）のCSVインポート機能の話です。取込の失敗がサポート問い合わせの3割を占めています。今は、ファイル選択→「取込」ボタン→数分後に「エラー: 47行目 不正な値」のようなメールが届くだけです。1回で数千行を取り込む顧客もいます。インポートの体験を作り直したいので、UI設計をお願いします。軽めでいいです。
