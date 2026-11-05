"""更新の影響と資料横断の検査。"""
import json
import unittest

from helpers import RunCase, SOURCE_TEXT, SOURCE_TEXT_B
from adapters.mock import good_artifact
from validators import crossdoc
from validators.formal import Finding

QUOTE_A = "担当者が不在の日は、共有表の更新が止まる。"
QUOTE_B = "導入の審査では、情報システム担当が権限の設定を確認する。"


def citing(source, quote):
    def inner(req):
        payload = good_artifact(req.meta)
        payload["new_evidence"] = [{"id": "N1", "source_id": source, "kind": "document_fact", "quote": quote}]
        payload["claims"] = [{"id": "C1", "text": quote, "type": "fact", "status": "confirmed", "evidence": ["N1"]}]
        return payload
    return inner


class SourceUpdate(RunCase):
    def run_with_two_topics(self):
        engine, adapter = self.start(script={"customer": [citing("S1", QUOTE_A)], "product": [citing("S2", QUOTE_B)]})
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        return engine, adapter

    def test_only_citing_artifacts_are_rechecked(self):
        engine, _ = self.run_with_two_topics()
        store = engine.store
        calls_before = store.calls_used()
        result = engine.update_source("S1", "架空の試験資料である（改訂）。\n担当者の不在時は上長が確認する。\n")
        self.assertEqual(sorted(result["impacted"]), ["customer_analysis"])
        self.assertEqual(store.latest_artifact("customer_analysis")["status"], "invalidated")
        self.assertEqual(store.latest_artifact("product_facts")["status"], "accepted", "別の資料を引用する成果物は影響を受けない")
        self.assertEqual(store.task("product")["state"], "done")
        self.assertEqual(store.task("customer")["state"], "awaiting_review")
        status = engine.run()
        self.assertEqual(status, "hypothesis_contract_met")
        self.assertLessEqual(store.calls_used() - calls_before, 3, "再確認と横断検査だけで、全作業をやり直さない")
        self.assertEqual(store.task("product")["calls_used"], 1)

    def test_update_keeping_quote_invalidates_nothing(self):
        engine, _ = self.run_with_two_topics()
        result = engine.update_source("S1", SOURCE_TEXT + "\n追加の行である。\n")
        self.assertEqual(result["stale_evidence"], [])
        self.assertEqual(result["impacted"], {})
        self.assertEqual(engine.store.latest_artifact("customer_analysis")["status"], "accepted")

    def test_finished_status_is_not_reused_after_update(self):
        engine, _ = self.run_with_two_topics()
        engine.update_source("S1", "架空の改訂である。\n")
        self.assertEqual(engine.store.run_status(), "paused")
        self.assertFalse(engine.store.db.execute("SELECT 1 FROM bundles WHERE state='accepted'").fetchone(), "一式の合格を流用しない")

    def test_input_change_resets_revision_count_but_not_call_ceiling(self):
        from adapters.mock import bad_review

        def fail(req):
            return bad_review(req.meta, "内容が足りない", "production_gap")

        engine, _ = self.start(script={"customer": [citing("S1", QUOTE_A)], "customer.fix1": [citing("S1", QUOTE_A)], "customer.rev1": [fail], "product": [citing("S2", QUOTE_B)]})
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        store = engine.store
        self.assertEqual(store.task("customer")["revisions_used"], 1)
        engine.update_source("S1", "架空の改訂である。\n")
        self.assertEqual(store.task("customer")["revisions_used"], 0, "入力が変わると修正回数を持ち越さない")
        before = store.budget()["max_calls"]
        self.assertEqual(before, store.budget()["ceiling_from_ledger"], "全体の上限は変わらない")

    def test_revise_ids_stay_unique_after_reset(self):
        from adapters.mock import bad_review

        def fail(req):
            return bad_review(req.meta, "内容が足りない", "production_gap")

        def plain(req):
            return citing("S1", QUOTE_A)(req)

        engine, _ = self.start(script={"customer": [citing("S1", QUOTE_A)], "customer.fix1": [plain], "customer.rev1": [fail]})
        engine.run()
        engine.update_source("S1", "架空の改訂である。\n")
        engine.store.db.execute("SELECT 1")
        engine.adapter.script["customer.rev3"] = [fail]
        engine.run()
        store = engine.store
        self.assertTrue(store.task("customer.fix1"))
        self.assertTrue(store.task("customer.fix2"), "修正の作業は別のIDで登録される")

    def test_stale_evidence_is_hidden_and_recitation_is_not_research(self):
        from harness import prompts
        engine, _ = self.run_with_two_topics()
        stale = engine.update_source("S1", "架空の改訂である。\n")["stale_evidence"]
        text = prompts.render_evidence(engine.store)
        self.assertNotIn(f"- {stale[0]} ", text, "無効な根拠を引用できる一覧に出さない")
        self.assertIn("引用できない", text)
        self.assertEqual(engine.store.source("S1")["retrieved_at"], self.today.isoformat(), "更新した資料には確認日が付く")

    def test_stale_evidence_cannot_be_cited_afterwards(self):
        engine, _ = self.run_with_two_topics()
        stale_before = engine.update_source("S1", "架空の改訂である。\n")["stale_evidence"]
        self.assertTrue(stale_before)
        row = engine.store.evidence_row(stale_before[0])
        self.assertEqual(row["state"], "stale")


