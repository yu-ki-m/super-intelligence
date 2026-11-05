"""ハーネスの操作口。スキルと利用者はこのコマンドで開始・確認・再開・停止を行う。"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from adapters.base import UnavailableAdapter
from adapters.claude_cli import ClaudeCliAdapter
from adapters.mock import MockAdapter

from . import planner, report
from .engine import Engine, init_run
from .store import Store


def make_adapter(args):
    name = getattr(args, "adapter", "claude_cli")
    if name == "mock":
        return MockAdapter()
    if name == "unavailable":
        return UnavailableAdapter()
    return ClaudeCliAdapter(model=getattr(args, "model", "sonnet"), effort=getattr(args, "effort", None), allow_web=getattr(args, "allow_web", False))


def cmd_probe(args):
    cap = make_adapter(args).probe(Path(args.workdir))
    print(json.dumps(cap.to_dict(), ensure_ascii=False, indent=1))
    return 0 if cap.debate_possible else 1


def cmd_check_graph(args):
    graph = planner.load_graph(args.graph)
    errors = planner.check_all(graph)
    print("問題なし" if not errors else "\n".join(errors))
    print(f"呼び出し数の上限の目安：{planner.call_ceiling(graph, {'revisions': 2, 'same_failure_retry': 1, 'debate_rounds': 3})}")
    return 1 if errors else 0


def cmd_init(args):
    brief = json.loads(Path(args.brief).read_text(encoding="utf-8"))
    adapter = make_adapter(args)
    settings = {"concurrency": args.concurrency, "model": args.model, "timeout_sec": args.timeout_sec}
    budget = {}
    if args.max_calls:
        budget["max_calls"] = args.max_calls
    if args.debate_rounds:
        budget["debate_rounds"] = args.debate_rounds
    if args.revisions is not None:
        budget["revisions"] = args.revisions
    store = init_run(args.run_dir, brief, args.graph, adapter, settings, budget)
    print(report.status_text(store))
    return 1 if store.get_meta("design_only") else 0


def cmd_run(args):
    store = Store(args.run_dir)
    settings = store.get_meta("settings") or {}
    store.close()
    args.model = args.model or settings.get("model", "sonnet")
    if not hasattr(args, "adapter") or not args.adapter:
        store = Store(args.run_dir)
        args.adapter = store.get_meta("adapter")
        store.close()
    store = Store(args.run_dir)
    args.allow_web = args.allow_web or bool((store.get_meta("brief") or {}).get("allow_web"))
    store.close()
    engine = Engine(args.run_dir, make_adapter(args))
    result = engine.run(max_results=args.max_results)
    print(report.status_text(engine.store))
    report.export(engine.store)
    engine.store.close()
    return 0 if result not in {"execution_failed", "locked"} else 1


def cmd_status(args):
    store = Store(args.run_dir)
    print(report.status_text(store))
    return 0


def cmd_stop(args):
    store = Store(args.run_dir)
    store.set_meta("stop_requested", True)
    store.event("stop_requested")
    print("停止を要求した。実行中の呼び出しが終わると一時停止する。")
    return 0


def cmd_abort(args):
    store = Store(args.run_dir)
    store.set_meta("abort_requested", True)
    store.event("abort_requested")
    if not store.get_meta("run_lock"):
        store.set_run_status("aborted", "依頼者の指示で中止した")
    print("中止を要求した。")
    return 0


def cmd_update_source(args):
    store = Store(args.run_dir)
    adapter_name = store.get_meta("adapter")
    store.close()
    args.adapter = adapter_name
    args.model = getattr(args, "model", None) or "sonnet"
    engine = Engine(args.run_dir, make_adapter(args))
    text = Path(args.file).read_text(encoding="utf-8")
    print(json.dumps(engine.update_source(args.source, text, retrieved_at=args.retrieved_at), ensure_ascii=False, indent=1))
    print("run で再確認を進める。")
    return 0


def cmd_export(args):
    store = Store(args.run_dir)
    out, names = report.export(store, args.out)
    print(f"{out} に {len(names)} 件のファイルを書き出した：{', '.join(names)}")
    return 0


def cmd_log_human(args):
    store = Store(args.run_dir)
    store.db.execute("INSERT INTO human_log(minutes,activity,created_at) VALUES(?,?,?)", (args.minutes, args.activity, time.time()))
    print("人間の介入時間を記録した。")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="pbteam", description="product-branding-team のハーネス")
    sub = parser.add_subparsers(dest="cmd", required=True)

    def adapter_options(p):
        p.add_argument("--adapter", default="claude_cli", choices=["claude_cli", "mock", "unavailable"])
        p.add_argument("--model", default="sonnet")
        p.add_argument("--effort", default=None)
        p.add_argument("--allow-web", action="store_true")

    p = sub.add_parser("probe", help="サブエージェントの起動・再開・結果取得・発言の受け渡しを実際に確かめる")
    adapter_options(p)
    p.add_argument("--workdir", default=".pbteam-probe")
    p.set_defaults(func=cmd_probe)

    p = sub.add_parser("check-graph", help="グラフ定義を検査する")
    p.add_argument("graph")
    p.set_defaults(func=cmd_check_graph)

    p = sub.add_parser("init", help="依頼から実行を作る")
    adapter_options(p)
    p.add_argument("--brief", required=True)
    p.add_argument("--graph", default="minimal")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--concurrency", type=int, default=1)
    p.add_argument("--timeout-sec", type=int, default=900)
    p.add_argument("--max-calls", type=int)
    p.add_argument("--debate-rounds", type=int)
    p.add_argument("--revisions", type=int)
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("run", help="実行を開始または再開する")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--max-results", type=int, help="この件数の結果を受け取ったら一時停止する")
    p.add_argument("--adapter", default=None)
    p.add_argument("--model", default=None)
    p.add_argument("--effort", default=None)
    p.add_argument("--allow-web", action="store_true")
    p.set_defaults(func=cmd_run)

    for name, func, text in (("status", cmd_status, "現在地を表示する"), ("stop", cmd_stop, "一時停止を要求する"), ("abort", cmd_abort, "中止する")):
        p = sub.add_parser(name, help=text)
        p.add_argument("--run-dir", required=True)
        p.set_defaults(func=func)

    p = sub.add_parser("update-source", help="資料を更新し、影響する下流の合格を無効にする")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--file", required=True)
    p.add_argument("--retrieved-at", help="資料の確認日。省略すると実行した日にする")
    p.set_defaults(func=cmd_update_source)

    p = sub.add_parser("export", help="提出物と記録を書き出す")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--out")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("log-human", help="人間の確認・修正にかかった時間を記録する")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--minutes", type=float, required=True)
    p.add_argument("--activity", required=True)
    p.set_defaults(func=cmd_log_human)
    return parser


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    return args.func(args)
