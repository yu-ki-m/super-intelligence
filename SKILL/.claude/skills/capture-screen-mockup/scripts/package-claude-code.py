"""Create a Claude Code distribution without installed dependencies or user data."""
from pathlib import Path
import argparse
import json
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = Path(args.out).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
files = [Path('SKILL.md'), Path('package.json'), Path('package-lock.json'), Path('.gitignore')]
for folder in ('scripts', 'references', 'assets'):
    files.extend(sorted(f.relative_to(root) for f in (root / folder).rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix != '.pyc'))
intro = '''## Claude Codeでの実行位置

`references/claude-code.md`の導入手順を読み、必要な準備が済んでいるか確認する。
スキルの配置先は`.claude/skills/capture-screen-mockup/`または`~/.claude/skills/capture-screen-mockup/`。
ReadでこのSKILL.mdを読んだ実際の絶対パスからスキルルートを特定する。
本書の`node scripts/workflow.mjs`は説明上の相対表記である。実行時はスクリプトの絶対パスを引用して指定し、作業ディレクトリは利用プロジェクトのルートに保つ。
初回のnpm ciとbuildだけはスキルルートで実行する。
出力先・input・patchはプロジェクトルートから解決した絶対パスを使い、ユーザー指定がなければ`artifacts/screen-mockups/`配下に保存する。
Playwright MCPは接続済みの実ツール名を確認して利用し、Bash等からNodeスクリプトを実行する。
MCPやBashの権限設定を自動で変更しない。作業完了時に成果物の実パスと検証結果を報告する。

'''
with zipfile.ZipFile(out, 'x', zipfile.ZIP_DEFLATED) as archive:
    for rel in files:
        data = (root / rel).read_bytes()
        if str(rel) == 'SKILL.md':
            text = data.decode('utf-8')
            text = text.replace('## 基本方針', intro + '## 基本方針', 1)
            text = text.replace('ChatGPTでは成果物の保存手順に従う。', 'Claude Codeではプロジェクトの成果物ディレクトリへ保存し、実パスを報告する。')
            data = text.encode('utf-8')
        archive.writestr('.claude/skills/capture-screen-mockup/' + rel.as_posix(), data)
    archive.writestr('INSTALL.md', (root / 'references/claude-code.md').read_bytes())
    archive.writestr('playwright-mcp.example.json', json.dumps({'mcpServers': {'playwright': {'command': 'npx', 'args': ['-y', '@playwright/mcp@latest', '--cdp-endpoint', 'http://127.0.0.1:9222']}}}, indent=2) + '\n')
print(out)
