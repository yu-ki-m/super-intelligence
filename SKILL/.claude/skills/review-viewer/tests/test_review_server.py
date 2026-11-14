"""review_server.py の自動テスト（標準ライブラリだけで動く）。

    python tests/test_review_server.py

サーバーを実際に子プロセスとして起動し、HTTP で操作して確かめる。
ブラウザでの表示は tests/browser_check.mjs で確かめる。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent / "scripts" / "review_server.py"
FIXTURE = HERE / "fixtures" / "mixed"
ENV = {**os.environ, "PYTHONIOENCODING": "", "PYTHONUTF8": "0"}  # Windows の既定（cp932）のままでも動くことを確かめる


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    """テスト用にサーバーを起動し、標準出力を読み続けて URL などの行を集める。

    browser=True のときは --no-browser を付けない。その場合は env で REVIEW_VIEWER_BROWSER_LOG を渡し、
    実際のブラウザを開く代わりに URL をファイルへ書かせる。
    """

    def __init__(self, manifest: Path, *extra: str, port: int | None = None, browser: bool = False,
                 env: dict | None = None):
        self.port_arg = port or free_port()
        args = [sys.executable, str(SERVER), str(manifest), "--port", str(self.port_arg), *extra]
        if not browser:
            args.insert(3, "--no-browser")
        self.proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**ENV, **(env or {})})
        self.lines: list[str] = []
        self.url = None
        self._ready = threading.Event()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()
        if not self._ready.wait(15) or not self.url:
            err = self.proc.stderr.read().decode("utf-8", "replace") if self.proc.poll() is not None else ""
            raise RuntimeError("server did not start: " + "".join(self.lines) + err)

    def _read(self) -> None:
        for raw in iter(self.proc.stdout.readline, b""):
            line = raw.decode("utf-8", "replace")
            self.lines.append(line)
            m = re.match(r"URL: (http://127\.0\.0\.1:(\d+)/)", line)
            if m and not self.url:
                self.url, self.port = m.group(1), int(m.group(2))
                self._ready.set()
        self._ready.set()

    def output(self) -> str:
        return "".join(self.lines)

    def wait_line(self, prefix: str, timeout: float) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if any(line.startswith(prefix) for line in list(self.lines)):
                return True
            time.sleep(0.05)
        return False

    def state(self, session: str = "") -> dict:
        return json.loads(self.get("/api/state?session=" + urllib.parse.quote(session))[2].decode("utf-8"))

    def get(self, path: str, headers: dict | None = None) -> tuple[int, dict, bytes]:
        req = urllib.request.Request(self.url.rstrip("/") + path, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def post(self, path: str, data: object, headers: dict | None = None) -> tuple[int, dict]:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        h = {"Content-Type": "application/json", **(headers or {})}
        req = urllib.request.Request(self.url.rstrip("/") + path, data=body, headers=h, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")

    def stop(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(5)
        self._reader.join(5)
        for s in (self.proc.stdout, self.proc.stderr):
            if s:
                s.close()


def page_data(html: str) -> dict:
    m = re.search(r"const REVIEW_DATA = (.*?);\n</script>", html, re.S)
    assert m, "embedded data not found"
    return json.loads(m.group(1))


class ReviewServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="review-viewer-テスト-"))
        self.work = self.tmp / "対象"
        shutil.copytree(FIXTURE, self.work)
        # 実際の U+2028 / U+2029 と </script> を含むファイルを足す
        (self.work / "案B" / "breaker.txt").write_text(
            "閉じタグ </script> と <!-- と U+2028[ ] U+2029[ ]\n", encoding="utf-8")
        self.manifest = self.work / "review.json"
        self.servers: list[Server] = []

    def tearDown(self) -> None:
        for s in self.servers:
            s.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def start(self, *extra: str, manifest: Path | None = None, port: int | None = None,
              browser: bool = False, env: dict | None = None) -> Server:
        s = Server(manifest or self.manifest, *extra, port=port, browser=browser, env=env)
        self.servers.append(s)
        return s

    def write_manifest(self, data: dict, name: str = "review.json") -> Path:
        p = self.work / name
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return p

    # --- ページの組み立て ---------------------------------------------------

    def test_page_embeds_data_without_breaking_script(self):
        s = self.start()
        code, headers, body = s.get("/")
        self.assertEqual(code, 200)
        self.assertIn("charset=utf-8", headers["Content-Type"])
        html = body.decode("utf-8")
        start = html.index("const REVIEW_DATA = ")
        end = html.index("</script>", start)
        embedded = html[start:end]
        # 埋め込み部分に "<" が生のまま残っていなければ、</script> で途中終了しない
        self.assertNotIn("<", embedded)
        self.assertNotIn(" ", embedded)
        data = page_data(html)
        self.assertEqual(data["title"], "ログイン画面の改善案レビュー")
        texts = {f["label"]: f for it in data["items"] for f in it["files"]}
        self.assertIn("</script>", texts["案B/breaker.txt"]["text"])
        self.assertIn(" ", texts["案B/breaker.txt"]["text"])

    def test_file_kinds(self):
        s = self.start()
        data = page_data(s.get("/")[2].decode("utf-8"))
        files = {f["label"]: f for it in data["items"] for f in it["files"]}
        self.assertEqual(files["案A/提案書.md"]["kind"], "markdown")
        self.assertEqual(files["案A/画面.html"]["kind"], "html")
        self.assertTrue(files["案A/画面.html"]["raw_url"].startswith("/raw/"))
        self.assertEqual(files["案B/売上.csv"]["kind"], "table")
        self.assertEqual(files["案B/ロゴ.png"]["kind"], "image")
        self.assertTrue(files["案B/ロゴ.png"]["data_uri"].startswith("data:image/png;base64,"))
        self.assertEqual(files["案B/blob.bin"]["kind"], "binary")
        self.assertEqual(files["案B/存在しない.md"]["kind"], "missing")
        self.assertEqual(files["案B/sjis.csv"]["encoding"], "cp932")
        self.assertIn("りんご", files["案B/sjis.csv"]["text"])

    def test_large_text_is_truncated(self):
        big = self.work / "big.log"
        big.write_text("".join(f"{i:06d} 日本語の行\n" for i in range(40000)), encoding="utf-8")
        m = self.write_manifest({"items": [{"id": "big", "files": ["big.log"]}]}, "big.json")
        s = self.start(manifest=m)
        f = page_data(s.get("/")[2].decode("utf-8"))["items"][0]["files"][0]
        self.assertTrue(f["truncated"])
        self.assertLess(len(f["text"].encode("utf-8")), 300 * 1024)
        self.assertTrue(f["text"].endswith("日本語の行"))  # 行の途中で切れていない
        code, _h, body = s.get(f["raw_url"])
        self.assertEqual(code, 200)
        self.assertEqual(len(body), big.stat().st_size)  # 「全文を開く」で全体が読める

    def test_reload_picks_up_changes(self):
        s = self.start()
        self.assertEqual(len(page_data(s.get("/")[2].decode("utf-8"))["items"]), 5)
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        data["items"].append({"id": "new", "title": "追加した項目", "files": ["案A/提案書.md"]})
        self.write_manifest(data)
        items = page_data(s.get("/")[2].decode("utf-8"))["items"]
        self.assertEqual(items[-1]["title"], "追加した項目")

    def test_broken_manifest_shows_error_page(self):
        s = self.start()
        self.manifest.write_text("{ 書きかけ", encoding="utf-8")
        code, _h, body = s.get("/")
        self.assertEqual(code, 500)
        self.assertIn("review.json を書き直している途中", body.decode("utf-8"))

    # --- 保存 ---------------------------------------------------------------

    def test_feedback_roundtrip_keeps_japanese_and_null_verdicts(self):
        s = self.start()
        code, resp = s.post("/api/feedback", {
            "status": "in_progress",
            "overall_comment": "全体として案Aが良い",
            "reviews": [{"id": "a-doc", "verdict": "revise", "comment": "目標値の根拠を書いてください", "viewed": True}],
        })
        self.assertEqual(code, 200, resp)
        raw = (self.work / "feedback.json").read_text(encoding="utf-8")
        self.assertIn("目標値の根拠を書いてください", raw)  # ensure_ascii=False
        self.assertNotIn("\\u", raw)
        fb = json.loads(raw)
        self.assertEqual(fb["status"], "in_progress")
        self.assertEqual(len(fb["reviews"]), 5)  # 送っていない項目も含む
        by_id = {r["id"]: r for r in fb["reviews"]}
        self.assertEqual(by_id["a-doc"]["verdict"], "revise")
        self.assertEqual(by_id["a-doc"]["verdict_label"], "要修正")
        self.assertIsNone(by_id["a-screen"]["verdict"])
        self.assertEqual(fb["summary"]["unjudged"], 4)
        code, _h, body = s.get("/api/feedback")
        self.assertEqual(json.loads(body.decode("utf-8"))["overall_comment"], "全体として案Aが良い")

    def test_unknown_verdict_becomes_null(self):
        s = self.start()
        s.post("/api/feedback", {"status": "in_progress", "reviews": [{"id": "a-doc", "verdict": "たぶん良い"}]})
        fb = json.loads((self.work / "feedback.json").read_text(encoding="utf-8"))
        self.assertIsNone(fb["reviews"][0]["verdict"])

    def test_rejects_foreign_origin_and_wrong_type(self):
        s = self.start()
        code, _ = s.post("/api/feedback", {"status": "complete", "reviews": []}, {"Origin": "null"})
        self.assertEqual(code, 403)
        code, _ = s.post("/api/feedback", {"status": "complete", "reviews": []}, {"Origin": "http://evil.example"})
        self.assertEqual(code, 403)
        req = urllib.request.Request(s.url + "api/feedback", data=b'{"status":"complete","reviews":[]}',
                                     headers={"Content-Type": "text/plain"}, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(cm.exception.code, 415)
        code, _h, _b = s.get("/", {"Host": "attacker.example:80"})
        self.assertEqual(code, 403)
        self.assertIsNone(s.proc.poll())  # 終了していない
        self.assertFalse((self.work / "feedback.json").exists())

    def test_raw_serves_only_listed_files_with_sandbox(self):
        s = self.start()
        data = page_data(s.get("/")[2].decode("utf-8"))
        html_file = next(f for it in data["items"] for f in it["files"] if f["kind"] == "html")
        code, headers, _ = s.get(html_file["raw_url"])
        self.assertEqual(code, 200)
        self.assertIn("sandbox", headers["Content-Security-Policy"])
        css_url = html_file["raw_url"].rsplit("/", 1)[0] + "/style.css"
        self.assertEqual(s.get(css_url)[0], 200)  # HTML が相対パスで読む CSS
        base = html_file["raw_url"].rsplit("/", 1)[0]
        self.assertEqual(s.get(base + "/..%2F..%2Freview.json")[0], 404)
        self.assertEqual(s.get(base + "/../../review.json")[0], 404)
        self.assertEqual(s.get("/raw/99/0/x")[0], 404)

    def test_complete_saves_and_exits(self):
        s = self.start()
        code, resp = s.post("/api/feedback", {
            "status": "complete",
            "reviews": [{"id": "a-doc", "verdict": "adopt", "comment": ""},
                        {"id": "b-data", "verdict": None, "comment": "3月の数字が大きすぎる"}],
        })
        self.assertEqual(code, 200)
        self.assertEqual(resp["status"], "complete")
        rc = s.proc.wait(timeout=10)
        self.assertEqual(rc, 0)
        s._reader.join(5)
        out = s.output()
        self.assertIn("REVIEW_COMPLETE:", out)
        self.assertIn("未判定 4", out)
        fb = json.loads((self.work / "feedback.json").read_text(encoding="utf-8"))
        self.assertEqual(fb["status"], "complete")
        self.assertEqual(len(fb["reviews"]), 5)
        self.assertEqual(sum(1 for r in fb["reviews"] if r["verdict"] is None), 4)

    def test_late_in_progress_does_not_overwrite_complete(self):
        s = self.start()
        s.post("/api/feedback", {"status": "complete", "reviews": [{"id": "a-doc", "verdict": "adopt"}]})
        code, _ = s.post("/api/feedback", {"status": "in_progress", "reviews": []}) if s.proc.poll() is None else (409, {})
        self.assertEqual(code, 409)
        s.proc.wait(timeout=10)
        fb = json.loads((self.work / "feedback.json").read_text(encoding="utf-8"))
        self.assertEqual(fb["status"], "complete")

    # --- ページからの問い合わせと、次の版への切り替え ------------------------

    def test_state_and_data_endpoints(self):
        s = self.start()
        page = page_data(s.get("/")[2].decode("utf-8"))
        st = s.state(page["session"])
        self.assertEqual(st["session"], page["session"])
        self.assertEqual(st["version"], page["version"])
        self.assertFalse(st.get("superseded"))
        code, _h, body = s.get("/api/data")
        self.assertEqual(code, 200)
        data = json.loads(body.decode("utf-8"))
        self.assertEqual(len(data["items"]), 5)
        self.assertEqual(data["session"], page["session"])

    def test_version_follows_artifacts_but_not_feedback(self):
        s = self.start()
        v0 = s.state()["version"]
        s.post("/api/feedback", {"status": "in_progress", "reviews": [{"id": "a-doc", "comment": "保存しただけ"}]})
        self.assertEqual(s.state()["version"], v0)  # 保存（feedback.json の書き込み）では変わらない
        md = self.work / "案A" / "提案書.md"
        md.write_text(md.read_text(encoding="utf-8") + "\n追記した行\n", encoding="utf-8")
        v1 = s.state()["version"]
        self.assertNotEqual(v1, v0)  # 成果物を直すと変わる
        css = self.work / "案A" / "style.css"  # 画面.html が相対パスで読む CSS（review.json には書いていない）
        css.write_text(css.read_text(encoding="utf-8") + "\n/* 直した */\n", encoding="utf-8")
        v2 = s.state()["version"]
        self.assertNotEqual(v2, v1)
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        data["title"] = "題名を直した"
        self.write_manifest(data)
        self.assertNotEqual(s.state()["version"], v2)  # review.json を直すと変わる

    def test_feedback_next_to_artifacts_does_not_change_version(self):
        m = self.work / "案A" / "r.json"
        m.write_text(json.dumps({"items": [{"id": "x", "files": ["提案書.md"]}]}, ensure_ascii=False), encoding="utf-8")
        s = self.start(manifest=m)
        v0 = s.state()["version"]
        s.post("/api/feedback", {"status": "in_progress", "reviews": [{"id": "x", "comment": "同じフォルダに保存される"}]})
        self.assertTrue((self.work / "案A" / "feedback.json").exists())
        self.assertEqual(s.state()["version"], v0)

    def test_page_from_previous_round_prevents_new_tab(self):
        log = self.tmp / "browser.log"
        s = self.start(browser=True, env={"REVIEW_VIEWER_BROWSER_LOG": str(log)})
        # 前の版から開いたままのページ（前のサーバーの session を知っている）が、待ち時間の間に問い合わせる
        self.assertFalse(s.state("前の版の-session").get("superseded"))
        self.assertTrue(s.wait_line("ATTACHED:", 5))
        time.sleep(3.2)  # 待ち時間（ATTACH_WAIT）を過ぎても
        self.assertFalse(log.exists())  # 新しいタブは開かない
        self.assertFalse(any(line.startswith("BROWSER:") for line in s.lines))

    def test_new_tab_when_no_page_attaches_and_late_page_is_superseded(self):
        log = self.tmp / "browser.log"
        s = self.start(browser=True, env={"REVIEW_VIEWER_BROWSER_LOG": str(log)})
        self.assertTrue(s.wait_line("BROWSER:", 8))
        self.assertEqual(log.read_text(encoding="utf-8").strip(), s.url)
        # 新しいタブを開いた後につながってきた古いページは使わない。保存もさせない
        self.assertTrue(s.state("前の版の-session").get("superseded"))
        code, resp = s.post("/api/feedback", {"status": "in_progress", "reviews": []}, {"X-Review-Session": "前の版の-session".encode("utf-8").hex()})
        self.assertEqual(code, 409)
        self.assertTrue(resp.get("superseded"))
        # 新しいタブのページ（このサーバーの session を知っている）は使える
        page = page_data(s.get("/")[2].decode("utf-8"))
        self.assertFalse(s.state(page["session"]).get("superseded"))
        code, _ = s.post("/api/feedback", {"status": "in_progress", "reviews": []}, {"X-Review-Session": page["session"]})
        self.assertEqual(code, 200)

    def test_save_for_another_manifest_is_rejected(self):
        s = self.start()
        code, resp = s.post("/api/feedback", {"status": "complete", "manifest": str(self.work / "別の版" / "review.json"), "reviews": []})
        self.assertEqual(code, 409)
        self.assertTrue(resp.get("stale"))
        self.assertIsNone(s.proc.poll())  # 完了として扱っていない
        self.assertFalse((self.work / "feedback.json").exists())

    # --- ポート -------------------------------------------------------------

    def test_busy_port_falls_back(self):
        busy = free_port()
        blocker = socket.socket()
        blocker.bind(("127.0.0.1", busy))
        blocker.listen(1)
        try:
            s = self.start(port=busy)
            self.assertNotEqual(s.port, busy)
            self.assertEqual(s.get("/")[0], 200)
            self.assertTrue(any("使用中" in line for line in s.lines))
        finally:
            blocker.close()

    def test_two_servers_same_default_port(self):
        port = free_port()
        a = self.start(port=port)
        b = self.start(port=port)
        self.assertEqual(a.port, port)
        self.assertNotEqual(b.port, port)

    # --- マニフェストの設定 -------------------------------------------------

    def test_custom_verdict_options(self):
        m = self.write_manifest({
            "verdict": {"options": [{"value": "keep", "label": "残す", "tone": "good"}, "保留",
                                    {"value": "drop", "label": "捨てる", "tone": "bad"}]},
            "items": [{"id": "x", "files": ["案A/提案書.md"]}],
        }, "custom.json")
        s = self.start(manifest=m)
        v = page_data(s.get("/")[2].decode("utf-8"))["verdict"]
        self.assertTrue(v["enabled"])
        self.assertEqual([o["label"] for o in v["options"]], ["残す", "保留", "捨てる"])
        self.assertEqual(v["options"][1]["value"], "保留")
        s.post("/api/feedback", {"status": "in_progress", "reviews": [{"id": "x", "verdict": "保留"}]})
        fb = json.loads((self.work / "feedback.json").read_text(encoding="utf-8"))
        self.assertEqual(fb["reviews"][0]["verdict"], "保留")

    def test_verdict_disabled(self):
        m = self.write_manifest({"verdict": False, "items": [{"id": "x", "files": ["案A/提案書.md"]}]}, "nov.json")
        s = self.start(manifest=m)
        v = page_data(s.get("/")[2].decode("utf-8"))["verdict"]
        self.assertEqual(v, {"enabled": False, "options": []})
        s.post("/api/feedback", {"status": "in_progress", "reviews": [{"id": "x", "verdict": "adopt", "comment": "よい"}]})
        fb = json.loads((self.work / "feedback.json").read_text(encoding="utf-8"))
        self.assertIsNone(fb["reviews"][0]["verdict"])
        self.assertIsNone(fb["summary"]["unjudged"])

    def test_previous_feedback_is_shown(self):
        prev = self.work / "前回" / "feedback.json"
        prev.parent.mkdir()
        prev.write_text(json.dumps({"status": "complete", "overall_comment": "前回の全体",
                                    "reviews": [{"id": "a-doc", "verdict": "revise", "verdict_label": "要修正",
                                                 "comment": "見出しを短く"}]}, ensure_ascii=False), encoding="utf-8")
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        data["previous_feedback"] = "前回/feedback.json"
        self.write_manifest(data)
        s = self.start()
        d = page_data(s.get("/")[2].decode("utf-8"))
        item = next(i for i in d["items"] if i["id"] == "a-doc")
        self.assertEqual(item["previous"]["comment"], "見出しを短く")
        self.assertEqual(d["previous_meta"]["overall_comment"], "前回の全体")

    def test_invalid_manifest_exits_with_message(self):
        m = self.write_manifest({"items": [{"id": "x"}, {"id": "x"}]}, "dup.json")
        r = subprocess.run([sys.executable, str(SERVER), str(m), "--no-browser"], capture_output=True, env=ENV, timeout=20)
        self.assertEqual(r.returncode, 2)
        self.assertIn("重複", r.stderr.decode("utf-8"))

    def test_static_output(self):
        out = self.tmp / "出力" / "review.html"
        r = subprocess.run([sys.executable, str(SERVER), str(self.manifest), "--static", str(out)],
                           capture_output=True, env=ENV, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        d = page_data(out.read_text(encoding="utf-8"))
        self.assertEqual(d["mode"], "static")
        html_file = next(f for it in d["items"] for f in it["files"] if f["kind"] == "html")
        self.assertIsNone(html_file["raw_url"])
        self.assertIn("ようこそ", html_file["text"])

    def test_manifest_with_bom(self):
        raw = self.manifest.read_text(encoding="utf-8")
        self.manifest.write_bytes(b"\xef\xbb\xbf" + raw.encode("utf-8"))
        r = subprocess.run([sys.executable, str(SERVER), str(self.manifest), "--check"], capture_output=True, env=ENV, timeout=20)
        self.assertIn("OK:", r.stdout.decode("utf-8"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
