# 汎用デザインシステム

業務の画面や作業道具の画面を作るための、部品とトークンの集まりです。
部品のクラスと HTML の作りは 1 つで、**見た目**を 2 つ、**画面の明るさ**を 2 つから選べます（組み合わせは 4 通り）。

| 見た目 | 指定 | 向いている画面 |
|---|---|---|
| ミニマル（既定） | 何も付けない | エディターや AI ツールのような、中身を読み書きする作業道具 |
| コンソール | `<html data-look="console">` | 管理画面・クラウドコンソールのような、一覧と設定が中心の業務画面 |

`../デザインシステム-AWS`（コンソールの見た目の元）と `../デザインシステム-T3Code`（ミニマルの見た目の元）を 1 つにまとめたものです。
2 つは同じ部品の作りから分かれていたので、部品の多い T3Code 版を土台にし、AWS 版の見た目をトークンと少しの CSS で切り替えられるようにしました。
元の版にあった特定の用途（ゲーム）の言葉・点数の付け方・プレイヤーの表示は除き、部品はすべて残しています。

## ファイル

| ファイル | 中身 |
|---|---|
| `tokens.css` | デザイントークン（色・文字・余白・角丸・線・大きさ・影・動き）。CSS 変数 `--ds-*`。`:root` がミニマル、`:root[data-look="console"]` がコンソールの値 |
| `components.css` | 部品のクラス `.ds-*`。`tokens.css` の変数だけを使う。最後に「コンソールの見た目で形が変わる部品」をまとめている |
| `components.js` | 部品の動き。`window.ds`（開閉・削除・並べ替え・トーストなどの動きの関数）、部品の共通の動き（見た目と明るさの切り替え、タブ、メニュー、パネルの開閉、分割画面・下のパネルの大きさなど）、自動で付く動き（選択の印・モーダル・表の並べ替え・数え上げなど）の 3 つ。`<script src="components.js" defer>` で読み込む |
| `stage.js` | 特殊な画面（タイトル画面など）の粒の背景。必要なページだけで、`components.js` の後に読み込む |
| `icons.svg` | 16px の線のアイコン（自作、60 個）。`#ds-i-info` などの `symbol` |
| `sync-icons.py` | `icons.svg` を変えたあとに実行し、HTML に埋め込んだアイコンを揃える |
| `index.html` | 部品の一覧と使い方。ブラウザで開いて見る。上部ナビの ▭（見た目）と ◐（明るさ）で切り替えられる |
| `例_コンソール画面.html` | 上部ナビ・サイドナビ・ヘルプパネルの骨組み（`.ds-app`）で組んだ画面の例。既定はコンソールの見た目 |
| `例_作業台画面.html` | 上部の帯の無い骨組み（`.ds-workbench`）で組んだ画面の例。下のパネルにターミナル、右のパネルにヘルプ。既定はミニマルの見た目 |
| `例_タイトル画面.html` | 粒の背景と中央の札で組んだ、入口の画面の例（特殊な画面）。Enter かはじめるで、札と背景が去ってから作業台の画面へ移る |

画面の例はどちらも「脆弱性の検出結果を、対応が必要か（真陽性）・不要か（偽陽性）に仕分ける」業務を題材にしています。部品の組み合わせ方の見本で、どちらの見た目でも表示できます。

## 使い方

```html
<head>
  <script>
    try {
      const t = localStorage.getItem('ds-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
      const l = localStorage.getItem('ds-look'); if (l === 'console') document.documentElement.dataset.look = l; else if (l === 'minimal') delete document.documentElement.dataset.look;
    } catch (_) {}
  </script>
  <link rel="stylesheet" href="tokens.css">
  <link rel="stylesheet" href="components.css">
  <script src="components.js" defer></script>
</head>
<body class="ds-body">
  <!-- 上部ナビのある骨組み -->
  <div class="ds-app">
    <header class="ds-topnav">…</header>
    <div class="ds-subbar">…</div>
    <nav class="ds-sidenav">…</nav>
    <main class="ds-main">…</main>
    <footer class="ds-footer">…</footer>
  </div>
</body>
```

上部の帯を持たない骨組み：

