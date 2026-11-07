"""Agent ツールの方式（adapters/agent_tool.py）の試験。

親の会話の代わりに、試験のスレッドが pending で依頼を受け取り、結果のファイルを書いて done を実行する。
ここでは実際のサブエージェントを起動しないので、受け渡しと状態制御の確認であり、実接続の証拠にならない。
"""
from __future__ import annotations

import json
import re
import threading
import time
import unittest
from pathlib import Path

from helpers import RunCase, brief

from adapters import agent_tool
from adapters.agent_tool import AgentToolAdapter
from adapters.base import AgentRequest, AgentResult, Capability
from adapters.mock import default_payload
from harness.engine import Engine, init_run

SCHEMA = {"type": "object", "properties": {"said": {"type": "string"}}, "required": ["said"]}


def fast(_seconds):
    time.sleep(0.02)


class Dispatcher(threading.Thread):
    """親の会話の代わり。answer(request_dir, attempt_id) が結果を返す。None なら失敗として done する。"""

    def __init__(self, root, answer, error=None):
        super().__init__(daemon=True)
        self.root = Path(root)
        self.answer = answer
        self.error = error
        self.stop = threading.Event()
        self.handled = []

    def run(self):
        while not self.stop.is_set():
            got = agent_tool.pending(self.root, wait=0.3, sleep=fast, idle_grace=0, inflight_wait=0.3)
            for item in got["new"]:
                attempt = item["attempt_id"]
                directory = agent_tool.attempt_dir(self.root, attempt)
                self.handled.append(item)
                if self.error:
                    agent_tool.done(self.root, attempt, error=self.error)
                    continue
                payload = self.answer(directory, attempt)
                if isinstance(payload, str):
                    (directory / "result.json").write_text(payload, encoding="utf-8")
                else:
                    (directory / "result.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                agent_tool.done(self.root, attempt)


def request(tmp, attempt="T1@1", session_id=None, timeout=10):
    return AgentRequest("T1", attempt, "I-X-1", "X", "work", f"依頼 {attempt}", SCHEMA, Path(tmp), session_id=session_id, timeout_sec=timeout)


class AdapterExchange(RunCase):
    def adapter(self, **kw):
        return AgentToolAdapter(self.dir, poll_sec=0.02, sleep=fast, **kw)

    def dispatch(self, answer, error=None):
        d = Dispatcher(self.dir, answer, error)
        d.start()
        self.addCleanup(d.stop.set)
        return d

    def test_result_is_returned_and_session_recorded(self):
        d = self.dispatch(lambda directory, attempt: {"said": "受領"})
        result = self.adapter().invoke(request(self.dir))
        self.assertTrue(result.ok, result.error_detail)
        self.assertEqual(result.payload, {"said": "受領"})
        self.assertFalse(result.simulated)
        session = json.loads((self.dir / "exchange" / "sessions" / f"{result.session_id}.json").read_text(encoding="utf-8"))
        self.assertEqual([t["attempt_id"] for t in session["turns"]], ["T1@1"])
        item = d.handled[0]
        self.assertEqual(item["subagent_type"], "general-purpose")
        self.assertEqual(item["model"], "sonnet")
        self.assertIn("instructions.md", item["prompt"])
        self.assertIn("提出した：T1@1", item["prompt"])

    def test_continuation_lists_previous_prompts_and_results(self):
        self.dispatch(lambda directory, attempt: {"said": attempt})
        adapter = self.adapter()
        first = adapter.invoke(request(self.dir, "T1@1"))
        second = adapter.invoke(request(self.dir, "T1@2", session_id=first.session_id))
        self.assertTrue(second.ok)
        self.assertEqual(second.session_id, first.session_id)
        text = (agent_tool.attempt_dir(self.dir, "T1@2") / "instructions.md").read_text(encoding="utf-8")
        self.assertIn(str(agent_tool.attempt_dir(self.dir, "T1@1") / "prompt.md"), text)
        self.assertIn(str(agent_tool.attempt_dir(self.dir, "T1@1") / "result.json"), text)

    def test_unknown_session_is_reported_as_lost(self):
        result = self.adapter().invoke(request(self.dir, session_id="nothing"))
        self.assertEqual(result.error_class, "session_lost")

    def test_request_not_picked_up_is_withdrawn(self):
        result = self.adapter(pickup_sec=0.2).invoke(request(self.dir, timeout=5))
        self.assertEqual(result.error_class, "not_dispatched")
        self.assertEqual(agent_tool.pending(self.dir, wait=0)["new"], [])
        self.assertFalse(agent_tool.done(self.dir, "T1@1")["accepted"])

    def test_dispatched_but_not_done_times_out(self):
        agent = self.adapter()
        holder = {}
        worker = threading.Thread(target=lambda: holder.setdefault("r", agent.invoke(request(self.dir, timeout=1))))
        worker.start()
        for _ in range(100):
            if agent_tool.pending(self.dir, wait=0)["new"]:
                break
            time.sleep(0.02)
        worker.join(5)
        self.assertEqual(holder["r"].error_class, "timeout")
        self.assertIn("打ち切り済み", agent_tool.done(self.dir, "T1@1")["message"])

    def test_usage_limit_error_pauses(self):
        self.dispatch(None, error="API Error: usage limit reached")
        self.assertEqual(self.adapter().invoke(request(self.dir, "T1@1")).error_class, "env_limit")

    def test_other_error_is_crash(self):
        self.dispatch(None, error="サブエージェントを起動できなかった")
        self.assertEqual(self.adapter().invoke(request(self.dir, "T1@1")).error_class, "crash")

    def test_broken_json_is_invalid_output(self):
        self.dispatch(lambda directory, attempt: "{ 壊れた")
        self.assertEqual(self.adapter().invoke(request(self.dir)).error_class, "invalid_output")

    def test_check_output_reports_schema_problems(self):
        directory = agent_tool.attempt_dir(self.dir, "T1@1")
        directory.mkdir(parents=True)
        (directory / "request.json").write_text("{}", encoding="utf-8")
        (directory / "schema.json").write_text(json.dumps(SCHEMA), encoding="utf-8")
        self.assertTrue(agent_tool.check_output(self.dir, "T1@1"))
        (directory / "result.json").write_text(json.dumps({"other": 1}), encoding="utf-8")
        self.assertTrue(any("said" in p for p in agent_tool.check_output(self.dir, "T1@1")))
        (directory / "result.json").write_text(json.dumps({"said": "受領"}), encoding="utf-8")
        self.assertEqual(agent_tool.check_output(self.dir, "T1@1"), [])

    def test_probe_confirms_relay_through_previous_files(self):
        def answer(directory, attempt):
            if attempt == "probe@1":
                return {"said": "受領"}
            instructions = (directory / "instructions.md").read_text(encoding="utf-8")
            previous = re.search(r"以前の依頼 1：(.+)", instructions).group(1).strip()
            word = re.search(r"確認語は「([^」]+)」", Path(previous).read_text(encoding="utf-8")).group(1)
            return {"said": word}

        self.dispatch(answer)
        cap = self.adapter().probe(self.dir)
        self.assertTrue(cap.debate_possible, cap.notes)
        self.assertEqual(cap.adapter, "agent")


class CapturingAdapter(AgentToolAdapter):
    """試験の親の会話が模擬の出力を作れるよう、依頼の付随情報を保持する。"""

    def __init__(self, root, **kw):
        super().__init__(root, poll_sec=0.02, sleep=fast, **kw)
        self.requests = {}

    def invoke(self, req):
        self.requests[req.attempt_id] = req
        return super().invoke(req)


CAPABILITY = Capability("agent", simulated=False, spawn=True, resume=True, structured_result=True, relay=True)


class EngineThroughAgentTool(RunCase):
    def test_minimal_graph_completes_through_file_exchange(self):
        run_dir = self.dir / "run"
        adapter = CapturingAdapter(run_dir)
        store = init_run(run_dir, brief(), "minimal", adapter, capability=CAPABILITY)
        store.close()
        engine = Engine(run_dir, adapter, today=self.today)
        self.engines.append(engine)
        d = Dispatcher(run_dir, lambda directory, attempt: default_payload(adapter.requests[attempt]))
        d.start()
        self.addCleanup(d.stop.set)
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        self.assertEqual(engine.store.get_meta("adapter"), "agent")
        self.assertFalse(engine.store.get_meta("simulated"))
        self.assertGreater(len(d.handled), 10)

    def test_not_dispatched_pauses_without_spending_retry_or_budget(self):
        def not_dispatched(req):
            return AgentResult(False, error_class="not_dispatched", error_detail="受け取られなかった")

        engine, _ = self.start(script={"customer": [not_dispatched]})
        before = engine.remaining_calls()
        self.assertEqual(engine.run(), "paused")
        task = engine.store.task("customer")
        self.assertEqual(task["retries_used"], 0)
        self.assertEqual(task["state"], "ready")
        self.assertIn("親の会話が依頼を受け取らない", engine.store.get_meta("status_reason"))
        statuses = [r["status"] for r in engine.store.db.execute("SELECT status FROM attempts WHERE task_id='customer'")]
        self.assertEqual(statuses, ["not_dispatched"])
        self.assertEqual(engine.remaining_calls(), before - (len(engine.adapter.calls) - 1))
        self.assertEqual(engine.run(), "hypothesis_contract_met")


if __name__ == "__main__":
    unittest.main()
