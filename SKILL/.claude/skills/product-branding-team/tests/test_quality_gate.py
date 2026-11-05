"""成果物の品質契約と形式検査。低品質の成果物を、どの欠陥として拒否するかを確かめる。"""
import unittest

from helpers import RunCase, brief
from adapters.mock import good_artifact, bad_review, good_review
from harness import gate, planner
from validators import formal
from validators.formal import CheckContext


CONTRACTS = planner.load_contracts()
TODAY = RunCase.today


def findings(payload, contract_id, store=None, brief_data=None):
    ctx = CheckContext(payload, CONTRACTS[contract_id], brief_data or brief(), store, "hikitsugi", TODAY)
    return formal.run_checks(ctx)


def checks(payload, contract_id, store=None, brief_data=None):
    return {f.check for f in findings(payload, contract_id, store, brief_data) if f.severity == "major"}


class FormalChecks(RunCase):
    def good(self, contract_id):
        return good_artifact({"contract": CONTRACTS[contract_id], "task_id": "x"})

    def test_universal_target_rejected(self):
        payload = self.good("brand_strategy")
        payload["structured"]["target"] = "すべての企業"
        self.assertIn("target_not_universal", checks(payload, "brand_strategy"))
        payload["structured"]["target"] = "誰でも使える"
        self.assertIn("target_not_universal", checks(payload, "brand_strategy"))

    def test_specific_target_passes(self):
        self.assertNotIn("target_not_universal", checks(self.good("brand_strategy"), "brand_strategy"))

    def test_fact_sheet_may_mention_planned_features(self):
        payload = self.good("product_fact_sheet")
        payload["document"] = "## 機能の区分\n\n| 機能 | 区分 |\n| 自動割り当て | planned |"
        payload["structured"]["capabilities"] = [{"name": "自動割り当て", "status": "planned"}]
        self.assertNotIn("planned_capability_status", checks(payload, "product_fact_sheet"))
        payload["structured"]["capabilities"] = [{"name": "自動割り当て", "status": "current"}]
        self.assertIn("planned_capability_status", checks(payload, "product_fact_sheet"))

    def test_absolute_named_as_phrase_to_avoid_in_internal_document(self):
        payload = self.good("brand_strategy")
        payload["document"] += "\n\n対外説明で「対応漏れゼロ」を使うと期待との不一致を招く。"
        self.assertNotIn("no_unbacked_absolutes", checks(payload, "brand_strategy"))

    def test_comparison_without_status_quo_rejected(self):
        payload = self.good("competitive_comparison")
        payload["structured"]["alternatives"] = [{"name": "同業製品A", "type": "competitor"}]
        self.assertIn("alternatives_include_status_quo", checks(payload, "competitive_comparison"))

    def test_headings_only_page_rejected(self):
        payload = self.good("landing_page")
        payload["document"] = "# 紹介ページ\n\n## 課題\n\n## 解決策\n\n## 導入事例\n"
        result = checks(payload, "landing_page")
        self.assertIn("headings_have_body", result)

    def test_short_page_with_body_is_not_rejected_for_length(self):
        payload = self.good("landing_page")
        payload["document"] = "## 誰のためか\n担当者が不在の日に経緯を確認したい窓口の責任者向けである。"
        self.assertEqual(checks(payload, "landing_page"), set())

    def test_planned_feature_as_current_rejected(self):
        payload = self.good("landing_page")
        payload["document"] = "## 価値\nこの製品は依頼を自動割り当てするので担当者を探す必要がない。"
        self.assertIn("planned_not_current", checks(payload, "landing_page"))

    def test_planned_feature_marked_as_future_passes(self):
        payload = self.good("landing_page")
        payload["document"] = "## 今後\n自動割り当ては開発中であり、現在は提供していない。"
        self.assertNotIn("planned_not_current", checks(payload, "landing_page"))

    def test_section_about_what_is_not_promised_is_not_a_promise(self):
        # 実エージェントの実行で、約束しないことの節を提供中の記述と誤検出した例があった。
        payload = self.good("landing_page")
        payload["document"] = "## 約束しないこと\n\n- 自動割り当て\n- 対応漏れゼロ\n\n## 価値\n\n記録された経緯を確認できる。"
        result = checks(payload, "landing_page")
        self.assertNotIn("planned_not_current", result)
        self.assertNotIn("no_unbacked_absolutes", result)
        # 別の節に書けば、約束として検出する。
        payload["document"] += "\n\nこの製品は自動割り当てで担当者を決める。"
        self.assertIn("planned_not_current", checks(payload, "landing_page"))

    def test_unbacked_absolutes_rejected(self):
        for phrase in ("業界で唯一の製品である", "導入すれば必ず改善する", "対応漏れゼロを実現する"):
            payload = self.good("landing_page")
            payload["document"] = f"## 価値\n{phrase}。"
            self.assertIn("no_unbacked_absolutes", checks(payload, "landing_page"), phrase)

    def test_description_of_alternative_is_not_an_absolute_promise(self):
        # 実エージェントの実行で、共有表の説明を製品の断定と誤検出した例があった。
        payload = self.good("brand_strategy")
        payload["document"] += "\n\n共有表は追加費用がかからず、誰でもすぐ編集できる。"
        self.assertNotIn("no_unbacked_absolutes", checks(payload, "brand_strategy"))

    def test_negated_absolute_is_not_a_promise(self):
        payload = self.good("landing_page")
        payload["document"] = "## 約束しないこと\n対応漏れゼロとは言わない。確認の運用が必要である。"
        self.assertNotIn("no_unbacked_absolutes", checks(payload, "landing_page"))

    def test_demand_from_ai_only_rejected(self):
        payload = self.good("brand_strategy")
        payload["claims"] = [{"id": "C9", "text": "需要がある", "type": "demand", "status": "confirmed", "evidence": ["N1"]}]
        payload["new_evidence"] = [{"id": "N1", "kind": "ai_inference", "quote": "全員が賛成した"}]
        self.assertIn("demand_needs_real_customer", checks(payload, "brand_strategy"))

    def test_confirmed_without_evidence_rejected(self):
        payload = self.good("customer_analysis")
        payload["claims"] = [{"id": "C1", "text": "顧客は困っている", "type": "fact", "status": "confirmed"}]
        self.assertIn("claims_have_status", checks(payload, "customer_analysis"))

    def test_conditional_hypothesis_is_allowed(self):
        payload = self.good("brand_strategy")
        payload["claims"] = [{"id": "C1", "text": "記録と確認の運用があれば経緯を確認できる可能性がある", "type": "inference", "status": "hypothesis", "conditions": ["担当者が履歴を入力する"]}]
        self.assertEqual(checks(payload, "brand_strategy"), set())

    def test_case_study_without_results_goes_on_hold(self):
        payload = {"document": "## 導入の結果\n導入で改善したと考えられる。", "claims": [{"id": "C1", "text": "改善した", "type": "fact", "status": "hypothesis"}]}
        result = findings(payload, "case_study")
        hold = [f for f in result if f.check == "requires_real_evidence"]
        self.assertTrue(hold and hold[0].data.get("unobtainable_here"))
        decision = gate.decide(CONTRACTS["case_study"], result, None, [])
        self.assertEqual(decision.verdict, "hold")

    def test_stale_or_undated_competitor_info_cannot_be_confirmed(self):
        contract = CONTRACTS["competitive_comparison"]
        payload = good_artifact({"contract": contract, "task_id": "x"})
        payload["claims"] = [{"id": "C1", "text": "競合Aは無料である", "type": "competitor", "status": "confirmed", "evidence": ["N1"]}]
        payload["new_evidence"] = [{"id": "N1", "kind": "public_web", "url": "https://example.invalid/a", "quote": "無料", "retrieved_at": "2023-01-01"}]
        self.assertIn("stale_competitor_info", checks(payload, "competitive_comparison"))
        payload["new_evidence"][0]["retrieved_at"] = ""
        self.assertTrue(checks(payload, "competitive_comparison") & {"stale_competitor_info", "evidence_refs_valid"})
        # 未確認としてなら、古い情報も残してよい。
        payload["claims"][0]["status"] = "unverified"
        payload["new_evidence"][0]["retrieved_at"] = "2023-01-01"
        self.assertNotIn("stale_competitor_info", checks(payload, "competitive_comparison"))

    def test_paraphrased_candidates_detected(self):
        a = {"structured": {"target": "窓口の責任者", "value": "担当者が不在でも経緯を確認できる"}}
        b = {"structured": {"target": "窓口の責任者", "value": "担当者が不在でも経緯が確認できる"}}
        differs, _ = formal.candidates_differ(a, b)
        self.assertFalse(differs)
        c = {"structured": {"target": "複数拠点を統括する責任者", "value": "拠点ごとの未割り当てを週次で見直せる"}}
        differs, _ = formal.candidates_differ(a, c)
        self.assertTrue(differs)