class VersionBinding(RunCase):
    def test_pass_for_old_version_is_not_reused(self):
        engine, _ = self.start()
        engine.run()
        store = engine.store
        art = store.latest_artifact("intro_page")
        self.assertEqual(art["status"], "accepted")
        version = engine.replace_artifact("intro_page", "## 差し替え\n差し替えた本文である。", note="別の文面に差し替えた")
        self.assertEqual(version, art["version"] + 1)
        self.assertEqual(store.latest_artifact("intro_page")["status"], "draft")
        ok, why = store.can_complete(store.task("intro_page"))
        self.assertFalse(ok, why)

    def test_replacing_after_bundle_pass_requires_new_crosscheck(self):
        engine, _ = self.start()
        engine.run()
        store = engine.store
        first_bundle = store.db.execute("SELECT * FROM bundles WHERE state='accepted'").fetchone()
        self.assertIsNotNone(first_bundle)
        engine.replace_artifact("intro_page", "## 差し替え\n差し替えた本文である。")
        self.assertEqual(store.db.execute("SELECT state FROM bundles WHERE bundle_id=?", (first_bundle["bundle_id"],)).fetchone()["state"], "invalidated")
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        latest = store.db.execute("SELECT * FROM bundles WHERE state='accepted' ORDER BY rowid DESC").fetchone()
        versions = {m["artifact_id"]: m["version"] for m in json.loads(latest["manifest"])}
        self.assertEqual(versions["intro_page"], store.latest_artifact("intro_page")["version"])
        self.assertNotEqual(latest["bundle_id"], first_bundle["bundle_id"])

    def test_upstream_change_invalidates_only_referencing_downstream(self):
        def page(req):
            payload = good_artifact(req.meta)
            payload["claims"] = [{"id": "P1", "text": "仮説の転記である", "type": "inference", "status": "hypothesis",
                                  "derived_from": [{"ref": "adopted_strategy#C1", "relation": "media_translation"}]}]
            return payload

        def plan(req):
            payload = good_artifact(req.meta)
            payload["claims"] = [{"id": "Q1", "text": "別の仮説である", "type": "inference", "status": "hypothesis",
                                  "derived_from": [{"ref": "adopted_strategy#C2", "relation": "reference"}]}]
            return payload

        def strategy(version_text):
            def inner(req):
                payload = good_artifact(req.meta)
                payload["claims"] = [
                    {"id": "C1", "text": version_text, "type": "inference", "status": "hypothesis"},
                    {"id": "C2", "text": "変わらない主張である", "type": "inference", "status": "hypothesis"},
                ]
                return payload
            return inner

        engine, _ = self.start(script={
            "select": [strategy("元の主張である")], "select.fix1": [strategy("修正した主張である")],
            "intro_page": [page], "validation_plan": [plan],
        })
        engine.run()
        store = engine.store
        reason_before = store.task("validation_plan")["calls_used"]
        reopened = engine.reopen_artifact("adopted_strategy", "戦略の対象を修正する", [
            {"severity": "major", "category": "cross_doc", "location": "C1", "reason": "対象が食い違う", "fix_condition": "修正する", "criterion": "t"}])
        self.assertEqual(reopened, "select")
        engine.store.set_meta("status", "paused")
        engine.run()
        self.assertTrue(store.db.execute("SELECT 1 FROM tasks WHERE task_id='intro_page.rev2'").fetchone(), "変更された主張を参照する下流は再確認される")
        self.assertFalse(store.db.execute("SELECT 1 FROM tasks WHERE task_id='validation_plan.rev2'").fetchone(), "変更されていない主張だけを参照する下流は再確認しない")
        self.assertEqual(store.task("validation_plan")["calls_used"], reason_before)


def claim(local_id, text, status="confirmed", evidence=None, target="", conditions=None, derived=None, metric=None, audience="", type_="fact"):
    return {"local_id": local_id, "text": text, "status": status, "evidence": evidence or [], "target_customer": target,
            "conditions": conditions or [], "derived_from": derived or [], "metric": metric, "audience": audience, "type": type_}


