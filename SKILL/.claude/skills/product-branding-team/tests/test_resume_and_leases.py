"""永続化と実行の整合性。停止からの再開、競合、遅れて届く結果、実行環境の制約を確かめる。"""
import time
import unittest

from helpers import RunCase, brief
from adapters.base import AgentResult, UnavailableAdapter
from adapters.mock import MockAdapter, good_artifact
from harness import leases
from harness.engine import Engine, SimulatedCrash, init_run
from harness.store import Store


class ResumeFromCrash(RunCase):
    def test_crash_then_resume_does_not_repeat_finished_work(self):
        engine, adapter = self.start(crash_after=6)
        with self.assertRaises(SimulatedCrash):
            engine.run()
        calls_before = len(adapter.calls)
        done_before = {t["task_id"] for t in engine.store.tasks(state="done")}
        self.assertTrue(done_before)
        adapter2 = MockAdapter()
        resumed = self.reopen(engine, adapter2)
        self.assertEqual(resumed.run(), "hypothesis_contract_met")
        rerun = {r.task_id for r in adapter2.calls} & done_before
        self.assertEqual(rerun, set(), "成功済みの作業を再実行しない")
        self.assertLess(len(adapter2.calls), 40)
        self.assertEqual(calls_before, 6)
        self.assertIn("recovered", self.event_types(resumed))

    def test_crash_during_debate_preserves_messages_and_continues(self):
        engine, _ = self.start(crash_after=13)
        with self.assertRaises(SimulatedCrash):
            engine.run()
        before = engine.store.db.execute("SELECT COUNT(*) c FROM messages").fetchone()["c"]
        resumed = self.reopen(engine, MockAdapter())
        self.assertEqual(resumed.run(), "hypothesis_contract_met")
        after = resumed.store.db.execute("SELECT COUNT(*) c FROM messages").fetchone()["c"]
        self.assertGreaterEqual(after, before)
        # 応答済みの批判が再び転送されて二重に応答されていない。
        for m in resumed.debate.messages("I-debate_strategy", kind="critique"):
            count = resumed.store.db.execute("SELECT COUNT(*) c FROM messages WHERE kind='respond' AND in_reply_to=?", (m["message_id"],)).fetchone()["c"]
            self.assertEqual(count, 1)

    def test_orphaned_attempt_is_marked_and_retried(self):
        engine, _ = self.start()
        store = engine.store
        store.transition("evidence", "ready")
        task = store.task("evidence")
        grant = leases.claim(store, task, "I-orphan", [], 100)
        self.assertIsNotNone(grant)
        resumed = self.reopen(engine, MockAdapter())
        self.assertEqual(resumed.run(), "hypothesis_contract_met")
        row = resumed.store.db.execute("SELECT status FROM attempts WHERE attempt_id=?", (grant["attempt_id"],)).fetchone()
        self.assertEqual(row["status"], "interrupted")

    def test_partial_file_is_not_published(self):
        engine, _ = self.start()
        store = engine.store
        tmp = store.run_dir / "artifacts" / "intro_page" / "v1.md.tmp999"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text("途中までの内容", encoding="utf-8")
        engine.recover()
        self.assertFalse(tmp.exists())

    def test_pause_by_stop_request_and_resume(self):
        engine, _ = self.start()
        engine.store.set_meta("stop_requested", True)
        # run は開始時に停止要求を解除するので、結果の件数で一時停止を試す。
        self.assertEqual(engine.run(max_results=3), "paused")
        self.assertEqual(engine.store.calls_used(), 3)
        self.assertEqual(engine.run(), "hypothesis_contract_met")

    def test_external_effect_is_not_retried_automatically(self):
        engine, _ = self.start()
        for node in engine.graph["nodes"]:
            if node["id"] == "evidence":
                node["external_effect"] = True
        store = engine.store
        store.transition("evidence", "ready")
        leases.claim(store, store.task("evidence"), "I-x", [], 100)
        engine.recover()
        self.assertEqual(store.task("evidence")["state"], "on_hold")
        self.assertIn("外部への変更", store.task("evidence")["note"])


