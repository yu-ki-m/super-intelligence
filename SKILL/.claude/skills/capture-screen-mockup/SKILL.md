---
name: capture-screen-mockup
description: 既存Web画面を、スキル自身が起動・操作するChrome（CDP接続。Playwright MCPの設定は不要）で目的の状態まで操作し、そのタブをSingleFile Coreで単一HTMLへ保存し、その複製にUI追加・文言変更・装飾変更・注釈を施して画面イメージを生成する。既存画面をもとに改修案、HTMLモックアップ、変更前後の画面、注釈付き画面を作る場合に使用する。
---

# 既存画面から画面案を作る

## Claude Codeでの実行位置

`references/claude-code.md`の導入手順を読み、必要な準備が済んでいるか確認する。
スキルの配置先は`.claude/skills/capture-screen-mockup/`または`~/.claude/skills/capture-screen-mockup/`。
ReadでこのSKILL.mdを読んだ実際の絶対パスからスキルルートを特定する。
本書の`node scripts/workflow.mjs`は説明上の相対表記である。実行時はスクリプトの絶対パスを引用して指定し、作業ディレクトリは利用プロジェクトのルートに保つ。
初回のnpm ciとbuildだけはスキルルートで実行する。
出力先・input・patchはプロジェクトルートから解決した絶対パスを使い、ユーザー指定がなければ`artifacts/screen-mockups/`配下に保存する。
ブラウザの起動・画面操作・保存はすべて`workflow.mjs`のコマンドで行う。Playwright MCPの設定は不要。
MCPやBashの権限設定を自動で変更しない。作業完了時に成果物の実パスと検証結果を報告する。

## 基本方針

- スキルが起動したCDP付きChromeで目的の画面状態まで操作し、同じタブをSingleFile Coreで保存する。操作したタブと別のブラウザ・タブでURLを開き直して取得したものを「現在の画面」と呼ばない。
- HTMLを編集可能な原本として取得する。`page.content()`だけでは画像・CSSを内包できないため代用しない。PNGは見た目確認と説明用に生成する。
- 本番画面にUI変更を適用しない。保存後のHTMLの複製にのみ変更する。
- 既存のレイアウト、フォント、余白、色、部品の形を引き継ぐ。ユーザーの指示がない全面的な再デザインをしない。
- AI画像生成ではなくHTML/CSSの編集で画面案を作る。追加部品の寸法・位置を実際のDOMで確認する。

## 1. 接続と準備

スキルディレクトリで初回のみ実行する。`node_modules/`と`dist/`が既にあれば省略する。

```sh
npm ci
npm run build
npx playwright install chromium
```

`dist/`はSingleFile依存をビルドした生成物。バンドルやnode_modulesをスキル本体へコミットしない。依存版はpackage-lock.jsonで固定する。保存HTMLの再描画に既存Chromiumを使う場合は`SCREEN_CHROMIUM`に実行ファイルを指定する。

ブラウザはスキル自身が起動する。ユーザーにChromeの起動やMCP設定を依頼しない。

```sh
node scripts/workflow.mjs browser --url 'https://example.test/tickets'
```

`browser`は`http://127.0.0.1:9222`にCDPで応答するブラウザがあればそれを再利用し、なければChrome→Edge→Playwright Chromiumの順に探して、専用profile（Windowsは`%LOCALAPPDATA%\screen-mockup-profile`）・localhost限定のCDPで画面付きで起動する。ユーザーが普段使うprofileは使わないため、ログインが必要な画面はこのウィンドウでユーザーにログインしてもらう。別のポートは`--cdp`、ブラウザは`--chrome`または環境変数`SCREEN_BROWSER`で指定する。CDPを127.0.0.1以外で公開しない。

Playwright MCPは任意。MCPが`--cdp-endpoint`で同じendpointに接続している場合に限り、画面操作にMCPを使ってよい。既定のPlaywright MCPは独自のブラウザを起動するため、そのブラウザで操作した状態は保存できない。この場合はMCPを使わず、下記のコマンドで操作する。

## 2. 対象の状態を確定する

画面の確認と操作には次のコマンドを使う。対象タブは`--url 完全一致URL`または`--index N`（両方指定するとURLを照合する）で選ぶ。

| コマンド | 役割 |
|---|---|
| `list` | タブの番号・URL・タイトルを表示する |
| `open --url URL` | 空白タブがあれば再利用し、なければ別ウィンドウで開く。ユーザーが操作中のタブを移動させない |
| `snapshot` | アクセシビリティツリーとviewportを出力する（`--out`でファイル保存） |
| `shot --out NEW.png [--full]` | ライブ画面のスクリーンショットを保存する |
| `viewport --size 1440x900` | ウィンドウの実寸を変えてviewportを合わせる。後続コマンドでも保持される |
| `run --script FILE.mjs` | `export default async page => {...}`を同じタブで実行し、戻り値をJSONで出力する。検索入力・クリック・モーダル展開・スクロールに使う |
| `close` | スキルが開いたタブを閉じる。ユーザーのタブは閉じない |

1. `list`で対象タブを確認する。ユーザーが同じブラウザを操作していることがあるため、操作のたびにURLを照合する。ユーザーのタブを勝手に遷移させない。
2. `run`で必要な検索、タブ切替、モーダル展開まで操作する。更新・削除・送信などの業務処理は画面案作成だけを根拠に実行しない。スクリプトはスクラッチ領域に置き、要素はrole・ラベル・CSS selectorで指定する。
3. ローディング終了と画面固有の表示要素を待つ。固定sleepやnetworkidleだけに依存しない。
4. `snapshot`と`shot`で、入力値、選択、開閉状態、viewport、スクロールを確認する。viewportは原則`viewport --size 1440x900`等で明示する（Playwrightの`setViewportSize`は接続を切ると戻るため使わない）。windowの位置はmanifestに記録するが、PNGはページ全体を描画する。入れ子のスクロール領域は保存後に位置を照合する。認証情報は記録しない。
5. 仮想スクロールや遅延読込で未表示の要素が必要なら、その範囲を意図的に表示してから保存する。自動で全ページをスクロールしない。