class CrossDocMachine(unittest.TestCase):
    def test_hypothesis_promoted_to_fact(self):
        claims = {
            "strategy#C1": claim("C1", "需要がある可能性がある", status="hypothesis"),
            "sales#C1": claim("C1", "多数の顧客が求めている", derived=[{"ref": "strategy#C1", "relation": "summary"}]),
        }
        found = crossdoc.hypothesis_promoted(claims)
        self.assertEqual([f.location for f in found], ["sales#C1"])
        self.assertEqual(found[0].fix_target, "sales")

    def test_new_evidence_allows_confirmation(self):
        claims = {
            "strategy#C1": claim("C1", "需要がある可能性がある", status="hypothesis"),
            "sales#C1": claim("C1", "3社が導入した", evidence=["E9"], derived=[{"ref": "strategy#C1", "relation": "reference"}]),
        }
        self.assertEqual(crossdoc.hypothesis_promoted(claims), [])

    def test_dropped_condition(self):
        claims = {
            "product#C1": claim("C1", "担当未定の依頼を確認できる", conditions=["管理者が担当者を登録している"], evidence=["E1"]),
            "page#C1": claim("C1", "設定不要で確認できる", evidence=["E1"], derived=[{"ref": "product#C1", "relation": "media_translation"}]),
        }
        found = crossdoc.conditions_dropped(claims)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].severity, "flag", "条件の言い換えは文字列では判断できないので確認依頼にする")
        self.assertIn("管理者が担当者を登録している", found[0].reason)

    def test_paraphrased_condition_is_left_to_content_review(self):
        claims = {
            "product#C1": claim("C1", "担当未定の依頼を確認できる", conditions=["管理者が担当者を登録している"], evidence=["E1"]),
            "page#C1": claim("C1", "確認できる", conditions=["最初に管理者が担当者を登録する必要がある"], evidence=["E1"], derived=[{"ref": "product#C1", "relation": "media_translation"}]),
        }
        self.assertEqual(crossdoc.conditions_dropped(claims), [])

    def test_same_number_with_different_population(self):
        base = {"name": "短縮率", "value": "30", "unit": "%", "period": "2週間", "population": "試験参加の3部署", "method": "作業記録"}
        other = {**base, "population": "全顧客", "period": "1年"}
        claims = {"facts#C1": claim("C1", "短縮率30%", evidence=["E1"], metric=base), "page#C1": claim("C1", "短縮率30%", evidence=["E1"], metric=other)}
        found = crossdoc.metric_definitions(claims)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].severity, "flag")
        same = {**base, "unit": "分／日"}
        base["unit"] = "分/日"
        self.assertEqual(crossdoc.metric_definitions({"a#C1": claim("C1", "x", evidence=["E1"], metric=base), "b#C1": claim("C1", "x", evidence=["E1"], metric=same)}), [], "表記の違いだけでは指摘しない")
        self.assertIn("母数", found[0].reason.replace("population", "母数"))

    def test_circular_reference_between_downstream_documents(self):
        claims = {
            "page#C1": claim("C1", "多数が評価している", derived=[{"ref": "sales#C1", "relation": "reference"}]),
            "sales#C1": claim("C1", "多数が評価している", derived=[{"ref": "page#C1", "relation": "reference"}]),
        }
        found = crossdoc.circular_support(claims)
        self.assertEqual(sorted(f.location for f in found), ["page#C1", "sales#C1"])

    def test_chain_reaching_source_is_not_circular(self):
        claims = {
            "facts#C1": claim("C1", "記録できる", evidence=["E1"]),
            "page#C1": claim("C1", "記録できる", derived=[{"ref": "facts#C1", "relation": "media_translation"}]),
        }
        self.assertEqual(crossdoc.circular_support(claims), [])


