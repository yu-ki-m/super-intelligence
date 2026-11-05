"""50役割の標準グラフを模擬実装で確かめる。

これは状態制御の負荷試験であり、人間50人分の品質や生産性の証明ではない。
"""
import json
import unittest

from helpers import RunCase, brief
from adapters.mock import MockAdapter, good_artifact
from harness import planner, report


NO_CASE = ["紹介ページ", "検証計画", "短い紹介文", "営業資料", "デモ", "FAQ", "視覚表現", "接点表", "価格比較", "ブランド関係"]


def case_with_real_results(req):
    """実際の顧客の発言を根拠にした事例。実績がなければ D05 は保留になる。"""
    quote = "担当者が不在の日は、共有表の更新が止まる。"
    return {"document": "## 事例\n\n窓口の担当者は、不在の日に共有表の更新が止まると話した。",
            "new_evidence": [{"id": "N1", "source_id": "S1", "kind": "customer_statement", "quote": quote}],
            "claims": [{"id": "C1", "text": "不在の日に更新が止まる", "type": "customer_statement", "status": "confirmed", "evidence": ["N1"]}]}


class StandardGraph(RunCase):
    graph = "standard"

    def test_definition_passes_and_covers_fifty_roles(self):
        graph = planner.load_graph("standard")
        roles = planner.load_roles()
        self.assertEqual(planner.check_all(graph, roles), [])
        self.assertEqual(len(roles), 50)
        used = set()
        for node in graph["nodes"]:
            if node.get("role"):
                used.add(node["role"])
            used |= set(node.get("critics", []))
        self.assertEqual(sorted(set(roles) - used), [], "どのノードにも割り当てられていない役割がない")

    def test_role_catalog_has_independent_definition(self):
        for role in planner.load_roles().values():
            for field in ("inputs", "work", "deliverable", "done_when", "reviewer", "responsibility", "artifact_type"):
                self.assertTrue(role.get(field), f"{role['id']} の {field}")
            self.assertNotEqual(role["id"], role["reviewer"], "作成役割と検査役割を分ける")

    def test_groups_match_requested_counts(self):
        counts = {}
        for role in planner.load_roles().values():
            counts[role["group"]] = counts.get(role["group"], 0) + 1
        self.assertEqual(counts, {"統括・進行": 4, "顧客・利用状況": 8, "市場・代替手段": 7, "製品・提供体験": 7, "ブランド戦略": 8, "制作・具体化": 8, "評価・反証・検証": 8})

    def test_full_run_with_few_slots_and_resume(self):
        adapter = MockAdapter({"D05": [case_with_real_results]})
        engine, _ = self.start(adapter=adapter, settings={"concurrency": 3}, brief_data=brief(stage="offering"))
        self.assertEqual(engine.run(max_results=60), "paused")
        resumed = self.reopen(engine, adapter)
        status = resumed.run()
        self.assertEqual(status, "hypothesis_contract_met", resumed.store.get_meta("status_reason"))
        cap = report.capacity(resumed.store)
        self.assertEqual(cap["roles_defined"], 50)
        self.assertEqual(len(cap["roles_activated"]), 50)
        self.assertLessEqual(cap["peak_concurrency"], 3)
        self.assertEqual(cap["fifty_person_status"], "未検証")
        works = resumed.store.tasks(kind="work")
        self.assertTrue(all(t["state"] == "done" for t in works))
        # 二重に完了した作業がない。
        for task in works:
            self.assertEqual(resumed.store.latest_artifact(task["output_artifact"])["version"], 1 if task["output_artifact"] not in {"candidate_a", "candidate_b", "adopted_strategy"} else resumed.store.latest_artifact(task["output_artifact"])["version"])
        # 相互批評の前に依存先が完了している。
        started = {r["task_id"]: r["started_at"] for r in resumed.store.db.execute("SELECT task_id, MIN(started_at) started_at FROM attempts GROUP BY task_id")}
        issue_plan_done = resumed.store.task("issue_plan")["finished_at"]
        self.assertGreaterEqual(started["debate_target.r1.crit.C01"], issue_plan_done)

    def test_case_study_without_results_holds_the_whole_set(self):
        engine, _ = self.start(brief_data=brief(stage="offering"))
        self.assertEqual(engine.run(), "on_hold_missing_info")
        self.assertEqual(engine.store.task("D05")["state"], "on_hold")
        self.assertFalse(engine.store.latest_of_node("final_check") and engine.store.db.execute("SELECT 1 FROM bundles WHERE state='accepted'").fetchone() and engine.store.run_status() == "contract_met")

    def test_scope_excludes_unrequested_roles_with_reason(self):
        data = brief(deliverables=["紹介ページ", "検証計画"], stage="concept")
        engine, _ = self.start(brief_data=data, budget={"max_calls": 500})
        store = engine.store
        excluded = {t["task_id"]: t["note"] for t in store.tasks(state="out_of_scope")}
        self.assertIn("D07", excluded, "名称や視覚表現を扱わない依頼では作らない")
        self.assertIn("依頼された成果物", excluded["D07"])
        self.assertIn("C07", excluded, "構想段階では継続・解約の資料がない")
        self.assertIn("提供段階", excluded["C07"])
        status = engine.run()
        self.assertEqual(status, "hypothesis_contract_met", store.get_meta("status_reason"))
        bundle = store.db.execute("SELECT manifest FROM bundles WHERE state='accepted'").fetchone()
        names = {m["artifact_id"] for m in json.loads(bundle["manifest"])}
        self.assertNotIn("d07", names)
        self.assertIn("d02", names)

    def test_integration_critique_returns_adopted_strategy_to_review(self):
        def respond(req):
            payload = good_artifact({"contract": req.meta["contract"], "task_id": req.attempt_id, "carry_ids": []})
            carry = [r["message_id"] for r in engine.carry_forward_items()]
            payload["structured"]["carried_forward"] = [{"message_id": m, "handling": "本文で扱った"} for m in carry]
            return {"responses": [{"in_reply_to": m, "action": "accept_revise", "body": "反映漏れを直す", "reason": "批判は妥当である"} for m in req.meta["open_critiques"]],
                    "revised_document": payload["document"] + "\n\n討論を受けて修正した。", "revised_structured": payload["structured"], "kept": "利用場面の具体性"}

        engine, _ = self.start(brief_data=brief(stage="offering", deliverables=NO_CASE), script={"debate_integration.r1.resp.adopted_strategy": [respond]})
        status = engine.run()
        self.assertEqual(status, "hypothesis_contract_met", engine.store.get_meta("status_reason"))
        store = engine.store
        self.assertGreaterEqual(store.latest_artifact("adopted_strategy")["version"], 2)
        reviews = store.db.execute("SELECT version FROM reviews WHERE artifact_id='adopted_strategy' AND kind='content' AND gate_verdict='pass' ORDER BY version DESC").fetchone()
        self.assertEqual(reviews["version"], store.latest_artifact("adopted_strategy")["version"], "統合結果の修正版も別担当が検査する")

    def test_issue_plan_changes_participants_after_validation(self):
        def plan(req):
            payload = good_artifact(req.meta)
            payload["structured"] = {"issues": {
                "debate_target": {"title": "責任者と担当者のどちらを優先するか", "why": "判断者が異なる", "critics": ["C02", "C03"]},
                "debate_change": {"critics": ["X99"]},
            }}
            return payload

        engine, _ = self.start(brief_data=brief(stage="offering", deliverables=NO_CASE), script={"issue_plan": [plan]})
        engine.run()
        self.assertEqual(engine.debate.issue("I-debate_target")["title"], "責任者と担当者のどちらを優先するか")
        self.assertEqual(json.loads(engine.debate.issue("I-debate_target")["critics"]), ["C02", "C03"])
        self.assertIn("issue_plan_critics_rejected", self.event_types(engine), "検査を通らない参加者は採用しない")


if __name__ == "__main__":
    unittest.main()
