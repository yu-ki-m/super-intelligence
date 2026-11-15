#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Ledger tool for micropower-investigate.

The ledger is a folder of TOON files (toon-spec 4.4). This script is the single
source of truth for their schema and checks the structure, the two-way
traceability, the coverage frames, the task granularity rule and the evidence
quotes against the repository. It never judges whether the content is right.

Commands (run with: python -X utf8 ledger.py <command> ...):
  init DIR --topic T --repo PATH [--kind new|change|mixed]
        create the ledger skeleton (refuses to overwrite existing files)
  validate DIR [--gate STAGE | --final] [--write]
        structural checks always; --gate adds completeness checks for STAGE and
        the stages before it; --final adds every completeness check.
        --write stores the result in DIR/validation.toon. Exit 0 = no errors.
  derive-tasks DIR
        add the task rows and task-spec links that the granularity rule requires
        (from specs.toon and design.toon) and renumber the tokens. Existing rows
        and their text are kept. New rows have empty text to fill in.
  stage DIR KEY STATUS [--next TEXT]
        set a stage status in progress.toon (pending|in_progress|done|skipped)
  fmt DIR
        rewrite every TOON file in canonical form (fails on decode errors)
  schema [--markdown]
        print the schema
  status DIR
        print counts per table and the open items
"""
import argparse
import datetime
import os
import re
import sys
from itertools import product

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toon  # noqa: E402

CONF = ["fact", "claim", "hypothesis", "decided", "unconfirmed"]
STAGES = [
    ("prepare", "準備"),
    ("current", "現状の調査"),
    ("needs", "要求"),
    ("requirements", "要件"),
    ("quality", "品質の観点"),
    ("specs", "仕様"),
    ("design", "経路の設計"),
    ("impact", "影響範囲"),
    ("tasks", "タスク"),
    ("verify", "検証"),
    ("output", "出力"),
]
STAGE_KEYS = [k for k, _ in STAGES]
REQUIRED_ROLES = ["builder", "tester", "operator", "end_user", "adversary", "evidence_auditor", "trace_auditor", "impact_auditor"]
DESK_SCENARIOS = ["normal", "reject", "boundary", "existing_data", "concurrent", "partial_failure", "permission"]
VIEWPOINTS = ["function", "data", "quality", "operation", "migration", "constraint"]


def C(kind, desc, **kw):
    d = {"kind": kind, "desc": desc}
    d.update(kw)
    return d


# column kinds: id, ref(target), refs(target), text, opt, enum(values), int, bool, evpath, evline, evquote
SCHEMA = {
    "progress.toon": {
        "desc": "進み具合（再開の起点）",
        "scalars": {
            "skill": C("text", "スキル名"),
            "topic": C("text", "調査の題目"),
            "status": C("enum", "全体の状態", values=["in_progress", "provisional", "complete"]),
            "current_stage": C("enum", "今の段階", values=STAGE_KEYS),
            "updated": C("text", "最終更新日時"),
            "next": C("opt", "次にやること（初めて読む人が続けられる具体さで）"),
        },
        "tables": {
            "stages": {
                "desc": "段階ごとの状態",
                "cols": {
                    "key": C("enum", "段階", values=STAGE_KEYS),
                    "name": C("text", "段階の名前"),
                    "status": C("enum", "状態", values=["pending", "in_progress", "done", "skipped"]),
                    "note": C("opt", "メモ（skipped は理由必須）"),
                },
            }
        },
    },
    "scope.toon": {
        "desc": "範囲と前提",
        "scalars": {
            "topic": C("text", "題目"),
            "request": C("text", "依頼の原文（改変しない）"),
            "kind": C("enum", "新規か既存の改修か", values=["new", "change", "mixed"]),
            "repo_root": C("text", "対象リポジトリの絶対パス"),
            "git_commit": C("opt", "調べた時点のコミット"),
            "git_dirty": C("bool", "未コミットの変更があったか"),
            "output_dir": C("text", "台帳の置き場所"),
            "created": C("text", "作成日"),
            "commit_format": C("opt", "コミットメッセージの形（例: feat(book): {token} {content}）"),
            "commit_format_source": C("opt", "コミットメッセージの形の出所（設定・履歴・利用者の指示）"),
        },
        "tables": {
            "in_scope": {"desc": "範囲に入れるもの", "cols": {"item": C("text", "対象"), "reason": C("opt", "理由")}},
            "out_of_scope": {"desc": "範囲に入れないもの", "cols": {"item": C("text", "対象"), "reason": C("text", "理由")}},
        },
    },
    "sources.toon": {
        "desc": "情報源の台帳",
        "tables": {
            "sources": {
                "desc": "調べた情報源",
                "cols": {
                    "id": C("id", "ID（SRC001）"),
                    "kind": C("enum", "種類", values=["code", "test", "config", "schema", "doc", "conversation", "ticket", "log", "other"]),
                    "path": C("text", "場所"),
                    "version": C("opt", "版・コミット"),
                    "reliability": C("enum", "信頼の扱い（doc は保守されていない前提で unreliable_doc）", values=["fact", "unreliable_doc", "claim", "other"]),
                    "note": C("opt", "メモ"),
                },
            }
        },
    },
    "current.toon": {
        "desc": "現状の調査（既存の改修のとき）",
        "tables": {
            "investigations": {
                "desc": "調査台帳（何をどこまで調べたか）",
                "cols": {
                    "id": C("id", "ID（INV001）"),
                    "area": C("text", "調べた範囲（入口、呼び出し元、共有データなど）"),
                    "method": C("enum", "方法", values=["static", "run", "test", "history"]),
                    "status": C("enum", "状態", values=["done", "partial", "not_done", "out_of_scope"]),
                    "boundary_reason": C("opt", "調査を止めた境界と理由（partial/not_done/out_of_scope は必須）"),
                    "note": C("opt", "メモ"),
                },
            },
            "entrypoints": {
                "desc": "入口（画面、API、一括処理、CSV、イベントなど）",
                "cols": {
                    "id": C("id", "ID（E001）"),
                    "kind": C("enum", "種類", values=["screen", "api", "batch", "csv", "event", "cli", "admin", "external", "other"]),
                    "name": C("text", "名前"),
                    "ev_path": C("evpath", "根拠のファイル（リポジトリからの相対パス）"),
                    "ev_line": C("evline", "根拠の行"),
                    "ev_quote": C("evquote", "根拠の行にある文字列（そのまま）"),
                },
            },
            "behaviors": {
                "desc": "現行の仕様（観察した振る舞い）",
                "cols": {
                    "id": C("id", "ID（C001）"),
                    "entry": C("ref", "入口", target="entrypoints", optional=True),
                    "statement": C("text", "振る舞い"),
                    "ev_path": C("evpath", "根拠のファイル"),
                    "ev_line": C("evline", "根拠の行"),
                    "ev_quote": C("evquote", "根拠の文字列"),
                    "confidence": C("enum", "確からしさ", values=CONF),
                    "purpose": C("opt", "誰の何を守るための振る舞いか（分かる範囲）"),
                    "treatment": C("enum", "処遇", values=["keep", "change", "remove", "unconfirmed"]),
                    "reason": C("opt", "処遇の理由"),
                },
            },
            "impacts": {
                "desc": "影響先",
                "cols": {
                    "id": C("id", "ID（I001）"),
                    "target": C("text", "影響先"),
                    "relation": C("enum", "関係", values=["direct", "caller", "callee", "downstream", "shared_data", "shared_component", "indirect"]),
                    "ev_path": C("evpath", "根拠のファイル"),
                    "ev_line": C("evline", "根拠の行"),
                    "ev_quote": C("evquote", "根拠の文字列"),
                    "condition": C("opt", "影響が生じる条件"),
                    "classification": C("enum", "分類", values=["must_change", "keep_regression", "no_impact", "unconfirmed"]),
                    "reason": C("text", "分類の理由（no_impact は根拠必須）"),
                    "specs": C("refs", "対応する仕様（影響範囲の段階で必須。must_change は実装が要る仕様、keep_regression は回帰を確かめる仕様）", target="specs"),
                },
            },
        },
    },
    "needs.toon": {
        "desc": "要求",
        "tables": {
            "stakeholders": {"desc": "関係者", "cols": {
                "id": C("id", "ID（SH01）"), "name": C("text", "名前"),
                "kind": C("enum", "種類", values=["direct_user", "admin", "operator", "support", "auditor", "external_system", "data_owner", "developer", "other"]),
                "note": C("opt", "メモ")}},
            "scenes": {"desc": "場面", "cols": {"id": C("id", "ID（SC01）"), "name": C("text", "名前"), "note": C("opt", "メモ")}},
            "needs": {"desc": "要求", "cols": {
                "id": C("id", "ID（N001）"),
                "who": C("ref", "誰が", target="stakeholders"),
                "scene": C("ref", "どの場面で", target="scenes"),
                "want": C("text", "何をしたいか"),
                "why": C("text", "なぜ"),
                "obstacle": C("opt", "何が妨げか"),
                "origin": C("enum", "由来", values=["request", "stakeholder", "current", "quality", "inferred"]),
                "confidence": C("enum", "確からしさ", values=CONF),
                "adoption": C("enum", "扱い", values=["adopted", "out_of_scope", "pending"]),
                "reason": C("opt", "扱いの理由")}},
            "frame": {"desc": "関係者×場面の表（全組を埋める）", "cols": {
                "stakeholder": C("ref", "関係者", target="stakeholders"),
                "scene": C("ref", "場面", target="scenes"),
                "result": C("enum", "結果", values=["need", "none", "out_of_scope", "unconfirmed"]),
                "needs": C("refs", "要求", target="needs"),
                "reason": C("opt", "none/out_of_scope の理由")}},
            "current_links": {"desc": "現行の仕様から要求へ", "cols": {
                "behavior": C("ref", "現行の仕様", target="behaviors"),
                "needs": C("refs", "要求", target="needs")}},
        },
    },
    "requirements.toon": {
        "desc": "要件",
        "tables": {
            "requirements": {"desc": "要件", "cols": {
                "id": C("id", "ID（R001）"),
                "kind": C("enum", "種類", values=VIEWPOINTS),
                "statement": C("text", "満たすべき条件"),
                "reason": C("text", "理由"),
                "acceptance": C("text", "受入条件"),
                "status": C("enum", "採否", values=["adopted", "proposed", "deferred", "rejected"]),
                "confidence": C("enum", "確からしさ", values=CONF)}},
            "need_links": {"desc": "要求と要件の対応（多対多）", "cols": {
                "need": C("ref", "要求", target="needs"), "requirement": C("ref", "要件", target="requirements")}},
            "frame": {"desc": "要求×観点の表（採用した要求ごとに6観点）", "cols": {
                "need": C("ref", "要求", target="needs"),
                "viewpoint": C("enum", "観点", values=VIEWPOINTS),
                "result": C("enum", "結果", values=["requirement", "not_needed", "out_of_scope", "unconfirmed"]),
                "requirements": C("refs", "要件", target="requirements"),
                "reason": C("opt", "not_needed/out_of_scope の理由")}},
        },
    },
    "quality.toon": {
        "desc": "品質の観点の台帳（quality.py が作る）",
        "scalars": {"catalog_version": C("text", "カタログの版")},
        "tables": {
            "viewpoints": {"desc": "605観点の一次選別", "cols": {
                "id": C("text", "観点ID（Q01.01.001）"),
                "judgement": C("enum", "判定", values=["unreviewed", "applicable", "not_applicable", "unknown", "out_of_scope"]),
                "requirements": C("refs", "反映した要件", target="requirements"),
                "reason": C("opt", "理由")}},
            "checks": {"desc": "適用あり・不明の観点の確認項目", "cols": {
                "id": C("text", "確認項目ID（Q01.01.001.01）"),
                "viewpoint": C("text", "観点ID"),
                "judgement": C("enum", "判定", values=["reflected", "not_needed", "unknown", "out_of_scope"]),
                "requirements": C("refs", "反映した要件", target="requirements"),
                "reason": C("opt", "理由")}},
        },
    },
    "specs.toon": {
        "desc": "仕様",
        "tables": {
            "paths": {"desc": "経路（利用者の1つの操作の始まりから終わりまで）", "cols": {
                "id": C("id", "ID（P001）"), "name": C("text", "名前"),
                "trigger": C("text", "始まり"), "end": C("text", "終わり（戻りの表示まで）"),
                "kind": C("enum", "新しい経路か、既存の経路の変更か", values=["new", "change"]),
                "requirements": C("refs", "実現する要件", target="requirements")}},
            "properties": {"desc": "プロパティの定義", "cols": {
                "id": C("id", "ID（PR001）"),
                "name": C("text", "文言に使う名前（既存コードの表示名、なければ識別子）"),
                "code_name": C("opt", "コード上の識別子"),
                "origin": C("enum", "既存のコードにあるか", values=["existing_code", "new"]),
                "type": C("text", "型"),
                "required": C("enum", "必須か", values=["yes", "no", "conditional"]),
                "constraint": C("text", "桁・範囲・形式（なければ「なし」と理由）"),
                "default_value": C("opt", "初期値"),
                "display": C("opt", "表示の仕方"),
                "existing_data": C("opt", "既存データでの値・移行の扱い"),
                "ev_path": C("evpath", "根拠のファイル（existing_code は必須）"),
                "ev_line": C("evline", "根拠の行"),
                "ev_quote": C("evquote", "根拠の文字列"),
                "confidence": C("enum", "確からしさ", values=CONF)}},
            "path_properties": {"desc": "経路が運ぶプロパティ", "cols": {
                "path": C("ref", "経路", target="paths"), "property": C("ref", "プロパティ", target="properties"),
                "first": C("bool", "経路の最初のプロパティか（経路ごとに1つ）"),
                "reason": C("opt", "最初のプロパティに選んだ理由")}},
            "specs": {"desc": "仕様（外から観察できる振る舞い。親の要件は1つ）", "cols": {
                "id": C("id", "ID（S001）"),
                "requirement": C("ref", "親の要件", target="requirements"),
                "path": C("ref", "経路", target="paths", optional=True),
                "property": C("ref", "プロパティ", target="properties", optional=True),
                "kind": C("enum", "種類", values=["behavior", "validation", "error", "state", "permission", "data", "display", "crosscut", "migration", "operation"]),
                "statement": C("text", "振る舞い"),
                "reason": C("text", "親の要件のどの条件のためか"),
                "implementation": C("enum", "実装が要るか", values=["needed", "already_satisfied"]),
                "confidence": C("enum", "確からしさ", values=CONF)}},
            "acceptance": {"desc": "受入ケース", "cols": {
                "id": C("id", "ID（A001）"), "spec": C("ref", "仕様", target="specs"),
                "given": C("text", "前提"), "when": C("text", "操作"), "then": C("text", "結果（データ・応答・表示）")}},
            "machines": {"desc": "状態遷移の対象", "cols": {
                "id": C("id", "ID（SM01）"), "entity": C("text", "対象"), "name": C("text", "名前")}},
            "states": {"desc": "状態", "cols": {"machine": C("ref", "対象", target="machines"), "state": C("text", "状態")}},
            "events": {"desc": "出来事", "cols": {"machine": C("ref", "対象", target="machines"), "event": C("text", "出来事")}},
            "transitions": {"desc": "状態×出来事の表（全組を埋める）", "cols": {
                "machine": C("ref", "対象", target="machines"), "state": C("text", "状態"), "event": C("text", "出来事"),
                "result": C("enum", "結果", values=["transition", "reject", "ignore", "not_applicable", "unconfirmed"]),
                "to_state": C("opt", "遷移先（transition は必須）"),
                "specs": C("refs", "仕様", target="specs"),
                "reason": C("opt", "ignore/not_applicable の理由")}},
            "decision_tables": {"desc": "決定表", "cols": {
                "id": C("id", "ID（DT01）"), "name": C("text", "名前"), "path": C("ref", "経路", target="paths", optional=True)}},
            "conditions": {"desc": "決定表の条件と取りうる値（値は空白区切り）", "cols": {
                "table": C("ref", "決定表", target="decision_tables"), "condition": C("text", "条件名（空白なし）"),
                "values": C("text", "値（空白区切り、各値に空白なし）")}},
            "rules": {"desc": "決定表の規則（全組合せを覆い、重ならない）", "cols": {
                "table": C("ref", "決定表", target="decision_tables"),
                "when": C("text", "条件（cond=値 を空白区切り、値 * は任意）"),
                "outcome": C("text", "結果"), "specs": C("refs", "仕様", target="specs")}},
            "crud": {"desc": "CRUD の表（Y/N/?）", "cols": {
                "entity": C("text", "エンティティ"), "path": C("ref", "経路", target="paths"),
                "create": C("enum", "作る", values=["Y", "N", "?"]), "read": C("enum", "読む", values=["Y", "N", "?"]),
                "update": C("enum", "更新", values=["Y", "N", "?"]), "delete": C("enum", "削除", values=["Y", "N", "?"]),
                "reason": C("opt", "メモ")}},
            "errors": {"desc": "エラーの表", "cols": {
                "id": C("id", "ID（ER001）"), "path": C("ref", "経路", target="paths"),
                "failure": C("text", "失敗の種類"), "detect_step": C("ref", "検出する段", target="steps"),
                "response": C("text", "返す内容"), "display": C("text", "画面の表示（表示しないなら理由）"),
                "record": C("text", "記録（ログ等。しないなら理由）"), "specs": C("refs", "仕様", target="specs")}},
        },
    },
    "design.toon": {
        "desc": "経路の設計",
        "tables": {
            "steps": {"desc": "経路の段（コードの層。戻りの段まで）", "cols": {
                "id": C("id", "ID（ST001）"), "path": C("ref", "経路", target="paths"),
                "order": C("int", "経路の中の順番（1から）"),
                "name": C("text", "段の名前（例: バックエンド（コントローラー））"),
                "responsibility": C("text", "責務"),
                "origin": C("enum", "既存か", values=["existing", "changed", "new"]),
                "ev_path": C("evpath", "根拠のファイル（existing/changed は必須）"),
                "ev_line": C("evline", "根拠の行"), "ev_quote": C("evquote", "根拠の文字列")}},
            "matrix": {"desc": "段×プロパティの表（経路ごとに全組を埋める）", "cols": {
                "path": C("ref", "経路", target="paths"), "property": C("ref", "プロパティ", target="properties"),
                "step": C("ref", "段", target="steps"),
                "action": C("enum", "その段がそのプロパティに行うこと", values=["input", "send", "receive", "validate", "convert", "save", "load", "return", "display", "other", "none"]),
                "result": C("enum", "要る作業", values=["change", "existing_ok", "not_handled", "unconfirmed"]),
                "specs": C("refs", "関係する仕様", target="specs"),
                "reason": C("opt", "not_handled/existing_ok の理由")}},
        },
    },
    "impact.toon": {
        "desc": "影響範囲（変更する箇所からの逆引き）",
        "tables": {
            "changes": {"desc": "変更する箇所（既存のコードは根拠必須）", "cols": {
                "id": C("id", "ID（CH001）"),
                "kind": C("enum", "種類", values=["file", "function", "class", "api", "table", "column", "field", "message", "config", "screen", "event", "other"]),
                "name": C("text", "名前（識別子、テーブル.列、API のパスなど）"),
                "origin": C("enum", "既存か", values=["existing", "new"]),
                "ev_path": C("evpath", "根拠のファイル（existing は必須）"),
                "ev_line": C("evline", "根拠の行"), "ev_quote": C("evquote", "根拠の文字列"),
                "note": C("opt", "メモ")}},
            "searches": {"desc": "逆引きの検索（impact.py search が書く）", "cols": {
                "id": C("id", "ID（SR001）"), "change": C("ref", "変更する箇所", target="changes"),
                "term": C("text", "検索した文字列"), "scope": C("text", "範囲"), "tool": C("text", "道具"),
                "hit_count": C("int", "当たりの数"),
                "status": C("enum", "状態", values=["done", "not_done"]),
                "note": C("opt", "メモ（not_done は理由必須）")}},
            "hits": {"desc": "検索の当たり（すべてを判断する）", "cols": {
                "search": C("ref", "検索", target="searches"),
                "path": C("text", "ファイル"), "line": C("int", "行"), "text": C("opt", "その行"),
                "disposition": C("enum", "判断", values=["unclassified", "impact", "same_change", "test", "definition", "irrelevant"]),
                "impact": C("ref", "影響先（impact のとき）", target="impacts", optional=True),
                "reason": C("opt", "理由（irrelevant は必須）")}},
            "cochanges": {"desc": "一緒に変更されてきたファイル（impact.py cochange が書く）", "cols": {
                "file": C("text", "変更するファイル"), "partner": C("text", "一緒に変更されてきたファイル"),
                "count": C("int", "一緒に変更された回数"), "percent": C("int", "割合（%）"),
                "disposition": C("enum", "判断", values=["unclassified", "impact", "checked_no_impact", "same_change", "irrelevant"]),
                "impact": C("ref", "影響先（impact のとき）", target="impacts", optional=True),
                "reason": C("opt", "理由（checked_no_impact と irrelevant は必須）")}},
        },
    },
    "tasks.toon": {
        "desc": "タスク（1タスク＝1コミット）",
        "tables": {
            "tasks": {"desc": "タスク", "cols": {
                "id": C("id", "ID（T001）"), "order": C("int", "実装の順番"),
                "token": C("text", "文言（_プロパティ名_連番_）"),
                "unit": C("enum", "概念単位", values=["responsibility", "property", "non_property"]),
                "path": C("ref", "経路", target="paths", optional=True),
                "property": C("ref", "プロパティ", target="properties", optional=True),
                "step": C("ref", "段（responsibility のとき）", target="steps", optional=True),
                "content": C("text", "内容"), "files": C("text", "変更するファイル"),
                "tests": C("text", "同じコミットに入れるテスト（ないなら理由）"),
                "message": C("text", "コミットメッセージ（文言を含む）")}},
            "task_specs": {"desc": "タスクと仕様の対応（多対多）", "cols": {
                "task": C("ref", "タスク", target="tasks"), "spec": C("ref", "仕様", target="specs"),
                "content": C("text", "その仕様についてそのタスクで行うこと")}},
        },
    },
    "reviews.toon": {
        "desc": "検証の記録",
        "tables": {
            "rounds": {"desc": "検証の回", "cols": {
                "round": C("int", "回"), "kind": C("enum", "種類", values=["machine", "independent", "desk", "reverify"]),
                "date": C("text", "日時"), "note": C("opt", "メモ")}},
            "reviewers": {"desc": "検証したエージェント", "cols": {
                "id": C("id", "ID（RV01）"), "round": C("int", "回"),
                "role": C("enum", "役割", values=REQUIRED_ROLES + ["other"]),
                "scope": C("text", "見た範囲"),
                "status": C("enum", "状態", values=["done", "failed", "skipped"]),
                "output": C("opt", "結果のファイル")}},
            "findings": {"desc": "指摘", "cols": {
                "id": C("id", "ID（FD001）"), "round": C("int", "回"),
                "reviewer": C("text", "指摘した者（reviewers の ID、または main）"),
                "layer": C("enum", "層", values=["scope", "current", "need", "requirement", "quality", "spec", "design", "impact", "task", "evidence"]),
                "targets": C("refs", "対象（台帳の ID）", target="*"),
                "kind": C("enum", "種類", values=["omission", "error", "contradiction", "ambiguity", "unsupported", "granularity", "other"]),
                "severity": C("enum", "重さ", values=["critical", "high", "medium", "low"]),
                "statement": C("text", "指摘"), "scenario": C("opt", "具体的な場面（入力と結果）"),
                "evidence": C("opt", "根拠"),
                "status": C("enum", "状態", values=["open", "fixed", "rejected", "escalated"]),
                "resolution": C("opt", "対処（fixed/rejected/escalated は必須）"),
                "verified_by": C("opt", "直したことを確かめた reviewers の ID（fixed は必須）")}},
            "desk_checks": {"desc": "机上実行（経路×場面）", "cols": {
                "id": C("id", "ID（DC001）"), "path": C("ref", "経路", target="paths"),
                "scenario": C("enum", "場面", values=DESK_SCENARIOS + ["retry", "other"]),
                "result": C("enum", "結果", values=["determined", "undetermined", "not_applicable"]),
                "walk": C("text", "段ごとにたどった結果（最終のデータ・応答・表示）"),
                "findings": C("refs", "指摘", target="findings"),
                "reason": C("opt", "not_applicable の理由")}},
            "coverage": {"desc": "確かめた範囲と確かめていない範囲", "cols": {
                "area": C("text", "領域"), "checked": C("text", "確かめたこと"), "not_checked": C("text", "確かめていないこと（なければ「なし」）")}},
        },
    },
    "decisions.toon": {
        "desc": "確認事項と決定",
        "tables": {
            "questions": {"desc": "利用者・依頼者に決めてもらうこと", "cols": {
                "id": C("id", "ID（Q001）"),
                "layer": C("enum", "層", values=["scope", "current", "need", "requirement", "quality", "spec", "design", "impact", "task", "verify"]),
                "question": C("text", "問い"), "why": C("text", "答えで何が変わるか"),
                "options": C("text", "選択肢"), "recommendation": C("text", "推奨と理由"),
                "answer": C("opt", "答え（利用者の言葉のまま）"),
                "answered_by": C("enum", "答えた人", values=["user", "requester", "claude_provisional", "none"]),
                "status": C("enum", "状態", values=["open", "answered", "deferred", "provisional"]),
                "targets": C("refs", "関係する台帳の ID", target="*")}},
        },
    },
    "reconcile.toon": {
        "desc": "道具の成果物との突き合わせ（任意。道具を使った後）",
        "optional": True,
        "scalars": {"tool": C("text", "道具（spec-kit、superpowers など）")},
        "tables": {
            "artifacts": {"desc": "読んだ成果物", "cols": {"path": C("text", "場所"), "kind": C("text", "種類"), "note": C("opt", "メモ")}},
            "task_map": {"desc": "台帳のタスクと道具のタスク", "cols": {
                "ledger_task": C("opt", "台帳のタスク ID（extra は空）"), "tool_item": C("opt", "道具の項目（missing は空）"),
                "relation": C("enum", "関係", values=["same", "merged", "split", "missing", "extra", "changed"]),
                "note": C("opt", "メモ")}},
            "requirement_map": {"desc": "台帳の要件と道具の要件", "cols": {
                "ledger_requirement": C("opt", "台帳の要件 ID"), "tool_item": C("opt", "道具の項目"),
                "relation": C("enum", "関係", values=["same", "merged", "split", "missing", "extra", "changed"]),
                "note": C("opt", "メモ")}},
        },
    },
}

LEDGER_FILES = [f for f in SCHEMA]
ID_TABLES = {}  # table name -> file (tables with an id column)
for _f, _spec in SCHEMA.items():
    for _t, _ts in _spec.get("tables", {}).items():
        if "id" in _ts["cols"] and _ts["cols"]["id"]["kind"] == "id":
            ID_TABLES[_t] = _f
TABLE_FILE = {}
for _f, _spec in SCHEMA.items():
    for _t in _spec.get("tables", {}):
        TABLE_FILE.setdefault(_t, []).append(_f)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

class Ledger:
    def __init__(self, folder):
        self.dir = folder
        self.data = {}
        self.errors = []
        self.warnings = []
        self.ids = {}  # id -> (file, table)

    def err(self, code, file, target, message):
        self.errors.append({"code": code, "file": file, "target": str(target), "message": message})

    def warn(self, code, file, target, message):
        self.warnings.append({"code": code, "file": file, "target": str(target), "message": message})

    def load(self):
        for fname in LEDGER_FILES:
            path = os.path.join(self.dir, fname)
            if not os.path.exists(path):
                self.data[fname] = None
                continue
            try:
                with open(path, "rb") as f:
                    raw = f.read()
                val = toon.decode(raw)
            except toon.ToonError as e:
                self.err("toon_syntax", fname, "", f"TOON として読めない: {e}")
                self.data[fname] = None
                continue
            if raw.endswith(b"\n"):
                self.warn("toon_trailing_newline", fname, "", "ファイル末尾に改行がある（fmt で直せる）")
            if not isinstance(val, dict):
                self.err("toon_root", fname, "", "ルートはオブジェクトにする")
                self.data[fname] = None
                continue
            self.data[fname] = val
        return self

    def table(self, fname, tname):
        d = self.data.get(fname)
        if not d:
            return []
        v = d.get(tname)
        return v if isinstance(v, list) else []

    def scalar(self, fname, key, default=None):
        d = self.data.get(fname)
        if not d:
            return default
        return d.get(key, default)


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------

def split_refs(v):
    if v is None:
        return []
    if not isinstance(v, str):
        v = str(v)
    return [x for x in v.split() if x]


def check_structure(L):
    # pass 1: shapes and ids
    for fname, spec in SCHEMA.items():
        d = L.data.get(fname)
        if d is None:
            continue
        allowed = set(spec.get("scalars", {})) | set(spec.get("tables", {}))
        for k in d:
            if k not in allowed:
                L.err("unknown_key", fname, k, f"スキーマにないキー: {k}")
        for k, col in spec.get("scalars", {}).items():
            if k not in d:
                if col["kind"] not in ("opt",):
                    L.err("missing_key", fname, k, f"必須のキーがない: {k}")
                continue
            check_value(L, fname, k, "", col, d[k])
        for tname, ts in spec.get("tables", {}).items():
            if tname not in d:
                L.err("missing_table", fname, tname, f"表がない（空なら {tname}: []）: {tname}")
                continue
            rows = d[tname]
            if not isinstance(rows, list):
                L.err("table_type", fname, tname, "表は配列にする")
                continue
            cols = ts["cols"]
            for i, row in enumerate(rows):
                if not isinstance(row, dict):
                    L.err("row_type", fname, f"{tname}[{i}]", "行はオブジェクトにする（表形式）")
                    continue
                keys = list(row.keys())
                missing = [c for c in cols if c not in row]
                extra = [c for c in keys if c not in cols]
                if missing or extra:
                    L.err("row_columns", fname, f"{tname}[{i}]", f"列が合わない（不足: {missing}、余分: {extra}）")
                for c, col in cols.items():
                    if c in row:
                        check_value(L, fname, f"{tname}[{i}]", c, col, row[c])
                if "id" in cols and cols["id"]["kind"] == "id" and isinstance(row.get("id"), str):
                    rid = row["id"]
                    if rid in L.ids:
                        L.err("duplicate_id", fname, rid, f"ID が重複している（{L.ids[rid][0]} の {L.ids[rid][1]} にもある）")
                    else:
                        L.ids[rid] = (fname, tname)
    # pass 2: references
    for fname, spec in SCHEMA.items():
        d = L.data.get(fname)
        if d is None:
            continue
        for tname, ts in spec.get("tables", {}).items():
            for i, row in enumerate(d.get(tname) or []):
                if not isinstance(row, dict):
                    continue
                for c, col in ts["cols"].items():
                    if col["kind"] not in ("ref", "refs") or c not in row:
                        continue
                    vals = split_refs(row[c]) if col["kind"] == "refs" else ([row[c]] if row[c] not in ("", None) else [])
                    if col["kind"] == "ref" and not vals and not col.get("optional"):
                        L.err("missing_ref", fname, f"{tname}[{i}].{c}", "参照が空")
                    for v in vals:
                        tgt = col.get("target")
                        if v not in L.ids:
                            L.err("dangling_ref", fname, f"{tname}[{i}].{c}", f"参照先 {v} がない")
                        elif tgt != "*" and L.ids[v][1] != tgt:
                            L.err("ref_type", fname, f"{tname}[{i}].{c}", f"{v} は {tgt} ではなく {L.ids[v][1]} の ID")


def check_value(L, fname, where, c, col, v):
    k = col["kind"]
    loc = f"{where}.{c}" if c else where
    if k in ("id", "text"):
        if not isinstance(v, str) or v.strip() == "":
            L.err("empty_text", fname, loc, "空にできない文字列")
    elif k in ("opt", "evquote"):
        if v is not None and not isinstance(v, str):
            L.err("type", fname, loc, "文字列にする")
    elif k == "enum":
        if v not in col["values"]:
            L.err("enum", fname, loc, f"値 {v!r} は {col['values']} のどれでもない")
    elif k in ("int", "evline"):
        if isinstance(v, bool) or not isinstance(v, int):
            L.err("type", fname, loc, "整数にする")
    elif k == "bool":
        if not isinstance(v, bool):
            L.err("type", fname, loc, "true/false にする")
    elif k in ("ref", "refs", "evpath"):
        if v is not None and not isinstance(v, str):
            L.err("type", fname, loc, "文字列にする（ID は空白区切り）")


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------

def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def check_evidence(L):
    root = L.scalar("scope.toon", "repo_root")
    cache = {}
    sources = {r.get("path"): r for r in L.table("sources.toon", "sources") if isinstance(r, dict)}
    for fname, spec in SCHEMA.items():
        for tname, ts in spec.get("tables", {}).items():
            if "ev_path" not in ts["cols"]:
                continue
            for i, row in enumerate(L.table(fname, tname)):
                if not isinstance(row, dict):
                    continue
                loc = f"{tname}[{i}]" + (f"({row.get('id')})" if row.get("id") else "")
                p = row.get("ev_path") or ""
                line = row.get("ev_line")
                quote = row.get("ev_quote") or ""
                conf = row.get("confidence")
                origin = row.get("origin")
                needs_code = (tname in ("entrypoints", "impacts")) or (tname == "behaviors") \
                    or (tname == "properties" and origin == "existing_code") \
                    or (tname == "steps" and origin in ("existing", "changed")) \
                    or (tname == "changes" and origin == "existing")
                if p in ("", "none"):
                    if needs_code:
                        L.err("evidence_missing", fname, loc, "既存のコードについての行には、コードの根拠（ファイル・行・文字列）が要る")
                    elif conf == "fact":
                        L.err("evidence_missing", fname, loc, "fact には根拠が要る")
                    continue
                if p == "conversation":
                    if quote.strip() == "":
                        L.err("evidence_quote", fname, loc, "会話を根拠にするときは、発言をそのまま ev_quote に書く")
                    if conf == "fact":
                        L.err("evidence_kind", fname, loc, "会話の発言は fact ではなく claim か decided にする")
                    if needs_code:
                        L.err("evidence_kind", fname, loc, "既存のコードについての行は、コードを根拠にする")
                    continue
                doc = p.startswith("doc:")
                rel = p[4:] if doc else p
                if doc and conf == "fact":
                    L.err("evidence_kind", fname, loc, "文書（spec.md など）は保守されていない前提のため、fact の根拠にしない。コードで確かめる")
                if doc and needs_code:
                    L.err("evidence_kind", fname, loc, "既存のコードについての行は、文書ではなくコードを根拠にする")
                if not root:
                    L.err("evidence_root", "scope.toon", "repo_root", "repo_root がないので根拠を確かめられない")
                    return
                full = os.path.normpath(os.path.join(root, rel))
                if os.path.isabs(rel) or not full.startswith(os.path.normpath(root)):
                    L.err("evidence_path", fname, loc, f"ev_path はリポジトリからの相対パスにする: {p}")
                    continue
                if full not in cache:
                    try:
                        with open(full, encoding="utf-8", errors="replace") as f:
                            cache[full] = f.read().split("\n")
                    except OSError:
                        cache[full] = None
                lines = cache[full]
                if lines is None:
                    L.err("evidence_file", fname, loc, f"根拠のファイルがない: {rel}")
                    continue
                if not isinstance(line, int) or line < 1 or line > len(lines):
                    L.err("evidence_line", fname, loc, f"行 {line} は {rel} の範囲外（1〜{len(lines)}）")
                    continue
                if quote.strip() == "":
                    L.err("evidence_quote", fname, loc, "ev_quote が空")
                    continue
                window = _norm(" ".join(lines[max(0, line - 4):min(len(lines), line + 3)]))
                if _norm(quote) not in window:
                    L.err("evidence_quote", fname, loc, f"{rel} の {line} 行の前後3行に ev_quote の文字列がない")
                if not doc and rel not in sources and p not in sources:
                    L.warn("evidence_source", fname, loc, f"{rel} が sources.toon にない")
                if tname == "properties" and origin == "existing_code" and row.get("code_name"):
                    if row["code_name"] not in window:
                        L.err("evidence_name", fname, loc, f"code_name {row['code_name']} が根拠の行の前後にない（名前は既存コードを最優先）")


# ---------------------------------------------------------------------------
# Traceability and completeness
# ---------------------------------------------------------------------------

def stage_index(key):
    return STAGE_KEYS.index(key)


def rows(L, fname, tname):
    return [r for r in L.table(fname, tname) if isinstance(r, dict)]


def by_id(L, fname, tname):
    return {r.get("id"): r for r in rows(L, fname, tname)}


def check_progress(L):
    st = rows(L, "progress.toon", "stages")
    keys = [r.get("key") for r in st]
    if L.data.get("progress.toon") is not None and keys != STAGE_KEYS:
        L.err("stages", "progress.toon", "stages", f"段階は {STAGE_KEYS} の順に1つずつ並べる")
    for r in st:
        if r.get("status") == "skipped" and not (r.get("note") or "").strip():
            L.err("stage_skip", "progress.toon", r.get("key"), "skipped には理由を書く")


def gate_current(L):
    kind = L.scalar("scope.toon", "kind")
    inv = rows(L, "current.toon", "investigations")
    if kind in ("change", "mixed"):
        if not inv:
            L.err("current_empty", "current.toon", "investigations", "既存の改修では調査台帳が要る")
        if not rows(L, "current.toon", "entrypoints"):
            L.err("current_empty", "current.toon", "entrypoints", "既存の改修では入口を記録する")
        if not rows(L, "current.toon", "behaviors"):
            L.err("current_empty", "current.toon", "behaviors", "既存の改修では現行の仕様を記録する")
    for r in inv:
        if r.get("status") in ("partial", "not_done", "out_of_scope") and not (r.get("boundary_reason") or "").strip():
            L.err("investigation_boundary", "current.toon", r.get("id"), "調べ切れていない範囲には、止めた境界と理由を書く")
    for r in rows(L, "current.toon", "impacts"):
        if r.get("classification") == "unconfirmed":
            L.err("impact_unconfirmed", "current.toon", r.get("id"), "影響の分類が未確認（確かめるか、確認事項にする）")


def gate_needs(L):
    sh = by_id(L, "needs.toon", "stakeholders")
    sc = by_id(L, "needs.toon", "scenes")
    needs = by_id(L, "needs.toon", "needs")
    if not sh or not sc:
        L.err("needs_empty", "needs.toon", "", "関係者と場面を記録する")
    if not needs:
        L.err("needs_empty", "needs.toon", "needs", "要求がない")
    seen = {}
    for r in rows(L, "needs.toon", "frame"):
        key = (r.get("stakeholder"), r.get("scene"))
        if key in seen:
            L.err("frame_duplicate", "needs.toon", f"{key}", "関係者×場面の組が重複している")
        seen[key] = r
        res = r.get("result")
        refs = split_refs(r.get("needs"))
        if res == "need" and not refs:
            L.err("frame_need_refs", "needs.toon", f"{key}", "result need には要求の ID を書く")
        if res in ("none", "out_of_scope") and not (r.get("reason") or "").strip():
            L.err("frame_reason", "needs.toon", f"{key}", "none/out_of_scope には理由を書く")
        if res == "unconfirmed":
            L.err("frame_unconfirmed", "needs.toon", f"{key}", "未確認の欄が残っている")
        for n in refs:
            nr = needs.get(n)
            if nr and (nr.get("who") != key[0] or nr.get("scene") != key[1]):
                L.err("frame_need_mismatch", "needs.toon", f"{key}", f"要求 {n} の誰が・場面がこの欄と合わない")
    for s in sh:
        for c in sc:
            if (s, c) not in seen:
                L.err("frame_missing", "needs.toon", f"({s}, {c})", "関係者×場面の欄がない（すべての組を埋める）")
    in_frame = {n for r in rows(L, "needs.toon", "frame") for n in split_refs(r.get("needs"))}
    for nid, n in needs.items():
        if nid not in in_frame:
            L.err("need_not_in_frame", "needs.toon", nid, "要求が関係者×場面の表に現れない")
        if n.get("adoption") == "pending":
            L.err("need_pending", "needs.toon", nid, "扱いが決まっていない要求がある")
        if n.get("adoption") == "out_of_scope" and not (n.get("reason") or "").strip():
            L.err("need_reason", "needs.toon", nid, "対象外の要求には理由を書く")
    # current behaviours must be traced to needs
    links = {r.get("behavior"): split_refs(r.get("needs")) for r in rows(L, "needs.toon", "current_links")}
    for b in rows(L, "current.toon", "behaviors"):
        if b.get("treatment") == "unconfirmed":
            L.err("behavior_unconfirmed", "current.toon", b.get("id"), "現行の仕様の処遇が未確認")
        elif not links.get(b.get("id")):
            L.err("behavior_not_traced", "needs.toon", b.get("id"), "現行の仕様（keep/change/remove）を要求につなぐ（current_links）")


def adopted_needs(L):
    return {k: v for k, v in by_id(L, "needs.toon", "needs").items() if v.get("adoption") == "adopted"}


def gate_requirements(L):
    needs = adopted_needs(L)
    reqs = by_id(L, "requirements.toon", "requirements")
    links = rows(L, "requirements.toon", "need_links")
    n2r = {}
    r2n = {}
    for l in links:
        n2r.setdefault(l.get("need"), set()).add(l.get("requirement"))
        r2n.setdefault(l.get("requirement"), set()).add(l.get("need"))
    for nid in needs:
        if not any(reqs.get(r, {}).get("status") == "adopted" for r in n2r.get(nid, ())):
            L.err("need_without_requirement", "requirements.toon", nid, "採用した要求に、採用した要件がない（要件の漏れ）")
    for rid, r in reqs.items():
        if not r2n.get(rid):
            L.err("requirement_without_need", "requirements.toon", rid, "親のない要件（要求の漏れか、頼まれていない追加）")
        for n in r2n.get(rid, ()):
            nr = by_id(L, "needs.toon", "needs").get(n)
            if r.get("status") == "adopted" and nr and nr.get("adoption") != "adopted":
                L.err("requirement_parent_not_adopted", "requirements.toon", rid, f"採用した要件の親 {n} が採用されていない")
        if r.get("status") == "proposed":
            L.err("requirement_proposed", "requirements.toon", rid, "採否が決まっていない要件（proposed）が残っている")
    seen = {}
    for f in rows(L, "requirements.toon", "frame"):
        key = (f.get("need"), f.get("viewpoint"))
        if key in seen:
            L.err("frame_duplicate", "requirements.toon", f"{key}", "要求×観点の組が重複している")
        seen[key] = f
        res = f.get("result")
        refs = split_refs(f.get("requirements"))
        if res == "requirement":
            if not refs:
                L.err("frame_req_refs", "requirements.toon", f"{key}", "result requirement には要件の ID を書く")
            for r in refs:
                if r not in n2r.get(f.get("need"), set()):
                    L.err("frame_req_link", "requirements.toon", f"{key}", f"要件 {r} が need_links でこの要求につながっていない")
        if res in ("not_needed", "out_of_scope") and not (f.get("reason") or "").strip():
            L.err("frame_reason", "requirements.toon", f"{key}", "not_needed/out_of_scope には理由を書く")
        if res == "unconfirmed":
            L.err("frame_unconfirmed", "requirements.toon", f"{key}", "未確認の欄が残っている")
    for nid in needs:
        for vp in VIEWPOINTS:
            if (nid, vp) not in seen:
                L.err("frame_missing", "requirements.toon", f"({nid}, {vp})", "要求×観点の欄がない（採用した要求ごとに6観点）")


def gate_quality(L):
    import json as _json
    here = os.path.dirname(os.path.abspath(__file__))
    cat_path = os.path.join(here, "..", "references", "quality", "catalog.json")
    try:
        with open(cat_path, encoding="utf-8") as f:
            cat = _json.load(f)
    except OSError:
        L.err("quality_catalog", "quality.toon", "", "カタログを読めない")
        return
    vp_checks, vp_text = {}, {}
    for g in cat["groups"]:
        for s in g["subcharacteristics"]:
            for v in s["viewpoints"]:
                vp_checks[v["id"]] = [c["id"] for c in v["checks"]]
                vp_text[v["id"]] = v.get("text", "")
    if L.scalar("quality.toon", "catalog_version") != cat.get("catalog_version"):
        L.err("quality_version", "quality.toon", "catalog_version", "カタログの版が台帳と合わない")
    vps = {r.get("id"): r for r in rows(L, "quality.toon", "viewpoints")}
    for vid in vp_checks:
        if vid not in vps:
            L.err("quality_viewpoint_missing", "quality.toon", vid, "観点が台帳にない（quality.py init で作り直す）")
    reqs = by_id(L, "requirements.toon", "requirements")
    checks = {r.get("id"): r for r in rows(L, "quality.toon", "checks")}
    seen_reason = {}
    for vid, r in vps.items():
        if r.get("judgement") in ("not_applicable", "out_of_scope") and (r.get("reason") or "").strip():
            # compare what remains after removing the viewpoint's own wording, so that
            # "<viewpoint text>: <shared reason>" is still detected as a shared reason
            core = r["reason"]
            t = vp_text.get(vid, "")
            if t:
                core = core.replace(t, "")
                core = core.replace(t.split("(")[0].split("（")[0], "")
            core = re.sub(r"(Q\d{2}\.\d{2}\.\d{3})", "", core)
            core = re.sub(r"[\s「」『』:：、。,.()（）]+", "", core)
            seen_reason.setdefault(core, []).append(vid)
    for text, ids in seen_reason.items():
        if len(ids) > 1:
            L.err("quality_reason_shared", "quality.toon", " ".join(ids[:5]) + (" ほか" if len(ids) > 5 else ""),
                  f"{len(ids)} 件の観点が、観点の文言を除くと同じ理由「{text[:40]}」を使っている。観点ごとに、その観点が確かめる内容がこの案件で起きない根拠を書く")
    for vid, r in vps.items():
        if vid not in vp_checks:
            L.err("quality_unknown_id", "quality.toon", vid, "カタログにない観点 ID")
            continue
        j = r.get("judgement")
        if j == "unreviewed":
            L.err("quality_unreviewed", "quality.toon", vid, "一次選別していない観点")
        if j in ("not_applicable", "out_of_scope") and not (r.get("reason") or "").strip():
            L.err("quality_reason", "quality.toon", vid, "not_applicable/out_of_scope には理由を書く")
        if j in ("applicable", "unknown"):
            for cid in vp_checks[vid]:
                if cid not in checks:
                    L.err("quality_check_missing", "quality.toon", cid, f"観点 {vid} の確認項目を判定していない")
    for cid, c in checks.items():
        vid = c.get("viewpoint")
        if vid not in vp_checks or cid not in vp_checks[vid]:
            L.err("quality_check_id", "quality.toon", cid, "観点と確認項目の対応がカタログと合わない")
            continue
        if vps.get(vid, {}).get("judgement") not in ("applicable", "unknown"):
            L.err("quality_check_unread", "quality.toon", cid, "適用あり・不明でない観点の確認項目を判定している")
        j = c.get("judgement")
        refs = split_refs(c.get("requirements"))
        if j == "reflected":
            if not refs:
                L.err("quality_refs", "quality.toon", cid, "reflected には反映した要件を書く")
            for rid in refs:
                if reqs.get(rid, {}).get("status") != "adopted":
                    L.err("quality_refs", "quality.toon", cid, f"{rid} は採用した要件ではない")
        if j in ("not_needed", "out_of_scope") and not (c.get("reason") or "").strip():
            L.err("quality_reason", "quality.toon", cid, "not_needed/out_of_scope には理由を書く")
        if j == "unknown":
            L.err("quality_unknown", "quality.toon", cid, "判定が不明のまま（確認事項にするか判定する）")


def gate_specs(L):
    reqs = by_id(L, "requirements.toon", "requirements")
    specs = by_id(L, "specs.toon", "specs")
    paths = by_id(L, "specs.toon", "paths")
    props = by_id(L, "specs.toon", "properties")
    if not paths:
        L.err("specs_empty", "specs.toon", "paths", "経路がない")
    for rid, r in reqs.items():
        if r.get("status") == "adopted" and not any(s.get("requirement") == rid for s in specs.values()):
            L.err("requirement_without_spec", "specs.toon", rid, "採用した要件に仕様がない（仕様の漏れ）")
    for sid, s in specs.items():
        pr = reqs.get(s.get("requirement"))
        if pr and pr.get("status") != "adopted":
            L.err("spec_parent_not_adopted", "specs.toon", sid, "仕様の親の要件が採用されていない")
        if s.get("path") and s.get("property"):
            if not any(pp.get("path") == s["path"] and pp.get("property") == s["property"] for pp in rows(L, "specs.toon", "path_properties")):
                L.err("spec_property_not_on_path", "specs.toon", sid, "仕様のプロパティがその経路で運ばれていない")
        if not s.get("path") and s.get("kind") != "crosscut":
            L.warn("spec_without_path", "specs.toon", sid, "経路のない仕様は kind crosscut にする")
    acc = {}
    for a in rows(L, "specs.toon", "acceptance"):
        acc.setdefault(a.get("spec"), []).append(a)
    for sid in specs:
        if sid not in acc:
            L.err("spec_without_acceptance", "specs.toon", sid, "受入ケースのない仕様")
    for pid, p in paths.items():
        rq = split_refs(p.get("requirements"))
        if not rq:
            L.err("path_without_requirement", "specs.toon", pid, "経路が要件につながっていない")
        for r in rq:
            if reqs.get(r, {}).get("status") != "adopted":
                L.err("path_requirement", "specs.toon", pid, f"{r} は採用した要件ではない")
        pp = [x for x in rows(L, "specs.toon", "path_properties") if x.get("path") == pid]
        if not pp:
            L.err("path_without_property", "specs.toon", pid, "経路が運ぶプロパティがない")
        firsts = [x for x in pp if x.get("first") is True]
        if len(firsts) != 1:
            L.err("path_first_property", "specs.toon", pid, f"最初のプロパティは経路に1つ（今は {len(firsts)}）")
        elif not (firsts[0].get("reason") or "").strip():
            L.err("path_first_reason", "specs.toon", pid, "最初のプロパティに選んだ理由を書く")
        if not any(e.get("path") == pid for e in rows(L, "specs.toon", "errors")):
            L.warn("path_without_errors", "specs.toon", pid, "経路にエラーの行がない（失敗が本当にないか確かめる）")
    seen_pp = set()
    for x in rows(L, "specs.toon", "path_properties"):
        k = (x.get("path"), x.get("property"))
        if k in seen_pp:
            L.err("path_property_duplicate", "specs.toon", f"{k}", "経路とプロパティの組が重複している")
        seen_pp.add(k)
    for prid, p in props.items():
        if not any(x.get("property") == prid for x in rows(L, "specs.toon", "path_properties")):
            L.warn("property_unused", "specs.toon", prid, "どの経路でも運ばれないプロパティ")
        if p.get("origin") == "existing_code" and not (p.get("code_name") or "").strip():
            L.err("property_code_name", "specs.toon", prid, "既存コードのプロパティには code_name を書く")
    # state machines
    for mid in by_id(L, "specs.toon", "machines"):
        states = [s.get("state") for s in rows(L, "specs.toon", "states") if s.get("machine") == mid]
        events = [e.get("event") for e in rows(L, "specs.toon", "events") if e.get("machine") == mid]
        tr = {}
        for t in rows(L, "specs.toon", "transitions"):
            if t.get("machine") != mid:
                continue
            k = (t.get("state"), t.get("event"))
            if k in tr:
                L.err("transition_duplicate", "specs.toon", f"{mid}{k}", "状態×出来事の組が重複している")
            tr[k] = t
            if t.get("state") not in states or t.get("event") not in events:
                L.err("transition_unknown", "specs.toon", f"{mid}{k}", "states/events にない状態か出来事")
            res = t.get("result")
            if res == "transition" and t.get("to_state") not in states:
                L.err("transition_target", "specs.toon", f"{mid}{k}", "遷移先が states にない")
            if res in ("transition", "reject") and not split_refs(t.get("specs")):
                L.err("transition_specs", "specs.toon", f"{mid}{k}", "transition/reject には仕様を書く")
            if res in ("ignore", "not_applicable") and not (t.get("reason") or "").strip():
                L.err("transition_reason", "specs.toon", f"{mid}{k}", "ignore/not_applicable には理由を書く")
            if res == "unconfirmed":
                L.err("transition_unconfirmed", "specs.toon", f"{mid}{k}", "未確認の欄が残っている")
        for s in states:
            for e in events:
                if (s, e) not in tr:
                    L.err("transition_missing", "specs.toon", f"{mid}({s}, {e})", "状態×出来事の欄がない（すべての組を埋める）")
    # decision tables
    for tid in by_id(L, "specs.toon", "decision_tables"):
        conds = [(c.get("condition"), (c.get("values") or "").split()) for c in rows(L, "specs.toon", "conditions") if c.get("table") == tid]
        if not conds:
            L.err("decision_no_conditions", "specs.toon", tid, "決定表に条件がない")
            continue
        names = [c for c, _ in conds]
        rules = []
        for r in rows(L, "specs.toon", "rules"):
            if r.get("table") != tid:
                continue
            m = {}
            for part in (r.get("when") or "").split():
                if "=" not in part:
                    L.err("decision_when", "specs.toon", tid, f"when の書き方が違う: {part}")
                    continue
                k, v = part.split("=", 1)
                m[k] = v
            for k, v in m.items():
                if k not in names:
                    L.err("decision_when", "specs.toon", tid, f"未定義の条件 {k}")
                elif v != "*" and v not in dict(conds)[k]:
                    L.err("decision_when", "specs.toon", tid, f"条件 {k} に値 {v} はない")
            for n in names:
                m.setdefault(n, "*")
            rules.append((m, r.get("outcome")))
            if not split_refs(r.get("specs")):
                L.err("decision_specs", "specs.toon", tid, "規則に仕様を書く")
        for combo in product(*[vals for _, vals in conds]):
            hit = [(m, o) for m, o in rules if all(m[n] in ("*", v) for n, v in zip(names, combo))]
            label = " ".join(f"{n}={v}" for n, v in zip(names, combo))
            if not hit:
                L.err("decision_gap", "specs.toon", tid, f"どの規則にも当たらない組合せ: {label}")
            elif len({o for _, o in hit}) > 1:
                L.err("decision_conflict", "specs.toon", tid, f"結果の違う規則が重なる組合せ: {label}")
    # crud
    for r in rows(L, "specs.toon", "crud"):
        for op in ("create", "read", "update", "delete"):
            if r.get(op) == "?":
                L.err("crud_unconfirmed", "specs.toon", f"{r.get('entity')}/{r.get('path')}", f"{op} が ? のまま")
    ents = {}
    for r in rows(L, "specs.toon", "crud"):
        e = ents.setdefault(r.get("entity"), {"create": False, "read": False, "update": False, "delete": False})
        for op in e:
            e[op] = e[op] or r.get(op) == "Y"
    for e, ops in ents.items():
        if ops["create"] and not ops["read"]:
            L.warn("crud_no_read", "specs.toon", e, "作るが、どの経路でも読まれないエンティティ")
        if (ops["update"] or ops["delete"]) and not ops["read"]:
            L.warn("crud_update_without_read", "specs.toon", e, "更新・削除するが読まれないエンティティ")


def gate_design(L):
    paths = by_id(L, "specs.toon", "paths")
    specs = by_id(L, "specs.toon", "specs")
    steps = rows(L, "design.toon", "steps")
    pp = rows(L, "specs.toon", "path_properties")
    cells = {}
    for c in rows(L, "design.toon", "matrix"):
        k = (c.get("path"), c.get("property"), c.get("step"))
        if k in cells:
            L.err("matrix_duplicate", "design.toon", f"{k}", "段×プロパティの欄が重複している")
        cells[k] = c
        res = c.get("result")
        if res == "change":
            if c.get("action") == "none":
                L.err("matrix_action", "design.toon", f"{k}", "change の欄には、その段が行うことを書く")
            if not split_refs(c.get("specs")):
                L.err("matrix_specs", "design.toon", f"{k}", "change の欄には、関係する仕様を書く（仕様のない作業は仕様の漏れ）")
        if res in ("not_handled", "existing_ok") and not (c.get("reason") or "").strip():
            L.err("matrix_reason", "design.toon", f"{k}", "not_handled/existing_ok には理由を書く")
        if res == "unconfirmed":
            L.err("matrix_unconfirmed", "design.toon", f"{k}", "未確認の欄が残っている")
        for s in split_refs(c.get("specs")):
            sp = specs.get(s)
            if sp and sp.get("path") and sp.get("path") != c.get("path"):
                L.err("matrix_spec_path", "design.toon", f"{k}", f"仕様 {s} は別の経路の仕様")
            if sp and sp.get("property") and sp.get("property") != c.get("property"):
                L.err("matrix_spec_property", "design.toon", f"{k}", f"仕様 {s} は別のプロパティの仕様")
        st = next((x for x in steps if x.get("id") == c.get("step")), None)
        if st and st.get("path") != c.get("path"):
            L.err("matrix_step_path", "design.toon", f"{k}", "段が別の経路のもの")
    for pid, p in paths.items():
        ps = sorted([s for s in steps if s.get("path") == pid], key=lambda s: s.get("order") if isinstance(s.get("order"), int) else 0)
        if not ps:
            L.err("path_without_steps", "design.toon", pid, "経路に段がない")
            continue
        orders = [s.get("order") for s in ps]
        if orders != list(range(1, len(ps) + 1)):
            L.err("step_order", "design.toon", pid, f"段の順番は 1 から連番にする（今は {orders}）")
        for x in [x for x in pp if x.get("path") == pid]:
            for s in ps:
                if (pid, x.get("property"), s.get("id")) not in cells:
                    L.err("matrix_missing", "design.toon", f"({pid}, {x.get('property')}, {s.get('id')})", "段×プロパティの欄がない（すべての組を埋める）")
        if p.get("kind") == "new" and all(s.get("origin") == "existing" for s in ps):
            L.warn("new_path_existing_steps", "design.toon", pid, "新しい経路なのに、すべての段が既存のまま")
    for (pid, prop, st), c in cells.items():
        if not any(x.get("path") == pid and x.get("property") == prop for x in pp):
            L.err("matrix_extra", "design.toon", f"({pid}, {prop}, {st})", "経路が運ばないプロパティの欄がある")
    # every path spec must appear in a cell
    for sid, s in specs.items():
        if not s.get("path"):
            continue
        hit = [c for c in cells.values() if sid in split_refs(c.get("specs")) and c.get("result") in ("change", "existing_ok")]
        if not hit:
            L.err("spec_not_in_matrix", "design.toon", sid, "仕様が段×プロパティの表のどの欄にも現れない（どの段で実現するか未定）")
        elif s.get("implementation") == "already_satisfied" and any(c.get("result") == "change" for c in hit):
            L.err("spec_satisfied_but_change", "design.toon", sid, "already_satisfied の仕様に change の欄がある")
        elif s.get("implementation") == "needed" and not any(c.get("result") == "change" for c in hit):
            L.err("spec_needed_no_change", "design.toon", sid, "needed の仕様なのに change の欄がない")
    for e in rows(L, "specs.toon", "errors"):
        st = next((x for x in steps if x.get("id") == e.get("detect_step")), None)
        if st and st.get("path") != e.get("path"):
            L.err("error_step_path", "specs.toon", e.get("id"), "検出する段が別の経路のもの")


COCHANGE_AREA = "変更の共起（git の履歴）"
OUTSIDE_AREA = "リポジトリの外の利用者"


def gate_impact(L):
    changes = rows(L, "impact.toon", "changes")
    steps = rows(L, "design.toon", "steps")
    props = by_id(L, "specs.toon", "properties")
    cells = rows(L, "design.toon", "matrix")
    specs = by_id(L, "specs.toon", "specs")
    has_existing = any(s.get("origin") in ("existing", "changed") for s in steps) or L.scalar("scope.toon", "kind") in ("change", "mixed")
    if not has_existing and not changes:
        return
    if has_existing and not changes:
        L.err("changes_empty", "impact.toon", "changes", "既存のコードを変えるのに、変更する箇所の一覧がない")
    # the change list must cover what the design says will change
    files = {c.get("ev_path") for c in changes}
    for s in steps:
        if s.get("origin") == "changed" and s.get("ev_path") not in files:
            L.err("change_missing_for_step", "impact.toon", s.get("id"), f"変更する段のファイル {s.get('ev_path')} が changes にない")
    for prid, p in props.items():
        if p.get("origin") != "existing_code" or not (p.get("code_name") or "").strip():
            continue
        if any(c.get("property") == prid and c.get("result") == "change" for c in cells):
            if not any(p["code_name"].lower() in (c.get("name") or "").lower() for c in changes):
                L.err("change_missing_for_property", "impact.toon", prid, f"変更する既存のプロパティ {p['code_name']} が changes にない")
    searches = rows(L, "impact.toon", "searches")
    hits = rows(L, "impact.toon", "hits")
    for c in changes:
        if c.get("origin") != "existing":
            continue
        ss = [x for x in searches if x.get("change") == c.get("id")]
        if not any(x.get("status") == "done" for x in ss):
            L.err("search_missing", "impact.toon", c.get("id"), "既存の変更する箇所を逆引きしていない（impact.py search）")
            continue
        name = (c.get("name") or "").lower()
        last = re.split(r"[./:#]", name)[-1]
        if not any((x.get("term") or "").lower() in name or (last and last in (x.get("term") or "").lower()) for x in ss):
            L.err("search_term", "impact.toon", c.get("id"), "変更する箇所の名前で検索していない")
    for x in searches:
        n = sum(1 for h in hits if h.get("search") == x.get("id"))
        if x.get("status") == "done" and n != x.get("hit_count"):
            L.err("hit_count", "impact.toon", x.get("id"), f"当たりの記録 {n} 件が hit_count {x.get('hit_count')} と合わない")
        if x.get("status") == "not_done" and not (x.get("note") or "").strip():
            L.err("search_reason", "impact.toon", x.get("id"), "検索しなかった理由を書く")
    for i, h in enumerate(hits):
        loc = f"hits[{i}]({h.get('path')}:{h.get('line')})"
        d = h.get("disposition")
        if d == "unclassified":
            L.err("hit_unclassified", "impact.toon", loc, "判断していない当たり")
        if d == "impact" and not h.get("impact"):
            L.err("hit_impact", "impact.toon", loc, "impact の当たりには影響先（impacts の ID）を書く")
        if d == "irrelevant" and not (h.get("reason") or "").strip():
            L.err("hit_reason", "impact.toon", loc, "irrelevant の当たりには理由を書く")
    for i, r in enumerate(rows(L, "impact.toon", "cochanges")):
        loc = f"cochanges[{i}]({r.get('file')} / {r.get('partner')})"
        d = r.get("disposition")
        if d == "unclassified":
            L.err("cochange_unclassified", "impact.toon", loc, "判断していない、一緒に変更されてきたファイル")
        if d == "impact" and not r.get("impact"):
            L.err("cochange_impact", "impact.toon", loc, "impact には影響先（impacts の ID）を書く")
        if d in ("checked_no_impact", "irrelevant") and not (r.get("reason") or "").strip():
            L.err("cochange_reason", "impact.toon", loc, "理由を書く")
    if any(c.get("origin") == "existing" for c in changes):
        inv = next((r for r in rows(L, "current.toon", "investigations") if r.get("area") == COCHANGE_AREA), None)
        if inv is None:
            L.err("cochange_not_run", "current.toon", "investigations", "変更の共起を調べていない（impact.py cochange）")
        out = next((r for r in rows(L, "current.toon", "investigations") if r.get("area") == OUTSIDE_AREA), None)
        if out is None:
            L.err("outside_not_checked", "current.toon", "investigations",
                  f"「{OUTSIDE_AREA}」（他のサービス、DB を直接読む集計・帳票、外部連携、利用者の手作業）を調べた行がない")
    for imp in rows(L, "current.toon", "impacts"):
        refs = split_refs(imp.get("specs"))
        cls = imp.get("classification")
        if cls == "must_change":
            if not refs:
                L.err("impact_without_spec", "current.toon", imp.get("id"), "要変更の影響先が仕様につながっていない（タスクに落ちない）")
            for sid in refs:
                if specs.get(sid, {}).get("implementation") != "needed":
                    L.err("impact_spec_not_needed", "current.toon", imp.get("id"), f"要変更の影響先の仕様 {sid} が implementation needed ではない")
        if cls == "keep_regression" and not refs:
            L.err("impact_without_regression", "current.toon", imp.get("id"), "維持・回帰確認の影響先を、回帰を確かめる仕様（受入ケース付き）につなぐ")


TOKEN_RE = re.compile(r"^_(.+)_([1-9][0-9]*)_$")


def required_slots(L):
    """Task slots required by the granularity rule: list of dicts."""
    paths = rows(L, "specs.toon", "paths")
    steps = rows(L, "design.toon", "steps")
    pp = rows(L, "specs.toon", "path_properties")
    cells = {(c.get("path"), c.get("property"), c.get("step")): c for c in rows(L, "design.toon", "matrix")}
    slots = []
    for p in paths:
        pid = p.get("id")
        ps = sorted([s for s in steps if s.get("path") == pid], key=lambda s: s.get("order") if isinstance(s.get("order"), int) else 0)
        props = [x for x in pp if x.get("path") == pid]
        first = next((x.get("property") for x in props if x.get("first") is True), None)
        ordered = ([x for x in props if x.get("property") == first] + [x for x in props if x.get("property") != first])
        for x in ordered:
            prop = x.get("property")
            change_steps = [s for s in ps if cells.get((pid, prop, s.get("id")), {}).get("result") == "change"]
            if not change_steps:
                continue
            if p.get("kind") == "new" and prop == first:
                for s in change_steps:
                    slots.append({"unit": "responsibility", "path": pid, "property": prop, "step": s.get("id"),
                                  "specs": split_refs(cells[(pid, prop, s.get("id"))].get("specs"))})
            else:
                sp = []
                for s in change_steps:
                    for sid in split_refs(cells[(pid, prop, s.get("id"))].get("specs")):
                        if sid not in sp:
                            sp.append(sid)
                slots.append({"unit": "property", "path": pid, "property": prop, "step": "", "specs": sp})
    return slots


def slot_key(t):
    return (t.get("unit"), t.get("path") or "", t.get("property") or "", (t.get("step") or "") if t.get("unit") == "responsibility" else "")


def gate_tasks(L):
    tasks = rows(L, "tasks.toon", "tasks")
    props = by_id(L, "specs.toon", "properties")
    specs = by_id(L, "specs.toon", "specs")
    slots = required_slots(L)
    have = {}
    for t in tasks:
        if t.get("unit") == "non_property":
            continue
        k = slot_key(t)
        if k in have:
            L.err("task_duplicate_slot", "tasks.toon", t.get("id"), f"同じ単位のタスクが2つある（{have[k].get('id')}）")
        have[k] = t
        if t.get("unit") == "responsibility" and not t.get("step"):
            L.err("task_step", "tasks.toon", t.get("id"), "responsibility のタスクには段を書く")
        if t.get("unit") == "property" and t.get("step"):
            L.err("task_step", "tasks.toon", t.get("id"), "property のタスクは全段を通すので段を書かない")
        if not t.get("path") or not t.get("property"):
            L.err("task_path_property", "tasks.toon", t.get("id"), "responsibility/property のタスクには経路とプロパティを書く")
    need = {slot_key(s): s for s in slots}
    for k, s in need.items():
        if k not in have:
            L.err("task_missing", "tasks.toon", f"{k}", "規則で必要なタスクがない（derive-tasks で足せる）")
    for k, t in have.items():
        if k not in need:
            L.err("task_extra", "tasks.toon", t.get("id"), "規則にないタスク（段×プロパティの表に change の欄がない、または単位の誤り）")
    # order: per path, first-property responsibility tasks first in step order, then property tasks
    steps = {s.get("id"): s for s in rows(L, "design.toon", "steps")}
    by_path = {}
    for t in sorted(tasks, key=lambda t: t.get("order") if isinstance(t.get("order"), int) else 0):
        if t.get("path"):
            by_path.setdefault(t.get("path"), []).append(t)
    for pid, ts in by_path.items():
        seen_prop_task = False
        last_step = 0
        for t in ts:
            if t.get("unit") == "responsibility":
                if seen_prop_task:
                    L.err("task_order", "tasks.toon", t.get("id"), "経路の最初のプロパティの責務のタスクは、ほかのプロパティのタスクより先にする")
                so = steps.get(t.get("step"), {}).get("order", 0)
                if so < last_step:
                    L.err("task_order", "tasks.toon", t.get("id"), "責務のタスクは段の順に並べる")
                last_step = so
            elif t.get("unit") == "property":
                seen_prop_task = True
    orders = [t.get("order") for t in tasks]
    if len(set(orders)) != len(orders):
        L.err("task_order_duplicate", "tasks.toon", "", "order が重複している")
    # tokens
    tokens = {}
    names = {}
    for t in sorted(tasks, key=lambda t: t.get("order") if isinstance(t.get("order"), int) else 0):
        tok = t.get("token") or ""
        m = TOKEN_RE.fullmatch(tok)
        if not m:
            L.err("token_format", "tasks.toon", t.get("id"), f"文言は _名前_連番_ にする: {tok!r}")
            continue
        name, num = m.group(1), int(m.group(2))
        if tok in tokens:
            L.err("token_duplicate", "tasks.toon", t.get("id"), f"文言 {tok} が重複している")
        tokens[tok] = t
        if t.get("unit") in ("responsibility", "property"):
            pname = props.get(t.get("property"), {}).get("name")
            if pname is not None and name != pname:
                L.err("token_name", "tasks.toon", t.get("id"), f"文言の名前 {name} がプロパティの名前 {pname} と違う")
        names.setdefault(name, []).append(num)
        if tok not in (t.get("message") or ""):
            L.err("token_message", "tasks.toon", t.get("id"), "コミットメッセージに文言が入っていない")
    for name, nums in names.items():
        if nums != list(range(1, len(nums) + 1)):
            L.err("token_number", "tasks.toon", name, f"_{name}_ の連番は実装の順に 1 から続ける（今は {nums}）")
    # spec links
    links = rows(L, "tasks.toon", "task_specs")
    t2s = {}
    s2t = {}
    for l in links:
        t2s.setdefault(l.get("task"), set()).add(l.get("spec"))
        s2t.setdefault(l.get("spec"), set()).add(l.get("task"))
    for t in tasks:
        if not t2s.get(t.get("id")):
            L.err("task_without_spec", "tasks.toon", t.get("id"), "親の仕様のないタスク")
    for sid, s in specs.items():
        if s.get("implementation") == "needed" and not s2t.get(sid):
            L.err("spec_without_task", "tasks.toon", sid, "実装が要る仕様にタスクがない（タスクの漏れ）")
        if s.get("implementation") == "already_satisfied" and s2t.get(sid):
            L.warn("satisfied_spec_with_task", "tasks.toon", sid, "already_satisfied の仕様にタスクがある")
    # every change cell's specs must be linked to the task that covers the cell
    tasks_by_slot = have
    cells = rows(L, "design.toon", "matrix")
    paths = by_id(L, "specs.toon", "paths")
    pp = rows(L, "specs.toon", "path_properties")
    for c in cells:
        if c.get("result") != "change":
            continue
        pid, prop = c.get("path"), c.get("property")
        first = next((x.get("property") for x in pp if x.get("path") == pid and x.get("first") is True), None)
        if paths.get(pid, {}).get("kind") == "new" and prop == first:
            k = ("responsibility", pid, prop, c.get("step"))
        else:
            k = ("property", pid, prop, "")
        t = tasks_by_slot.get(k)
        if not t:
            continue
        for sid in split_refs(c.get("specs")):
            if sid not in t2s.get(t.get("id"), set()):
                L.err("cell_spec_not_linked", "tasks.toon", t.get("id"), f"欄 {pid}/{prop}/{c.get('step')} の仕様 {sid} がこのタスクにつながっていない")
    for l in links:
        if not (l.get("content") or "").strip():
            L.err("task_spec_content", "tasks.toon", f"{l.get('task')}-{l.get('spec')}", "その仕様についてそのタスクで行うことを書く")


def gate_verify(L, final):
    rv = rows(L, "reviews.toon", "reviewers")
    done_roles = {r.get("role") for r in rv if r.get("status") == "done"}
    for role in REQUIRED_ROLES:
        if role not in done_roles:
            L.err("review_role_missing", "reviews.toon", role, f"役割 {role} の検証が済んでいない")
    reviewers = {r.get("id") for r in rv}
    fixed_rounds = []
    for f in rows(L, "reviews.toon", "findings"):
        st = f.get("status")
        if f.get("reviewer") not in reviewers and f.get("reviewer") != "main":
            L.err("finding_reviewer", "reviews.toon", f.get("id"), "指摘した者が reviewers にない")
        if st == "open":
            L.err("finding_open", "reviews.toon", f.get("id"), "未対処の指摘が残っている")
        if st in ("fixed", "rejected", "escalated") and not (f.get("resolution") or "").strip():
            L.err("finding_resolution", "reviews.toon", f.get("id"), "対処を書く")
        if st == "fixed":
            fixed_rounds.append(f.get("round") or 0)
            vb = f.get("verified_by") or ""
            if vb not in reviewers:
                L.err("finding_verified", "reviews.toon", f.get("id"), "直したことを確かめた検証者（reviewers の ID）を書く")
            elif vb == f.get("reviewer"):
                L.warn("finding_self_verified", "reviews.toon", f.get("id"), "指摘した者と同じ検証者が確かめている")
        if st == "escalated":
            if not any(f.get("id") in split_refs(q.get("targets")) for q in rows(L, "decisions.toon", "questions")):
                L.err("finding_escalated", "reviews.toon", f.get("id"), "escalated の指摘は確認事項（decisions）に載せる")
    if fixed_rounds:
        last_fix = max(fixed_rounds)
        rv_rounds = [r.get("round") for r in rv if r.get("status") == "done"]
        reverify = [r.get("round") for r in rows(L, "reviews.toon", "rounds") if r.get("kind") == "reverify"]
        if not any(x > last_fix for x in reverify) or not any(x > last_fix for x in rv_rounds):
            L.err("reverify_missing", "reviews.toon", "rounds", "直した後の再検証の回（kind reverify、指摘より後の回）がない")
    paths = by_id(L, "specs.toon", "paths")
    dc = {}
    for d in rows(L, "reviews.toon", "desk_checks"):
        dc.setdefault((d.get("path"), d.get("scenario")), []).append(d)
        if d.get("result") == "undetermined" and not split_refs(d.get("findings")):
            L.err("desk_undetermined", "reviews.toon", d.get("id"), "結果が一意に決まらない机上実行は、指摘につなぐ")
        if d.get("result") == "not_applicable" and not (d.get("reason") or "").strip():
            L.err("desk_reason", "reviews.toon", d.get("id"), "not_applicable には理由を書く")
    for pid in paths:
        for sc in DESK_SCENARIOS:
            if (pid, sc) not in dc:
                L.err("desk_missing", "reviews.toon", f"({pid}, {sc})", "経路×場面の机上実行がない")
    if not rows(L, "reviews.toon", "coverage"):
        L.err("coverage_missing", "reviews.toon", "coverage", "確かめた範囲と確かめていない範囲を書く")
    if not any("品質の観点の抜き取り" in (r.get("area") or "") for r in rows(L, "reviews.toon", "coverage")):
        L.err("quality_sample_missing", "reviews.toon", "coverage",
              "「品質の観点の抜き取り」の行がない（本体が副特性ごとに判定を抜き取り、理由のコードを確かめた結果を書く）")


def check_final_state(L):
    qs = rows(L, "decisions.toon", "questions")
    deferred_targets = set()
    for q in qs:
        if q.get("status") == "open":
            L.err("question_open", "decisions.toon", q.get("id"), "答えを待っている確認事項がある")
        if q.get("status") in ("answered",) and not (q.get("answer") or "").strip():
            L.err("question_answer", "decisions.toon", q.get("id"), "answered には答えを書く")
        if q.get("status") in ("deferred", "provisional"):
            deferred_targets |= set(split_refs(q.get("targets")))
    provisional_needed = any(q.get("status") in ("deferred", "provisional") for q in qs)
    # unconfirmed items must be tied to a deferred/provisional question
    for fname, tname in (("needs.toon", "needs"), ("requirements.toon", "requirements"), ("specs.toon", "specs"),
                         ("specs.toon", "properties"), ("current.toon", "behaviors")):
        for r in rows(L, fname, tname):
            if r.get("confidence") == "unconfirmed":
                provisional_needed = True
                if r.get("id") not in deferred_targets:
                    L.err("unconfirmed_untracked", fname, r.get("id"), "未確認の項目は、deferred/provisional の確認事項の targets に入れる")
    status = L.scalar("progress.toon", "status")
    if provisional_needed and status == "complete":
        L.err("status_complete", "progress.toon", "status", "未確認・保留が残るので complete にできない（provisional にする）")
    if not provisional_needed and status == "provisional":
        L.warn("status_provisional", "progress.toon", "status", "未確認・保留がないので complete にできる")
    for k, n in STAGES[:-1]:
        st = next((r for r in rows(L, "progress.toon", "stages") if r.get("key") == k), None)
        if st and st.get("status") not in ("done", "skipped"):
            L.err("stage_not_done", "progress.toon", k, f"段階「{n}」が終わっていない")


GATES = [
    ("current", gate_current),
    ("needs", gate_needs),
    ("requirements", gate_requirements),
    ("quality", gate_quality),
    ("specs", gate_specs),
    ("design", gate_design),
    ("impact", gate_impact),
    ("tasks", gate_tasks),
]


def validate(folder, gate=None, final=False):
    L = Ledger(folder).load()
    for fname, spec in SCHEMA.items():
        if not spec.get("optional") and not os.path.exists(os.path.join(folder, fname)):
            L.err("file_missing", fname, "", "ファイルがない（init で作る）")
    check_structure(L)
    check_progress(L)
    check_evidence(L)
    upto = len(STAGE_KEYS) if final else (stage_index(gate) + 1 if gate else 0)
    if gate == "verify":
        upto = stage_index("verify") + 1
    for key, fn in GATES:
        if stage_index(key) < upto:
            if key == "current" and L.scalar("scope.toon", "kind") == "new" and not rows(L, "current.toon", "investigations"):
                continue
            fn(L)
    if final or gate == "verify":
        gate_verify(L, final)
    if final:
        check_final_state(L)
    return L


def ledger_file_hashes(folder):
    import hashlib
    out = []
    for fname in LEDGER_FILES:
        p = os.path.join(folder, fname)
        if os.path.exists(p):
            with open(p, "rb") as f:
                out.append({"file": fname, "sha256": hashlib.sha256(f.read()).hexdigest()})
    return out


def write_validation(L, mode):
    out = {
        "validated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "mode": mode,
        "error_count": len(L.errors),
        "warning_count": len(L.warnings),
        "files": ledger_file_hashes(L.dir),
        "errors": L.errors,
        "warnings": L.warnings,
    }
    with open(os.path.join(L.dir, "validation.toon"), "w", encoding="utf-8", newline="\n") as f:
        f.write(toon.encode(out))


# ---------------------------------------------------------------------------
# init / derive / stage / fmt / status / schema
# ---------------------------------------------------------------------------

def empty_doc(fname):
    spec = SCHEMA[fname]
    doc = {}
    for k, col in spec.get("scalars", {}).items():
        if col["kind"] == "bool":
            doc[k] = False
        elif col["kind"] == "enum":
            doc[k] = col["values"][0]
        else:
            doc[k] = ""
    for t in spec.get("tables", {}):
        doc[t] = []
    return doc


def save(folder, fname, doc):
    text = toon.encode(doc)
    toon.decode(text)  # never write something we cannot read back
    with open(os.path.join(folder, fname), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load_doc(folder, fname):
    with open(os.path.join(folder, fname), "rb") as f:
        return toon.decode(f.read())


def cmd_init(a):
    os.makedirs(a.dir, exist_ok=True)
    now = datetime.datetime.now()
    existing = [f for f in LEDGER_FILES if os.path.exists(os.path.join(a.dir, f))]
    if existing:
        print(f"止めました：既にあるファイル {existing}（再開するときは init しない）", file=sys.stderr)
        return 1
    for fname, spec in SCHEMA.items():
        if spec.get("optional"):
            continue
        doc = empty_doc(fname)
        if fname == "progress.toon":
            doc.update({"skill": "micropower-investigate", "topic": a.topic,
                        "status": "in_progress", "current_stage": "prepare",
                        "updated": now.strftime("%Y-%m-%d %H:%M"), "next": "scope.toon を埋める"})
            doc["stages"] = [{"key": k, "name": n, "status": "in_progress" if k == "prepare" else "pending", "note": ""} for k, n in STAGES]
        if fname == "scope.toon":
            doc.update({"topic": a.topic, "request": a.request or "（依頼の原文をここに書く）", "kind": a.kind,
                        "repo_root": os.path.abspath(a.repo).replace("\\", "/"), "output_dir": os.path.abspath(a.dir).replace("\\", "/"),
                        "created": now.strftime("%Y-%m-%d"), "git_commit": "", "git_dirty": False})
        save(a.dir, fname, doc)
    print(f"作成しました：{os.path.abspath(a.dir)}（{len(LEDGER_FILES) - 1} ファイル）")
    return 0


def cmd_derive(a):
    L = Ledger(a.dir).load()
    if L.errors:
        for e in L.errors:
            print(f"ERROR {e['file']} {e['target']}: {e['message']}")
        return 1
    doc = L.data["tasks.toon"] or empty_doc("tasks.toon")
    tasks = doc.get("tasks", [])
    links = doc.get("task_specs", [])
    props = {p.get("id"): p for p in rows(L, "specs.toon", "properties")}
    have = {slot_key(t): t for t in tasks if t.get("unit") != "non_property"}
    used_ids = {t.get("id") for t in tasks}
    next_id = 1
    added = 0
    order_base = max([t.get("order") for t in tasks if isinstance(t.get("order"), int)] or [0])
    for s in required_slots(L):
        k = (s["unit"], s["path"], s["property"], s["step"])
        t = have.get(k)
        if t is None:
            while f"T{next_id:03d}" in used_ids:
                next_id += 1
            tid = f"T{next_id:03d}"
            used_ids.add(tid)
            order_base += 1
            t = {"id": tid, "order": order_base, "token": "", "unit": s["unit"], "path": s["path"],
                 "property": s["property"], "step": s["step"], "content": "", "files": "", "tests": "", "message": ""}
            tasks.append(t)
            have[k] = t
            added += 1
        for sid in s["specs"]:
            if not any(l.get("task") == t["id"] and l.get("spec") == sid for l in links):
                links.append({"task": t["id"], "spec": sid, "content": ""})
    # renumber tokens per name in order
    counters = {}
    for t in sorted(tasks, key=lambda t: t.get("order") if isinstance(t.get("order"), int) else 0):
        if t.get("unit") in ("responsibility", "property"):
            name = props.get(t.get("property"), {}).get("name") or "?"
        else:
            m = TOKEN_RE.fullmatch(t.get("token") or "")
            name = m.group(1) if m else None
            if name is None:
                continue
        counters[name] = counters.get(name, 0) + 1
        newtok = f"_{name}_{counters[name]}_"
        old = t.get("token") or ""
        if old and old != newtok and old in (t.get("message") or ""):
            t["message"] = t["message"].replace(old, newtok)
        t["token"] = newtok
    doc["tasks"] = tasks
    doc["task_specs"] = links
    save(a.dir, "tasks.toon", doc)
    print(f"タスク {added} 件を足し、文言を振り直しました（全 {len(tasks)} 件）。空の欄（content・files・tests・message・task_specs の content）を埋めてください。")
    return 0


def cmd_stage(a):
    doc = load_doc(a.dir, "progress.toon")
    if a.key not in STAGE_KEYS:
        print(f"段階は {STAGE_KEYS} のどれか", file=sys.stderr)
        return 1
    for r in doc["stages"]:
        if r["key"] == a.key:
            r["status"] = a.status
            if a.note is not None:
                r["note"] = a.note
    if a.status == "in_progress":
        doc["current_stage"] = a.key
    if a.next is not None:
        doc["next"] = a.next
    doc["updated"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    save(a.dir, "progress.toon", doc)
    print(f"{a.key} を {a.status} にしました")
    return 0


def cmd_fmt(a):
    bad = 0
    for fname in LEDGER_FILES + ["validation.toon"]:
        p = os.path.join(a.dir, fname)
        if not os.path.exists(p):
            continue
        try:
            doc = load_doc(a.dir, fname)
        except toon.ToonError as e:
            print(f"ERROR {fname}: {e}")
            bad += 1
            continue
        save(a.dir, fname, doc)
    return 1 if bad else 0


def cmd_status(a):
    L = Ledger(a.dir).load()
    print(f"題目: {L.scalar('progress.toon', 'topic')}  状態: {L.scalar('progress.toon', 'status')}  段階: {L.scalar('progress.toon', 'current_stage')}")
    print(f"次: {L.scalar('progress.toon', 'next')}")
    for fname, spec in SCHEMA.items():
        if L.data.get(fname) is None:
            continue
        counts = ", ".join(f"{t} {len(L.table(fname, t))}" for t in spec.get("tables", {}))
        print(f"  {fname}: {counts}")
    qs = [q for q in rows(L, "decisions.toon", "questions") if q.get("status") == "open"]
    print(f"未回答の確認事項: {len(qs)}")
    for q in qs:
        print(f"  - {q.get('id')} {q.get('question')}")
    return 0


def schema_markdown():
    out = ["# 台帳（TOON）のスキーマ", "",
           "このファイルは `python -X utf8 scripts/ledger.py schema --markdown` で生成する。手で直さない。", "",
           "## 目次", ""]
    for fname, spec in SCHEMA.items():
        tables = "、".join(spec.get("tables", {}).keys())
        out.append(f"- {fname}（{spec['desc']}）：{tables}")
    out.append("")
    kinds = {"id": "ID（台帳全体で一意）", "ref": "参照（1つの ID）", "refs": "参照（ID を空白区切り）", "text": "文字列（空にできない）",
             "opt": "文字列（空でよい）", "enum": "列挙", "int": "整数", "bool": "true/false",
             "evpath": "根拠のパス（リポジトリからの相対パス／conversation／doc:相対パス／none）", "evline": "根拠の行（整数、なければ 0）",
             "evquote": "根拠の文字列（その行の前後3行にある文字列をそのまま）"}
    for fname, spec in SCHEMA.items():
        out.append(f"## {fname}（{spec['desc']}）" + ("　※任意" if spec.get("optional") else ""))
        out.append("")
        if spec.get("scalars"):
            out.append("| キー | 種類 | 説明 |")
            out.append("|-|-|-|")
            for k, c in spec["scalars"].items():
                kind = kinds[c["kind"]] + (f"：{' / '.join(c['values'])}" if c["kind"] == "enum" else "")
                out.append(f"| {k} | {kind} | {c['desc']} |")
            out.append("")
        for t, ts in spec.get("tables", {}).items():
            out.append(f"### {t}（{ts['desc']}）")
            out.append("")
            out.append("| 列 | 種類 | 説明 |")
            out.append("|-|-|-|")
            for k, c in ts["cols"].items():
                kind = kinds[c["kind"]]
                if c["kind"] == "enum":
                    kind += "：" + " / ".join(c["values"])
                if c["kind"] in ("ref", "refs"):
                    kind += f"（{c['target'] if c['target'] != '*' else '台帳の任意の ID'}）" + ("、空でよい" if c.get("optional") or c["kind"] == "refs" else "")
                out.append(f"| {k} | {kind} | {c['desc']} |")
            out.append("")
    return "\n".join(out)


def main(argv):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="台帳（TOON）の作成・検査")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init")
    p.add_argument("dir")
    p.add_argument("--topic", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--kind", default="change", choices=["new", "change", "mixed"])
    p.add_argument("--request")
    p = sub.add_parser("validate")
    p.add_argument("dir")
    p.add_argument("--gate", choices=STAGE_KEYS)
    p.add_argument("--final", action="store_true")
    p.add_argument("--write", action="store_true")
    p = sub.add_parser("derive-tasks")
    p.add_argument("dir")
    p = sub.add_parser("stage")
    p.add_argument("dir")
    p.add_argument("key")
    p.add_argument("status", choices=["pending", "in_progress", "done", "skipped"])
    p.add_argument("--next")
    p.add_argument("--note")
    p = sub.add_parser("fmt")
    p.add_argument("dir")
    p = sub.add_parser("status")
    p.add_argument("dir")
    p = sub.add_parser("schema")
    p.add_argument("--markdown", action="store_true")
    a = ap.parse_args(argv[1:])
    if a.cmd == "init":
        return cmd_init(a)
    if a.cmd == "validate":
        L = validate(a.dir, a.gate, a.final)
        mode = "final" if a.final else (f"gate:{a.gate}" if a.gate else "structure")
        for e in L.errors:
            print(f"ERROR   [{e['code']}] {e['file']} {e['target']}: {e['message']}")
        for w in L.warnings:
            print(f"WARNING [{w['code']}] {w['file']} {w['target']}: {w['message']}")
        print(f"{mode}: エラー {len(L.errors)} 件、警告 {len(L.warnings)} 件")
        if a.write:
            write_validation(L, mode)
        return 1 if L.errors else 0
    if a.cmd == "derive-tasks":
        return cmd_derive(a)
    if a.cmd == "stage":
        return cmd_stage(a)
    if a.cmd == "fmt":
        return cmd_fmt(a)
    if a.cmd == "status":
        return cmd_status(a)
    if a.cmd == "schema":
        print(schema_markdown() if a.markdown else toon.encode({f: {t: list(ts["cols"]) for t, ts in s.get("tables", {}).items()} for f, s in SCHEMA.items()}))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