class EvidenceWithStore(RunCase):
    def test_nonexistent_source_and_missing_quote_rejected(self):
        engine, _ = self.start()
        payload = good_artifact({"contract": CONTRACTS["customer_analysis"], "task_id": "x"})
        payload["new_evidence"] = [{"id": "N1", "source_id": "S99", "kind": "document_fact", "quote": "担当者が不在"}]
        self.assertIn("evidence_refs_valid", checks(payload, "customer_analysis", engine.store))
        payload["new_evidence"] = [{"id": "N1", "source_id": "S1", "kind": "document_fact", "quote": "資料に存在しない文言である"}]
        self.assertIn("evidence_refs_valid", checks(payload, "customer_analysis", engine.store))
        payload["new_evidence"] = [{"id": "N1", "source_id": "S1", "kind": "document_fact", "quote": "担当者が不在の日は、共有表の更新が止まる。"}]
        self.assertNotIn("evidence_refs_valid", checks(payload, "customer_analysis", engine.store))

    def test_reference_to_unknown_evidence_rejected(self):
        engine, _ = self.start()
        payload = good_artifact({"contract": CONTRACTS["customer_analysis"], "task_id": "x"})
        payload["claims"] = [{"id": "C1", "text": "x", "type": "fact", "status": "hypothesis", "evidence": ["E999"]}]
        self.assertIn("evidence_refs_valid", checks(payload, "customer_analysis", engine.store))


