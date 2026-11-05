# 作業台帳

`python pbteam.py export` が `output/task-board.md` に現在の状態を書き出す。手で編集しない。状態の正本は `state.db` である。列の意味は次のとおりである。

| 列 | 意味 |
| --- | --- |
| 作業ID | ノードのIDと試行の区別。例：`intro_page`、`intro_page.rev1`（検査）、`intro_page.fix1`（修正）、`final_check~2`（2回目） |
| 種類 | `work`（作成）、`review`（検査）、`revise`（修正）、`research`（追加調査）、`critique`／`respond`／`reeval`（相互批評）、`decide`（判断）、`crosscheck`（横断検査）、`diagnose`（原因診断） |
| 担当 | 役割ID |
| 目的 | 成果を判断できる形の仕事の説明 |
| 前提 | 先に完了している必要がある作業 |
| 成果物と版 | 保存先の成果物IDと最新の版 |
| 品質契約 | 開始時に固定された契約 |
| 検査担当 | 検査する役割。作成者とは別のインスタンスを割り当てる |
| 状態 | 未着手、実行可能、実行中、検査待ち、修正中、完了、保留、失敗、対象外 |
| 結果 | 例：`accepted:hypothesis`（仮説案として合格）、`revision_limit`（修正上限）、`on_hold_missing_info`（資料不足） |
| 呼び出し、修正回数 | 消費した呼び出しと、使った修正の回数 |
| 失敗時 | 再試行の上限に達したときの扱い |
| 記録 | 状態が変わった理由 |

## 記入例（架空）

| 作業ID | 種類 | 担当 | 目的 | 前提 | 成果物と版 | 品質契約 | 検査担当 | 状態 | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| alternatives | work | M03 | 現状維持や手作業を含む代替手段を同じ観点で比較し、根拠と未確認欄を付ける | evidence | alternatives v2 | competitive_comparison | V03 | 完了 | accepted:hypothesis |
| intro_page | work | D02 | 採用された戦略から紹介ページの本文案を作る | select | intro_page v1 | landing_page | V05 | 修正中 | |
