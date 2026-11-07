"""エージェント実行基盤との接続の共通定義。"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class AgentRequest:
    task_id: str
    attempt_id: str
    instance_id: str
    role: str
    kind: str
    prompt: str
    schema: dict
    cwd: Path
    session_id: str | None = None
    timeout_sec: int = 600
    model: str | None = None
    tools: list = field(default_factory=lambda: ["Read", "Grep", "Glob"])
    max_turns: int = 12
    meta: dict = field(default_factory=dict)


@dataclass
class AgentResult:
    ok: bool
    payload: dict | None = None
    # timeout / invalid_output / session_lost / env_limit / not_dispatched / crash / unavailable
    error_class: str | None = None
    error_detail: str = ""
    session_id: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_cumulative: float | None = None
    cost_basis: str | None = None
    raw: str = ""
    simulated: bool = False
    injected: bool = False  # 評価のために差し込んだ出力であり、エージェントの発言ではない


@dataclass
class Capability:
    """利用環境で実際に確かめた機能。推測で埋めない。"""

    adapter: str
    simulated: bool
    spawn: bool = False
    resume: bool = False
    structured_result: bool = False
    relay: bool = False
    direct_peer: bool = False
    notes: list = field(default_factory=list)
    version: str = ""

    @property
    def debate_possible(self) -> bool:
        return self.spawn and self.resume and self.structured_result and (self.relay or self.direct_peer)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["debate_possible"] = self.debate_possible
        return d


class Adapter:
    name = "base"
    simulated = False

    def probe(self, workdir: Path) -> Capability:  # pragma: no cover - 抽象定義
        raise NotImplementedError

    def invoke(self, req: AgentRequest) -> AgentResult:  # pragma: no cover - 抽象定義
        raise NotImplementedError


class UnavailableAdapter(Adapter):
    """サブエージェントを起動できない環境を表す。単一エージェントの模擬会話へ切り替えない。"""

    name = "unavailable"

    def __init__(self, reason="独立したサブエージェントを起動できない"):
        self.reason = reason

    def probe(self, workdir):
        return Capability(self.name, simulated=False, notes=[self.reason])

    def invoke(self, req):
        return AgentResult(False, error_class="unavailable", error_detail=self.reason)
