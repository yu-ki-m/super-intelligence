---
tags: [skill-creator]
max_turns: 200
timeout_seconds: 3600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
---

社内ヘルプデスクのチケット対応画面を作り直したいです。対応者は1人あたり1日40〜80件の問い合わせを受けていて、最近、AIが返信の下書きと関連ナレッジを自動で付けるようになりました。ところが「AIの下書きをそのまま送って誤回答した」「SLA（回答期限）が迫っているチケットに気付かない」という問題が起きています。

画面は社内のデザインシステム「Kumo DS」（v3.2）で作ってください。Kumo DS の内容は次のとおりです。

- トークン：色は primary #2457C5、text #1F2328、muted #59636E、surface #FFFFFF、border #D0D7DE、状態色 info #0969DA / success #1A7F37 / warning #9A6700 / danger #CF222E。文字は 12/14/16/20/24px、余白は 4/8/12/16/24/32px、角丸 6px。
- コンポーネント：Button（primary / secondary / danger、無効・読込中あり）、Table（並べ替え、行選択）、Badge（info / success / warning / danger）、Toast（5秒で自動的に消える。取消リンクは不可）、Modal、Tabs（画面内の表示切替え用。処理状態の表現には使わない）、TextField、TextArea、Select、Card、EmptyState。
- ガイドライン：重要な操作の結果は Toast だけで伝えない。状態は Badge の色とテキストで示す。

デザインシステムは尊重してほしいですが、使いやすさのために本当に必要なら、デザインシステムへの追加を提案してもらって構いません。深さは軽量でお願いします。
