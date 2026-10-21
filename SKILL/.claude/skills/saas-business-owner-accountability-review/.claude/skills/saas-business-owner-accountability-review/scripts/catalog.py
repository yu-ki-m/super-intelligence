#!/usr/bin/env python3
from pathlib import Path
import argparse,csv,json
ROOT=Path(__file__).resolve().parents[1]
CSV=ROOT/'references'/'accountability-viewpoints-1000.csv'
def load():
    with CSV.open(encoding='utf-8-sig') as f:return list(csv.DictReader(f))
def main():
    p=argparse.ArgumentParser(description='Search SaaS accountability viewpoints (not questions).')
    p.add_argument('--top',type=int);p.add_argument('--category');p.add_argument('--keyword');p.add_argument('--tier');p.add_argument('--json',action='store_true')
    a=p.parse_args(); out=[]
    for r in load():
        if a.category and a.category.lower() not in r['domain'].lower():continue
        if a.tier and r['tier']!=a.tier:continue
        if a.keyword and a.keyword.lower() not in ' '.join(r.values()).lower():continue
        out.append(r)
    if a.top:out=out[:a.top]
    if a.json:print(json.dumps(out,ensure_ascii=False,indent=2))
    else:
        for r in out:
            print(f"#{r['rank']} [{r['tier']}] {r['domain']} / {r['topic']} / {r['dimension']}")
            print('Viewpoint:',r['viewpoint'])
            print('Inspect:',r['inspect_signals'])
            print('Failure:',r['executive_failure']);print()
if __name__=='__main__':main()
