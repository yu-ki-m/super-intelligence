# 汎用デザインシステム（スマートフォン版）

スマートフォンで指で操作する画面を作るための、部品とトークンの集まりです。
PC 版（`../sample-design-system/`）と同じトークンの名前・同じ色の値を使い、見た目（ミニマル・コンソール）と画面の明るさの切り替えも同じ仕組みで動きます。違うのは部品の作りで、狭い画面・ホバーの無い操作・指で押す大きさ・端末の帯とキーボードに合わせて組み直しています。

このフォルダーには、アプリの部品とは別に、**端末そのものの部品**（`device.css` / `device.js`）も入っています。スマートフォン向けの画面を、パソコンのブラウザで「端末に入った姿」で見せるためのもので、デモやプロトタイプの確認に使います。同じ HTML を実機で開くと、端末の部品は表示されず、アプリだけが画面いっぱいに出ます。

## ファイル

| ファイル | 中身 |
|---|---|
| `tokens.css` | デザイントークン（`--ds-*`）。色は PC 版と同じ値。大きさ・文字・角丸・端（safe area）をスマートフォン用にしたもの。`:root` がミニマル、`:root[data-look="console"]` がコンソール |
| `components.css` | アプリの部品のクラス `.ds-*`。トークンだけを使う。最後に「コンソールの見た目で形が変わる部品」と「動き」をまとめている |
| `components.js` | アプリの部品の動き。`window.ds`（重なる部品の開閉・画面の進む戻る・スナックバー・確かめるダイアログ・動きの関数）、部品の共通の動き、指の動き（シートを引いて閉じる・行を払う・引いて更新） |
| `device.css` / `device.js` | デモ用の端末の部品 `.dv-*`。端末の枠・時刻の帯・カメラの穴・下の操作の帯・画面のキーボード・通知・端末のお知らせ・許可のダイアログ・ホーム画面・デモの操作盤。`window.dv` |
| `icons.svg` | 16px の線のアイコン。PC 版の 60 個に、スマートフォン版で 20 個（ホーム・ゴミ箱・共有・元に戻す・送る・カレンダー・端末の戻る／ホーム／履歴など）を足した 80 個 |
| `sync-icons.py` | `icons.svg` を変えたあとに実行し、HTML に埋め込んだアイコンを揃える |
| `index.html` | 部品の一覧と使い方。冒頭の「部品の索引」に全部品（アプリ 77 種・端末 12 種）を分類して並べ、各部品を端末の幅（360px）の見本に入れて見せる。PC 版との対応表もある |
| `例_スマホ画面.html` | 端末の枠に入れた画面の例。PC 版の画面例と同じ「脆弱性の検出結果を、対応が必要か・不要かに仕分ける」業務を、スマートフォンの作りにしたもの。右にデモの操作盤がある |

## 想定する端末

画面の真ん中上に丸いカメラの穴がある、側面の平らな Android 端末です。端末の部品は、この形に合わせています。

| 項目 | 値 |
|---|---|
| 画面 | 360 × 780（CSS の px。縦横比 19.5 : 9） |
| 本体 | 枠 4px ＋ 黒い縁 8px。角丸 54px。右側面に音量ボタンと電源ボタン |
| 枠の色 | `data-frame="mint"`（既定。淡い緑がかった灰色）・`silver`・`graphite` |
| 時刻の帯 | 高さ 32px。左に時刻と通知の印、右に Wi-Fi・電波・電池 |
| 下の操作の帯 | ジェスチャー（高さ 24px のつまみ。`data-nav="gesture"`、既定）か、3 つのボタン（戻る・ホーム・履歴。高さ 48px。`data-nav="buttons"`） |

## 使い方

