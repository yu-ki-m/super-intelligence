"""状態遷移、不良成果物の拒否から修正・再検査まで、修正上限の扱い。"""
import unittest

from helpers import RunCase, brief
from adapters.mock import bad_review, good_artifact, good_review
from harness.states import CompletionDenied, IllegalTransition


def headings_only(req):
    payload = good_artifact(req.meta)
    payload["document"] = "\n\n".join(f"## {h}" for h in ["課題", "解決策", "導入事例"])
    return payload


class MinimalFlow(RunCase):
    def test_runs_to_hypothesis_status_and_label_is_simulated(self):
        engine, _ = self.start()
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        self.assertTrue(engine.store.get_meta("simulated"))
        # 検査はすべて作成者と別のインスタンスで行われている。
        for review in engine.store.tasks(kind="review"):
            attempt = engine.store.db.execute("SELECT instance_id FROM attempts WHERE task_id=?", (review["task_id"],)).fetchone()
            self.assertNotIn(attempt["instance_id"], review["data"]["forbidden_instances"])

    def test_every_role_call_is_recorded(self):
        engine, adapter = self.start()
        engine.run()
        self.assertEqual(engine.store.calls_used(), len(adapter.calls))


class CompletionControl(RunCase):
    def test_artifact_alone_cannot_complete(self):
        engine, _ = self.start()
        engine.store.transition("evidence", "ready")
        engine.store.transition("evidence", "running")
        engine.store.publish_artifact("evidence_register", "evidence", "x@1", "本文", [], {}, [], [])
        engine.store.transition("evidence", "awaiting_review")
        with self.assertRaises(CompletionDenied):
            engine.store.transition("evidence", "done")
        self.assertIn("completion_denied", self.event_types(engine))

    def test_illegal_transition_is_denied(self):
        engine, _ = self.start()
        with self.assertRaises(IllegalTransition):
            engine.store.transition("evidence", "done")
        self.assertIn("transition_denied", self.event_types(engine))

    def test_failed_task_cannot_be_made_out_of_scope(self):
        engine, _ = self.start(script={"evidence": [{"bad": 1}, {"bad": 2}]})
        engine.run()
        self.assertEqual(engine.store.task("evidence")["state"], "failed")
        with self.assertRaises(IllegalTransition):
            engine.store.transition("evidence", "out_of_scope", "やめる")

    def test_agent_cannot_set_completion_state(self):
        def tries_to_complete(req):
            payload = good_artifact(req.meta)
            payload["state"] = "done"
            return payload

        engine, _ = self.start(script={"evidence": [tries_to_complete]})
        engine.run()
        self.assertIn("forbidden_state_change", self.event_types(engine))
        # 不正な出力は成果物にならず、再試行された版が検査を受ける。
        self.assertEqual(engine.store.latest_artifact("evidence_register")["version"], 1)
        self.assertEqual(engine.store.task("evidence")["retries_used"], 1)


