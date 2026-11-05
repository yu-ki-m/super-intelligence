"""成果物の形式検査。意味の判断はここで行わず、別担当の内容検査に渡す。

ここで見るのは、コードで確かめられること（必須項目、ID参照、引用の実在、状態の
昇格など）だけである。通過しても内容が正しいとは言えない。一方、文字数や引用数の
多さは合否に使わない。短くても必要な内容があれば通過させるためである。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

UNIVERSAL_TARGET = re.compile(r"^(すべて|全て|あらゆる|全部|誰でも|だれでも|全企業|全ユーザー|万人)|(すべての|全ての|あらゆる)(企業|会社|人|顧客|ユーザー|業種|方)|誰でも|だれでも")
ABSOLUTE = re.compile(r"唯一|必ず(改善|解決|成果|削減|短縮|上が|下が|減)|(対応)?漏れ(ゼロ|を?なくす)|ゼロにする|絶対に|業界(No\.?1|ナンバーワン|一位|初)|100\s*[%％]|完全に(防|解決|自動)")
PLAN_MARK = re.compile(r"予定|開発中|今後|将来|計画|ロードマップ|検討中|未提供|提供前|準備中|まだ提供|まだ使え|できない|約束しない|提供しない|含まない|含めない|対象外|除外|使わない|書かない")
# この見出しの下の文は、提供しないことや避けることの説明なので、約束として扱わない。
NOT_A_PROMISE_HEADING = re.compile(r"約束しない|開発中|開発予定|提供予定|未提供|今後|対象外|適さない|避ける|使わない表現|保証しない")
STATUS_QUO_TYPES = {"manual", "inhouse", "status_quo", "outsourcing", "tool_combo", "do_nothing"}
EVIDENCE_REAL_CUSTOMER = {"customer_statement", "customer_behavior"}
DEMAND_TYPES = {"demand", "customer_reaction"}
NORMALIZE = re.compile(r"\s+")


@dataclass
class Finding:
    check: str
    severity: str
    category: str
    reason: str
    fix_condition: str
    location: str = ""
    quote: str = ""
    criterion: str = ""
    fix_target: str = ""
    data: dict = field(default_factory=dict)


def norm(text: str) -> str:
    return NORMALIZE.sub("", text or "")


def sentences(text: str):
    for sentence in re.split(r"(?<=[。！？\n])", text or ""):
        sentence = sentence.strip()
        if sentence:
            yield sentence


def promise_sentences(text: str):
    """約束として読む文だけを返す。提供しないことを説明する節は除く。"""
    exempt_level = None
    for line in (text or "").splitlines():
        match = re.match(r"^(#+)\s*(.+)", line.strip())
        if match:
            level = len(match.group(1))
            if exempt_level is not None and level <= exempt_level:
                exempt_level = None
            if exempt_level is None and NOT_A_PROMISE_HEADING.search(match.group(2)):
                exempt_level = level
            continue
        if exempt_level is None:
            yield from sentences(line)


def headings_have_body(ctx):
    """必須の見出しの有無と、見出しだけで本文がない節を検出する。文字数の多さは問わない。"""
    doc = ctx.payload.get("document", "")
    out = []
    for heading in ctx.contract.get("required_headings", []):
        if heading not in doc:
            out.append(Finding("headings_have_body", "major", "production_gap",
                               f"必須の項目「{heading}」が本文にない", f"「{heading}」の内容を書く", location=heading))
    lines = doc.splitlines()
    empties = []
    total_sections = 0
    for i, line in enumerate(lines):
        match = re.match(r"^(#+)\s*(.+)", line.strip())
        if not match:
            continue
        total_sections += 1
        level = len(match.group(1))
        body = []
        for later in lines[i + 1:]:
            next_heading = re.match(r"^(#+)\s", later.strip())
            if next_heading and len(next_heading.group(1)) <= level:
                break
            body.append(later)
        if not "".join(body).strip():
            empties.append(match.group(2).strip())
    if empties:
        out.append(Finding("headings_have_body", "major", "production_gap",
                           f"見出しだけで本文がない節がある：{'、'.join(empties[:8])}",
                           "各節に依頼された範囲の本文を書く", location="、".join(empties[:8])))
    if not doc.strip():
        out.append(Finding("headings_have_body", "major", "production_gap", "本文が空である", "本文を書く"))
    return out


def required_structured(ctx):
    structured = ctx.payload.get("structured") or {}
    out = []
    for key, kind in ctx.contract.get("required_structured", {}).items():
        value = structured.get(key)
        missing = value in (None, "", [], {})
        wrong = (kind == "list" and not isinstance(value, list)) or (kind == "text" and not isinstance(value, str))
        if missing or wrong:
            out.append(Finding("required_structured", "major", "production_gap",
                               f"必須の整理項目 structured.{key} がない、または形式が違う",
                               f"structured.{key} を {kind} で記入する", location=f"structured.{key}"))
    return out


def evidence_refs_valid(ctx):
    """存在しない出典の検出。引用が資料に実在するかまで確かめる。実在しても裏づけるとは限らない。"""
    out = []
    local_ids = {e.get("id") for e in ctx.payload.get("new_evidence", [])}
    for item in ctx.payload.get("new_evidence", []):
        out += _check_new_evidence(ctx, item)
    for claim in ctx.payload.get("claims", []):
        for ref in claim.get("evidence", []):
            if ref in local_ids:
                continue
            row = ctx.store.evidence_row(ref) if ctx.store else None
            if row is None:
                out.append(Finding("evidence_refs_valid", "major", "inference_error",
                                   f"主張 {claim.get('id')} が存在しない根拠 {ref} を参照している",
                                   "実在する根拠を示すか、主張を未確認にする",
                                   location=claim.get("id", ""), quote=claim.get("text", "")[:80]))
            elif row["product_id"] != ctx.product_id:
                out.append(Finding("evidence_refs_valid", "major", "inference_error",
                                   f"主張 {claim.get('id')} が別の製品（{row['product_id']}）の根拠 {ref} を使っている",
                                   "この製品の資料だけを根拠にする", location=claim.get("id", "")))
            elif row["state"] == "stale":
                out.append(Finding("evidence_refs_valid", "major", "production_gap",
                                   f"主張 {claim.get('id')} の根拠 {ref} は資料の更新により確認できなくなった",
                                   "最新の資料で確かめ直す", location=claim.get("id", "")))
    return out


def _check_new_evidence(ctx, item):
    source_id = item.get("source_id")
    if source_id:
        source = ctx.store.source(source_id) if ctx.store else None
        if source is None:
            return [Finding("evidence_refs_valid", "major", "inference_error",
                            f"存在しない資料 {source_id} を出典にしている", "登録済みの資料を出典にする",
                            location=item.get("id", ""), quote=item.get("quote", "")[:80])]
        if source["product_id"] not in (ctx.product_id, "shared"):
            return [Finding("evidence_refs_valid", "major", "inference_error",
                            f"別の製品（{source['product_id']}）の資料 {source_id} を出典にしている",
                            "この製品の資料だけを出典にする", location=item.get("id", ""))]
        quote = norm(item.get("quote", ""))
        if not quote or quote not in norm(ctx.store.read_source(source)):
            return [Finding("evidence_refs_valid", "major", "inference_error",
                            f"引用が資料 {source_id} に見つからない", "資料の文言をそのまま引用する",
                            location=item.get("id", ""), quote=item.get("quote", "")[:80])]
        return []
    if item.get("url"):
        if not item.get("retrieved_at"):
            return [Finding("evidence_refs_valid", "major", "info_missing", "公開情報に確認日がない",
                            "確認した日を記録する", location=item.get("id", ""))]
        return []
    if item.get("kind") in {"general_knowledge", "ai_inference"}:
        return []
    return [Finding("evidence_refs_valid", "major", "inference_error", "出所のない根拠である",
                    "資料または URL を示す。示せなければ未確認の主張として扱う", location=item.get("id", ""))]


def claims_have_status(ctx):
    """根拠のない主張が確認済みになっていないかを見る。確認状態と根拠の対応だけを確かめる。"""
    out = []
    local = {e.get("id"): e for e in ctx.payload.get("new_evidence", [])}
    for claim in ctx.payload.get("claims", []):
        if claim.get("status") != "confirmed" or claim.get("type") in {"decision", "assumption"}:
            continue
        # 上流の主張から導いた主張は、資料一式の横断検査で派生元をたどって確かめる。
        if claim.get("derived_from"):
            continue
        refs = claim.get("evidence", [])
        kinds = [_kind(ctx, r, local) for r in refs]
        factual = [k for k in kinds if k and k not in {"general_knowledge", "ai_inference"}]
        if not factual:
            out.append(Finding("claims_have_status", "major", "inference_error",
                               f"主張 {claim.get('id')} は確認済みとされているが、資料に基づく根拠がない",
                               "根拠を示すか、確認状態を未確認または仮説にする",
                               location=claim.get("id", ""), quote=claim.get("text", "")[:80]))
    return out


def _kind(ctx, ref, local):
    if ref in local:
        return local[ref].get("kind")
    row = ctx.store.evidence_row(ref) if ctx.store else None
    return row["kind"] if row else None


def target_not_universal(ctx):
    out = []
    candidates = [(c.get("id", ""), c.get("target_customer", "")) for c in ctx.payload.get("claims", [])]
    target = (ctx.payload.get("structured") or {}).get("target")
    if isinstance(target, str):
        candidates.append(("structured.target", target))
    for location, value in candidates:
        if value and UNIVERSAL_TARGET.search(value):
            out.append(Finding("target_not_universal", "major", "target_selection",
                               f"対象が「{value}」で、誰のどの状況を扱うかを判断できない",
                               "選択につながる状況と対象外の条件を具体的に書く", location=location, quote=value))
    return out


def no_unbacked_absolutes(ctx):
    """「唯一」「必ず改善」「対応漏れゼロ」などは、確認済みの根拠がある主張にしか使えない。"""
    doc = ctx.payload.get("document", "")
    confirmed = [norm(c.get("text", "")) for c in ctx.payload.get("claims", [])
                 if c.get("status") == "confirmed" and c.get("evidence")]
    out = []
    for sentence in promise_sentences(doc):
        if not ctx.contract.get("external_facing"):
            sentence = re.sub(r"「[^」]*」", "", sentence)
        match = ABSOLUTE.search(sentence)
        if not match:
            continue
        # 「対応漏れゼロとは言わない」のように否定する文は、約束ではないので対象にしない。
        if re.search(r"(とは(言わ|いえ|書か|約束し)|保証し(ない|ません)|使わ(ない|ず)|避ける|約束しない|ではない|ではありません)", sentence):
            continue
        if any(norm(sentence) in c or c in norm(sentence) for c in confirmed):
            continue
        out.append(Finding("no_unbacked_absolutes", "major", "inference_error",
                           f"断定表現「{match.group(0)}」を裏づける確認済みの主張がない",
                           "根拠を示すか、条件を付けた表現に改める", location="本文", quote=sentence[:100]))
    return out


def planned_not_current(ctx):
    """依頼書で開発予定と登録された機能を、現在の価値として書いていないかを見る。"""
    out = []
    for item in ctx.brief.get("planned_features", []):
        for keyword in item.get("keywords", []):
            for sentence in promise_sentences(ctx.payload.get("document", "")):
                if keyword in sentence and not PLAN_MARK.search(sentence):
                    out.append(Finding("planned_not_current", "major", "inference_error",
                                       f"開発予定の機能「{item.get('name', keyword)}」を提供中のように書いている",
                                       "提供時期を明記するか、現在の価値から外す", location="本文", quote=sentence[:100]))
                    break
    for claim in ctx.payload.get("claims", []):
        if claim.get("status") == "confirmed" and claim.get("type") == "planned":
            out.append(Finding("planned_not_current", "major", "inference_error",
                               f"主張 {claim.get('id')} は予定なのに確認済みになっている", "確認状態を planned にする",
                               location=claim.get("id", "")))
    return out


def planned_capability_status(ctx):
    """製品の整理で、開発予定の機能を現在の機能に分類していないかを見る。"""
    out = []
    keywords = [(i.get("name"), k) for i in ctx.brief.get("planned_features", []) for k in i.get("keywords", [])]
    for row in (ctx.payload.get("structured") or {}).get("capabilities") or []:
        if not isinstance(row, dict) or row.get("status") != "current":
            continue
        for name, keyword in keywords:
            if keyword in str(row.get("name", "")):
                out.append(Finding("planned_capability_status", "major", "inference_error",
                                   f"開発予定の機能「{name}」を現在の機能に分類している", "status を planned にする",
                                   location="structured.capabilities", quote=str(row.get("name"))))
                break
    return out


def alternatives_include_status_quo(ctx):
    rows = (ctx.payload.get("structured") or {}).get("alternatives") or []
    types = {r.get("type") for r in rows if isinstance(r, dict)}
    if types & STATUS_QUO_TYPES:
        return []
    return [Finding("alternatives_include_status_quo", "major", "production_gap",
                    "比較に手作業・内製・現状維持など、製品以外の選択肢がない",
                    "顧客が実際に選びうる現在の方法を比較に加える", location="structured.alternatives")]


def demand_needs_real_customer(ctx):
    """チームの合意やAIの評価を需要の根拠にしない。実際の顧客の発言か行動だけを認める。"""
    out = []
    local = {e.get("id"): e for e in ctx.payload.get("new_evidence", [])}
    for claim in ctx.payload.get("claims", []):
        if claim.get("type") in DEMAND_TYPES and claim.get("status") == "confirmed":
            kinds = {_kind(ctx, r, local) for r in claim.get("evidence", [])}
            if not kinds & EVIDENCE_REAL_CUSTOMER:
                out.append(Finding("demand_needs_real_customer", "major", "inference_error",
                                   f"主張 {claim.get('id')} は需要や顧客の反応を確認済みとしているが、実際の顧客の発言や行動が根拠にない",
                                   "未確認として検証計画に回す", location=claim.get("id", ""), quote=claim.get("text", "")[:80]))
    return out


def stale_competitor_info(ctx):
    """古い、または確認日のない競合情報を確認済みの主張の根拠にしない。"""
    max_age = ctx.contract.get("max_evidence_age_days")
    if not max_age:
        return []
    out = []
    local = {e.get("id"): e for e in ctx.payload.get("new_evidence", [])}
    today = ctx.today
    for claim in ctx.payload.get("claims", []):
        if claim.get("status") != "confirmed" or claim.get("type") != "competitor":
            continue
        for ref in claim.get("evidence", []):
            retrieved = _retrieved(ctx, ref, local)
            days = _age_days(retrieved, today)
            if days is None:
                out.append(Finding("stale_competitor_info", "major", "info_missing",
                                   f"主張 {claim.get('id')} の競合情報に確認日がない", "確認日を示すか未確認にする",
                                   location=claim.get("id", "")))
            elif days > max_age:
                out.append(Finding("stale_competitor_info", "major", "info_missing",
                                   f"主張 {claim.get('id')} の競合情報は {days} 日前のもので、確認済みとして扱えない",
                                   "最新の情報で確かめるか未確認にする", location=claim.get("id", "")))
    return out


def _retrieved(ctx, ref, local):
    if ref in local:
        item = local[ref]
        if item.get("retrieved_at"):
            return item["retrieved_at"]
        source = ctx.store.source(item.get("source_id")) if (ctx.store and item.get("source_id")) else None
        return source["retrieved_at"] if source else ""
    row = ctx.store.evidence_row(ref) if ctx.store else None
    return row["retrieved_at"] if row else ""


def _age_days(date_text, today):
    import datetime as dt

    try:
        return (today - dt.date.fromisoformat((date_text or "")[:10])).days
    except ValueError:
        return None


def candidate_has_rejection_basis(ctx):
    structured = ctx.payload.get("structured") or {}
    if not structured.get("flips_if"):
        return [Finding("candidate_has_rejection_basis", "major", "production_gap",
                        "判断を覆す条件が書かれていない", "どの事実が分かれば案を変えるかを書く",
                        location="structured.flips_if")]
    return []


def requires_real_evidence(ctx):
    """実績を根拠にする成果物に実績がないときは、仮説のまま合格にせず保留にする。"""
    required = ctx.contract.get("delivery", {}).get("requires_real_evidence_kinds")
    if not required:
        return []
    local = {e.get("id"): e for e in ctx.payload.get("new_evidence", [])}
    kinds = set()
    for claim in ctx.payload.get("claims", []):
        for ref in claim.get("evidence", []):
            kinds.add(_kind(ctx, ref, local))
    if kinds & set(required):
        return []
    return [Finding("requires_real_evidence", "major", "info_missing",
                    "実績に基づく成果物なのに、実際の顧客の発言や行動の根拠がない",
                    "実績資料が得られるまで保留する", location="claims", data={"unobtainable_here": True})]


CHECKS = {f.__name__: f for f in [
    headings_have_body, required_structured, evidence_refs_valid, claims_have_status, target_not_universal,
    no_unbacked_absolutes, planned_not_current, alternatives_include_status_quo, demand_needs_real_customer,
    stale_competitor_info, candidate_has_rejection_basis, requires_real_evidence, planned_capability_status,
]}
ALWAYS = ["headings_have_body", "required_structured", "evidence_refs_valid", "claims_have_status",
          "target_not_universal", "demand_needs_real_customer"]


@dataclass
class CheckContext:
    payload: dict
    contract: dict
    brief: dict
    store: object
    product_id: str
    today: object


def run_checks(ctx: CheckContext) -> list[Finding]:
    names = list(dict.fromkeys(ALWAYS + ctx.contract.get("machine_checks", [])))
    findings: list[Finding] = []
    for name in names:
        findings += CHECKS[name](ctx)
    return findings


def candidates_differ(payload_a: dict, payload_b: dict, threshold=0.82):
    """言い換えだけの候補を見つける補助。対象と提供価値の両方が近いときだけ指摘する。"""
    from difflib import SequenceMatcher

    a, b = payload_a.get("structured") or {}, payload_b.get("structured") or {}
    target = SequenceMatcher(None, norm(str(a.get("target"))), norm(str(b.get("target")))).ratio()
    value = SequenceMatcher(None, norm(str(a.get("value"))), norm(str(b.get("value")))).ratio()
    return not (target >= threshold and value >= threshold), {"target_similarity": round(target, 2), "value_similarity": round(value, 2)}


def is_vague_message(message: dict) -> str | None:
    """対象や理由のない称賛・批判を形式面で拒否する。内容の妥当性は判断しない。"""
    kind = message.get("kind")
    if kind in {"support", "critique"}:
        if not (message.get("quote") or message.get("target_claim")):
            return "どの主張に対する発言かが示されていない"
        reason = norm(message.get("reason", ""))
        if not reason:
            return "判断の理由が書かれていない"
        if re.fullmatch(r"(素晴らしい|良い|いい|最高|駄目|ダメ|だめ|悪い|弱い|賛成|同意|反対)[。！!]*", reason):
            return "評価の言葉だけで、対象と理由が書かれていない"
    return None
