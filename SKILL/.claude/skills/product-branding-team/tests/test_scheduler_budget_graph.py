"""スケジューラー、予算、グラフ検査、複数製品の分離、報告の表現。"""
import copy
import json
import threading
import time
import unittest

from helpers import RunCase, brief
from adapters.mock import MockAdapter, good_artifact
from harness import planner, report, scheduler
from harness.engine import Engine, init_run
from validators.graphcheck import check_graph


class Scheduling(RunCase):
    def test_concurrency_limit_is_respected(self):
        engine, adapter = self.start(settings={"concurrency": 2}, adapter=MockAdapter(delay=lambda r: time.sleep(0.4 if r.task_id in {"customer", "alternatives", "product"} else 0)))
        engine.run()
        self.assertLessEqual(adapter.max_inflight, 2)
        self.assertGreaterEqual(adapter.max_inflight, 2, "並行できる調査は並行する")
        self.assertEqual(engine.store.get_meta("peak_concurrency"), adapter.max_inflight)

    def test_join_waits_for_all_required_inputs(self):
        order = []

        def track(req):
            order.append(req.task_id)
            return good_artifact(req.meta)

        engine, _ = self.start(settings={"concurrency": 3}, script={"customer": [track], "alternatives": [track], "product": [track]})
        engine.run()
        store = engine.store
        gate_start = store.db.execute("SELECT started_at FROM attempts WHERE task_id='info_gate'").fetchone()["started_at"]
        for name in ("customer.rev1", "alternatives.rev1", "product.rev1"):
            finished = store.db.execute("SELECT finished_at FROM attempts WHERE task_id=?", (name,)).fetchone()["finished_at"]
            self.assertLessEqual(finished, gate_start, f"{name} の完了前に合流を始めない")

    def test_review_backlog_defers_new_production(self):
        engine, _ = self.start(settings={"concurrency": 1, "review_backlog_limit": 1})
        engine.run()
        self.assertIn("production_deferred", self.event_types(engine))

    def test_reviews_are_prioritized(self):
        engine, _ = self.start()
        store = engine.store
        for task in ("evidence",):
            store.transition(task, "ready")
        store.add_task(task_id="x.rev1", node_id="x", kind="review", role="V01", state="ready", priority=1)
        picks, _ = scheduler.select(store, 1, 10, 4)
        self.assertEqual(picks[0]["task_id"], "x.rev1")

    def test_budget_exhausted_is_unmet_not_complete(self):
        engine, _ = self.start(budget={"max_calls": 5})
        status = engine.run()
        self.assertEqual(status, "budget_unmet")
        self.assertEqual(engine.store.calls_used(), 5)
        self.assertIn("未完了", engine.store.get_meta("status_reason"))
        self.assertIn("budget_exhausted", self.event_types(engine))

    def test_ceiling_is_computed_from_ledger(self):
        engine, _ = self.start()
        budget = engine.store.budget()
        self.assertGreater(budget["ceiling_from_ledger"], 30)
        self.assertEqual(budget["max_calls"], budget["ceiling_from_ledger"])

    def test_dynamic_task_needs_valid_definition_and_budget(self):
        def ask(req):
            payload = good_artifact(req.meta)
            payload["requested_tasks"] = [
                {"purpose": "競合Aの比較", "role": "M03", "contract": "competitive_comparison", "done_when": "比較表がある"},
                {"purpose": "増員だけ", "role": "X99", "contract": "faq", "done_when": "なし"},
                {"purpose": "", "role": "M03", "contract": "competitive_comparison", "done_when": ""},
            ]
            return payload

        engine, _ = self.start(script={"alternatives": [ask]})
        engine.run()
        self.assertEqual(len(engine.store.events("task_request_registered")), 1)
        self.assertEqual(len(engine.store.events("task_request_rejected")), 2)


