"""実行可能な作業の選択。依存関係は engine が解決済みで、ここでは順序と枠だけを決める。"""
from __future__ import annotations

REVIEW_KINDS = {"review", "crosscheck"}
DEBATE_KINDS = {"critique", "respond", "reeval"}
AGENT_KINDS = {"work", "research", "revise", "review", "critique", "respond", "reeval", "decide", "crosscheck", "diagnose"}


def select(store, slots, remaining_calls, backlog_limit=4):
    """同時実行枠と残りの呼び出し数の範囲で、次に実行する作業を選ぶ。

    検査待ちが多いときは新しい作成を止めて検査へ枠を割り当てる。作るだけで検査されない
    成果物が増えると、手戻りが後の工程へ持ち越されるためである。
    """
    if slots <= 0:
        return [], {}
    ready = [t for t in store.tasks(state="ready") if t["kind"] in AGENT_KINDS]
    if not ready:
        return [], {}
    backlog = sum(1 for t in ready if t["kind"] in REVIEW_KINDS)
    backlog += store.db.execute(
        "SELECT COUNT(*) c FROM tasks WHERE state='running' AND kind IN ('review','crosscheck')"
    ).fetchone()["c"]
    defer_production = backlog >= backlog_limit
    info = {"backlog": backlog, "defer_production": defer_production}

    def rank(task):
        is_check = task["kind"] in REVIEW_KINDS
        is_debate = task["kind"] in DEBATE_KINDS
        return (0 if is_check else 1 if is_debate else 2, -task["priority"], task["created_at"], task["task_id"])

    deferred = [t["task_id"] for t in ready if defer_production and t["kind"] in {"work", "research"}]
    candidates = [t for t in sorted(ready, key=rank) if t["task_id"] not in deferred]
    info["deferred"] = deferred
    return candidates[: max(0, min(slots, remaining_calls))], info