class RejectAndRevise(RunCase):
    def test_bad_artifact_traceable_from_injection_to_recheck(self):
        engine, _ = self.start(script={"intro_page": [headings_only]})
        status = engine.run()
        self.assertEqual(status, "hypothesis_contract_met")
        store = engine.store
        first = store.artifact("intro_page", 1)
        second = store.artifact("intro_page", 2)
        self.assertEqual(first["status"], "rejected")
        self.assertEqual(second["status"], "accepted")
        machine = store.db.execute("SELECT * FROM reviews WHERE artifact_id='intro_page' AND version=1").fetchone()
        self.assertEqual((machine["reviewer"], machine["gate_verdict"]), ("machine", "fail"))
        defect = store.db.execute("SELECT * FROM defects WHERE artifact_id='intro_page'").fetchone()
        self.assertEqual(defect["state"], "resolved")
        self.assertEqual(defect["category"], "production_gap")
        # 同じ記録で、投入→拒否→差し戻し先→修正版→再検査の順にたどれる。
        types = [e["type"] for e in store.events(task_id="intro_page")]
        self.assertLess(types.index("artifact_rejected"), types.index("routed_to_revise"))
        self.assertTrue(store.task("intro_page.fix1"))
        self.assertEqual(store.db.execute("SELECT version FROM reviews WHERE artifact_id='intro_page' AND gate_verdict='pass'").fetchone()["version"], 2)

    def test_content_rejection_routes_by_category(self):
        def review_fail(req):
            return bad_review(req.meta, "比較優位の根拠がない", "inference_error")

        engine, _ = self.start(script={"intro_page.rev1": [review_fail]})
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        self.assertEqual(engine.store.task("intro_page")["revisions_used"], 1)
        self.assertEqual(engine.store.task("intro_page.fix1")["state"], "done")

    def test_same_major_defect_twice_triggers_diagnosis_and_new_author(self):
        def fail_same(req):
            return bad_review(req.meta, "変更理由がない", "inference_error")

        engine, adapter = self.start(script={"intro_page.rev1": [fail_same], "intro_page.rev2": [fail_same]})
        engine.run()
        store = engine.store
        self.assertIn("routed_to_diagnosis", self.event_types(engine))
        self.assertEqual(store.task("intro_page.diag")["state"], "done")
        fix1 = store.db.execute("SELECT instance_id FROM attempts WHERE task_id='intro_page.fix1'").fetchone()["instance_id"]
        fix2 = store.db.execute("SELECT instance_id FROM attempts WHERE task_id='intro_page.fix2'").fetchone()["instance_id"]
        self.assertNotEqual(fix1, fix2, "原因診断の後は別の作成担当が書き直す")

    def test_two_findings_in_one_review_are_not_a_repeat(self):
        # 実エージェントの実行で、1回の検査の複数の指摘を「2回続いた」と数えた不具合があった。
        def two_problems(req):
            payload = good_artifact(req.meta)
            payload["document"] = "## 価値\n\n依頼を自動割り当てする。\n\nSlack で知らせる。"
            return payload

        engine, _ = self.start(brief_data=brief(planned_features=[
            {"name": "自動割り当て", "keywords": ["自動割り当て"]}, {"name": "Slack通知", "keywords": ["Slack"]}]),
            script={"intro_page": [two_problems]})
        engine.run()
        self.assertNotIn("routed_to_diagnosis", self.event_types(engine))
        self.assertEqual(engine.store.task("intro_page")["revisions_used"], 1)

    def test_same_machine_finding_in_consecutive_reviews_counts_as_repeat(self):
        def bad(req):
            payload = good_artifact(req.meta)
            payload["document"] = "## 価値\n\n依頼を自動割り当てする。"
            return payload

        engine, _ = self.start(script={"intro_page": [bad], "intro_page.fix1": [bad]})
        engine.run()
        self.assertIn("routed_to_diagnosis", self.event_types(engine))

    def test_temporary_evidence_ids_are_replaced_in_body(self):
        quote = "担当者が不在の日は、共有表の更新が止まる。"

        def cite(req):
            payload = good_artifact(req.meta)
            payload["document"] += "\n\n更新が止まる（N1）。"
            payload["new_evidence"] = [{"id": "N1", "source_id": "S1", "kind": "document_fact", "quote": quote}]
            payload["claims"] = [{"id": "C1", "text": "更新が止まる（N1）", "type": "fact", "status": "confirmed", "evidence": ["N1"]}]
            return payload

        engine, _ = self.start(script={"customer": [cite]})
        engine.run()
        store = engine.store
        art = store.latest_artifact("customer_analysis")
        text = store.read_artifact(art)
        evidence_id = store.claims_of("customer_analysis", art["version"])[0]["evidence"][0]
        self.assertTrue(evidence_id.startswith("E"))
        self.assertIn(f"（{evidence_id}）", text)
        self.assertNotIn("N1", text)

    def test_failed_research_note_is_retried_then_holds_without_a_version(self):
        def bad_review_info(req):
            from adapters.mock import bad_review
            return bad_review(req.meta, "判断に必要な資料がない", "info_missing")

        def bad_note(req):
            return {"document": "## 調査\n\n不足を調べた。", "new_evidence": [{"id": "N1", "source_id": "S9", "kind": "document_fact", "quote": "なし"}],
                    "claims": [{"id": "C1", "text": "x", "type": "fact", "status": "hypothesis", "evidence": ["N1"]}]}

        engine, _ = self.start(script={"customer.rev1": [bad_review_info], "customer.res1": [bad_note, bad_note]})
        self.assertEqual(engine.run(), "on_hold_missing_info")
        store = engine.store
        self.assertEqual(store.task("customer.res1")["retries_used"], 1)
        self.assertIsNone(store.latest_artifact("customer_research1"), "受理されなかった調査は版にしない")
        self.assertEqual(store.task("customer")["state"], "on_hold")

    def test_revision_limit_is_not_success(self):
        def fail(req):
            return bad_review(req.meta, "変更理由がない", "inference_error")

        engine, _ = self.start(script={"intro_page.rev*": [fail, fail, fail, fail]})
        status = engine.run()
        self.assertEqual(status, "budget_unmet")
        store = engine.store
        self.assertEqual(store.task("intro_page")["state"], "failed")
        self.assertEqual(store.task("intro_page")["outcome"], "revision_limit")
        self.assertNotIn("bundle_accepted", self.event_types(engine))
        self.assertEqual(store.latest_artifact("intro_page")["status"], "rejected")

    def test_small_change_requires_second_reviewer(self):
        def fail(req):
            return bad_review(req.meta, "対象が曖昧である", "production_gap")

        def tiny_fix(req):
            document = req.prompt  # 使わない
            del document
            previous = (self.dir / "run" / "artifacts" / "intro_page" / "v1.md").read_text(encoding="utf-8")
            payload = good_artifact(req.meta)
            payload["document"] = previous + "。"
            payload["changes"] = [{"defect_id": d, "what_changed": "語句を変えた", "why_resolved": "解消した"} for d in req.meta.get("open_defects", [])]
            return payload

        engine, _ = self.start(script={"intro_page.rev1": [fail], "intro_page.fix1": [tiny_fix]})
        engine.run()
        self.assertIn("suspicious_small_fix", self.event_types(engine))
        # 再確認は最初の合格判定とは別のインスタンスが行う。
        rev2 = engine.store.db.execute("SELECT instance_id FROM attempts WHERE task_id='intro_page.rev2'").fetchone()["instance_id"]
        rev3 = engine.store.db.execute("SELECT instance_id FROM attempts WHERE task_id='intro_page.rev3'").fetchone()["instance_id"]
        self.assertNotEqual(rev2, rev3)

    def test_reviewer_error_can_be_withdrawn_after_rebuttal(self):
        def fail(req):
            return bad_review(req.meta, "根拠がない", "inference_error")

        def rebut(req):
            payload = good_artifact(req.meta)
            payload["document"] += "\n\n根拠の場所を本文に示した。"
            payload["rebuttals"] = [{"defect_id": d, "argument": "根拠は資料 S1 にある"} for d in req.meta.get("open_defects", [])]
            return payload

        seen = {}

        def review_after(req):
            seen["prompt"] = req.prompt
            review = good_review(req.meta)
            review["resolved_defects"] = [{"defect_id": d, "resolved": True, "how": "撤回：反証のとおり資料 S1 に根拠があった"} for d in req.meta.get("open_defects", [])]
            return review

        engine, _ = self.start(script={"intro_page.rev1": [fail], "intro_page.fix1": [rebut], "intro_page.rev2": [review_after]})
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        self.assertIn("作成者からの反証", seen["prompt"])
        row = engine.store.db.execute("SELECT * FROM defects WHERE artifact_id='intro_page'").fetchone()
        self.assertEqual(row["state"], "resolved")
        self.assertIn("撤回", row["resolution"])

    def test_case_study_without_results_is_held_not_passed(self):
        from harness import planner

        graph = planner.load_graph("minimal")
        node = next(n for n in graph["nodes"] if n["id"] == "intro_page")
        node["contract"] = "case_study"
        path = self.dir / "g.json"
        import json

        path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
        engine, _ = self.start(graph=str(path), script={"intro_page": [lambda req: {"document": "## 事例\n導入で改善した。", "claims": [{"id": "C1", "text": "改善した", "type": "fact", "status": "hypothesis"}]}]})
        self.assertEqual(engine.run(), "on_hold_missing_info")
        self.assertEqual(engine.store.task("intro_page")["state"], "on_hold")


