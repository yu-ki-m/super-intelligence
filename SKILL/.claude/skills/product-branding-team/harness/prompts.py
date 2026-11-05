"""各インスタンスへ渡す依頼文を組み立てる。

必要な資料だけを渡し、50役割分の全履歴を配布しない。検査担当には作成者の名前や
討論の多数意見を渡さない。独立候補の担当には他の案を渡さない。
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from validators.schema_check import load_schema

ROOT = Path(__file__).resolve().parent.parent
INLINE_LIMIT = 30000
OUTPUT_GUIDE = ("document には読み手に見せる本文だけを Markdown で書く。整理項目は本文へ混ぜず structured に、主張は claims に分けて省略せずに返す。"
                "claims には判断に影響する主張だけを記録する。claims.evidence には根拠のIDだけを書く。引用文は書かない。"
                "登録済みの根拠は E から始まるIDで参照する。新しく根拠を登録するときは new_evidence に資料の文言をそのまま引用し、N1 のような仮IDを付けて参照する。"
                "仮IDは本文でも同じものを使ってよく、登録時に正式なIDへ置き換わる。"
                "上流の主張から導いた主張は derived_from に「成果物ID#主張ID」と関係の種類（reference、summary、inference、decision、media_translation）を記録する。")
KIND_SCHEMA = {
    "work": "output_artifact", "research": "output_artifact", "revise": "output_artifact",
    "review": "output_review", "critique": "output_critique", "respond": "output_response",
    "reeval": "output_reeval", "decide": "output_decision", "crosscheck": "output_crosscheck",
    "diagnose": "output_diagnosis",
}


def preamble():
    return (ROOT / "quality" / "agent_preamble.md").read_text(encoding="utf-8")


def render_contract(contract):
    criteria = "\n".join(f"- {c['id']}: {c['text']}" for c in contract.get("pass_criteria", []))
    rejects = "\n".join(f"- {r}" for r in contract.get("reject_examples", []))
    lines = [
        f"品質契約 {contract['id']}（版 {contract.get('version', '')}）",
        f"用途：{contract.get('purpose', '')}",
        f"読み手：{contract.get('readers', '')}",
        f"必須の判断：{'、'.join(contract.get('required_decisions', []))}",
        f"必要な根拠：{contract.get('required_evidence', '')}",
        f"提供条件：{contract.get('provision_conditions', '')}",
        f"対象外：{contract.get('out_of_scope', '')}",
        f"次工程での利用：{contract.get('downstream_use', '')}",
        f"合否基準：\n{criteria}",
        f"不合格の例：\n{rejects}",
    ]
    if contract.get("required_headings"):
        lines.append("本文に含める項目：" + "、".join(contract["required_headings"]))
    if contract.get("structured_example"):
        lines.append("structured の形式の例（値は架空。この製品の内容で書く）：\n"
                     + json.dumps(contract["structured_example"], ensure_ascii=False, indent=1))
    allows = contract.get("delivery", {}).get("allows_hypothesis", False)
    lines.append("未確認の主張：" + ("未確認と明示して残してよい（仮説案として受理される）" if allows
                                     else "残っていると受理されず保留になる"))
    return "\n\n".join(lines)


def render_role(role):
    return (f"担当役割 {role['id']} {role['name']}（{role['group']}）\n作業：{role['work']}\n提出するもの：{role['deliverable']}\n"
            f"完了条件：{role['done_when']}\n提案・評価・応答の責任：{role['responsibility']}")


def render_claims(store, artifact_id, version):
    rows = []
    for c in store.claims_of(artifact_id, version):
        rows.append(
            f"- {artifact_id}#{c['local_id']} [{c['type']}/{c['status']}] {c['text']}"
            f"（対象：{c['target_customer'] or '-'}／条件：{'；'.join(c['conditions'] or []) or '-'}／根拠：{','.join(c['evidence'] or []) or 'なし'}）"
        )
    return "\n".join(rows) or "（記録された主張なし）"


def render_evidence(store):
    rows, stale = [], []
    for e in store.all_evidence():
        if e["state"] == "stale":
            stale.append(e["evidence_id"])
            continue
        rows.append(f"- {e['evidence_id']} [{e['kind']}] 出所 {e['source_id'] or e['url'] or 'なし'} {e['locator'] or ''}：「{e['quote'] or ''}」")
    text = "\n".join(rows) or "（登録された根拠なし）"
    if stale:
        text += f"\n（資料の更新で確認できなくなった根拠 {', '.join(stale)} は引用できない。最新の資料から引用し直す）"
    return text


def render_inputs(store, specs, view_dir: Path):
    """入力を版つきで固定し、読み取り用の場所へ複製する。戻り値は本文と入力一覧である。"""
    parts, manifest = [], []
    inputs_dir = view_dir / "inputs"
    inputs_dir.mkdir(parents=True, exist_ok=True)
    expanded = []
    for spec in specs:
        if spec.get("kind") == "sources":
            expanded += [{"kind": "source", "id": s["source_id"]} for s in store.sources_latest()]
        else:
            expanded.append(spec)
    for spec in expanded:
        kind = spec.get("kind")
        if kind == "source":
            source = store.source(spec["id"])
            if not source:
                continue
            text = store.read_source(source)
            rel = f"inputs/{source['source_id']}.v{source['version']}.md"
            shutil.copyfile(store.run_dir / source["path"], view_dir / rel)
            manifest.append({"kind": "source", "id": source["source_id"], "version": source["version"], "sha": source["sha256"]})
            parts.append(_block(f"資料 {source['source_id']} v{source['version']}「{source['title']}」（確認日 {source['retrieved_at'] or '不明'}）", rel, text))
        elif kind in {"artifact", "pinned"}:
            art = store.artifact(spec["id"], spec["version"]) if kind == "pinned" else _resolve(store, spec)
            if not art:
                parts.append(f"### 成果物 {spec['id']}\n（まだ合格した版がない。未実施の入力として扱い、補作しない）")
                manifest.append({"kind": "artifact", "id": spec["id"], "version": None, "sha": None})
                continue
            text = store.read_artifact(art)
            rel = f"inputs/{art['artifact_id']}.v{art['version']}.md"
            shutil.copyfile(store.run_dir / art["path"], view_dir / rel)
            manifest.append({"kind": "artifact", "id": art["artifact_id"], "version": art["version"], "sha": art["sha256"]})
            structured = json.loads(art["structured"] or "{}")
            body = text
            if structured:
                body += "\n\n【structured】\n" + json.dumps(structured, ensure_ascii=False, indent=1)
            body += "\n\n【主要な主張】\n" + render_claims(store, art["artifact_id"], art["version"])
            parts.append(_block(f"成果物 {art['artifact_id']} v{art['version']}（確認状態：{art['delivery_class'] or art['status']}）", rel, body))
        elif kind == "evidence":
            parts.append("### 根拠の一覧\n" + render_evidence(store))
        elif kind == "text":
            parts.append(f"### {spec.get('name', '補足')}\n{spec.get('body', '')}")
    return "\n\n".join(parts), manifest


def _resolve(store, spec):
    return store.latest_artifact(spec["id"]) if spec.get("state") == "latest" else store.latest_accepted(spec["id"])


def _block(title, rel, text):
    if len(text) > INLINE_LIMIT:
        return f"### {title}\nファイル {rel} を Read で読むこと（長いため本文は省略）。"
    return f"### {title}\n（ファイル：{rel}）\n{text}"


def render_message(m):
    extras = []
    for key, label in (("quote", "対象の引用"), ("reason", "理由"), ("evidence", "根拠"), ("conditions", "成立条件"),
                       ("counterexample", "反例"), ("requested_fix", "求める修正"), ("keep_strength", "残したい長所"),
                       ("flips_if", "判断が変わる条件")):
        value = m[key]
        if value and value != "[]":
            extras.append(f"{label}：{value}")
    target = f"{m['target_artifact']} v{m['target_version']}" + (f" の主張 {m['target_claim']}" if m["target_claim"] else "")
    reply = f"／応答先 {m['in_reply_to']}" if m["in_reply_to"] else ""
    return (f"【発言 {m['message_id']}】発言者 {m['from_role']}（{m['kind']}・重大度 {m['severity'] or '-'}）→ 宛先 {m['to_role']}"
            f"／対象 {target}{reply}\n{m['body']}\n" + "\n".join(extras))


def build(engine, task, instance, view_dir, is_new_session):
    """依頼文、出力形式、入力一覧、模擬実装向けの付随情報を返す。"""
    store = engine.store
    brief = engine.brief
    kind = task["kind"]
    role = engine.roles.get(task["role"]) or {}
    inputs_text, manifest = render_inputs(store, task["inputs"], view_dir)
    contract = None
    if task["contract_id"]:
        contract = store.contract(task["contract_id"], task["contract_sha"])

    parts = []
    if is_new_session:
        parts.append(preamble())
        if task["data"].get("handover"):
            parts.append("このインスタンスは前のインスタンスの続きを担当する新しいインスタンスである。以下の引き継ぎを読んで続ける。\n" + task["data"]["handover"])
    parts.append(
        f"対象プロダクト：{brief['product']['name']}（製品ID {brief['product']['id']}）／種別 {brief['product'].get('type', '')}／提供段階 {brief.get('stage', '')}\n"
        f"今回決めたいこと：{brief.get('goal', '')}\n制約：{'；'.join(brief.get('constraints', [])) or 'なし'}\n判断する人：{brief.get('decision_maker', '未確認')}"
    )
    if role:
        parts.append(render_role(role))
    if task["purpose"]:
        parts.append(f"この作業の目的：{task['purpose']}")
    if task["instructions"]:
        parts.append(f"具体的な作業：{task['instructions']}")
    meta = {"kind": kind, "task_id": task["task_id"], "node_id": task["node_id"], "role": task["role"],
            "contract": contract, "artifact_id": task["output_artifact"], "data": task["data"]}

    handler = {"work": _work, "research": _work, "revise": _revise, "review": _review, "critique": _critique,
               "respond": _respond, "reeval": _reeval, "decide": _decide, "crosscheck": _crosscheck,
               "diagnose": _diagnose}[kind]
    parts.append(handler(engine, task, contract, meta))
    if inputs_text:
        parts.append("## 渡された資料\n" + inputs_text)
    prompt = "\n\n".join(p for p in parts if p)
    return prompt, load_schema(KIND_SCHEMA[kind]), manifest, meta


def _work(engine, task, contract, meta):
    note = task["data"].get("retry_note")
    text = ["## 提出するもの", render_contract(contract) if contract else ""]
    trigger = task["data"].get("trigger")
    if trigger:
        text.append("調べる不足事項：\n" + json.dumps(trigger, ensure_ascii=False, indent=1))
    if contract and contract.get("id") == "adopted_strategy":
        text.append(_carry_forward_list(engine))
        meta["carry_ids"] = [r["message_id"] for r in engine.carry_forward_items()]
    if task["node_id"] == "issue_plan":
        text.append("structured.issues に、討論ノードのID（debate_target、debate_change、debate_promise）ごとの title、why、critics（役割IDを2〜5個）を書いてよい。書かなければ標準の争点と参加者を使う。")
    if note:
        text.append(f"前回の出力は次の理由で受理されなかった：{note}")
    text.append(OUTPUT_GUIDE)
    return "\n\n".join(t for t in text if t)


def _carry_forward_list(engine):
    required = engine.carry_forward_items()
    if not required:
        return ""
    rows = "\n".join(f"- {r['message_id']}（{r['kind']}）：{r['text']}" for r in required)
    return ("討論で残された未解決の異論と、修正しても残すべき長所は次のとおりである。"
            "それぞれを本文で扱い、structured.carried_forward に message_id と扱いを記録する。一つでも抜けると機械検査で拒否される。\n" + rows)


def _revise(engine, task, contract, meta):
    data = task["data"]
    defects = engine.open_defects(data["artifact_id"])
    meta["open_defects"] = [d["defect_id"] for d in defects if d["severity"] == "major"]
    rows = "\n".join(
        f"- {d['defect_id']}（{d['severity']}／{d['category']}／箇所 {d['location']}）：{d['reason']} 修正条件：{d['fix_condition']}"
        + (f"（同じ欠陥が {d['occurrences']} 回続いている）" if d["occurrences"] > 1 else "")
        for d in defects
    )
    lines = [
        "## 修正の依頼",
        f"成果物 {data['artifact_id']} の版 v{data['from_version']} は不合格だった。同じ指示を繰り返しても解消しないので、欠陥ごとに原因に応じて直す。"
        "語句の置き換えだけで済ませない。根拠が足りないなら主張を撤回または条件付きにする。根拠はあるが読み取れないだけなら文章を直し、同じ根拠を調べ直さない。",
        "解消すべき欠陥：\n" + rows,
    ]
    if data.get("strengths"):
        lines.append("検査で認められた長所。修正しても残すこと：\n" + json.dumps(data["strengths"], ensure_ascii=False))
    if contract and contract.get("id") == "adopted_strategy":
        lines.append(_carry_forward_list(engine))
        meta["carry_ids"] = [r["message_id"] for r in engine.carry_forward_items()]
    if data.get("diagnosis"):
        lines.append("原因診断の結果：\n" + data["diagnosis"])
    if data.get("retry_note"):
        lines.append(f"前回の出力は次の理由で受理されなかった：{data['retry_note']}")
    lines.append(OUTPUT_GUIDE)
    lines.append("出力は成果物の全文を返す。changes に欠陥IDごとの変更内容と解消した理由を書く。指摘が誤っていると考えるなら rebuttals に根拠を書く。")
    if contract:
        lines.append(render_contract(contract))
    return "\n\n".join(lines)


def _review(engine, task, contract, meta):
    data = task["data"]
    defects = engine.open_defects(data["artifact_id"])
    open_major = [d for d in defects if d["severity"] == "major"]
    meta["open_defects"] = [d["defect_id"] for d in open_major]
    meta["artifact_version"] = data["version"]
    lines = [
        "## 内容検査の依頼",
        f"成果物 {data['artifact_id']} の版 v{data['version']} を、下の品質契約で検査する。作成者の名前や討論の多数意見は渡していない。文章の整い方や長さではなく、次の担当がこれで判断できるかで判定する。",
        "主張が根拠に支えられるかを確かめる。参照先が存在することと、その参照先が主張を裏づけることは別である。機能の存在から成果へ飛躍していないか、対象が具体的か、一般論ではないかを見る。短くても必要な内容があれば合格にし、正当な条件付きの結論を断定が弱いという理由で落とさない。",
        "重大な欠陥（major）は、判断を誤らせるものだけにする。表現の好みや軽微な改善点は minor とする。すべての合否基準に判定を返し、未達には該当箇所と理由を書く。criterion には基準のID（例：LP-1）だけを書く。点数は付けない。"
        "欠陥の分類は次のとおりである：info_missing（情報不足）、inference_error（推論の誤り）、target_selection（対象選択の問題）、production_gap（制作不足）、cross_doc（成果物間の矛盾）、review_error（検査の誤り）。",
        render_contract(contract),
    ]
    if open_major:
        rows = "\n".join(f"- {d['defect_id']}（箇所 {d['location']}）：{d['reason']} 修正条件：{d['fix_condition']}" for d in open_major)
        lines.append("前の版で見つかった未解決の重大欠陥。それぞれが実際に解消したかを resolved_defects に返す。語句が変わっただけなら解消していない：\n" + rows)
    if data.get("changes"):
        lines.append("作成者が示した変更内容：\n" + json.dumps(data["changes"], ensure_ascii=False, indent=1))
    if data.get("rebuttals"):
        lines.append("作成者からの反証。指摘が誤っていたなら欠陥を撤回してよい（resolved を true、how に撤回の理由を書く）：\n" + json.dumps(data["rebuttals"], ensure_ascii=False, indent=1))
    if data.get("recheck_note"):
        lines.append("再確認の理由：" + data["recheck_note"])
    if data.get("second_check"):
        lines.append("前回の修正は変更量が少ないのに欠陥が解消したと判定された。実際に解消したかを別の担当として確かめる。")
    if data.get("retry_note"):
        lines.append(f"前回の検査結果は次の理由で受理されなかった：{data['retry_note']}")
    return "\n\n".join(lines)


def _critique(engine, task, contract, meta):
    issue = engine.debate.issue(task["data"]["issue_id"])
    proposals = json.loads(issue["proposal_artifacts"])
    meta["proposals"] = proposals
    meta["issue"] = issue["issue_id"]
    return "\n\n".join(p for p in [
        "## 相互批評の依頼",
        f"論点 {issue['issue_id']}：{issue['title']}\nなぜ検討するか：{issue['why']}",
        "宛先は提案者の役割、target_artifact は批評する案のIDにする。提案：" + json.dumps(proposals, ensure_ascii=False),
        "案の内容と論理を率直に評価する。弱い案には弱いと書き、誰のどの判断が成り立たないかを示す。良い点があれば対象と理由を示して認め、修正時に残すべき長所は keep_strength に書く。"
        "無理に批判も称賛も作らない。「素晴らしい」「駄目だ」だけの発言は受理されない。批判には重大度（major は判断を誤らせるものだけ）と論争の種類（fact：事実の不一致、inference：推論の不一致、criteria：判断基準の違い、info_missing：情報不足）を付ける。",
        task["data"].get("retry_note") and f"前回の発言は次の理由で受理されなかった：{task['data']['retry_note']}",
    ] if p)


def _respond(engine, task, contract, meta):
    data = task["data"]
    messages = engine.debate.messages_for_response(data["issue_id"], data["artifact"])
    meta["open_critiques"] = [m["message_id"] for m in messages if m["kind"] != "reevaluate"]
    meta["artifact"] = data["artifact"]
    meta["deliver"] = [m["message_id"] for m in messages]
    art = engine.store.latest_artifact(data["artifact"])
    owner = engine.store.latest_of_node(engine.store.owner(data["artifact"])["task_id"])
    owner_contract = engine.store.contract(owner["contract_id"], owner["contract_sha"])
    meta["contract"] = owner_contract
    body = "\n\n".join(render_message(m) for m in messages) or "（応答が必要な批判はない）"
    support = engine.debate.supports_for(data["issue_id"], data["artifact"])
    lines = [
        "## 批判への応答の依頼",
        f"あなたの案 {data['artifact']} の現在の版は v{art['version'] if art else '-'} である。次の発言は他のエージェントが実際に送った全文である。",
        body,
        "すべての発言に in_reply_to で答える。action は、受け入れて修正する（accept_revise）、条件を限定する（limit_condition）、根拠を示して反論する（counter）、撤回する（withdraw）、情報不足として保留する（hold_insufficient）のいずれかにする。「参考になる」で済ませない。"
        "accept_revise か limit_condition を選ぶときは revised_document に案の全文、revised_claims に主張、revised_structured に整理項目を返す。批判に従う理由がなければ根拠を示して反論してよい。修正で元の長所を失っていないかも確かめ、維持した長所を kept に書く。",
    ]
    if support:
        lines.append("参考として、同じ案への支持の発言：\n" + "\n\n".join(render_message(m) for m in support))
    lines.append("修正版の revised_document、revised_structured、revised_claims の書き方は次のとおりである。" + OUTPUT_GUIDE)
    lines.append("修正版は次の品質契約も満たす必要がある。\n" + render_contract(owner_contract))
    if data.get("retry_note"):
        lines.append(f"前回の応答は次の理由で受理されなかった：{data['retry_note']}")
    return "\n\n".join(lines)


def _reeval(engine, task, contract, meta):
    data = task["data"]
    pairs = engine.debate.pairs_for_reeval(data["issue_id"], task["role"], data["round"])
    meta["pairs"] = [{"critique": c["message_id"], "response": r["message_id"] if r else None} for c, r in pairs]
    meta["deliver"] = [r["message_id"] for _, r in pairs if r]
    rows = []
    for critique, response in pairs:
        rows.append("あなたの批判：\n" + render_message(critique))
        rows.append("提案者の応答：\n" + (render_message(response) if response else "（応答なし）"))
    lines = [
        "## 再評価の依頼",
        "提案者の応答と修正を読み、自分の批判ごとに、解消（resolved）、部分解消（partially_resolved）、未解消（unresolved）、撤回（withdrawn）のいずれかを理由つきで返す。相手の反論が正しければ自分の批判を撤回する。意見を変えることは敗北ではない。",
        "未解消とするなら、相手の応答のどこが足りないかを書き、new_basis に応答を読んだうえでの根拠を示す。同じ指摘の繰り返しは受理されない。in_reply_to には読んだ応答の発言ID、about_critique には自分の批判の発言IDを書く。",
        "\n\n".join(rows),
    ]
    if data.get("retry_note"):
        lines.append(f"前回の再評価は次の理由で受理されなかった：{data['retry_note']}")
    return "\n\n".join(lines)


def _decide(engine, task, contract, meta):
    outcomes = task["data"].get("outcomes") or []
    meta["outcomes"] = outcomes
    descriptions = task["data"].get("outcome_notes") or {}
    rows = "\n".join(f"- {o}：{descriptions.get(o, '')}" for o in outcomes)
    return "\n\n".join(p for p in [
        "## 判断の依頼",
        "branch に次のいずれかを返し、理由を書く。不足があれば gaps に、何が足りないか、なぜ判断に影響するか、取得できるかを書く。\n" + rows,
        task["data"].get("retry_note") and f"前回の出力は次の理由で受理されなかった：{task['data']['retry_note']}",
    ] if p)


def _crosscheck(engine, task, contract, meta):
    data = task["data"]
    meta["manifest"] = data.get("manifest")
    machine = data.get("machine_findings") or []
    flags = data.get("machine_flags") or []
    meta["flags"] = [f["flag_id"] for f in flags]
    rows = "\n".join(f"- {f['location']}：{f['reason']}" for f in machine) or "（構造上の欠陥の指摘なし。機械検査の通過は意味の整合を保証しない）"
    flag_rows = "\n".join(f"- {f['flag_id']}（{f['check']}、修正先 {f['fix_target']}）：{f['reason']}" for f in flags) or "（確認依頼なし）"
    return "\n\n".join(p for p in [
        "## 資料一式の横断検査",
        "渡された資料一式は版を固定している。各資料を原資料と比べる縦方向の検査と、資料同士を比べる横方向の検査の両方を行う。用語や語調の統一ではなく、同じ対象・条件について判断が一貫し、上流から下流への推論が成立するかを見る。",
        "確認する論理：調査→対象選定、課題→提供価値、比較→差別化、戦略→各媒体、機能・運用→表現、数値→別資料の数値、仮説→確定表現、説明→デモ、未確認事項→検証計画。",
        "資料ごとの対象や用途が異なるために表現が違うだけなら矛盾とせず、条件差として condition_difference に記録する。内容の異なる案を無理に同じ表現へそろえるよう求めない。新しい日付や親の意見だけで正しい側を決めない。",
        "機械検査が構造から見つけた欠陥（このまま重大な欠陥として扱われる）：\n" + rows,
        "機械検査からの確認依頼。文字列の比較で見つけた候補であり、言い方の違いだけのことがある。flag_rulings に、それぞれ確定（confirmed）か退ける（dismissed）かと理由を書く。確定したものは重大な欠陥として差し戻される：\n" + flag_rows,
        "欠陥には fix_target に修正する成果物のIDを書く。判断を変える飛躍、矛盾、根拠不在、条件の脱落だけを major とする。",
        data.get("retry_note") and f"前回の出力は次の理由で受理されなかった：{data['retry_note']}",
    ] if p)


def _diagnose(engine, task, contract, meta):
    data = task["data"]
    defects = engine.open_defects(data["artifact_id"])
    rows = "\n".join(f"- {d['defect_id']}（{d['category']}・{d['occurrences']}回）：{d['reason']}" for d in defects if d["severity"] == "major")
    return "\n\n".join([
        "## 原因診断の依頼",
        f"成果物 {data['artifact_id']} で同じ重大欠陥が続いている。単純な再生成をやめ、なぜ解消しなかったかを診断する。情報が足りないのか、推論が誤っているのか、対象の選び方が問題なのか、検査が誤っているのかを分ける。",
        rows,
        "route には、別の担当が書き直す（revise）、資料を追加調査する（research）、戦略へ戻す（strategy）、情報や実現条件が足りないので保留する（hold）のいずれかを返す。instructions には前回と異なる具体的な修正方法を書く。",
    ])
