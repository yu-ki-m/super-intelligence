#!/usr/bin/env python3
"""Check traceability structure; never certify architecture or evidence truth.

ERROR lines are structural defects (exit code 1). WARN lines are patterns that
are often, but not always, a gap; the report should be able to explain them.
"""
import json
import sys
from collections import Counter
from pathlib import Path

FIELDS = {
    'evidence': 'id locator claim',
    'goals': 'id text status evidence_ids',
    'impacts': 'id goal_id actor change status evidence_ids',
    'contexts': 'id name owner status evidence_ids',
    'requirements': 'id goal_id impact_ids context_ids text acceptance owner disposition status evidence_ids',
    'decisions': 'id requirement_ids alternatives selected rationale downside revisit status evidence_ids',
    'experiments': 'id decision_ids hypothesis method falsifier stop owner next_action',
    'issues': 'id text affects owner resolve status',
}
LISTS = {'evidence_ids', 'impact_ids', 'context_ids', 'requirement_ids', 'alternatives', 'decision_ids', 'affects'}
STATES = {k: {'hypothesis', 'confirmed'} for k in ('goals', 'impacts', 'contexts', 'requirements')}
STATES.update(decisions={'proposed', 'accepted', 'deferred', 'superseded'}, issues={'open', 'resolved'})
REFS = {'evidence_ids':'evidence', 'goal_id':'goals', 'impact_ids':'impacts', 'context_ids':'contexts', 'requirement_ids':'requirements', 'decision_ids':'decisions'}
DISPOSITIONS = {'keep','change','merge','split','defer','remove-candidate','add'}