```html
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <script>
    try {
      const t = localStorage.getItem('ds-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
      const l = localStorage.getItem('ds-look'); if (l === 'console') document.documentElement.dataset.look = l; else if (l === 'minimal') delete document.documentElement.dataset.look;
    } catch (_) {}
  </script>
  <link rel="stylesheet" href="tokens.css">
  <link rel="stylesheet" href="components.css">
  <link rel="stylesheet" href="device.css">      <!-- 端末の枠で見せるときだけ -->
  <script src="components.js" defer></script>
  <script src="device.js" defer></script>       <!-- 端末の枠で見せるときだけ。components.js の後 -->
</head>
<body class="ds-body">
  <div class="dv-stage">
    <div class="dv-phone" data-app-name="仕分け">
      <div class="dv-phone__glass"><div class="dv-screen"><div class="dv-viewport">

        <div class="ds-app">
          <div class="ds-app__stack">
            <section class="ds-screen">
              <header class="ds-appbar">…</header>
              <main class="ds-content">…</main>
              <div class="ds-bottombar">…</div>   <!-- 任意 -->
            </section>
          </div>
          <nav class="ds-tabbar">…</nav>          <!-- 任意 -->
          <div class="ds-sheet" hidden>…</div>    <!-- 重なる部品 -->
        </div>

      </div></div></div>
    </div>
  </div>
</body>
```

- 端末の枠を使わない（実機向けの HTML だけを作る）ときは、`device.css` / `device.js` と `.dv-*` の入れ物を省き、`<body>` の直下に `.ds-app` を置く。`.ds-app` は画面の高さいっぱいになる。
- `viewport-fit=cover` を付ける。付けないと、実機で `env(safe-area-inset-*)` が 0 になり、時刻の帯やカメラの穴の下に中身が潜る。
- 基本パレット（`--ds-neutral-*`、`--ds-primary-*`）を画面で直接使わず、意味トークンを使う（PC 版と同じ決まり）。
- アイコンは `<svg class="ds-icon"><use href="#ds-i-info"/></svg>`。`file://` で開くと外部の `icons.svg` を読めないブラウザがあるため、見本の HTML には同じ `symbol` を埋め込んでいる。
- `localStorage` の `ds-theme` / `ds-look` は PC 版と同じ名前なので、同じ場所から開いた PC 版とスマートフォン版で選択が揃う。端末の枠の色と下の帯は `dv-frame` / `dv-nav` に残る。

## PC 版との違い

違いは、画面が狭いこと、ホバーが無いこと、指で押すこと、端末の帯とキーボードが画面の一部を占めること、の 4 つから来ています。

| 違い | 理由 | 決まり |
|---|---|---|
| 押せる範囲を 48px 以上にする | 指はマウスの矢印より太く、小さな的は押し間違える。Android の指針は 48dp、iOS は 44pt を最小としている | ボタン・入力欄・行・タブは 48px 以上（`--ds-size-touch`）。見た目が小さい札や小さなボタンは `::after` で押せる範囲だけを広げる |
| ホバーを使わない | 指の端末には「重ねる」操作が無い | 押している間の重ね（`--ds-color-pressed`）で押したことを伝える。ツールチップは持たない |
| 主な操作を画面の下に置く | 片手で持つと、親指は画面の下半分に届きやすく、上の端には届きにくい | 行き先は下のタブ、その画面の主な操作は下の操作帯か浮かぶボタン。上のアプリバーには戻る・検索・その他だけ |
| 1 画面に 1 つのことだけを見せる | 幅が 360px ほどしかなく、一覧・詳細・根拠を横に並べられない | 一覧から詳細へ「進む」（`ds.push`）。選ぶ・入力するは下から出るシート |
| 端末の帯とキーボードを避ける | 時刻の帯・カメラの穴・下の帯・キーボードは、アプリの描く面に重なる | アプリは端まで描き、中身は `--ds-safe-top` / `--ds-safe-bottom` の分だけ避ける |
| 入力欄の文字を 16px にする | 16px より小さいと、iOS の Safari が入力欄を選んだときに画面を拡大する | `--ds-font-size-input: 16px`。本文は 15px（PC 版は 14px） |

**大きさは、見た目によらず同じにしています。** PC 版のコンソールの見た目は部品の高さを 32px に詰めていますが、スマートフォンでは押せる範囲を狭められないため、コンソールでも 48px のままです。見た目の切り替えで変わるのは、色・書体と太さ・角丸・下のタブとタブと切り替えボタンの形です。