class CrossDocTargets(RunCase):
    def strategy(self, audiences=None):
        def inner(req):
            payload = good_artifact(req.meta)
            payload["structured"]["target"] = "受付を複数人で分担する小規模窓口の責任者"
            payload["structured"]["audiences"] = audiences or []
            payload["claims"] = [{"id": "C1", "text": "対象の仮説", "type": "inference", "status": "hypothesis", "target_customer": "受付を複数人で分担する小規模窓口の責任者"}]
            return payload
        return inner

    def page(self, target, audience=""):
        def inner(req):
            payload = good_artifact(req.meta)
            payload["claims"] = [{"id": "P1", "text": "訴求の仮説", "type": "inference", "status": "hypothesis", "target_customer": target, "audience": audience}]
            return payload
        return inner

    def test_different_target_between_strategy_and_document_is_defect(self):
        engine, _ = self.start(script={"select": [self.strategy()], "intro_page": [self.page("全社の統制を担う経営企画部門")]})
        engine.run(max_results=None)
        event = engine.store.events("bundle_prepared")[0]
        self.assertGreaterEqual(event["data"]["machine_flags"], 1, "対象の違いは内容検査への確認依頼になる")
        self.assertTrue(engine.store.events("bundle_rejected"), "確認依頼が確定されると、個別に合格していても一式は拒否される")
        self.assertTrue(engine.store.task("intro_page.fix1") or engine.store.task("intro_page.fix2"), "該当する資料が差し戻される")

    def test_flag_dismissed_with_reason_is_not_a_defect(self):
        def dismiss(req):
            return {"verdict": "consistent", "vertical": [], "horizontal": [{"pair": "strategy/page", "result": "condition_difference", "note": "読み手が違うだけ"}], "defects": [],
                    "flag_rulings": [{"flag_id": f, "ruling": "dismissed", "reason": "同じ窓口を責任者の側から書いた言い換えである"} for f in req.meta.get("flags", [])]}

        engine, _ = self.start(script={"select": [self.strategy()], "intro_page": [self.page("受付窓口の責任者")], "final_check": [dismiss]})
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        self.assertGreaterEqual(engine.store.events("bundle_prepared")[0]["data"]["machine_flags"], 1)
        rulings = engine.store.events("machine_flag_ruled")
        self.assertTrue(rulings and all(e["data"]["ruling"] == "dismissed" for e in rulings), "退けた理由が記録される")
        self.assertFalse(engine.store.events("bundle_rejected"))

    def test_flag_without_ruling_is_not_accepted(self):
        def silent(req):
            return {"verdict": "consistent", "vertical": [], "horizontal": [], "defects": []}

        engine, _ = self.start(script={"select": [self.strategy()], "intro_page": [self.page("全社の統制を担う経営企画部門")], "final_check": [silent, silent]})
        engine.run()
        self.assertTrue(engine.store.events("output_invalid", task_id="final_check"), "確認依頼に答えない検査は受理しない")

    def test_documented_audience_difference_is_not_contradiction(self):
        engine, _ = self.start(script={
            "select": [self.strategy(audiences=["導入を審査する情報システム担当"])],
            "intro_page": [self.page("導入を審査する情報システム担当", audience="導入を審査する情報システム担当")],
        })
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        event = engine.store.events("bundle_prepared")[0]
        self.assertEqual(event["data"]["machine_findings"], 0, "異なる対象向けの説明を矛盾と判定しない")

    def test_content_review_finds_inconsistency_and_rechecks_related_documents(self):
        def inconsistent(req):
            return {"verdict": "inconsistent", "vertical": [], "horizontal": [{"pair": "intro_page/validation_plan", "result": "problem", "note": "対象が違う"}],
                    "defects": [{"severity": "major", "location": "intro_page §1", "reason": "戦略は小規模部門向けだが全社統制を訴求している", "fix_condition": "対象を戦略に合わせる", "fix_target": "intro_page", "check_type": "strategy_to_media"}]}

        engine, _ = self.start(script={"final_check": [inconsistent]})
        self.assertEqual(engine.run(), "hypothesis_contract_met")
        store = engine.store
        self.assertEqual(store.latest_of_node("final_check")["iter"], 2)
        self.assertEqual(store.task("final_check")["outcome"], "inconsistent")
        self.assertEqual(store.latest_of_node("final_check")["outcome"], "accepted")
        self.assertEqual(store.latest_artifact("intro_page")["version"], 2)
        bundle = store.db.execute("SELECT manifest FROM bundles WHERE state='accepted'").fetchone()
        versions = {m["artifact_id"]: m["version"] for m in json.loads(bundle["manifest"])}
        self.assertEqual(versions["intro_page"], 2, "修正後の版の組み合わせで再検査する")

    def test_crosscheck_limit_is_not_completion(self):
        def inconsistent(req):
            return {"verdict": "inconsistent", "vertical": [], "horizontal": [],
                    "defects": [{"severity": "major", "location": "x", "reason": "矛盾が残る", "fix_condition": "直す", "fix_target": "intro_page"}]}

        engine, _ = self.start(script={"final_check*": [inconsistent] * 8})
        status = engine.run()
        self.assertEqual(status, "budget_unmet")
        self.assertFalse(engine.store.db.execute("SELECT 1 FROM bundles WHERE state='accepted'").fetchone())


if __name__ == "__main__":
    unittest.main()
