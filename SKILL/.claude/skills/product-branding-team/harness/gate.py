"""品質ゲート。形式検査と内容検査の結果から受理・差し戻し・保留を決める。

点数は判定に使わない。重大な欠陥が一つでもあれば、他の評価が高くても合格にしない。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

CRITERION_ID = re.compile(r"[A-Z]{2}-\d+")


@dataclass
class GateDecision:
    verdict: str  # pass / fail / hold / invalid_review
    reasons: list = field(default_factory=list)
    delivery_class: str | None = None


def normalize_review(review):
    """基準IDに説明が付いていても同じ基準として扱う。検査の内容は変えない。"""
    for key in ("contract_results", "defects"):
        for item in review.get(key) or []:
            match = CRITERION_ID.search(str(item.get("criterion") or ""))
            if match:
                item["criterion"] = match.group(0)
    return review


def review_shape_errors(contract, review, open_major_ids):
    """検査そのものの不備。全基準への回答、該当箇所と理由、未解決欠陥への判定を要求する。"""
    errors = []
    must = {c["id"] for c in contract.get("pass_criteria", [])}
    answered = {r.get("criterion") for r in review.get("contract_results", [])}
    missing = must - answered
    if missing:
        errors.append(f"合否基準 {sorted(missing)} への判定がない")
    for result in review.get("contract_results", []):
        if not result.get("met") and not str(result.get("reason", "")).strip():
            errors.append(f"基準 {result.get('criterion')} を未達とした理由がない")
    for defect in review.get("defects", []):
        if not str(defect.get("location", "")).strip() or not str(defect.get("reason", "")).strip():
            errors.append("該当箇所または理由のない欠陥がある")
    addressed = {d.get("defect_id") for d in review.get("resolved_defects", [])}
    unaddressed = set(open_major_ids) - addressed
    if unaddressed:
        errors.append(f"未解決の重大欠陥 {sorted(unaddressed)} への判定がない")
    return errors


def decide(contract, machine_findings, review, open_major_ids, has_unconfirmed_claims=False, contract_changed=False):
    """判定は機械的な規則で行い、検査担当の verdict だけでは合格にしない。"""
    machine_major = [f for f in machine_findings if f.severity == "major"]
    if review is None:
        if machine_major:
            hold = any(f.data.get("unobtainable_here") for f in machine_major)
            return GateDecision("hold" if hold else "fail", [f.reason for f in machine_major])
        return GateDecision("invalid_review", ["内容検査の結果がない"])

    normalize_review(review)
    errors = review_shape_errors(contract, review, open_major_ids)
    if errors:
        return GateDecision("invalid_review", errors)

    major = [d for d in review.get("defects", []) if d.get("severity") == "major"]
    unmet_must = [
        r for r in review.get("contract_results", [])
        if not r.get("met") and _is_must(contract, r.get("criterion"))
    ]
    still_open = [d["defect_id"] for d in review.get("resolved_defects", []) if not d.get("resolved")]
    reasons = [f.reason for f in machine_major]
    reasons += [f"重大欠陥: {d.get('reason')}" for d in major]
    reasons += [f"基準未達 {r.get('criterion')}: {r.get('reason')}" for r in unmet_must]
    reasons += [f"重大欠陥 {d} が未解消" for d in still_open]

    verdict = review.get("verdict")
    if verdict == "hold":
        if not any(d.get("category") == "info_missing" for d in review.get("defects", [])):
            return GateDecision("invalid_review", ["保留の理由となる情報不足が示されていない"])
        return GateDecision("hold", reasons or ["情報不足のため判断できない"])
    if reasons:
        return GateDecision("fail", reasons)
    if verdict == "fail":
        # 重大欠陥も基準未達も示さない不合格は、修正条件が分からないので検査の不備として扱う。
        return GateDecision("invalid_review", ["不合格の根拠となる重大欠陥または基準未達が示されていない"])

    delivery = "fact_checked"
    if has_unconfirmed_claims:
        if not contract.get("delivery", {}).get("allows_hypothesis", False):
            return GateDecision("hold", ["確認済みの根拠が必要な成果物に未確認の主張が残っている"])
        delivery = "hypothesis"
    if contract_changed:
        delivery = f"{delivery}_changed_contract"
    return GateDecision("pass", [], delivery)


def _is_must(contract, criterion_id):
    for criterion in contract.get("pass_criteria", []):
        if criterion["id"] == criterion_id:
            return criterion.get("must", True)
    return True


def route_for(category, can_research):
    """欠陥の分類から差し戻し先を決める。「もっと深く考える」という同じ指示を繰り返さないため。"""
    if category == "info_missing":
        return "research" if can_research else "hold"
    if category == "review_error":
        return "re_review"
    if category == "target_selection":
        return "strategy"
    return "revise"


def defect_signature(artifact_id, finding, origin="content") -> str:
    """同じ欠陥が残っているかを判定するための識別値。

    機械検査は同じ検査が別々の欠陥を指摘するので理由まで含める。内容検査は文面が毎回変わるので、
    基準または箇所で判定する。未解決の欠陥は次の検査担当が欠陥IDごとに判定する。
    """
    key = finding.get("criterion") or finding.get("check") or finding.get("location") or ""
    if origin == "machine":
        return f"{artifact_id}|{key}|{finding.get('reason')}"
    return f"{artifact_id}|{finding.get('category')}|{key}"
