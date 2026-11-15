#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a small sample repository and a complete ledger that passes
`ledger.py validate --final`. Used by test_ledger.py and as a worked example
(python tests/sample_ledger.py OUT_DIR writes it to OUT_DIR)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..", "scripts")
sys.path.insert(0, SCRIPTS)
import toon  # noqa: E402

REPO_FILES = {
    "frontend/src/types.ts": "export type Book = {\n  bookId: string; // 書籍ID\n  title: string; // 書籍名\n};\n",
    "frontend/src/BookList.tsx": "import { Book } from \"./types\";\nexport function BookList({ books }: { books: Book[] }) {\n  return <ul>{books.map(b => <li key={b.bookId}>{b.title}</li>)}</ul>;\n}\n",
    "frontend/src/api.ts": "export async function fetchBooks() {\n  return (await fetch(\"/api/books\")).json();\n}\n",
    "backend/src/BookController.java": "public class BookController {\n  private final BookService service;\n  public List<Book> list() { return service.findAll(); }\n}\n",
    "backend/src/BookService.java": "public class BookService {\n  private final BookRepository repository;\n  public List<Book> findAll() { return repository.findAll(); }\n}\n",
    "backend/src/BookRepository.java": "public interface BookRepository {\n  List<Book> findAll();\n}\n",
    "backend/src/schema.sql": "create table books (\n  book_id varchar(13) primary key,\n  title varchar(200) not null\n);\n",
}

PATH = "P001"
STEPS = [
    ("ST001", 1, "フロントエンド（画面）", "書籍を選ぶ・入力する", "new", "none", 0, ""),
    ("ST002", 2, "フロントエンド（送信）", "登録のリクエストを送る", "changed", "frontend/src/api.ts", 1, "export async function fetchBooks() {"),
    ("ST003", 3, "バックエンド（コントローラー）", "リクエストを受け取る", "changed", "backend/src/BookController.java", 1, "public class BookController {"),
    ("ST004", 4, "バックエンド（サービス）", "登録の可否を判定する", "changed", "backend/src/BookService.java", 1, "public class BookService {"),
    ("ST005", 5, "バックエンド（リポジトリ）", "書籍を保存する", "changed", "backend/src/BookRepository.java", 1, "public interface BookRepository {"),
    ("ST006", 6, "バックエンド（サービスの応答）", "登録結果を作る", "changed", "backend/src/BookService.java", 1, "public class BookService {"),
    ("ST007", 7, "バックエンド（コントローラーの応答）", "応答を返す", "changed", "backend/src/BookController.java", 1, "public class BookController {"),
    ("ST008", 8, "フロントエンド（結果の表示）", "登録結果を表示する", "new", "none", 0, ""),
]
ACTIONS = ["input", "send", "receive", "validate", "save", "return", "return", "display"]


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def save(ws, name, doc):
    write(os.path.join(ws, name), toon.encode(doc))


