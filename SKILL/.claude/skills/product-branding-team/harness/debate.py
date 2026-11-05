"""実際の発言を受け渡す相互批評。

親が相手の回答を代作することはない。発言はサブエージェントの出力から記録し、宛先の
セッションへ全文を転送する。批判→応答・修正→再評価を一巡とし、再評価のない討論は
完了にしない。
"""
from __future__ import annotations

import json
from difflib import SequenceMatcher

from validators.formal import is_vague_message, norm

PENDING = {"open", "answered", "unresolved", "partially_resolved"}
NON_DEBATABLE = {"info_missing"}  # 追加の討論では解消できない論争の種類


class Debate:
    def __init__(self, engine):
        self.e = engine
        self.s = engine.store

    # 読み出し ---------------------------------------------------------
    def issue(self, issue_id):
        row = self.s.db.execute("SELECT * FROM issues WHERE issue_id=?", (issue_id,)).fetchone()
        return dict(row) if row else None

    def messages(self, issue_id, **filters):
        sql, args = "SELECT * FROM messages WHERE issue_id=?", [issue_id]
        for key, value in filters.items():
            sql += f" AND {key}=?"
            args.append(value)
        return [dict(r) for r in self.s.db.execute(sql + " ORDER BY rowid", args)]

    def messages_for_response(self, issue_id, artifact):
        """提案者がまだ答えていない批判と質問。再評価で未解消とされた批判も含む。"""
        out = []
        for m in self.messages(issue_id, target_artifact=artifact):
            if m["kind"] in {"critique", "question", "propose"} and m["disposition"] in {"open", "unresolved", "partially_resolved"}:
                out.append(m)
        # 再評価の発言は批判の続きなので、提案者に全文を渡す。
        for m in list(out):
            ev = self._latest_reeval(issue_id, m["message_id"])
            if ev:
                out.insert(out.index(m) + 1, ev)
        return out

    def _latest_reeval(self, issue_id, critique_id):
        row = self.s.db.execute(
            "SELECT * FROM messages WHERE issue_id=? AND kind='reevaluate' AND about_critique=? ORDER BY rowid DESC LIMIT 1",
            (issue_id, critique_id),
        ).fetchone()
        return dict(row) if row else None

    def supports_for(self, issue_id, artifact):
        return self.messages(issue_id, target_artifact=artifact, kind="support")

    def pairs_for_reeval(self, issue_id, role, round_no):
        pairs = []
        for critique in self.messages(issue_id, from_role=role):
            if critique["kind"] != "critique" or critique["disposition"] != "answered":
                continue
            response = self.s.db.execute(
                "SELECT * FROM messages WHERE issue_id=? AND kind='respond' AND in_reply_to=? ORDER BY rowid DESC LIMIT 1",
                (issue_id, critique["message_id"]),
            ).fetchone()
            pairs.append((critique, dict(response) if response else None))
        return pairs

    # 開始 -------------------------------------------------------------
    def open(self, task, node):
        """論点を登録し、第1巡の批評を依頼する。各候補に少なくとも2つの評価を割り当てる。"""
        issue_id = f"I-{node['id']}" + ("" if task["iter"] == 1 else f"~{task['iter']}")
        if not self.issue(issue_id):
            proposals = [p["artifact"] for p in node["proposers"]]
            max_rounds = min(node["max_rounds"], self.s.budget().get("debate_rounds", 3))
            self.s.db.execute(
                "INSERT INTO issues(issue_id,node_id,title,why,state,round,max_rounds,proposers,critics,proposal_artifacts) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (issue_id, node["id"], node.get("title", ""), node.get("why", ""), "open", 0, max_rounds,
                 json.dumps(node["proposers"], ensure_ascii=False), json.dumps(node["critics"], ensure_ascii=False),
                 json.dumps(proposals, ensure_ascii=False)),
            )
            self.s.event("issue_opened", task_id=task["task_id"], issue=issue_id, title=node.get("title", ""))
        self.s.update_task(task["task_id"], data={**task["data"], "issue_id": issue_id})
        self._start_critique(issue_id, task, node)

    def _start_critique(self, issue_id, coordinator, node):
        self.s.db.execute("UPDATE issues SET round=1 WHERE issue_id=?", (issue_id,))
        inputs = [{"kind": "artifact", "id": p["artifact"], "state": "latest"} for p in node["proposers"]]
        inputs += [{"kind": "sources"}, {"kind": "evidence"}] + list(node.get("inputs", []))
        for critic in node["critics"]:
            self.e.add_child(
                coordinator, suffix=f"r1.crit.{critic}", kind="critique", role=critic,
                purpose=f"論点「{node.get('title', '')}」について提案を評価し、宛先へ発言を届ける",
                inputs=inputs, data={"issue_id": issue_id, "round": 1, "instance_key": f"debate:{issue_id}:{critic}"},
            )

    # 結果の受け取り ---------------------------------------------------
    def on_critique(self, task, attempt, payload):
        issue_id = task["data"]["issue_id"]
        issue = self.issue(issue_id)
        proposers = {p["artifact"]: p["role"] for p in json.loads(issue["proposers"])}
        errors = []
        for i, message in enumerate(payload.get("messages", [])):
            if message.get("target_artifact") not in proposers:
                errors.append(f"発言{i + 1}の target_artifact が論点の案ではない")
                continue
            vague = is_vague_message(message)
            if vague:
                errors.append(f"発言{i + 1}：{vague}")
        if errors:
            return "；".join(errors)
        if not payload.get("messages"):
            return "発言がない。批判も支持もないなら、どの主張を確認し、なぜ指摘がないかを support で書く"
        with self.s.tx():
            for message in payload["messages"]:
                self._insert(issue, task, attempt, message, to_role=proposers[message["target_artifact"]])
        return None

    def on_response(self, task, attempt, payload):
        data = task["data"]
        issue_id, artifact = data["issue_id"], data["artifact"]
        issue = self.issue(issue_id)
        opened = [m for m in self.messages_for_response(issue_id, artifact) if m["kind"] != "reevaluate"]
        # 再評価の発言へ答えた場合は、その批判への応答として扱う。
        about = {m["message_id"]: m["about_critique"] for m in self.messages(issue_id, kind="reevaluate")}
        responses = [{**r, "in_reply_to": about.get(r.get("in_reply_to"), r.get("in_reply_to"))} for r in payload.get("responses", [])]
        answered = {r.get("in_reply_to") for r in responses}
        missing = [m["message_id"] for m in opened if m["message_id"] not in answered]
        if missing:
            return f"発言 {missing} への応答がない。すべての批判に答える"
        needs_revision = any(r.get("action") in {"accept_revise", "limit_condition"} for r in responses)
        new_version = None
        if needs_revision and not str(payload.get("revised_document", "")).strip():
            return "受け入れる、または条件を限定するとした批判があるのに、修正した本文がない"
        if str(payload.get("revised_document", "")).strip():
            problem, new_version = self.e.publish_proposal_revision(task, attempt, artifact, payload)
            if problem:
                return problem
        with self.s.tx():
            for response in responses:
                target = next((m for m in opened if m["message_id"] == response["in_reply_to"]), None)
                if target is None:
                    continue
                self._insert(issue, task, attempt, {
                    "kind": "respond", "target_artifact": artifact, "target_claim": target["target_claim"],
                    "quote": target["quote"], "body": response["body"], "reason": response["reason"],
                    "evidence": response.get("evidence"), "flips_if": response.get("flips_if"),
                    "in_reply_to": target["message_id"], "keep_strength": payload.get("kept"),
                }, to_role=target["from_role"], disposition=response["action"], new_version=new_version)
                self.s.db.execute("UPDATE messages SET disposition='answered' WHERE message_id=?", (target["message_id"],))
                self.s.link("message", f"{task['task_id']}", "message", target["message_id"], "responds")
        return None

    def on_reeval(self, task, attempt, payload):
        data = task["data"]
        issue_id = data["issue_id"]
        issue = self.issue(issue_id)
        pairs = self.pairs_for_reeval(issue_id, task["role"], data["round"])
        judgments = {j.get("about_critique"): j for j in payload.get("judgments", [])}
        errors = []
        for critique, response in pairs:
            judgment = judgments.get(critique["message_id"])
            if judgment is None:
                errors.append(f"批判 {critique['message_id']} の再評価がない")
                continue
            if response and judgment.get("in_reply_to") != response["message_id"]:
                errors.append(f"批判 {critique['message_id']} の in_reply_to は応答 {response['message_id']} を指す必要がある")
            if judgment.get("judgment") in {"unresolved", "partially_resolved"}:
                repeated = SequenceMatcher(None, norm(critique["body"] or ""), norm(judgment.get("body", ""))).ratio() >= 0.8
                if repeated and not str(judgment.get("new_basis", "")).strip():
                    self.s.event("repeat_without_reading", task_id=task["task_id"], critique=critique["message_id"])
                    errors.append(f"批判 {critique['message_id']} を応答を踏まえずに繰り返している。応答のどこが足りないかと新しい根拠を書く")
        if errors:
            return "；".join(errors)
        with self.s.tx():
            for critique, response in pairs:
                judgment = judgments[critique["message_id"]]
                self._insert(issue, task, attempt, {
                    "kind": "reevaluate", "target_artifact": critique["target_artifact"], "target_claim": critique["target_claim"],
                    "body": judgment["body"], "reason": judgment["reason"], "in_reply_to": judgment.get("in_reply_to"),
                    "conditions": judgment.get("new_basis"), "keep_strength": judgment.get("keep_strength"),
                    "about_critique": critique["message_id"], "dispute_type": judgment.get("dispute_type") or critique["dispute_type"],
                    "severity": critique["severity"],
                }, to_role=critique["to_role"], disposition=judgment["judgment"])
                self.s.db.execute(
                    "UPDATE messages SET disposition=?, dispute_type=COALESCE(?,dispute_type) WHERE message_id=?",
                    (judgment["judgment"], judgment.get("dispute_type"), critique["message_id"]),
                )
                self.s.event("critique_judged", task_id=task["task_id"], critique=critique["message_id"], judgment=judgment["judgment"])
            proposers = {p["artifact"]: p["role"] for p in json.loads(issue["proposers"])}
            for extra in payload.get("new_critiques") or []:
                if extra.get("target_artifact") in proposers and not is_vague_message({**extra, "kind": "critique"}):
                    self._insert(issue, task, attempt, {**extra, "kind": "critique"}, to_role=proposers[extra["target_artifact"]])
        return None

    def _insert(self, issue, task, attempt, m, to_role, disposition="open", new_version=None):
        art = self.s.latest_artifact(m.get("target_artifact")) if m.get("target_artifact") else None
        kind = m.get("kind")
        if kind == "support" and disposition == "open":
            disposition = "noted"
        message_id = self.s.next_id("M")
        self.s.db.execute(
            "INSERT INTO messages(message_id,issue_id,round,from_role,from_instance,to_role,kind,target_artifact,target_version,target_claim,quote,body,reason,evidence,conditions,counterexample,requested_fix,keep_strength,flips_if,in_reply_to,about_critique,severity,dispute_type,disposition,new_version,delivery,attempt_id,session_id,simulated,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (message_id, issue["issue_id"], task["data"].get("round", issue["round"]), task["role"], attempt["instance_id"], to_role, kind,
             m.get("target_artifact"), art["version"] if art else None, m.get("target_claim"), m.get("quote"), m.get("body"), m.get("reason"),
             json.dumps(m.get("evidence") or [], ensure_ascii=False), m.get("conditions"), m.get("counterexample"), m.get("requested_fix"),
             m.get("keep_strength"), m.get("flips_if"), m.get("in_reply_to"), m.get("about_critique"), m.get("severity"), m.get("dispute_type"), disposition, new_version,
             "queued", attempt["attempt_id"], attempt.get("session_id"), 1 if attempt.get("simulated") else 0, self.s.clock()),
        )
        relation = {"critique": "refutes", "support": "supports", "respond": "responds", "reevaluate": "evaluates"}.get(kind, "references")
        target = m.get("target_claim") or m.get("target_artifact") or ""
        self.s.link("message", message_id, "claim", f"{m.get('target_artifact')}#{target}", relation)
        if m.get("in_reply_to"):
            self.s.link("message", message_id, "message", m["in_reply_to"], "replies")
        for ref in m.get("evidence") or []:
            self.s.link("message", message_id, "evidence", ref, "references")
        self.s.event("message_recorded", task_id=task["task_id"], attempt_id=attempt["attempt_id"], message=message_id, kind=kind, to=to_role)
        return message_id

    def mark_delivered(self, message_ids, attempt_id):
        for message_id in message_ids or []:
            self.s.db.execute("UPDATE messages SET delivery='delivered', delivered_attempt=? WHERE message_id=?", (attempt_id, message_id))

    # 進行 -------------------------------------------------------------
    def advance(self, coordinator):
        """子の作業がそろったら次の段階を登録する。条件が足りなければ何もしない。"""
        issue_id = coordinator["data"].get("issue_id")
        if not issue_id:
            return
        children = self.s.tasks(parent=coordinator["task_id"])
        if any(c["state"] not in {"done", "failed", "on_hold"} for c in children):
            return
        issue = self.issue(issue_id)
        if issue["state"] != "open":
            return
        round_no = issue["round"]
        node = self.e.node(coordinator["node_id"])
        phase = coordinator["data"].get("phase", "critique")
        failed_roles = [c["role"] for c in children if c["state"] == "failed"]
        if failed_roles:
            self.s.event("roles_not_performed", task_id=coordinator["task_id"], roles=sorted(set(failed_roles)))
        if phase == "critique":
            self._begin_response(coordinator, issue, node, round_no)
        elif phase == "response":
            unanswered = [c for c in children if c["kind"] == "respond" and c["state"] == "failed"]
            if unanswered:
                # 応答が得られないまま次の巡へ進まない。欠けた応答を生成せず、未回答として残す。
                self._close(coordinator, issue, "unanswered", f"提案者の応答が得られなかった：{[c['task_id'] for c in unanswered]}")
                return
            self._begin_reeval(coordinator, issue, node, round_no)
        elif phase == "reeval":
            self._close_or_next(coordinator, issue, node, round_no)
        elif phase == "research":
            self._begin_response(coordinator, issue, node, round_no)

    def _set_phase(self, coordinator, phase):
        self.s.update_task(coordinator["task_id"], data={**coordinator["data"], "phase": phase})

    def _begin_response(self, coordinator, issue, node, round_no):
        """批判がなくても提案者に支持の内容を確認させ、一度ずつの提出で終わらせない。"""
        created = 0
        for proposer in json.loads(issue["proposers"]):
            artifact = proposer["artifact"]
            pending = [m for m in self.messages_for_response(issue["issue_id"], artifact) if m["kind"] != "reevaluate"]
            if not pending:
                continue
            added = self.e.add_child(
                coordinator, suffix=f"r{round_no}.resp.{artifact}", kind="respond", role=proposer["role"],
                purpose=f"論点「{issue['title']}」の批判に応答し、必要なら案を修正する",
                inputs=[{"kind": "artifact", "id": artifact, "state": "latest"}, {"kind": "sources"}, {"kind": "evidence"}],
                data={"issue_id": issue["issue_id"], "round": round_no, "artifact": artifact, "instance_key": f"author:{artifact}"},
            )
            created += 1 if added else 0
        self._set_phase(coordinator, "response")
        if not created:
            self._close_or_next(self.s.task(coordinator["task_id"]), issue, node, round_no)

    def _begin_reeval(self, coordinator, issue, node, round_no):
        created = 0
        for critic in json.loads(issue["critics"]):
            if not self.pairs_for_reeval(issue["issue_id"], critic, round_no):
                continue
            inputs = [{"kind": "artifact", "id": a, "state": "latest"} for a in json.loads(issue["proposal_artifacts"])]
            added = self.e.add_child(
                coordinator, suffix=f"r{round_no}.reeval.{critic}", kind="reeval", role=critic,
                purpose="自分の批判が応答と修正で解消したかを判断する", inputs=inputs + [{"kind": "evidence"}],
                data={"issue_id": issue["issue_id"], "round": round_no, "instance_key": f"debate:{issue['issue_id']}:{critic}"},
            )
            created += 1 if added else 0
        self._set_phase(coordinator, "reeval")
        if not created:
            self._close_or_next(self.s.task(coordinator["task_id"]), issue, node, round_no)

    def pending_major(self, issue_id):
        return [m for m in self.messages(issue_id, kind="critique")
                if m["severity"] == "major" and m["disposition"] in PENDING]

    def _close_or_next(self, coordinator, issue, node, round_no):
        pending = self.pending_major(issue["issue_id"])
        all_messages = self.messages(issue["issue_id"])
        critiques = [m for m in all_messages if m["kind"] == "critique"]
        supports = [m for m in all_messages if m["kind"] == "support"]
        if not critiques and supports and not any(json.loads(m["evidence"] or "[]") for m in supports):
            # 全員が根拠なく同意した状態を、検討が済んだ状態として扱わない。
            self.s.event("consensus_without_evidence", task_id=coordinator["task_id"], issue=issue["issue_id"])
            self._close(coordinator, issue, "unresolved", "批判がなく、支持にも根拠の参照がない。合意を検証の結果として扱わない")
            return
        if not pending:
            note = "重大な批判はすべて解消または撤回された"
            if not critiques:
                note = "批判はなく、支持は根拠を示している。チーム内の支持であり需要の検証ではない"
            self._close(coordinator, issue, "resolved", note)
            return
        # 情報不足は追加の討論で解消しない。外部確認へ送り、討論の巡を消費しない。
        external = [m for m in pending if m["dispute_type"] in NON_DEBATABLE]
        for m in external:
            self.s.db.execute("UPDATE messages SET disposition='external' WHERE message_id=?", (m["message_id"],))
            self.s.event("critique_needs_external", task_id=coordinator["task_id"], critique=m["message_id"])
        pending = [m for m in pending if m["dispute_type"] not in NON_DEBATABLE]
        if not pending:
            self._close(coordinator, issue, "unresolved", "残る批判は情報不足であり、追加の討論では解消しない。外部確認へ送った")
            return
        if round_no >= issue["max_rounds"]:
            self._close(coordinator, issue, "unresolved", f"相互批評の上限 {issue['max_rounds']} 巡に達した。未解決のまま提出する")
            return
        if self.e.remaining_calls() < 3:
            self._close(coordinator, issue, "unresolved", "残りの呼び出し数が足りず、次の巡を実施しなかった")
            return
        next_round = round_no + 1
        self.s.db.execute("UPDATE issues SET round=? WHERE issue_id=?", (next_round, issue["issue_id"]))
        self.s.event("debate_round", task_id=coordinator["task_id"], issue=issue["issue_id"], round=next_round, pending=[m["message_id"] for m in pending])
        self._begin_response(self.s.task(coordinator["task_id"]), self.issue(issue["issue_id"]), node, next_round)

    def _close(self, coordinator, issue, outcome, note):
        self.s.db.execute("UPDATE issues SET state='closed', outcome=?, note=? WHERE issue_id=?", (outcome, note, issue["issue_id"]))
        # 次の巡がないため転送しなかった発言を、未送達と区別する。
        self.s.db.execute("UPDATE messages SET delivery='not_needed' WHERE issue_id=? AND delivery='queued'", (issue["issue_id"],))
        self.s.event("issue_closed", task_id=coordinator["task_id"], issue=issue["issue_id"], outcome=outcome, note=note)
        self.e.finish_coordinator(coordinator, outcome, note)

    def unanswered_major(self):
        """重大な批判のうち、提案者の応答が一度も届いていないものを返す。"""
        return [dict(r) for r in self.s.db.execute(
            "SELECT * FROM messages WHERE kind='critique' AND severity='major' AND disposition='open' ORDER BY rowid")]

    def carry_forward_items(self):
        """統合時に残すべき、未解決の異論と元の長所を返す。"""
        items = []
        for row in self.s.db.execute("SELECT * FROM messages WHERE kind='critique' AND severity='major' AND disposition IN ('open','answered','unresolved','partially_resolved','external') ORDER BY rowid"):
            items.append({"message_id": row["message_id"], "kind": "未解決の異論", "text": row["body"]})
        for row in self.s.db.execute("SELECT * FROM messages WHERE kind IN ('critique','support') AND keep_strength IS NOT NULL AND keep_strength<>'' ORDER BY rowid"):
            items.append({"message_id": row["message_id"], "kind": "残すべき長所", "text": row["keep_strength"]})
        return items
