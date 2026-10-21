#!/usr/bin/env python3
from pathlib import Path
import sys

BASE = Path(".system-design")

REQUIRED = [
"00-analysis-charter.md","01-as-is-context.md","02-as-is-stakeholders.md",
"03-as-is-value-stream.md","04-as-is-processes.md","05-as-is-decisions.md",
"06-as-is-information.md","07-as-is-systems-and-tools.md","08-as-is-data.md",
"09-as-is-controls-and-permissions.md","10-as-is-exceptions.md","11-as-is-costs.md",
"12-as-is-customer-and-market.md","13-as-is-metrics.md","14-as-is-pain-and-root-causes.md",
"15-as-is-constraints.md","16-as-is-evidence.tsv","17-to-be-design-principles.md",
"18-to-be-candidates.md","19-to-be-comparison.md","20-to-be-selected-model.md",
"21-to-be-state-machine.md","22-to-be-kpi-and-decision-model.md","23-to-be-operating-model.md",
"24-capability-requirements.md","25-system-boundary.md","26-domain-model.md","27-event-model.md",
"28-use-cases.md","29-functional-spec.md","30-permission-and-audit.md","31-data-and-integration.md",
"32-ui-api-event-batch-spec.md","33-non-functional-requirements.md",
"34-exception-abuse-and-resilience.md","35-rollout-and-migration.md",
"36-economics-and-business-case.md","37-acceptance-criteria.md",
"38-traceability-matrix.tsv","39-independent-review.md","40-verification.md","41-interview-ledger.md"
]

errors=[]
for name in REQUIRED:
    p=BASE/name
    if not p.exists():
        errors.append(f"MISSING: {name}")
    elif p.stat().st_size == 0:
        errors.append(f"EMPTY: {name}")

# candidate count heuristic
cand = BASE/"18-to-be-candidates.md"
if cand.exists():
    txt = cand.read_text(encoding="utf-8", errors="ignore")
    count = txt.lower().count("model name")
    if count and count < 5:
        errors.append("TO-BE candidates appear to be fewer than 5.")

# verification status
ver = BASE/"40-verification.md","41-interview-ledger.md"
if ver.exists():
    txt=ver.read_text(encoding="utf-8", errors="ignore")
    if "UNVERIFIED" in txt:
        errors.append("UNVERIFIED remains.")
    if "FAIL" in txt:
        errors.append("FAIL remains.")

# traceability
trace=BASE/"38-traceability-matrix.tsv"
if trace.exists():
    rows=[r for r in trace.read_text(encoding="utf-8", errors="ignore").splitlines() if r.strip()]
    if len(rows)<2:
        errors.append("Traceability matrix has no data rows.")

if errors:
    print("COMPLETION GATE: FAIL")
    for e in errors:
        print("-", e)
    sys.exit(1)

print("COMPLETION GATE: PASS")