```html
<div class="ds-workbench">
  <aside class="ds-workbench__sidebar">…</aside>
  <div class="ds-workbench__main">
    <div class="ds-titlebar">…</div>
    <div class="ds-workbench__content">…</div>
    <section class="ds-workbench__bottom" id="bottom">…</section>
  </div>
  <aside class="ds-workbench__panel">…</aside>
</div>
```

- 最初の `<script>` は、保存した見た目と明るさを描画の前に当てる処理。無いと違う見た目が一瞬出る。
- 画面では基本パレット（`--ds-neutral-*`、`--ds-primary-*`）を直接使わず、意味トークン（`--ds-color-text-body`、`--ds-color-border-input` など）を使う。基本パレットを直接使うと、見た目や明るさを切り替えても色が変わらない。
- アイコンは `<svg class="ds-icon"><use href="#ds-i-info"/></svg>`。HTML をファイルとして直接開く（`file://`）と外部の `icons.svg` を読めないブラウザがあるため、見本の HTML には同じ `symbol` を埋め込んでいる。

## 見た目の切り替え

| 部分 | ミニマル（既定） | コンソール |
|---|---|---|
| アクセント | 青 `#2563eb`。主ボタン・チェック・トグル・選択の輪だけ | インディゴ `#4338ca`。主ボタン・通常のボタンの枠と文字・今いる項目・タブ |
| 地 | 白 / 黒 `#000000` | 白 / 紺に近い黒 `#121220` |
| 上部ナビ・フッター | 地と同じ色。線 1 本で区切る | どちらの画面でも濃い帯 `#1c1b33` |
| 通常のボタン | 灰色の面と淡い枠 | 白地にアクセント色の枠と文字 |
| サイドナビの今いる項目 | 灰色の面と太字 | アクセント色の太字に薄い背景 |
| タブ・切り替えボタン | 溝の中の明るい面 | タブは下線、切り替えボタンはアクセントの塗り |
| フラッシュ | 浮いた面と色付きのアイコン | 種類の色で塗りつぶし、白い文字 |
| パンくず | 区切りは「/」、リンクは下線なしの薄い文字 | 区切りは山形、リンクは下線付きのアクセント色 |
| メニュー | 面の内側に余白、項目は角丸 | 端まで広がる項目、ホバーはアクセントの薄い面 |
| 角丸 | バッジ 6・ボタン 8・入力欄 10・通知 12・カード 14・入力の大きな枠 16px | バッジ 4・ボタン 6・入力欄 6・通知 8・カード 8・入力の大きな枠 10px |
| アラートの左端の線 | 1px | 4px |
| ラジオ・チェック・トグル | 16px・トグル 36 × 20px | 14px・トグル 24 × 16px |
| 文字 | Inter → Segoe UI → Noto Sans JP、太字 600。見出し 26 / 18 / 16 / 15px | Noto Sans JP、太字 700。見出し 24 / 20 / 18 / 16px |
| 入力欄の仮の文字 | 立体 | 斜体 |
| 部品の高さ | 34px（上部ナビ 44px） | 32px（上部ナビ 48px） |
| ターミナル | 画面の明るさに合わせる | どちらの画面でも暗い |

**仕組み**
- 見た目の違いは、ほとんどをトークンの値で表す。`tokens.css` の `:root` がミニマル、`:root[data-look="console"]` がミニマルと違う値だけを上書きする。
- トークンでは表せない形の違い（タブの下線、フラッシュの塗り、パンくずの区切り、メニューの項目、切り替えボタンなど）は、`components.css` の最後に `:where(:root[data-look="console"]) …` でまとめている。`:where()` で包んでいるので詳しさ（優先度）が上がらず、部品の状態（`aria-selected` や `:disabled` など）の決まりを壊さない。
- 切り替えのメニューは `data-look-choice="minimal|console"` を付けた項目で作る（`components.js` が動かす）。選んだものは `localStorage` の `ds-look` に残り、切り替えると `ds-lookchange` イベントが出る。
- 見た目を足すときは、`tokens.css` に `:root[data-look="名前"]` を足して違う値だけを書き、形が違う部品があれば `components.css` の最後に同じ書き方で足す。

## 動き（モーション）

