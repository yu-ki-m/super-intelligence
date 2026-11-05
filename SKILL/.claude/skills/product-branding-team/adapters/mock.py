"""模擬実装。状態制御の試験だけに使い、内容の品質や実接続の証拠にしない。

結果には必ず simulated=True が付き、実行の記録と報告に「模擬」と表示される。
"""
from __future__ import annotations

import fnmatch
import threading
from pathlib import Path

from .base import Adapter, AgentRequest, AgentResult, Capability


def good_artifact(meta):
    contract = meta.get("contract") or {}
    headings = contract.get("required_headings") or ["内容"]
    document = "\n\n".join(f"## {h}\n架空の試験用の本文である。{meta.get('task_id')} の内容を記す。" for h in headings)
    structured = dict(contract.get("structured_example") or {})
    if contract.get("id") == "adopted_strategy":
        structured["carried_forward"] = [{"message_id": mid, "handling": "本文で扱った"} for mid in meta.get("carry_ids", [])]
    if contract.get("id") == "brand_strategy" and str(meta.get("task_id", "")).endswith("b"):
        # 独立候補の試験では、対象と価値が異なる案を返す。
        structured["target"] = "架空：複数拠点の問い合わせを統括する責任者"
        structured["value"] = "架空：拠点ごとの未割り当てを週次で見直せる"
    return {
        "document": document,
        "structured": structured,
        "claims": [{"id": "C1", "text": f"{meta.get('task_id')} の仮説である", "type": "inference", "status": "hypothesis"}],
    }


def good_review(meta):
    contract = meta.get("contract") or {}
    return {
        "verdict": "pass",
        "contract_results": [{"criterion": c["id"], "met": True, "reason": "基準を満たす"} for c in contract.get("pass_criteria", [])],
        "defects": [],
        "resolved_defects": [{"defect_id": d, "resolved": True, "how": "修正で解消した"} for d in meta.get("open_defects", [])],
    }


def bad_review(meta, reason="判断に必要な内容がない", category="production_gap"):
    contract = meta.get("contract") or {}
    criteria = contract.get("pass_criteria", [])
    return {
        "verdict": "fail",
        "contract_results": [{"criterion": c["id"], "met": i != 0, "reason": reason, "location": "全体"} for i, c in enumerate(criteria)],
        "defects": [{"severity": "major", "category": category, "criterion": criteria[0]["id"] if criteria else "", "location": "全体", "reason": reason, "fix_condition": "内容を具体的に書く"}],
        "resolved_defects": [{"defect_id": d, "resolved": False, "how": "解消していない"} for d in meta.get("open_defects", [])],
    }


def default_payload(req: AgentRequest):
    meta = req.meta
    kind = req.kind
    if kind in {"work", "research", "revise"}:
        payload = good_artifact(meta)
        if kind == "revise":
            payload["changes"] = [{"defect_id": d, "what_changed": "該当箇所を書き直した", "why_resolved": "修正条件を満たした"} for d in meta.get("open_defects", [])]
            payload["document"] += f"\n\n## 修正の記録\n{req.attempt_id} で修正した。修正内容の説明を十分に追加し、変更量を増やす。" * 3
        return payload
    if kind == "review":
        return good_review(meta)
    if kind == "decide":
        return {"branch": (meta.get("outcomes") or ["sufficient"])[0], "reason": "判断に必要な情報がそろっている"}
    if kind == "crosscheck":
        # 模擬実装は確認依頼をすべて確定する。退ける判断は試験ごとに指定する。
        return {"verdict": "consistent", "vertical": [], "horizontal": [], "defects": [],
                "flag_rulings": [{"flag_id": f, "ruling": "confirmed", "reason": "模擬：確定"} for f in meta.get("flags", [])]}
    if kind == "diagnose":
        return {"cause": "同じ修正の繰り返しである", "route": "revise", "instructions": "別の方法で書き直す"}
    if kind == "critique":
        proposals = meta.get("proposals") or []
        return {"messages": [{
            "kind": "critique", "to_role": "B08", "target_artifact": p, "target_claim": "C1", "quote": "仮説である",
            "body": f"{p} は現状維持から変える理由が弱い。誰のどの判断が変わるかが書かれていない。",
            "reason": "変更負担を上回る理由が示されていない", "severity": "major", "dispute_type": "inference",
            "keep_strength": "利用場面を特定した点は残す",
        } for p in proposals]}
    if kind == "respond":
        return {
            "responses": [{"in_reply_to": mid, "action": "accept_revise", "body": "条件を補って修正する", "reason": "批判は妥当である"}
                          for mid in meta.get("open_critiques", []) if mid.startswith("M")],
            "revised_document": good_artifact({"contract": meta.get("contract") or {"required_headings": ["案"]}, "task_id": req.attempt_id})["document"] + "\n\n修正した。",
            "kept": "利用場面の具体性は維持した",
        }
    if kind == "reeval":
        return {"judgments": [{
            "about_critique": p["critique"], "in_reply_to": p["response"], "judgment": "resolved",
            "body": "条件の追加で変更理由が読み取れるようになった。", "reason": "修正で解消した",
        } for p in meta.get("pairs", [])]}
    raise ValueError(f"模擬実装が扱えない種類: {kind}")


class MockAdapter(Adapter):
    """script は {作業IDの型: [試行ごとの動作, ...]} である。

    動作には、そのまま返す出力の辞書、AgentResult、または AgentRequest を受け取る関数を指定できる。
    """

    name = "mock"
    simulated = True

    def __init__(self, script=None, spawn=True, resume=True, delay=None):
        self.script = script or {}
        self.spawn = spawn
        self.resume = resume
        self.delay = delay
        self.calls = []
        self._counts = {}
        self._lock = threading.Lock()
        self.max_inflight = 0
        self._inflight = 0

    def probe(self, workdir: Path) -> Capability:
        return Capability(self.name, simulated=True, spawn=self.spawn, resume=self.resume, structured_result=True,
                          relay=True, notes=["模擬実装。実サブエージェントは起動していない"])

    def invoke(self, req: AgentRequest) -> AgentResult:
        with self._lock:
            self.calls.append(req)
            self._inflight += 1
            self.max_inflight = max(self.max_inflight, self._inflight)
        try:
            if self.delay:
                self.delay(req)
            behavior = self._behavior(req)
            if behavior is None:
                payload = self._with_context(req, default_payload(req))
                return AgentResult(True, payload=payload, session_id=f"mock-{req.instance_id}", simulated=True, tokens_in=10, tokens_out=10)
            if callable(behavior):
                behavior = behavior(req)
            if isinstance(behavior, AgentResult):
                behavior.simulated = True
                if behavior.ok and not behavior.session_id:
                    behavior.session_id = f"mock-{req.instance_id}"
                return behavior
            return AgentResult(True, payload=behavior, session_id=f"mock-{req.instance_id}", simulated=True)
        finally:
            with self._lock:
                self._inflight -= 1

    @staticmethod
    def _with_context(req, payload):
        return payload

    def _behavior(self, req):
        for pattern, steps in self.script.items():
            if fnmatch.fnmatchcase(req.task_id, pattern):
                with self._lock:
                    index = self._counts.get(pattern, 0)
                    self._counts[pattern] = index + 1
                if index < len(steps):
                    return steps[index]
                return None
        return None
