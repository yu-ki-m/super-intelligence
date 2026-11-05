"""文書の確認。必要なファイルの存在、参照先の実在、説明方針で避ける表現を機械で確かめる。

意味の確認はここではできない。
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

REQUIRED = [
    "SKILL.md", "README.md", "architecture.md",
    "references/discussion-guide.md", "references/agent-roles.md", "references/work-orchestration.md",
    "references/capacity-evaluation.md", "references/debate-protocol.md",
    "templates/task-board.md", "templates/quality-review.md", "templates/cross-document-review.md",
    "templates/product-brief.md", "templates/evidence-register.md", "templates/debate-log.md",
    "templates/session-state.md", "templates/brand-proposal.md",
    "examples/end-to-end-run.md", "examples/sample-debate.md", "evals/scenarios.md",
    "graphs/minimal.graph.json", "graphs/standard.graph.json", "graphs/minimal.mmd", "graphs/standard.mmd",
    "schemas/task.schema.json", "schemas/artifact.schema.json", "schemas/evidence.schema.json",
    "schemas/review.schema.json", "schemas/message.schema.json", "schemas/state.schema.json",
    "harness/scheduler.py", "harness/store.py", "harness/leases.py", "harness/engine.py",
    "adapters/mock.py", "adapters/claude_cli.py",
    "validators/formal.py", "validators/graphcheck.py", "validators/crossdoc.py",
    "quality/contracts.json", "quality/README.md", "quality/examples.md", "evals/results/README.md",
]
PROSE = ["SKILL.md", "README.md", "architecture.md", "references/*.md", "templates/*.md", "examples/*.md", "quality/README.md", "quality/examples.md", "evals/scenarios.md"]
# 対象や動作が曖昧になる比喩。説明方針で避けるものの例として挙げる場合は「」で囲む。
VAGUE = ["効く", "刺さる", "(?<!撤)回す", "(?<!撤)回して", "走らせ", "噛ませ", "拾う", "拾っ", "寄せる", "倒す", "叩く"]
ABSTRACT = ["柔軟", "高度", "効率的", "最適化"]
HYPE = ["！", "🎉", "革新的"]


def prose_files():
    for pattern in PROSE:
        yield from ROOT.glob(pattern)


def strip_quoted(text):
    text = re.sub(r"「[^」]*」", "", text)
    text = re.sub(r"`[^`]*`", "", text)
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    # 引用（行頭の >）は悪い例や仮説文の型なので対象にしない。
    return "\n".join(line for line in text.splitlines() if not line.startswith(">"))


class Documents(unittest.TestCase):
    def test_required_files_exist(self):
        missing = [p for p in REQUIRED if not (ROOT / p).exists()]
        self.assertEqual(missing, [])

    def test_skill_description_and_length(self):
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: product-branding-team\n"))
        self.assertLess(len(text.splitlines()), 500)

    def test_paths_mentioned_in_skill_exist(self):
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        for path in re.findall(r"`((?:references|templates|schemas|quality|examples|harness|evals)/[\w./-]+|architecture\.md|README\.md)`", text):
            self.assertTrue((ROOT / path).exists(), path)

    def test_no_vague_metaphor_outside_quotes(self):
        problems = []
        for path in prose_files():
            body = strip_quoted(path.read_text(encoding="utf-8"))
            for word in VAGUE + ABSTRACT + HYPE:
                if re.search(word, body):
                    problems.append(f"{path.name}: {word}")
        self.assertEqual(problems, [])

    def test_fictional_examples_are_labelled(self):
        for name in ["examples/sample-debate.md", "quality/examples.md"]:
            self.assertIn("架空", (ROOT / name).read_text(encoding="utf-8")[:300], name)

    def test_no_claim_of_fifty_people_achieved(self):
        for path in prose_files():
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"50人分を(達成|実現)(した|しました|できた)(?!」|こと|と報告|とは)", path.name)


if __name__ == "__main__":
    unittest.main()