## PC 版との対応

同じ製品を PC とスマートフォンの両方で作るとき、PC 版の部品をスマートフォンで何に置き換えるかの表です。

| PC 版 | スマートフォン版 | 置き換える理由 |
|---|---|---|
| 上部ナビ・サイドナビ | 下のタブ（`.ds-tabbar`）・アプリバー（`.ds-appbar`） | 常に開いた左の列を置く幅が無い。行き先は親指の届く下に置く |
| 表（`.ds-table`） | 行の一覧（`.ds-list` ＋ `.ds-cell`） | 列を並べる幅が無い。大事な 2〜3 項目を 1 行に積み、残りは詳細の画面へ |
| 表の並べ替え・絞り込み | 絞り込みの札（`.ds-chips`、横に送る）・⋮ のメニュー | 列の見出しを押す操作が無い |
| 分割画面・作業台（一覧と詳細を並べる） | 一覧から詳細へ進む（`ds.push`） | 並べる幅が無い |
| モーダル（`.ds-modal`） | シート（選ぶ・入力する）・ダイアログ（確かめる） | 指は画面の下にあるので、下から出すほうが届きやすい |
| 右のヘルプパネル | 画面いっぱいのシート（`.ds-sheet--full`） | 右に並べる幅が無い |
| トースト（`ds.toast`） | スナックバー（`ds.snackbar`） | 下の中央に出し、下のタブ・操作帯に重ならないようにする |
| フラッシュ | バナー（`.ds-banner`）・スナックバー | 残るものはバナー、結果を伝えるだけならスナックバー |
| ツールチップ・ポップオーバー | 説明を常に見せる・? からシート | ホバーが無い |
| メニュー | ⋮ のメニュー（項目 48px）・操作の一覧のシート（`.ds-actions`） | 指で押せる高さにする。項目が多いときはシート |
| コードのタブ・パネルのタブ | 上のタブ（`.ds-tabs`） | 横に送れるようにする |
| キー表示・T / F の近道 | 払える行（`.ds-swipe`） | キーボードの近道の代わりの近道。同じ操作を詳細の画面にも置く |
| ターミナル・ファイルの一覧・コードの検索結果 | （持たない） | スマートフォンで行う作業ではない。必要なら結果だけを行の一覧で見せる |

## 部品の一覧

| 分類 | 部品 | クラス |
|---|---|---|
| 骨組み | アプリ全体、画面、アプリバー（大きな題名・下に続ける欄）、中身、下の操作帯、下のタブ、浮かぶボタン | `.ds-app`、`.ds-app__stack`、`.ds-screen`（`data-tabbar="hidden"`）、`.ds-appbar`（`--large`、`__row` `__title` `__sub` `__actions` `__large` `__extra`）、`.ds-content`、`.ds-bottombar`、`.ds-tabbar`（`__item` `__icon`）、`.ds-fab`（`--extended`） |
| 余白 | 中身の余白、縦に積む、横に並べる | `.ds-pad`、`.ds-stack`、`.ds-row` |
| 文字 | 見出し、補足、等幅、大きな数値 | `.ds-h1`〜`.ds-h4`、`.ds-text-small`、`.ds-mono`、`.ds-value-large` |
| 操作 | ボタン、リンク、メニュー | `.ds-btn`（`--primary` `--danger` `--link` `--icon` `--block` `--s`）、`.ds-btn-group`、`.ds-btn-stack`、`.ds-link`、`.ds-menu`（`__list` `__item`） |
| 一覧 | リスト、行、顔、払える行 | `.ds-list`（`--inset`、`__header` `__footer`）、`.ds-cell`（`--2line` `--danger`、`__lead` `__body` `__title` `__sub` `__meta` `__trail` `__chevron` `__unread`）、`.ds-avatar`、`.ds-swipe`（`__action--start / --end`） |
| まとまり | カード、横に送るカード、キーと値、区切り線、上のタブ | `.ds-card`（`--pressable`）、`.ds-carousel`、`.ds-kv`（`--2col`）、`.ds-divider`、`.ds-tabs`（`--fill`、`__tab`）、`.ds-tab-panel` |
| 入力 | 入力欄、文章欄、セレクト、検索、ラジオ・チェック、トグル、数の増減、切り替えボタン、絞り込みの札 | `.ds-field`、`.ds-input`、`.ds-textarea`、`.ds-select`、`.ds-search`（`__field` `__clear`）、`.ds-choice`、`.ds-toggle`、`.ds-number`、`.ds-segmented`、`.ds-chips`（`data-single` `--wrap`）・`.ds-chip` |
| お知らせ | アラート、バナー、スナックバー | `.ds-alert`、`.ds-banner`、`ds.snackbar()` |
| 重なる部品 | シート、操作の一覧、ダイアログ | `.ds-sheet`（`--full`、`__handle` `__header` `__title` `__body` `__footer`）、`.ds-actions`・`.ds-action`、`.ds-dialog`・`ds.confirm()` |
| 状態 | バッジ、未読の数、深刻度、判定、ステータス、進み具合、読み込み中、空の状態、引いて更新 | `.ds-badge`、`.ds-count`（`--dot`）、`.ds-severity--*`、`.ds-verdict--tp / fp / pending`、`.ds-status--*`、`.ds-progress`（`--indeterminate`）、`.ds-spinner`、`.ds-skeleton`、`.ds-empty`、`.ds-content[data-refresh]` |
| 判定の画面 | コード表示、手順、確認の条件 | `.ds-code`（`__line--hit`）、`.ds-steps`、`.ds-criteria` |

