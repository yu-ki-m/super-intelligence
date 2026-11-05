"""試験の共通部品。ここでの実行はすべて模擬実装であり、内容の品質や実接続の証拠にならない。"""
from __future__ import annotations

import datetime as dt
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from adapters.mock import MockAdapter  # noqa: E402
from harness.engine import Engine, init_run  # noqa: E402

SOURCE_TEXT = """架空の試験資料である。
担当者が不在の日は、共有表の更新が止まる。
窓口の責任者は、週に一度、未対応の依頼を確認している。
"""

SOURCE_TEXT_B = """架空の試験資料である（別の話題）。
導入の審査では、情報システム担当が権限の設定を確認する。
"""


def brief(**overrides):
    data = {
        "product": {"id": "hikitsugi", "name": "架空製品ヒキツギ帳", "type": "B2B"},
        "goal": "誰に何を約束するかの仮説を作る",
        "stage": "pilot",
        "decision_maker": "架空の企画責任者",
        "constraints": [],
        "planned_features": [{"name": "自動割り当て", "keywords": ["自動割り当て", "自動で割り当て"]}],
        "materials": [
            {"id": "S1", "text": SOURCE_TEXT, "title": "架空の窓口の観察記録", "retrieved_at": "2026-10-01"},
            {"id": "S2", "text": SOURCE_TEXT_B, "title": "架空の導入審査メモ", "retrieved_at": "2026-10-01"},
        ],
    }
    data.update(overrides)
    return data


class RunCase(unittest.TestCase):
    """一時フォルダーに実行を作る。Windows で閉じ忘れによる削除失敗を避けるため後始末を揃える。"""

    graph = "minimal"
    today = dt.date(2026, 11, 6)

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="pbt_"))
        self.engines = []

    def tearDown(self):
        for engine in self.engines:
            try:
                engine.store.close()
            except Exception:
                pass
        shutil.rmtree(self.dir, ignore_errors=True)

    def start(self, script=None, brief_data=None, budget=None, settings=None, name="run", adapter=None, graph=None, **engine_kw):
        adapter = adapter or MockAdapter(script)
        run_dir = self.dir / name
        store = init_run(run_dir, brief_data or brief(), graph or self.graph, adapter, settings=settings, budget=budget)
        store.close()
        engine = Engine(run_dir, adapter, today=self.today, **engine_kw)
        self.engines.append(engine)
        return engine, adapter

    def reopen(self, engine, adapter=None, **kw):
        engine.store.close()
        new = Engine(engine.store.run_dir, adapter or engine.adapter, today=self.today, **kw)
        self.engines.append(new)
        return new

    @staticmethod
    def states(engine):
        return {t["task_id"]: t["state"] for t in engine.store.tasks()}

    @staticmethod
    def event_types(engine):
        return [e["type"] for e in engine.store.events()]