状態が変わるとき、形がつながって見えるように動かします。部品を使えば自動で付くので、画面の側で書くことはほとんどありません。`index.html` の「動き」に見本があります。

| 動き | 付く部品 | 仕組み |
|---|---|---|
| 選択の印が隣へ滑る | タブ、切り替えボタン、パネルのタブ、コードのタブ、ページ送り、段階の表示 | 選んだ項目の見た目（面・枠・下線）を写した印を置き、ばねの動きで移す。見た目を切り替えても、その見た目の印になる |
| 浮かんで現れ、沈んで消える | メニュー、ポップオーバー、モーダル（後ろの暗さも）、トースト | 開閉を受け取って動かす。モーダルは Esc と `<form method="dialog">` の両方 |
| 高さ・幅が伸び縮みする | 展開できる区切り、ファイルの一覧、下のパネル、右のパネル、サイドナビ | パネルの中身は形を保ったまま切り取る |
| 縮んで消え、後ろが詰まる | フラッシュ、アラート、絞り込みの札、コードのタブ、トースト | ボタンに `data-dismiss="消す部品のセレクター"`、または `ds.remove(要素)` |
| 行が移る | 並べ替えできる表 | 行を実際に並べ替え、前の位置から滑らせる（FLIP）。比べる値はセルの `data-sort-value` があればそれ |
| 順に浮かび上がる | 本文・作業台の中身・`.ds-stack` の子 | ページを開いたとき |
| 数え上がる・伸びる | 大きな数値、使用量、進み具合、点数の円、版の範囲 | 画面に入ったときに 1 回だけ |
| 手応え | ボタン（押すと縮む）、トグル（ばね）、チェック（弾む）、押せるカード（重ねると浮く） | CSS だけ |
| 画面全体が入れ替わる | 見た目・明るさの切り替え | View Transitions（使えないブラウザでは、すぐに切り替わる） |

**画面の側から使う関数（`window.ds`）**

| 関数 | 使い道 |
|---|---|
| `ds.toast({ title, message, tone, duration })` | 右下に通知を出す。`tone` は info / success / warning / error、`duration` はミリ秒（0 なら自動で消えない） |
| `ds.remove(要素)` | 縮めて消し、後ろを詰める |
| `ds.flip(要素の一覧, () => { 並びを変える })` | 並びを変え、前の位置から滑らせる |
| `ds.showPanel(要素)` / `ds.hidePanel(要素)` | `hidden` の付け外しを、伸び縮みで行う |
| `ds.openDetails(details)` / `ds.closeDetails(details)` | details の開閉を動かす |
| `ds.enter(要素)` | あとから足した部品を浮かび上がらせる |
| `ds.transition(() => { 変える })` | 画面全体をなめらかに入れ替える |

**決まり**
- 長さと速さの変わり方はトークン（`--ds-motion-duration-instant / fast / base / slow / slower`、`--ds-motion-ease-standard / enter / exit / spring / bounce`）を使い、数字を直接書かない。
- 消すときは `element.remove()` や `hidden = true` を直接使わず、`ds.remove` / `ds.hidePanel` か `data-dismiss` / `data-close-panel` を使う。直接使うと一瞬で消える。
- 動きを減らす設定（prefers-reduced-motion）の人には、長さがすべて 0 になり、すぐに結果の形になる。読み込み中の回る印だけは、止めると分からないので遅くする。印刷では動きを止める。
- ばねと弾みの動き（`linear()`）は Chrome / Edge 113、Firefox 112、Safari 17.2 以降。古いブラウザでは普通の減速の動きになる。

## 特殊な画面：舞台（タイトル画面）

ゲームのタイトル画面・ログインの前の画面など、**作業の前の入口の画面だけ**で使う、特殊な部品です。立体の中を漂う粒と、近い粒どうしを結ぶ線の背景を描き、その上の中央に札（すりガラスのカード）を置きます。

```html
<script src="components.js" defer></script>
<script src="stage.js" defer></script>
…
<div class="ds-stage">
  <canvas class="ds-stage__canvas" aria-hidden="true"></canvas>
  <header class="ds-stage__bar">…</header>
  <main class="ds-stage__center"><section class="ds-stage__card">…</section></main>
  <footer class="ds-stage__foot">…</footer>
</div>
```