class Contention(RunCase):
    def test_double_claim_only_one_wins(self):
        engine, _ = self.start()
        store = engine.store
        store.transition("evidence", "ready")
        task = store.task("evidence")
        first = leases.claim(store, task, "I-a", [], 100)
        second = leases.claim(store, task, "I-b", [], 100)
        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertIn("claim_lost", self.event_types(engine))

    def test_second_process_cannot_take_run_lock(self):
        engine, _ = self.start()
        store = engine.store
        store.set_meta("run_lock", {"pid": 4, "at": 0})  # PID 4 は Windows の System で常に生存している
        if not leases._alive(4):
            self.skipTest("この環境では生存している PID を用意できない")
        self.assertFalse(leases.acquire_run_lock(store))
        self.assertEqual(engine.run(), "locked")

    def test_stale_lock_of_dead_process_is_taken_over(self):
        engine, _ = self.start()
        engine.store.set_meta("run_lock", {"pid": 99999999, "at": 0})
        self.assertTrue(leases.acquire_run_lock(engine.store))

    def test_late_result_after_timeout_does_not_overwrite(self):
        now = [1000.0]
        adapter = MockAdapter()
        run_dir = self.dir / "late"
        init_run(run_dir, brief(), "minimal", adapter).close()
        engine = Engine(run_dir, adapter, clock=lambda: now[0], today=self.today)
        self.engines.append(engine)
        store = engine.store
        store.transition("evidence", "ready")
        old = leases.claim(store, store.task("evidence"), "I-old", [], 10)
        # 実行権の期限を過ぎて打ち切られ、再試行が始まる。
        now[0] += 100
        engine._reap_expired()
        self.assertEqual(store.task("evidence")["state"], "ready")
        new = leases.claim(store, store.task("evidence"), "I-new", [], 500)
        store.db.execute("INSERT INTO instances(instance_id,role,state) VALUES('I-new','G03','idle')")
        store.db.execute("INSERT INTO instances(instance_id,role,state) VALUES('I-old','G03','idle')")
        fresh = good_artifact({"contract": engine.contracts["evidence_register"], "task_id": "新しい試行"})
        self.assertEqual(engine.submit_result(new["attempt_id"], new["lease_token"], AgentResult(True, payload=fresh, simulated=True)), "ok")
        stale = good_artifact({"contract": engine.contracts["evidence_register"], "task_id": "古い試行"})
        self.assertEqual(engine.submit_result(old["attempt_id"], old["lease_token"], AgentResult(True, payload=stale, simulated=True)), "stale")
        latest = store.latest_artifact("evidence_register")
        self.assertEqual(latest["version"], 1)
        self.assertIn("新しい試行", store.read_artifact(latest))
        self.assertIn("late_result_discarded", self.event_types(engine))
        self.assertTrue((store.run_dir / "late_results" / f"{old['attempt_id']}.json").exists(), "旧結果は区別して保存する")

    def test_same_attempt_registered_twice_gives_one_version(self):
        engine, _ = self.start()
        store = engine.store
        a, created_a = store.publish_artifact("evidence_register", "evidence", "x@1", "本文", [], {}, [], [])
        b, created_b = store.publish_artifact("evidence_register", "evidence", "x@1", "本文", [], {}, [], [])
        self.assertTrue(created_a)
        self.assertFalse(created_b)
        self.assertEqual(a["version"], b["version"])

    def test_task_registered_twice_is_one_task(self):
        engine, _ = self.start()
        store = engine.store
        count = store.db.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"]
        self.assertFalse(store.add_task(task_id="evidence", node_id="evidence", kind="work", role="G03"))
        self.assertEqual(store.db.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"], count)

    def test_two_writers_for_one_artifact_rejected(self):
        engine, _ = self.start()
        store = engine.store
        self.assertFalse(store.register_owner("evidence_register", "other_task", "evidence_register"))


class EnvironmentLimits(RunCase):
    def test_no_subagents_means_no_debate_and_no_silent_fallback(self):
        adapter = UnavailableAdapter()
        store = init_run(self.dir / "none", brief(), "minimal", adapter)
        self.assertEqual(store.run_status(), "execution_failed")
        self.assertTrue(store.get_meta("design_only"))
        self.assertIn("模擬会話へは切り替えていない", store.get_meta("status_reason"))
        self.assertEqual(store.db.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"], 0)
        self.assertEqual(store.calls_used(), 0)
        store.close()

    def test_probe_without_resume_blocks_start(self):
        adapter = MockAdapter(resume=False)
        store = init_run(self.dir / "noresume", brief(), "minimal", adapter)
        self.assertTrue(store.get_meta("design_only"))
        store.close()

    def test_env_limit_pauses_without_spending_retry(self):
        def limited(req):
            return AgentResult(False, error_class="env_limit", error_detail="usage limit reached")

        engine, _ = self.start(script={"customer": [limited]})
        self.assertEqual(engine.run(), "paused")
        task = engine.store.task("customer")
        self.assertEqual(task["retries_used"], 0)
        self.assertEqual(task["state"], "ready")
        self.assertIn("実行環境の上限", engine.store.get_meta("status_reason"))
        self.assertEqual(engine.run(), "hypothesis_contract_met")

    def test_same_failure_retried_once_then_failed(self):
        def boom(req):
            return AgentResult(False, error_class="crash", error_detail="落ちた")

        engine, adapter = self.start(script={"evidence": [boom, boom, boom]})
        self.assertEqual(engine.run(), "execution_failed")
        self.assertEqual(sum(1 for c in adapter.calls if c.task_id == "evidence"), 2)
        self.assertEqual(engine.store.task("evidence")["state"], "failed")
        self.assertEqual(engine.store.task("customer")["state"], "pending", "未完了の入力を省略して次へ進めない")

    def test_mock_results_are_labelled_in_messages(self):
        engine, _ = self.start()
        engine.run()
        rows = engine.store.db.execute("SELECT DISTINCT simulated FROM messages").fetchall()
        self.assertEqual([r["simulated"] for r in rows], [1])


if __name__ == "__main__":
    unittest.main()
