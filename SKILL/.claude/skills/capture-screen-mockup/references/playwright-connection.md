# 同じブラウザを操作・保存する

## 推奨構成

ユーザーが操作・保存対象として指定したChromiumを、専用profileとlocalhost限定のCDPで起動し、Playwright MCPと本スクリプトをそのendpointへ接続する。既存MCPのブラウザを勝手に再起動しない。CDP未設定なら、現在の状態がそのまま引き継がれるとは約束しない。

Windows PowerShell例（Chromeの実行ファイル位置は環境に合わせる）:

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir="$env:LOCALAPPDATA\screen-mockup-profile"
```

MCP設定例。既存設定を丸ごと置換しない。`@latest`は設定時の例なので、実運用では導入時に確認したバージョンへ固定する。

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--cdp-endpoint", "http://127.0.0.1:9222"]
    }
  }
}
```

1. MCPから必要なページを開き、ユーザーが必要ならログインする。
2. MCPから検索条件や展開状態を整える。
3. 別のshellで`workflow.mjs list`を実行し、対象URLを確認する。
4. MCPの操作を一旦止め、`workflow.mjs capture`を実行する。
5. キャプチャ後は元タブでMCP操作を続けられる。スクリプトは接続を切断するがブラウザを終了しない。

NodeプロセスとMCPが異なるcontainer/hostの場合、127.0.0.1は同一宛先ではない。明示的に用意された接続経路を使用する。CDPを外部へ公開しない。ブラウザprofileのコピーやstorage書き出しはこの手順では不要。

## MCPだけで保存できるか

Playwright MCPの実行ツールはバージョンごとに名称・実行環境・許可が異なる。`browser_run_code`や`browser_run_code_unsafe`で`require('fs')`、dynamic import、任意ローカルファイル読み込みが可能とは仮定しない。本スキルの標準経路はMCPとshellの役割を分けるため、その機能に依存しない。

既存Playwrightコードから呼ぶ場合は、Node.js側の既存Pageを渡す:

```js
import { capturePage } from '/absolute/skill/scripts/workflow.mjs';
await capturePage(page, '/absolute/output/capture-001', { ready: '#ticket-list', label: '一覧' });
```

このAPIもSingleFileのdist生成とレンダリング用Chromiumが必要。MCP側の任意コード実行を許可するための設定変更は自動で行わない。
