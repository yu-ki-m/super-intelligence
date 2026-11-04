# CLAUDE.mdへ以下の文言を追加すること

``` md
# 声での報告

このプロジェクトでは、ユーザーへの報告を `windows-speak` スキルで声でも伝える。ユーザーが画面を見ていなくても、結果と説明が分かるようにするため。

次の場合は、応答を終える前に読み上げ用の文章を別に作って話す。

- 依頼されたタスクが完了した、または失敗して止まった
- ユーザーに説明する、または質問に答える
- ユーザーの判断や入力を待つ

次の場合は話さない。

- 作業の途中経過
- 新しく伝えることがない応答

```

# 話し忘れを確かめるhookを設定すること

CLAUDE.mdの指示はClaudeが読んで従うものであり、守られたかを確かめる仕組みがない。そこで `scripts/require-speech.ps1` を、Claudeが応答を終える時に動くStop hookとして設定する。このスクリプトは、その応答で `speak.ps1` を実行したかを会話の記録で確かめ、実行していなければ、話してから終わるようにClaudeへ一度だけ差し戻す。話すかどうかの判断と読み上げ用の文章は、差し戻された後もClaudeが担当する。

`~/.claude/settings.json` の `hooks.Stop` の配列に次の項目を追加する。既存の項目は残し、パスはこのスキルを置いた場所に合わせる。

``` json
{
  "hooks": [
    {
      "type": "command",
      "command": "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:/Users/<ユーザー名>/.claude/skills/windows-speak/scripts/require-speech.ps1\"",
      "timeout": 30
    }
  ]
}
```

このhookには次の制限がある。

- 確かめるのは `speak.ps1` を実行したかどうかまでで、音が聞こえたかは確かめられない。
- `AskUserQuestion` で質問している間は応答が終わっていないので、hookは動かない。
- 1つのコマンドに `speak.ps1` と `-File` の両方が書かれていると、読み上げていなくても実行したと判定する。このスクリプトを試験する時などに起こる。
- 応答を終えるたびに1秒ほどかかる。