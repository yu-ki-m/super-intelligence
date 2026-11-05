"""実行状態と成果物の保存。

会話履歴ではなく、このデータベースと成果物ファイルを実行状態の正本とする。
SQLite を選んだ理由は architecture.md に記す。
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from .states import CompletionDenied, IllegalTransition, TERMINAL_RUN_STATUS, TRANSITIONS

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(
  task_id TEXT PRIMARY KEY, node_id TEXT, iter INTEGER DEFAULT 1, kind TEXT, role TEXT,
  purpose TEXT, instructions TEXT, inputs TEXT, depends_on TEXT, output_artifact TEXT,
  contract_id TEXT, contract_sha TEXT, reviewer_role TEXT, state TEXT NOT NULL, outcome TEXT,
  priority INTEGER DEFAULT 50, budget_calls INTEGER DEFAULT 1, calls_used INTEGER DEFAULT 0,
  retries_used INTEGER DEFAULT 0, revisions_used INTEGER DEFAULT 0, failure_policy TEXT,
  deadline TEXT, parent_task TEXT, data TEXT DEFAULT '{}', note TEXT,
  created_at REAL, updated_at REAL, finished_at REAL);
CREATE TABLE IF NOT EXISTS attempts(
  attempt_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, seq INTEGER, instance_id TEXT, lease_token TEXT,
  lease_expires REAL, input_manifest TEXT, status TEXT, error_class TEXT, error_detail TEXT,
  session_id TEXT, raw_path TEXT, tokens_in INTEGER, tokens_out INTEGER, cost_delta REAL,
  cost_basis TEXT, simulated INTEGER, started_at REAL, finished_at REAL, created_at REAL);
CREATE TABLE IF NOT EXISTS instances(
  instance_id TEXT PRIMARY KEY, role TEXT, session_id TEXT, adapter TEXT, state TEXT,
  created_for TEXT, continuation_of TEXT, calls INTEGER DEFAULT 0, last_cost_cum REAL DEFAULT 0,
  created_at REAL);
CREATE TABLE IF NOT EXISTS sources(
  source_id TEXT, version INTEGER, product_id TEXT, path TEXT, sha256 TEXT, title TEXT, kind TEXT,
  retrieved_at TEXT, origin TEXT, registered_at REAL, PRIMARY KEY(source_id, version));
CREATE TABLE IF NOT EXISTS artifact_owner(artifact_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, artifact_type TEXT);
CREATE TABLE IF NOT EXISTS artifacts(
  artifact_id TEXT, version INTEGER, path TEXT, sha256 TEXT, task_id TEXT, attempt_id TEXT,
  status TEXT, delivery_class TEXT, input_manifest TEXT, structured TEXT, unknowns TEXT,
  handoffs TEXT, created_at REAL, PRIMARY KEY(artifact_id, version), UNIQUE(artifact_id, attempt_id));
CREATE TABLE IF NOT EXISTS evidence(
  evidence_id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, source_version INTEGER, url TEXT,
  locator TEXT, quote TEXT, kind TEXT, retrieved_at TEXT, verified TEXT, registered_by TEXT, state TEXT DEFAULT 'current');
CREATE TABLE IF NOT EXISTS claims(
  artifact_id TEXT, version INTEGER, local_id TEXT, text TEXT, type TEXT, status TEXT, evidence TEXT,
  target_customer TEXT, situation TEXT, conditions TEXT, reason TEXT, derived_from TEXT, metric TEXT,
  audience TEXT, PRIMARY KEY(artifact_id, version, local_id));
CREATE TABLE IF NOT EXISTS links(
  from_kind TEXT, from_id TEXT, to_kind TEXT, to_id TEXT, relation TEXT, created_at REAL,
  PRIMARY KEY(from_kind, from_id, to_kind, to_id, relation));
CREATE TABLE IF NOT EXISTS issues(
  issue_id TEXT PRIMARY KEY, node_id TEXT, title TEXT, why TEXT, state TEXT, round INTEGER DEFAULT 0,
  max_rounds INTEGER, proposers TEXT, critics TEXT, proposal_artifacts TEXT, outcome TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS messages(
  message_id TEXT PRIMARY KEY, issue_id TEXT, round INTEGER, from_role TEXT, from_instance TEXT,
  to_role TEXT, kind TEXT, target_artifact TEXT, target_version INTEGER, target_claim TEXT, quote TEXT,
  body TEXT, reason TEXT, evidence TEXT, conditions TEXT, counterexample TEXT, requested_fix TEXT,
  keep_strength TEXT, flips_if TEXT, in_reply_to TEXT, about_critique TEXT, severity TEXT, dispute_type TEXT,
  disposition TEXT, new_version INTEGER, delivery TEXT, delivered_attempt TEXT, attempt_id TEXT,
  session_id TEXT, simulated INTEGER, created_at REAL);
CREATE TABLE IF NOT EXISTS contracts(contract_id TEXT, sha TEXT, body TEXT, PRIMARY KEY(contract_id, sha));
CREATE TABLE IF NOT EXISTS contract_changes(
  change_id TEXT PRIMARY KEY, task_id TEXT, old_sha TEXT, new_sha TEXT, reason TEXT, impact TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS reviews(
  review_id TEXT PRIMARY KEY, task_id TEXT, artifact_id TEXT, version INTEGER, sha256 TEXT,
  contract_id TEXT, contract_sha TEXT, reviewer TEXT, reviewer_instance TEXT, attempt_id TEXT,
  verdict TEXT, gate_verdict TEXT, gate_reasons TEXT, body TEXT, state TEXT, kind TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS defects(
  defect_id TEXT PRIMARY KEY, review_id TEXT, artifact_id TEXT, version INTEGER, severity TEXT,
  category TEXT, criterion TEXT, location TEXT, quote TEXT, reason TEXT, fix_condition TEXT,
  fix_target TEXT, signature TEXT, occurrences INTEGER DEFAULT 1, state TEXT, resolution TEXT,
  resolved_in INTEGER, origin TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS bundles(
  bundle_id TEXT PRIMARY KEY, manifest TEXT, sha256 TEXT, state TEXT, review_id TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS human_log(id INTEGER PRIMARY KEY AUTOINCREMENT, minutes REAL, activity TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, type TEXT, task_id TEXT, attempt_id TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_msg_issue ON messages(issue_id, round);
"""