def build(base):
    repo = os.path.join(base, "repo")
    ws = os.path.join(base, "ledger")
    for rel, text in REPO_FILES.items():
        write(os.path.join(repo, rel), text)
    os.makedirs(ws, exist_ok=True)
    stages = [("prepare", "準備"), ("current", "現状の調査"), ("needs", "要求"), ("requirements", "要件"), ("quality", "品質の観点"),
              ("specs", "仕様"), ("design", "経路の設計"), ("impact", "影響範囲"), ("tasks", "タスク"), ("verify", "検証"), ("output", "出力")]
    save(ws, "progress.toon", {
        "skill": "micropower-investigate", "topic": "書籍の登録", "status": "complete",
        "current_stage": "output", "updated": "2026-11-15 15:00", "next": "なし",
        "stages": [{"key": k, "name": n, "status": "in_progress" if k == "output" else "done", "note": ""} for k, n in stages]})
    save(ws, "scope.toon", {
        "topic": "書籍の登録", "request": "書籍を登録できるようにしたい（書籍ID、書籍名、金額、解説）", "kind": "mixed",
        "repo_root": repo.replace("\\", "/"), "git_commit": "", "git_dirty": False, "output_dir": ws.replace("\\", "/"),
        "created": "2026-11-15", "commit_format": "feat(book): {token} {content}", "commit_format_source": "利用者の指示（見本）",
        "in_scope": [{"item": "書籍の登録の経路", "reason": "依頼"}],
        "out_of_scope": [{"item": "書籍の削除", "reason": "依頼にない"}]})
    save(ws, "sources.toon", {"sources": [
        {"id": f"SRC{i:03d}", "kind": "code" if not rel.endswith(".sql") else "schema", "path": rel, "version": "", "reliability": "fact", "note": ""}
        for i, rel in enumerate(REPO_FILES, 1)]})
    save(ws, "current.toon", {
        "investigations": [
            {"id": "INV001", "area": "書籍の一覧の入口から保存まで", "method": "static", "status": "done", "boundary_reason": "", "note": ""},
            {"id": "INV002", "area": "書籍テーブルを読み書きする他の入口", "method": "static", "status": "done", "boundary_reason": "", "note": "一覧だけ"},
            {"id": "INV003", "area": "変更の共起（git の履歴）", "method": "history", "status": "done", "boundary_reason": "", "note": "見本"},
            {"id": "INV004", "area": "リポジトリの外の利用者", "method": "static", "status": "partial",
             "boundary_reason": "見本：DB を直接読む集計の有無は運用担当に確認する", "note": ""}],
        "entrypoints": [{"id": "E001", "kind": "screen", "name": "書籍の一覧画面", "ev_path": "frontend/src/BookList.tsx", "ev_line": 2,
                         "ev_quote": "export function BookList({ books }: { books: Book[] }) {"}],
        "behaviors": [{"id": "C001", "entry": "E001", "statement": "書籍の一覧に書籍名を表示する。", "ev_path": "frontend/src/BookList.tsx", "ev_line": 3,
                       "ev_quote": "<li key={b.bookId}>{b.title}</li>", "confidence": "fact", "purpose": "在庫の書籍を確かめるため",
                       "treatment": "keep", "reason": "登録後も一覧で確かめる"}],
        "impacts": [{"id": "I001", "target": "書籍の一覧画面", "relation": "shared_data", "ev_path": "backend/src/BookService.java", "ev_line": 3,
                     "ev_quote": "public List<Book> findAll() { return repository.findAll(); }", "condition": "登録した書籍が一覧に出る",
                     "classification": "keep_regression", "reason": "一覧は書籍名だけを表示し、新しい列の影響を受けない", "specs": "S006"}]})
    save(ws, "needs.toon", {
        "stakeholders": [{"id": "SH01", "name": "書店員", "kind": "direct_user", "note": ""},
                         {"id": "SH02", "name": "店長", "kind": "admin", "note": ""}],
        "scenes": [{"id": "SC01", "name": "入荷したとき", "note": ""}, {"id": "SC02", "name": "月末の棚卸し", "note": ""}],
        "needs": [
            {"id": "N001", "who": "SH01", "scene": "SC01", "want": "入荷した書籍を在庫に登録したい", "why": "棚に出す前に在庫数を正しく保つため",
             "obstacle": "今は登録の画面がない", "origin": "request", "confidence": "claim", "adoption": "adopted", "reason": ""},
            {"id": "N002", "who": "SH02", "scene": "SC02", "want": "同じ書籍が二重に数えられていない在庫数を見たい", "why": "棚卸しの差異を減らすため",
             "obstacle": "", "origin": "stakeholder", "confidence": "hypothesis", "adoption": "adopted", "reason": ""},
            {"id": "N003", "who": "SH01", "scene": "SC01", "want": "登録した書籍を一覧で確かめたい", "why": "登録できたかを確かめるため",
             "obstacle": "", "origin": "current", "confidence": "fact", "adoption": "adopted", "reason": ""}],
        "frame": [
            {"stakeholder": "SH01", "scene": "SC01", "result": "need", "needs": "N001 N003", "reason": ""},
            {"stakeholder": "SH01", "scene": "SC02", "result": "none", "needs": "", "reason": "棚卸しは店長が行う"},
            {"stakeholder": "SH02", "scene": "SC01", "result": "none", "needs": "", "reason": "入荷の作業は書店員が行う"},
            {"stakeholder": "SH02", "scene": "SC02", "result": "need", "needs": "N002", "reason": ""}],
        "current_links": [{"behavior": "C001", "needs": "N003"}]})
    reqs = [
        {"id": "R001", "kind": "function", "statement": "書籍を1冊ずつ登録できること", "reason": "入荷した書籍を在庫に入れるため",
         "acceptance": "登録した書籍が一覧に出る", "status": "adopted", "confidence": "decided"},
        {"id": "R002", "kind": "data", "statement": "同じ書籍IDの書籍を二重に登録しないこと", "reason": "在庫数を二重に数えないため",
         "acceptance": "登録済みの書籍IDでは登録できない", "status": "adopted", "confidence": "decided"},
        {"id": "R003", "kind": "data", "statement": "金額は0以上の整数で登録すること", "reason": "在庫の金額の集計を正しくするため",
         "acceptance": "負の金額では登録できない", "status": "adopted", "confidence": "decided"},
        {"id": "R004", "kind": "function", "statement": "既存の書籍の一覧表示を変えないこと", "reason": "登録の確認に使うため",
         "acceptance": "登録後も一覧が今と同じ形で表示される", "status": "adopted", "confidence": "fact"}]
    links = [("N001", "R001"), ("N001", "R003"), ("N002", "R002"), ("N003", "R004")]
    frame = []
    for nid, rel in (("N001", {"function": "R001", "data": "R003"}), ("N002", {"data": "R002"}), ("N003", {"function": "R004"})):
        for vp in ["function", "data", "quality", "operation", "migration", "constraint"]:
            if vp in rel:
                frame.append({"need": nid, "viewpoint": vp, "result": "requirement", "requirements": rel[vp], "reason": ""})
            else:
                frame.append({"need": nid, "viewpoint": vp, "result": "not_needed", "requirements": "", "reason": "見本のため、この観点の要件はない"})
    save(ws, "requirements.toon", {"requirements": reqs, "need_links": [{"need": n, "requirement": r} for n, r in links], "frame": frame})
    # quality: every viewpoint judged; one applicable viewpoint with its checks
    with open(os.path.join(HERE, "..", "references", "quality", "catalog.json"), encoding="utf-8") as f:
        cat = json.load(f)
    vps, checks = [], []
    for g in cat["groups"]:
        for s in g["subcharacteristics"]:
            for v in s["viewpoints"]:
                if v["id"] == "Q01.01.001":
                    vps.append({"id": v["id"], "judgement": "applicable", "requirements": "R001", "reason": "登録の網羅を確かめる"})
                    for c in v["checks"]:
                        checks.append({"id": c["id"], "viewpoint": v["id"], "judgement": "reflected", "requirements": "R001", "reason": ""})
                else:
                    vps.append({"id": v["id"], "judgement": "not_applicable", "requirements": "", "reason": f"見本：{v['text']} は、この見本の登録の経路では起きない（見本の番号 {len(vps)}）"})
    save(ws, "quality.toon", {"catalog_version": cat["catalog_version"], "viewpoints": vps, "checks": checks})
    props = [
        {"id": "PR001", "name": "書籍ID", "code_name": "bookId", "origin": "existing_code", "type": "文字列", "required": "yes",
         "constraint": "13文字", "default_value": "", "display": "そのまま", "existing_data": "既存の書籍は値がある",
         "ev_path": "frontend/src/types.ts", "ev_line": 2, "ev_quote": "bookId: string; // 書籍ID", "confidence": "fact"},
        {"id": "PR002", "name": "書籍名", "code_name": "title", "origin": "existing_code", "type": "文字列", "required": "yes",
         "constraint": "200文字以内", "default_value": "", "display": "そのまま", "existing_data": "既存の書籍は値がある",
         "ev_path": "frontend/src/types.ts", "ev_line": 3, "ev_quote": "title: string; // 書籍名", "confidence": "fact"},
        {"id": "PR003", "name": "金額", "code_name": "", "origin": "new", "type": "整数", "required": "yes",
         "constraint": "0以上", "default_value": "", "display": "3桁区切り", "existing_data": "既存の書籍は0を入れる",
         "ev_path": "none", "ev_line": 0, "ev_quote": "", "confidence": "decided"},
        {"id": "PR004", "name": "解説", "code_name": "", "origin": "new", "type": "文字列", "required": "no",
         "constraint": "2000文字以内", "default_value": "空", "display": "改行を保って表示", "existing_data": "既存の書籍は空",
         "ev_path": "none", "ev_line": 0, "ev_quote": "", "confidence": "decided"}]
    specs = [
        ("S001", "R001", "PR001", "behavior", "登録画面で書籍を選んで登録すると、登録結果が表示される。", "書籍を1冊ずつ登録できるため"),
        ("S002", "R002", "PR001", "error", "登録済みの書籍IDで登録すると「すでに登録されています」と表示し、登録しない。", "二重登録を防ぐため"),
        ("S003", "R001", "PR002", "validation", "書籍名は必須で、200文字以内にする。", "登録に必要な情報のため"),
        ("S004", "R003", "PR003", "validation", "金額は0以上の整数で、未入力・負の値は登録しない。", "金額の集計を正しくするため"),
        ("S005", "R001", "PR004", "display", "解説は任意で2000文字以内、改行を保って表示する。", "書籍の説明を残すため")]
    spec_rows = [{"id": i, "requirement": r, "path": PATH, "property": p, "kind": k, "statement": st, "reason": rs,
                  "implementation": "needed", "confidence": "decided"} for i, r, p, k, st, rs in specs]
    spec_rows.append({"id": "S006", "requirement": "R004", "path": "", "property": "", "kind": "crosscut",
                      "statement": "既存の書籍の一覧は、書籍名を表示するまま変えない。", "reason": "一覧表示を変えないため",
                      "implementation": "already_satisfied", "confidence": "fact"})
    acceptance = [{"id": f"A{i:03d}", "spec": s["id"], "given": "登録画面を開いている", "when": "条件どおりに登録する", "then": s["statement"]}
                  for i, s in enumerate(spec_rows, 1)]
    save(ws, "specs.toon", {
        "paths": [{"id": PATH, "name": "書籍の登録", "trigger": "書店員が登録画面で書籍を選ぶ", "end": "登録結果が画面に表示される",
                   "kind": "new", "requirements": "R001 R002 R003"}],
        "properties": props,
        "path_properties": [{"path": PATH, "property": "PR001", "first": True, "reason": "書籍IDがないと登録する対象を特定できない"},
                            {"path": PATH, "property": "PR002", "first": False, "reason": ""},
                            {"path": PATH, "property": "PR003", "first": False, "reason": ""},
                            {"path": PATH, "property": "PR004", "first": False, "reason": ""}],
        "specs": spec_rows, "acceptance": acceptance,
        "machines": [], "states": [], "events": [], "transitions": [],
        "decision_tables": [{"id": "DT01", "name": "登録の可否", "path": PATH}],
        "conditions": [{"table": "DT01", "condition": "registered", "values": "yes no"},
                       {"table": "DT01", "condition": "amount", "values": "valid invalid"}],
        "rules": [{"table": "DT01", "when": "registered=yes", "outcome": "拒否（すでに登録されています）", "specs": "S002"},
                  {"table": "DT01", "when": "registered=no amount=valid", "outcome": "登録する", "specs": "S001"},
                  {"table": "DT01", "when": "registered=no amount=invalid", "outcome": "拒否（金額が不正）", "specs": "S004"}],
        "crud": [{"entity": "書籍", "path": PATH, "create": "Y", "read": "Y", "update": "N", "delete": "N", "reason": "登録の前に重複を読む"}],
        "errors": [{"id": "ER001", "path": PATH, "failure": "登録済みの書籍ID", "detect_step": "ST004", "response": "409 と理由",
                    "display": "「すでに登録されています」", "record": "記録しない（業務上の拒否のため）", "specs": "S002"},
                   {"id": "ER002", "path": PATH, "failure": "金額が不正", "detect_step": "ST003", "response": "400 と項目名",
                    "display": "金額の欄に理由を表示", "record": "記録しない（入力の誤りのため）", "specs": "S004"}]})
    matrix = []
    for prop, spec in (("PR001", "S001"), ("PR002", "S003"), ("PR003", "S004"), ("PR004", "S005")):
        for (sid, order, *_), action in zip(STEPS, ACTIONS):
            specs_here = spec
            if prop == "PR001" and order in (4, 6, 7, 8):
                specs_here = "S001 S002"
            if prop == "PR004" and order == 4:
                matrix.append({"path": PATH, "property": prop, "step": sid, "action": "none", "result": "not_handled", "specs": "",
                               "reason": "サービスは解説を判定に使わない"})
                continue
            matrix.append({"path": PATH, "property": prop, "step": sid, "action": action, "result": "change", "specs": specs_here, "reason": ""})
    save(ws, "design.toon", {
        "steps": [{"id": i, "path": PATH, "order": o, "name": n, "responsibility": r, "origin": og, "ev_path": p, "ev_line": l, "ev_quote": q}
                  for i, o, n, r, og, p, l, q in STEPS],
        "matrix": matrix})
    changes = [
        ("CH001", "function", "fetchBooks", "frontend/src/api.ts", 1, "export async function fetchBooks() {"),
        ("CH002", "class", "BookController", "backend/src/BookController.java", 1, "public class BookController {"),
        ("CH003", "class", "BookService", "backend/src/BookService.java", 1, "public class BookService {"),
        ("CH004", "class", "BookRepository", "backend/src/BookRepository.java", 1, "public interface BookRepository {"),
        ("CH005", "field", "Book.bookId", "frontend/src/types.ts", 2, "bookId: string; // 書籍ID"),
        ("CH006", "field", "Book.title", "frontend/src/types.ts", 3, "title: string; // 書籍名"),
        ("CH007", "table", "books", "backend/src/schema.sql", 1, "create table books ("),
    ]
    terms = {"CH001": "fetchBooks", "CH002": "BookController", "CH003": "BookService", "CH004": "BookRepository",
             "CH005": "bookId", "CH006": "title", "CH007": "books"}
    searches, hits = [], []
    for k, (cid, kind, name, path, line, quote) in enumerate(changes, 1):
        sid = f"SR{k:03d}"
        found = []
        for rel, text in REPO_FILES.items():
            for i, l in enumerate(text.split("\n"), 1):
                if terms[cid] in l:
                    found.append((rel, i, l.strip()))
        searches.append({"id": sid, "change": cid, "term": terms[cid], "scope": "リポジトリ全体（台帳のフォルダーを除く）",
                         "tool": "見本", "hit_count": len(found), "status": "done", "note": ""})
        for rel, i, l in found:
            if rel == path:
                d, imp, why = "definition", "", "変更する箇所そのもの"
            elif rel == "frontend/src/BookList.tsx":
                d, imp, why = "impact", "I001", "一覧画面が同じデータを表示する"
            else:
                d, imp, why = "irrelevant", "", "見本：名前が一致するだけで、この変更の影響を受けない"
            hits.append({"search": sid, "path": rel, "line": i, "text": l, "disposition": d, "impact": imp, "reason": why})
    save(ws, "impact.toon", {
        "changes": [{"id": c, "kind": k, "name": n, "origin": "existing", "ev_path": p, "ev_line": l, "ev_quote": q, "note": ""}
                    for c, k, n, p, l, q in changes]
                   + [{"id": "CH008", "kind": "column", "name": "books.price", "origin": "new", "ev_path": "none", "ev_line": 0, "ev_quote": "", "note": ""},
                      {"id": "CH009", "kind": "column", "name": "books.description", "origin": "new", "ev_path": "none", "ev_line": 0, "ev_quote": "", "note": ""}],
        "searches": searches, "hits": hits,
        "cochanges": [{"file": "backend/src/BookService.java", "partner": "backend/src/BookController.java", "count": 3, "percent": 60,
                       "disposition": "same_change", "impact": "", "reason": "どちらも変更する箇所"},
                      {"file": "backend/src/BookService.java", "partner": "frontend/src/BookList.tsx", "count": 2, "percent": 40,
                       "disposition": "impact", "impact": "I001", "reason": "一覧画面が同じデータを表示する"}]})
    tasks, task_specs = [], []
    for k, (sid, order, name, resp, *_r) in enumerate(STEPS, 1):
        tok = f"_書籍ID_{k}_"
        tasks.append({"id": f"T{k:03d}", "order": k, "token": tok, "unit": "responsibility", "path": PATH, "property": "PR001", "step": sid,
                      "content": f"{name}が書籍IDを扱う（{resp}）", "files": "（見本）", "tests": "この段の単体テスト",
                      "message": f"feat(book): {tok} {name}が書籍IDを扱う"})
        for s in (["S001", "S002"] if order in (4, 6, 7, 8) else ["S001"]):
            task_specs.append({"task": f"T{k:03d}", "spec": s, "content": f"{name}で{s}の分を扱う"})
    for k, (prop, pname, spec) in enumerate((("PR002", "書籍名", "S003"), ("PR003", "金額", "S004"), ("PR004", "解説", "S005")), 9):
        tok = f"_{pname}_1_"
        tasks.append({"id": f"T{k:03d}", "order": k, "token": tok, "unit": "property", "path": PATH, "property": prop, "step": "",
                      "content": f"{pname}プロパティを追加（画面→バックエンド→画面）", "files": "（見本）", "tests": "経路を通すテスト",
                      "message": f"feat(book): {tok} {pname}プロパティを追加"})
        task_specs.append({"task": f"T{k:03d}", "spec": spec, "content": f"{pname}の検証と表示"})
    save(ws, "tasks.toon", {"tasks": tasks, "task_specs": task_specs})
    roles = ["builder", "tester", "operator", "end_user", "adversary", "evidence_auditor", "trace_auditor", "impact_auditor"]
    reviewers = [{"id": f"RV{i:02d}", "round": 1, "role": r, "scope": "台帳の全体", "status": "done", "output": ""} for i, r in enumerate(roles, 1)]
    reviewers.append({"id": "RV10", "round": 2, "role": "trace_auditor", "scope": "直した箇所", "status": "done", "output": ""})
    desk = [{"id": f"DC{i:03d}", "path": PATH, "scenario": sc, "result": "determined", "walk": f"{sc} の場面で、最終の表示まで決まる",
             "findings": "", "reason": ""} for i, sc in enumerate(["normal", "reject", "boundary", "existing_data", "concurrent", "partial_failure", "permission"], 1)]
    save(ws, "reviews.toon", {
        "rounds": [{"round": 1, "kind": "independent", "date": "2026-11-15", "note": ""},
                   {"round": 2, "kind": "reverify", "date": "2026-11-15", "note": ""}],
        "reviewers": reviewers,
        "findings": [{"id": "FD001", "round": 1, "reviewer": "RV05", "layer": "spec", "targets": "S002", "kind": "omission", "severity": "high",
                      "statement": "同時に同じ書籍IDを登録したときの扱いがない", "scenario": "2人が同時に同じ書籍IDで登録する",
                      "evidence": "S002 は事前の確認だけ", "status": "fixed", "resolution": "保存時の一意制約で2件目を拒否すると S002 に足した",
                      "verified_by": "RV10"}],
        "desk_checks": desk,
        "coverage": [{"area": "書籍の登録の経路", "checked": "全段と全プロパティ", "not_checked": "なし"},
                     {"area": "品質の観点の抜き取り", "checked": "見本：副特性ごとに2件", "not_checked": "なし"}]})
    save(ws, "decisions.toon", {"questions": [
        {"id": "Q001", "layer": "spec", "question": "金額に上限を設けますか？", "why": "入力の検証が変わる", "options": "なし／100万円",
         "recommendation": "なし（見本）", "answer": "上限なしでよい", "answered_by": "user", "status": "answered", "targets": "S004"}]})
    return repo, ws


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "_sample")
    r, w = build(out)
    print(f"repo: {r}\nledger: {w}")
