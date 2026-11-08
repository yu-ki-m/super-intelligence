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
import time
import unittest
import urllib.error
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
    """テスト用にサーバーを起動し、標準出力から URL を読み取る。"""

    def __init__(self, manifest: Path, *extra: str, port: int | None = None):
        self.port_arg = port or free_port()
        self.proc = subprocess.Popen(
            [sys.executable, str(SERVER), str(manifest), "--no-browser", "--port", str(self.port_arg), *extra],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV,
        )
        self.lines: list[str] = []
        deadline = time.time() + 15
        self.url = None
        while time.time() < deadline:
            raw = self.proc.stdout.readline()
            if not raw:
                break
            line = raw.decode("utf-8")
            self.lines.append(line)
            m = re.match(r"URL: (http://127\.0\.0\.1:(\d+)/)", line)
            if m:
                self.url, self.port = m.group(1), int(m.group(2))
                break
        if not self.url:
            err = self.proc.stderr.read().decode("utf-8", "replace") if self.proc.poll() is not None else ""
            raise RuntimeError("server did not start: " + "".join(self.lines) + err)

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

    def start(self, *extra: str, manifest: Path | None = None, port: int | None = None) -> Server:
        s = Server(manifest or self.manifest, *extra, port=port)
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
        out = s.proc.stdout.read().decode("utf-8")
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