JSON_TASK_FIELDS = {"inputs", "depends_on", "data"}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def atomic_write(path: Path, text: str) -> None:
    """途中で停止しても、部分的なファイルを完成品の名前で残さない。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp{os.getpid()}")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def canonical(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)


class Store:
    def __init__(self, run_dir, clock=time.time):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.db = sqlite3.connect(
            str(self.run_dir / "state.db"), isolation_level=None, timeout=30, check_same_thread=False
        )
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript(SCHEMA)
        self._depth = 0

    def close(self):
        self.db.close()

    @contextmanager
    def tx(self):
        if self._depth:
            self._depth += 1
            try:
                yield
            finally:
                self._depth -= 1
            return
        self.db.execute("BEGIN IMMEDIATE")
        self._depth = 1
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        finally:
            self._depth = 0

    # 設定と連番 ------------------------------------------------------
    def set_meta(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (key, json.dumps(value, ensure_ascii=False)))

    def get_meta(self, key, default=None):
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def next_id(self, prefix):
        with self.tx():
            self.db.execute(
                "INSERT INTO counters(name,n) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET n=n+1", (prefix,)
            )
            n = self.db.execute("SELECT n FROM counters WHERE name=?", (prefix,)).fetchone()["n"]
        return f"{prefix}{n}"

    def event(self, type_, task_id=None, attempt_id=None, **data):
        self.db.execute(
            "INSERT INTO events(ts,type,task_id,attempt_id,data) VALUES(?,?,?,?,?)",
            (self.clock(), type_, task_id, attempt_id, json.dumps(data, ensure_ascii=False, default=str)),
        )

    def events(self, type_=None, task_id=None):
        sql, args = "SELECT * FROM events WHERE 1=1", []
        if type_:
            sql += " AND type=?"
            args.append(type_)
        if task_id:
            sql += " AND task_id=?"
            args.append(task_id)
        out = []
        for r in self.db.execute(sql + " ORDER BY seq", args):
            d = dict(r)
            d["data"] = json.loads(d["data"] or "{}")
            out.append(d)
        return out

    # 作業 ------------------------------------------------------------
    def add_task(self, **t):
        """同じ作業IDの再登録は何もしない。再試行や再開で作業が重複しないようにするため。"""
        now = self.clock()
        t.setdefault("state", "pending")
        t.setdefault("created_at", now)
        t["updated_at"] = now
        for field in JSON_TASK_FIELDS:
            t[field] = json.dumps(t.get(field) or ({} if field == "data" else []), ensure_ascii=False)
        cols = ",".join(t)
        marks = ",".join("?" for _ in t)
        cur = self.db.execute(f"INSERT OR IGNORE INTO tasks({cols}) VALUES({marks})", list(t.values()))
        if cur.rowcount:
            self.event("task_registered", task_id=t["task_id"], kind=t.get("kind"), role=t.get("role"))
        else:
            self.event("task_duplicate_ignored", task_id=t["task_id"])
        return bool(cur.rowcount)

    def task(self, task_id):
        row = self.db.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        return self._task(row) if row else None

    @staticmethod
    def _task(row):
        d = dict(row)
        for field in JSON_TASK_FIELDS:
            d[field] = json.loads(d[field]) if d[field] else ({} if field == "data" else [])
        return d

    def tasks(self, state=None, kind=None, node_id=None, parent=None):
        sql, args = "SELECT * FROM tasks WHERE 1=1", []
        for col, val in (("state", state), ("kind", kind), ("node_id", node_id), ("parent_task", parent)):
            if val is not None:
                sql += f" AND {col}=?"
                args.append(val)
        return [self._task(r) for r in self.db.execute(sql + " ORDER BY rowid", args)]

    def latest_of_node(self, node_id):
        row = self.db.execute(
            "SELECT * FROM tasks WHERE node_id=? AND parent_task IS NULL ORDER BY iter DESC LIMIT 1", (node_id,)
        ).fetchone()
        return self._task(row) if row else None

    def update_task(self, task_id, **fields):
        for field in JSON_TASK_FIELDS & set(fields):
            fields[field] = json.dumps(fields[field], ensure_ascii=False)
        fields["updated_at"] = self.clock()
        sets = ",".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE tasks SET {sets} WHERE task_id=?", [*fields.values(), task_id])

    def transition(self, task_id, new_state, reason="", outcome=None):
        """状態遷移の唯一の入口。遷移表と完了条件の両方をここで確認する。"""
        denied = None
        with self.tx():
            task = self.task(task_id)
            if task is None:
                raise IllegalTransition(f"存在しない作業: {task_id}")
            old = task["state"]
            if new_state not in TRANSITIONS.get(old, set()):
                self.event("transition_denied", task_id=task_id, old=old, new=new_state, reason=reason)
                denied = IllegalTransition(f"{task_id}: {old} → {new_state} は許されない")
            elif new_state == "out_of_scope":
                used = self.db.execute("SELECT COUNT(*) c FROM attempts WHERE task_id=?", (task_id,)).fetchone()["c"]
                if used or not reason:
                    self.event("transition_denied", task_id=task_id, old=old, new=new_state, reason=reason)
                    denied = IllegalTransition("実行済みの作業、または理由のない作業は対象外にできない")
            elif new_state == "done":
                ok, why = self.can_complete(task)
                if not ok:
                    self.event("completion_denied", task_id=task_id, why=why)
                    denied = CompletionDenied(f"{task_id}: {why}")
            if denied is None:
                fields = {"state": new_state}
                if outcome is not None:
                    fields["outcome"] = outcome
                if new_state in {"done", "failed", "on_hold", "out_of_scope"}:
                    fields["finished_at"] = self.clock()
                if reason:
                    fields["note"] = reason
                self.update_task(task_id, **fields)
                self.event("task_state", task_id=task_id, old=old, new=new_state, reason=reason, outcome=outcome)
        # 拒否の記録は残したまま、呼び出し元へ例外を伝える。
        if denied is not None:
            raise denied

    def can_complete(self, task):
        """成果物が存在するだけでは完了にしない。現行版に対する合格が必要である。"""
        if task["kind"] in {"work", "research"} and task["output_artifact"]:
            art = self.latest_artifact(task["output_artifact"])
            if not art:
                return False, "成果物がない"
            if art["status"] != "accepted":
                return False, f"成果物 v{art['version']} が合格していない（{art['status']}）"
            row = self.db.execute(
                "SELECT 1 FROM reviews WHERE artifact_id=? AND version=? AND sha256=? AND gate_verdict='pass' AND state='current'",
                (art["artifact_id"], art["version"], art["sha256"]),
            ).fetchone()
            if not row:
                return False, f"v{art['version']} に対する有効な合格記録がない"
        return True, ""

    # 実体のあるファイルを伴う成果物 -----------------------------------
    def register_owner(self, artifact_id, task_id, artifact_type):
        self.db.execute("INSERT OR IGNORE INTO artifact_owner VALUES(?,?,?)", (artifact_id, task_id, artifact_type))
        row = self.db.execute("SELECT task_id FROM artifact_owner WHERE artifact_id=?", (artifact_id,)).fetchone()
        return row["task_id"] == task_id

    def owner(self, artifact_id):
        row = self.db.execute("SELECT * FROM artifact_owner WHERE artifact_id=?", (artifact_id,)).fetchone()
        return dict(row) if row else None

    def artifact(self, artifact_id, version):
        row = self.db.execute(
            "SELECT * FROM artifacts WHERE artifact_id=? AND version=?", (artifact_id, version)
        ).fetchone()
        return dict(row) if row else None

    def latest_artifact(self, artifact_id):
        row = self.db.execute(
            "SELECT * FROM artifacts WHERE artifact_id=? ORDER BY version DESC LIMIT 1", (artifact_id,)
        ).fetchone()
        return dict(row) if row else None

    def latest_accepted(self, artifact_id):
        row = self.db.execute(
            "SELECT * FROM artifacts WHERE artifact_id=? AND status='accepted' ORDER BY version DESC LIMIT 1",
            (artifact_id,),
        ).fetchone()
        return dict(row) if row else None

    def publish_artifact(self, artifact_id, task_id, attempt_id, document, manifest, structured, unknowns, handoffs):
        """版番号の採番とファイルの公開を一つの処理にする。同じ試行の二重登録は既存の版を返す。"""
        with self.tx():
            existing = self.db.execute(
                "SELECT * FROM artifacts WHERE artifact_id=? AND attempt_id=?", (artifact_id, attempt_id)
            ).fetchone()
            if existing:
                self.event("artifact_duplicate_ignored", task_id=task_id, attempt_id=attempt_id, artifact=artifact_id)
                return dict(existing), False
            row = self.db.execute(
                "SELECT COALESCE(MAX(version),0) v FROM artifacts WHERE artifact_id=?", (artifact_id,)
            ).fetchone()
            version = row["v"] + 1
            rel = f"artifacts/{artifact_id}/v{version}.md"
            atomic_write(self.run_dir / rel, document)
            self.db.execute(
                "INSERT INTO artifacts(artifact_id,version,path,sha256,task_id,attempt_id,status,input_manifest,structured,unknowns,handoffs,created_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    artifact_id, version, rel, sha256_text(document), task_id, attempt_id, "draft",
                    json.dumps(manifest, ensure_ascii=False), json.dumps(structured or {}, ensure_ascii=False),
                    json.dumps(unknowns or [], ensure_ascii=False), json.dumps(handoffs or [], ensure_ascii=False),
                    self.clock(),
                ),
            )
            self.event("artifact_published", task_id=task_id, attempt_id=attempt_id, artifact=artifact_id, version=version)
        return self.artifact(artifact_id, version), True

    def set_artifact_status(self, artifact_id, version, status, delivery_class=None):
        self.db.execute(
            "UPDATE artifacts SET status=?, delivery_class=COALESCE(?,delivery_class) WHERE artifact_id=? AND version=?",
            (status, delivery_class, artifact_id, version),
        )
        if status == "accepted":
            # 古い合格版を下流が読まないようにする。
            self.db.execute(
                "UPDATE artifacts SET status='superseded' WHERE artifact_id=? AND version<? AND status='accepted'",
                (artifact_id, version),
            )
        self.event("artifact_status", artifact=artifact_id, version=version, status=status)

    def read_artifact(self, artifact):
        return (self.run_dir / artifact["path"]).read_text(encoding="utf-8")

    # 資料 ------------------------------------------------------------
    def add_source(self, source_id, text, product_id, title="", kind="document", retrieved_at="", origin=""):
        with self.tx():
            row = self.db.execute(
                "SELECT COALESCE(MAX(version),0) v FROM sources WHERE source_id=?", (source_id,)
            ).fetchone()
            version = row["v"] + 1
            rel = f"sources/{source_id}/v{version}.md"
            atomic_write(self.run_dir / rel, text)
            self.db.execute(
                "INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?,?)",
                (source_id, version, product_id, rel, sha256_text(text), title, kind, retrieved_at, origin, self.clock()),
            )
            self.event("source_registered", source=source_id, version=version, title=title)
        return version

    def source(self, source_id, version=None):
        if version is None:
            row = self.db.execute(
                "SELECT * FROM sources WHERE source_id=? ORDER BY version DESC LIMIT 1", (source_id,)
            ).fetchone()
        else:
            row = self.db.execute(
                "SELECT * FROM sources WHERE source_id=? AND version=?", (source_id, version)
            ).fetchone()
        return dict(row) if row else None

    def sources_latest(self):
        ids = [r["source_id"] for r in self.db.execute("SELECT DISTINCT source_id FROM sources ORDER BY source_id")]
        return [self.source(i) for i in ids]

    def read_source(self, source):
        return (self.run_dir / source["path"]).read_text(encoding="utf-8")

    # 主張と関係 ------------------------------------------------------
    def claims_of(self, artifact_id, version):
        out = []
        for r in self.db.execute(
            "SELECT * FROM claims WHERE artifact_id=? AND version=? ORDER BY rowid", (artifact_id, version)
        ):
            d = dict(r)
            for k in ("evidence", "conditions", "derived_from"):
                d[k] = json.loads(d[k] or "[]")
            d["metric"] = json.loads(d["metric"]) if d["metric"] else None
            out.append(d)
        return out

    def link(self, from_kind, from_id, to_kind, to_id, relation):
        self.db.execute(
            "INSERT OR IGNORE INTO links VALUES(?,?,?,?,?,?)", (from_kind, from_id, to_kind, to_id, relation, self.clock())
        )

    def evidence_row(self, evidence_id):
        row = self.db.execute("SELECT * FROM evidence WHERE evidence_id=?", (evidence_id,)).fetchone()
        return dict(row) if row else None

    def all_evidence(self):
        return [dict(r) for r in self.db.execute("SELECT * FROM evidence ORDER BY rowid")]

    # 契約 ------------------------------------------------------------
    def pin_contract(self, contract):
        body = canonical(contract)
        sha = sha256_text(body)
        self.db.execute("INSERT OR IGNORE INTO contracts VALUES(?,?,?)", (contract["id"], sha, body))
        return sha

    def contract(self, contract_id, sha):
        row = self.db.execute("SELECT body FROM contracts WHERE contract_id=? AND sha=?", (contract_id, sha)).fetchone()
        return json.loads(row["body"]) if row else None

    # 実行全体 --------------------------------------------------------
    def run_status(self):
        return self.get_meta("status", "created")

    def set_run_status(self, status, reason=""):
        with self.tx():
            old = self.run_status()
            if old in TERMINAL_RUN_STATUS and status != old:
                self.event("run_status_denied", old=old, new=status, reason=reason)
                return False
            self.set_meta("status", status)
            self.set_meta("status_reason", reason)
            self.event("run_status", old=old, new=status, reason=reason)
        return True

    def budget(self):
        return self.get_meta("budget", {})

    def calls_used(self):
        return self.db.execute("SELECT COUNT(*) c FROM attempts").fetchone()["c"]
