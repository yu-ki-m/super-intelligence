"""グラフ定義と依頼から作業台帳を作る。実行時の動的な登録の検査もここで行う。"""
from __future__ import annotations

import json
from pathlib import Path

from validators.graphcheck import check_graph
from validators.schema_check import load_schema, validate

ROOT = Path(__file__).resolve().parent.parent


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_roles():
    return {r["id"]: r for r in load_json(ROOT / "graphs" / "roles.json")["roles"]}


def load_contracts():
    data = load_json(ROOT / "quality" / "contracts.json")
    return data["contracts"]


def load_graph(name):
    path = Path(name)
    if not path.exists():
        path = ROOT / "graphs" / f"{name}.graph.json"
    return load_json(path)


def deliverable_tags(graph):
    return sorted({n["deliverable"] for n in graph["nodes"] if n.get("deliverable")})


def scoped_graph(graph, brief):
    """依頼範囲に該当する仕事がないノードを除き、除いた理由を返す。

    除いたノードの前後は依存をつなぎ直し、残りの作業が終了ノードへ届くようにする。
    """
    deliverables = set(brief.get("deliverables") or [])
    unknown = deliverables - set(deliverable_tags(graph))
    if unknown:
        raise ValueError(f"deliverables の {sorted(unknown)} はこのグラフにない。使える名前：{deliverable_tags(graph)}")
    stage = brief.get("stage")
    removed = {}
    for node in graph["nodes"]:
        tag = node.get("deliverable")
        if tag and deliverables and tag not in deliverables:
            removed[node["id"]] = f"依頼された成果物に「{tag}」が含まれない"
        stages = node.get("stages")
        if stages and stage not in stages:
            removed[node["id"]] = f"提供段階「{stage}」では該当する資料や判断がない"
    # 除いたノードだけが必須の入力になるノードは、その入力を任意として扱えないので連鎖して除く。
    changed = True
    while changed:
        changed = False
        for edge in graph["edges"]:
            if edge["type"] != "requires" or edge.get("optional"):
                continue
            if edge["from"] in removed and edge["to"] not in removed and _node(graph, edge["to"]).get("kind") != "terminal":
                node = _node(graph, edge["to"])
                if node.get("drop_if_input_missing", False):
                    removed[edge["to"]] = f"必須の入力 {edge['from']} が対象外である"
                    changed = True
    nodes = [dict(n) for n in graph["nodes"] if n["id"] not in removed]
    edges = [e for e in graph["edges"] if e["from"] not in removed and e["to"] not in removed]
    # 除いたノードを経由していた必須の依存を、前のノードから後のノードへ直接つなぐ。
    bridged = set()
    for node_id in removed:
        before = [e for e in graph["edges"] if e["to"] == node_id and e["type"] == "requires" and e["from"] not in removed]
        after = [e for e in graph["edges"] if e["from"] == node_id and e["type"] == "requires" and e["to"] not in removed]
        for b in before:
            for a in after:
                key = (b["from"], a["to"])
                exists = any(e["from"] == key[0] and e["to"] == key[1] and e["type"] == "requires" for e in edges)
                if not exists and key not in bridged:
                    edges.append({"from": b["from"], "to": a["to"], "type": "requires", "optional": a.get("optional", False), "bridged_over": node_id})
                    bridged.add(key)
    removed_outputs = {n.get("output") for n in graph["nodes"] if n["id"] in removed}
    for node in nodes:
        if node.get("artifacts"):
            node["artifacts"] = [a for a in node["artifacts"] if a not in removed_outputs]
        if node.get("inputs"):
            node["inputs"] = [i for i in node["inputs"] if i.get("id") not in removed_outputs]
    return {**graph, "nodes": nodes, "edges": edges}, removed


def _node(graph, node_id):
    return next(n for n in graph["nodes"] if n["id"] == node_id)


def call_ceiling(graph, budget):
    """作業台帳から呼び出し数の上限を算出する。"""
    revisions = budget.get("revisions", 2)
    retries = budget.get("same_failure_retry", 1)
    rounds = budget.get("debate_rounds", 3)
    total = 0
    for node in graph["nodes"]:
        kind = node["kind"]
        if kind == "work":
            cycle = 1 if node.get("review_mode") == "machine" else 2
            total += cycle * (1 + revisions) + retries
        elif kind == "decide":
            total += (1 + retries) * max(1, node.get("max_iterations", 1))
        elif kind == "debate":
            critics, proposers = len(node["critics"]), len(node["proposers"])
            total += min(rounds, node["max_rounds"]) * (critics * 2 + proposers) + retries
        elif kind == "crosscheck":
            total += (1 + retries) * (1 + node.get("max_iterations", 1))
    return total


def validate_brief(brief):
    return validate(brief, load_schema("brief"))


def check_all(graph, roles=None, contracts=None):
    return check_graph(graph, roles if roles is not None else load_roles(), contracts if contracts is not None else load_contracts())


def add_node_task(store, node, graph, contracts, iter_no=1):
    """グラフのノードから実行単位の作業を登録する。試行ごとにIDを分ける。"""
    task_id = node["id"] if iter_no == 1 else f"{node['id']}~{iter_no}"
    depends = []
    for edge in graph["edges"]:
        if edge["to"] == node["id"] and edge["type"] == "requires":
            depends.append({"node": edge["from"], "outcomes": edge.get("outcomes"), "optional": edge.get("optional", False)})
    contract_id, sha = None, None
    if node.get("contract"):
        contract_id = node["contract"]
        sha = store.pin_contract(contracts[contract_id])
    output = None
    if node["kind"] == "work":
        output = node["output"]
        if not store.register_owner(output, node["id"], contract_id):
            raise ValueError(f"成果物 {output} の書き込み担当が重複している")
    return store.add_task(
        task_id=task_id, node_id=node["id"], iter=iter_no, kind=node["kind"], role=node.get("role"),
        purpose=node.get("purpose", ""), instructions=node.get("instructions", ""), inputs=node.get("inputs", []),
        depends_on=depends, output_artifact=output, contract_id=contract_id, contract_sha=sha,
        reviewer_role=node.get("reviewer"), priority=node.get("priority", 50),
        budget_calls=(node.get("budget") or {}).get("calls", 1), failure_policy=(node.get("retry") or {}).get("on_exhausted", "fail"),
        deadline=(node.get("budget") or {}).get("deadline"),
        # 作成者は修正や討論でも同じセッションを続ける。以前の検討を覚えたまま応答させるため。
        data={"review_mode": node.get("review_mode", "content"), **({"instance_key": f"author:{output}"} if output else {})},
    )


def validate_dynamic_request(request, roles, contracts, remaining_calls):
    """実行中に追加する作業を登録してよいかを確かめる。無制限の増員を認めない。"""
    errors = []
    if request.get("role") not in roles:
        errors.append(f"役割 {request.get('role')} は定義されていない")
    if request.get("contract") not in contracts:
        errors.append(f"品質契約 {request.get('contract')} は定義されていない")
    if not str(request.get("purpose", "")).strip():
        errors.append("目的がない")
    if not str(request.get("done_when", "")).strip():
        errors.append("完了条件がない")
    if remaining_calls < 2:
        errors.append("残りの呼び出し数が足りない")
    return errors