class ContractPinning(RunCase):
    def test_contract_is_pinned_at_start(self):
        engine, _ = self.start()
        task = engine.store.task("intro_page")
        pinned = engine.store.contract(task["contract_id"], task["contract_sha"])
        self.assertEqual(pinned["id"], "landing_page")
        # 実行中に基準の定義を変えても、固定された版の判定基準は変わらない。
        engine.contracts["landing_page"]["pass_criteria"] = []
        self.assertTrue(engine.store.contract(task["contract_id"], task["contract_sha"])["pass_criteria"])

    def test_lowered_contract_keeps_original_unmet(self):
        engine, _ = self.start()
        engine.record_contract_change("intro_page", {**engine.contracts["landing_page"], "pass_criteria": [], "version": "1.0-lowered"}, "失敗が続いたので基準を下げたい", "紹介ページの基準を下げる")
        status = engine.run()
        self.assertEqual(status, "on_hold_missing_info")
        self.assertIn("元の条件では未達", engine.store.get_meta("status_reason"))
        self.assertIn("changed_contract", engine.store.latest_artifact("intro_page")["delivery_class"])

    def test_out_of_scope_role_records_reason(self):
        engine, _ = self.start(brief_data=brief(deliverables=["検証計画"]))
        task = engine.store.task("intro_page")
        self.assertEqual(task["state"], "out_of_scope")
        self.assertIn("紹介ページ", task["note"])


if __name__ == "__main__":
    unittest.main()
