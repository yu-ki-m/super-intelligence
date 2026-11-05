#!/usr/bin/env python3
"""グラフ定義を生成する。定義の正本はこのスクリプトと roles.json であり、生成物を手で直さない。

使い方：python graphs/build_graphs.py
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVID = [{"kind": "sources"}, {"kind": "evidence"}]


def art(*ids):
    return [{"kind": "artifact", "id": i} for i in ids]


def work(node_id, role, output, contract, reviewer, purpose, instructions, inputs, **extra):
    node = {
        "id": node_id, "kind": "work", "role": role, "output": output, "contract": contract, "reviewer": reviewer,
        "purpose": purpose, "instructions": instructions, "inputs": inputs,
        "input_type": [i.get("id", i["kind"]) for i in inputs], "output_type": contract,
        "start_condition": "必須の入力がすべて合格している", "end_condition": "別担当の検査とハーネスの判定で合格している",
        "budget": {"calls": 6}, "retry": {"same_failure": 1, "on_exhausted": "fail"},
    }
    node.update(extra)
    return node


def terminals():
    return [
        {"id": "T_complete", "kind": "terminal", "status": "contract_met", "label": "品質契約充足または仮説案の契約充足"},
        {"id": "T_hold", "kind": "terminal", "status": "on_hold_missing_info", "label": "資料不足による保留"},
        {"id": "T_budget", "kind": "terminal", "status": "budget_unmet", "label": "予算上限による未達"},
        {"id": "T_failed", "kind": "terminal", "status": "execution_failed", "label": "実行失敗"},
        {"id": "T_abort", "kind": "terminal", "status": "aborted", "label": "中止"},
    ]


# どのノードからも、ハーネスが次の条件で未達の終了へ移す。完成ノードへは接続しない。
EXITS = [
    {"when": "全体の呼び出し上限に到達、または修正・循環の上限に到達", "to": "T_budget"},
    {"when": "必須の成果物が保留で、外部の情報なしには進めない", "to": "T_hold"},
    {"when": "エージェントの失敗が再試行後も解消しない", "to": "T_failed"},
    {"when": "依頼者の中止指示", "to": "T_abort"},
]


def req(src, dst, outcomes=None, optional=False):
    edge = {"from": src, "to": dst, "type": "requires"}
    if outcomes:
        edge["outcomes"] = outcomes
    if optional:
        edge["optional"] = True
    return edge


def on(src, dst, when, **extra):
    return {"from": src, "to": dst, "type": "on", "when": when, **extra}


GATE_NOTES = {
    "sufficient": "候補を作る判断に必要な情報がそろっている",
    "obtainable": "判断に必要な情報が不足しているが、渡された資料や公開情報から取得できる",
    "unobtainable": "判断に必要な情報が不足し、ここでは取得できない。仮説の範囲に限定して進める",
}
SELECT_INSTR = "相互批評の結果を読み、暫定案を選ぶ。選定理由、採用しなかった案の長所と棄却理由、少数意見、推奨を変更すべき条件を書く。調査の結果と、提供可能性や事業上の優先順位による意思決定を区別する。"


def minimal_graph():
    """一つの利用場面について、調査から提出までをつなぐ最小の実行系。"""
    nodes = [
        work("evidence", "G03", "evidence_register", "evidence_register", "V01",
             "資料を根拠として参照できる形に整理する",
             "渡された資料から、判断に使える事実・顧客の発言を引用で取り出し new_evidence に登録する。資料から分からないことは未確認事項に書く。", EVID, priority=90),
        work("customer", "C02", "customer_analysis", "customer_analysis", "V01",
             "利用者の業務と困りごとを整理し、対象の優先順位を判断できるようにする",
             "資料から、誰のどの業務・状況で何が負担になっているか、現在どう対処しているかを整理する。利用者、購入決定者、導入関係者の判断の違いも書く。", EVID + art("evidence_register")),
        work("alternatives", "M03", "alternatives", "competitive_comparison", "V03",
             "現状維持や手作業を含む代替手段を比較する",
             "競合製品だけでなく、手作業、内製、現状維持を同じ観点で比較する。自社が不利な条件と変更負担も書く。未確認の特徴は未確認と書く。", EVID + art("evidence_register")),
        work("product", "P04", "product_facts", "product_fact_sheet", "V05",
             "製品で確認できる能力と、価値が生じる操作と運用を整理する",
             "現在の機能と開発予定を分け、価値が生じるために人が行う操作と運用の条件を書く。", EVID + art("evidence_register")),
        {"id": "info_gate", "kind": "decide", "role": "G03", "outcomes": ["sufficient", "obtainable", "unobtainable"], "outcome_notes": GATE_NOTES,
         "purpose": "候補を作る判断に必要な情報がそろっているかを判断する", "instructions": "顧客分析、代替比較、製品の整理を読み、候補の比較に必要な情報の有無を判断する。",
         "inputs": EVID + art("customer_analysis", "alternatives", "product_facts"), "budget": {"calls": 2}, "retry": {"same_failure": 1}, "max_iterations": 3, "priority": 70},
        work("research", "G03", "research_note", "research_note", "V01", "不足資料を追加で調査する",
             "判断ノードが示した不足について、渡された資料を確かめ直す。取得できなければ取得できないと書く。", EVID, activation="on_edge", review_mode="machine", priority=70),
        work("cand_a", "B08", "candidate_a", "brand_strategy", "V06", "ブランドの仮説の候補を独立して作る",
             "顧客分析、代替比較、製品の整理に基づき、対象と提供価値を定めた候補を一つ作る。他の担当の案は見せていない。提供価値は機能の働きと人の行動を介して説明する。優先する対象は、課題の切実さ、提供できる価値、根拠の強さを理由に選ぶ。",
             EVID + art("customer_analysis", "alternatives", "product_facts"), isolation_group="strategy", review_mode="machine", priority=60),
        work("cand_b", "B08", "candidate_b", "brand_strategy", "V06", "別の対象または価値に基づく候補を独立して作る",
             "顧客分析、代替比較、製品の整理に基づき、候補を一つ作る。他の担当の案は見せていない。資料から読み取れる二番目に有力な対象または価値を優先し、言葉だけを変えた案にしない。",
             EVID + art("customer_analysis", "alternatives", "product_facts"), isolation_group="strategy", review_mode="machine", priority=60),
        {"id": "debate_strategy", "kind": "debate", "title": "現在の方法から変える理由は十分か、その約束を提供できるか",
         "why": "変更する理由が弱いまま制作へ進むと、説明を理解されても選ばれない。提供できない約束は、利用開始後の期待との不一致になる",
         "proposers": [{"artifact": "candidate_a", "role": "B08"}, {"artifact": "candidate_b", "role": "B08"}],
         "critics": ["V03", "P04"], "max_rounds": 3, "budget": {"calls": 18}, "retry": {"same_failure": 1},
         "inputs": art("customer_analysis", "alternatives", "product_facts"), "priority": 60},
        work("select", "G01", "adopted_strategy", "adopted_strategy", "V06", "暫定案を選び、選定理由と残る異論を記録する", SELECT_INSTR,
             EVID + [{"kind": "artifact", "id": "candidate_a", "state": "latest"}, {"kind": "artifact", "id": "candidate_b", "state": "latest"}] + art("customer_analysis", "alternatives", "product_facts"), priority=55),
        work("intro_page", "D02", "intro_page", "landing_page", "V05", "採用された戦略から紹介ページの本文案を作る",
             "採用された戦略の対象・約束・提供条件を保ち、紹介ページの本文を完成した草案として書く。具体的な利用場面、根拠、提供条件、次の行動を含める。実績がなければ実績を書かない。主張には戦略の主張を derived_from で記録する。",
             EVID + art("adopted_strategy", "product_facts"), deliverable="紹介ページ", priority=50),
        work("validation_plan", "V07", "validation_plan", "validation_plan", "V08", "未確認の主張を30日間の確認計画へ変換する",
             "未確認の主張のうち、誤りが判断を変えるものを選び、確認する仮説と観察方法を対応させる。実行はしない。",
             EVID + art("adopted_strategy", "customer_analysis", "alternatives"), deliverable="検証計画", priority=50),
        {"id": "final_check", "kind": "crosscheck", "role": "V08", "outcomes": ["accepted", "inconsistent"],
         "artifacts": ["customer_analysis", "alternatives", "product_facts", "adopted_strategy", "intro_page", "validation_plan"],
         "purpose": "資料一式の縦と横の論理を検査する", "budget": {"calls": 3}, "retry": {"same_failure": 1}, "max_iterations": 2, "priority": 45},
    ] + terminals()
    edges = [
        req("evidence", "customer"), req("evidence", "alternatives"), req("evidence", "product"),
        req("customer", "info_gate"), req("alternatives", "info_gate"), req("product", "info_gate"),
        on("info_gate", "research", ["obtainable"], max_traversals=1, on_limit_outcome="unobtainable"),
        on("research", "info_gate", ["accepted"], max_traversals=1, on_limit_outcome=None),
        req("info_gate", "cand_a", ["sufficient", "unobtainable"]), req("info_gate", "cand_b", ["sufficient", "unobtainable"]),
        req("cand_a", "debate_strategy"), req("cand_b", "debate_strategy"),
        req("debate_strategy", "select"),
        req("select", "intro_page"), req("select", "validation_plan"),
        req("intro_page", "final_check"), req("validation_plan", "final_check"),
        on("final_check", "T_complete", ["accepted"]),
        on("final_check", "final_check", ["inconsistent"], max_traversals=2, on_limit_terminal="budget_unmet"),
    ]
    return {"graph_id": "minimal", "version": "1.0", "description": "一つの利用場面について調査から提出までをつなぐ最小の実行系", "nodes": nodes, "edges": edges, "exits": EXITS}


def standard_graph():
    """50役割を成果物と依存関係で結ぶ標準グラフ。全ノードの起動を前提にせず、依頼範囲で絞り込む。"""
    roles = {r["id"]: r for r in json.loads((HERE / "roles.json").read_text(encoding="utf-8"))["roles"]}
    nodes, edges = [], []

    def role_node(role_id, node_id=None, output=None, inputs=None, purpose=None, instructions=None, **extra):
        role = roles[role_id]
        node_id = node_id or role_id
        output = output or role_id.lower()
        node = work(node_id, role_id, output, role["artifact_type"], role["reviewer"],
                    purpose or f"{role['name']}：{role['deliverable']}を提出する", instructions or role["work"],
                    inputs if inputs is not None else EVID + art("evidence_register"), **extra)
        if role.get("stages"):
            node["stages"] = role["stages"]
        if role.get("deliverable_tag"):
            node["deliverable"] = role["deliverable_tag"]
        nodes.append(node)
        return node

    role_node("G03", "evidence", "evidence_register", EVID, priority=95,
              instructions="渡された資料から、判断に使える事実・顧客の発言を引用で取り出し new_evidence に登録する。資料から分からないことは未確認事項に書く。")
    role_node("G02", "work_plan", "work_plan", EVID + art("evidence_register"), priority=92,
              purpose="今回の依頼範囲で実施する仕事と実施しない仕事を判断する",
              instructions="依頼の目的と資料から、競合別の分割や追加調査が必要かを判断し、必要なら requested_tasks で申請する。実施しない役割があれば理由を書く。")
    edges.append(req("evidence", "work_plan"))
    edges.append(req("work_plan", "info_gate", optional=True))

    required_for_gate = {"C02", "C03", "M03", "P01", "P04"}
    research = ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "M01", "M02", "M03", "M04", "M05", "M06", "M07", "P01", "P02", "P03", "P04", "P05", "P06", "P07"]
    for role_id in research:
        role_node(role_id, priority=80)
        edges.append(req("evidence", role_id))
        edges.append(req(role_id, "info_gate", optional=role_id not in required_for_gate))

    research_outputs = [r.lower() for r in research]
    nodes.append({"id": "info_gate", "kind": "decide", "role": "G03", "outcomes": ["sufficient", "obtainable", "unobtainable"], "outcome_notes": GATE_NOTES,
                  "purpose": "候補を作る判断に必要な情報がそろっているかを判断する", "instructions": "各担当の調査を読み、候補の比較に必要な情報の有無を判断する。",
                  "inputs": EVID + art(*research_outputs), "budget": {"calls": 2}, "retry": {"same_failure": 1}, "max_iterations": 3, "priority": 75})
    role_node("G03", "research", "research_note", EVID, purpose="不足資料を追加で調査する", instructions="判断ノードが示した不足について資料を確かめ直す。取得できなければ取得できないと書く。",
              activation="on_edge", review_mode="machine", priority=75)
    nodes[-1]["contract"] = "research_note"
    edges.append(on("info_gate", "research", ["obtainable"], max_traversals=1, on_limit_outcome="unobtainable"))
    edges.append(on("research", "info_gate", ["accepted"], max_traversals=1))

    strategy_inputs = {
        "B01": ["c01", "c02", "c03", "m03", "p04"], "B02": ["c02", "p01", "p02", "p04"], "B03": ["c02", "m03", "m07"],
        "B04": ["p01", "p04", "p05", "p06", "p07"], "B05": ["c05", "m04"], "B06": [], "B07": ["c05", "m06"],
    }
    for role_id, inputs in strategy_inputs.items():
        role_node(role_id, inputs=EVID + art(*inputs), priority=70)
        edges.append(req("info_gate", role_id, ["sufficient", "unobtainable"]))
    candidate_inputs = EVID + art("b01", "b02", "b03", "b04", "b05", "b06", "b07", "c02", "c03", "m03", "p04")
    for suffix, text in (("a", "対象と提供価値を定めた候補を一つ作る。"), ("b", "資料から読み取れる二番目に有力な対象または価値を優先した候補を一つ作る。言葉だけを変えた案にしない。")):
        role_node("B08", f"cand_{suffix}", f"candidate_{suffix}", candidate_inputs, purpose="ブランドの仮説の候補を独立して作る",
                  instructions=text + "他の担当の案は見せていない。提供価値は機能の働きと人の行動を介して説明する。", isolation_group="strategy", review_mode="machine", priority=65)
        for role_id in strategy_inputs:
            edges.append(req(role_id, f"cand_{suffix}", optional=role_id == "B06"))
    proposers = [{"artifact": "candidate_a", "role": "B08"}, {"artifact": "candidate_b", "role": "B08"}]
    role_node("G04", "issue_plan", "issue_plan", EVID + [{"kind": "artifact", "id": "candidate_a", "state": "latest"}, {"kind": "artifact", "id": "candidate_b", "state": "latest"}], purpose="候補の違いから争点と参加者を決める", priority=63)
    edges += [req("cand_a", "issue_plan"), req("cand_b", "issue_plan")]
    debates = [
        ("debate_target", "誰を優先するか", "対象が定まらないと、製品の特徴がその人にとって価値になるかを判断できない", ["C01", "C03", "V06"]),
        ("debate_change", "現在の方法から変える理由は十分か", "説明を理解されても、変える理由がなければ選ばれない", ["V03", "M03", "M07"]),
        ("debate_promise", "その約束を提供できるか", "提供できない約束は利用開始後の期待との不一致になる", ["P04", "V05", "V02"]),
    ]
    previous = "issue_plan"
    for debate_id, title, why, critics in debates:
        nodes.append({"id": debate_id, "kind": "debate", "title": title, "why": why, "proposers": proposers, "critics": critics, "max_rounds": 3,
                      "budget": {"calls": 24}, "retry": {"same_failure": 1}, "inputs": art("c02", "m03", "p04"), "priority": 60})
        edges.append(req(previous, debate_id))
        previous = debate_id
    role_node("V06", "compare", "candidate_comparison", EVID + [{"kind": "artifact", "id": "candidate_a", "state": "latest"}, {"kind": "artifact", "id": "candidate_b", "state": "latest"}],
              purpose="共通の基準で候補を比較する", instructions=roles["V06"]["work"], priority=58)
    nodes[-1]["reviewer"] = "V08"
    edges.append(req(previous, "compare"))
    role_node("G01", "select", "adopted_strategy", EVID + [{"kind": "artifact", "id": "candidate_a", "state": "latest"}, {"kind": "artifact", "id": "candidate_b", "state": "latest"}] + art("candidate_comparison", "c02", "m03", "p04"),
              purpose="暫定案を選び、選定理由と残る異論を記録する", instructions=SELECT_INSTR, priority=56)
    edges.append(req("compare", "select"))
    nodes.append({"id": "debate_integration", "kind": "debate", "title": "統合した暫定案に異論や反映漏れはないか", "why": "親の案や統合結果も批判の対象である。少数意見や元の長所が統合で消えると、次の工程で同じ誤りが起こる",
                  "proposers": [{"artifact": "adopted_strategy", "role": "G01"}], "critics": ["B03", "V02"], "max_rounds": 2, "budget": {"calls": 10}, "retry": {"same_failure": 1},
                  "inputs": [{"kind": "artifact", "id": "candidate_a", "state": "latest"}, {"kind": "artifact", "id": "candidate_b", "state": "latest"}], "priority": 54})
    edges.append(req("select", "debate_integration"))

    product_inputs = {
        "D01": ["adopted_strategy", "p01", "p04"], "D02": ["adopted_strategy", "p01", "p03", "p04"], "D03": ["adopted_strategy", "c03", "m07"],
        "D04": ["adopted_strategy", "p03", "p04"], "D05": ["adopted_strategy", "c05"], "D06": ["adopted_strategy", "p01", "p03", "p05", "p06"], "D07": ["adopted_strategy", "b05", "b07"],
    }
    for role_id, inputs in product_inputs.items():
        role_node(role_id, inputs=EVID + art(*inputs), priority=50)
        edges.append(req("debate_integration", role_id))
    role_node("D08", inputs=EVID + art("adopted_strategy", "d01", "d02", "d03", "d04", "d06"), priority=48)
    for role_id in ("D01", "D02", "D03", "D04", "D06"):
        edges.append(req(role_id, "D08", optional=True))
    edges.append(req("debate_integration", "D08"))

    media = ["d01", "d02", "d03", "d04", "d05", "d06", "d07", "d08"]
    for role_id in ("V01", "V02", "V03", "V04", "V05"):
        role_node(role_id, inputs=EVID + art("adopted_strategy", *media, "p04"), priority=44)
        for product_role in list(product_inputs) + ["D08"]:
            edges.append(req(product_role, role_id, optional=True))
        edges.append(req("debate_integration", role_id))
    role_node("C08", inputs=EVID + art("adopted_strategy"), priority=42)
    edges.append(req("debate_integration", "C08"))
    role_node("V07", "validation_plan", "validation_plan", EVID + art("adopted_strategy", "c08"), priority=40, deliverable="検証計画")
    edges.append(req("C08", "validation_plan"))
    bundle = ["c02", "c03", "m03", "p04", "adopted_strategy", *media, "validation_plan"]
    nodes.append({"id": "final_check", "kind": "crosscheck", "role": "V08", "outcomes": ["accepted", "inconsistent"], "artifacts": bundle, "purpose": "資料一式の縦と横の論理を検査する",
                  "budget": {"calls": 3}, "retry": {"same_failure": 1}, "max_iterations": 2, "priority": 35})
    for role_id in ("V01", "V02", "V03", "V04", "V05"):
        edges.append(req(role_id, "final_check", optional=True))
    edges.append(req("validation_plan", "final_check"))
    role_node("G01", "final_report", "final_proposal", EVID + art(*bundle), purpose="依頼者に提出する推奨をまとめる",
              instructions="推奨、残る異論、未確認事項、推奨を変更すべき条件を、依頼者が判断できる文章で書く。AIの評価を需要の検証結果として書かない。", activation="on_edge", priority=30)
    nodes[-1]["contract"] = "final_proposal"
    nodes[-1]["reviewer"] = "V08"
    edges.append(on("final_check", "final_report", ["accepted"]))
    edges.append(on("final_report", "T_complete", ["accepted"]))
    edges.append(on("final_check", "final_check", ["inconsistent"], max_traversals=2, on_limit_terminal="budget_unmet"))
    nodes += terminals()
    return {"graph_id": "standard", "version": "1.0", "description": "50役割を成果物と依存関係で結ぶ標準グラフ。依頼範囲に該当しないノードは起動しない", "nodes": nodes, "edges": edges, "exits": EXITS}


def to_mermaid(graph):
    """図の矢印は、requires が必要な成果物への依存、on が結果に応じた次の起動を表す。"""
    lines = ["flowchart TD"]
    shapes = {"decide": ("{", "}"), "crosscheck": ("{{", "}}"), "debate": ("[/", "/]"), "terminal": ("([", "])")}
    for node in graph["nodes"]:
        label = node.get("title") or node.get("purpose") or node.get("label") or node["id"]
        left, right = shapes.get(node["kind"], ("[", "]"))
        lines.append(f'  {node["id"]}{left}"{node["id"]}<br/>{str(label)[:28]}"{right}')
    for edge in graph["edges"]:
        if edge["type"] == "requires":
            label = "/".join(edge.get("outcomes") or [])
            arrow = f"-->|{label}|" if label else "-->"
        else:
            parts = "/".join(edge.get("when") or [])
            limit = f" 上限{edge['max_traversals']}" if edge.get("max_traversals") else ""
            arrow = f"-.->|{parts}{limit}|"
        lines.append(f'  {edge["from"]} {arrow} {edge["to"]}')
    for exit_ in graph.get("exits", []):
        lines.append(f'  any((全ノード)) -.->|{exit_["when"][:24]}| {exit_["to"]}')
    return "\n".join(lines) + "\n"


def write(graph):
    (HERE / f"{graph['graph_id']}.graph.json").write_text(json.dumps(graph, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (HERE / f"{graph['graph_id']}.mmd").write_text(to_mermaid(graph), encoding="utf-8")


def main():
    write(minimal_graph())
    write(standard_graph())


if __name__ == "__main__":
    main()