### あとから足した部品

初めの版では、業務アプリのスマートフォン画面でよく使う部品（日付や時刻の選択、まとめて選ぶ操作、履歴、会話など）が足りず、種類が少なかったため、次の部品を足しました。

| 分類 | 部品 | クラス・関数 | 使う場面 |
|---|---|---|---|
| 入力 | スライダー | `.ds-slider`（`__head` `__value` `__ticks`） | 範囲のある数（しきい値・音量など）を指で選ぶ |
| 入力 | 日付（カレンダー） | `.ds-calendar`（`data-month` `data-value` `data-today` `data-min` `data-max` `data-marks`） | 期限・予定日。キーボードで日付を打たせない |
| 入力 | 時刻（ホイール） | `.ds-wheel`（`__col` `__item` `__sep`） | 時刻・分・小さな数を上下に回して選ぶ |
| 入力 | 認証コード | `.ds-otp`、`ds.otpError(要素)` | 1 文字ずつの枠。貼り付けに対応。揃うと `ds-complete` |
| 入力 | 札の入力 | `.ds-tag-input`・`.ds-tag` | 宛先・ラベルなど複数の短い値 |
| 入力 | 添付 | `.ds-attach`（`__item` `--photo` `__add` `__remove` `__progress`） | 写真・ファイル。送信中の進み具合 |
| 入力 | 下の入力欄 | `.ds-composer`（`__field` `__send`） | コメント・相談。画面の下に固定し、送ると `ds-send` |
| 表示 | 数値のタイル | `.ds-stats`・`.ds-stat`（`__delta--good / --bad`） | 件数・割合の要点を 2 列で。増減は矢印と言葉 |
| 表示 | 円の進み具合 | `.ds-ring`（`--l` `--success`） | 達成率・完了の割合 |
| 表示 | 時系列（履歴） | `.ds-timeline`（`__mark--success / --error / --accent`） | 誰が・いつ・何をしたか |
| 表示 | 会話 | `.ds-thread`・`.ds-message`（`--mine` `--failed`） | 相談・コメントのやり取り |
| 表示 | 顔の大きさ・重なり | `.ds-avatar--s / --l`、`.ds-avatar-group`、`.ds-avatar--more` | 担当者・参加者 |
| 表示 | 開閉できるまとまり | `.ds-expandable`（details） | 読む人が限られる情報を畳む。高さが伸び縮みする |
| 表示 | 続きを読む | `.ds-more`（`__text` `__toggle`） | 長い説明を 3 行で切る。切れていなければボタンを出さない |
| 表示 | 横に送るページ・ページの印 | `.ds-pager`（`data-dots`）、`.ds-dots`、`[data-pager-next]`、`.ds-onboard` | 初めて使う人への案内 |
| 状態 | 残り時間 | `.ds-timer`（`data-seconds`） | 期限・試験の時間。1 分を切ると黄、0 で赤 |
| 状態 | 続きの読み込み・失敗の状態 | `.ds-load-more`、`.ds-empty--error` | 一覧の最後・読み込めなかったとき |
| 操作 | 選ぶ状態 | `[data-selectable]`・`.ds-cell__check`・`.ds-appbar--selection`、`ds.selection` | 行を長押しして複数を選び、まとめて操作する |
| 操作 | 横から出る引き出し | `.ds-drawer`（`__header` `__section` `__item`） | 行き先が多く、下のタブ（5 つまで）に入らないとき |
| 操作 | 案内の吹き出し | `ds.coach([{ target, text }], { within })` | 画面の部品を順に指して説明する。`'done'` か `'skip'` を返す |