| 部分 | クラス・指定 | 内容 |
|---|---|---|
| 舞台 | `.ds-stage`（`--embed` で高さ 480px の見本用） | 画面いっぱいの地。`data-stage-density`（粒の多さ）、`data-stage-speed`（速さ） |
| 背景 | `.ds-stage__canvas` | `stage.js` が描く。マウスの方へ少し傾く。色は `--ds-color-stage-*`（見た目のアクセント色に合わせる） |
| 中央の札 | `.ds-stage__card`、`__eyebrow`、`__title`、`__lead`、`__actions`、`__btn-meta`、`__links` | 開くと札がばねで浮かび、中身が順に出る |
| 上と下の帯 | `.ds-stage__bar`、`.ds-stage__foot` | 製品名・見た目と明るさのメニュー、版など |

**特殊な部品として使うときの決まり**
- 作業の画面（一覧・詳細・判定など）の背景には使わない。動く背景は読む邪魔になり、電池と処理も使う。
- `stage.js` はこの画面だけで読み込む。ほかのページの重さは変わらない。
- 「背景を動かす」を設定で切れるようにする（`ds.stage.setMotion(false)`。選んだものは `localStorage` の `ds-stage-motion` に残る）。
- 次のときは止まった 1 コマだけを描く：動きを減らす設定、背景を動かすを切ったとき、画面の外にあるとき、タブが隠れているとき。
- 粒の数は画面の面積に合わせ、上限 220 にする（狭い画面では少ない）。
- 去る動き（はじめるを押したとき）は、画面の側で `ds.play` を使って札と背景を消してから移る。
- 札は 84% の不透明度とぼかしで、粒が透けても文字が読めるようにしている。中に置く文字は短くする。

## 暗い画面（ダークモード）

初めはパソコンの設定（明るい・暗い）に従います。◐ のメニューで「明るい」「暗い」を選び直せ、選んだものは次に開いたときも残ります。「パソコンの設定に合わせる」を選ぶと、保存した選択を消して元に戻ります。

- 意味トークンは `light-dark(明るい画面の値, 暗い画面の値)` で両方の値を持つ。どちらが効くかは `color-scheme` で決まる（`tokens.css` の最後）。
  - 何も指定しない：パソコンの設定に従う
  - `<html data-theme="light">` / `<html data-theme="dark">`：どちらかに固定する
- `light-dark()` が使えるのは Chrome / Edge 123、Firefox 120、Safari 17.5 以降。
- 切り替えのメニューは `data-theme-choice="auto|light|dark"` を付けた項目で作る。切り替えると `ds-themechange` イベントが出る。

## 原則

1. **道具は静かに、中身を主役に**：画面の枠・ナビ・帯は控えめにする。目立たせるのは、利用者が読む情報と、次に押す操作だけ。
2. **アクセントは絞る**：塗りつぶしの主ボタンは 1 画面に 1 つまで。アクセントの色は、主ボタン・選択・リンクなど意味のある所だけに使う。
3. **判断の根拠を並べて見せる**：一覧・詳細・根拠（資料・コード・記録）を 1 画面に並べ、見比べながら判断できるようにする。
4. **色だけで意味を伝えない**：状態・深刻度・判定には、必ずアイコンか文字を添える。どの見た目・明るさでも、文字と背景の明るさの差（コントラスト比）を 4.5 以上にする。

## 部品の一覧

