"""実接続：Claude Code の `claude -p` を別プロセスとして起動する。

各インスタンスは独立したプロセスとセッションであり、続きの発言は `--resume` で同じ
セッションへ渡す。どの動作も probe() が利用環境で実際に確かめた結果に基づいて使う。
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from .base import Adapter, AgentRequest, AgentResult, Capability

ENV_LIMIT = re.compile(
    r"rate.?limit|usage limit|limit reached|hit your .*limit|too many requests|\b429\b|\b529\b|overloaded|credit balance|quota",
    re.I,
)
SESSION_LOST = re.compile(r"No conversation found", re.I)


class ClaudeCliAdapter(Adapter):
    name = "claude_cli"
    simulated = False

    def __init__(self, model="sonnet", effort=None, executable=None, allow_web=False):
        self.model = model
        self.effort = effort
        self.executable = executable or shutil.which("claude")
        self.allow_web = allow_web

    def _base_cmd(self, tools, model, max_turns, schema=None, session_id=None):
        # --restricted はファイル操作を作業フォルダーの中に限り、--safe-mode は利用者の
        # CLAUDE.md やスキルを読み込まない。役割の独立性を保つために使う。
        cmd = [
            self.executable, "-p", "--output-format", "json", "--model", model or self.model,
            "--restricted", "--safe-mode", "--strict-mcp-config",
            "--settings", '{"disableAllHooks":true}',
            "--tools", ",".join(tools) if tools else "",
            "--max-turns", str(max_turns),
        ]
        if tools:
            cmd += ["--allowedTools", ",".join(tools)]
        if self.effort:
            cmd += ["--effort", self.effort]
        if schema:
            cmd += ["--json-schema", json.dumps(schema, ensure_ascii=False, separators=(",", ":"))]
        if session_id:
            cmd += ["--resume", session_id]
        return cmd

    def invoke(self, req: AgentRequest) -> AgentResult:
        if not self.executable:
            return AgentResult(False, error_class="unavailable", error_detail="claude コマンドが見つからない")
        tools = list(req.tools)
        if self.allow_web and tools:
            tools += ["WebSearch", "WebFetch"]
        cmd = self._base_cmd(tools, req.model, req.max_turns, req.schema, req.session_id)
        try:
            proc = subprocess.run(
                cmd, input=req.prompt.encode("utf-8"), cwd=str(req.cwd), capture_output=True,
                timeout=req.timeout_sec,
            )
        except subprocess.TimeoutExpired as exc:
            return AgentResult(False, error_class="timeout", error_detail=f"{req.timeout_sec}秒で打ち切り",
                               raw=(exc.stdout or b"").decode("utf-8", "replace"))
        except OSError as exc:
            return AgentResult(False, error_class="unavailable", error_detail=str(exc))
        return self._parse(proc.returncode, proc.stdout, proc.stderr)

    @staticmethod
    def _parse(returncode, stdout, stderr) -> AgentResult:
        out = stdout.decode("utf-8", "replace")
        err = stderr.decode("utf-8", "replace")
        data = None
        try:
            data = json.loads(out)
        except ValueError:
            pass
        text = f"{err}\n{out if data is None else data.get('result', '')}"
        if data is None:
            if returncode != 0:
                if SESSION_LOST.search(text):
                    return AgentResult(False, error_class="session_lost", error_detail=text[:500], raw=out)
                if ENV_LIMIT.search(text):
                    return AgentResult(False, error_class="env_limit", error_detail=text[:500], raw=out)
                return AgentResult(False, error_class="crash", error_detail=text[:500], raw=out)
            return AgentResult(False, error_class="invalid_output", error_detail="JSON でない応答", raw=out)
        usage = data.get("usage") or {}
        basis = next((m.get("costBasis") for m in (data.get("modelUsage") or {}).values()), None)
        common = dict(
            session_id=data.get("session_id"),
            tokens_in=sum(usage.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")) if usage else None,
            tokens_out=usage.get("output_tokens"),
            cost_cumulative=data.get("total_cost_usd"),
            cost_basis=basis,
            raw=out,
        )
        if data.get("is_error") or data.get("subtype") not in (None, "success"):
            cls = "env_limit" if ENV_LIMIT.search(text) else "crash"
            return AgentResult(False, error_class=cls, error_detail=f"{data.get('subtype')}: {text[:400]}", **common)
        payload = data.get("structured_output")
        if payload is None:
            try:
                payload = json.loads(data.get("result") or "")
            except ValueError:
                return AgentResult(False, error_class="invalid_output", error_detail="構造化された結果がない", **common)
        return AgentResult(True, payload=payload, **common)

    def probe(self, workdir: Path) -> Capability:
        cap = Capability(self.name, simulated=False)
        if not self.executable:
            cap.notes.append("claude コマンドが見つからない")
            return cap
        version = subprocess.run([self.executable, "--version"], capture_output=True)
        cap.version = version.stdout.decode("utf-8", "replace").strip()
        workdir = Path(workdir)
        workdir.mkdir(parents=True, exist_ok=True)
        schema = {"type": "object", "properties": {"said": {"type": "string"}}, "required": ["said"]}
        first = self.invoke(AgentRequest(
            "probe", "probe@1", "probe", "probe", "probe",
            "接続確認です。確認語は「あおい73」です。said に「受領」と入れて返してください。",
            schema, workdir, timeout_sec=180, tools=[], max_turns=4))
        if not first.ok:
            cap.notes.append(f"起動の確認に失敗: {first.error_class} {first.error_detail[:200]}")
            return cap
        cap.spawn = True
        cap.structured_result = isinstance(first.payload, dict) and "said" in first.payload
        second = self.invoke(AgentRequest(
            "probe", "probe@2", "probe", "probe", "probe",
            "【転送された発言 M1】別のエージェントが「確認語を教えてください」と尋ねています。"
            "最初に伝えられた確認語を said に入れて答えてください。",
            schema, workdir, session_id=first.session_id, timeout_sec=180, tools=[], max_turns=4))
        if second.ok and "あおい73" in json.dumps(second.payload, ensure_ascii=False):
            cap.resume = True
            cap.relay = True
            cap.notes.append("再開したセッションが以前の内容を保持し、転送した発言へ応答した")
        else:
            cap.notes.append(f"再開の確認に失敗: {second.error_class} {second.error_detail[:200]}")
        cap.notes.append("エージェント同士の直接通信は使わず、ハーネスが実際の発言を宛先のセッションへ転送する")
        return cap
