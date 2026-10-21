#!/usr/bin/env python3
"""Validate structural traceability; does not validate semantics or evidence."""
import json
import sys
from collections import Counter

def validate(data):
    errors=[]
    if not isinstance(data, dict): return ['Root must be an object']
    reqs=data.get('requirements'); specs=data.get('specifications')
    if not isinstance(reqs,list) or not isinstance(specs,list): return ['requirements and specifications must be arrays']
    def index(rows, label):
        result={}
        for row in rows:
            if not isinstance(row,dict):
                errors.append(f'{label}: item must be an object'); continue
            key=row.get('id')
            if not isinstance(key,str) or not key.strip():
                errors.append(f'{label}: missing string id'); continue
            if key in result: errors.append(f'{label}: duplicate id {key}')
            result[key]=row
        return result
    rr=index(reqs,'requirements'); ss=index(specs,'specifications')
    if not rr: errors.append('No requirements')
    for key in rr.keys() & ss.keys(): errors.append(f'ID used in both lists: {key}')
    counts=Counter(); graph={}
    def required(row, fields, key):
        for field in fields:
            if not isinstance(row.get(field),str) or not row[field].strip(): errors.append(f'{key}: missing text {field}')
    for key,row in rr.items():
        required(row,['context','statement','acceptance'],key)
        if row.get('status') not in ('accepted','proposed','deferred','rejected'): errors.append(f'{key}: invalid status')
        if not isinstance(row.get('sources'),list) or not row['sources'] or not all(isinstance(s,str) and s.strip() for s in row['sources']): errors.append(f'{key}: sources required')
    for key,row in ss.items():
        required(row,['statement','rationale'],key)
        parent=row.get('requirement_id')
        if not isinstance(parent,str) or parent not in rr: errors.append(f'{key}: exactly one valid requirement_id required')
        else:
            counts[parent]+=1
            if rr[parent].get('status')!='accepted': errors.append(f'{key}: parent is not accepted; keep candidate in decisions')
        deps=row.get('depends_on',[])
        if not isinstance(deps,list) or not all(isinstance(d,str) for d in deps):
            errors.append(f'{key}: depends_on must be string array'); deps=[]
        for dep in deps:
            if dep not in ss: errors.append(f'{key}: unknown dependency {dep}')
        graph[key]=[d for d in deps if d in ss]
    for key,row in rr.items():
        if row.get('status')=='accepted' and not counts[key]: errors.append(f'{key}: accepted requirement has no specifications')
    active=set(); done=set()
    def visit(key):
        if key in active:
            errors.append(f'Specification dependency cycle at {key}'); return
        if key in done: return
        active.add(key)
        for dep in graph.get(key,[]): visit(dep)
        active.remove(key); done.add(key)
    for key in graph: visit(key)
    return errors

if __name__=='__main__':
    try:
        with open(sys.argv[1],encoding='utf-8') as f: errors=validate(json.load(f))
    except (OSError,ValueError,IndexError) as exc:
        print(f'ERROR: {exc}'); sys.exit(2)
    for error in errors: print('ERROR: '+error)
    if not errors: print('PASS: structural checks only; semantic and evidence review still required')
    sys.exit(bool(errors))
