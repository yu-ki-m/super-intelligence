---
tags: [skill-creator]
max_turns: 120
timeout_seconds: 3000
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

社内ヘルプデスクのサイトを、新しく入った社員に使ってもらいたい。
今いるフォルダーの helpdesk/index.html を file:// の URL で開くと、そのサイトになる（一覧・問い合わせの詳細・新規作成の3ページがある）。
一覧で問い合わせを探して、1件の詳細を見て、新規作成の画面で書き始めるところまで、ページを移りながら、実際に画面を操作して使い方を解説する案内にしてほしい。
本物の問い合わせが届くと困るので、コメントの送信や保存はしないで。
ブラウザーで案内を開くのはこちらでやるので、開くためのコマンドを教えてくれればいい。

Input files: helpdesk/index.html, helpdesk/ticket.html, helpdesk/new.html, helpdesk/style.css