### 端末の部品（デモ用）

| 部品 | クラス・関数 | 内容 |
|---|---|---|
| 台 | `.dv-stage` | 端末を置く台。中の端末をブラウザの高さに収まるよう縮める（`data-dv-scale="1"` の端末は縮めない） |
| 本体 | `.dv-phone` > `.dv-phone__glass` > `.dv-screen` > `.dv-viewport` | `data-frame`・`data-nav`・`data-battery`・`data-time`（時刻を固定）・`data-app-name` / `data-app-icon`（ホーム画面と通知に出す名前と頭文字）。`.dv-viewport` は `<iframe>` にもできる |
| 時刻の帯・カメラの穴・下の帯 | `device.js` が作る | 時刻の帯の文字色は `--ds-color-statusbar-fg`（アプリバーの地に合わせる）。`data-statusbar="light / dark"` で固定できる |
| 戻る | 3 つのボタンの戻る、左右の端から内へ払う | アプリの `ds.back()` を呼ぶ。開いているシート → メニュー → 画面の順に閉じ、最上位の画面ではホーム画面へ移る |
| ホーム | 3 つのボタンのホーム、下のつまみを上へ払う、`dv.home()` | 壁紙・時計・アプリのアイコン。アイコンを押すとアプリへ戻る |
| キーボード | 入力欄を選ぶと出る | 表示面がキーボードの分だけ縮む。キーを押すと入力欄に文字が入る。`inputmode="numeric"` などでは数字の並び。`data-dv-keyboard="off"` で出さない |
| 通知 | `dv.notify({ title, text, onTap })` | 画面の上に出る通知。上へ払うと消え、押すと `onTap` |
| 端末のお知らせ | `dv.toast(文)` | 画面の下に出る短いお知らせ。アプリのスナックバーとは別 |
| 許可のダイアログ | `dv.permission({ text, options })` | 選んだ文字を返す（Promise）。選ぶまで閉じない |
| 操作盤 | `.dv-controls` | 端末の横に置くデモの操作盤。`data-dv-frame` / `data-dv-nav` / `data-theme-choice` / `data-look-choice` のボタンを置く |

端末の部品は、Android 端末の時刻の帯・通知・許可のダイアログなどの**役割と大きさ**を再現したもので、特定の製品の画面を写したものではありません。

## 画面の側から使う関数（`window.ds`）

