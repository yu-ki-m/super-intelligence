#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Mutation tests for ledger.py, render_html.py and quality.py.

Each case builds the passing sample ledger (sample_ledger.py), breaks one thing
and asserts that `validate --final` reports the expected error code.
Usage: python -X utf8 tests/test_ledger.py [-v]
"""
import io
import os
import re
import shutil
import sys
import tempfile
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, HERE)
import toon  # noqa: E402
import ledger  # noqa: E402
import render_html  # noqa: E402
import sample_ledger  # noqa: E402

VERBOSE = "-v" in sys.argv


def load(ws, name):
    with open(os.path.join(ws, name), "rb") as f:
        return toon.decode(f.read())


def save(ws, name, doc):
    with open(os.path.join(ws, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(toon.encode(doc))


def edit(ws, name, fn):
    d = load(ws, name)
    fn(d)
    save(ws, name, d)


def codes(ws, final=True):
    L = ledger.validate(ws, final=final)
    return [e["code"] for e in L.errors], L


def find(rows, **kw):
    return next(r for r in rows if all(r.get(k) == v for k, v in kw.items()))


CASES = []


def case(expect):
    def deco(fn):
        CASES.append((fn.__name__, expect, fn))
        return fn
    return deco


@case("task_missing")
def drop_task(ws):
    edit(ws, "tasks.toon", lambda d: d.update(tasks=[t for t in d["tasks"] if t["id"] != "T008"],
                                              task_specs=[l for l in d["task_specs"] if l["task"] != "T008"]))


@case("matrix_missing")
def drop_cell(ws):
    edit(ws, "design.toon", lambda d: d.update(matrix=[c for c in d["matrix"] if not (c["property"] == "PR003" and c["step"] == "ST004")]))


@case("evidence_quote")
def wrong_quote(ws):
    edit(ws, "specs.toon", lambda d: find(d["properties"], id="PR001").update(ev_quote="bookCode: string"))


@case("evidence_line")
def wrong_line(ws):
    edit(ws, "current.toon", lambda d: find(d["behaviors"], id="C001").update(ev_line=99))


@case("evidence_file")
def wrong_file(ws):
    edit(ws, "current.toon", lambda d: find(d["entrypoints"], id="E001").update(ev_path="frontend/src/Nope.tsx"))


@case("evidence_name")
def wrong_code_name(ws):
    edit(ws, "specs.toon", lambda d: find(d["properties"], id="PR002").update(code_name="bookTitle"))


@case("evidence_kind")
def doc_as_fact(ws):
    def f(d):
        b = find(d["behaviors"], id="C001")
        b.update(ev_path="doc:frontend/src/BookList.tsx")
    edit(ws, "current.toon", f)


@case("evidence_missing")
def existing_step_without_evidence(ws):
    edit(ws, "design.toon", lambda d: find(d["steps"], id="ST003").update(ev_path="none", ev_line=0, ev_quote=""))


@case("requirement_without_need")
def orphan_requirement(ws):
    edit(ws, "requirements.toon", lambda d: d.update(need_links=[l for l in d["need_links"] if l["requirement"] != "R003"],
                                                    frame=[dict(f, result="not_needed", requirements="", reason="x") if f["requirements"] == "R003" else f for f in d["frame"]]))


@case("need_without_requirement")
def need_without_requirement(ws):
    edit(ws, "requirements.toon", lambda d: d.update(need_links=[l for l in d["need_links"] if l["need"] != "N002"],
                                                    frame=[dict(f, result="not_needed", requirements="", reason="x") if f["need"] == "N002" else f for f in d["frame"]]))


@case("frame_missing")
def stakeholder_without_frame(ws):
    edit(ws, "needs.toon", lambda d: d["stakeholders"].append({"id": "SH03", "name": "経理", "kind": "other", "note": ""}))


@case("frame_unconfirmed")
def frame_unconfirmed(ws):
    edit(ws, "needs.toon", lambda d: find(d["frame"], stakeholder="SH01", scene="SC02").update(result="unconfirmed"))


@case("requirement_without_spec")
def requirement_without_spec(ws):
    def f(d):
        d["requirements"].append({"id": "R005", "kind": "operation", "statement": "登録の記録を残すこと", "reason": "監査",
                                  "acceptance": "記録がある", "status": "adopted", "confidence": "decided"})
        d["need_links"].append({"need": "N001", "requirement": "R005"})
        find(d["frame"], need="N001", viewpoint="operation").update(result="requirement", requirements="R005", reason="")
    edit(ws, "requirements.toon", f)


@case("spec_without_acceptance")
def spec_without_acceptance(ws):
    edit(ws, "specs.toon", lambda d: d.update(acceptance=[a for a in d["acceptance"] if a["spec"] != "S003"]))


@case("decision_gap")
def decision_gap(ws):
    edit(ws, "specs.toon", lambda d: d.update(rules=[r for r in d["rules"] if r["when"] != "registered=no amount=invalid"]))


@case("decision_conflict")
def decision_conflict(ws):
    edit(ws, "specs.toon", lambda d: d["rules"].append({"table": "DT01", "when": "amount=invalid", "outcome": "登録する", "specs": "S001"}))


@case("transition_missing")
def transition_missing(ws):
    def f(d):
        d["machines"].append({"id": "SM01", "entity": "書籍", "name": "書籍の状態"})
        d["states"] += [{"machine": "SM01", "state": "在庫"}, {"machine": "SM01", "state": "販売済み"}]
        d["events"] += [{"machine": "SM01", "event": "販売"}]
        d["transitions"].append({"machine": "SM01", "state": "在庫", "event": "販売", "result": "transition", "to_state": "販売済み", "specs": "S001", "reason": ""})
    edit(ws, "specs.toon", f)


@case("crud_unconfirmed")
def crud_unconfirmed(ws):
    edit(ws, "specs.toon", lambda d: d["crud"][0].update(update="?"))


@case("path_first_property")
def two_first_properties(ws):
    edit(ws, "specs.toon", lambda d: find(d["path_properties"], property="PR002").update(first=True, reason="x"))


@case("spec_not_in_matrix")
def spec_not_in_matrix(ws):
    edit(ws, "design.toon", lambda d: [c.update(specs=" ".join(x for x in c["specs"].split() if x != "S002")) for c in d["matrix"]])


@case("matrix_specs")
def change_cell_without_spec(ws):
    edit(ws, "design.toon", lambda d: find(d["matrix"], property="PR003", step="ST005").update(specs=""))


@case("spec_without_task")
def spec_without_task(ws):
    edit(ws, "tasks.toon", lambda d: d.update(task_specs=[l for l in d["task_specs"] if l["spec"] != "S005"]))


@case("cell_spec_not_linked")
def cell_spec_not_linked(ws):
    edit(ws, "tasks.toon", lambda d: d.update(task_specs=[l for l in d["task_specs"] if not (l["task"] == "T004" and l["spec"] == "S002")]))


@case("token_number")
def token_number(ws):
    edit(ws, "tasks.toon", lambda d: find(d["tasks"], id="T003").update(token="_書籍ID_9_", message="feat(book): _書籍ID_9_ x"))


@case("token_message")
def token_not_in_message(ws):
    edit(ws, "tasks.toon", lambda d: find(d["tasks"], id="T010").update(message="feat(book): 金額を追加"))


@case("task_order")
def task_order(ws):
    def f(d):
        find(d["tasks"], id="T008").update(order=20)
    edit(ws, "tasks.toon", f)


@case("task_extra")
def task_extra(ws):
    def f(d):
        d["tasks"].append({"id": "T020", "order": 30, "token": "_書籍名_2_", "unit": "responsibility", "path": "P001",
                           "property": "PR002", "step": "ST001", "content": "x", "files": "x", "tests": "x", "message": "_書籍名_2_"})
        d["task_specs"].append({"task": "T020", "spec": "S003", "content": "x"})
    edit(ws, "tasks.toon", f)


@case("finding_open")
def finding_open(ws):
    edit(ws, "reviews.toon", lambda d: d["findings"][0].update(status="open"))


@case("reverify_missing")
def reverify_missing(ws):
    edit(ws, "reviews.toon", lambda d: d.update(rounds=[r for r in d["rounds"] if r["kind"] != "reverify"],
                                               reviewers=[r for r in d["reviewers"] if r["round"] != 2]))


@case("review_role_missing")
def role_missing(ws):
    edit(ws, "reviews.toon", lambda d: d.update(reviewers=[r for r in d["reviewers"] if r["role"] != "evidence_auditor"]))


@case("desk_missing")
def desk_missing(ws):
    edit(ws, "reviews.toon", lambda d: d.update(desk_checks=[x for x in d["desk_checks"] if x["scenario"] != "concurrent"]))


@case("question_open")
def question_open(ws):
    edit(ws, "decisions.toon", lambda d: d["questions"][0].update(status="open", answer=""))


@case("unconfirmed_untracked")
def unconfirmed_untracked(ws):
    edit(ws, "requirements.toon", lambda d: find(d["requirements"], id="R003").update(confidence="unconfirmed"))


@case("status_complete")
def complete_with_deferred(ws):
    def f(d):
        d["questions"].append({"id": "Q002", "layer": "requirement", "question": "金額の税込・税抜は？", "why": "表示が変わる", "options": "税込／税抜",
                               "recommendation": "税込", "answer": "", "answered_by": "none", "status": "deferred", "targets": "R003"})
    edit(ws, "decisions.toon", f)


@case("quality_unreviewed")
def quality_unreviewed(ws):
    edit(ws, "quality.toon", lambda d: d["viewpoints"][5].update(judgement="unreviewed", reason=""))


@case("quality_check_missing")
def quality_check_missing(ws):
    edit(ws, "quality.toon", lambda d: d.update(checks=d["checks"][1:]))


@case("behavior_not_traced")
def behavior_not_traced(ws):
    edit(ws, "needs.toon", lambda d: d.update(current_links=[]))


@case("dangling_ref")
def dangling_ref(ws):
    edit(ws, "specs.toon", lambda d: find(d["specs"], id="S003").update(requirement="R099"))


@case("duplicate_id")
def duplicate_id(ws):
    edit(ws, "tasks.toon", lambda d: find(d["tasks"], id="T011").update(id="S001"))


@case("row_columns")
def missing_column(ws):
    edit(ws, "tasks.toon", lambda d: find(d["tasks"], id="T011").pop("tests"))


@case("toon_syntax")
def broken_toon(ws):
    with open(os.path.join(ws, "needs.toon"), "a", encoding="utf-8") as f:
        f.write("\n  stray line")


@case("stage_not_done")
def stage_not_done(ws):
    edit(ws, "progress.toon", lambda d: find(d["stages"], key="verify").update(status="in_progress"))


@case("hit_unclassified")
def hit_unclassified(ws):
    edit(ws, "impact.toon", lambda d: d["hits"][3].update(disposition="unclassified", impact="", reason=""))


@case("hit_reason")
def hit_irrelevant_without_reason(ws):
    edit(ws, "impact.toon", lambda d: next(h for h in d["hits"] if h["disposition"] == "irrelevant").update(reason=""))


@case("change_missing_for_step")
def change_missing_for_step(ws):
    def f(d):
        d["changes"] = [c for c in d["changes"] if c["id"] != "CH003"]
        gone = {x["id"] for x in d["searches"] if x["change"] == "CH003"}
        d["searches"] = [x for x in d["searches"] if x["id"] not in gone]
        d["hits"] = [h for h in d["hits"] if h["search"] not in gone]
    edit(ws, "impact.toon", f)


@case("change_missing_for_property")
def change_missing_for_property(ws):
    def f(d):
        d["changes"] = [c for c in d["changes"] if c["id"] != "CH005"]
        gone = {x["id"] for x in d["searches"] if x["change"] == "CH005"}
        d["searches"] = [x for x in d["searches"] if x["id"] not in gone]
        d["hits"] = [h for h in d["hits"] if h["search"] not in gone]
    edit(ws, "impact.toon", f)


@case("search_missing")
def search_missing(ws):
    def f(d):
        gone = {x["id"] for x in d["searches"] if x["change"] == "CH007"}
        d["searches"] = [x for x in d["searches"] if x["id"] not in gone]
        d["hits"] = [h for h in d["hits"] if h["search"] not in gone]
    edit(ws, "impact.toon", f)


@case("hit_count")
def hit_count_mismatch(ws):
    edit(ws, "impact.toon", lambda d: d["searches"][0].update(hit_count=d["searches"][0]["hit_count"] + 1))


@case("cochange_unclassified")
def cochange_unclassified(ws):
    edit(ws, "impact.toon", lambda d: d["cochanges"][0].update(disposition="unclassified", reason=""))


@case("cochange_not_run")
def cochange_not_run(ws):
    edit(ws, "current.toon", lambda d: d.update(investigations=[r for r in d["investigations"] if r["id"] != "INV003"]))


@case("quality_reason_shared")
def quality_reason_shared(ws):
    def f(d):
        na = [v for v in d["viewpoints"] if v["judgement"] == "not_applicable"][:3]
        for v in na:
            v["reason"] = f"「{v['id']}」：安全に関わらない"
    edit(ws, "quality.toon", f)


@case("quality_sample_missing")
def quality_sample_missing(ws):
    edit(ws, "reviews.toon", lambda d: d.update(coverage=[r for r in d["coverage"] if "抜き取り" not in r["area"]]))


@case("outside_not_checked")
def outside_not_checked(ws):
    edit(ws, "current.toon", lambda d: d.update(investigations=[r for r in d["investigations"] if r["id"] != "INV004"]))


@case("impact_without_spec")
def must_change_without_spec(ws):
    edit(ws, "current.toon", lambda d: find(d["impacts"], id="I001").update(classification="must_change", specs=""))


@case("impact_spec_not_needed")
def must_change_with_satisfied_spec(ws):
    edit(ws, "current.toon", lambda d: find(d["impacts"], id="I001").update(classification="must_change"))


@case("impact_without_regression")
def regression_without_spec(ws):
    edit(ws, "current.toon", lambda d: find(d["impacts"], id="I001").update(specs=""))


@case("review_role_missing")
def impact_auditor_missing(ws):
    edit(ws, "reviews.toon", lambda d: d.update(reviewers=[r for r in d["reviewers"] if r["role"] != "impact_auditor"]))


def check_mutations(base):
    failures = 0
    for name, expect, fn in CASES:
        d = os.path.join(base, name)
        _, ws = sample_ledger.build(d)
        fn(ws)
        got, L = codes(ws)
        ok = expect in got
        if not ok or VERBOSE:
            print(f"{'ok  ' if ok else 'FAIL'} {name}: expect {expect}, got {sorted(set(got))}")
        failures += 0 if ok else 1
    print(f"mutations: {len(CASES) - failures}/{len(CASES)} detected")
    return failures


def check_clean(base):
    _, ws = sample_ledger.build(os.path.join(base, "clean"))
    got, L = codes(ws)
    if got or L.warnings:
        print(f"FAIL clean sample: errors {got} warnings {[w['code'] for w in L.warnings]}")
        return 1
    print("clean sample: no errors, no warnings")
    return 0


def check_derive(base):
    _, ws = sample_ledger.build(os.path.join(base, "derive"))
    edit(ws, "tasks.toon", lambda d: d.update(tasks=[], task_specs=[]))
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = ledger.main(["ledger.py", "derive-tasks", ws])
    d = load(ws, "tasks.toon")
    toks = [t["token"] for t in sorted(d["tasks"], key=lambda t: t["order"])]
    expect = [f"_書籍ID_{i}_" for i in range(1, 9)] + ["_書籍名_1_", "_金額_1_", "_解説_1_"]
    fails = 0
    if rc != 0 or toks != expect:
        print(f"FAIL derive: rc={rc} tokens={toks}")
        fails += 1
    links = {(l["task"], l["spec"]) for l in d["task_specs"]}
    t4 = next(t["id"] for t in d["tasks"] if t["token"] == "_書籍ID_4_")
    if (t4, "S002") not in links:
        print("FAIL derive: _書籍ID_4_ is not linked to S002")
        fails += 1
    got, _ = codes(ws)
    leftover = set(got) - {"empty_text", "task_spec_content", "token_message"}
    if leftover:
        print(f"FAIL derive: unexpected errors after derive {sorted(leftover)}")
        fails += 1
    # derive is idempotent and keeps text
    def fill(dd):
        for t in dd["tasks"]:
            t.update(content="c", files="f", tests="t", message=f"m {t['token']}")
        for l in dd["task_specs"]:
            l["content"] = "c"
    edit(ws, "tasks.toon", fill)
    with redirect_stdout(io.StringIO()):
        ledger.main(["ledger.py", "derive-tasks", ws])
    d2 = load(ws, "tasks.toon")
    if len(d2["tasks"]) != 11 or any(t["content"] != "c" for t in d2["tasks"]):
        print("FAIL derive: second run changed rows")
        fails += 1
    got, _ = codes(ws)
    if got:
        print(f"FAIL derive: filled ledger still has errors {sorted(set(got))}")
        fails += 1
    print(f"derive-tasks: {'ok' if not fails else 'FAIL'}")
    return fails


ID_RE = re.compile(r"(?<![A-Za-z0-9_])(?:N|R|S|T|PR|ST|SH|SC|ER|FD|RV|DC|SM|DT|INV|E|C|I|A|SRC|Q|CH|SR)\d{2,3}(?![0-9.])")


def check_render(base):
    _, ws = sample_ledger.build(os.path.join(base, "render"))
    with redirect_stdout(io.StringIO()):
        ledger.main(["ledger.py", "validate", ws, "--final", "--write"])
        rc1 = render_html.main(["render_html.py", "render", ws])
        rc2 = render_html.main(["render_html.py", "check", ws])
    fails = 0
    if rc1 != 0 or rc2 != 0:
        print(f"FAIL render: render={rc1} check={rc2}")
        fails += 1
    with open(os.path.join(ws, "report.html"), encoding="utf-8") as f:
        html_text = f.read()
    data = re.search(r"const PAGE_DATA = (.*?);\nconst TABLES_DATA = (.*?);\n", html_text, re.S)
    visible = (data.group(1) + data.group(2)) if data else ""
    body = re.sub(r"<script.*?</script>", "", html_text, flags=re.S)
    ids = sorted(set(ID_RE.findall(visible + body)))
    if ids:
        print(f"FAIL render: internal IDs are visible in the HTML: {ids[:20]}")
        fails += 1
    for must in ("_書籍ID_8_", "書籍の登録", "既存のまま", "同時に同じ書籍IDを登録したときの扱いがない"):
        if must not in html_text and must.encode("unicode_escape").decode() not in html_text:
            if must == "既存のまま":
                continue
            print(f"FAIL render: '{must}' not found in the HTML")
            fails += 1
    if "機械検査（final" not in html_text:
        print("FAIL render: validation state is not shown")
        fails += 1
    edit(ws, "tasks.toon", lambda d: d["tasks"][0].update(content="変えた"))
    with redirect_stdout(io.StringIO()):
        rc3 = render_html.main(["render_html.py", "check", ws])
    if rc3 == 0:
        print("FAIL render: check did not notice a changed TOON file")
        fails += 1
    # broken structure must stop rendering
    edit(ws, "tasks.toon", lambda d: d["tasks"][0].pop("files"))
    try:
        with redirect_stdout(io.StringIO()):
            render_html.render(ws)
        print("FAIL render: rendered a structurally broken ledger")
        fails += 1
    except SystemExit:
        pass
    print(f"render/check: {'ok' if not fails else 'FAIL'}")
    return fails


def check_impact_script(base):
    import subprocess
    import impact
    _, ws = sample_ledger.build(os.path.join(base, "impact"))
    repo = os.path.join(base, "impact", "repo")
    run = lambda *a: subprocess.run(["git", "-C", repo, *a], capture_output=True, check=True)
    run("init", "-q")
    run("config", "user.email", "t@example.com")
    run("config", "user.name", "t")
    run("add", "-A")
    run("commit", "-qm", "c1")
    for i in range(3):
        for rel in ("backend/src/BookService.java", "backend/src/BookController.java"):
            with open(os.path.join(repo, rel), "a", encoding="utf-8") as f:
                f.write(f"// {i}\n")
        run("add", "-A")
        run("commit", "-qm", f"c{i + 2}")
    with open(os.path.join(repo, "backend/src/BookExport.java"), "w", encoding="utf-8") as f:
        f.write("class BookExport { String book_id; }\n")
    fails = 0
    edit(ws, "impact.toon", lambda d: d.update(searches=[], hits=[], cochanges=[]))
    with redirect_stdout(io.StringIO()):
        impact.main(["impact.py", "search", ws, "--change", "CH005", "--term", "bookId", "--variants"])
        for c in load(ws, "impact.toon")["changes"]:
            if c["origin"] == "existing" and c["id"] != "CH005":
                impact.main(["impact.py", "search", ws, "--change", c["id"], "--term", c["name"].split(".")[-1]])
    d = load(ws, "impact.toon")
    terms = [x["term"] for x in d["searches"]]
    paths = {h["path"] for h in d["hits"]}
    if "book_id" not in terms or "backend/src/BookExport.java" not in paths:
        print(f"FAIL impact search: variants or untracked file missed (terms={terms}, paths={sorted(paths)})")
        fails += 1
    if any(h["path"].startswith("ledger") for h in d["hits"]):
        print("FAIL impact search: the ledger folder was searched")
        fails += 1
    got, _ = codes(ws)
    if "hit_unclassified" not in got:
        print("FAIL impact search: new hits are not reported as unclassified")
        fails += 1
    with redirect_stdout(io.StringIO()):
        impact.main(["impact.py", "classify", ws, "--all", "--disposition", "irrelevant", "--path-glob", "backend/*", "--reason", "x"])
        impact.main(["impact.py", "classify", ws, "--all", "--disposition", "impact", "--impact", "I001", "--reason", "y"])
        impact.main(["impact.py", "cochange", ws, "--min-count", "2", "--min-percent", "20"])
    d = load(ws, "impact.toon")
    if any(h["disposition"] == "unclassified" for h in d["hits"]):
        print("FAIL impact classify: unclassified hits remain")
        fails += 1
    pairs = {(r["file"], r["partner"]) for r in d["cochanges"]}
    if ("backend/src/BookService.java", "backend/src/BookController.java") not in pairs:
        print(f"FAIL impact cochange: expected pair not found {sorted(pairs)}")
        fails += 1
    with redirect_stdout(io.StringIO()):
        impact.main(["impact.py", "classify", ws, "--all", "--disposition", "same_change", "--reason", "z"])
    edit(ws, "impact.toon", lambda dd: [r.update(disposition="same_change", reason="z") for r in dd["cochanges"]])
    got, _ = codes(ws)
    left = [c for c in got if c.startswith(("hit_", "cochange_", "search_"))]
    if left:
        print(f"FAIL impact: errors remain after classification {sorted(set(left))}")
        fails += 1
    print(f"impact.py: {'ok' if not fails else 'FAIL'}")
    return fails


def main():
    for s in (sys.stdout,):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    base = tempfile.mkdtemp(prefix="eiti-test-")
    try:
        fails = check_clean(base) + check_mutations(base) + check_derive(base) + check_render(base) + check_impact_script(base)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    print("ALL OK" if not fails else f"{fails} FAILURE(S)")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
