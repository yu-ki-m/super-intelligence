#!/usr/bin/env python3
"""Check structural traceability; does not prove source completeness or semantics."""
import json
import sys
from collections import Counter, deque


def validate(inv, model):
    errors = []
    def check(ok, message):
        if not ok:
            errors.append(message)
    def index(rows, name):
        out = {}
        for r in rows:
            key = r.get('id')
            check(bool(key) and key not in out, f'{name}: missing/duplicate id {key}')
            out[key] = r
        return out
    items = index(inv.get('items', []), 'inventory')
    nodes = index(model.get('nodes', []), 'nodes')
    edges = index(model.get('edges', []), 'edges')
    trees = index(model.get('trees', []), 'trees')
    tests = index(model.get('tests', []), 'tests')
    check(bool(items) and bool(nodes) and bool(trees), 'empty inventory/model')
    revisions = inv.get('revisions', [])
    check(bool(revisions), 'missing revisions')
    for collection, key in [(inv, 'pending'), (inv, 'unresolved'), (model, 'unresolved')]:
        check(key in collection and collection[key] == [], f'{key}: missing or outstanding work')
    def evidence(value):
        return isinstance(value, list) and bool(value) and all(
            isinstance(v, dict) and v.get('revision') in revisions and bool(v.get('path'))
            and isinstance(v.get('start'), int) and isinstance(v.get('end'), int)
            and 0 < v['start'] <= v['end'] and bool(v.get('excerpt')) for v in value)
    for key, item in items.items():
        check(item.get('kind') in ['hunk', 'entry', 'alternative'], f'{key}: invalid kind')
        check(item.get('revision') in revisions, f'{key}: invalid revision')
        # Binary/rename-only changes may use metadata evidence instead of line ranges.
        check(bool(item.get('source')), f'{key}: missing source')
    mapped = Counter()
    for m in model.get('mappings', []):
        key = m.get('inventory_id'); mapped[key] += 1
        check(key in items, f'mapping: unknown inventory {key}')
        status = m.get('status')
        check(status in ['mapped', 'unreachable', 'excluded'], f'{key}: unresolved/invalid disposition')
        check(bool(m.get('reason')) and evidence(m.get('evidence')), f'{key}: missing rationale/evidence')
        nids, eids = m.get('node_ids', []), m.get('edge_ids', [])
        check(all(n in nodes for n in nids) and all(e in edges for e in eids), f'{key}: dangling mapping')
        if status == 'mapped':
            check(bool(nids or eids), f'{key}: empty mapping')
            if items.get(key, {}).get('kind') == 'alternative':
                check(bool(eids), f'{key}: alternative has no edge')
        if status == 'excluded':
            check(bool(m.get('scope_approval')), f'{key}: exclusion lacks approval reference')
    for key in items:
        check(mapped[key] == 1, f'{key}: needs exactly one disposition')
    outgoing = {n: [] for n in nodes}
    incoming = {n: 0 for n in nodes}
    for key, edge in edges.items():
        a, b = edge.get('from'), edge.get('to')
        check(a in nodes and b in nodes, f'{key}: dangling edge')
        check(bool(edge.get('condition')), f'{key}: missing edge condition')
        if a in nodes and b in nodes:
            check(nodes[a].get('tree_id') == nodes[b].get('tree_id'), f'{key}: cross-tree edge needs reference node')
            outgoing[a].append(b); incoming[b] += 1
    roots = []
    for key, tree in trees.items():
        r = tree.get('root'); roots.append(r)
        check(r in nodes and nodes.get(r, {}).get('tree_id') == key, f'{key}: invalid root')
        check(tree.get('revision') in revisions, f'{key}: invalid revision')
        check(items.get(tree.get('entry_id'), {}).get('kind') == 'entry', f'{key}: missing entry inventory')
    reached = set(); todo = list(roots)
    while todo:
        n = todo.pop()
        if n in nodes and n not in reached:
            reached.add(n); todo.extend(outgoing[n])
    check(reached == set(nodes), 'orphan nodes')
    indegree = incoming.copy(); q = deque(n for n in nodes if not indegree[n]); visited = 0
    while q:
        n = q.popleft(); visited += 1
        for child in outgoing[n]:
            indegree[child] -= 1
            if indegree[child] == 0:
                q.append(child)
    check(visited == len(nodes), 'raw graph cycle: use reference/summary with explicit contract')
    terminals = set()
    for key, n in nodes.items():
        check(n.get('tree_id') in trees, f'{key}: unknown tree')
        check(evidence(n.get('evidence')), f'{key}: missing source evidence')
        kind = n.get('kind')
        check(kind in ['entry', 'decision', 'action', 'terminal', 'reference', 'summary'], f'{key}: invalid node kind')
        if kind == 'terminal':
            terminals.add(key)
            check(not outgoing[key], f'{key}: terminal has outgoing edges')
            check(isinstance(n.get('outcome'), dict) and bool(n['outcome']), f'{key}: missing outcome')
            check(n.get('result_basis') in ['code-derived', 'observed', 'contract-derived'], f'{key}: unknown outcome')
        elif kind == 'reference':
            check(n.get('target_tree_id') in trees and isinstance(n.get('bindings'), dict), f'{key}: unresolved reference/bindings')
            resume = n.get('resume_node_id')
            if resume is None:
                check(bool(n.get('non_returning_reason')), f'{key}: missing non-return reason')
            else:
                check(resume in outgoing[key], f'{key}: resume is not an outgoing successor')
        else:
            check(bool(outgoing[key]), f'{key}: nonterminal dead end')
        if kind == 'summary':
            check(bool(n.get('summary_contract')), f'{key}: missing summary contract')
    covered = set()
    for key, test in tests.items():
        ids = test.get('terminal_ids', [])
        check(bool(ids) and all(n in terminals for n in ids), f'{key}: invalid terminal test mapping')
        covered.update(ids)
        check(isinstance(test.get('inputs'), dict) and bool(test['inputs']), f'{key}: no concrete inputs')
        for f in ['preconditions', 'actions', 'code_result', 'spec_expected', 'execution_status']:
            check(f in test, f'{key}: missing {f}')
    check(terminals <= covered, 'terminal without test case')
    return errors


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('usage: check_coverage.py inventory.json model.json')
        with open(sys.argv[1], encoding='utf-8') as f:
            inv = json.load(f)
        with open(sys.argv[2], encoding='utf-8') as f:
            model = json.load(f)
        errors = validate(inv, model)
    except (ValueError, OSError, KeyError, TypeError, AttributeError) as exc:
        errors = [f'invalid input: {exc}']
    print(json.dumps({'structural_check': 'FAIL' if errors else 'PASS', 'errors': errors,
                      'limitation': 'Not proof of source completeness, path feasibility, or correct outcomes.'}, ensure_ascii=False, indent=2))
    sys.exit(1 if errors else 0)
