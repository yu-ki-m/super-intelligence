#!/usr/bin/env python3
"""Render a reviewed input/state decision view using the bundled fixed template."""
import json
import sys
from pathlib import Path


def validate(view, model):
    errors = []
    def require(ok, msg):
        if not ok:
            errors.append(msg)
    source = {n['id']: n for n in model['nodes']}
    all_ids = set()
    used = set()
    result_sources = set()
    tree_ids = set()
    require(bool(view.get('title')) and bool(view.get('trees')), 'title and trees required')
    require(isinstance(view.get('audit'), dict), 'audit required')
    for tree in view.get('trees', []):
        tid = tree.get('id')
        require(tid and tid not in tree_ids, f'duplicate/missing tree id {tid}')
        tree_ids.add(tid)
        require(bool(tree.get('title')) and bool(tree.get('revision_label')), f'{tid}: title/revision_label missing')
        nodes = {}
        for n in tree.get('nodes', []):
            nid = n.get('id')
            require(nid and nid not in all_ids, f'{tid}: duplicate/missing node {nid}')
            all_ids.add(nid); nodes[nid] = n
            require(bool(n.get('label')), f'{nid}: label required')
            kind = n.get('kind')
            require(kind in ['condition', 'result'], f'{nid}: main view only accepts condition/result, not {kind}')
            refs = n.get('source_node_ids', [])
            require(bool(refs) and all(x in source for x in refs), f'{nid}: source mapping required')
            used.update(refs)
            if kind == 'condition':
                require(bool(n.get('input_variable')), f'{nid}: input/state variable required')
                require(len(n.get('branches', [])) >= 2, f'{nid}: condition needs at least two alternatives')
                require(bool(n.get('partition_reason')), f'{nid}: explain exhaustiveness and exclusivity')
                labels = [b.get('label') for b in n.get('branches', [])]
                require(all(labels) and len(set(labels)) == len(labels), f'{nid}: missing/duplicate branch labels')
                require(all(b.get('predicate') for b in n.get('branches', [])), f'{nid}: predicates required')
            if kind == 'result':
                result_sources.update(refs)
                require(not n.get('branches'), f'{nid}: result cannot have successors')
                require(isinstance(n.get('outcome'), dict) and bool(n['outcome']), f'{nid}: concrete outcome required')
                require(bool(n.get('tests')), f'{nid}: tests required')
                terminal_refs = [source[x] for x in refs if x in source and source[x].get('kind') == 'terminal']
                require(bool(terminal_refs), f'{nid}: final result needs source terminal mapping')
        root = tree.get('root')
        require(root in nodes, f'{tid}: root missing')
        parents = {nid: 0 for nid in nodes}
        for n in nodes.values():
            for b in n.get('branches', []):
                target = b.get('to')
                require(target in nodes, f'{n.get("id")}: invalid target {target}')
                if target in nodes:
                    parents[target] += 1
        require(all(count == (0 if nid == root else 1) for nid, count in parents.items()), f'{tid}: view must be a tree; duplicate shared paths with evidence preserved')
        reached = set(); stack = [root]
        while stack:
            nid = stack.pop()
            if nid not in nodes:
                continue
            if nid in reached:
                errors.append(f'{tid}: cycle/repeated node {nid}'); continue
            reached.add(nid)
            stack.extend(b.get('to') for b in nodes[nid].get('branches', []))
        require(reached == set(nodes), f'{tid}: orphan nodes')
    omissions = view.get('detail_only', [])
    for item in omissions:
        require(item.get('source_node_id') in source and bool(item.get('reason')), 'detail_only needs valid ID and rationale')
    accounted = used | {x.get('source_node_id') for x in omissions}
    require(set(source) <= accounted, 'source nodes missing from both view and detail_only ledger')
    terminals = {i for i,n in source.items() if n.get('kind') == 'terminal'}
    require(terminals <= result_sources, 'every source terminal must map to a result node, not a condition/detail_only')
    return errors


def render(view, model, output):
    errors = validate(view, model)
    if errors:
        raise ValueError('\n'.join(errors))
    # Retain the complete investigation model for download/audit without displaying it as the main tree.
    data = dict(view)
    data['investigation_model'] = model
    encoded = json.dumps(data, ensure_ascii=False).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
    template = Path(__file__).resolve().parent.parent / 'assets' / 'decision-view.html'
    html = template.read_text(encoding='utf-8')
    if html.count('__DECISION_DATA__') != 1:
        raise ValueError('template marker must occur exactly once')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html.replace('__DECISION_DATA__', encoded), encoding='utf-8')
    return output


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('usage: render_decisions.py view.json model.json decision-trees.html')
        view = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        model = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
        print(render(view, model, sys.argv[3]))
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
