"""グラフ定義を実行前に検査する。

存在しない依存先、到達できないノード、終了経路の欠落、上限のない循環、作成者と
最終検査者の同一性、予算切れから完成への接続を検出する。
"""
from __future__ import annotations

TERMINAL_OK = {"contract_met", "hypothesis_contract_met"}
REQUIRED_NODE = {
    "work": ["role", "output", "contract", "reviewer", "budget", "retry", "start_condition", "end_condition"],
    "decide": ["role", "outcomes", "budget", "retry"],
    "debate": ["proposers", "critics", "max_rounds", "budget"],
    "crosscheck": ["role", "outcomes", "budget", "artifacts"],
    "terminal": ["status"],
}


def check_graph(graph: dict, roles: dict | None = None, contracts: dict | None = None) -> list[str]:
    errors: list[str] = []
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    if len(nodes) != len(graph.get("nodes", [])):
        errors.append("ノードIDが重複している")
    edges = graph.get("edges", [])

    for node in nodes.values():
        kind = node.get("kind")
        if kind not in REQUIRED_NODE:
            errors.append(f"{node['id']}: 種類 {kind} は定義されていない")
            continue
        for field in REQUIRED_NODE[kind]:
            if field not in node:
                errors.append(f"{node['id']}: 必須項目 {field} がない")
        if roles is not None:
            for role in _roles_of(node):
                if role not in roles:
                    errors.append(f"{node['id']}: 役割 {role} は定義されていない")
        if contracts is not None and node.get("contract") and node["contract"] not in contracts:
            errors.append(f"{node['id']}: 品質契約 {node['contract']} は定義されていない")
        # 作成者と最終検査者の同一性。インスタンスの区別は実行時にも確認する。
        if kind == "work" and node.get("role") and node.get("role") == node.get("reviewer"):
            errors.append(f"{node['id']}: 作成役割と検査役割が同じ {node['role']} である")

    for edge in edges:
        for end in ("from", "to"):
            if edge.get(end) not in nodes:
                errors.append(f"辺 {edge.get('from')}→{edge.get('to')}: 存在しないノード {edge.get(end)} を指している")
        if edge.get("type") not in {"requires", "on"}:
            errors.append(f"辺 {edge.get('from')}→{edge.get('to')}: 種類 {edge.get('type')} は定義されていない")
    if any(e.startswith("辺") for e in errors):
        return errors

    # requires の循環は実行できない。
    requires = {nid: [e["from"] for e in edges if e["to"] == nid and e["type"] == "requires"] for nid in nodes}
    cycle = _find_cycle(requires)
    if cycle:
        errors.append(f"requires の循環がある: {' → '.join(cycle)}")

    # on の循環は上限が必要である。
    adjacency = {nid: [] for nid in nodes}
    for edge in edges:
        adjacency[edge["from"]].append(edge["to"])
    for edge in edges:
        if edge["type"] == "on" and _reaches(adjacency, edge["to"], edge["from"]) and not edge.get("max_traversals"):
            errors.append(f"辺 {edge['from']}→{edge['to']}: 循環に上限（max_traversals）がない")

    # 到達性：開始ノードから全ノードへ到達できること。
    starts = [nid for nid, node in nodes.items() if node.get("activation", "initial") == "initial" and not requires[nid]]
    if not starts:
        errors.append("開始ノードがない")
    seen = set(starts)
    stack = list(starts)
    while stack:
        current = stack.pop()
        for nxt in adjacency[current]:
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    terminal_ids = {nid for nid, node in nodes.items() if node.get("kind") == "terminal"}
    for nid in nodes:
        if nid not in seen and nid not in terminal_ids:
            errors.append(f"{nid}: 開始ノードから到達できない")

    # 終了経路：すべてのノードから終了ノードへ到達できること。
    for nid in nodes:
        if nid in terminal_ids:
            continue
        if not any(_reaches(adjacency, nid, t) for t in terminal_ids):
            errors.append(f"{nid}: 終了ノードへの経路がない")

    # 未達の終了経路が用意され、完成ノードへ接続されていないこと。
    statuses = {nodes[t]["status"] for t in terminal_ids}
    for required in ("budget_unmet", "on_hold_missing_info", "execution_failed", "aborted"):
        if required not in statuses:
            errors.append(f"終了状態 {required} のノードがない")
    if not statuses & TERMINAL_OK:
        errors.append("完成の終了ノードがない")
    for nid in terminal_ids:
        if adjacency[nid]:
            errors.append(f"{nid}: 終了ノードから先へ進む辺がある")

    # 分岐の網羅：判断ノードのすべての結果に行き先があること。
    for nid, node in nodes.items():
        if node.get("kind") not in {"decide", "crosscheck"}:
            continue
        routed = set()
        for edge in edges:
            if edge["from"] == nid:
                routed |= set(edge.get("when") or edge.get("outcomes") or [])
        for outcome in node.get("outcomes", []):
            if outcome not in routed:
                errors.append(f"{nid}: 結果 {outcome} の行き先がない")

    # 独立候補の隔離：候補同士が依存してはならない。
    isolation = {}
    for nid, node in nodes.items():
        if node.get("isolation_group"):
            isolation.setdefault(node["isolation_group"], []).append(nid)
    for group, members in isolation.items():
        for member in members:
            others = set(members) - {member}
            if _upstream(requires, member) & others:
                errors.append(f"{member}: 独立候補 {group} の他の案を入力にしている")
    return errors


def _roles_of(node):
    roles = []
    for key in ("role", "reviewer"):
        if node.get(key):
            roles.append(node[key])
    for critic in node.get("critics", []):
        roles.append(critic)
    return roles


def _reaches(adjacency, start, goal):
    seen, stack = set(), [start]
    while stack:
        current = stack.pop()
        if current == goal:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(adjacency.get(current, []))
    return False


def _upstream(requires, node):
    seen, stack = set(), list(requires.get(node, []))
    while stack:
        current = stack.pop()
        if current not in seen:
            seen.add(current)
            stack.extend(requires.get(current, []))
    return seen


def _find_cycle(deps):
    state, path = {}, []

    def visit(n):
        state[n] = 1
        path.append(n)
        for d in deps.get(n, []):
            if state.get(d) == 1:
                return path[path.index(d):] + [d]
            if d not in state:
                found = visit(d)
                if found:
                    return found
        state[n] = 2
        path.pop()
        return None

    for n in deps:
        if n not in state:
            found = visit(n)
            if found:
                return found
    return None
