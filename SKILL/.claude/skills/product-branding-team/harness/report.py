"""保存された状態から、確認画面と提出物を作る。

記録にないことを書き足さない。発言は保存された本文をそのまま出し、脚色しない。
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from difflib import unified_diff
from pathlib import Path

from .states import RUN_STATUS, TASK_STATES
from .store import atomic_write

FIFTY_NOTE = ("50人分の生産性は未検証である。役割の定義数、起動数、呼び出し数、成果物の数は、いずれも人間50人分の成果の証拠にならない。"
              "評価には、対象期間、対象業務、人間が行う場合の比較条件、必要な品質を決め、同じ範囲・品質の基準時間を実測する必要がある。")
MACHINE_NOTE = "機械検査の通過は、ID・版・数値の定義の整合を示すだけで、意味上の整合を保証しない。"


def mode_label(store):
    if store.get_meta("simulated"):
        return "模擬実行（実サブエージェントは起動していない。状態制御の確認であり、内容の品質や実接続の証拠にならない）"
    if store.get_meta("design_only"):
        return "設計のみ（実討論は実施していない）"
    return f"実エージェント（{store.get_meta('adapter')}）"


def capacity(store):
    """稼働指標を集計する。役割数、インスタンス数、同時実行数、呼び出し数、完了数を分ける。"""
    tasks = store.tasks()
    attempts = [dict(r) for r in store.db.execute("SELECT * FROM attempts")]
    instances = [dict(r) for r in store.db.execute("SELECT * FROM instances")]
    active_roles = sorted({i["role"] for i in instances if i["role"]})
    by_type = defaultdict(lambda: {"accepted": 0, "first_pass": 0, "items": 0, "rework": 0, "minutes_to_accept": []})
    for owner in store.db.execute("SELECT * FROM artifact_owner"):
        versions = [dict(r) for r in store.db.execute(
            "SELECT * FROM artifacts WHERE artifact_id=? ORDER BY version", (owner["artifact_id"],))]
        if not versions:
            continue
        stats = by_type[owner["artifact_type"] or "unknown"]
        stats["items"] += 1
        rejections = store.db.execute(
            "SELECT COUNT(*) c FROM reviews WHERE artifact_id=? AND gate_verdict='fail'", (owner["artifact_id"],)).fetchone()["c"]
        stats["rework"] += rejections
        if versions[-1]["status"] == "accepted":
            stats["accepted"] += 1
            if rejections == 0:
                stats["first_pass"] += 1
            stats["minutes_to_accept"].append(round((versions[-1]["created_at"] - versions[0]["created_at"]) / 60, 1))
    started, finished = store.get_meta("started_at"), store.get_meta("finished_at")
    costs = [a["cost_delta"] for a in attempts if a["cost_delta"] is not None]
    tokens_in = [a["tokens_in"] for a in attempts if a["tokens_in"] is not None]
    tokens_out = [a["tokens_out"] for a in attempts if a["tokens_out"] is not None]
    human = store.db.execute("SELECT COALESCE(SUM(minutes),0) m, COUNT(*) c FROM human_log").fetchone()
    return {
        "mode": mode_label(store),
        "roles_defined": store.get_meta("roles_defined", 0),
        "roles_activated": active_roles,
        "instances_started": len(instances),
        "instances_continued": sum(1 for i in instances if i["continuation_of"]),
        "peak_concurrency": store.get_meta("peak_concurrency", 0),
        "concurrency_limit": store.get_meta("settings", {}).get("concurrency"),
        "calls": len(attempts),
        "calls_by_status": dict(Counter(a["status"] for a in attempts)),
        "call_ceiling": store.budget().get("max_calls"),
        "ceiling_from_ledger": store.budget().get("ceiling_from_ledger"),
        "tasks_total": len(tasks),
        "tasks_by_state": dict(Counter(TASK_STATES[t["state"]] for t in tasks)),
        "by_artifact_type": {k: dict(v) for k, v in by_type.items()},
        "elapsed_minutes": round((finished - started) / 60, 1) if started and finished else None,
        "tokens_in": sum(tokens_in) if tokens_in else None,
        "tokens_out": sum(tokens_out) if tokens_out else None,
        "cost_usd_list_price": round(sum(costs), 4) if costs else None,
        "cost_basis": sorted({a["cost_basis"] for a in attempts if a["cost_basis"]}),
        "cost_note": "実行基盤が報告した API 定価換算の値である（costBasis=list）。定額プランの実際の請求額ではない。" if costs else "費用は取得できなかった",
        "human_minutes": human["m"] if human["c"] else None,
        "human_entries": human["c"],
        "fifty_person_status": "未検証",
        "fifty_person_note": FIFTY_NOTE,
    }


def replacement_estimate(store, baselines):
    """実測の基準時間がある作業種別に限って、代替できた時間の推定を出す。出力数に任意の時間を掛けない。"""
    cap = capacity(store)
    rows, total = [], 0.0
    for artifact_type, stats in cap["by_artifact_type"].items():
        baseline = (baselines or {}).get(artifact_type)
        if not baseline or not baseline.get("measured"):
            rows.append({"type": artifact_type, "accepted": stats["accepted"], "estimate_minutes": None, "reason": "実測の基準時間がない"})
            continue
        minutes = stats["accepted"] * float(baseline["minutes_per_item"])
        rows.append({"type": artifact_type, "accepted": stats["accepted"], "estimate_minutes": minutes, "basis": baseline.get("basis", "")})
        total += minutes
    human = cap["human_minutes"]
    return {"rows": rows, "gross_minutes": total, "human_minutes": human,
            "net_minutes": (total - human) if (human is not None and total) else None,
            "note": "同じ範囲・品質の完了作業に対応する基準時間の合計から人間の介入時間を差し引いた推定である。実測された前提に依存し、50人分の達成を示さない。AI費用は別に示す。",
            "cost": cap["cost_usd_list_price"]}


def status_text(store):
    """現在地と次にすることを短く示す。"""
    tasks = store.tasks()
    counts = Counter(TASK_STATES[t["state"]] for t in tasks)
    status = store.run_status()
    lines = [
        f"実行方式：{mode_label(store)}",
        f"対象：{(store.get_meta('brief') or {}).get('product', {}).get('name', '')}（提供段階 {(store.get_meta('brief') or {}).get('stage', '')}）",
        f"グラフ：{store.get_meta('graph_id')}",
        f"状態：{RUN_STATUS.get(status, status)}（{store.get_meta('status_reason', '')}）",
        "作業：" + "、".join(f"{k} {v}" for k, v in counts.items()),
        f"呼び出し：{store.calls_used()} / 上限 {store.budget().get('max_calls')}（台帳から算出した上限 {store.budget().get('ceiling_from_ledger')}）",
    ]
    ready = [t["task_id"] for t in tasks if t["state"] == "ready"][:8]
    running = [t["task_id"] for t in tasks if t["state"] == "running" and t["kind"] != "debate"]
    if running:
        lines.append("実行中：" + "、".join(running))
    if ready:
        lines.append("次に実行できる作業：" + "、".join(ready))
    holds = [f"{t['task_id']}（{t['note']}）" for t in tasks if t["state"] == "on_hold"]
    if holds:
        lines.append("保留：" + "；".join(holds))
    failed = [f"{t['task_id']}（{t['note']}）" for t in tasks if t["state"] == "failed"]
    if failed:
        lines.append("失敗：" + "；".join(failed[:8]))
    queued = store.db.execute("SELECT COUNT(*) c FROM messages WHERE delivery='queued'").fetchone()["c"]
    open_crit = store.db.execute("SELECT COUNT(*) c FROM messages WHERE kind='critique' AND severity='major' AND disposition IN ('open','answered','unresolved','partially_resolved')").fetchone()["c"]
    lines.append(f"未送達の発言：{queued} 件／未解決の重大な批判：{open_crit} 件")
    return "\n".join(lines)


def _table(headers, rows):
    def cell(value):
        return str("" if value is None else value).replace("|", "／").replace("\n", " ")
    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    out += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
    return "\n".join(out)


def task_board(store):
    rows = []
    for t in store.tasks():
        deps = ", ".join(d.get("node") or d.get("task") or "" for d in t["depends_on"])
        art = store.latest_artifact(t["output_artifact"]) if t["output_artifact"] else None
        rows.append([t["task_id"], t["kind"], t["role"], t["purpose"], deps, f"{t['output_artifact'] or ''}{' v' + str(art['version']) if art else ''}",
                     t["contract_id"], t["reviewer_role"], TASK_STATES[t["state"]], t["outcome"], t["calls_used"], t["revisions_used"], t["failure_policy"], t["note"]])
    return _table(["作業ID", "種類", "担当", "目的", "前提", "成果物と版", "品質契約", "検査担当", "状態", "結果", "呼び出し", "修正回数", "失敗時", "記録"], rows)


def quality_review(store):
    parts = []
    for r in store.db.execute("SELECT * FROM reviews ORDER BY rowid"):
        reasons = json.loads(r["gate_reasons"] or "[]")
        parts.append(f"### {r['review_id']}：{r['artifact_id']} v{r['version']}（{r['kind']}、検査 {r['reviewer']}）\n"
                     f"判定：検査担当 {r['verdict']} → ゲート {r['gate_verdict']}（記録の状態 {r['state']}）\n"
                     + ("理由：\n" + "\n".join(f"- {x}" for x in reasons) if reasons else ""))
    defects = [[d["defect_id"], d["artifact_id"], f"v{d['version']}", d["severity"], d["category"], d["location"], d["reason"], d["fix_condition"], d["occurrences"], d["state"], d["resolution"]]
               for d in store.db.execute("SELECT * FROM defects ORDER BY rowid")]
    return "\n\n".join(parts) + "\n\n## 欠陥の一覧\n\n" + _table(["欠陥", "成果物", "版", "重大度", "分類", "箇所", "理由", "修正条件", "回数", "状態", "解消の記録"], defects)


def rejection_trace(store):
    """不良成果物の投入、拒否、差し戻し先、修正版、再検査を同じ記録でたどる。"""
    keep = {"artifact_published", "artifact_rejected", "routed_to_revise", "routed_to_research", "routed_to_diagnosis", "review_recorded",
            "artifact_status", "defect_still_open", "injected_output", "suspicious_small_fix", "task_failed", "acceptance_invalidated",
            "bundle_rejected", "bundle_accepted", "artifact_reopened", "source_updated", "impact_analyzed", "recovered", "instance_continued"}
    rows = []
    for e in store.events():
        if e["type"] in keep:
            rows.append([e["seq"], e["type"], e["task_id"], e["attempt_id"], json.dumps(e["data"], ensure_ascii=False)[:300]])
    return _table(["順番", "出来事", "作業", "試行", "内容"], rows)


def evidence_register(store):
    ev = [[e["evidence_id"], e["kind"], e["source_id"] or e["url"], e["source_version"], e["locator"], e["quote"], e["retrieved_at"], e["verified"], e["state"]] for e in store.all_evidence()]
    claims = []
    for owner in store.db.execute("SELECT artifact_id FROM artifact_owner"):
        art = store.latest_artifact(owner["artifact_id"])
        if not art:
            continue
        for c in store.claims_of(art["artifact_id"], art["version"]):
            claims.append([f"{art['artifact_id']}#{c['local_id']}", f"v{art['version']}", c["type"], c["status"], c["text"], c["target_customer"], "；".join(c["conditions"] or []),
                           ",".join(c["evidence"] or []), json.dumps(c["derived_from"], ensure_ascii=False) if c["derived_from"] else ""])
    return ("## 根拠\n\n" + _table(["根拠", "種類", "出所", "資料の版", "箇所", "引用", "確認日", "機械確認", "状態"], ev)
            + "\n\n同じ資料を複数の担当が引用しても、独立した複数件の証拠としては数えない。引用の機械確認は、引用が資料に実在することだけを示し、主張を裏づけることを示さない。\n\n## 主張\n\n"
            + _table(["主張", "版", "種類", "確認状態", "内容", "対象", "成立条件", "根拠", "派生元"], claims))


def debate_log(store):
    parts = []
    for issue in store.db.execute("SELECT * FROM issues ORDER BY rowid"):
        parts.append(f"## 論点 {issue['issue_id']}：{issue['title']}\n\n{issue['why']}\n\n結果：{issue['outcome'] or '進行中'}（{issue['note'] or ''}）")
        for m in store.db.execute("SELECT * FROM messages WHERE issue_id=? ORDER BY rowid", (issue["issue_id"],)):
            head = (f"### {m['message_id']}　第{m['round']}巡　{m['from_role']}（{m['from_instance']}）→ {m['to_role']}　{m['kind']}"
                    f"{'・' + m['severity'] if m['severity'] else ''}")
            meta = [f"対象：{m['target_artifact']} v{m['target_version']}{' の ' + m['target_claim'] if m['target_claim'] else ''}"]
            if m["in_reply_to"]:
                meta.append(f"応答先：{m['in_reply_to']}")
            if m["about_critique"]:
                meta.append(f"批判：{m['about_critique']}")
            if m["new_version"]:
                meta.append(f"新しい版：v{m['new_version']}")
            meta.append(f"扱い：{m['disposition']}")
            meta.append(f"送達：{m['delivery']}（{m['delivered_attempt'] or '-'}）")
            meta.append(f"試行：{m['attempt_id']}／セッション：{m['session_id'] or '-'}{'／模擬' if m['simulated'] else ''}")
            extras = []
            for key, label in (("quote", "対象の引用"), ("reason", "理由"), ("requested_fix", "求める修正"), ("keep_strength", "残したい長所"), ("flips_if", "判断が変わる条件"), ("conditions", "条件・新しい根拠")):
                if m[key]:
                    extras.append(f"- {label}：{m[key]}")
            parts.append(f"{head}\n\n{'／'.join(meta)}\n\n{m['body']}\n\n" + "\n".join(extras))
    return "\n\n".join(parts) or "（相互討論は実施されていない）"


def session_state(store):
    instances = [[i["instance_id"], i["role"], i["state"], i["calls"], i["session_id"], i["continuation_of"]] for i in store.db.execute("SELECT * FROM instances ORDER BY rowid")]
    budget = store.budget()
    pending = [[m["message_id"], m["from_role"], m["to_role"], m["delivery"], m["disposition"]]
               for m in store.db.execute("SELECT * FROM messages WHERE delivery='queued' OR disposition IN ('open','unresolved','partially_resolved','external') ORDER BY rowid")]
    return "\n\n".join([
        status_text(store),
        "## エージェントの状態\n\n" + _table(["インスタンス", "役割", "状態", "呼び出し", "セッション", "引き継ぎ元"], instances),
        "## 実行上限\n\n" + "\n".join(f"- {k}：{v}" for k, v in budget.items()),
        "## 未送信・未応答の発言\n\n" + _table(["発言", "発言者", "宛先", "送達", "扱い"], pending),
        "## 再開の方法\n\n`python pbteam.py run --run-dir <このフォルダー>` で続きから進む。完了した作業は再実行しない。",
    ])


def cross_document(store):
    parts = []
    for b in store.db.execute("SELECT * FROM bundles ORDER BY rowid"):
        parts.append(f"一式 {b['bundle_id']}（{b['state']}）：" + ", ".join(f"{m['artifact_id']} v{m['version']}" for m in json.loads(b["manifest"])))
    last = store.get_meta("crossdoc_last")
    if last:
        parts.append(MACHINE_NOTE)
        parts.append("## 最後の横断検査\n\n対象の版：" + ", ".join(f"{m['artifact_id']} v{m['version']}" for m in last["manifest"]))
        parts.append("### 機械検査（構造上の欠陥）\n\n" + (_table(["検査", "箇所", "理由", "修正先"], [[f.get("check"), f.get("location"), f.get("reason"), f.get("fix_target")] for f in last["machine"]]) if last["machine"] else "指摘なし"))
        rulings = {r.get("flag_id"): r for r in last["payload"].get("flag_rulings") or []}
        flag_rows = [[f.get("flag_id"), f.get("check"), f.get("reason"), (rulings.get(f.get("flag_id")) or {}).get("ruling"), (rulings.get(f.get("flag_id")) or {}).get("reason")] for f in last.get("flags") or []]
        parts.append("### 機械検査からの確認依頼と内容検査の判断\n\n" + (_table(["依頼", "検査", "内容", "判断", "理由"], flag_rows) if flag_rows else "確認依頼なし"))
        payload = last["payload"]
        parts.append("### 縦方向（原資料との比較）\n\n" + _table(["資料", "結果", "内容"], [[v.get("artifact_id"), v.get("result"), v.get("note")] for v in payload.get("vertical", [])]))
        parts.append("### 横方向（資料同士の比較）\n\n" + _table(["組み合わせ", "結果", "内容"], [[h.get("pair"), h.get("result"), h.get("note")] for h in payload.get("horizontal", [])]))
        parts.append("### 欠陥\n\n" + _table(["重大度", "種類", "箇所", "理由", "修正条件", "修正先"], [[d.get("severity"), d.get("check_type"), d.get("location"), d.get("reason"), d.get("fix_condition"), d.get("fix_target")] for d in payload.get("defects", [])]))
    events = [[e["seq"], e["type"], e["task_id"], json.dumps(e["data"], ensure_ascii=False)[:200]] for e in store.events() if e["type"] in {"bundle_prepared", "bundle_rejected", "bundle_accepted", "bundle_invalidated"}]
    parts.append("## 修正・再検査の記録\n\n" + _table(["順番", "出来事", "作業", "内容"], events))
    return "\n\n".join(parts)


def _doc(store, artifact_id):
    art = store.latest_artifact(artifact_id)
    return (art, store.read_artifact(art)) if art else (None, None)


def _section_of(store, artifact_ids, missing_note):
    parts = []
    for artifact_id in artifact_ids:
        art, text = _doc(store, artifact_id)
        if art:
            state = {"accepted": "合格", "rejected": "不合格", "draft": "未検査", "invalidated": "再確認待ち", "on_hold": "保留"}.get(art["status"], art["status"])
            parts.append(f"**{artifact_id} v{art['version']}（{state}／{art['delivery_class'] or '-'}）**\n\n{text}")
    return "\n\n".join(parts) or missing_note


def artifacts_of_type(store, artifact_type):
    return [r["artifact_id"] for r in store.db.execute("SELECT artifact_id FROM artifact_owner WHERE artifact_type=?", (artifact_type,))]


def proposal_diffs(store):
    parts = []
    for owner in store.db.execute("SELECT artifact_id FROM artifact_owner"):
        versions = [dict(r) for r in store.db.execute("SELECT * FROM artifacts WHERE artifact_id=? ORDER BY version", (owner["artifact_id"],))]
        for old, new in zip(versions, versions[1:]):
            diff = list(unified_diff(store.read_artifact(old).splitlines(), store.read_artifact(new).splitlines(),
                                     f"v{old['version']}", f"v{new['version']}", lineterm="", n=0))
            parts.append(f"### {owner['artifact_id']} v{old['version']} → v{new['version']}\n\n```diff\n" + "\n".join(diff[:120]) + "\n```")
    return "\n\n".join(parts) or "（版の変更はない）"


def brand_proposal(store):
    """依頼書の20シートを、保存された成果物と記録から作る。無いものは未実施と書く。"""
    brief = store.get_meta("brief") or {}
    not_done = "未実施（この実行の作業に含まれない、または完了していない）"
    strategy = artifacts_of_type(store, "adopted_strategy")
    customers = artifacts_of_type(store, "customer_analysis")
    comparisons = artifacts_of_type(store, "competitive_comparison")
    candidates = artifacts_of_type(store, "brand_strategy")
    products = [a for t in ("landing_page", "sales_script", "demo_scenario", "faq", "case_study", "visual_direction", "short_intro") for a in artifacts_of_type(store, t)]
    cap = capacity(store)
    customer_ev = [e for e in store.all_evidence() if e["kind"] in {"customer_statement", "customer_behavior"}]
    ai_msgs = [m for m in store.db.execute("SELECT * FROM messages WHERE kind IN ('support','critique') ORDER BY rowid")]
    unknowns = []
    for owner in store.db.execute("SELECT artifact_id FROM artifact_owner"):
        art = store.latest_artifact(owner["artifact_id"])
        if art:
            for u in json.loads(art["unknowns"] or "[]"):
                unknowns.append(f"- {owner['artifact_id']}：{u.get('question')}（{u.get('why_it_matters', '')}）")
    open_crit = [f"- {m['message_id']}（{m['from_role']}）：{m['body']}" for m in store.db.execute(
        "SELECT * FROM messages WHERE kind='critique' AND severity='major' AND disposition IN ('open','answered','unresolved','partially_resolved','external') ORDER BY rowid")]
    holds = [f"- {t['task_id']}：{t['note']}" for t in store.tasks() if t["state"] in {"on_hold", "failed", "out_of_scope"}]
    handoffs = []
    for owner in store.db.execute("SELECT artifact_id FROM artifact_owner"):
        art = store.latest_artifact(owner["artifact_id"])
        if art:
            for h in json.loads(art["handoffs"] or "[]"):
                handoffs.append([owner["artifact_id"], h.get("to"), h.get("customer_value"), h.get("gap"), h.get("acceptance")])
    rounds = [[i["issue_id"], i["round"], i["max_rounds"], i["outcome"], i["note"]] for i in store.db.execute("SELECT * FROM issues")]
    failures = [[e["type"], e["task_id"], json.dumps(e["data"], ensure_ascii=False)[:200]] for e in store.events() if e["type"] in {"role_not_performed", "agent_failure", "attempt_interrupted", "late_result_discarded", "instance_continued"}]
    roles_na = store.get_meta("roles_not_activated", {})
    sheets = [
        ("1. 対象と今回の検討目的", f"対象：{brief.get('product', {}).get('name')}（{brief.get('product', {}).get('type', '')}、提供段階 {brief.get('stage')}）\n\n検討目的：{brief.get('goal')}\n\nきっかけ：{brief.get('trigger', '未確認')}\n\n判断する人：{brief.get('decision_maker', '未確認')}\n\n制約：{'；'.join(brief.get('constraints', [])) or 'なし'}"),
        ("2. 優先する顧客、関係者の役割、選択の場面", _section_of(store, customers, not_done)),
        ("3. 顧客の課題・望む状態と確認状況", "シート2の顧客分析と、シート7の確認状態を参照する。" if customers else not_done),
        ("4. 現在の認識と目指す認識", _section_of(store, strategy, not_done)),
        ("5. 代替手段と選択理由の比較表", _section_of(store, comparisons, not_done)),
        ("6. ブランドの仮説文と選定理由", "シート4の採用案に記載している。" if strategy else not_done),
        ("7. 主張・根拠・提供条件の対応表", evidence_register(store)),
        ("8. 顧客向けの短い説明と30秒程度の説明", _section_of(store, artifacts_of_type(store, "short_intro"), not_done)),
        ("9. 接点と利用体験の対応表、改善課題", _section_of(store, artifacts_of_type(store, "touchpoint_matrix"), not_done)),
        ("10. 実際の反応、AIの解釈、伝え方の修正点", "### 資料にある実際の顧客の反応\n\n" + ("\n".join(f"- {e['evidence_id']}：{e['quote']}" for e in customer_ev) or "資料になし。顧客確認は未実施である。") + f"\n\n### AIの解釈\n\nAIエージェントの評価は {len(ai_msgs)} 件あり、シート13に記録している。実際の顧客の理解確認の代わりにならない。"),
        ("11. 30日間の検証計画と判断基準", _section_of(store, artifacts_of_type(store, "validation_plan"), not_done)),
        ("12. 未確認事項、意見の相違、保留事項、未実施工程", "### 未確認事項\n\n" + ("\n".join(unknowns) or "記録なし") + "\n\n### 意見の相違（未解決の重大な批判）\n\n" + ("\n".join(open_crit) or "なし") + "\n\n### 保留・失敗・対象外\n\n" + ("\n".join(holds) or "なし")),
        ("13. 実際の相互討論の記録", debate_log(store)),
        ("14. 批判前後の案の差分と、変更・維持・撤回の理由", proposal_diffs(store)),
        ("15. 採用しなかった案の長所と棄却理由、少数意見、推奨を変更すべき条件", ("シート4の採用案に記載している。候補の全文：\n\n" + _section_of(store, candidates, not_done)) if strategy else _section_of(store, candidates, not_done)),
        ("16. 実際に起動した役割、実行した巡、失敗や未実施、終了理由",
         f"起動した役割：{', '.join(cap['roles_activated']) or 'なし'}（定義 {cap['roles_defined']} 役割、起動インスタンス {cap['instances_started']}）\n\n"
         + "### 巡\n\n" + _table(["論点", "実行した巡", "上限", "結果", "理由"], rounds)
         + "\n\n### 起動しなかった役割\n\n" + (_table(["役割", "理由"], list(roles_na.items())) if roles_na else "なし")
         + "\n\n### 失敗や未実施\n\n" + (_table(["出来事", "作業", "内容"], failures) if failures else "なし")
         + f"\n\n### 終了理由\n\n{RUN_STATUS.get(store.run_status(), store.run_status())}：{store.get_meta('status_reason', '')}"),
        ("17. 依頼範囲の制作物", _section_of(store, products, not_done)),
        ("18. 作業台帳と検査結果", task_board(store) + "\n\n" + quality_review(store)),
        ("19. 稼働実績と人間の介入", json_block(cap)),
        ("20. 他業務への引き渡し事項", _table(["成果物", "引き渡し先", "根拠となる顧客価値", "現状との差", "受入条件"], handoffs) if handoffs else "記録なし"),
    ]
    head = f"# ブランド提案：{brief.get('product', {}).get('name')}\n\n実行方式：{mode_label(store)}\n\n完成した内容はブランドの仮説であり、チーム内の合意やAIの評価で需要や差別化が検証されたものではない。\n"
    return head + "\n\n".join(f"## {title}\n\n{body}" for title, body in sheets) + "\n"


def json_block(obj):
    return "```json\n" + json.dumps(obj, ensure_ascii=False, indent=1) + "\n```"


def one_page(store):
    """要点の1ページ。未確認状態と提供条件を消さない。"""
    brief = store.get_meta("brief") or {}
    status = store.run_status()
    strategy = artifacts_of_type(store, "adopted_strategy")
    lines = [
        f"# 要点：{brief.get('product', {}).get('name')}",
        f"実行方式：{mode_label(store)}",
        f"終了状態：{RUN_STATUS.get(status, status)}（{store.get_meta('status_reason', '')}）",
        "完成した内容はブランドの仮説である。チーム内の合意やAIの評価で需要や差別化が検証されたものではない。",
    ]
    if strategy:
        art = store.latest_artifact(strategy[0])
        if art:
            structured = json.loads(art["structured"] or "{}")
            lines.append(f"## 採用した仮説（v{art['version']}）\n\n優先対象：{structured.get('target')}\n\n提供価値：{structured.get('value')}\n\n判断を変える条件：{structured.get('flips_if')}")
            confirmed, unconfirmed = [], []
            for c in store.claims_of(art["artifact_id"], art["version"]):
                conditions = "；".join(c["conditions"] or [])
                row = f"- {c['text']}" + (f"（条件：{conditions}）" if conditions else "")
                (confirmed if c["status"] == "confirmed" else unconfirmed).append(f"{row}［{c['status']}］")
            lines.append("## 確認済みの主張\n\n" + ("\n".join(confirmed) or "なし"))
            lines.append("## 未確認のまま残っている主張\n\n" + ("\n".join(unconfirmed) or "なし"))
    open_crit = [f"- {m['message_id']}（{m['from_role']}）：{m['body']}" for m in store.db.execute(
        "SELECT * FROM messages WHERE kind='critique' AND severity='major' AND disposition IN ('open','answered','unresolved','partially_resolved','external') ORDER BY rowid")]
    lines.append("## 残る異論\n\n" + ("\n".join(open_crit) or "記録された未解決の重大な批判はない"))
    cap = capacity(store)
    lines.append(f"## 稼働\n\n定義 {cap['roles_defined']} 役割／起動した役割 {len(cap['roles_activated'])}／インスタンス {cap['instances_started']}／最大同時実行 {cap['peak_concurrency']}／呼び出し {cap['calls']}／完了した作業 {cap['tasks_by_state'].get('完了', 0)}\n\n{FIFTY_NOTE}")
    lines.append("根拠と計画の詳細は brand-proposal.md を参照する。")
    return "\n\n".join(lines) + "\n"


def export(store, outdir=None):
    out = Path(outdir) if outdir else store.run_dir / "output"
    files = {
        "summary.md": one_page(store),
        "brand-proposal.md": brand_proposal(store),
        "task-board.md": "# 作業台帳\n\n" + task_board(store) + "\n",
        "quality-review.md": "# 検査結果\n\n" + quality_review(store) + "\n",
        "cross-document-review.md": "# 資料横断の検査\n\n" + cross_document(store) + "\n",
        "evidence-register.md": "# 主張と根拠の対応\n\n" + evidence_register(store) + "\n",
        "debate-log.md": "# 相互討論の記録\n\n" + mode_label(store) + "\n\n" + debate_log(store) + "\n",
        "session-state.md": "# 実行の状態\n\n" + session_state(store) + "\n",
        "capacity.md": "# 稼働実績\n\n" + json_block(capacity(store)) + "\n\n" + FIFTY_NOTE + "\n",
        "rejection-trace.md": "# 拒否と修正の経路\n\n" + rejection_trace(store) + "\n",
    }
    for name, text in files.items():
        atomic_write(out / name, text)
    return out, sorted(files)
