"""作業の状態、許される遷移、実行全体の終了状態を定義する。

状態を変更できるのはハーネスだけである。エージェントの出力には状態を変更する
手段がなく、状態に関する項目が出力に含まれていた場合は engine が拒否する。
"""

TASK_STATES = {
    "pending": "未着手",
    "ready": "実行可能",
    "running": "実行中",
    "awaiting_review": "検査待ち",
    "revising": "修正中",
    "done": "完了",
    "on_hold": "保留",
    "failed": "失敗",
    "out_of_scope": "対象外",
}

# 対象外へ移せるのは、まだ一度も実行していない作業だけである。
# 失敗が続いた作業を対象外へ変えて未達を隠すことはできない。
TRANSITIONS = {
    "pending": {"ready", "on_hold", "failed", "out_of_scope"},
    "ready": {"running", "pending", "on_hold", "failed", "out_of_scope"},
    "running": {"ready", "awaiting_review", "revising", "done", "on_hold", "failed"},
    "awaiting_review": {"done", "revising", "on_hold", "failed"},
    "revising": {"awaiting_review", "on_hold", "failed"},
    # 完了後に戻れるのは、入力や上流の変更で合格が無効になったときだけである。
    "done": {"awaiting_review", "revising"},
    "on_hold": {"ready", "failed"},
    "failed": set(),
    "out_of_scope": set(),
}

SETTLED_TASK_STATES = {"done", "failed", "on_hold", "out_of_scope"}

RUN_STATUS = {
    "created": "作成済み",
    "running": "実行中",
    "paused": "一時停止",
    "contract_met": "品質契約充足",
    "hypothesis_contract_met": "仮説案の契約充足",
    "on_hold_missing_info": "資料不足による保留",
    "budget_unmet": "予算上限による未達",
    "execution_failed": "実行失敗",
    "aborted": "中止",
}
TERMINAL_RUN_STATUS = {
    "contract_met",
    "hypothesis_contract_met",
    "on_hold_missing_info",
    "budget_unmet",
    "execution_failed",
    "aborted",
}

# エージェントが状態を書き換えようとしたと判断する、出力の最上位の項目名。
FORBIDDEN_OUTPUT_KEYS = {
    "state",
    "task_state",
    "new_state",
    "status_override",
    "mark_complete",
    "completed",
    "gate_result",
}

DEFECT_CATEGORIES = {
    "info_missing": "情報不足",
    "inference_error": "推論の誤り",
    "target_selection": "対象選択の問題",
    "production_gap": "制作不足",
    "cross_doc": "成果物間の矛盾",
    "review_error": "検査の誤り",
}


class IllegalTransition(Exception):
    """許されない状態遷移を試みたことを示す。"""


class CompletionDenied(Exception):
    """完了条件を満たしていない作業を完了にしようとしたことを示す。"""
