---
tags: [skill-creator]
max_turns: 120
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

src/members 配下の会員登録API（POST /members）の処理をシーケンス図にしてHTMLで出してほしい。ウェルカムメールはキュー（BullMQ）経由で別プロセスのワーカーが送るので、そっちの処理も見られるようにして。

Input files: src/
