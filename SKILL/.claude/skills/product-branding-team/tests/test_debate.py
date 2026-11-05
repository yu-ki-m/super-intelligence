"""実討論の制御。批判→応答→再評価の成立と、形だけの討論の拒否を確かめる。"""
import unittest

from helpers import RunCase
from adapters.base import AgentResult
from adapters.mock import good_artifact

ISSUE = "I-debate_strategy"


def critique(target, body="現状維持から変える理由が弱い。誰のどの判断が変わるかが書かれていない。", severity="major", dispute="inference", keep=None):
    return {"kind": "critique", "to_role": "B08", "target_artifact": target, "target_claim": "C1", "quote": "仮説である",
            "body": body, "reason": "変更負担を上回る理由がない", "severity": severity, "dispute_type": dispute, "keep_strength": keep}


def support(target, evidence=None):
    return {"kind": "support", "to_role": "B08", "target_artifact": target, "target_claim": "C1", "quote": "仮説である",
            "body": "担当者不在という場面を特定した点は良い。", "reason": "履歴保存が誰の判断に役立つか説明できている", "evidence": evidence or []}


class DebateFlow(RunCase):
    def test_critique_response_reevaluation_are_linked(self):
        engine, _ = self.start()
        engine.run()
        d = engine.debate
        critiques = d.messages(ISSUE, kind="critique")
        self.assertTrue(critiques)
        for c in critiques:
            response = d.s.db.execute("SELECT * FROM messages WHERE kind='respond' AND in_reply_to=?", (c["message_id"],)).fetchone()
            self.assertIsNotNone(response, "批判に応答がある")
            reeval = d.s.db.execute("SELECT * FROM messages WHERE kind='reevaluate' AND about_critique=?", (c["message_id"],)).fetchone()
            self.assertEqual(reeval["in_reply_to"], response["message_id"], "再評価が応答を参照している")
            self.assertEqual(reeval["from_role"], c["from_role"], "再評価は批判者本人が行う")
            self.assertEqual(reeval["from_instance"], c["from_instance"], "同じインスタンスが続けて応答している")

    def test_delivered_messages_carry_full_text(self):
        seen = {}

        def respond(req):
            seen["prompt"] = req.prompt
            return {"responses": [{"in_reply_to": m, "action": "counter", "body": "資料に根拠がある", "reason": "S1 に記載がある"} for m in req.meta["open_critiques"]]}

        engine, _ = self.start(script={"debate_strategy.r1.resp.candidate_a": [respond]})
        engine.run()
        self.assertIn("現状維持", seen["prompt"], "他のエージェントの発言の全文が宛先へ届いている")
        delivered = engine.debate.messages(ISSUE, kind="critique", target_artifact="candidate_a")
        self.assertTrue(all(m["delivery"] == "delivered" for m in delivered))

    def test_independent_candidates_do_not_see_each_other(self):
        prompts = {}

        def capture(key):
            def inner(req):
                prompts[key] = req.prompt
                return good_artifact(req.meta)
            return inner

        engine, _ = self.start(script={"cand_a": [capture("a")], "cand_b": [capture("b")]})
        engine.run()
        self.assertNotIn("candidate_b", prompts["a"])
        self.assertNotIn("candidate_a", prompts["b"])
        # 作業フォルダーも分かれ、相手の案のファイルを読めない。
        a_view = engine.store.db.execute("SELECT instance_id FROM attempts WHERE task_id='cand_a'").fetchone()["instance_id"]
        b_view = engine.store.db.execute("SELECT instance_id FROM attempts WHERE task_id='cand_b'").fetchone()["instance_id"]
        self.assertNotEqual(a_view, b_view)

    def test_paraphrased_candidate_is_rejected(self):
        def same(req):
            payload = good_artifact(req.meta)
            payload["structured"]["target"] = "架空：受付を複数人で分担する小規模窓口の責任者"
            payload["structured"]["value"] = "架空：担当者が不在でも経緯を確認できる"
            return payload

        engine, _ = self.start(script={"cand_a": [same], "cand_b": [same]})
        engine.run()
        rows = engine.store.db.execute("SELECT * FROM defects WHERE criterion='candidates_differ'").fetchall()
        self.assertTrue(rows, "言い換えだけの候補は欠陥として記録される")

    def test_vague_praise_or_insult_is_not_accepted(self):
        def vague(req):
            return {"messages": [{"kind": "critique", "to_role": "B08", "target_artifact": req.meta["proposals"][0], "body": "駄目だ", "reason": "駄目だ"}]}

        engine, _ = self.start(script={"debate_strategy.r1.crit.V03": [vague]})
        engine.run()
        events = engine.store.events("output_invalid", task_id="debate_strategy.r1.crit.V03")
        self.assertTrue(events)
        self.assertEqual(engine.store.task("debate_strategy.r1.crit.V03")["retries_used"], 1)

    def test_consensus_without_evidence_is_not_resolution(self):
        def agree(req):
            return {"messages": [support(p) for p in req.meta["proposals"]]}

        engine, _ = self.start(script={"debate_strategy.r1.crit.*": [agree, agree]})
        engine.run()
        self.assertIn("consensus_without_evidence", self.event_types(engine))
        self.assertEqual(engine.store.latest_of_node("debate_strategy")["outcome"], "unresolved")

    def test_substantive_support_does_not_need_invented_criticism(self):
        def agree(req):
            return {"messages": [support(p, evidence=["E1"]) for p in req.meta["proposals"]]}

        engine, _ = self.start(script={"debate_strategy.r1.crit.*": [agree, agree]})
        engine.run()
        issue = engine.debate.issue(ISSUE)
        self.assertEqual(issue["outcome"], "resolved")
        self.assertIn("需要の検証ではない", issue["note"])

    def test_critic_must_answer_all_and_read_the_response(self):
        def repeat(req):
            judgments = []
            for pair in req.meta["pairs"]:
                body = "現状維持から変える理由が弱い。誰のどの判断が変わるかが書かれていない。"
                judgments.append({"about_critique": pair["critique"], "in_reply_to": pair["response"], "judgment": "unresolved", "body": body, "reason": "同じ"})
            return {"judgments": judgments}

        engine, _ = self.start(script={"debate_strategy.r1.reeval.V03": [repeat, repeat]})
        engine.run()
        self.assertIn("repeat_without_reading", self.event_types(engine))

    def test_critic_can_withdraw_when_rebuttal_is_correct(self):
        def withdraw(req):
            return {"judgments": [{"about_critique": p["critique"], "in_reply_to": p["response"], "judgment": "withdrawn",
                                   "body": "資料 S1 に根拠があり、私の指摘が誤っていた。", "reason": "反論のとおりである"} for p in req.meta["pairs"]]}

        def counter(req):
            return {"responses": [{"in_reply_to": m, "action": "counter", "body": "資料に根拠がある", "reason": "S1 に記載がある"} for m in req.meta["open_critiques"]]}

        engine, _ = self.start(script={"debate_strategy.r1.reeval.*": [withdraw, withdraw], "debate_strategy.r1.resp.*": [counter, counter]})
        engine.run()
        rows = engine.debate.messages(ISSUE, kind="critique")
        self.assertTrue(all(m["disposition"] == "withdrawn" for m in rows))
        self.assertEqual(engine.debate.issue(ISSUE)["outcome"], "resolved")

    def test_unresolved_after_max_rounds_is_reported_not_resolved(self):
        def stay(req):
            return {"judgments": [{"about_critique": p["critique"], "in_reply_to": p["response"], "judgment": "unresolved",
                                   "body": "応答は機能の説明だけで、変更する理由が示されていない。", "reason": "共有表との違いが示されていない", "new_basis": "応答の第2段落は共有表でも実現できる"} for p in req.meta["pairs"]]}

        engine, _ = self.start(script={"debate_strategy.r*.reeval.*": [stay] * 12})
        engine.run()
        issue = engine.debate.issue(ISSUE)
        self.assertEqual(issue["outcome"], "unresolved")
        self.assertEqual(issue["round"], 3)
        self.assertIn("上限", issue["note"])

    def test_missing_information_is_not_debated_further(self):
        def info(req):
            return {"messages": [critique(p, dispute="info_missing") for p in req.meta["proposals"]]}

        def stay(req):
            return {"judgments": [{"about_critique": p["critique"], "in_reply_to": p["response"], "judgment": "unresolved",
                                   "body": "顧客の実際の判断基準が資料にない。", "reason": "追加の討論では分からない", "new_basis": "資料 S1 に購入理由の記載がない", "dispute_type": "info_missing"} for p in req.meta["pairs"]]}

        engine, _ = self.start(script={"debate_strategy.r1.crit.*": [info, info], "debate_strategy.r1.reeval.*": [stay, stay]})
        engine.run()
        issue = engine.debate.issue(ISSUE)
        self.assertEqual(issue["round"], 1, "情報不足で巡を重ねない")
        self.assertIn("外部確認", issue["note"])
        self.assertTrue(all(m["disposition"] == "external" for m in engine.debate.messages(ISSUE, kind="critique")))

    def test_unanswered_major_critique_prevents_completion(self):
        def fail(req):
            return AgentResult(False, error_class="crash", error_detail="停止した")

        engine, _ = self.start(script={"debate_strategy.r1.resp.candidate_a": [fail, fail]})
        status = engine.run()
        self.assertEqual(status, "execution_failed")
        self.assertIn("応答がない", engine.store.get_meta("status_reason"))
        self.assertEqual(engine.debate.issue(ISSUE)["outcome"], "unanswered")
        self.assertIn("role_not_performed", self.event_types(engine))

    def test_failed_critic_is_reported_and_not_fabricated(self):
        def fail(req):
            return AgentResult(False, error_class="crash", error_detail="停止した")

        engine, _ = self.start(script={"debate_strategy.r1.crit.P04": [fail, fail]})
        engine.run()
        self.assertEqual(engine.store.task("debate_strategy.r1.crit.P04")["state"], "failed")
        self.assertFalse(engine.debate.messages(ISSUE, from_role="P04"), "欠けた発言を生成していない")
        self.assertIn("roles_not_performed", self.event_types(engine))

    def test_minority_opinion_cannot_vanish_at_integration(self):
        def keep(req):
            return {"messages": [critique(p, keep="担当者不在という場面の具体性は残す") for p in req.meta["proposals"]]}

        def drop(req):
            payload = good_artifact(req.meta)
            payload["structured"]["carried_forward"] = []
            return payload

        engine, _ = self.start(script={"debate_strategy.r1.crit.V03": [keep], "select": [drop]})
        engine.run()
        row = engine.store.db.execute("SELECT * FROM defects WHERE criterion='carried_forward_complete'").fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(engine.store.artifact("adopted_strategy", 1)["status"], "rejected")
        # 修正版は引き継ぎ一覧を満たして合格する。
        self.assertEqual(engine.store.latest_artifact("adopted_strategy")["status"], "accepted")

    def test_lost_session_continues_as_new_instance_and_is_recorded(self):
        calls = []

        def lose(req):
            calls.append(req.session_id)
            return AgentResult(False, error_class="session_lost", error_detail="No conversation found")

        engine, _ = self.start(script={"debate_strategy.r1.reeval.V03": [lose]})
        engine.run()
        store = engine.store
        self.assertIn("instance_continued", self.event_types(engine))
        row = store.db.execute("SELECT * FROM instances WHERE continuation_of IS NOT NULL").fetchone()
        self.assertEqual(row["role"], "V03")
        prompt = (store.run_dir / "prompts" / "debate_strategy.r1.reeval.V03@2.md").read_text(encoding="utf-8")
        self.assertIn("引き継ぎ", prompt)
        self.assertEqual(store.task("debate_strategy.r1.reeval.V03")["state"], "done")

    def test_duplicate_citation_counts_once(self):
        quote = "担当者が不在の日は、共有表の更新が止まる。"

        def cite(req):
            payload = good_artifact(req.meta)
            payload["new_evidence"] = [{"id": "N1", "source_id": "S1", "kind": "document_fact", "quote": quote}]
            payload["claims"] = [{"id": "C1", "text": "更新が止まる", "type": "fact", "status": "confirmed", "evidence": ["N1"]}]
            return payload

        engine, _ = self.start(script={"customer": [cite], "alternatives": [cite], "product": [cite]})
        engine.run()
        store = engine.store
        rows = store.db.execute("SELECT * FROM evidence WHERE quote=?", (quote,)).fetchall()
        self.assertEqual(len(rows), 1, "同じ資料の同じ引用は一つの根拠として登録する")
        self.assertIn("evidence_reused", self.event_types(engine))


if __name__ == "__main__":
    unittest.main()