class GateRules(unittest.TestCase):
    contract = CONTRACTS["landing_page"]

    def meta(self):
        return {"contract": self.contract, "open_defects": []}

    def test_major_defect_is_not_offset_by_high_score(self):
        review = good_review(self.meta())
        review["score"] = 98
        review["defects"] = [{"severity": "major", "category": "inference_error", "location": "§2", "reason": "未提供の機能を断定している", "fix_condition": "削除"}]
        self.assertEqual(gate.decide(self.contract, [], review, []).verdict, "fail")

    def test_unmet_criterion_rejected_even_if_verdict_pass(self):
        review = good_review(self.meta())
        review["contract_results"][0] = {"criterion": "LP-1", "met": False, "reason": "本文がない"}
        self.assertEqual(gate.decide(self.contract, [], review, []).verdict, "fail")

    def test_review_must_answer_all_criteria(self):
        review = good_review(self.meta())
        review["contract_results"] = review["contract_results"][:1]
        self.assertEqual(gate.decide(self.contract, [], review, []).verdict, "invalid_review")

    def test_criterion_with_description_is_the_same_criterion(self):
        # 実エージェントの実行で、基準IDに説明を付けて返す例が実際にあった。
        review = good_review(self.meta())
        for result in review["contract_results"]:
            result["criterion"] = f"{result['criterion']}: 基準の説明"
        self.assertEqual(gate.decide(self.contract, [], review, []).verdict, "pass")

    def test_defect_without_location_is_invalid(self):
        review = bad_review(self.meta())
        review["defects"][0]["location"] = ""
        self.assertEqual(gate.decide(self.contract, [], review, []).verdict, "invalid_review")

    def test_fail_without_reason_is_invalid(self):
        review = good_review(self.meta())
        review["verdict"] = "fail"
        self.assertEqual(gate.decide(self.contract, [], review, []).verdict, "invalid_review")

    def test_open_defect_must_be_addressed(self):
        review = good_review(self.meta())
        self.assertEqual(gate.decide(self.contract, [], review, ["D1"]).verdict, "invalid_review")
        review["resolved_defects"] = [{"defect_id": "D1", "resolved": False, "how": "語句が変わっただけで内容は同じ"}]
        self.assertEqual(gate.decide(self.contract, [], review, ["D1"]).verdict, "fail")
        review["resolved_defects"] = [{"defect_id": "D1", "resolved": True, "how": "比較を追加した"}]
        self.assertEqual(gate.decide(self.contract, [], review, ["D1"]).verdict, "pass")

    def test_minor_defect_does_not_fail(self):
        review = good_review(self.meta())
        review["defects"] = [{"severity": "minor", "category": "production_gap", "location": "§1", "reason": "語尾が揃っていない", "fix_condition": "揃える"}]
        self.assertEqual(gate.decide(self.contract, [], review, []).verdict, "pass")

    def test_hypothesis_delivery_is_separate_from_fact_checked(self):
        review = good_review(self.meta())
        self.assertEqual(gate.decide(self.contract, [], review, [], has_unconfirmed_claims=True).delivery_class, "hypothesis")
        self.assertEqual(gate.decide(self.contract, [], review, [], has_unconfirmed_claims=False).delivery_class, "fact_checked")

    def test_fact_contract_with_unconfirmed_claims_is_hold(self):
        contract = CONTRACTS["case_study"]
        review = good_review({"contract": contract, "open_defects": []})
        self.assertEqual(gate.decide(contract, [], review, [], has_unconfirmed_claims=True).verdict, "hold")


if __name__ == "__main__":
    unittest.main()
