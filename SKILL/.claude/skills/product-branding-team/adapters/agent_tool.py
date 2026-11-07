"""実接続：親の会話（Claude Code）が Agent ツールでサブエージェントを起動する。

ハーネスは親の会話の外のプロセスで動くので、Agent ツールを直接呼べない。そこで依頼と結果を
ファイルで受け渡す。

1. invoke() が依頼文・出力形式・作業手順を exchange/<試行>/ に書き、受け取りを待つ。
2. 親の会話が `pbteam.py pending` で依頼を受け取り、Agent ツールでサブエージェントを起動する。
3. サブエージェントが作業手順に従い、結果を result.json に書く。
4. 親の会話がサブエージェントの完了通知を受けて `pbteam.py done` を実行する。
5. invoke() が result.json を読んで返す。形式の検査は従来どおりハーネスが行う。

サブエージェントは親の会話と同じ接続先と認証で動く。`claude -p` の別プロセスのように、
接続先の設定（Bedrock など）を子が読み込み直す必要がない。

会話の継続（`--resume` に当たるもの）は、同じインスタンスの以前の依頼文と結果のファイルを
新しいサブエージェントに順に読ませて行う。記録は exchange/sessions/ にあるので、親の会話が
終わっても続きから再開できる。同じ会話の記憶を保つ方式ではないことを probe の記録に残す。
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import sys
import time
import uuid
from pathlib import Path

from harness.leases import _alive

from .base import Adapter, AgentRequest, AgentResult, Capability
from .claude_cli import ENV_LIMIT

ROOT = Path(__file__).resolve().parent.parent
PBTEAM = ROOT / "pbteam.py"
AGENT_MODELS = {"sonnet", "opus", "haiku", "fable"}
SUBAGENT_TYPE = "general-purpose"


def _safe(name):
    return re.sub(r"[^A-Za-z0-9_.@-]", "_", name)


def _write_json(path: Path, data):
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _claim(directory: Path, by: str) -> bool:
    """依頼の受け取りと打ち切りのどちらか一方だけが成立するよう、排他的にファイルを作る。"""
    try:
        fd = os.open(directory / "claim.json", os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"by": by, "at": time.time()}))
    return True


def exchange_dir(root) -> Path:
    return Path(root).resolve() / "exchange"


def attempt_dir(root, attempt_id) -> Path:
    return exchange_dir(root) / _safe(attempt_id)


class AgentToolAdapter(Adapter):
    name = "agent"
    simulated = False

    def __init__(self, root, model="sonnet", allow_web=False, pickup_sec=300, poll_sec=1.0,
                 clock=time.time, sleep=time.sleep):
        self.root = Path(root).resolve()
        self.model = model
        self.allow_web = allow_web
        self.pickup_sec = pickup_sec
        self.poll_sec = poll_sec
        self.clock = clock
        self.sleep = sleep

    # 依頼 -------------------------------------------------------------
    def invoke(self, req: AgentRequest) -> AgentResult:
        history = []
        if req.session_id:
            session = _read_json(self._session_path(req.session_id))
            if session is None:
                return AgentResult(False, error_class="session_lost",
                                   error_detail=f"No conversation found：セッション {req.session_id} の記録がない")
            history = session.get("turns", [])
        directory = attempt_dir(self.root, req.attempt_id)
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)
        (directory / "prompt.md").write_text(req.prompt, encoding="utf-8")
        _write_json(directory / "schema.json", req.schema)
        (directory / "instructions.md").write_text(self._instructions(req, directory, history), encoding="utf-8")
        model = req.model or self.model
        _write_json(exchange_dir(self.root) / "owner.json", {"pid": os.getpid(), "at": self.clock()})
        _write_json(directory / "request.json", {
            "attempt_id": req.attempt_id, "task_id": req.task_id, "instance_id": req.instance_id,
            "role": req.role, "kind": req.kind, "owner_pid": os.getpid(), "created_at": self.clock(),
            "description": f"pbteam {req.attempt_id}"[:60],
            "subagent_type": SUBAGENT_TYPE,
            "model": model if model in AGENT_MODELS else None,
            "prompt": (f"product-branding-team のハーネスから受けた作業 {req.attempt_id} を1件だけ行う。"
                       f"最初に {directory / 'instructions.md'} を Read で読み、そこに書かれた手順だけに従う。"
                       f"最後の返答は「提出した：{req.attempt_id}」だけにする。"),
        })
        return self._wait(req, directory, history)

    def _instructions(self, req, directory, history):
        view = Path(req.cwd).resolve()
        lines = [f"# 作業 {req.attempt_id} の手順", ""]
        step = 1
        if history:
            lines.append(f"{step}. このインスタンス（{req.instance_id}）は以前にも作業している。次のファイルを順に読み、以前の依頼と、自分が返した結果を把握する。以前の作業はやり直さない。")
            for i, turn in enumerate(history, 1):
                lines.append(f"   - 以前の依頼 {i}：{self.root / turn['prompt']}")
                lines.append(f"   - 以前の結果 {i}：{self.root / turn['result']}")
            step += 1
        lines.append(f"{step}. 今回の依頼文 {directory / 'prompt.md'} を Read で最後まで読み、その指示に従う。長くて一度に読めない場合は、分けて最後まで読む。")
        step += 1
        lines.append(f"{step}. 依頼文に出てくる inputs/ などの相対パスは、作業フォルダー {view} からのパスである。"
                     "読むのは作業フォルダーの中のファイルと、この手順に書かれたファイルだけにする。どのファイルも変更しない（結果のファイルを除く）。")
        step += 1
        lines.append(f"{step}. " + ("Web 検索と Web の取得を使ってよい。出典の URL を根拠に記録する。" if self.allow_web
                                    else "Web 検索と Web の取得は使わない。"))
        step += 1
        lines.append(f"{step}. 結果は、出力形式 {directory / 'schema.json'}（JSON Schema）に合う JSON にして、Write で {directory / 'result.json'} に書く。"
                     "ファイルには JSON だけを書き、前後に説明を付けない。")
        step += 1
        lines.append(f"{step}. Bash を使える場合は、書いた後に次のコマンドで形式を確かめ、問題が示されたら直して、もう一度確かめる。"
                     "使えない場合はこの手順を飛ばす。\n"
                     f"   \"{sys.executable}\" \"{PBTEAM}\" check-output --run-dir \"{self.root}\" --attempt \"{req.attempt_id}\"")
        step += 1
        lines.append(f"{step}. 最後の返答は「提出した：{req.attempt_id}」だけにする。結果の内容を返答に書かない。"
                     "利用者への報告や読み上げ、スキル（Skill ツール）、サブエージェント（Agent ツール）は使わない。")
        return "\n".join(lines) + "\n"

    def _wait(self, req, directory, history):
        created = self.clock()
        timeout = max(1, int(req.timeout_sec))
        pickup_deadline = created + min(self.pickup_sec, timeout / 2)
        deadline = created + timeout
        dispatched = False
        while not (directory / "done.json").exists():
            now = self.clock()
            if not dispatched:
                dispatched = (directory / "claim.json").exists()
            if not dispatched and now >= pickup_deadline:
                if _claim(directory, "withdraw"):
                    _write_json(directory / "withdrawn.json", {"reason": "not_dispatched", "at": now})
                    return AgentResult(False, error_class="not_dispatched",
                                       error_detail=f"{int(now - created)}秒待っても、親の会話が依頼を受け取らなかった（pbteam.py pending が実行されていない）")
                dispatched = True  # 打ち切りの直前に受け取られた
                continue
            if now >= deadline:
                _write_json(directory / "withdrawn.json", {"reason": "timeout", "at": now})
                return AgentResult(False, error_class="timeout", error_detail=f"{timeout}秒以内にサブエージェントの完了が届かなかった")
            self.sleep(self.poll_sec)
        return self._collect(req, directory, history)

    def _collect(self, req, directory, history):
        done = _read_json(directory / "done.json") or {}
        if not done.get("ok"):
            text = done.get("error") or "サブエージェントが失敗した（詳細なし）"
            cls = "env_limit" if ENV_LIMIT.search(text) else "crash"
            return AgentResult(False, error_class=cls, error_detail=text[:500])
        path = directory / "result.json"
        if not path.exists():
            return AgentResult(False, error_class="invalid_output", error_detail="結果のファイル result.json がない")
        raw = path.read_text(encoding="utf-8")
        try:
            payload = json.loads(raw)
        except ValueError as exc:
            return AgentResult(False, error_class="invalid_output", error_detail=f"result.json が JSON として読めない：{exc}", raw=raw)
        if not isinstance(payload, dict):
            return AgentResult(False, error_class="invalid_output", error_detail="result.json がオブジェクトではない", raw=raw)
        session_id = req.session_id or uuid.uuid4().hex
        turns = history + [{"attempt_id": req.attempt_id,
                            "prompt": (directory / "prompt.md").relative_to(self.root).as_posix(),
                            "result": path.relative_to(self.root).as_posix()}]
        sessions = exchange_dir(self.root) / "sessions"
        sessions.mkdir(parents=True, exist_ok=True)
        _write_json(self._session_path(session_id), {"instance_id": req.instance_id, "turns": turns})
        return AgentResult(True, payload=payload, session_id=session_id, raw=raw)

    def _session_path(self, session_id):
        return exchange_dir(self.root) / "sessions" / f"{_safe(session_id)}.json"

    # 確認 -------------------------------------------------------------
    def probe(self, workdir: Path) -> Capability:
        """親の会話がサブエージェントを2回起動して、受け渡しと継続を確かめる。"""
        cap = Capability(self.name, simulated=False, version="Claude Code の Agent ツール（親の会話が起動）")
        workdir = Path(workdir).resolve()
        workdir.mkdir(parents=True, exist_ok=True)
        word = f"あおい{secrets.randbelow(900) + 100}"
        schema = {"type": "object", "properties": {"said": {"type": "string"}}, "required": ["said"]}
        first = self.invoke(AgentRequest(
            "probe", "probe@1", "probe-instance", "probe", "probe",
            f"接続確認である。確認語は「{word}」である。said に「受領」と入れて返す。",
            schema, workdir, timeout_sec=600, tools=[], max_turns=4))
        if not first.ok:
            cap.notes.append(f"起動の確認に失敗: {first.error_class} {first.error_detail[:200]}")
            return cap
        cap.spawn = True
        cap.structured_result = isinstance(first.payload, dict) and "said" in first.payload
        second = self.invoke(AgentRequest(
            "probe", "probe@2", "probe-instance", "probe", "probe",
            "【転送された発言 M1】別のエージェントが「確認語を教えてください」と尋ねている。"
            "以前の依頼で伝えられた確認語を said に入れて答える。",
            schema, workdir, session_id=first.session_id, timeout_sec=600, tools=[], max_turns=4))
        if second.ok and word in json.dumps(second.payload, ensure_ascii=False):
            cap.resume = True
            cap.relay = True
            cap.notes.append("2回目のサブエージェントが、以前の依頼と結果のファイルを読んで、転送した発言へ応答した")
        else:
            cap.notes.append(f"継続の確認に失敗: {second.error_class} {second.error_detail[:200]}")
        cap.notes.append("サブエージェントは親の会話と同じ接続先と認証で動く。依頼と結果はファイルで受け渡す")
        cap.notes.append("継続は、同じインスタンスの以前の依頼と結果を新しいサブエージェントに読ませる方式であり、同じ会話の記憶を保つ方式ではない")
        cap.notes.append("エージェント同士の直接通信は使わず、ハーネスが実際の発言を宛先のインスタンスへ転送する")
        return cap


# 親の会話が使う操作 ---------------------------------------------------
def _requests(root):
    base = exchange_dir(root)
    if not base.exists():
        return []
    rows = []
    for directory in sorted(base.iterdir()):
        request = _read_json(directory / "request.json") if directory.is_dir() else None
        if request:
            rows.append((directory, request))
    return rows


def _owner_alive(root):
    owner = _read_json(exchange_dir(root) / "owner.json") or {}
    return _alive(owner.get("pid"))


def pending(root, wait=0, clock=time.time, sleep=time.sleep, idle_grace=15, inflight_wait=30):
    """まだ受け取られていない依頼を受け取り済みにして返す。

    新しい依頼が無いときは、wait 秒まで待つ。実行中のサブエージェントがあるときは、その完了通知を
    親の会話が待てるよう inflight_wait 秒で返す。ハーネスが止まっていれば idle_grace 秒で返す。
    """
    start = clock()
    while True:
        new, in_flight = [], []
        for directory, request in _requests(root):
            if (directory / "done.json").exists() or (directory / "withdrawn.json").exists():
                continue
            claim = directory / "claim.json"
            if claim.exists():
                if (_read_json(claim) or {}).get("by") == "dispatch":
                    in_flight.append(request["attempt_id"])
                continue
            if not _alive(request.get("owner_pid")):
                continue  # 止まったハーネスが残した依頼
            if _claim(directory, "dispatch"):
                new.append({key: request[key] for key in ("attempt_id", "description", "subagent_type", "model", "prompt")})
        alive = _owner_alive(root)
        elapsed = clock() - start
        if new or elapsed >= (min(wait, inflight_wait) if in_flight else wait) or (not alive and elapsed >= idle_grace):
            break
        sleep(1)
    if new:
        guide = ("new の各依頼について、Agent ツールを1回ずつ起動する（subagent_type・model・description・prompt はそのまま渡す。model が null なら指定しない）。"
                 "起動したら完了の通知を待ち、通知ごとに done を実行してから、再び pending を実行する。")
    elif in_flight:
        guide = "実行中のサブエージェントの完了通知を待つ。通知ごとに done を実行してから、再び pending を実行する。"
    elif alive:
        guide = "ハーネスはまだ次の依頼を出していない。もう一度 pending を実行する。"
    else:
        guide = "ハーネスは動いていない。status で状態を確かめる。一時停止なら run で再開する。"
    return {"new": new, "in_flight": in_flight, "harness_running": alive, "next": guide}


def check_output(root, attempt_id):
    """result.json を出力形式で確かめる。戻り値は問題の一覧である。"""
    from validators.schema_check import validate

    directory = attempt_dir(root, attempt_id)
    if not (directory / "request.json").exists():
        return [f"作業 {attempt_id} の依頼が見つからない"]
    path = directory / "result.json"
    if not path.exists():
        return [f"結果のファイル {path} がない"]
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        return [f"JSON として読めない：{exc}"]
    schema = _read_json(directory / "schema.json") or {}
    return validate(payload, schema)


def done(root, attempt_id, error=None):
    """サブエージェントの完了をハーネスへ知らせる。結果の内容は返さない。"""
    directory = attempt_dir(root, attempt_id)
    if not (directory / "request.json").exists():
        return {"accepted": False, "message": f"作業 {attempt_id} の依頼が見つからない"}
    withdrawn = _read_json(directory / "withdrawn.json")
    if withdrawn:
        return {"accepted": False, "message": f"この依頼は打ち切り済み（{withdrawn.get('reason')}）なので、結果は使われない"}
    if (directory / "done.json").exists():
        return {"accepted": False, "message": "この依頼の完了は既に受け付けている"}
    if error:
        _write_json(directory / "done.json", {"ok": False, "error": error, "at": time.time()})
        return {"accepted": True, "message": "失敗として受け付けた。ハーネスが再試行または一時停止を判断する"}
    problems = check_output(root, attempt_id)
    _write_json(directory / "done.json", {"ok": True, "at": time.time()})
    if problems:
        return {"accepted": True, "problems": problems[:10],
                "message": "完了を受け付けたが、結果の形式に問題がある。ハーネスが不合格として扱い、再試行を判断する"}
    return {"accepted": True, "message": "完了を受け付けた"}