class LoadCase(RunCase):
    """50件の作業を少ない同時実行枠で処理する。人間50人分の品質や生産性の証明ではない。"""

    def test_fifty_tasks_three_slots_with_stop_and_resume(self):
        graph = planner.load_graph("minimal")
        nodes = [n for n in graph["nodes"] if n["kind"] == "terminal"]
        base = next(n for n in graph["nodes"] if n["id"] == "evidence")
        edges = []
        prev_layer = []
        ids = []
        for i in range(50):
            node = copy.deepcopy(base)
            node["id"] = f"w{i:02d}"
            node["output"] = f"art{i:02d}"
            node["priority"] = 50
            nodes.append(node)
            ids.append(node["id"])
            # 10件ごとの層で、前の層のすべてを入力にする合流を作る。
            layer = i // 10
            if layer:
                for j in range((layer - 1) * 10, layer * 10):
                    edges.append({"from": f"w{j:02d}", "to": node["id"], "type": "requires"})
        cross = {"id": "final_check", "kind": "crosscheck", "role": "V08", "outcomes": ["accepted", "inconsistent"], "artifacts": ["art49"], "purpose": "最終検査", "budget": {"calls": 3}, "retry": {"same_failure": 1}, "max_iterations": 2}
        nodes.append(cross)
        for i in ids:
            edges.append({"from": i, "to": "final_check", "type": "requires"})
        edges.append({"from": "final_check", "to": "T_complete", "type": "on", "when": ["accepted"]})
        edges.append({"from": "final_check", "to": "final_check", "type": "on", "when": ["inconsistent"], "max_traversals": 2, "on_limit_terminal": "budget_unmet"})
        graph = {"graph_id": "load50", "version": "1", "nodes": nodes, "edges": edges}
        self.assertEqual(planner.check_all(graph), [])
        path = self.dir / "load.json"
        path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")

        counter_lock = threading.Lock()
        executed = {}

        def count(req):
            with counter_lock:
                executed[req.task_id] = executed.get(req.task_id, 0) + 1

        adapter = MockAdapter(delay=count)
        engine, _ = self.start(graph=str(path), adapter=adapter, settings={"concurrency": 3})
        self.assertEqual(engine.run(max_results=40), "paused")
        resumed = self.reopen(engine, adapter)
        self.assertEqual(resumed.run(), "hypothesis_contract_met")
        store = resumed.store

        self.assertLessEqual(adapter.max_inflight, 3)
        works = [t for t in store.tasks(kind="work")]
        self.assertEqual(len(works), 50, "作業が欠落していない")
        self.assertTrue(all(t["state"] == "done" for t in works))
        for task in works:
            self.assertEqual(executed[task["task_id"]], 1, f"{task['task_id']} が二重に実行された")
            self.assertEqual(store.latest_artifact(task["output_artifact"])["version"], 1, "二重に完了していない")
        # 合流の早すぎる開始がないこと：各層は前の層の全作業が完了してから始まる。
        started = {r["task_id"]: r["started_at"] for r in store.db.execute("SELECT task_id, started_at FROM attempts")}
        finished_at = {t["task_id"]: t["finished_at"] for t in works}
        for i in range(10, 50):
            layer = i // 10
            for j in range((layer - 1) * 10, layer * 10):
                self.assertGreaterEqual(started[f"w{i:02d}"], finished_at[f"w{j:02d}"])


def make_graph(**changes):
    graph = copy.deepcopy(planner.load_graph("minimal"))
    graph.update(changes)
    return graph


class GraphChecks(unittest.TestCase):
    def setUp(self):
        self.roles = planner.load_roles()
        self.contracts = planner.load_contracts()

    def errors(self, graph):
        return check_graph(graph, self.roles, self.contracts)

    def test_standard_graphs_pass(self):
        self.assertEqual(self.errors(planner.load_graph("minimal")), [])

    def test_missing_dependency(self):
        graph = make_graph()
        graph["edges"].append({"from": "nope", "to": "select", "type": "requires"})
        self.assertTrue(any("存在しない" in e for e in self.errors(graph)))

    def test_unreachable_node(self):
        graph = make_graph()
        node = copy.deepcopy(next(n for n in graph["nodes"] if n["id"] == "research"))
        node["id"] = "orphan"
        node["output"] = "orphan_out"
        graph["nodes"].append(node)
        graph["edges"].append({"from": "orphan", "to": "T_failed", "type": "on", "when": ["accepted"]})
        self.assertTrue(any("到達できない" in e for e in self.errors(graph)))

    def test_no_exit_path(self):
        graph = make_graph()
        graph["edges"] = [e for e in graph["edges"] if e["to"] != "T_complete" and e["from"] != "final_check"]
        self.assertTrue(any("終了ノードへの経路がない" in e or "行き先がない" in e for e in self.errors(graph)))

    def test_unbounded_cycle(self):
        graph = make_graph()
        for edge in graph["edges"]:
            edge.pop("max_traversals", None)
        self.assertTrue(any("循環に上限" in e for e in self.errors(graph)))

    def test_author_equals_reviewer(self):
        graph = make_graph()
        node = next(n for n in graph["nodes"] if n["id"] == "intro_page")
        node["reviewer"] = node["role"]
        self.assertTrue(any("作成役割と検査役割が同じ" in e for e in self.errors(graph)))

    def test_budget_exit_required(self):
        graph = make_graph()
        graph["nodes"] = [n for n in graph["nodes"] if n["id"] != "T_budget"]
        self.assertTrue(any("budget_unmet" in e for e in self.errors(graph)))

    def test_requires_cycle(self):
        graph = make_graph()
        graph["edges"].append({"from": "select", "to": "customer", "type": "requires"})
        self.assertTrue(any("requires の循環" in e for e in self.errors(graph)))

    def test_decision_outcome_without_route(self):
        graph = make_graph()
        graph["edges"] = [e for e in graph["edges"] if not (e["from"] == "info_gate" and e.get("when") == ["obtainable"])]
        self.assertTrue(any("結果 obtainable の行き先がない" in e for e in self.errors(graph)))

    def test_independent_candidates_cannot_depend_on_each_other(self):
        graph = make_graph()
        graph["edges"].append({"from": "cand_a", "to": "cand_b", "type": "requires"})
        self.assertTrue(any("独立候補" in e for e in self.errors(graph)))


