"""実行エンジン。作業を選び、エージェントへ依頼し、結果を検査して次へ進める。

エージェントの出力はここで検査され、状態の変更は Store.transition だけが行う。
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from difflib import SequenceMatcher
from pathlib import Path

from adapters.base import AgentRequest, AgentResult
from validators import crossdoc, formal
from validators.formal import CheckContext, Finding, norm

from . import gate, impact, leases, planner, prompts, scheduler
from .debate import Debate
from .states import FORBIDDEN_OUTPUT_KEYS, TERMINAL_RUN_STATUS
from .store import Store, sha256_text

DEFAULT_BUDGET = {"revisions": 2, "same_failure_retry": 1, "debate_rounds": 3, "max_calls": None}
DEFAULT_SETTINGS = {"concurrency": 1, "lease_sec": 1200, "timeout_sec": 900, "review_backlog_limit": 4, "model": "sonnet", "max_turns": 12}
SMALL_CHANGE = 0.985  # 修正前後の文字列の類似度がこれ以上なら、語句の置換の可能性として再確認する。


class SimulatedCrash(RuntimeError):
    """停止からの再開を試験するために、処理の途中で意図的に止める。"""


def init_run(run_dir, brief, graph_name, adapter, settings=None, budget=None, capability=None):
    """実行を作成する。実サブエージェントを確認できない環境では作業を開始しない。"""
    store = Store(run_dir)
    if store.get_meta("brief"):
        store.event("init_ignored", reason="既に作成済みの実行である")
        return store
    errors = planner.validate_brief(brief)
    if errors:
        raise ValueError("依頼の形式が正しくない: " + "；".join(errors))
    graph = planner.load_graph(graph_name)
    scoped, removed = planner.scoped_graph(graph, brief)
    contracts, roles = planner.load_contracts(), planner.load_roles()
    errors = planner.check_all(scoped, roles, contracts)
    if errors:
        raise ValueError("グラフの検査に失敗した: " + "；".join(errors))

    capability = capability or adapter.probe(Path(run_dir) / "views" / "probe")
    store.set_meta("brief", brief)
    store.set_meta("graph", scoped)
    store.set_meta("graph_id", f"{graph['graph_id']}@{graph.get('version', '')}")
    store.set_meta("settings", {**DEFAULT_SETTINGS, **(settings or {})})
    store.set_meta("adapter", adapter.name)
    store.set_meta("simulated", bool(adapter.simulated))
    store.set_meta("capability", capability.to_dict())
    store.set_meta("roles_defined", len(roles))
    store.set_meta("started_at", store.clock())
    budget_final = {**DEFAULT_BUDGET, **(budget or {})}
    ceiling = planner.call_ceiling(scoped, budget_final)
    budget_final["ceiling_from_ledger"] = ceiling
    budget_final["max_calls"] = budget_final.get("max_calls") or ceiling
    store.set_meta("budget", budget_final)
    store.event("run_created", graph=store.get_meta("graph_id"), adapter=adapter.name, simulated=adapter.simulated, ceiling=ceiling)

    if not capability.debate_possible:
        store.set_meta("design_only", True)
        store.set_run_status("execution_failed", "独立したサブエージェントの起動・再開・発言の受け渡しを確認できない。実討論は実施していない。単一エージェントの模擬会話へは切り替えていない")
        return store

    product_id = brief["product"]["id"]
    for material in brief.get("materials", []):
        owner = material.get("product_id", product_id)
        if owner not in (product_id, "shared"):
            store.event("material_rejected", source=material.get("id"), product=owner)
            raise ValueError(f"資料 {material.get('id')} は別の製品（{owner}）のものである。複数の製品の資料を混ぜない")
        text = material.get("text")
        if text is None:
            text = Path(material["path"]).read_text(encoding="utf-8")
        store.add_source(material["id"], text, owner, material.get("title", ""), material.get("kind", "document"),
                         material.get("retrieved_at", ""), material.get("path", ""))

    node_ids = {n["id"] for n in scoped["nodes"]}
    for node_id, reason in removed.items():
        original = next(n for n in graph["nodes"] if n["id"] == node_id)
        store.add_task(task_id=node_id, node_id=node_id, kind=original["kind"], role=original.get("role"),
                       purpose=original.get("purpose", ""), state="out_of_scope", note=reason)
        store.event("task_out_of_scope", task_id=node_id, reason=reason)
    for node in scoped["nodes"]:
        if node["kind"] != "terminal" and node.get("activation", "initial") == "initial":
            planner.add_node_task(store, node, scoped, contracts)
            _seed_decide_data(store, node, node["id"])
    used_roles = _roles_in_graph(scoped)
    store.set_meta("roles_not_activated", {
        rid: "このグラフの作業に割り当てがない" for rid in roles if rid not in used_roles
    })
    store.event("ledger_ready", nodes=sorted(node_ids))
    return store


def _remap_ids(payload, mapping):
    """担当が使った仮の根拠IDを、登録された根拠IDへ置き換える。本文と主張で番号がずれないようにする。"""
    if not mapping:
        return payload
    keys = sorted(mapping, key=len, reverse=True)
    pattern = re.compile(r"(?<![A-Za-z0-9_])(" + "|".join(re.escape(k) for k in keys) + r")(?![A-Za-z0-9_])")
    text = pattern.sub(lambda m: mapping[m.group(1)], json.dumps(payload, ensure_ascii=False))
    return json.loads(text)


def _seed_decide_data(store, node, task_id):
    if node["kind"] == "decide":
        store.update_task(task_id, data={"outcomes": node["outcomes"], "outcome_notes": node.get("outcome_notes", {})})
    if node["kind"] == "crosscheck":
        store.update_task(task_id, data={"artifacts": node["artifacts"]})


def _roles_in_graph(graph):
    used = set()
    for node in graph["nodes"]:
        for key in ("role", "reviewer"):
            if node.get(key):
                used.add(node[key])
        used |= set(node.get("critics", []))
        used |= {p["role"] for p in node.get("proposers", [])}
    return used


class Engine:
    def __init__(self, run_dir, adapter, clock=time.time, today=None, crash_after=None):
        self.store = Store(run_dir, clock)
        self.adapter = adapter
        self.clock = clock
        self.today = today or dt.date.today()
        self.roles = planner.load_roles()
        self.contracts = planner.load_contracts()
        self.brief = self.store.get_meta("brief")
        self.graph = self.store.get_meta("graph")
        self.settings = self.store.get_meta("settings", DEFAULT_SETTINGS)
        self.debate = Debate(self)
        self.crash_after = crash_after
        self._results_seen = 0
        self.peak = self.store.get_meta("peak_concurrency", 0)

    # 参照 -------------------------------------------------------------
    def node(self, node_id):
        return next((n for n in self.graph["nodes"] if n["id"] == node_id), None)

    def carry_forward_items(self):
        return self.debate.carry_forward_items()

    def open_defects(self, artifact_id):
        return [dict(r) for r in self.store.db.execute(
            "SELECT * FROM defects WHERE artifact_id=? AND state='open' ORDER BY rowid", (artifact_id,))]

    def remaining_calls(self):
        used = self.store.db.execute("SELECT COUNT(*) c FROM attempts WHERE COALESCE(status,'')<>'env_limit'").fetchone()["c"]
        return (self.store.budget().get("max_calls") or 0) - used

    # 実行 -------------------------------------------------------------
    def run(self, max_results=None):
        """止まるか終了状態に達するまで進める。戻り値は実行全体の状態である。"""
        store = self.store
        status = store.run_status()
        if status in TERMINAL_RUN_STATUS:
            return status
        if not leases.acquire_run_lock(store):
            return "locked"
        try:
            self.recover()
            store.set_run_status("running", "実行を開始または再開した")
            store.set_meta("stop_requested", False)
            return self._loop(max_results)
        finally:
            store.set_meta("peak_concurrency", self.peak)
            leases.release_run_lock(store)

    def _loop(self, max_results):
        store = self.store
        concurrency = int(self.settings.get("concurrency", 1))
        inflight = {}
        results = 0
        with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
            while True:
                stopping = store.get_meta("stop_requested", False) or store.get_meta("abort_requested", False)
                paused = store.get_meta("env_pause")
                limit_hit = max_results is not None and results >= max_results
                if not (stopping or paused or limit_hit):
                    self._reap_expired()
                    self._advance()
                    picks, info = scheduler.select(
                        store, concurrency - len(inflight), self.remaining_calls(),
                        int(self.settings.get("review_backlog_limit", 4)))
                    if info.get("defer_production") and info.get("deferred"):
                        store.event("production_deferred", backlog=info["backlog"], deferred=info["deferred"][:10])
                    for task in picks:
                        prepared = self._start_attempt(task)
                        if prepared:
                            request, grant = prepared
                            inflight[pool.submit(self._invoke, request)] = (request, grant)
                    self.peak = max(self.peak, len(inflight))
                    store.set_meta("peak_concurrency", self.peak)
                if inflight:
                    done, _ = wait(inflight, timeout=5, return_when=FIRST_COMPLETED)
                    for future in done:
                        request, grant = inflight.pop(future)
                        result = future.result()
                        self.submit_result(request.attempt_id, grant["lease_token"], result)
                        results += 1
                        self._results_seen += 1
                        if self.crash_after is not None and self._results_seen >= self.crash_after:
                            raise SimulatedCrash(f"{self._results_seen} 件の結果の後で停止した")
                    continue
                if store.get_meta("abort_requested", False):
                    self._finish("aborted", "依頼者の指示で中止した")
                    return store.run_status()
                if store.get_meta("stop_requested", False):
                    store.set_run_status("paused", "停止の指示により一時停止した")
                    return "paused"
                if paused:
                    store.set_run_status("paused", f"実行環境の上限により一時停止した：{paused}")
                    store.set_meta("env_pause", None)
                    return "paused"
                if limit_hit:
                    store.set_run_status("paused", f"指定された {max_results} 件の結果を受け取ったので一時停止した")
                    return "paused"
                if self._no_work_left():
                    return self._settle()

    def _invoke(self, request):
        try:
            return self.adapter.invoke(request)
        except Exception as exc:  # 実行基盤の例外は失敗として記録し、実行全体を止めない
            return AgentResult(False, error_class="crash", error_detail=repr(exc), simulated=self.adapter.simulated)

    def _no_work_left(self):
        self._advance()
        if self.store.tasks(state="running"):
            # 子の作業を持たない調整役の running は、子の完了を待つ状態である。
            if any(t["kind"] != "debate" for t in self.store.tasks(state="running")):
                return False
        ready = [t for t in self.store.tasks(state="ready") if t["kind"] in scheduler.AGENT_KINDS]
        if ready:
            if self.remaining_calls() <= 0:
                self.store.set_meta("budget_exhausted", True)
                self.store.event("budget_exhausted", waiting=[t["task_id"] for t in ready][:20])
                return True
            return False
        return True

    # 再開 -------------------------------------------------------------
    def recover(self):
        """停止時に実行中だった作業、未送達の発言、未検査の成果物を識別して復旧する。"""
        store = self.store
        orphaned = leases.running(store)
        for attempt in orphaned:
            with store.tx():
                store.db.execute(
                    "UPDATE attempts SET status='interrupted', finished_at=? WHERE attempt_id=?",
                    (self.clock(), attempt["attempt_id"]),
                )
                task = store.task(attempt["task_id"])
                if task["state"] == "running":
                    node = self.node(task["node_id"]) or {}
                    if node.get("external_effect"):
                        store.transition(task["task_id"], "on_hold", "外部への変更を伴う作業のため、前回の操作の完了を確認するまで再試行しない")
                    else:
                        store.transition(task["task_id"], "ready", "停止時に実行中だったので再度実行する")
                store.event("attempt_interrupted", task_id=attempt["task_id"], attempt_id=attempt["attempt_id"])
        for path in store.run_dir.glob("**/*.tmp*"):
            path.unlink(missing_ok=True)
        queued = store.db.execute("SELECT COUNT(*) c FROM messages WHERE delivery='queued'").fetchone()["c"]
        unreviewed = store.db.execute("SELECT COUNT(*) c FROM tasks WHERE state='awaiting_review'").fetchone()["c"]
        store.event("recovered", interrupted=[a["attempt_id"] for a in orphaned], queued_messages=queued, awaiting_review=unreviewed)
        # 実行中の子が残る調整役や、検査作業が失われた検査待ちを復旧する。
        for task in store.tasks(state="awaiting_review"):
            children = store.tasks(parent=task["task_id"], kind="review")
            if not any(c["state"] in {"pending", "ready", "running"} for c in children):
                art = store.latest_artifact(task["output_artifact"])
                if art and art["status"] in {"draft", "invalidated"}:
                    self._create_review(task, art)

    def _reap_expired(self):
        """実行権の期限を過ぎた試行を打ち切る。遅れて届いた結果は submit_result が退ける。"""
        store = self.store
        for attempt in leases.expired(store, self.clock()):
            with store.tx():
                store.db.execute("UPDATE attempts SET status='timed_out', error_class='timeout', finished_at=? WHERE attempt_id=?",
                                 (self.clock(), attempt["attempt_id"]))
                store.event("attempt_timed_out", task_id=attempt["task_id"], attempt_id=attempt["attempt_id"])
                self._on_failure(store.task(attempt["task_id"]), dict(attempt), AgentResult(False, error_class="timeout", error_detail="実行権の期限切れ"))

    def _advance(self):
        store = self.store
        for task in store.tasks(state="pending"):
            if self._deps_ok(task):
                store.transition(task["task_id"], "ready", "入力がそろった")
        for task in store.tasks(state="ready", kind="debate"):
            store.transition(task["task_id"], "running", "相互批評を開始する")
            self.debate.open(store.task(task["task_id"]), self.apply_issue_plan(self.node(task["node_id"])))
        for task in store.tasks(state="running", kind="debate"):
            self.debate.advance(store.task(task["task_id"]))
        for task in store.tasks(state="ready", kind="crosscheck"):
            if not task["data"].get("manifest"):
                self._prepare_crosscheck(task)

    def _deps_ok(self, task):
        for dep in task["depends_on"]:
            if dep.get("task"):
                other = self.store.task(dep["task"])
            else:
                other = self.store.latest_of_node(dep["node"])
            if other is None:
                if dep.get("optional"):
                    continue
                return False
            if dep.get("optional"):
                if other["state"] not in {"done", "failed", "on_hold", "out_of_scope"}:
                    return False
                continue
            if other["state"] != "done":
                return False
            if dep.get("outcomes") and other["outcome"] not in dep["outcomes"]:
                return False
        return True

    # 試行の開始 -------------------------------------------------------
    def _instance_for(self, task):
        store = self.store
        key = task["data"].get("instance_key") or f"task:{task['task_id']}"
        force_new = task["data"].get("force_new_instance")
        if not force_new:
            row = store.db.execute(
                "SELECT * FROM instances WHERE created_for=? AND state<>'lost' ORDER BY rowid DESC LIMIT 1", (key,)
            ).fetchone()
            if row:
                return dict(row), False
        role = task["role"]
        instance_id = store.next_id(f"I-{role}-")
        forbidden = set(task["data"].get("forbidden_instances") or [])
        if instance_id in forbidden:  # 連番なので通常は起こらないが、同一性の保証として確認する
            instance_id = store.next_id(f"I-{role}-")
        store.db.execute(
            "INSERT INTO instances(instance_id,role,adapter,state,created_for,continuation_of,created_at) VALUES(?,?,?,?,?,?,?)",
            (instance_id, role, self.adapter.name, "idle", key, task["data"].get("continuation_of"), self.clock()),
        )
        store.event("instance_created", task_id=task["task_id"], instance=instance_id, role=role, continuation_of=task["data"].get("continuation_of"))
        return dict(store.db.execute("SELECT * FROM instances WHERE instance_id=?", (instance_id,)).fetchone()), True

    def _start_attempt(self, task):
        store = self.store
        if self.remaining_calls() <= 0:
            return None
        instance, _created = self._instance_for(task)
        view = store.run_dir / "views" / instance["instance_id"]
        view.mkdir(parents=True, exist_ok=True)
        is_new = not instance["session_id"]
        prompt, schema, manifest, meta = prompts.build(self, task, instance, view, is_new)
        grant = leases.claim(store, task, instance["instance_id"], manifest, float(self.settings.get("lease_sec", 1200)))
        if not grant:
            return None
        store.db.execute("UPDATE instances SET state='running', calls=calls+1 WHERE instance_id=?", (instance["instance_id"],))
        attempt_prompt = store.run_dir / "prompts" / f"{grant['attempt_id']}.md"
        attempt_prompt.parent.mkdir(parents=True, exist_ok=True)
        attempt_prompt.write_text(prompt, encoding="utf-8")
        meta["attempt_seq"] = grant["seq"]
        return AgentRequest(
            task_id=task["task_id"], attempt_id=grant["attempt_id"], instance_id=instance["instance_id"], role=task["role"],
            kind=task["kind"], prompt=prompt, schema=schema, cwd=view, session_id=instance["session_id"],
            timeout_sec=int(self.settings.get("timeout_sec", 900)), model=self.settings.get("model"),
            max_turns=int(self.settings.get("max_turns", 12)), meta=meta,
        ), grant

    # 結果の受け取り ---------------------------------------------------
    def submit_result(self, attempt_id, token, result: AgentResult):
        """結果を受け取る唯一の入口。実行権を確認し、古い試行の結果で現行版を上書きしない。"""
        store = self.store
        row = store.db.execute("SELECT * FROM attempts WHERE attempt_id=?", (attempt_id,)).fetchone()
        if row is None:
            store.event("result_unknown_attempt", attempt_id=attempt_id)
            return "unknown"
        attempt = dict(row)
        raw_rel = f"raw/{attempt_id}.json"
        raw_path = store.run_dir / raw_rel
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(result.raw or json.dumps(result.payload or {}, ensure_ascii=False), encoding="utf-8")
        if not leases.is_current(store, attempt_id, token):
            late = store.run_dir / "late_results" / f"{attempt_id}.json"
            late.parent.mkdir(parents=True, exist_ok=True)
            late.write_text(json.dumps(result.payload or {}, ensure_ascii=False), encoding="utf-8")
            store.event("late_result_discarded", task_id=attempt["task_id"], attempt_id=attempt_id, status=attempt["status"])
            return "stale"
        task = store.task(attempt["task_id"])
        with store.tx():
            self._record_usage(attempt, result, raw_rel)
            if result.injected:
                store.event("injected_output", task_id=task["task_id"], attempt_id=attempt_id, note="評価のために差し込んだ不良成果物である")
            attempt = dict(store.db.execute("SELECT * FROM attempts WHERE attempt_id=?", (attempt_id,)).fetchone())
            if not result.ok:
                self._on_failure(task, attempt, result)
                return "failed"
            forbidden = FORBIDDEN_OUTPUT_KEYS & set(result.payload or {})
            if forbidden:
                store.event("forbidden_state_change", task_id=task["task_id"], attempt_id=attempt_id, keys=sorted(forbidden))
                self._invalid_output(task, attempt, f"状態を変更する項目 {sorted(forbidden)} は受け付けない。状態はハーネスだけが変更する")
                return "invalid"
            problem = self._dispatch(task, attempt, result.payload)
            if problem:
                self._invalid_output(task, attempt, problem)
                return "invalid"
            store.db.execute("UPDATE attempts SET status='succeeded' WHERE attempt_id=?", (attempt_id,))
        return "ok"

    def _record_usage(self, attempt, result, raw_rel):
        store = self.store
        instance = store.db.execute("SELECT * FROM instances WHERE instance_id=?", (attempt["instance_id"],)).fetchone()
        delta = None
        if result.cost_cumulative is not None:
            # 確認した結果、この値はセッション内の累計である。差分だけを今回の分とする。
            delta = max(0.0, result.cost_cumulative - (instance["last_cost_cum"] or 0))
            store.db.execute("UPDATE instances SET last_cost_cum=? WHERE instance_id=?", (result.cost_cumulative, attempt["instance_id"]))
        if result.session_id:
            store.db.execute("UPDATE instances SET session_id=?, state='idle' WHERE instance_id=?", (result.session_id, attempt["instance_id"]))
        else:
            store.db.execute("UPDATE instances SET state='idle' WHERE instance_id=?", (attempt["instance_id"],))
        store.db.execute(
            "UPDATE attempts SET finished_at=?, session_id=?, raw_path=?, tokens_in=?, tokens_out=?, cost_delta=?, cost_basis=?, simulated=?, error_class=?, error_detail=? WHERE attempt_id=?",
            (self.clock(), result.session_id, raw_rel, result.tokens_in, result.tokens_out, delta, result.cost_basis,
             1 if result.simulated else 0, result.error_class, result.error_detail[:1000] if result.error_detail else None, attempt["attempt_id"]),
        )

    def _dispatch(self, task, attempt, payload):
        kind = task["kind"]
        if kind in {"work", "research"}:
            return self._on_artifact(task, task, attempt, payload)
        if kind == "revise":
            return self._on_artifact(self.store.task(task["parent_task"]), task, attempt, payload)
        if kind == "review":
            return self._on_review(task, attempt, payload)
        if kind == "decide":
            return self._on_decide(task, attempt, payload)
        if kind == "crosscheck":
            return self._on_crosscheck(task, attempt, payload)
        if kind == "diagnose":
            return self._on_diagnose(task, attempt, payload)
        if kind in {"critique", "respond", "reeval"}:
            return self._on_debate_turn(task, attempt, payload)
        return f"未知の種類 {kind}"

    def _invalid_output(self, task, attempt, problem):
        store = self.store
        store.db.execute("UPDATE attempts SET status='invalid', error_class='invalid_output', error_detail=? WHERE attempt_id=?",
                         (problem[:1000], attempt["attempt_id"]))
        store.event("output_invalid", task_id=task["task_id"], attempt_id=attempt["attempt_id"], problem=problem)
        self._retry_or_fail(task, f"出力が受理されなかった：{problem}", retry_note=problem)

    def _retry_or_fail(self, task, reason, retry_note=None):
        store = self.store
        limit = store.budget().get("same_failure_retry", 1)
        if task["retries_used"] < limit and task["state"] == "running":
            data = dict(task["data"])
            if retry_note:
                data["retry_note"] = retry_note
            store.update_task(task["task_id"], retries_used=task["retries_used"] + 1, data=data)
            store.transition(task["task_id"], "ready", f"再試行（{task['retries_used'] + 1}回目）：{reason}")
            return
        store.transition(task["task_id"], "failed", reason, outcome="execution_failed")
        store.event("role_not_performed", task_id=task["task_id"], role=task["role"], reason=reason)
        self._child_failed(store.task(task["task_id"]), reason)

    def _on_failure(self, task, attempt, result):
        store = self.store
        status = {"env_limit": "env_limit", "timeout": "timed_out"}.get(result.error_class, "failed")
        store.db.execute("UPDATE attempts SET status=?, error_class=?, error_detail=? WHERE attempt_id=?",
                         (status, result.error_class, (result.error_detail or "")[:1000], attempt["attempt_id"]))
        store.event("agent_failure", task_id=task["task_id"], attempt_id=attempt["attempt_id"], error=result.error_class, detail=(result.error_detail or "")[:300])
        if result.error_class == "env_limit":
            # 実行環境の上限は作業の失敗ではない。再試行の回数を消費せず、一時停止して再開を待つ。
            store.transition(task["task_id"], "ready", "実行環境の上限のため待機する")
            store.set_meta("env_pause", result.error_detail[:200] or "実行環境の上限")
            return
        if result.error_class == "unavailable":
            store.transition(task["task_id"], "failed", "実行基盤を利用できない", outcome="execution_failed")
            store.set_meta("adapter_unavailable", result.error_detail)
            store.set_meta("abort_requested", False)
            store.set_meta("stop_requested", True)
            return
        if result.error_class == "session_lost":
            # 新しいインスタンスで継続し、そのことを記録する。必要な経緯は依頼文で引き継ぐ。
            store.db.execute("UPDATE instances SET state='lost' WHERE instance_id=?", (attempt["instance_id"],))
            data = dict(task["data"])
            data["continuation_of"] = attempt["instance_id"]
            data["handover"] = self._handover(task)
            store.update_task(task["task_id"], data=data)
            store.transition(task["task_id"], "ready", f"セッションを再開できないので新しいインスタンスで継続する（前 {attempt['instance_id']}）")
            store.event("instance_continued", task_id=task["task_id"], previous=attempt["instance_id"])
            return
        self._retry_or_fail(task, f"エージェントの失敗：{result.error_class} {(result.error_detail or '')[:200]}")

    def _handover(self, task):
        """役割、以前の提案、受け取った批判、未回答事項を新しいインスタンスへ渡す。"""
        role = task["role"]
        rows = [f"役割：{role}"]
        for m in self.store.db.execute(
            "SELECT * FROM messages WHERE (from_role=? OR to_role=?) AND issue_id=? ORDER BY rowid",
            (role, role, task["data"].get("issue_id")),
        ):
            rows.append(f"{m['message_id']}（{m['from_role']}→{m['to_role']}／{m['kind']}／{m['disposition']}）：{m['body']}")
        art = task["data"].get("artifact") or task["data"].get("artifact_id")
        if art:
            latest = self.store.latest_artifact(art)
            if latest:
                rows.append(f"以前の提案 {art} v{latest['version']} は入力に含まれている")
        return "\n".join(rows)

    # 成果物 -----------------------------------------------------------
    def _ctx(self, payload, contract):
        return CheckContext(payload, contract, self.brief, self.store, self.brief["product"]["id"], self.today)

    def _register_evidence(self, payload, attempt):
        """検査を通った根拠だけを登録し、同じ資料の同じ引用は一つにまとめる。"""
        store = self.store
        mapping = {}
        ctx = self._ctx(payload, {})
        for item in payload.get("new_evidence") or []:
            if formal._check_new_evidence(ctx, item):
                continue
            source_id = item.get("source_id")
            source = store.source(source_id) if source_id else None
            row = None
            if source_id:
                row = store.db.execute("SELECT evidence_id FROM evidence WHERE source_id=? AND quote=?", (source_id, item.get("quote"))).fetchone()
            elif item.get("url"):
                row = store.db.execute("SELECT evidence_id FROM evidence WHERE url=? AND quote=?", (item["url"], item.get("quote"))).fetchone()
            if row:
                mapping[item["id"]] = row["evidence_id"]
                store.event("evidence_reused", evidence=row["evidence_id"], attempt_id=attempt["attempt_id"])
                continue
            evidence_id = store.next_id("E")
            verified = "quote_found" if source_id else ("url_not_machine_checked" if item.get("url") else "no_source")
            store.db.execute(
                "INSERT INTO evidence(evidence_id,product_id,source_id,source_version,url,locator,quote,kind,retrieved_at,verified,registered_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (evidence_id, self.brief["product"]["id"], source_id, source["version"] if source else None, item.get("url"),
                 item.get("locator"), item.get("quote"), item.get("kind"),
                 item.get("retrieved_at") or (source["retrieved_at"] if source else ""), verified, attempt["attempt_id"]),
            )
            mapping[item["id"]] = evidence_id
        return mapping

    def _store_claims(self, artifact_id, version, payload, mapping):
        store = self.store
        for claim in payload.get("claims") or []:
            refs = [mapping.get(r, r) for r in claim.get("evidence") or []]
            store.db.execute(
                "INSERT OR REPLACE INTO claims(artifact_id,version,local_id,text,type,status,evidence,target_customer,situation,conditions,reason,derived_from,metric,audience) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (artifact_id, version, claim.get("id"), claim.get("text"), claim.get("type"), claim.get("status"),
                 json.dumps(refs, ensure_ascii=False), claim.get("target_customer"), claim.get("situation"),
                 json.dumps(claim.get("conditions") or [], ensure_ascii=False), claim.get("reason"),
                 json.dumps(claim.get("derived_from") or [], ensure_ascii=False),
                 json.dumps(claim["metric"], ensure_ascii=False) if claim.get("metric") else None, claim.get("audience")),
            )
            key = f"{artifact_id}#{claim.get('id')}"
            for ref in refs:
                store.link("claim", key, "evidence", ref, "supports")
            for parent in claim.get("derived_from") or []:
                store.link("claim", key, "claim", parent.get("ref"), parent.get("relation", "reference"))

    def _extra_findings(self, target, payload, contract):
        """討論の結果や他の候補と照らす検査。契約の検査と同じ扱いで記録する。"""
        findings = []
        node = self.node(target["node_id"]) or {}
        if contract.get("id") == "adopted_strategy":
            required = {r["message_id"]: r for r in self.carry_forward_items()}
            carried = {str(i.get("message_id")) for i in (payload.get("structured") or {}).get("carried_forward") or [] if isinstance(i, dict)}
            missing = [m for m in required if m not in carried]
            if missing:
                findings.append(Finding(
                    "carried_forward_complete", "major", "production_gap",
                    f"討論の少数意見または長所 {missing} が統合結果から消えている",
                    "structured.carried_forward に各発言の扱いを記録し、本文で扱う", location="structured.carried_forward"))
            unresolved = {r["message_id"] for r in required.values() if r["kind"] == "未解決の異論"}
            if unresolved:
                for claim in payload.get("claims") or []:
                    if claim.get("status") == "confirmed" and claim.get("type") in {"difference", "promise", "value"} and not claim.get("evidence"):
                        findings.append(Finding(
                            "unresolved_not_confirmed", "major", "inference_error",
                            f"未回答・未解決の重大な批判が残る中で、主張 {claim.get('id')} を根拠なしに確定扱いにしている",
                            "確認状態を仮説または未確認にする", location=claim.get("id", "")))
        group = node.get("isolation_group")
        if group:
            for other in self.graph["nodes"]:
                if other.get("isolation_group") != group or other["id"] == node["id"]:
                    continue
                art = self.store.latest_artifact(other["output"])
                if not art:
                    continue
                differs, scores = formal.candidates_differ(payload, {"structured": json.loads(art["structured"] or "{}")})
                if not differs:
                    findings.append(Finding(
                        "candidates_differ", "major", "production_gap",
                        f"他の候補と対象・提供価値がほぼ同じで、言葉を変えただけの候補である（類似度 {scores}）",
                        "対象または提供価値が異なる案にする", location="structured"))
        return findings

    def _on_artifact(self, target, task, attempt, payload):
        """成果物の版を作り、機械検査を行う。不合格でも版は残し、拒否の経緯を追えるようにする。"""
        store = self.store
        artifact_id = target["output_artifact"]
        contract = store.contract(target["contract_id"], target["contract_sha"])
        schema_errors = self._schema_errors(task, payload)
        if schema_errors:
            return "；".join(schema_errors[:5])
        if task["kind"] == "revise" and not payload.get("structured"):
            # 修正で省略された整理項目は変更なしとして前の版を引き継ぐ。検査は新しい版に対して行う。
            previous = store.artifact(artifact_id, task["data"]["from_version"])
            payload = {**payload, "structured": json.loads(previous["structured"] or "{}")}
        owner = store.owner(artifact_id)
        if owner and owner["task_id"] not in {target["node_id"], target["task_id"]}:
            store.event("write_conflict", task_id=task["task_id"], artifact=artifact_id, owner=owner["task_id"])
            return f"成果物 {artifact_id} の書き込み担当は {owner['task_id']} である"
        manifest = json.loads(attempt["input_manifest"] or "[]")
        findings = formal.run_checks(self._ctx(payload, contract)) + self._extra_findings(target, payload, contract)
        if task["kind"] == "research" and any(f.severity == "major" for f in findings):
            return "；".join(f.reason for f in findings if f.severity == "major")[:600]
        mapping = self._register_evidence(payload, attempt)
        payload = _remap_ids(payload, mapping)
        art, created = store.publish_artifact(
            artifact_id, task["task_id"], attempt["attempt_id"], payload["document"], manifest,
            payload.get("structured"), payload.get("unknowns"), payload.get("handoffs"))
        if not created:
            return None
        self._store_claims(artifact_id, art["version"], payload, {})
        for item in manifest:
            store.link("artifact", f"{artifact_id}@{art['version']}", item["kind"], f"{item['id']}@{item.get('version')}", "derives")
        self._register_requested_tasks(task, payload)

        decision = gate.decide(contract, findings, None, []) if any(f.severity == "major" for f in findings) else None

        if task["kind"] == "revise":
            store.update_task(target["task_id"], data={**target["data"], "last_changes": payload.get("changes"), "last_rebuttals": payload.get("rebuttals")})
            store.transition(task["task_id"], "done", "修正版を提出した", outcome="submitted")
            self._record_rebuttals(target, payload, attempt)
            self._resolve_machine_defects(artifact_id, findings, art["version"])
            target = store.task(target["task_id"])

        if decision:
            review_id = self._record_review(None, art, contract, "machine", None, attempt["attempt_id"],
                                            {"findings": [f.__dict__ for f in findings]}, "fail", decision.verdict, decision.reasons, "machine")
            self._add_defects(review_id, art, [self._finding_dict(f) for f in findings], "machine")
            store.set_artifact_status(artifact_id, art["version"], "rejected")
            store.event("artifact_rejected", task_id=target["task_id"], artifact=artifact_id, version=art["version"], by="machine", reasons=decision.reasons[:5])
            if task["kind"] != "revise" and target["state"] == "running":
                store.transition(target["task_id"], "on_hold" if decision.verdict == "hold" else "revising", "機械検査で不合格")
            elif decision.verdict == "hold":
                store.transition(target["task_id"], "on_hold", "機械検査で保留")
            if decision.verdict != "hold":
                self._route_rejection(store.task(target["task_id"]), art)
            else:
                store.update_task(target["task_id"], outcome="on_hold_missing_info")
                self._parent_settled(store.task(target["task_id"]))
            return None

        review_mode = target["data"].get("review_mode", "content")
        if contract.get("review") == "machine_only" or review_mode == "machine":
            self._accept_by_machine(target, art, contract, attempt)
            return None
        if target["state"] == "running":
            store.transition(target["task_id"], "awaiting_review", "成果物を提出した")
        elif target["state"] == "revising":
            store.transition(target["task_id"], "awaiting_review", "修正版を提出した")
        self._create_review(store.task(target["task_id"]), art)
        return None

    def _schema_errors(self, task, payload):
        from validators.schema_check import load_schema, validate

        return validate(payload, load_schema(prompts.KIND_SCHEMA[task["kind"]]))

    @staticmethod
    def _finding_dict(f):
        return {"severity": f.severity, "category": f.category, "criterion": f.check, "location": f.location, "quote": f.quote,
                "reason": f.reason, "fix_condition": f.fix_condition, "fix_target": f.fix_target}

    def _resolve_machine_defects(self, artifact_id, findings, version):
        """前の版の機械検査の欠陥は、同じ検査で再び見つからなければ解消とする。"""
        remaining = {f.reason for f in findings}
        for row in self.open_defects(artifact_id):
            if row["origin"] == "machine" and row["reason"] not in remaining:
                self.store.db.execute("UPDATE defects SET state='resolved', resolution='機械検査で再確認して検出されなかった', resolved_in=? WHERE defect_id=?",
                                      (version, row["defect_id"]))

    def _record_rebuttals(self, target, payload, attempt):
        for item in payload.get("rebuttals") or []:
            self.store.event("rebuttal", task_id=target["task_id"], attempt_id=attempt["attempt_id"], defect=item.get("defect_id"), argument=item.get("argument"))

    def _register_requested_tasks(self, task, payload):
        """追加の仕事を台帳と全体予算に反映してから割り当てる。"""
        store = self.store
        for request in payload.get("requested_tasks") or []:
            errors = planner.validate_dynamic_request(request, self.roles, self.contracts, self.remaining_calls())
            if errors:
                store.event("task_request_rejected", task_id=task["task_id"], request=request, errors=errors)
                continue
            child_id = store.next_id(f"{task['node_id']}.extra")
            contract = self.contracts[request["contract"]]
            sha = store.pin_contract(contract)
            output = child_id.replace(".", "_")
            store.register_owner(output, child_id, request["contract"])
            reviewer = self.roles[request["role"]].get("reviewer") or "V08"
            store.add_task(
                task_id=child_id, node_id=child_id, kind="work", role=request["role"], purpose=request["purpose"],
                instructions=f"完了条件：{request['done_when']}", inputs=[{"kind": "sources"}, {"kind": "evidence"}],
                depends_on=[], output_artifact=output, contract_id=request["contract"], contract_sha=sha,
                reviewer_role=reviewer, data={"review_mode": "content", "dynamic": True, "requested_by": task["task_id"]},
            )
            store.event("task_request_registered", task_id=child_id, requested_by=task["task_id"])

    def _accept_by_machine(self, target, art, contract, attempt):
        store = self.store
        review_id = self._record_review(None, art, contract, "machine", None, attempt["attempt_id"], {}, "pass", "pass", [], "machine")
        delivery = "hypothesis" if self._has_unconfirmed(art) else "fact_checked"
        if contract.get("id") == "brand_strategy":
            delivery = "candidate"
        store.set_artifact_status(art["artifact_id"], art["version"], "accepted", delivery)
        self._close_parent(target, "accepted")

    def _close_parent(self, target, outcome):
        store = self.store
        target = store.task(target["task_id"])
        if target["state"] in {"running", "revising"}:
            store.transition(target["task_id"], "awaiting_review", "機械検査のみの成果物を受理する")
        store.transition(target["task_id"], "done", "品質ゲートを通過した", outcome=outcome)
        self._node_finished(store.task(target["task_id"]))

    def _has_unconfirmed(self, art):
        return any(c["status"] in {"hypothesis", "unverified", "planned"} for c in self.store.claims_of(art["artifact_id"], art["version"]))

    def publish_proposal_revision(self, task, attempt, artifact_id, payload):
        """討論で修正された案を新しい版として登録する。形式検査に通らない修正は受理しない。"""
        store = self.store
        owner = store.owner(artifact_id)
        latest = store.latest_artifact(artifact_id)
        owner_task = store.latest_of_node(owner["task_id"]) or store.task(owner["task_id"])
        contract = store.contract(owner_task["contract_id"], owner_task["contract_sha"])
        previous_claims = store.claims_of(artifact_id, latest["version"])
        claims = payload.get("revised_claims") or [
            {"id": c["local_id"], "text": c["text"], "type": c["type"], "status": c["status"], "evidence": c["evidence"],
             "target_customer": c["target_customer"], "conditions": c["conditions"], "reason": c["reason"], "derived_from": c["derived_from"]}
            for c in previous_claims
        ]
        structured = payload.get("revised_structured") or json.loads(latest["structured"] or "{}")
        draft = {"document": payload["revised_document"], "structured": structured, "claims": claims, "new_evidence": payload.get("new_evidence") or []}
        findings = [f for f in formal.run_checks(self._ctx(draft, contract)) if f.severity == "major"]
        if findings:
            return "修正した案が機械検査を通らない：" + "；".join(f.reason for f in findings[:3]), None
        mapping = self._register_evidence(draft, attempt)
        draft = _remap_ids(draft, mapping)
        art, created = store.publish_artifact(
            artifact_id, task["task_id"], attempt["attempt_id"], draft["document"],
            json.loads(attempt["input_manifest"] or "[]"), draft["structured"], latest["unknowns"] and json.loads(latest["unknowns"]), None)
        if created:
            self._store_claims(artifact_id, art["version"], draft, {})
            if contract["id"] == "brand_strategy":
                self._record_review(None, art, contract, "machine", None, attempt["attempt_id"], {}, "pass", "pass", [], "machine")
                store.set_artifact_status(artifact_id, art["version"], "accepted", "candidate")
            else:
                # 討論で修正された採用案は、機械検査だけで受理せず、別担当の検査へ戻す。
                store.db.execute("UPDATE reviews SET state='invalidated' WHERE artifact_id=? AND state='current'", (artifact_id,))
                if owner_task["state"] == "done":
                    store.transition(owner_task["task_id"], "awaiting_review", "討論の結果で採用案が修正された")
                self._create_review(store.task(owner_task["task_id"]), art, note="討論の結果で修正された版である")
            store.event("proposal_revised", task_id=task["task_id"], artifact=artifact_id, version=art["version"])
        return None, art["version"]

    # 検査 -------------------------------------------------------------
    def _record_review(self, task, art, contract, reviewer, instance, attempt_id, body, verdict, gate_verdict, reasons, kind):
        store = self.store
        review_id = store.next_id("R")
        sha = store.pin_contract(contract)
        store.db.execute(
            "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (review_id, task["task_id"] if task else None, art["artifact_id"], art["version"], art["sha256"], contract["id"], sha,
             reviewer, instance, attempt_id, verdict, gate_verdict, json.dumps(reasons, ensure_ascii=False),
             json.dumps(body, ensure_ascii=False, default=str), "current", kind, self.clock()),
        )
        store.link("review", review_id, "artifact", f"{art['artifact_id']}@{art['version']}", "inspects")
        store.event("review_recorded", task_id=task["task_id"] if task else None, review=review_id, artifact=art["artifact_id"],
                    version=art["version"], verdict=verdict, gate=gate_verdict, by=reviewer, reasons=reasons[:5])
        return review_id

    def _add_defects(self, review_id, art, findings, origin):
        """同じ欠陥が残っている場合は同じIDのまま回数を増やす。解消の追跡を修正をまたいで行うため。"""
        store = self.store
        added = []
        seen = set()
        for finding in findings:
            if finding.get("severity") != "major" and origin == "machine":
                continue
            signature = gate.defect_signature(art["artifact_id"], finding, origin)
            if signature in seen:
                continue  # 回数は検査をまたいで数える。同じ検査の中の複数の指摘で増やさない
            seen.add(signature)
            row = store.db.execute(
                "SELECT * FROM defects WHERE signature=? AND state='open' ORDER BY rowid DESC LIMIT 1", (signature,)
            ).fetchone()
            if row:
                store.db.execute("UPDATE defects SET occurrences=occurrences+1, version=?, review_id=?, reason=?, location=? WHERE defect_id=?",
                                 (art["version"], review_id, finding.get("reason"), finding.get("location"), row["defect_id"]))
                added.append(row["defect_id"])
                continue
            defect_id = store.next_id("D")
            store.db.execute(
                "INSERT INTO defects(defect_id,review_id,artifact_id,version,severity,category,criterion,location,quote,reason,fix_condition,fix_target,signature,state,origin,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (defect_id, review_id, art["artifact_id"], art["version"], finding.get("severity"), finding.get("category"), finding.get("criterion"),
                 finding.get("location"), finding.get("quote"), finding.get("reason"), finding.get("fix_condition"), finding.get("fix_target"),
                 signature, "open", origin, self.clock()),
            )
            added.append(defect_id)
        return added

    def _create_review(self, parent, art, note=None, second_check=False, same_version_recheck=False):
        """検査を独立した作業として登録する。作成者と別のインスタンスを必ず割り当てる。"""
        store = self.store
        n = len(store.tasks(parent=parent["task_id"], kind="review")) + 1
        authors = [r["instance_id"] for r in store.db.execute(
            "SELECT DISTINCT a.instance_id FROM attempts a JOIN artifacts x ON a.attempt_id=x.attempt_id WHERE x.artifact_id=?", (art["artifact_id"],))]
        past_reviewers = [r["instance_id"] for r in store.db.execute(
            "SELECT DISTINCT a.instance_id FROM attempts a JOIN tasks t ON a.task_id=t.task_id WHERE t.parent_task=? AND t.kind='review'", (parent["task_id"],))]
        specs = [{"kind": "pinned", "id": art["artifact_id"], "version": art["version"]}, {"kind": "sources"}, {"kind": "evidence"}]
        specs += [s for s in (parent["inputs"] or []) if s.get("kind") == "artifact"]
        contract_sha = parent["contract_sha"]
        role = parent["reviewer_role"]
        if role == parent["role"]:
            role = self.roles[parent["role"]].get("reviewer") or "V08"
        child = store.next_id(f"{parent['task_id']}.rev") if False else f"{parent['task_id']}.rev{n}"
        store.add_task(
            task_id=child, node_id=parent["node_id"], iter=parent["iter"], kind="review", role=role,
            purpose=f"成果物 {art['artifact_id']} v{art['version']} が品質契約を満たすかを判定する",
            inputs=specs, contract_id=parent["contract_id"], contract_sha=contract_sha, parent_task=parent["task_id"], state="ready",
            data={"artifact_id": art["artifact_id"], "version": art["version"], "sha": art["sha256"], "recheck_note": note,
                  "changes": parent["data"].get("last_changes"), "rebuttals": parent["data"].get("last_rebuttals"), "second_check": second_check,
                  "same_version_recheck": same_version_recheck,
                  "forbidden_instances": authors + past_reviewers, "force_new_instance": True},
        )
        store.event("review_created", task_id=child, artifact=art["artifact_id"], version=art["version"], role=role)
        return child

    def _on_review(self, task, attempt, payload):
        store = self.store
        data = task["data"]
        parent = store.task(task["parent_task"])
        art = store.artifact(data["artifact_id"], data["version"])
        contract = store.contract(task["contract_id"], task["contract_sha"])
        latest = store.latest_artifact(data["artifact_id"])
        if latest["version"] != data["version"] or latest["sha256"] != data["sha"]:
            # 検査中に版が変わった場合、この結果を新しい版へ流用しない。
            self._record_review(task, art, contract, task["role"], attempt["instance_id"], attempt["attempt_id"], payload,
                                payload.get("verdict"), "superseded", ["検査対象の版が現行ではない"], "content")
            store.transition(task["task_id"], "done", "検査対象の版が現行ではない", outcome="superseded")
            return None
        if attempt["instance_id"] in (data.get("forbidden_instances") or []):
            store.event("reviewer_is_author", task_id=task["task_id"], instance=attempt["instance_id"])
            return "作成者と同じインスタンスは検査できない"
        schema_errors = self._schema_errors(task, payload)
        if schema_errors:
            return "；".join(schema_errors[:5])
        defects = self.open_defects(art["artifact_id"])
        open_major = [d["defect_id"] for d in defects if d["severity"] == "major"]
        contract_changed = bool(store.db.execute("SELECT 1 FROM contract_changes WHERE task_id=?", (parent["task_id"],)).fetchone())
        decision = gate.decide(contract, [], payload, open_major, self._has_unconfirmed(art), contract_changed)
        if decision.verdict == "invalid_review":
            self._record_review(task, art, contract, task["role"], attempt["instance_id"], attempt["attempt_id"], payload,
                                payload.get("verdict"), "invalid_review", decision.reasons, "content")
            return "検査結果が不完全：" + "；".join(decision.reasons)

        # 変更量が少ないのに重大欠陥が解消したとする判定は、別の担当が確かめる。
        if decision.verdict == "pass" and open_major and not data.get("second_check") and self._small_change(art):
            review_id = self._record_review(task, art, contract, task["role"], attempt["instance_id"], attempt["attempt_id"], payload,
                                            payload.get("verdict"), "needs_second_check", ["修正の変更量が少ない"], "content")
            store.transition(task["task_id"], "done", "別の担当の再確認へ回す", outcome="needs_second_check")
            store.event("suspicious_small_fix", task_id=task["task_id"], review=review_id, artifact=art["artifact_id"], version=art["version"])
            self._create_review(parent, art, second_check=True)
            return None

        review_id = self._record_review(task, art, contract, task["role"], attempt["instance_id"], attempt["attempt_id"], payload,
                                        payload.get("verdict"), decision.verdict, decision.reasons, "content")
        for item in payload.get("resolved_defects", []):
            if item.get("resolved"):
                store.db.execute("UPDATE defects SET state='resolved', resolution=?, resolved_in=? WHERE defect_id=? AND state='open'",
                                 (item.get("how"), art["version"], item.get("defect_id")))
            else:
                store.db.execute("UPDATE defects SET occurrences=occurrences+1, version=?, review_id=? WHERE defect_id=? AND state='open'",
                                 (art["version"], review_id, item.get("defect_id")))
                store.event("defect_still_open", task_id=task["task_id"], defect=item.get("defect_id"), how=item.get("how"))
        store.link("review", review_id, "artifact", f"{art['artifact_id']}@{art['version']}", "inspects")
        self._add_defects(review_id, art, payload.get("defects", []), "content")
        store.transition(task["task_id"], "done", f"検査を完了した（{decision.verdict}）", outcome=decision.verdict)

        if decision.verdict == "pass":
            store.set_artifact_status(art["artifact_id"], art["version"], "accepted", decision.delivery_class)
            store.transition(parent["task_id"], "done", "品質ゲートを通過した", outcome=f"accepted:{decision.delivery_class}")
            if not data.get("same_version_recheck"):
                self._after_accept(store.task(parent["task_id"]), art)
            self._node_finished(store.task(parent["task_id"]))
            return None
        if decision.verdict == "hold":
            store.set_artifact_status(art["artifact_id"], art["version"], "on_hold")
            store.transition(parent["task_id"], "on_hold", "；".join(decision.reasons)[:300], outcome="on_hold_missing_info")
            self._parent_settled(store.task(parent["task_id"]))
            return None
        store.set_artifact_status(art["artifact_id"], art["version"], "rejected")
        store.event("artifact_rejected", task_id=parent["task_id"], artifact=art["artifact_id"], version=art["version"], by=task["role"], review=review_id, reasons=decision.reasons[:5])
        store.transition(parent["task_id"], "revising", "内容検査で不合格")
        data_parent = store.task(parent["task_id"])
        store.update_task(parent["task_id"], data={**data_parent["data"], "strengths": payload.get("strengths")})
        self._route_rejection(store.task(parent["task_id"]), art)
        return None

    def _small_change(self, art):
        if art["version"] <= 1:
            return False
        previous = self.store.artifact(art["artifact_id"], art["version"] - 1)
        ratio = SequenceMatcher(None, self.store.read_artifact(previous), self.store.read_artifact(art)).ratio()
        return ratio >= SMALL_CHANGE

    # 差し戻し ---------------------------------------------------------
    def _route_rejection(self, parent, art):
        """欠陥の分類に応じて差し戻し先を決める。同じ指示の繰り返しにしない。"""
        store = self.store
        limit = store.budget().get("revisions", 2)
        defects = [d for d in self.open_defects(art["artifact_id"]) if d["severity"] == "major"]
        if parent["revisions_used"] >= limit:
            self._fail_parent(parent, f"修正上限 {limit} 回に達した。未解消の重大欠陥：{[d['defect_id'] for d in defects]}", "revision_limit")
            return
        if self.remaining_calls() < 2:
            self._fail_parent(parent, "残りの呼び出し数が足りず修正できない", "budget")
            return
        repeated = [d for d in defects if d["occurrences"] >= 2]
        if repeated and not parent["data"].get("diagnosed"):
            self._start_diagnosis(parent, art)
            return
        categories = {d["category"] for d in defects}
        external_targets = {d["fix_target"] for d in defects if d["fix_target"] and d["fix_target"] != art["artifact_id"]}
        if "target_selection" in categories and art["artifact_id"] != self._strategy_artifact():
            external_targets.add(self._strategy_artifact())
        external_targets = {t for t in external_targets if t and store.owner(t)}
        if external_targets:
            waits = []
            for target in external_targets:
                reopened = self.reopen_artifact(target, f"{art['artifact_id']} の欠陥の原因が上流にある", defects)
                if reopened:
                    waits.append({"task": reopened})
            self._start_revise(parent, art, after=waits)
            return
        if categories & {"info_missing"} and self._can_research(parent):
            self._start_research(parent, art, defects)
            return
        if categories <= {"info_missing"} and not self._can_research(parent):
            store.transition(parent["task_id"], "on_hold", "情報不足で、追加調査でも取得できない", outcome="on_hold_missing_info")
            self._parent_settled(store.task(parent["task_id"]))
            return
        self._start_revise(parent, art)

    def _strategy_artifact(self):
        for node in self.graph["nodes"]:
            if node.get("contract") == "adopted_strategy":
                return node["output"]
        return None

    def _can_research(self, parent):
        return (self.brief.get("allow_research", True) and not parent["data"].get("researched")
                and self.remaining_calls() >= 3 and parent["kind"] != "research")

    def _start_research(self, parent, art, defects):
        store = self.store
        n = len(store.tasks(parent=parent["task_id"], kind="research")) + 1
        child_id = f"{parent['task_id']}.res{n}"
        output = f"{parent['node_id']}_research{n}"
        contract = self.contracts["research_note"]
        sha = store.pin_contract(contract)
        store.register_owner(output, child_id, "research_note")
        store.add_task(
            task_id=child_id, node_id=child_id, kind="research", role=parent["role"], parent_task=parent["task_id"],
            purpose="検査で見つかった情報不足について、取得できる資料を確認する",
            instructions="次の不足について資料を確認する。見つからなければ見つからないと書き、推測で埋めない：\n"
                         + "\n".join(f"- {d['reason']}" for d in defects if d["category"] == "info_missing"),
            inputs=[{"kind": "sources"}, {"kind": "evidence"}], output_artifact=output, contract_id="research_note", contract_sha=sha,
            reviewer_role=None, state="ready", data={"review_mode": "machine", "research_for": art["artifact_id"]},
        )
        store.update_task(parent["task_id"], data={**parent["data"], "researched": True})
        store.event("routed_to_research", task_id=parent["task_id"], research=child_id)

    def _start_revise(self, parent, art, note=None, force_new=False, after=None, extra_inputs=None):
        store = self.store
        n = len(store.tasks(parent=parent["task_id"], kind="revise")) + 1
        child_id = f"{parent['task_id']}.fix{n}"
        inputs = [{"kind": "pinned", "id": art["artifact_id"], "version": art["version"]}]
        inputs += [s for s in parent["inputs"] if s.get("kind") != "pinned"]
        inputs += extra_inputs or []
        data = {"artifact_id": art["artifact_id"], "from_version": art["version"], "strengths": parent["data"].get("strengths"),
                "diagnosis": note, "instance_key": f"author:{art['artifact_id']}"}
        if force_new:
            data["force_new_instance"] = True
            data["instance_key"] = f"author:{art['artifact_id']}:alt{n}"
            data["continuation_of"] = None
        store.add_task(
            task_id=child_id, node_id=parent["node_id"], iter=parent["iter"], kind="revise", role=parent["role"],
            purpose=f"成果物 {art['artifact_id']} の欠陥を原因に応じて修正する", inputs=inputs, depends_on=after or [],
            contract_id=parent["contract_id"], contract_sha=parent["contract_sha"], parent_task=parent["task_id"],
            state="pending" if after else "ready", data=data,
        )
        store.update_task(parent["task_id"], revisions_used=parent["revisions_used"] + 1)
        store.event("routed_to_revise", task_id=parent["task_id"], revise=child_id, from_version=art["version"], force_new=force_new)

    def _start_diagnosis(self, parent, art):
        store = self.store
        child_id = f"{parent['task_id']}.diag"
        alt_role = "G02" if parent["role"] != "G02" else "G01"
        store.add_task(
            task_id=child_id, node_id=parent["node_id"], iter=parent["iter"], kind="diagnose", role=alt_role, parent_task=parent["task_id"],
            purpose="同じ重大欠陥が続く原因を診断する", inputs=[{"kind": "pinned", "id": art["artifact_id"], "version": art["version"]}, {"kind": "sources"}],
            state="ready", data={"artifact_id": art["artifact_id"], "version": art["version"]},
        )
        store.update_task(parent["task_id"], data={**parent["data"], "diagnosed": True})
        store.event("routed_to_diagnosis", task_id=parent["task_id"], diagnosis=child_id)

    def _on_diagnose(self, task, attempt, payload):
        store = self.store
        schema_errors = self._schema_errors(task, payload)
        if schema_errors:
            return "；".join(schema_errors[:5])
        parent = store.task(task["parent_task"])
        art = store.artifact(task["data"]["artifact_id"], task["data"]["version"])
        store.transition(task["task_id"], "done", f"原因診断：{payload['cause'][:200]}", outcome=payload["route"])
        store.event("diagnosis", task_id=task["task_id"], cause=payload["cause"], route=payload["route"])
        if payload["route"] == "hold":
            store.transition(parent["task_id"], "on_hold", f"原因診断の結果、保留する：{payload['cause'][:200]}", outcome="on_hold_missing_info")
            self._parent_settled(store.task(parent["task_id"]))
            return None
        if parent["revisions_used"] >= store.budget().get("revisions", 2):
            self._fail_parent(parent, "原因診断は行ったが修正の上限に達している", "revision_limit")
            return None
        self._start_revise(parent, art, note=f"{payload['cause']}\n{payload['instructions']}", force_new=True)
        return None

    def _fail_parent(self, parent, reason, outcome):
        store = self.store
        store.transition(parent["task_id"], "failed", reason, outcome=outcome)
        store.event("task_failed", task_id=parent["task_id"], outcome=outcome, reason=reason)
        self._parent_settled(store.task(parent["task_id"]))

    def _child_failed(self, child, reason):
        """子の作業が失敗したときに親へ伝える。欠けた発言や検査を生成して埋めない。"""
        store = self.store
        if not child["parent_task"]:
            self._parent_settled(child)
            return
        parent = store.task(child["parent_task"])
        if parent["kind"] == "debate":
            return  # 討論は取得済みの発言で続け、未実施の役割を記録する
        if child["kind"] == "research" and parent["state"] == "revising":
            store.transition(parent["task_id"], "on_hold", f"追加調査が完了しなかった：{reason[:200]}", outcome="on_hold_missing_info")
            return
        if parent["state"] in {"awaiting_review", "revising"}:
            store.transition(parent["task_id"], "failed", f"{child['kind']} の作業が失敗した：{reason[:200]}", outcome="execution_failed")
            self._parent_settled(store.task(parent["task_id"]))

    def _parent_settled(self, task):
        """作業が保留または失敗で終わったことを親の作業へ伝える。"""
        store = self.store
        if task["kind"] == "research" and task["parent_task"]:
            parent = store.task(task["parent_task"])
            if parent["state"] == "revising":
                store.transition(parent["task_id"], "on_hold", "追加調査が完了しなかった", outcome="on_hold_missing_info")

    # 完了後の処理 -----------------------------------------------------
    def _after_accept(self, task, art):
        """合格の版が変わったら、変更された主張を参照する下流の合格を無効にする。"""
        if art["version"] <= 1:
            return
        previous = self._previous_accepted(art)
        if previous is None:
            return
        changed = impact.changed_claims(self.store, art["artifact_id"], previous["version"], art["version"])
        self._invalidate_downstream(art["artifact_id"], changed, f"{art['artifact_id']} が v{previous['version']} から v{art['version']} へ更新された")

    def _previous_accepted(self, art):
        row = self.store.db.execute(
            "SELECT a.* FROM artifacts a JOIN reviews r ON a.artifact_id=r.artifact_id AND a.version=r.version WHERE a.artifact_id=? AND a.version<? AND r.gate_verdict='pass' ORDER BY a.version DESC LIMIT 1",
            (art["artifact_id"], art["version"]),
        ).fetchone()
        return dict(row) if row else None

    def _invalidate_downstream(self, artifact_id, changed, reason):
        store = self.store
        impacted = impact.downstream_artifacts(store, artifact_id, changed)
        for other in list(impacted):
            latest = store.latest_artifact(other)
            if latest and latest["delivery_class"] == "candidate" and self._strategy_artifact() and store.latest_accepted(self._strategy_artifact()):
                impacted.pop(other)
                store.event("impact_skipped_candidate", artifact=other, reason="採用案が決まった後の候補は討論の記録であり、再確認しない")
        self.invalidate_bundles(reason)
        for other, refs in impacted.items():
            self._invalidate_artifact(other, f"{reason}。影響する主張：{refs}")
        store.event("impact_analyzed", artifact=artifact_id, changed=sorted(changed), impacted=sorted(impacted))
        return impacted

    def _invalidate_artifact(self, artifact_id, note):
        """合格を無効にし、再確認の作業を登録する。やり直しではなく検査から始める。"""
        store = self.store
        art = store.latest_artifact(artifact_id)
        owner = store.owner(artifact_id)
        task = store.latest_of_node(owner["task_id"]) or store.task(owner["task_id"])
        with store.tx():
            store.db.execute("UPDATE reviews SET state='invalidated' WHERE artifact_id=? AND version=? AND state='current'", (artifact_id, art["version"]))
            store.set_artifact_status(artifact_id, art["version"], "invalidated")
            if task["state"] == "done":
                # 入力が変わると検査の前提も変わる。以前の修正回数を新しい状況へ持ち越さない。
                # 全体の呼び出し上限は引き続き適用される。
                data = {k: v for k, v in task["data"].items() if k not in {"diagnosed", "researched"}}
                store.update_task(task["task_id"], revisions_used=0, data=data)
                store.transition(task["task_id"], "awaiting_review", f"入力の変更により再確認する：{note[:200]}")
                self._create_review(store.task(task["task_id"]), art, note=note, same_version_recheck=True)
            store.event("acceptance_invalidated", task_id=task["task_id"], artifact=artifact_id, version=art["version"], note=note)

    def invalidate_bundles(self, reason):
        store = self.store
        for row in store.db.execute("SELECT bundle_id FROM bundles WHERE state='accepted'").fetchall():
            store.db.execute("UPDATE bundles SET state='invalidated' WHERE bundle_id=?", (row["bundle_id"],))
            store.event("bundle_invalidated", bundle=row["bundle_id"], reason=reason)
        # 一式の合格を失ったら、横断検査を新しい試行として登録する。流用しない。
        self._reactivate_final_check()

    def reopen_artifact(self, artifact_id, reason, defects=None):
        """完了済みの成果物を修正へ戻す。戻した作業のIDを返す。"""
        store = self.store
        owner = store.owner(artifact_id)
        if not owner:
            return None
        task = store.latest_of_node(owner["task_id"]) or store.task(owner["task_id"])
        art = store.latest_artifact(artifact_id)
        if task["state"] != "done" or art is None:
            return None
        limit = store.budget().get("revisions", 2)
        if task["revisions_used"] >= limit:
            self._fail_after_done(task, f"修正上限 {limit} 回に達しているので上流を修正できない")
            return None
        with store.tx():
            store.transition(task["task_id"], "revising", reason)
            store.set_artifact_status(artifact_id, art["version"], "rejected")
            store.db.execute("UPDATE reviews SET state='invalidated' WHERE artifact_id=? AND version=? AND state='current'", (artifact_id, art["version"]))
            findings = [{"severity": d.get("severity", "major"), "category": d.get("category", "cross_doc"), "criterion": d.get("criterion") or d.get("signature"),
                         "location": d.get("location"), "quote": d.get("quote"), "reason": d.get("reason"), "fix_condition": d.get("fix_condition"),
                         "fix_target": None} for d in (defects or [])]
            review_id = self._record_review(None, art, store.contract(task["contract_id"], task["contract_sha"]), "cross_reference", None, None,
                                            {"reason": reason}, "fail", "fail", [reason], "upstream")
            self._add_defects(review_id, art, findings, "upstream")
            self._start_revise(store.task(task["task_id"]), art, note=reason)
        store.event("artifact_reopened", task_id=task["task_id"], artifact=artifact_id, reason=reason)
        return task["task_id"]

    def _fail_after_done(self, task, reason):
        store = self.store
        store.event("reopen_denied", task_id=task["task_id"], reason=reason)
        store.set_meta("revision_limit_reached", True)

    # グラフの進行 -----------------------------------------------------
    def _node_finished(self, task):
        """on の辺をたどって次のノードを起動する。循環は上限を確認してから進める。"""
        store = self.store
        if task["parent_task"] or not self.node(task["node_id"]):
            self._after_child_research(task)
            return
        outcome = task["outcome"]
        for edge in self.graph["edges"]:
            if edge["from"] != task["node_id"] or edge["type"] != "on":
                continue
            if edge.get("when") and not any(outcome == w or str(outcome).startswith(f"{w}:") for w in edge["when"]):
                continue
            self._follow(edge, task)

    def _after_child_research(self, task):
        store = self.store
        if task["kind"] != "research" or not task["parent_task"]:
            return
        parent = store.task(task["parent_task"])
        art = store.artifact(task["data"]["research_for"], store.latest_artifact(task["data"]["research_for"])["version"])
        note = store.latest_artifact(task["output_artifact"])
        unknowns = json.loads(note["unknowns"] or "[]")
        claims = store.claims_of(note["artifact_id"], note["version"])
        if not any(c["evidence"] for c in claims) and any(u.get("obtainable") is False for u in unknowns):
            store.transition(parent["task_id"], "on_hold", "追加調査でも必要な資料を取得できなかった", outcome="on_hold_missing_info")
            self._parent_settled(store.task(parent["task_id"]))
            return
        self._start_revise(parent, art, extra_inputs=[{"kind": "artifact", "id": note["artifact_id"]}])

    def _follow(self, edge, task):
        store = self.store
        target = self.node(edge["to"])
        if target["kind"] == "terminal":
            store.event("terminal_reached", node=target["id"], status=target["status"], via=task["task_id"])
            store.set_meta("terminal_hint", target["status"])
            return
        traversals = store.get_meta("traversals", {})
        key = f"{edge['from']}->{edge['to']}"
        count = traversals.get(key, 0)
        if edge.get("max_traversals") is not None and count >= edge["max_traversals"]:
            store.event("traversal_limit", edge=key, limit=edge["max_traversals"], from_task=task["task_id"])
            forced = edge.get("on_limit_outcome")
            if forced:
                store.update_task(task["task_id"], outcome=forced, note=f"循環の上限に達したので {forced} として扱う")
            elif edge.get("on_limit_terminal"):
                store.set_meta("terminal_hint", edge["on_limit_terminal"])
                store.set_meta("revision_limit_reached", True)
                store.set_meta("limit_reason", f"{edge['from']} の繰り返しが上限 {edge['max_traversals']} 回に達した。未解消の欠陥が残る")
            return
        traversals[key] = count + 1
        store.set_meta("traversals", traversals)
        latest = store.latest_of_node(target["id"])
        iter_no = (latest["iter"] + 1) if latest else 1
        planner.add_node_task(store, target, self.graph, self.contracts, iter_no)
        new_id = target["id"] if iter_no == 1 else f"{target['id']}~{iter_no}"
        _seed_decide_data(store, target, new_id)
        if target["kind"] == "crosscheck":
            self._add_upstream_dependency(new_id, target)
        new_task = store.task(new_id)
        data = dict(new_task["data"])
        if task["data"].get("decision"):
            data["trigger"] = task["data"]["decision"]
        store.update_task(new_id, data=data)
        store.event("node_activated", task_id=new_id, via=edge["from"], outcome=task["outcome"])

    def _on_decide(self, task, attempt, payload):
        store = self.store
        schema_errors = self._schema_errors(task, payload)
        if schema_errors:
            return "；".join(schema_errors[:5])
        outcomes = task["data"].get("outcomes") or []
        if payload.get("branch") not in outcomes:
            return f"branch は {outcomes} のいずれかにする"
        store.update_task(task["task_id"], data={**task["data"], "decision": payload})
        store.transition(task["task_id"], "done", payload.get("reason", "")[:300], outcome=payload["branch"])
        self._node_finished(store.task(task["task_id"]))
        return None

    def _on_debate_turn(self, task, attempt, payload):
        handler = {"critique": self.debate.on_critique, "respond": self.debate.on_response, "reeval": self.debate.on_reeval}[task["kind"]]
        schema_errors = self._schema_errors(task, payload)
        if schema_errors:
            return "；".join(schema_errors[:5])
        problem = handler(task, attempt, payload)
        if problem:
            return problem
        deliver = []
        if task["kind"] == "respond":
            deliver = [m["message_id"] for m in self.debate.messages(task["data"]["issue_id"], target_artifact=task["data"]["artifact"]) if m["kind"] in {"critique", "question", "propose", "reevaluate", "support"}]
        elif task["kind"] == "reeval":
            deliver = [m["message_id"] for m in self.debate.messages(task["data"]["issue_id"], kind="respond", to_role=task["role"])]
        self.debate.mark_delivered(deliver, attempt["attempt_id"])
        self.store.transition(task["task_id"], "done", "発言を記録した", outcome="recorded")
        return None

    def apply_issue_plan(self, node):
        """討論進行（G04）が示した争点があれば取り込む。参加者は検査してから使う。"""
        plan_node = next((n for n in self.graph["nodes"] if n.get("contract") == "governance_note" and n.get("role") == "G04"), None)
        if not plan_node:
            return node
        art = self.store.latest_accepted(plan_node["output"])
        if not art:
            return node
        plan = (json.loads(art["structured"] or "{}").get("issues") or {}).get(node["id"])
        if not isinstance(plan, dict):
            return node
        critics = [c for c in plan.get("critics") or [] if c in self.roles]
        merged = dict(node)
        if plan.get("title"):
            merged["title"] = plan["title"]
        if plan.get("why"):
            merged["why"] = plan["why"]
        # 候補ごとの評価が2つ未満や、相手の主張へ応答できない大人数になる案は採用しない。
        if 2 <= len(critics) <= 5:
            merged["critics"] = critics
        else:
            self.store.event("issue_plan_critics_rejected", node=node["id"], critics=plan.get("critics"))
        self.store.event("issue_plan_applied", node=node["id"], title=merged.get("title"), critics=merged["critics"])
        return merged

    def apply_issue_plan(self, node):
        """討論進行（G04）が示した争点があれば取り込む。参加者は検査してから使う。"""
        plan_node = next((n for n in self.graph["nodes"] if n.get("contract") == "governance_note" and n.get("role") == "G04"), None)
        if not plan_node:
            return node
        art = self.store.latest_accepted(plan_node["output"])
        if not art:
            return node
        plan = (json.loads(art["structured"] or "{}").get("issues") or {}).get(node["id"])
        if not isinstance(plan, dict):
            return node
        critics = [c for c in plan.get("critics") or [] if c in self.roles]
        merged = dict(node)
        if plan.get("title"):
            merged["title"] = plan["title"]
        if plan.get("why"):
            merged["why"] = plan["why"]
        # 候補ごとの評価が2つ未満や、相手の主張へ応答できない大人数になる案は採用しない。
        if 2 <= len(critics) <= 5:
            merged["critics"] = critics
        else:
            self.store.event("issue_plan_critics_rejected", node=node["id"], critics=plan.get("critics"))
        self.store.event("issue_plan_applied", node=node["id"], title=merged.get("title"), critics=merged["critics"])
        return merged

    def add_child(self, coordinator, suffix, kind, role, purpose, inputs, data):
        child_id = f"{coordinator['task_id']}.{suffix}"
        return self.store.add_task(
            task_id=child_id, node_id=coordinator["node_id"], iter=coordinator["iter"], kind=kind, role=role, purpose=purpose,
            inputs=inputs, parent_task=coordinator["task_id"], state="ready", data=data,
        )

    def finish_coordinator(self, coordinator, outcome, note):
        store = self.store
        store.transition(coordinator["task_id"], "done", note[:300], outcome=outcome)
        self._node_finished(store.task(coordinator["task_id"]))

    # 横断検査 ---------------------------------------------------------
    def _prepare_crosscheck(self, task):
        """全資料の版を固定した一覧を作り、機械検査の結果とともに内容検査へ渡す。"""
        store = self.store
        node = self.node(task["node_id"])
        manifest, inputs = [], [{"kind": "sources"}, {"kind": "evidence"}]
        for artifact_id in node["artifacts"]:
            art = store.latest_accepted(artifact_id)
            if art:
                manifest.append({"artifact_id": artifact_id, "version": art["version"], "sha256": art["sha256"]})
                inputs.append({"kind": "pinned", "id": artifact_id, "version": art["version"]})
            else:
                store.event("bundle_missing_artifact", task_id=task["task_id"], artifact=artifact_id)
        media = set()
        for artifact_id in node["artifacts"]:
            owner = store.owner(artifact_id)
            contract = self.contracts.get((owner or {}).get("artifact_type") or "", {})
            if contract.get("external_facing") or (owner or {}).get("artifact_type") == "validation_plan":
                media.add(artifact_id)
        findings = crossdoc.check_bundle(store, manifest, self._strategy_artifact() or "adopted_strategy", media)
        hard = [self._finding_dict(f) | {"check": f.check} for f in findings if f.severity == "major"]
        flags = [self._finding_dict(f) | {"check": f.check, "flag_id": f"F{i}"} for i, f in enumerate([f for f in findings if f.severity == "flag"], 1)]
        data = {**task["data"], "manifest": manifest, "machine_findings": hard, "machine_flags": flags}
        store.update_task(task["task_id"], inputs=inputs, data=data)
        store.event("bundle_prepared", task_id=task["task_id"], manifest=manifest, machine_findings=len(hard), machine_flags=len(flags))

    def _on_crosscheck(self, task, attempt, payload):
        store = self.store
        schema_errors = self._schema_errors(task, payload)
        if schema_errors:
            return "；".join(schema_errors[:5])
        data = task["data"]
        manifest = data["manifest"]
        machine = data.get("machine_findings") or []
        flags = {f["flag_id"]: f for f in data.get("machine_flags") or []}
        rulings = {r.get("flag_id"): r for r in payload.get("flag_rulings") or []}
        missing = [fid for fid in flags if fid not in rulings or not str(rulings[fid].get("reason", "")).strip()]
        if missing:
            return f"機械検査の確認依頼 {missing} に、確定（confirmed）か退ける（dismissed）かの判断と理由がない"
        confirmed = []
        for fid, flag in flags.items():
            ruling = rulings[fid]
            if ruling.get("ruling") == "confirmed":
                confirmed.append({**flag, "severity": "major", "reason": f"{flag['reason']}（内容検査で確定：{ruling.get('reason')}）"})
            store.event("machine_flag_ruled", task_id=task["task_id"], flag=fid, check=flag["check"], ruling=ruling.get("ruling"), reason=ruling.get("reason"))
        major = [d for d in payload.get("defects", []) if d.get("severity") == "major"]
        all_major = machine + confirmed + major
        for defect in payload.get("defects", []):
            if not defect.get("fix_target"):
                return "資料間の欠陥には修正する成果物（fix_target）を示す"
        bundle_sha = sha256_text(json.dumps(manifest, sort_keys=True))
        store.set_meta("crossdoc_last", {"task": task["task_id"], "payload": payload, "machine": machine, "flags": list(flags.values()), "manifest": manifest})
        if payload.get("verdict") == "consistent" and not all_major:
            # 検査中に資料が更新されていれば、この一覧の合格を確定しない。
            stale = [m for m in manifest if (store.latest_accepted(m["artifact_id"]) or {}).get("version") != m["version"]]
            if stale:
                store.transition(task["task_id"], "done", "検査中に資料が更新された", outcome="inconsistent")
                self._node_finished(store.task(task["task_id"]))
                return None
            bundle_id = store.next_id("B")
            store.db.execute("INSERT INTO bundles VALUES(?,?,?,?,?,?)", (bundle_id, json.dumps(manifest, ensure_ascii=False), bundle_sha, "accepted", None, self.clock()))
            store.event("bundle_accepted", task_id=task["task_id"], bundle=bundle_id, manifest=manifest)
            store.transition(task["task_id"], "done", "資料一式の横断検査に合格した", outcome="accepted")
            self._node_finished(store.task(task["task_id"]))
            return None
        by_target = {}
        for finding in all_major:
            target = finding.get("fix_target")
            if target and store.owner(target):
                by_target.setdefault(target, []).append({**finding, "category": finding.get("category") or "cross_doc", "criterion": finding.get("criterion") or finding.get("check") or finding.get("check_type") or finding.get("location")})
        store.transition(task["task_id"], "done", f"資料間の欠陥 {len(all_major)} 件", outcome="inconsistent")
        store.event("bundle_rejected", task_id=task["task_id"], defects=[f.get("reason") for f in all_major][:10], targets=sorted(by_target))
        waits = []
        for target, defects in by_target.items():
            reopened = self.reopen_artifact(target, f"資料横断の検査で欠陥が見つかった（{task['task_id']}）", defects)
            if reopened:
                waits.append(reopened)
        self._node_finished(store.task(task["task_id"]))
        return None

    # 外部からの更新 ---------------------------------------------------
    def update_source(self, source_id, new_text, title=None, retrieved_at=None):
        """資料の更新を反映する。影響する合格だけを無効にし、再確認を登録する。"""
        store = self.store
        current = store.source(source_id)
        product = current["product_id"] if current else self.brief["product"]["id"]
        store.add_source(source_id, new_text, product, title or (current or {}).get("title", ""), (current or {}).get("kind", "document"), retrieved_at or self.today.isoformat(), origin="updated")
        stale = impact.reverify_evidence(store, source_id, new_text)
        impacted = impact.artifacts_citing(store, stale) if stale else {}
        self._reopen_run_if_finished("資料が更新された")
        if impacted:
            self.invalidate_bundles(f"資料 {source_id} が更新された")
        for artifact_id, claims in impacted.items():
            self._invalidate_artifact(artifact_id, f"資料 {source_id} の更新で根拠 {sorted(stale)} を確認できなくなった。影響する主張：{claims}")
        store.event("source_updated", source=source_id, stale=sorted(stale), impacted=sorted(impacted))
        self._release_holds(source_id)
        return {"stale_evidence": sorted(stale), "impacted": impacted}

    def _release_holds(self, source_id):
        store = self.store
        for task in store.tasks(state="on_hold"):
            art = store.latest_artifact(task["output_artifact"]) if task["output_artifact"] else None
            if not art:
                store.transition(task["task_id"], "ready", f"資料 {source_id} の更新により再開する")
                continue
            store.transition(task["task_id"], "ready", f"資料 {source_id} の更新により再開する")
            store.update_task(task["task_id"], data={**task["data"], "retry_note": "追加された資料を確認して作り直す"})

    def replace_artifact(self, artifact_id, document, claims=None, structured=None, note="差し替え"):
        """合格後の差し替え。一式の合格を流用せず、検査と横断検査をやり直す。"""
        store = self.store
        owner = store.owner(artifact_id)
        task = store.latest_of_node(owner["task_id"]) or store.task(owner["task_id"])
        contract = store.contract(task["contract_id"], task["contract_sha"])
        self._reopen_run_if_finished(f"{artifact_id} が差し替えられた")
        latest = store.latest_artifact(artifact_id)
        synthetic = f"replace-{store.next_id('X')}"
        art, _ = store.publish_artifact(artifact_id, task["task_id"], synthetic, document, json.loads(latest["input_manifest"] or "[]"),
                                        structured or json.loads(latest["structured"] or "{}"), json.loads(latest["unknowns"] or "[]"), None)
        previous_claims = claims
        if previous_claims is None:
            previous_claims = [{"id": c["local_id"], "text": c["text"], "type": c["type"], "status": c["status"], "evidence": c["evidence"],
                                "target_customer": c["target_customer"], "conditions": c["conditions"], "reason": c["reason"], "derived_from": c["derived_from"],
                                "metric": c["metric"], "audience": c["audience"]} for c in store.claims_of(artifact_id, latest["version"])]
        self._store_claims(artifact_id, art["version"], {"claims": previous_claims}, {})
        with store.tx():
            store.db.execute("UPDATE reviews SET state='invalidated' WHERE artifact_id=? AND state='current'", (artifact_id,))
            self.invalidate_bundles(f"{artifact_id} が差し替えられた")
            if task["state"] == "done":
                store.transition(task["task_id"], "awaiting_review", note)
            self._create_review(store.task(task["task_id"]), art, note=f"合格後に差し替えられた版である：{note}")
        store.event("artifact_replaced", task_id=task["task_id"], artifact=artifact_id, version=art["version"])
        return art["version"]

    def _reopen_run_if_finished(self, reason):
        store = self.store
        if store.run_status() in TERMINAL_RUN_STATUS:
            # 資料や成果物の更新があった場合、以前の終了状態を流用しない。
            store.set_meta("status", "paused")
            store.set_meta("status_reason", reason)
            store.set_meta("budget_exhausted", False)
            store.event("run_reopened", reason=reason)

    def _reactivate_final_check(self):
        """一式の合格が無効になったら、横断検査のノードを新しい試行として登録する。"""
        store = self.store
        for node in self.graph["nodes"]:
            if node["kind"] != "crosscheck":
                continue
            latest = store.latest_of_node(node["id"])
            accepted = store.db.execute("SELECT 1 FROM bundles WHERE state='accepted'").fetchone()
            if latest and latest["state"] == "done" and not accepted and latest["outcome"] == "accepted":
                next_iter = latest["iter"] + 1
                planner.add_node_task(store, node, self.graph, self.contracts, next_iter)
                _seed_decide_data(store, node, f"{node['id']}~{next_iter}")
                self._add_upstream_dependency(f"{node['id']}~{next_iter}", node)

    def _add_upstream_dependency(self, task_id, node):
        """資料の再確認が終わるまで横断検査を始めない。"""
        store = self.store
        task = store.task(task_id)
        deps = list(task["depends_on"])
        for artifact_id in node["artifacts"]:
            owner = store.owner(artifact_id)
            if owner:
                deps.append({"node": owner["task_id"]})
        store.update_task(task_id, depends_on=deps)

    def record_contract_change(self, task_id, new_contract, reason, impact_note):
        """品質契約の変更は記録だけを残し、元の条件では未達であることを保つ。"""
        store = self.store
        task = store.task(task_id)
        old_sha = task["contract_sha"]
        new_sha = store.pin_contract(new_contract)
        change_id = store.next_id("CC")
        store.db.execute("INSERT INTO contract_changes VALUES(?,?,?,?,?,?,?)", (change_id, task_id, old_sha, new_sha, reason, impact_note, self.clock()))
        store.event("contract_change_recorded", task_id=task_id, change=change_id, reason=reason)
        return change_id

    # 終了 -------------------------------------------------------------
    def _settle(self):
        store = self.store
        tasks = store.tasks()
        if store.get_meta("adapter_unavailable"):
            return self._finish("execution_failed", f"実行基盤を利用できない：{store.get_meta('adapter_unavailable')}")
        failed = [t for t in tasks if t["state"] == "failed" and not t["parent_task"]]
        unanswered = self.debate.unanswered_major()
        holds = [t for t in tasks if t["state"] == "on_hold"]
        bundle = store.db.execute("SELECT * FROM bundles WHERE state='accepted' ORDER BY rowid DESC LIMIT 1").fetchone()
        unfinished = [t["task_id"] for t in tasks if t["state"] not in {"done", "failed", "on_hold", "out_of_scope"} and not t["parent_task"]]
        if store.get_meta("budget_exhausted", False):
            return self._finish("budget_unmet", f"全体の呼び出し上限に達した。未完了：{unfinished[:20]}")
        if any(t["outcome"] in {"revision_limit", "budget"} for t in failed) or store.get_meta("revision_limit_reached", False):
            detail = store.get_meta("limit_reason") or "修正の上限に達した"
            return self._finish("budget_unmet", f"{detail}。失敗：{[t['task_id'] for t in failed]}、未完了：{unfinished[:20]}")
        if holds:
            return self._finish("on_hold_missing_info", f"保留：{[t['task_id'] for t in holds]}")
        if unanswered:
            # 重要な批判に応答がない状態は、成果物が合格していても終了条件を満たさない。
            return self._finish("execution_failed", f"重大な批判 {[m['message_id'] for m in unanswered]} に応答がない。提案者の応答を得られなかった")
        if failed:
            return self._finish("execution_failed", f"失敗：{[t['task_id'] for t in failed]}")
        if not bundle or unfinished:
            return self._finish("execution_failed", f"横断検査の合格がない、または未完了の作業が残る：{unfinished[:20]}")
        changes = store.db.execute("SELECT * FROM contract_changes").fetchall()
        if changes:
            return self._finish("on_hold_missing_info", f"品質契約の変更 {[c['change_id'] for c in changes]} の判断待ち。元の条件では未達である")
        hypothesis = store.db.execute(
            "SELECT 1 FROM artifacts WHERE status='accepted' AND delivery_class LIKE 'hypothesis%' LIMIT 1").fetchone()
        if hypothesis:
            return self._finish("hypothesis_contract_met", "仮説案としての品質契約を満たした。未確認の事項は未確認のまま残っている")
        return self._finish("contract_met", "品質契約を満たした")

    def _finish(self, status, reason):
        self.store.set_run_status(status, reason)
        self.store.set_meta("finished_at", self.clock())
        return status
