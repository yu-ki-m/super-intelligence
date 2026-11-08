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

## ブラウザ

Chromeの起動やMCPの設定は不要。スキルが`workflow.mjs browser`で、専用profileとlocalhost限定のCDPを使ってChrome（なければEdge、PlaywrightのChromium）を画面付きで起動する。ログインが必要な画面では、起動したウィンドウでユーザーがログインする。詳細は`references/playwright-connection.md`を参照する。

Playwright MCPは任意である。`--cdp-endpoint http://127.0.0.1:9222`付きで登録している場合に限り、同じタブの操作に使える。既定のPlaywright MCPは独自のブラウザを起動するため、そこで操作した画面は保存できない。

WSL・Docker・SSHの場合、ブラウザとNodeのlocalhostが一致するとは限らないため、まず同じ環境で動かす構成を選ぶ。CDPポートを外部に公開して解決しない。

## 呼び出し例

```text
/capture-screen-mockup https://example.test/tickets のチケット一覧を、検索条件と詳細展開を整えてからHTML保存してください。検索ボタンの隣にCSV出力ボタンを追加し、変更箇所に番号と説明を付けてください。成果物はartifacts/screen-mockups/ticket-listへ保存してください。
```

Claude Codeがブラウザを起動し、対象タブの操作、capture、patchの作成、mockup、PNGの確認を順に実行する。作成されるCSVボタンは画面案であり、実際の出力処理は実装しない。

## 直接実行する場合

プロジェクトルートで実行する。下記URLは実際のタブURL、selectorは実際の画面要素へ置換する。

```powershell
node .claude/skills/capture-screen-mockup/scripts/workflow.mjs browser --url 'https://example.test/tickets'
node .claude/skills/capture-screen-mockup/scripts/workflow.mjs list
node .claude/skills/capture-screen-mockup/scripts/workflow.mjs viewport --url 'https://example.test/tickets' --size 1440x900
node .claude/skills/capture-screen-mockup/scripts/workflow.mjs capture --url 'https://example.test/tickets' --ready '#ticket-list' --out artifacts/screen-mockups/capture-001
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

検証: Nodeスクリプトの実ブラウザテスト（CORS拒否の画像の補完を含む）は実施済み。2026-11-08に、Windows 11とChrome 157の組合せで、`browser`による起動、`open`による別ウィンドウ表示、`viewport`（表示倍率125%）、`capture`の実行を、https://qiita.com/ で確認した。配布物には依存コード、browser binary、node_modules、dist、実画面データを含めない。

公式仕様（2026-10-12確認）:
- https://code.claude.com/docs/en/skills
- https://github.com/microsoft/playwright-mcp
