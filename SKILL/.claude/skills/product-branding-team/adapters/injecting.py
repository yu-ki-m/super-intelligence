"""評価用：指定した作業に不良成果物を差し込み、それ以外は実接続へ渡す。

差し込んだ出力は実行記録に injected_output として残り、エージェントの発言として扱わない。
"""
from __future__ import annotations

import fnmatch
import json

from .base import Adapter, AgentResult


class InjectingAdapter(Adapter):
    def __init__(self, inner: Adapter, rules: dict):
        """rules は {作業IDの型: 差し込む出力の辞書} である。各型は最初の1回だけ差し込む。"""
        self.inner = inner
        self.rules = dict(rules)
        self.name = inner.name
        self.simulated = inner.simulated
        self.used = set()

    def probe(self, workdir):
        return self.inner.probe(workdir)

    def invoke(self, req):
        for pattern, payload in self.rules.items():
            if pattern not in self.used and fnmatch.fnmatchcase(req.task_id, pattern):
                self.used.add(pattern)
                return AgentResult(True, payload=payload, raw=json.dumps({"injected": True, "payload": payload}, ensure_ascii=False), injected=True)
        return self.inner.invoke(req)
