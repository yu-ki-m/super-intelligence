"""資料一式の機械検査。ID・版・数値の定義・派生関係の整合を確かめる。

結果は二つに分かれる。構造だけで判断できるもの（版の不一致、未確認の主張の確定化、資料の根拠に
届かない循環）は重大な欠陥として扱う。文字列の比較に頼るもの（対象の違い、成立条件の脱落、数値の
定義の違い）は「確認依頼（flag）」として内容検査（V08）へ渡し、確定するか退けるかを理由つきで判断させる。
言い方が違うだけの記述を矛盾と断定しないためである。通過しても意味の整合を保証しない。
"""
from __future__ import annotations

import re

from .formal import Finding, norm

CONFIRMED = "confirmed"
UNCONFIRMED = {"hypothesis", "unverified", "planned"}


def check_bundle(store, manifest, adopted_artifact="adopted_strategy", media=None):
    """manifest は [{artifact_id, version, sha256}] の固定された一覧である。

    media は戦略の対象を引き継ぐべき下流の資料（対外的な資料と検証計画）の成果物IDである。
    上流の調査資料は、比較のために戦略の対象以外の顧客も扱うので、対象の比較から除く。
    """
    findings = []
    claims = {}
    docs = {}
    for item in manifest:
        art = store.artifact(item["artifact_id"], item["version"])
        if art is None or art["sha256"] != item["sha256"]:
            findings.append(Finding("bundle_manifest", "major", "cross_doc",
                                    f"{item['artifact_id']} v{item['version']} の版または内容が一覧と一致しない",
                                    "固定した版で検査し直す", location=item["artifact_id"], fix_target=item["artifact_id"]))
            continue
        latest = store.latest_accepted(item["artifact_id"])
        if latest is None or latest["version"] != item["version"]:
            findings.append(Finding("bundle_manifest", "major", "cross_doc",
                                    f"{item['artifact_id']} v{item['version']} は最新の合格版ではない",
                                    "最新の合格版で検査し直す", location=item["artifact_id"], fix_target=item["artifact_id"]))
        docs[item["artifact_id"]] = art
        for claim in store.claims_of(item["artifact_id"], item["version"]):
            claims[f"{item['artifact_id']}#{claim['local_id']}"] = claim
    findings += hypothesis_promoted(claims)
    findings += conditions_dropped(claims)
    findings += metric_definitions(claims)
    findings += circular_support(claims)
    findings += target_mismatch(store, docs, claims, adopted_artifact, media)
    return findings


def _parents(claim, claims):
    for ref in claim.get("derived_from", []):
        key = ref.get("ref") if isinstance(ref, dict) else ref
        relation = ref.get("relation", "reference") if isinstance(ref, dict) else "reference"
        yield key, relation, claims.get(key)


def hypothesis_promoted(claims):
    """未確認の内容が、要約や転載で事実に変わっていないかを見る。"""
    out = []
    for key, claim in claims.items():
        if claim["status"] != CONFIRMED:
            continue
        own_evidence = bool(claim.get("evidence"))
        for parent_key, relation, parent in _parents(claim, claims):
            if parent and parent["status"] in UNCONFIRMED and not own_evidence:
                out.append(Finding("hypothesis_promoted", "major", "cross_doc",
                                   f"{key} は未確認の {parent_key}（{parent['status']}）を、根拠を加えずに確認済みとして転記している",
                                   "確認状態を戻すか、新しい根拠を示す", location=key, quote=claim["text"][:100],
                                   fix_target=key.split("#")[0]))
    return out


def conditions_dropped(claims):
    """上流の主張の成立条件が、下流で理由なく消えていないかを見る。"""
    out = []
    for key, claim in claims.items():
        if claim.get("conditions"):
            # 条件を言い換えて引き継いでいるかは文字列では判断できない。内容検査に任せる。
            continue
        for parent_key, relation, parent in _parents(claim, claims):
            if not parent or relation == "decision":
                continue
            if parent.get("conditions"):
                out.append(Finding("conditions_dropped", "flag", "cross_doc",
                                   f"{key} は成立条件を持たないが、派生元 {parent_key} には成立条件「{'、'.join(parent['conditions'])}」がある",
                                   "条件を引き継ぐか、条件が不要になった根拠を示す", location=key, quote=claim["text"][:100],
                                   fix_target=key.split("#")[0]))
                break
    return out


