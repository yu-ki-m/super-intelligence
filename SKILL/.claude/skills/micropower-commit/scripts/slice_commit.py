#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""作業ツリーのファイルを変えずに、まとめて書いた変更を複数のコミットに分ける。

使い方（リポジトリの中で実行する）:
  python slice_commit.py backup
      変更のあるファイルと未追跡のファイルの写し、差分、HEAD の位置を
      .git/slice-backup/<日時>/ に保存し、refs/slice-backup/<日時> に HEAD を記録する。
  python slice_commit.py commit <指示ファイル.json> [--dry-run]
      指示ファイルのとおりにコミットを作る。--dry-run は確認だけで、何も変えない。

指示ファイルの形:
  {"commits": [
     {"message": "feat(book): _書籍ID_1_ フロントエンドから書籍を選択",
      "files": [
        {"path": "frontend/src/BookForm.tsx", "content_file": "C:/tmp/slices/c01/BookForm.tsx"},
        {"path": "frontend/src/BookSelect.tsx", "worktree": true},
        {"path": "src/old.ts", "delete": true}
      ]}
  ]}

終了コード: 0 成功 / 1 誤り（何もしていないか、途中で止まった） / 2 コミットは作ったが、
指示ファイルのパスに作業ツリーとの差が残っている。
"""
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass


class Stop(Exception):
    pass


def git(root, *args, check=True):
    r = subprocess.run(["git", "-c", "core.quotepath=false", *args],
                       cwd=root, capture_output=True)
    if check and r.returncode != 0:
        raise Stop("git " + " ".join(args) + " が失敗しました。\n"
                   + r.stderr.decode("utf-8", "replace").strip())
    return r


def text(r):
    return r.stdout.decode("utf-8", "replace")


def repo_root():
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True)
    if r.returncode != 0:
        raise Stop("git のリポジトリの中で実行してください。")
    return Path(r.stdout.decode("utf-8").strip())


def head_sha(root):
    r = git(root, "rev-parse", "--verify", "--quiet", "HEAD", check=False)
    return text(r).strip() or None


def changed_paths(root):
    """git status の (状態, パス) の一覧。名前の変更は新しいパスだけを返す。"""
    raw = git(root, "status", "--porcelain=v1", "-z", "-uall").stdout.decode("utf-8")
    items = raw.split("\0")
    result = []
    i = 0
    while i < len(items):
        entry = items[i]
        if not entry:
            i += 1
            continue
        xy, path = entry[:2], entry[3:]
        result.append((xy, path))
        i += 2 if xy[0] in "RC" else 1
    return result


def normalize(path):
    p = path.replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    if not p or p.startswith("/") or (len(p) > 1 and p[1] == ":") or ".." in p.split("/"):
        raise Stop(f"パスはリポジトリのルートからの相対パスで書いてください：{path}")
    return p


def blob_of(root, path, source_file):
    """source_file を path に置いたときの blob の ID（属性による改行の変換などを含む）。"""
    return text(git(root, "hash-object", f"--path={path}", "--", str(source_file))).strip()


def mode_of(root, path):
    line = text(git(root, "ls-files", "-s", "--", path)).strip()
    if not line:
        line = text(git(root, "ls-tree", "HEAD", "--", path, check=False)).strip()
    if line:
        return line.split()[0]
    worktree_file = root / path
    if os.name != "nt" and worktree_file.is_file() and os.access(worktree_file, os.X_OK):
        return "100755"
    return "100644"


def in_progress_operation(root):
    gitdir = Path(text(git(root, "rev-parse", "--absolute-git-dir")).strip())
    for name in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
        if (gitdir / name).exists():
            return name
    return None


def cmd_backup(root):
    gitdir = Path(text(git(root, "rev-parse", "--absolute-git-dir")).strip())
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = gitdir / "slice-backup" / stamp
    files_dir = dest / "files"
    files_dir.mkdir(parents=True)
    head = head_sha(root)
    copied = []
    for xy, path in changed_paths(root):
        src = root / path
        if src.is_file():
            target = files_dir / path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
            copied.append(path)
    if head:
        (dest / "tracked.patch").write_bytes(git(root, "diff", "HEAD", "--binary").stdout)
        git(root, "update-ref", f"refs/slice-backup/{stamp}", head)
    state = {
        "created": stamp,
        "head": head,
        "branch": text(git(root, "branch", "--show-current", check=False)).strip(),
        "status": text(git(root, "status", "--porcelain=v1", "-uall")),
        "copied_files": copied,
    }
    (dest / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"退避しました：{dest}")
    print(f"  ファイルの写し：{len(copied)} 件（files/ の下）")
    if head:
        print(f"  分割を始める前の HEAD：{head[:12]}（refs/slice-backup/{stamp}）")
        print(f"  分割を取り消すとき：git reset --soft refs/slice-backup/{stamp} の後、git restore --staged .")
    return 0


def load_spec(root, spec_path):
    try:
        spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise Stop(f"指示ファイルを読めません：{e}")
    commits = spec.get("commits")
    if not isinstance(commits, list) or not commits:
        raise Stop("指示ファイルに commits（1件以上の一覧）がありません。")
    errors = []
    for number, commit in enumerate(commits, 1):
        if not str(commit.get("message", "")).strip():
            errors.append(f"コミット{number}：message がありません。")
        files = commit.get("files")
        if not isinstance(files, list) or not files:
            errors.append(f"コミット{number}：files（1件以上の一覧）がありません。")
            continue
        seen = set()
        for entry in files:
            try:
                path = normalize(str(entry.get("path", "")))
            except Stop as e:
                errors.append(f"コミット{number}：{e}")
                continue
            entry["path"] = path
            if path in seen:
                errors.append(f"コミット{number}：同じパスが2回あります：{path}")
            seen.add(path)
            kinds = [k for k in ("content_file", "worktree", "delete") if entry.get(k)]
            if len(kinds) != 1:
                errors.append(f"コミット{number}：{path} には content_file・worktree・delete のどれか1つを書いてください。")
                continue
            if kinds[0] == "content_file":
                source = Path(entry["content_file"])
                if not source.is_file():
                    errors.append(f"コミット{number}：途中の状態のファイルがありません：{source}")
                else:
                    entry["content_file"] = str(source.resolve())
    if errors:
        raise Stop("指示ファイルに誤りがあります。\n  " + "\n  ".join(errors))
    return commits


def final_differences(root, commits):
    """最後のコミットの後も、作業ツリーと差が残るパス。"""
    last = {}
    for commit in commits:
        for entry in commit["files"]:
            last[entry["path"]] = entry
    remaining = []
    for path, entry in last.items():
        worktree_file = root / path
        if entry.get("content_file"):
            if not worktree_file.is_file():
                remaining.append(f"{path}（作業ツリーにはないファイルを、途中の状態で残す）")
            elif blob_of(root, path, entry["content_file"]) != blob_of(root, path, worktree_file):
                remaining.append(f"{path}（最後に使う途中の状態が、作業ツリーと違う）")
        elif entry.get("delete") and worktree_file.exists():
            remaining.append(f"{path}（削除するが、作業ツリーにはファイルがある）")
    return last, remaining


def stage(root, entry):
    path = entry["path"]
    if entry.get("content_file"):
        sha = text(git(root, "hash-object", "-w", f"--path={path}", "--", entry["content_file"])).strip()
        git(root, "update-index", "--add", "--cacheinfo", f"{mode_of(root, path)},{sha},{path}")
    elif entry.get("worktree"):
        git(root, "add", "-A", "--", path)
    else:
        git(root, "rm", "--cached", "--quiet", "--ignore-unmatch", "--", path)


def cmd_commit(root, spec_path, dry_run):
    commits = load_spec(root, spec_path)
    last, remaining = final_differences(root, commits)
    uncovered = sorted({p for _, p in changed_paths(root)} - set(last))

    print(f"作るコミット：{len(commits)} 件")
    for number, commit in enumerate(commits, 1):
        subject = commit["message"].strip().splitlines()[0]
        print(f"  {number}. {subject}（{len(commit['files'])} ファイル）")
    if remaining:
        print("最後のコミットの後も、作業ツリーとの差が残るファイル：")
        for item in remaining:
            print(f"  - {item}")
    if uncovered:
        print("どのコミットにも入っていない変更（コミットせずに残る）：")
        for path in uncovered:
            print(f"  - {path}")
    if dry_run:
        print("ドライランなので、何も変えていません。")
        return 0

    operation = in_progress_operation(root)
    if operation:
        raise Stop(f"{operation} があります。マージやリベースなどを終えてから実行してください。")
    if not head_sha(root):
        raise Stop("HEAD がありません（最初のコミットがないリポジトリ）。先に最初のコミットを作ってください。")
    if git(root, "diff", "--cached", "--quiet", check=False).returncode != 0:
        raise Stop("ステージ済みの変更があります。利用者に確かめてから git restore --staged . で外してください。")

    made = []
    for number, commit in enumerate(commits, 1):
        expected = {entry["path"] for entry in commit["files"]}
        for entry in commit["files"]:
            stage(root, entry)
        staged = {p for p in text(git(root, "diff", "--cached", "--name-only", "-z")).split("\0") if p}
        extra = staged - expected
        if extra or not staged:
            git(root, "reset", "-q", check=False)
            reason = ("指示ファイルにないパスがステージされました：" + ", ".join(sorted(extra))) if extra \
                else "ステージした内容が HEAD と同じで、コミットする変更がありません。"
            raise Stop(f"コミット{number}で止めました。{reason}\n  作ったコミット：{len(made)} 件")
        unchanged = sorted(expected - staged)
        if unchanged:
            print(f"  注意：コミット{number}で変更のないファイル：{', '.join(unchanged)}")
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as message_file:
            message_file.write(commit["message"].rstrip() + "\n")
        try:
            result = git(root, "commit", "-F", message_file.name, check=False)
        finally:
            os.unlink(message_file.name)
        if result.returncode != 0:
            git(root, "reset", "-q", check=False)
            output = (text(result) + result.stderr.decode("utf-8", "replace")).strip()
            raise Stop(f"コミット{number}が失敗しました（フックが拒んだ可能性があります）。\n{output}\n"
                       f"  作ったコミット：{len(made)} 件")
        sha = text(git(root, "rev-parse", "--short", "HEAD")).strip()
        made.append(sha)
        print(f"[{number}/{len(commits)}] {sha} {commit['message'].strip().splitlines()[0]}")

    left = sorted(p for _, p in changed_paths(root))
    left_in_spec = [p for p in left if p in last]
    if left:
        print("コミットせずに残っている変更：")
        for path in left:
            mark = "  ← 指示ファイルにあるパス。途中の状態か割り当てを確かめる" if path in last else ""
            print(f"  - {path}{mark}")
    else:
        print("作業ツリーの変更は、すべてコミットに入りました。")
    return 2 if left_in_spec else 0


def main(argv):
    if len(argv) < 2 or argv[1] not in ("backup", "commit"):
        print(__doc__)
        return 1
    try:
        root = repo_root()
        if argv[1] == "backup":
            return cmd_backup(root)
        args = [a for a in argv[2:] if a != "--dry-run"]
        if len(args) != 1:
            raise Stop("commit には指示ファイルを1つ指定してください。")
        return cmd_commit(root, args[0], "--dry-run" in argv[2:])
    except Stop as e:
        sys.stdout.flush()
        print(f"止めました：{e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
