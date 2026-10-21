# 調査台帳とモデルの契約

JSONはUTF-8。IDは版とソース位置を識別し、全体で一意にする。以下は必須の照合用フィールドであり、結果・UI・証拠に必要な情報は追加する。

## scope.json

repository、base/headの固定版、diff取得方法、対象入口、入力制約、フレームワーク版、環境/フラグ、外部境界、合意済み除外、調査開始時刻を持たせる。

## inventory.json

- `revisions`: 変更前/後を識別する文字列の配列。
- `items`: 独立にソースから収集した台帳配列。
- 各項目: `id`, `kind`（hunk/entry/alternative）, `revision`, `source`（path,start,end,excerpt）, `description`。
- `alternative` は判定式の各出口1つずつを表す。true/false、case/default、catch、短絡による未評価等を別項目にする。分岐式本体と評価順序も別途保持する。
- 新規/削除ファイルの相手版に、存在しない分岐を作らない。
- `pending`: 未処理探索キューの配列。
- `unresolved`: 解決できない事項の配列。

## model.json

- `trees`: `id`, `revision`, `entry_id`, `root`（ノードID）を持つ配列。
- `nodes`: `id`, `tree_id`, `kind`（entry/decision/action/terminal/reference/summary）, `label` を持つ配列。
- ノードの `evidence`: 根拠オブジェクトの配列。各根拠はrevision,path,start,end,excerptを持つ。
- `edges`: `id`, `from`, `to`, `condition` を持つ配列。ノードは全体IDで参照する。
- `mappings`: `inventory_id`, `status`（mapped/unreachable/excluded/unresolved）, `node_ids`, `edge_ids`, `reason`, `evidence`。
- mappedのhunk/entryはノードまたは辺を指す。mappedのalternativeは対応する辺を必ず指す。
- unreachableは条件矛盾等の証拠を持つ。excludedはスコープと一致する `scope_approval` を持つ。到達不能・対象外を網羅済みの辺として数えない。
- terminalノードは `outcome`（空でないオブジェクト）, `result_basis`（code-derived/observed/contract-derived/unknown）を持つ。outcomeに返却値、観測点、副作用、状態、N/A理由を記す。
- referenceノードは `target_tree_id`, `resume_node_id`, `bindings`（引数/状態の写像）を持つ。戻らない参照はresume_node_id:nullとし `non_returning_reason` を必須にする。
- summaryノードは `summary_contract`（反復/再帰/非同期等の条件、状態変化、出口、限界）を持つ。生の制御フロー循環を木へ埋め込まない。
- `tests`: `id`, `terminal_ids`, `inputs`（非空オブジェクト）, `preconditions`, `actions`, `code_result`, `spec_expected`, `execution_status`。具体値を作れないケースはunresolvedへ入れる。
- `unresolved`: 残件の配列。

主スクリプトはID対応、グラフ構造、結果/テスト対応を検査する。source位置の正しさ、条件の論理、到達可能性、適用すべき分岐の発見、入力例の実行可能性、テストの成否、除外合意の真偽は自動で証明しない。別工程のソース照合・独立検証を必須にする。

## audit.json

対象版、検証手法、独立検証担当、検証が独立していた根拠、各比較の母数・件数・差分、根拠位置照合、指摘、修正、再確認、未解決、ブラウザ操作検証、complete/incompleteを記録する。各判定に実行ログやソースの証拠を関連付ける。

台帳とモデルを同じ誤読から作れば照合は通るため、スクリプトのPASSを完全性の証明と表示しない。ソースから再構築した独立台帳との突合を別に記録する。