| 関数 | 使い道 |
|---|---|
| `ds.open(要素)` / `ds.close(要素, 値)` | シート・ダイアログを開く・閉じる。閉じると要素に `ds-close` イベント（`detail.value`）。HTML では `data-open="id"` と `data-close="値"` |
| `ds.confirm({ title, message, ok, cancel, tone, icon, within })` | 確かめるダイアログ。押したほうで `true` / `false`。`tone: 'danger'` では「キャンセル」に焦点を置く |
| `ds.snackbar({ message, action, onAction, duration, within })` | 下に短いお知らせ。「元に戻す」を 1 つ置ける。下のタブ・下の操作帯・浮かぶボタンの上に出る |
| `ds.push(画面)` / `ds.pop()` / `ds.back()` | 画面へ進む・戻る・「戻る」（重なり → メニュー → 画面の順）。HTML では `data-push="id"` と `data-pop` |
| `ds.remove(要素)` / `ds.enter(要素)` / `ds.flip(要素の一覧, 変える処理)` | 縮めて消す・浮かび上がらせる・並べ替えを滑らせる（PC 版と同じ） |
| `ds.transition(() => { 変える })` | 画面全体をなめらかに入れ替える |
| `ds.init(要素)` | あとから差し込んだ HTML の中の部品（スライダー・カレンダー・ホイール・続きを読むなど）の初めの形を整える |
| `ds.selection.enter(画面, 行)` / `exit(画面)` / `selected(画面)` | 選ぶ状態に入る・抜ける・選んだ行の一覧 |
| `ds.coach(手順, { within })` | 案内の吹き出しを出す |
| `ds.otpError(要素)` / `ds.calendar(要素)` | 認証コードが違ったときに揺らして空にする / カレンダーを描き直す |

**画面の側で受け取るイベント**

| イベント | 出る所 | 内容 |
|---|---|---|
| `ds-swipe` | `.ds-swipe` | 行を払って離した。`detail.side`（`start` / `end`）・`detail.action`。`preventDefault()` で行を戻さない（`ds.remove` で消すとき） |
| `ds-refresh` | `.ds-content[data-refresh]` | 先頭で引いて離した。`preventDefault()` したら、読み終えたときに `detail.done()` を呼ぶ。呼ばなければ 0.9 秒で戻る |
| `ds-change` | `.ds-segmented`・`.ds-chip` | 切り替えた・札を選んだ |
| `ds-tabchange` / `ds-screenchange` | 下のタブ / 画面 | 行き先が変わった / 進んだ・戻った |
| `ds-open` / `ds-close` | シート・ダイアログ・引き出し | 開いた / 閉じた |
| `ds-change` | スライダー以外の入力の部品（カレンダー・ホイール・札の入力） | 値が変わった（`detail.value` / `detail.tags`） |
| `ds-complete` | `.ds-otp` | 認証コードが揃った（`detail.code`） |
| `ds-send` | `.ds-composer` | 送るボタンを押した（`detail.text`） |
| `ds-attach` | `.ds-attach` | ＋ を押した（ファイルを選ぶ処理は画面の側） |
| `ds-selectionchange` | 選ぶ状態の画面 | 選んだ行が変わった（`detail.cells`。抜けると空） |
| `ds-pagechange` / `ds-pager-end` | `.ds-pager` | ページが変わった（`detail.index`・`detail.last`） / 最後のページで「次へ」を押した |
| `ds-expire` | `.ds-timer` | 残り時間が 0 になった |

## 決まり

1. **重なる部品は `.ds-app` の中に置く。** シート・ダイアログ・スナックバーは `.ds-app` を基準に `position: absolute` で出す。`<dialog>` の最前面（top layer）を使わないのは、ブラウザで端末の枠の中に表示するとき、枠の外まで覆ってしまうためである。開いている間、後ろの画面は `inert` になる。
2. **スワイプは近道にとどめる。** 行を払う操作は、行を開いた先かメニューにも必ず同じものを置く。払う動きができない人・知らない人がいるためである。
3. **確かめるより、取り消せるようにする。** 判定のようにくり返す操作は、ダイアログで確かめず、スナックバーの「元に戻す」で直せるようにする。ダイアログは、取り消せない操作（削除・サインアウト）の前だけに使う。
4. **主ボタンは 1 画面に 1 つ。** 下の操作帯・シートの確定・浮かぶボタンのどれか 1 つだけを主ボタンにする。
5. **色だけで意味を伝えない。** 状態・深刻度・判定には、必ずアイコンか文字を添える（PC 版と同じ）。
6. **キーボードで隠れることを前提にする。** 入力欄は縦に送れる場所に置き、確定のボタンを入力欄の近くに置く。端末の枠で、キーボードが出たときに確定のボタンが見えるかを確かめる。

