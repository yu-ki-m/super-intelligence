# Claude Codeでの導入

ZIP内の`.claude/skills/capture-screen-mockup/`を、利用するプロジェクトの同じ場所へコピーする。既存の同名スキルがある場合は内容を比較して更新する。既存の`.claude`全体を置き換えない。

全プロジェクトで使う場合は、`capture-screen-mockup`フォルダを`~/.claude/skills/`へコピーする（Windowsでは通常`C:\Users\ユーザー名\.claude\skills\`）。プロジェクト用と個人用の両方には配置しない。

## 初回の準備（Windows PowerShell）

Node.js 20以上、npm、Claude Code、ChromeまたはChromiumを用意する。プロジェクトのルートで実行する。

```powershell
Push-Location .claude/skills/capture-screen-mockup
npm ci
npm run build
npx playwright install chromium
Pop-Location
```

npm ciとbuildの成功を確認してから次へ進む。npmの実行が端末の制約で拒否された場合は、組織の許可された設定に従う。権限チェックを無効化しない。個人用に置いた場合はPush-Locationのパスを変更する。

## ブラウザとPlaywright MCP

専用profileでChromeを起動する。Chromeのパスは端末に合わせる。

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir="$env:LOCALAPPDATA\screen-mockup-profile"
```

配布物の`playwright-mcp.example.json`の`mcpServers.playwright`を、プロジェクトルートの`.mcp.json`へ追加する。既存設定を上書きしない。既にPlaywright MCPが登録されている場合は同じendpointを使うようその設定を調整し、二重登録しない。

`@playwright/mcp@latest`は導入例。組織で使用版が決まっていればその版を指定する。設定後にClaude Codeを開き直し、`/mcp`で接続を確認する。設定の信頼確認が表示されたら内容を確認する。

WindowsネイティブのClaude Codeで使う例。WSL・Docker・SSHの場合、ブラウザとNodeのlocalhostが一致するとは限らないため、まず同じ環境で動かす構成を選ぶ。CDPポートを外部公開して解決しない。

## 呼び出し例

```text
/capture-screen-mockup Playwright MCPで開いているチケット一覧を、検索条件と詳細展開を維持したままHTML保存してください。検索ボタンの隣にCSV出力ボタンを追加し、変更箇所に番号と説明を付けてください。成果物はartifacts/screen-mockups/ticket-listへ保存してください。
```

Claude Codeが対象タブを確認し、capture → patch作成 → mockup → PNG確認を実行する。作成されるCSVボタンは画面案であり、実際の出力処理は実装しない。

## 直接実行する場合

プロジェクトルートで実行する。下記URLは実際のタブURL、selectorは実際の画面要素へ置換する。

```powershell
node .claude/skills/capture-screen-mockup/scripts/workflow.mjs list --cdp http://127.0.0.1:9222
node .claude/skills/capture-screen-mockup/scripts/workflow.mjs capture --cdp http://127.0.0.1:9222 --url 'https://example.test/tickets' --ready '#ticket-list' --out artifacts/screen-mockups/capture-001
node .claude/skills/capture-screen-mockup/scripts/workflow.mjs mockup --input artifacts/screen-mockups/capture-001/original.html --patch artifacts/screen-mockups/changes.json --out artifacts/screen-mockups/proposal-001
```

changes.jsonは実際の保存HTMLに合わせて作成する。スキル内のassets/changes.example.jsonは付属デモ用であり、実画面へそのまま適用しない。

macOS/Linuxも同じNodeコマンドを使用できる。Chromeの起動コマンドとprofileのパスは環境に合わせる。

## 成果物と制限

- original.html/png: キャプチャした原本とその再描画。
- mockup.html/png: UI変更後の画面案。
- annotated.html/png: 番号・枠・説明を加えた画面案。
- changes.json: 原本から再生成できる変更履歴。
- 各offline-check.json: 画像欠損や横方向のはみ出し等の検査結果。

iframeは除外する。スクロール位置復元、仮想リスト、CORS制限のある素材には制約がある。HTMLから元システムへの送信・script実行を無効化する。詳細はSKILL.mdを確認する。

検証: Nodeスクリプトの実ブラウザテストとCDP接続経由の同一タブ保存は実施済み。ユーザー端末でのClaude Code・MCP・Windowsの組合せは未実行。配布物には依存コード、browser binary、node_modules、dist、実画面データを含めない。

公式仕様（2026-10-12確認）:
- https://code.claude.com/docs/en/skills
- https://github.com/microsoft/playwright-mcp
