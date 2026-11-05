"""実行権の管理。

同じ作業を二重に実行しないこと、タイムアウトした試行から遅れて届いた結果で
現行版を上書きしないことを、実行権の札（lease_token）で保証する。
"""
from __future__ import annotations

import json
import os
import secrets


def claim(store, task, instance_id, manifest, lease_sec):
    """実行可能な作業の実行権を一つだけ発行する。取得できなければ None を返す。"""
    with store.tx():
        cur = store.db.execute(
            "UPDATE tasks SET state='running', updated_at=? WHERE task_id=? AND state='ready'",
            (store.clock(), task["task_id"]),
        )
        if cur.rowcount != 1:
            store.event("claim_lost", task_id=task["task_id"])
            return None
        seq = store.db.execute("SELECT COUNT(*) c FROM attempts WHERE task_id=?", (task["task_id"],)).fetchone()["c"] + 1
        attempt_id = f"{task['task_id']}@{seq}"
        token = secrets.token_hex(8)
        now = store.clock()
        store.db.execute(
            "INSERT INTO attempts(attempt_id,task_id,seq,instance_id,lease_token,lease_expires,input_manifest,status,started_at,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (attempt_id, task["task_id"], seq, instance_id, token, now + lease_sec,
             json.dumps(manifest, ensure_ascii=False), "running", now, now),
        )
        store.db.execute("UPDATE tasks SET calls_used=calls_used+1 WHERE task_id=?", (task["task_id"],))
        store.event("task_state", task_id=task["task_id"], attempt_id=attempt_id, old="ready", new="running", reason="実行権の発行")
    return {"attempt_id": attempt_id, "lease_token": token, "seq": seq}


def is_current(store, attempt_id, token):
    row = store.db.execute("SELECT status, lease_token FROM attempts WHERE attempt_id=?", (attempt_id,)).fetchone()
    return bool(row) and row["status"] == "running" and row["lease_token"] == token


def expired(store, now):
    return [dict(r) for r in store.db.execute("SELECT * FROM attempts WHERE status='running' AND lease_expires<?", (now,))]


def running(store):
    return [dict(r) for r in store.db.execute("SELECT * FROM attempts WHERE status='running'")]


# 実行の占有 -----------------------------------------------------------
def acquire_run_lock(store):
    """同じ実行を二つのプロセスが同時に進めないようにする。止まったプロセスの占有は引き継ぐ。"""
    with store.tx():
        lock = store.get_meta("run_lock")
        if lock and lock.get("pid") != os.getpid() and _alive(lock.get("pid")):
            store.event("run_lock_denied", holder=lock.get("pid"))
            return False
        store.set_meta("run_lock", {"pid": os.getpid(), "at": store.clock()})
        store.event("run_lock_acquired", pid=os.getpid(), previous=lock)
    return True


def release_run_lock(store):
    store.set_meta("run_lock", None)


def _alive(pid):
    if not pid:
        return False
    if os.name == "nt":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False