## 動き

長さと速さの変わり方は PC 版と同じトークンを使います。足したのは画面の進む・戻る（`--ds-motion-duration-screen`: 360ms）だけです。

| 動き | 付く部品 |
|---|---|
| 右から重なる・右へ去る | 画面の進む・戻る |
| 下から上がる・下へ去る（指に付いて動く） | シート |
| 浮かんで現れる | ダイアログ・メニュー・スナックバー |
| 指に付いて動く（越えるとアイコンが大きくなり、端末が短く震える） | 払える行・引いて更新・端末の戻るジェスチャー |
| 縮んで消え、後ろが詰まる | 判定した行 |
| 押した手応え（少し縮む） | ボタン・札・カード・浮かぶボタン |
| 畳む | 大きな題名・文字付きの浮かぶボタン |

動きを減らす設定（prefers-reduced-motion）の人には、長さがすべて 0 になり、すぐに結果の形になります。

## 確かめたこと

Chromium（Playwright）で、ローカルの HTTP サーバーから開いて確かめました。実機（Android・iOS の端末）ではまだ確かめていません。

- `例_スマホ画面.html` を幅 1280px で開き、端末の枠・時刻の帯・カメラの穴・下の帯が表示され、端末がブラウザの高さに収まるよう縮むことを画像で確かめた。
- 一覧 → 詳細へ進む → 判定の理由のシートを開く → メモ欄を選ぶとキーボードが出て表示面が縮む → キーを押すと文字が入る → 確定するとキーボードが閉じ、一覧へ戻って行が消え、スナックバーが下のタブの上に出る、の流れを確かめた。
- 行を左へ払うと「対応が必要」になり、「元に戻す」で未判定に戻ることを確かめた。
- 画面の左端から内へ払うと前の画面へ戻ること、通知を押すとその検出の詳細が開くことを確かめた。
- 暗い画面・コンソールの見た目・3 つのボタン・グラファイトの枠に切り替えて、画像で崩れが無いことを確かめた。設定の画面から通知の許可のダイアログが出て、「許可しない」でトグルが戻ること、最上位の画面で「戻る」を押すとホーム画面へ移ることを確かめた。
- 幅 390px（実機の幅）で開くと、端末の部品が消え、アプリが画面いっぱいに出て、横にはみ出さないことを確かめた。
- `index.html` を開き、スクリプトの誤りが出ないこと、ページが横にはみ出さないこと、ダイアログとシートが見本の画面の中に収まることを確かめた。

- あとから足した部品を `index.html` で試した。長押しで選ぶ状態に入り、押すたびに選ぶ・外す、Esc で抜けること。引き出しが開き、項目を押すと閉じること。案内の吹き出しが指した部品の下に出て、次へ・スキップで進むこと。認証コードが違うと揺れて空になり、正しいコードが入ること。札の入力・カレンダーの日と月の切り替え・ホイール・スライダー・下の入力欄の送信・続きを読む・開閉・ページ送り（最後で「はじめる」に替わる）が動くこと。暗い画面・コンソールの見た目でも画像で崩れが無いことを確かめた。
- `例_スマホ画面.html` で、2 行を長押しで選んで「対応不要」にまとめて判定し、「元に戻す」で 2 行とも戻ること、詳細の「続きを読む」と対応の履歴の開閉、案内の吹き出しを確かめた。

確かめていないこと: 一度だけ、入力欄を選んでいないのに端末のキーボードが出た画像があった（同じ手順を 3 回くり返しても再現せず、原因は分かっていない。見えていない入力欄ではキーボードを出さない条件を足した）。実機での指の操作（払う・引いて更新・シートを引く）、iOS の Safari、Firefox、読み上げ機能での操作、文字と背景の明るさの差（コントラスト比）の測定。色の値は PC 版と同じですが、スマートフォン版で足した色（アプリバー・下のタブ・スナックバーなど）の組み合わせは測っていません。
