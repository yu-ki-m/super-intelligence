# 実行の状態

`python pbteam.py status` が現在地を表示し、`python pbteam.py export` が `output/session-state.md` に書き出す。状態の正本は `state.db` であり、この文書は確認用である。

| 確認すること | 記録の場所 |
| --- | --- |
| 実行方式（実エージェント／模擬／設計のみ）、対象プロダクト、提供段階 | `meta`：`adapter`、`simulated`、`design_only`、`brief` |
| 確かめた実行環境の機能 | `meta`：`capability` |
| 実際の実行上限（呼び出し数、巡、修正回数、再試行、同時実行） | `meta`：`budget`、`settings` |
| 各役割のエージェントIDと状態、引き継ぎ元 | `instances` |
| 作業台帳、依存関係、差し戻し回数 | `tasks` |
| 入力資料と成果物の版、検査結果 | `attempts`、`artifacts`、`sources`、`reviews`、`defects` |
| 実行した巡、未送信・未応答の発言、再試行回数 | `issues`、`messages`、`tasks` |
| 呼び出し数、使用量、費用 | `attempts` |
| 目的、制約、判断者、現在の工程と完了状況 | `meta`：`brief`、`tasks` |
| 顧客候補、優先対象、代替手段、ブランド仮説の候補と採用・保留理由 | 成果物（`artifacts/`）と `claims` |
| 根拠のID、出所、確認日、適用条件、紐づく主張 | `evidence`、`claims`、`links` |
| 意見の違い、提案の版履歴、批判と応答、未解決論点、親の判断への異議 | `messages`、`issues` |
| すべての出来事の時系列 | `events` |

## 中断と再開

再開するときは次のコマンドで現在地を示し、続きから実行する。

```bash
python pbteam.py status --run-dir <run>
python pbteam.py run --run-dir <run>
```

実行中だった作業は実行可能へ戻り、未送達の発言は再度転送され、未検査の成果物は検査へ進む。成功済みの作業は再実行しない。各工程の完了、相互批評の各巡、失敗・保留の発生時に状態はすでに保存されているので、再開のための要約を作る必要はない。

ハーネスを動かせない環境（ファイルの保存や別プロセスの起動ができない環境）では、実討論は実施できない。作成できるのは設計資料だけであり、ハーネスが動作したと報告しない。その場合は、検討の現在地、次の問い、記録した主張と根拠を、再開時に貼り付けられる要約として出す。
