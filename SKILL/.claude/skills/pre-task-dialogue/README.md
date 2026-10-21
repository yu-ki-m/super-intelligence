# pre-task-dialogue — Claude Code 着手前壁打ちスキル

## インストール

スキルフォルダ `pre-task-dialogue` を以下のいずれかに配置します。

- 個人用: `~/.claude/skills/pre-task-dialogue/`
- プロジェクト用: `<repository>/.claude/skills/pre-task-dialogue/`

PowerShell 例（展開したフォルダの親ディレクトリで実行）:

```powershell
New-Item -ItemType Directory -Force "$HOME/.claude/skills" | Out-Null
Copy-Item -Recurse -Force "./pre-task-dialogue" "$HOME/.claude/skills/"
```

## 呼び出し

```text
/pre-task-dialogue 問い合わせ業務の対応時間を減らしたい
/pre-task-dialogue このAPIに権限制御を追加したい
/pre-task-dialogue 既存の設計レビューを改善するため何をすべきか洗い出したい
```

明示的な起動を想定しており、勝手に実行されない設定です。開始後は各質問に回答して壁打ちを進めてください。「いったんまとめて」で暫定結果を取得できます。

## ファイル構成

- `SKILL.md`: 実行ルール、10段階の分析、着手判定
- `references/probes.md`: フェーズ別の深掘り観点
- `references/repository-investigation.md`: 既存コード/仕様の調査観点
- `templates/task-register.md`: 根拠付き実施事項一覧
- `templates/decision-brief.md`: 最終レポート
- `examples/example-dialogue.md`: 対話例

このスキルは質問と読み取り調査のみ行い、実装やファイル編集を勝手に開始しません。
