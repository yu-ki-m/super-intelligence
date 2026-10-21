#!/usr/bin/env python3
from pathlib import Path
import sys

BASE = Path(".business-model")
REQUIRED = [
    "00-goal.md",
    "01-system-inventory.md",
    "02-system-evidence.tsv",
    "03-capability-map.md",
    "04-management-opportunities.md",
    "05-causal-model.md",
    "06-business-model-candidates.md",
    "07-selected-business-model.md",
    "08-operating-model.md",
    "09-kpi-model.md",
    "10-system-dependency.md",
    "11-risks-and-counterevidence.md",
    "12-verification.md",
]

errors = []
for name in REQUIRED:
    p = BASE / name
    if not p.exists():
        errors.append(f"MISSING: {p}")
    elif p.stat().st_size == 0:
        errors.append(f"EMPTY: {p}")

verification = BASE / "12-verification.md"
if verification.exists():
    text = verification.read_text(encoding="utf-8", errors="replace")
    if "UNVERIFIED" in text:
        errors.append("UNVERIFIED remains in Completion Ledger")
    if "FAIL" in text:
        errors.append("FAIL remains in Completion Ledger")

evidence = BASE / "02-system-evidence.tsv"
if evidence.exists():
    rows = [x for x in evidence.read_text(encoding="utf-8", errors="replace").splitlines() if x.strip()]
    if len(rows) < 2:
        errors.append("Evidence table has no evidence rows")

if errors:
    print("COMPLETION GATE: FAIL")
    for e in errors:
        print(f"- {e}")
    sys.exit(1)

print("COMPLETION GATE: PASS")