| 分類 | 部品 | クラス |
|---|---|---|
| 骨組み | 上部ナビ、上部ナビの下の帯、サイドナビ、本文、フッター、右のヘルプパネル | `.ds-app`（`--with-panel`）、`.ds-topnav`、`.ds-subbar`、`.ds-sidenav`、`.ds-main`、`.ds-footer`、`.ds-help-panel` |
| 作業台の骨組み | 左のナビ・本文・下のパネル・右のパネル、題名の行、パネルの見出しとタブ、パネルの開閉 | `.ds-workbench`（`__sidebar` `__main` `__content` `__bottom` `__panel`）、`.ds-titlebar`、`.ds-panel-header`、`.ds-panel-tab`、`data-toggle-panel` / `data-open-panel` / `data-close-panel` |
| 文字 | 見出し、説明、大きな数値、等幅、キー表示、大きな問いかけ | `.ds-h1`〜`.ds-h4`、`.ds-text-small`、`.ds-value-large`、`.ds-mono`、`.ds-kbd`、`.ds-hero` |
| 操作 | ボタン、リンク、メニュー（短いキー・上に開く）、切り替えボタン | `.ds-btn`（`--primary` `--link` `--icon`）、`.ds-link`、`.ds-menu`（`__shortcut`、`--up`）、`.ds-segmented` |
| 入力 | 入力欄、文章欄、セレクト、検索、ラジオ、チェック、トグル、タイル、入力の大きな枠 | `.ds-field`、`.ds-input`、`.ds-textarea`、`.ds-select`、`.ds-search`、`.ds-choice`、`.ds-toggle`、`.ds-tiles`、`.ds-composer` |
| 通知 | フラッシュ、アラート、モーダル、ツールチップ（下に出す）、ポップオーバー | `.ds-flash`、`.ds-alert`、`.ds-modal`、`.ds-tooltip`（`--below`）、`.ds-popover` |
| まとまり | コンテナ、展開できるセクション、タブ、キーと値、区切り線、設定の行、選べる行の一覧 | `.ds-container`、`.ds-expandable`、`.ds-tabs`、`.ds-kv`、`.ds-divider`、`.ds-settings`・`.ds-setting`、`.ds-option-list`・`.ds-option` |
| 一覧 | 表、並べ替え、絞り込みの札、ページ送り、表の上の操作欄 | `.ds-table`（`th[aria-sort]`）、`.ds-chip`、`.ds-pagination`、`.ds-table-toolbar` |
| 状態 | バッジ、ステータス、進み具合、手順、段階の表示、使用量の棒、空の状態、読み込み中 | `.ds-badge`、`.ds-status`、`.ds-progress`、`.ds-steps`、`.ds-stepper`、`.ds-meter`、`.ds-empty`（`__icon`）、`.ds-spinner`、`.ds-skeleton` |

### 調べる・判定する・学ぶ画面の部品

| 部品 | クラス | 用途 |
|---|---|---|
| 深刻度 | `.ds-severity--critical / high / medium / low / info` | 5 段階の重さ（CVSS の区分、障害の重さ、優先度など） |
| 判定 | `.ds-verdict--tp / fp / pending` | 対応が必要（真陽性・該当）・対応不要（偽陽性・非該当）・未判定 |
| コード表示 | `.ds-code`、`.ds-code__line--hit` | 行番号付きのソース。注目してほしい行を黄色で示す |
| 依存関係ツリー | `.ds-tree`、`.ds-tree__hit` | 何が何に含まれているかを入れ子で見せる |
| 手順 | `.ds-steps` | 確かめる順番と、今どこまで進んだか |
| 確認の条件 | `.ds-criteria` | 条件ごとに「はい・いいえ・未確認」で答える |
| 根拠の札 | `.ds-evidence` | ファイルと行、資料へのリンク。押すとその場所を開く |
| ターミナル | `.ds-terminal`（`--fill`） | コマンドの入力と結果 |
| ライセンス | `.ds-license--permissive / weak / strong / proprietary / unknown` | OSS のライセンス。SPDX の名前と種類 |
| ヒント | `.ds-hint`（`--open`） | 押すまで中身を見せない補足。右に開く前の注意を書ける |
| 残り時間 | `.ds-timer`（`--warning` `--expired`） | 締め切り・期限・試験の時間。1 分を切ると黄、0 で赤。上部ナビにも置ける |
| 点数・ランク・結果 | `.ds-score`、`.ds-rank`、`.ds-result` | テスト・評価の結果。項目ごとの正誤と点数 |
| 選ぶカード | `.ds-scenario`（`--locked`）、`.ds-difficulty` | 課題・コース・テンプレートなどを選ぶ画面 |
| ファイルの一覧 | `.ds-filetree`、`.ds-filetree__count` | フォルダーをたどってファイルを開く。検索に当たった数も出せる |
| コードのタブ | `.ds-code-tabs`、`.ds-code-tab` | 開いているファイルを切り替える・閉じる |
| 分割画面 | `.ds-split`、`.ds-split__handle` | 左右に並べる。境目をドラッグか ← → キーで幅を変える |
| コードの検索結果 | `.ds-search-results` | ファイルごとに「行番号と前後のコード」を並べ、当たった文字を黄色で示す |
| バージョンの範囲 | `.ds-version-range`（`--hit` `--safe`） | 影響を受ける範囲と、入っている版を 1 本の線に並べる |
| 依頼書 | `.ds-brief`、`.ds-avatar` | 顧客や上司からの依頼・連絡。誰から・何を・いつまでに |
| 操作の案内 | `.ds-coach`（`--below` `--above`）、`.ds-coach-target`（`--spotlight`） | 画面の部品を順に指して説明する吹き出し |
| 実績のバッジ | `.ds-achievement`（`--locked`） | 研修の修了や利用の記録。取ったものは金のメダル、まだのものは点線と進み具合 |
| 組み合わせ表 | `.ds-matrix`、`.ds-matrix__cell--ok / cond / ng` | 行 × 列の組み合わせごとに、使える・条件付き・使えない |