class Scoping(RunCase):
    def test_unknown_deliverable_name_is_refused_with_valid_names(self):
        # 実エージェントでの入口の確認で、「紹介ページ草案」のような名前の不一致があった。
        with self.assertRaises(ValueError) as caught:
            init_run(self.dir / "bad", brief(deliverables=["紹介ページ草案"]), "minimal", MockAdapter()).close()
        self.assertIn("紹介ページ", str(caught.exception))
        self.assertIn("使える名前", str(caught.exception))

    def test_removing_a_middle_node_keeps_the_graph_connected(self):
        for deliverables in (["検証計画"], ["紹介ページ"]):
            graph, removed = planner.scoped_graph(planner.load_graph("minimal"), brief(deliverables=deliverables))
            self.assertEqual(planner.check_all(graph), [], deliverables)
        engine, _ = self.start(brief_data=brief(deliverables=["検証計画"]), name="scoped")
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        self.assertEqual(engine.store.task("intro_page")["state"], "out_of_scope")


class ProductIsolation(RunCase):
    def test_material_of_another_product_is_refused(self):
        data = brief()
        data["materials"].append({"id": "S9", "text": "別製品の顧客情報", "product_id": "other-product"})
        with self.assertRaises(ValueError):
            init_run(self.dir / "mix", data, "minimal", MockAdapter()).close()

    def test_evidence_from_another_product_is_rejected(self):
        engine, _ = self.start()
        store = engine.store
        store.db.execute("INSERT INTO evidence(evidence_id,product_id,source_id,quote,kind,state) VALUES('E900','other','S9','別製品','document_fact','current')")
        payload = good_artifact({"contract": engine.contracts["customer_analysis"], "task_id": "x"})
        payload["claims"] = [{"id": "C1", "text": "x", "type": "fact", "status": "confirmed", "evidence": ["E900"]}]
        from validators.formal import CheckContext, run_checks

        found = run_checks(CheckContext(payload, engine.contracts["customer_analysis"], engine.brief, store, "hikitsugi", self.today))
        self.assertTrue(any("別の製品" in f.reason for f in found))


class ReportWording(RunCase):
    def test_capacity_never_claims_fifty_people(self):
        engine, _ = self.start()
        engine.run()
        cap = report.capacity(engine.store)
        self.assertEqual(cap["fifty_person_status"], "未検証")
        self.assertIn("模擬", cap["mode"])
        self.assertLess(len(cap["roles_activated"]), cap["roles_defined"] + 1)
        out, names = report.export(engine.store, self.dir / "out")
        text = (out / "summary.md").read_text(encoding="utf-8")
        self.assertIn("未検証", text)
        self.assertNotIn("50人分を達成", text)

    def test_replacement_estimate_needs_measured_baseline(self):
        engine, _ = self.start()
        engine.run()
        engine.store.db.execute("INSERT INTO human_log(minutes,activity,created_at) VALUES(30,'確認',0)")
        none = report.replacement_estimate(engine.store, {})
        self.assertEqual(none["gross_minutes"], 0)
        self.assertIsNone(none["net_minutes"])
        guessed = report.replacement_estimate(engine.store, {"landing_page": {"minutes_per_item": 600, "measured": False}})
        self.assertEqual(guessed["gross_minutes"], 0, "実測でない基準時間を使わない")
        measured = report.replacement_estimate(engine.store, {"landing_page": {"minutes_per_item": 120, "measured": True, "basis": "過去3件の実測"}})
        self.assertEqual(measured["net_minutes"], 90)
        self.assertIn("50人分の達成を示さない", measured["note"])

    def test_proposal_has_twenty_sheets_and_summary_keeps_unconfirmed(self):
        engine, _ = self.start()
        engine.run()
        out, _ = report.export(engine.store, self.dir / "out2")
        proposal = (out / "brand-proposal.md").read_text(encoding="utf-8")
        for number in range(1, 21):
            self.assertIn(f"## {number}. ", proposal)
        summary = (out / "summary.md").read_text(encoding="utf-8")
        self.assertIn("未確認のまま残っている主張", summary)
        self.assertIn("hypothesis", summary)

    def test_debate_log_shows_reply_chain_and_mock_label(self):
        engine, _ = self.start()
        engine.run()
        out, _ = report.export(engine.store, self.dir / "out3")
        log = (out / "debate-log.md").read_text(encoding="utf-8")
        self.assertIn("模擬", log)
        self.assertIn("応答先", log)
        self.assertIn("批判：", log)


if __name__ == "__main__":
    unittest.main()
