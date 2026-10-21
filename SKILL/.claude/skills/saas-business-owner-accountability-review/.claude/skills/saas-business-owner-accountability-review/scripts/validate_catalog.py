#!/usr/bin/env python3
from pathlib import Path
import csv,sys
p=Path(__file__).resolve().parents[1]/'references'/'accountability-viewpoints-1000.csv'
with p.open(encoding='utf-8-sig') as f: rows=list(csv.DictReader(f))
assert len(rows)==1000
assert [int(r['rank']) for r in rows]==list(range(1,1001))
assert len({r['id'] for r in rows})==1000
assert len({r['viewpoint'] for r in rows})==1000
assert all('?' not in r['viewpoint'] and '？' not in r['viewpoint'] for r in rows), 'viewpoint must not be a question'
from collections import Counter
c=Counter(r['domain'] for r in rows)
assert len(c)==25 and set(c.values())=={40}
print('OK: 1,000 unique responsibility viewpoints / no fixed questions / 25 domains × 40 / ranks 1..1000')
