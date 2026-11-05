"""更新の影響を追跡する。

変更された根拠・主張を参照する下流だけを再確認し、完了済みの全作業をやり直さない。
"""
from __future__ import annotations

import json

from validators.formal import norm


def changed_claims(store, artifact_id, old_version, new_version):
    def snapshot(version):
        return {
            c["local_id"]: (norm(c["text"]), c["status"], tuple(c.get("conditions") or []), norm(c.get("target_customer") or ""))
            for c in store.claims_of(artifact_id, version)
        }

    old, new = snapshot(old_version), snapshot(new_version)
    return {k for k in set(old) | set(new) if old.get(k) != new.get(k)}


def downstream_artifacts(store, artifact_id, changed):
    """変更された主張を参照する、合格済みの下流の成果物を返す。

    主張の単位で参照を記録している成果物は、変更された主張を参照しているときだけ影響を受ける。
    入力としただけで主張の参照を記録していない成果物は、細かく判断できないので影響ありとする。
    """
    impacted = {}
    for row in store.db.execute("SELECT artifact_id FROM artifact_owner WHERE artifact_id<>?", (artifact_id,)):
        other = store.latest_artifact(row["artifact_id"])
        if not other or other["status"] != "accepted":
            continue
        refs = set()
        for claim in store.claims_of(other["artifact_id"], other["version"]):
            for parent in claim.get("derived_from") or []:
                key = parent.get("ref") if isinstance(parent, dict) else parent
                if key and key.startswith(artifact_id + "#"):
                    refs.add(key.split("#", 1)[1])
        manifest = json.loads(other["input_manifest"] or "[]")
        used_as_input = any(m.get("id") == artifact_id for m in manifest)
        if refs & changed:
            impacted[other["artifact_id"]] = sorted(refs & changed)
        elif used_as_input and not refs and changed:
            impacted[other["artifact_id"]] = sorted(changed)
    return impacted


def artifacts_citing(store, evidence_ids):
    """指定した根拠を引用する、合格済みの成果物と主張を返す。"""
    impacted = {}
    for row in store.db.execute("SELECT artifact_id FROM artifact_owner"):
        art = store.latest_artifact(row["artifact_id"])
        if not art or art["status"] != "accepted":
            continue
        hit = [c["local_id"] for c in store.claims_of(art["artifact_id"], art["version"]) if set(c["evidence"]) & evidence_ids]
        if hit:
            impacted[art["artifact_id"]] = hit
    return impacted


def reverify_evidence(store, source_id, new_text):
    """資料の更新後も引用が残っている根拠は有効のまま扱う。消えた根拠だけを無効にする。"""
    stale = set()
    new_version = store.source(source_id)["version"]
    target = norm(new_text)
    for row in store.db.execute("SELECT * FROM evidence WHERE source_id=? AND state='current'", (source_id,)).fetchall():
        if row["quote"] and norm(row["quote"]) in target:
            store.db.execute("UPDATE evidence SET source_version=? WHERE evidence_id=?", (new_version, row["evidence_id"]))
        else:
            store.db.execute("UPDATE evidence SET state='stale' WHERE evidence_id=?", (row["evidence_id"],))
            stale.add(row["evidence_id"])
    return stale