def metric_definitions(claims):
    """同じ数値でも、単位・期間・母数・測定条件が違えば同じ指標として扱わない。"""
    out = []
    by_name = {}
    for key, claim in claims.items():
        metric = claim.get("metric")
        if not metric:
            continue
        name = norm(metric.get("name") or str(metric.get("value")))
        by_name.setdefault(name, []).append((key, metric))
    for name, items in by_name.items():
        base_key, base = items[0]
        for key, metric in items[1:]:
            diffs = [f for f in ("unit", "period", "population", "method") if _canon(base.get(f)) != _canon(metric.get(f))]
            if diffs:
                out.append(Finding("metric_definitions", "flag", "cross_doc",
                                   f"{base_key} と {key} の指標「{name}」は {'・'.join(diffs)} が一致しない",
                                   "定義をそろえるか、別の指標として書き分ける", location=key,
                                   fix_target=key.split("#")[0]))
    return out


def _canon(value):
    return re.sub(r"[\s/／・、。（）()「」]", "", str(value or ""))


def circular_support(claims):
    """下流の資料同士で主張を裏づけ合い、元の根拠に届かない状態を検出する。"""
    out = []
    for key, claim in claims.items():
        if claim["status"] != CONFIRMED or claim.get("type") in {"decision", "assumption"}:
            continue
        if not _reaches_root(key, claims, set()):
            out.append(Finding("circular_support", "major", "cross_doc",
                               f"{key} は派生元をたどっても資料の根拠に届かない（資料同士の循環参照を含む）",
                               "原資料の根拠を示す", location=key, quote=claim["text"][:100],
                               fix_target=key.split("#")[0]))
    return out


def _reaches_root(key, claims, seen):
    if key in seen:
        return False
    seen.add(key)
    claim = claims.get(key)
    if claim is None:
        # 一覧の外の主張はここでは確かめられないので、循環の判定には使わない。
        return True
    if claim.get("evidence"):
        return True
    parents = [p for p, _, _ in _parents(claim, claims)]
    if not parents:
        return False
    return any(_reaches_root(p, claims, seen) for p in parents)


def target_mismatch(store, docs, claims, adopted_artifact, media=None):
    """対外資料の対象が、採用された戦略の対象と違わないかを見る。

    対象の違いがあっても、戦略で認めた読み手（audiences）か、読み手の違いを理由として
    明示した主張（audience）なら矛盾としない。表現の統一を強制しないためである。
    """
    if adopted_artifact not in docs:
        return []
    structured = _structured(docs[adopted_artifact])
    target = norm(str(structured.get("target") or ""))
    audiences = {norm(a) for a in structured.get("audiences") or []}
    if not target:
        return []
    out = []
    for key, claim in claims.items():
        if key.startswith(adopted_artifact + "#"):
            continue
        if media is not None and key.split("#")[0] not in media:
            continue
        customer = norm(claim.get("target_customer") or "")
        if not customer or customer in target or target in customer:
            continue
        audience = norm(claim.get("audience") or "")
        if audience and (audience in audiences or customer in audiences):
            continue
        if customer in audiences:
            continue
        if _same_terms(customer, target):
            continue
        out.append(Finding("target_mismatch", "flag", "cross_doc",
                           f"{key} の対象「{claim['target_customer']}」が、採用された戦略の対象「{structured.get('target')}」と一致せず、読み手の違いも記録されていない",
                           "戦略の対象に合わせるか、戦略で認められた読み手として理由を明記する", location=key,
                           quote=claim["text"][:100], fix_target=key.split("#")[0]))
    return out


def _structured(art):
    import json

    return json.loads(art.get("structured") or "{}")


def _same_terms(a, b):
    tokens = [t for t in re.split(r"[のにでをはがと、・]", a) if len(t) >= 2]
    return bool(tokens) and all(t in b for t in tokens)


def distinct_root_sources(store, claim, version_lookup=None):
    """同じ資料を複数の主張や担当が引用しても、独立した複数の証拠として数えない。"""
    roots = set()
    for ref in claim.get("evidence") or []:
        row = store.evidence_row(ref)
        if row:
            roots.add(row["source_id"] or row["url"] or ref)
    return roots