## 3. 現在の画面を保存する

```sh
node scripts/workflow.mjs capture --url 'https://example.test/tickets' --ready '#ticket-list' --label '検索結果・詳細展開' --out ./output/capture-001
node scripts/workflow.mjs shot --url 'https://example.test/tickets' --out ./output/capture-001/live-viewport.png
```

`--url`は確認済みタブURLと完全一致させる。0件または複数一致なら停止し、`--index`を併用して対象を明確にする。`--ready`は最初に一致した要素の表示を待つ。出力先は新規ディレクトリを指定し、原本を上書きしない。

保存の前に、実行中の有限なCSSアニメーション・トランジション（フェードイン中のポップアップ等）の終了を最大5秒待つ。ページ内の`fetch`がCORSで失敗した画像・CSS・フォントは、同じブラウザcontextのリクエスト（同じcookie）でNode側から取得し直して内包する。件数はcapture.jsonの`resourceFallback`に記録される。

出力は`original.html`、`original.png`、`capture.json`、`original-offline-check.json`。元URL・cookie・storageはmanifestへ保存しないが、HTML本文やリンク以外の属性には業務情報が残り得る。共有前にダミーデータ化・内容確認する。PNGはHTMLをオフラインで再描画した結果であり、ライブ画面のスクリーンショットではない。

`shot`で取得したライブ画面とoriginal.pngを目視比較し、画像、CSS、入力値、開閉状態、改行、欠けを確認する。ライブ画面はdevicePixelRatioの分だけ画素数が大きくなる。取り込めなかった箇所（iframe内の広告等）を完成扱いせず、ユーザーに明示する。

## 4. UI変更と注釈を作る

`references/patch-format.md`と`assets/changes.example.json`を参照する。保存HTMLの実際の要素を調べてCSS selectorを決める。MCP snapshotの一時refをselectorに使わない。

- 文言・部品追加など実際の画面変更はoperationsへ記載する。operationsで加える文言は、実装後の画面に実際に表示する文言だけにする。
- 変更の理由・挙動の説明はannotationsへ記載する。
- 画面案（mockup）は、実装したときの画面そのものとして見せる。「サンプル」「ダミー」「仮の値」「画面案のため」「イメージです」のように、画面案であることや値が仮であることを示す注記・透かし・バッジを、operationsで画面に加えない。画面案を作る者の都合を、利用者に見える画面へ持ち込まないためである。
- 新しい項目に入れる値（件数、割合、日付、名前など）は、実際に出現しうる範囲から、画面に自然に収まるものを選ぶ。一覧なら、値の範囲や状態の違い（低・中・高、0件、長い文字列など）が見えるようにばらつかせる。
- 値が仮であること、値の算出方法などの未決定事項、実データとの関係は、annotationsの説明とユーザーへの報告に書く。画面には書かない。
- 原本から各案を再生成し、操作履歴をJSONとして残す。A案・B案は別ディレクトリにする。

```sh
node scripts/workflow.mjs mockup --input ./output/capture-001/original.html --patch ./changes.json --out ./output/proposal-001
```

出力は`mockup.html/png`（画面案）、`annotated.html/png`（枠・番号・説明付き）、`changes.json`、各offline-check.json。

## 5. 完了確認

- 画面案PNGを開き、追加要素の重なり、切れ、表の列幅、文字のはみ出しを確認する。
- 注釈が意図した要素に付いているか確認する。注釈座標は生成時viewport固定。別幅で確認するときは再生成する。
- offline-checkのbrokenImages・externalResourceAttributes・横はみ出しを確認する。ゼロでも完全再現の保証にはしない。
- 原本のSHA-256と変更記録を保持し、同じ原本とpatchから再生成できる状態にする。
- HTML、PNG、変更点をユーザーに渡す。Claude Codeではプロジェクトの成果物ディレクトリへ保存し、実パスを報告する。実アプリへの組込みとは区別する。

## 制約

- Chromium/CDP向け。Firefox/WebKitへの同一タブ接続は実装していない。
- `browser`で起動したChromeはスキルが終了させない。不要になったらユーザーが閉じる。同じprofileのChromeがCDPなしで起動済みだと起動に失敗するため、その場合は閉じてから再実行する。
- 保存HTMLを開いた際のwindow・入れ子領域のスクロール位置復元は保証しない。スクロール位置自体が仕様説明に必要なら、ライブPNGを併用して欠落を明示する。
- 初版ではiframe/frameを保存HTMLから除外する。必要部分がframe内なら別画面として扱う方法を相談し、欠落を明示する。
- CORSで取得できない画像・CSS・フォント、保護されたcanvas、閉じたShadow DOM、動画、仮想リストは完全再現できない場合がある。DOMにない内容を復元したと主張しない。
- キャプチャは瞬間的な原子的スナップショットではない。アニメーションや更新中の画面は安定させてから保存する。
- HTML保存後はscript、フォーム送信、リンク遷移、外部通信を無効化する。動的アプリとしての機能再現は範囲外。
- CSS selectorの編集は通常のdocument DOMが対象。Shadow DOM内部のpatchには対応しない。
- SingleFile Coreの出典と依存ライセンスは`references/sources.md`を参照する。