def check(data):
    errors = []
    warnings = []
    if not isinstance(data, dict):
        return ['root must be an object'], [], {}
    rows = {}
    for kind, fields in FIELDS.items():
        value = data.get(kind)
        if not isinstance(value, list):
            errors.append(f'{kind}: required array')
            value = []
        rows[kind] = []
        for index, row in enumerate(value):
            label = f'{kind}[{index}]'
            if not isinstance(row, dict):
                errors.append(f'{label}: expected object')
                continue
            rows[kind].append(row)
            for field in fields.split():
                val = row.get(field)
                if field not in row:
                    errors.append(f'{label}: missing {field}')
                elif field in LISTS:
                    if not isinstance(val, list) or any(not isinstance(x, str) or not x.strip() for x in val):
                        errors.append(f'{label}: {field} must be string array')
                    elif len(val) != len(set(val)):
                        errors.append(f'{label}: duplicate {field}')
                elif field == 'selected' and val is None:
                    pass
                elif not isinstance(val, str) or not val.strip():
                    errors.append(f'{label}: {field} must be nonempty string')
            if kind in STATES and (not isinstance(row.get('status'), str) or row['status'] not in STATES[kind]):
                errors.append(f'{label}: invalid status')
    # Shape errors must be resolved before graph checks.
    if errors:
        return errors, [], {}
    all_ids = [r['id'] for values in rows.values() for r in values]
    for ident, count in Counter(all_ids).items():
        if count > 1:
            errors.append(f'{ident}: duplicate global ID')
    ids = {kind: {r['id'] for r in values} for kind, values in rows.items()}
    all_set = set(all_ids)
    unresolved = {ident for issue in rows['issues'] if issue['status'] == 'open' for ident in issue['affects']}
    for kind in ('goals','requirements'):
        if not rows[kind]:
            errors.append(f'{kind}: at least one item required')
    impacts = {r['id']: r for r in rows['impacts']}
    for kind, values in rows.items():
        for r in values:
            ident = r['id']
            for field, target in REFS.items():
                if field in FIELDS[kind].split():
                    references = [r[field]] if field == 'goal_id' else r[field]
                    for ref in references:
                        if ref not in ids[target]:
                            errors.append(f'{ident}: {field} unresolved {ref}')
            if kind in STATES and r.get('status') in ('confirmed','accepted') and not r['evidence_ids']:
                errors.append(f'{ident}: confirmed/accepted needs evidence')
            if r.get('owner') == '未確認' and ident not in unresolved:
                errors.append(f'{ident}: unknown owner needs open issue')
            if kind == 'requirements':
                if r['disposition'] not in DISPOSITIONS:
                    errors.append(f'{ident}: invalid disposition')
                for field, exemption in [('impact_ids','impact_exemption'),('context_ids','context_exemption')]:
                    exempt = r.get(exemption)
                    if not r[field] and not (isinstance(exempt,str) and exempt.strip()):
                        if field == 'impact_ids' or ident not in unresolved:
                            errors.append(f'{ident}: empty {field} needs explanation or boundary issue')
                for impact in r['impact_ids']:
                    if impact in impacts and impacts[impact]['goal_id'] != r['goal_id']:
                        errors.append(f'{ident}: impact goal differs from requirement goal')
            if kind == 'decisions':
                if not r['requirement_ids']:
                    errors.append(f'{ident}: decision needs requirements')
                if len(r['alternatives']) < 2:
                    errors.append(f'{ident}: at least two alternatives required')
                if r['selected'] is not None and r['selected'] not in r['alternatives']:
                    errors.append(f'{ident}: selected not in alternatives')
                if r['status'] == 'accepted':
                    if r['selected'] is None:
                        errors.append(f'{ident}: accepted needs selection')
                    for f in ('decision_owner','decision_date'):
                        if not isinstance(r.get(f),str) or not r[f].strip():
                            errors.append(f'{ident}: accepted needs {f}')
                if r['status'] == 'deferred' and r['selected'] is not None:
                    errors.append(f'{ident}: deferred selection must be null')
                successor = r.get('superseded_by')
                if successor is not None and (not isinstance(successor, str) or successor not in ids['decisions']):
                    errors.append(f'{ident}: superseded_by unresolved {successor}')
                elif r['status'] == 'superseded' and successor is None:
                    warnings.append(f'{ident}: superseded decision has no superseded_by')
            if kind == 'experiments' and not r['decision_ids']:
                errors.append(f'{ident}: experiment needs decision')
            if kind == 'issues':
                if not r['affects']:
                    errors.append(f'{ident}: issue needs affected IDs')
                for ref in r['affects']:
                    if ref not in all_set:
                        errors.append(f'{ident}: unresolved affected ID {ref}')
    # Warnings: links that are usually expected but can be legitimately absent.
    goals_with_requirements = {r['goal_id'] for r in rows['requirements']}
    for g in rows['goals']:
        if g['id'] not in goals_with_requirements:
            warnings.append(f'{g["id"]}: goal has no requirement')
    used_contexts = {c for r in rows['requirements'] for c in r['context_ids']}
    for c in rows['contexts']:
        if c['id'] not in used_contexts:
            warnings.append(f'{c["id"]}: context is not used by any requirement')
    used_impacts = {i for r in rows['requirements'] for i in r['impact_ids']}
    for i in rows['impacts']:
        if i['id'] not in used_impacts:
            warnings.append(f'{i["id"]}: impact is not realized by any requirement')
    if not rows['decisions']:
        warnings.append('decisions: no decision recorded')
    states = {kind: dict(Counter(r['status'] for r in rows[kind])) for kind in STATES}
    return errors, warnings, states


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if len(sys.argv) != 2:
        print('Usage: check_ledger.py decision-ledger.json', file=sys.stderr)
        return 2
    try:
        data = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        print(f'Input error: {exc}', file=sys.stderr)
        return 2
    errors, warnings, states = check(data)
    for error in errors:
        print('ERROR:', error)
    for warning in warnings:
        print('WARN:', warning)
    print(json.dumps({'structure_pass': not errors, 'warnings': len(warnings), 'states': states,
                      'content_review_required': True}, ensure_ascii=False))
    return 1 if errors else 0

if __name__ == '__main__':
    sys.exit(main())
