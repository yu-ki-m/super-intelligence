# 同じブラウザを操作・保存する

## 標準構成：スキルがブラウザを起動して操作する

画面の保存は、操作したタブそのものに対して行う必要がある。別のブラウザでURLを開き直すと、検索条件、開閉状態、ログイン状態が引き継がれないためである。そのため、保存スクリプト（Node）と画面操作の両方が、同じChromeにCDP（Chrome DevTools Protocol。ブラウザを外部から操作する接続口）で接続する。

この構成はスキルだけで完結する。`workflow.mjs browser`がChromeを起動し、操作・確認・保存も同じスクリプトのコマンドで行う。ユーザーがChromeを起動したり、MCPを設定したりする必要はない。

```sh
node scripts/workflow.mjs browser --url https://example.test/tickets   # 起動、または既存のCDPを再利用
node scripts/workflow.mjs list                                          # タブの番号とURL
node scripts/workflow.mjs viewport --url https://example.test/tickets --size 1440x900
node scripts/workflow.mjs run --url https://example.test/tickets --script ./step.mjs
node scripts/workflow.mjs snapshot --url https://example.test/tickets --out ./snapshot.txt
node scripts/workflow.mjs capture --url https://example.test/tickets --ready '#ticket-list' --out ./output/capture-001
```

`browser`は次の順で動く。

1. `--cdp`（既定は`http://127.0.0.1:9222`）にCDPで応答するブラウザがあれば、それを再利用する。`--url`を指定した場合は、そのURLを開く。
2. 応答がなければ、`--chrome`、環境変数`SCREEN_BROWSER`、Chrome、Edge、PlaywrightのChromiumの順に実行ファイルを探す。
3. 見つけたブラウザを、専用profileとlocalhost限定のCDPで、画面付きで起動する。専用profileの既定はWindowsでは`%LOCALAPPDATA%\screen-mockup-profile`、それ以外では`~/.screen-mockup-profile`。起動後、CDPが応答するまで最大15秒待つ。

専用profileを使うため、ユーザーが普段使うChromeのcookieやログイン状態は引き継がない。ログインが必要な画面では、起動したウィンドウでユーザー本人にログインしてもらう。認証情報をスキルに入力させない。同じprofileのChromeがCDPなしで既に起動していると、CDPを開けずに失敗する。その場合は、そのChromeを閉じてから再実行する。

`run`に渡すスクリプトは、同じタブの`page`を受け取る。

```js
// step.mjs（スクラッチ領域に置く）
export default async page => {
  await page.getByRole('searchbox', { name: '記事、質問を検索' }).fill('Playwright');
  await page.keyboard.press('Enter');
  await page.locator('article').first().waitFor();
  return page.url();
};
```

## 操作上の注意

- **ユーザーのタブを動かさない。** 起動したウィンドウは画面に表示され、ユーザーも操作できる。`open`は空白タブがあれば再利用し、なければ別ウィンドウで開く。操作の前には毎回`list`でURLを確かめる。
- **viewportはウィンドウの実寸で合わせる。** Playwrightの`setViewportSize`はエミュレーションで、CLIが接続を切ると元に戻る。`viewport`コマンドは、対象タブを前面に出してからウィンドウの大きさを変える。Windowsの表示倍率が125%のような端数のときは、近い大きさを試して内側の寸法を一致させる。一致しなかった場合は`matched:false`を返す。
- **背景タブの寸法は信用しない。** 背景タブが返す`innerWidth`と`innerHeight`は更新されない。この値を基に補正すると、ウィンドウが極端に縮む。`viewport`はタブを前面に出し、`document.visibilityState`が`visible`であることを確かめる。最小化されているときは止まる。
- **CDPを外部に公開しない。** `browser`は127.0.0.1以外のendpointを拒否する。NodeとブラウザがWSL・Docker・SSHなどで別の環境にある場合、127.0.0.1は同じ宛先を指さない。その場合は同じ環境で動かす構成を選ぶ。

## Playwright MCPとの関係（任意）

Playwright MCPを`--cdp-endpoint http://127.0.0.1:9222`付きで登録している場合は、MCPのツールで同じタブを操作してもよい。登録例を次に示す。既存設定を丸ごと置換しない。

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

一方、既定の設定（`npx @playwright/mcp@latest`のみ）のMCPは、独自のブラウザをパイプ接続で起動する。このブラウザは外部から接続できないため、そこで操作した状態は保存できない。この場合はMCPを画面操作に使わず、上記のコマンドを使う。MCPの設定をスキルが自動で書き換えることはしない。

## MCPだけで保存できるか

`browser_run_code`や`browser_run_code_unsafe`で`require('fs')`、dynamic import、任意のローカルファイルの読み込みができるとは仮定しない。本スキルは保存処理をNode側のスクリプトに置くため、それらの機能に依存しない。

既存のPlaywrightコードから呼ぶ場合は、Node.js側の既存のPageを渡す。

```js
import { capturePage } from '/absolute/skill/scripts/workflow.mjs';
await capturePage(page, '/absolute/output/capture-001', { ready: '#ticket-list', label: '一覧' });
```

このAPIを使う場合も、SingleFileのdistの生成とレンダリング用のChromiumが必要である。