## 主な値

| 種類 | ミニマル | コンソール |
|---|---|---|
| 本文の文字 | `#09090b` / 暗い画面 `#f4f4f5` | `#0f141a` / 暗い画面 `#e6e6ef` |
| 補足の文字 | `#52525b` / `#a1a1aa` | `#424650` / `#b6b6c8` |
| リンク | `#2563eb` / `#8eb0ff` | `#4f46e5` / `#a5abfc` |
| 主ボタン | `#2563eb`、白い文字 | `#4338ca`（暗い画面 `#4f46e5`）、白い文字 |
| カードの線 | `#e4e4e7` / `#222225` | `#c6c6cd` / `#3a3a55` |
| お知らせ | 水色 `#0e7490`（リンクの青と分ける） | 青 `#0369a1`（リンクのインディゴと分ける） |
| 余白 | 2・4・8・12・16・20・24・32・40px（両方で同じ） | 同じ |

## 確かめたこと

- `index.html` と 2 つの画面の例を、2 つの見た目 × 2 つの明るさで表示して、崩れ・はみ出し・読めない文字が無いことを画像で確かめた。
- 見た目と明るさの切り替え、保存した選択が次に開いたときにも残ること、色見本と角丸の見本の値が切り替えに合わせて変わることを確かめた。
- 文字と背景の組み合わせ 48 組の明るさの差を、2 つの見た目 × 2 つの明るさ（計 192 組）で測り、すべて 4.5 以上にした。
- 画面の例で、判定の選択・キー操作（T / F）・確定前の確認・保存の表示・ヒントを開く動きを試した。
- HTML が使うアイコンがすべて `icons.svg` にあることを確かめた。
- 舞台（タイトル画面）を実時間で動くブラウザで試した。粒が描かれて動くこと、背景を動かすを切ると止まり、入れると動くこと、明るさを切り替えると粒の色が変わること、動きを減らす設定では止まった 1 コマが描かれること、Enter で札が去ってから次の画面へ移ることを確かめた。見た目 2 つ × 明るさ 2 つで画像を確かめた。
- 動きを、実時間で動くブラウザで試した。選択の印・メニュー・展開・モーダル・札の削除・表の並べ替え・トースト・コードのタブ・パネルの開閉・明るさの切り替えが、動いたあと正しい状態で止まること、動きを減らす設定でも同じ結果になることを確かめた。タブの印は約 30 コマで滑らかに移り、行き過ぎは 3px ほど。

## 直したこと

元の 2 つの版から、まとめる途中で次を直しました。

- 色付きのバッジ（`.ds-badge--blue / red / green`）の文字を、どちらの画面でも白にした。T3Code 版では明るい画面で黒い文字が濃い色の上に載り、読みにくかった。
- コンソールの見た目で、作業台の下のパネルの見出しの行（`.ds-panel-header`）は本文の面にした。ターミナルがどちらの画面でも暗いため、そのままでは明るい画面で見出しの文字が読めなくなる。
