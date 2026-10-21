# guide.json の書式と書き方

ガイドは `.codebase-guide-out/ガイド/<ガイド名>/guide.json` から `build-guide.mjs` が生成する。
AIが書くのは guide.json だけで、HTMLは書かない。行番号・差分の行・全体図の配置・リンクはスクリプトが計算する。

## 全体の形

```json
{
  "title": "POST /templates の処理フロー",
  "request": "依頼文をそのまま",
  "diff": "main...HEAD",
  "review": true,
  "summary": ["要約1", "要約2"],
  "steps": [ ... ],
  "routes": [ ... ],
  "notes": [ ... ],
  "unverified": [ ... ],
  "flow": { ... },
  "noteTypes": { ... }
}
```

| 項目 | 必須 | 内容 |
|---|---|---|
| `title` | 必須 | ガイドの題名。表紙とフォルダーツリーの一覧に出る。 |
| `request` | 必須 | 依頼文。表紙に出る。 |
| `diff` | 任意 | 差分の範囲。`"working"`（未コミットの変更）、`"A..B"`、`"A...B"`（merge-base から）、`"<コミット>"`（そのコミット1件）。差分が対象でなければ `null`。コミット指定のときは、そのコミットの版のコードを表示する。 |
| `review` | 任意 | レビュー依頼なら `true`。`false`（既定）のときに指摘を書くとエラーになる。 |
| `summary` | 必須 | 表紙の要約。1行1要素。 |
| `steps` | 必須 | 順路のステップ（下記）。 |
| `routes` | 任意 | ルートの名前・グループ・終わり方・並び順（下記）。省略すると、入口ごとに1ルートを作り、入口の `title` を名前にする。 |
| `notes` | 任意 | 指摘と、ステップに属さない補足の解説（下記）。 |
| `unverified` | 任意 | 未確認事項。文字列か `{ "text": "...", "step": "s3" }`。各ステップの `unverified` も自動で表紙に集める。 |
| `flow` | 任意 | 全体図にノードや矢印を足す（下記）。 |
| `noteTypes` | 任意 | 解説・指摘の種類を足す、または表示名や色を変える（下記）。 |

文字列の中では、バッククォートで囲んだ部分がコード表記になる。空行で段落が分かれる。HTMLタグは書かない（そのまま文字として表示される）。

## steps（順路）

```json
{
  "id": "s4",
  "file": "backend/src/services/template.service.ts",
  "anchor": "const id = await this.repo.insert",
  "anchorEnd": "return { id }",
  "kind": "call",
  "parent": "s3",
  "title": "TemplateService.create",
  "summary": "本体を登録したあと、tags があればタグも登録する",
  "body": "解説の本文",
  "branches": [{ "when": "条件", "then": "結果", "to": "s5" }],
  "links": [{ "to": "s5", "label": "表示名" }],
  "unverified": "確かめられなかったこと"
}
```

呼び出し元が複数あるステップと、呼び出し元を確かめられなかったステップ（ほかの項目は省略）:

```text
{ "id": "s4", "parent": ["s3", "s7"], … }
{ "id": "s9", "callerUnknown": "イベント名を文字列で組み立てて登録しており、どこから発火されるかを特定できていない", … }
```

| 項目 | 必須 | 内容 |
|---|---|---|
| `id` | 必須 | 英数字・`_`・`-`。ほかから参照する名前。 |
| `file` | 必須 | リポジトリのルートからの相対パス。 |
| `anchor` | 必須 | 対象の行にあるコード片（1行の部分一致）。行番号は書かない。 |
| `anchorEnd` / `lines` | 任意 | 範囲の終わり。`anchorEnd` は終わりの行のコード片（`anchor` の行から下を探す）、`lines` は行数。どちらも無ければ1行。 |
| `occurrence` | 任意 | `anchor` が複数行に一致するとき、何番目を使うか（1から）。 |
| `kind` | 任意 | `entry`（入口。処理のきっかけになる操作や出来事。最初のステップは入口にする）、`branch`（分岐）、`call`（呼び出し。既定）、`process`（処理）、`data`（データ操作）、`external`（外部連携）。 |
| `parent` | 任意 | 呼び出し元のステップid。呼び出し元が複数あるときは配列で全部書く。全体図では各呼び出し元から矢印を引く。コールスタックと「呼び出し元」ボタンは、選んでいるルートの中の呼び出し元をたどる。 |
| `callerUnknown` | 任意 | 呼び出し元を確かめられなかったときに、その理由を書く。全体図では区切り線の下の「呼び出し元が未確認」の区画に置き、表紙の未確認事項にも出る。`parent` がある、入口である、ほかのステップの `branches` の `to` で入る、のどれかに当たるステップには書かない。 |
| `title` | 必須 | 関数名など、短い名前。 |
| `summary` | 任意 | 表紙のステップ一覧に出す1行の説明。ルート一覧では、番号にマウスを乗せたときに出る。 |
| `body` | 必須 | 解説の本文。 |
| `branches` | 任意 | 分岐の表。`to` を書くと、その分岐の先のステップへリンクし、全体図でも矢印でつなぐ。`to` が無い分岐は、全体図で「処理の終わり」として描く。 |
| `links` | 任意 | 解説の下に出すリンク。省略すると、`parent` が自分になっているステップ（呼び出し先）へのリンクを自動で出す。 |
| `unverified` | 任意 | このステップで確かめられなかったこと。解説内と表紙に出る。 |

ステップが差分を含むかどうかは、スクリプトが差分の行から判定する。書かない。

順路の組み立て方:

- 順路は必ず入口（処理のきっかけ）から始め、実行される順に並べる（呼び出し元を先、呼び出し先を後）。`build-guide.mjs` が並び順を検査する。入口になるのは次のもの。
  - フロントエンド: ボタンなどの操作（クリック、送信、入力）、画面の初期表示（画面のルート定義、マウント時の処理、ページのデータ取得）
  - バックエンド: エンドポイント、ジョブ・スケジュール、イベント・メッセージの受信、CLI のコマンド
  - ライブラリ: 利用者が呼ぶ公開の関数
- 差分やレビューでも、変更箇所から始めない。変更箇所（定数・設定値・型・共通の関数など）から呼び出し元をさかのぼって入口を見つけ、入口から変更箇所まで実行される順につなぐ。下準備メモの「変更箇所からさかのぼった入口の候補」を起点にし、つながりはコードで確かめる。
- 定数・設定値の変更は、それを使う処理のステップの後に置き、`parent` をその処理にする。
- 入口（`kind` が `"entry"`）ごとに、ルートが1つできる（下記の routes）。変更箇所や依頼の対象（知りたい処理）にたどり着く入口は、全部ステップにする。「全エンドポイントの流れ」のような依頼では、エンドポイントごとに入口を作る。
- フロントエンドの操作からバックエンドの処理へ続く場合（同じリポジトリにある場合）は、操作とエンドポイントの両方を入口にし、API を呼ぶステップの `branches` の `to` でエンドポイントの入口につなぐ。操作のルートは「ルートN へ続く」と表示され、エンドポイントから先はそのルートで読む。
- 同じステップから呼ばれるステップどうしは、steps の並び順が、そのまま呼ばれる順になる。複数のルートが共通の処理を呼ぶときは、共通の処理を、各ルートでそれより先に呼ばれる処理の後ろに置く（例: 作成は `insert` → `saveTags`、更新は `update` → `saveTags` の順に呼ぶなら、`insert` と `update` を `saveTags` より前に置く）。
- `parent` は「そのステップを呼び出しているステップ」にする。ミドルウェアのように、呼び出し元ではないが先に実行される処理は、`parent` を入口にする。続く処理へは、`branches` の `to` でつなぐ。
- 複数の入口や呼び出し元から通る処理は、ステップを複製せず、`parent` に呼び出し元を全部書く。
- 呼び出し元が無いステップ（`parent` が無く、ほかのステップの `branches` の `to` でも入らないステップ）は、入口なら `kind` を `"entry"` にし、呼び出し元を確かめられなかったなら `callerUnknown` に理由を書く。どちらでもないと `build-guide.mjs` がエラーにする（呼び出し元の分からないステップを、入口のように見せないため）。呼び出し元を推測で書かない。
- 依頼に関係しない呼び出しはステップにしない。ステップの数は、流れを追うのに必要な最小限にする。

## routes（ルート）

ルートは、入口ごとの「読む道すじ」。`build-guide.mjs` が steps から組み立てるので、中身（どのステップを通るか）は書かない。

- ルートの中身は、入口から、呼び出し先（`parent` が自分になっているステップ）と分岐の先（`branches` の `to`）をたどった順になる。同じステップから出る先どうしは、steps の並び順にする。
- ほかの入口に着いたところで止め、「ルートN へ続く」にする（画面の保存ボタン → API → エンドポイントなど）。
- エラーなどで途中で終わる流れ（401・404 など）は、ルートを分けない。そのルートの中の分岐（`to` の無い `branches`）として示し、表紙のルート一覧には「途中の終わり」として出る。
- どの入口からもたどれないステップ（`callerUnknown` のステップと、そこからたどれるステップ）は、「呼び出し元が未確認」という1つのルートにまとまる。
- ステップの番号（①②…）はガイド全体で1つ。同じ番号は同じコードなので、どのルートが共通の処理を通るかが分かる。ルートの中の順番は「ルート1 の 4 / 7」のように別に出る。

`routes` は省略できる。名前・グループ・終わり方・並び順を指定したいときだけ書く。書かなかった入口のルートは、書いたルートの後ろに steps の順で足される。

```json
"routes": [
  { "entry": "f1", "title": "保存ボタン（テンプレート編集画面）", "group": "フロントエンド（画面操作・初期表示）" },
  { "entry": "s1", "title": "POST /templates（作成）", "group": "バックエンド（エンドポイント）", "end": "201 を返して終了" },
  { "entry": "u1", "title": "PUT /templates/:id（更新）", "group": "バックエンド（エンドポイント）", "end": "200 を返して終了" }
]
```

| 項目 | 必須 | 内容 |
|---|---|---|
| `entry` | 必須 | 入口のステップid（`kind` が `"entry"` のステップ）。1つの入口に1つ。 |
| `title` | 任意 | ルートの名前。省略すると入口の `title`。 |
| `group` | 任意 | 一覧でまとめる見出し（例: `"バックエンド（エンドポイント）"`、`"フロントエンド（画面操作・初期表示）"`）。どれかのルートに書くと、書いていないルートは「その他」にまとまる。 |
| `end` | 任意 | 最後まで進んだときの終わり方（例: `"201 を返して終了"`）。ルート一覧と順路の最後に出る。 |

ガイドでの見え方:

- 表紙: ルートの一覧（通るステップを番号で並べたもの・途中の終わり・続く先）、全体図（ルートを選ぶとその流れを強調）、共通のステップ（2つ以上のルートが通るステップ）。指摘・変更箇所・ステップの一覧には「通るルート」が付く。
- コードページ: サイドバーの「ルートで読む」でルートを選ぶと、コールスタック・順路・前へ／次へが、そのルートに沿う。指摘と差分は「ガイド全体」の枠に、ルートで絞らずに全件出る。
- 解説・指摘は閉じた状態で始まり、行番号の横の番号（解説）や印（指摘）を押すと開く。サイドバーやキー操作で移ったときは開かない。

## notes（指摘と補足）

```json
{
  "type": "bug",
  "file": "backend/src/services/template.service.ts",
  "anchor": "insertTags(db, id, dto.tags)",
  "title": "タグ登録がトランザクションの外で実行される",
  "body": "根拠と影響",
  "fix": "        await this.repo.insertTags(trx, id, dto.tags)",
  "step": "s4"
}
```

| 項目 | 必須 | 内容 |
|---|---|---|
| `type` | 必須 | `explain`（解説）、`bug`（指摘（バグ））、`concern`（指摘（懸念））、`improve`（指摘（改善））。`noteTypes` で足した種類も使える。 |
| `file` / `anchor` / `anchorEnd` / `lines` / `occurrence` | 必須（anchorまで） | steps と同じ。 |
| `title` | 必須 | 1行の見出し。 |
| `body` | 必須 | 本文。 |
| `fix` | 任意 | 修正案のコード（差し替える行）。分かるときだけ書く。複数行は `\n` で区切る。 |
| `step` | 任意 | どのステップに属するか。省略すると、同じファイルで範囲を含むステップ、なければ直前のステップに割り当てる。 |

ステップの範囲内にある注釈は、その範囲の末尾にまとめて表示する。範囲の外の注釈は、対象の行の直後に表示する。

## 指摘の書き方（review が true のとき）

指摘はレビュー依頼のときだけ書く。レビュー依頼でなければ、`type` は `explain` だけにする。

### レビューする範囲

- 順路の各ステップは、アンカーの行だけでなく、そのステップを含む関数全体を読む。そこから呼んでいる入力の変換・検証や共通処理（認証、トークンの検証など）も中身を読む。
- 差分が対象なら、順路に乗らない変更箇所もすべて読む（下準備メモの「変更を含む関数」を全部確かめる）。
- 差分の外にある既存の問題も、読んだ範囲にあれば指摘する。その場合は本文で「今回の差分ではなく既存のコード」と分かるように書く。

### 確かめる観点

読んだ範囲ごとに、次の観点を全部確かめる。

| 観点 | 確かめること |
|---|---|
| 入力 | 型・必須・形式・長さ・件数を確かめているか。想定外の値（null、空、配列でない、極端に大きい）でどうなるか |
| エラー処理 | 例外がどこへ伝わり、利用者に何が返るか。握りつぶし、async の例外の取りこぼし、状態コードの誤り |
| 境界と状態 | 0件・1件・重複・存在しないid・同時実行・再実行 |
| データの整合性 | トランザクションの範囲、途中で失敗したときに残るもの、外部キー・一意制約・NOT NULL |
| 認証・認可 | 誰が実行できるか。他人のデータを読めたり変えられたりしないか |
| セキュリティ | インジェクション、秘密情報や内部情報の漏えい、検証の抜け道 |
| 性能 | N+1、全件取得、ループの中のI/O、上限の無い処理 |
| 運用 | ログ、コードの外の前提（DBの種類、環境変数、本番の設定） |
| 保守性 | 命名、重複、責務の分け方、テストのしやすさ |

### 種類と書き方

| 種類 | 書く条件 | 本文に書くこと |
|---|---|---|
| 指摘（バグ） | 特定の入力や状態で、誤った結果・例外・データの不整合になることを、コードから示せる | どの入力・状態で、何が起き、どう困るか |
| 指摘（懸念） | 条件によっては問題になる。または、安全だとコードから確かめられない（答えがコードの外にある: DBの種類、本番の設定、外部サービスの挙動、呼び出し側の前提など） | どの条件で問題になるか、何を確かめれば解消するか |
| 指摘（改善） | 動作は正しいが、読みやすさ・保守性・性能を良くできる | 何をどう変えると、何が良くなるか |

- 件数の目安は無い。見つけたものは全部書く。小さな改善（命名・重複など）も省かない。
- 1件に問題を1つだけ書く。同じ種類の問題が複数の場所にあれば、場所ごとに1件ずつ書き、本文でほかの場所にもあることに触れる。
- バグと言い切れないものはバグにせず、懸念にする。
- 安全だとコードから確かめられないものは、`unverified` ではなく懸念として書く。`unverified` には、指摘にならない読解上の不明点（どこから呼ばれるか、型の宣言がどこにあるかなど）を書く。
- 観点を全部確かめても問題が見つからなければ、指摘は書かない。表紙に「指摘はない」と出る。

## 解説の書き方

- そのステップが何をして、次にどこへ進むかを書く。コードを1行ずつ言い換えない。
- 差分を含むステップでは、何が変わり、それで動きがどう変わるかを書く。
- 呼び出し関係は、名前の一致（下準備メモの呼び出し候補）だけで決めない。コードで確かめる。DI・動的な呼び出し・イベント経由などで静的に追えない箇所は、推測でつながずに `unverified` に書く。
- 常体（だ・である）で書き、主語と対象を具体的に書く。「適切に」「いい感じに」のような曖昧な言葉を使わない。

## flow（全体図）

既定では、steps の `parent` と `branches` から全体図を自動で作る。`branches` の `to` で入るステップは分岐からの矢印、それ以外は `parent` からの矢印でつなぐ。呼び出し元が複数あるステップは1つだけ描き、それぞれの呼び出し元から矢印でつなぐ。`callerUnknown` のステップと、そこからしかたどれないステップは、区切り線の下の「呼び出し元が未確認」の区画に置く。ルートが複数あるときは、表紙でルートを選ぶと、そのルートの流れを強調し、続く先のルートを半分、ほかを薄く表示する。

DBテーブルや外部サービスを足すときは `nodes` と `edges` を書く。

```json
"flow": {
  "nodes": [
    { "id": "t1", "kind": "db", "label": "template_summaries" },
    { "id": "api", "kind": "external", "label": "決済API", "sub": "POST /charges" }
  ],
  "edges": [
    { "from": "s5", "to": "t1" },
    { "from": "s6", "to": "api", "label": "失敗時は再試行" }
  ]
}
```

- `kind` は `db`、`external`、`result`（処理の終わり）、`other`。
- `edges` の `from` / `to` には、ステップの `id` かノードの `id` を書く。
- 自動の全体図を使わず全部書く場合は `"auto": false` にする。

## noteTypes（種類を足す）

```json
"noteTypes": {
  "question": { "label": "指摘（質問）", "short": "質問", "color": "#c586c0", "shape": "square" }
}
```

- 名前は英小文字・数字・`-`。
- `shape` は `square`、`circle`、`triangle`、`diamond`。
- `finding` を `false` にすると、指摘の一覧には出ない補足の種類になる（既定は `true`）。
- 既定の種類（`explain`、`bug`、`concern`、`improve`）も、同じ書き方で表示名や色を変えられる。

## 例

レビュー依頼の例。指摘の件数は、コードを読んで見つかった数で決まる（この例は15件）。

```json
{
  "title": "POST /templates の処理フロー",
  "request": "タグ登録を追加した差分をレビューしたい。POST /templates から DB 登録までの流れを追い、問題があれば指摘して",
  "diff": "HEAD~1..HEAD",
  "review": true,
  "summary": [
    "リクエストは `auth` ミドルウェアで認証され、失敗すると 401 を返して終わる。",
    "成功すると Controller → Service → Repository の順に呼ばれ、`template_summaries` に本体を登録する。",
    "今回の差分で、`tags` があるときだけ `template_summary_tags` にも登録するようになった。ただし、タグ登録がトランザクションの外で実行されるバグがある。",
    "既存のコードにも、どんなトークンでも認証が通る、async の例外が Express に渡らない、などのバグがある。"
  ],
  "steps": [
    { "id": "s1", "file": "backend/src/routes/templates.ts", "anchor": "router.post('/templates'", "kind": "entry",
      "title": "POST /templates", "summary": "ルート定義。auth を通ってから Controller へ進む",
      "body": "`POST /templates` の入口。先に `auth` ミドルウェアを通り、通過したときだけ `controller.create` が呼ばれる。" },
    { "id": "s2", "file": "backend/src/middlewares/auth.ts", "anchor": "if (!token) {", "anchorEnd": "invalid token", "kind": "branch", "parent": "s1",
      "title": "auth（認証）", "summary": "認証できないと 401 を返して終了",
      "body": "ここで処理が分かれる。トークンが無いか検証に失敗すると 401 を返して終わり、以降の処理は実行されない。",
      "branches": [
        { "when": "Authorization ヘッダーが無い", "then": "401 unauthorized を返して終了" },
        { "when": "トークンの検証に失敗", "then": "401 invalid token を返して終了" },
        { "when": "検証に成功", "then": "next() で次へ進む", "to": "s3" }
      ] },
    { "id": "s3", "file": "backend/src/controllers/template.controller.ts", "anchor": "this.service.create(dto, req.user.id)", "parent": "s1",
      "title": "TemplateController.create", "summary": "リクエスト本文を dto に変換して Service へ渡す",
      "body": "リクエスト本文を `CreateTemplateDto` に変換してサービスへ渡す。今回追加された `tags` もこの dto に入って運ばれる。成功すると 201 で `{ id }` を返す。",
      "unverified": "`req.user` の型を拡張している宣言ファイルを特定できていない。" },
    { "id": "s4", "file": "backend/src/services/template.service.ts", "anchor": "const id = await this.repo.insert", "anchorEnd": "return { id }", "parent": "s3",
      "title": "TemplateService.create", "summary": "本体を登録したあと、tags があればタグも登録する",
      "body": "本体を登録したあと、`tags` が 1 件以上あるときだけタグも登録するようになった。本体の登録はトランザクション `trx` の中で行う。" },
    { "id": "s5", "file": "backend/src/repositories/template.repository.ts", "anchor": "trx('template_summaries').insert", "kind": "data", "parent": "s4",
      "title": "TemplateRepository.insert", "summary": "template_summaries に 1 行登録し、id を返す",
      "body": "`template_summaries` に 1 行 INSERT し、採番された id を返す。この id を ④ のタグ登録で使う。このメソッドは今回変更されていない。" },
    { "id": "s6", "file": "backend/src/repositories/template.repository.ts", "anchor": "async insertTags(", "anchorEnd": "    )", "kind": "data", "parent": "s4",
      "title": "TemplateRepository.insertTags", "summary": "template_summary_tags にまとめて登録する（新規）",
      "body": "新規メソッド。`tags` の件数分の行を作り、`template_summary_tags` にまとめて INSERT する。" }
  ],
  "notes": [
    { "type": "bug", "file": "backend/src/routes/templates.ts", "anchor": "router.get('/templates/:id', controller.show)",
      "title": "`controller.show` が定義されていない",
      "body": "`TemplateController` に `show` が無いため、`router.get` に `undefined` を渡している。Express はルート登録の時点で例外を投げるので、サーバーが起動しない。11 行目の `controller.update` も同じ。今回の差分ではなく既存のコード。" },
    { "type": "bug", "file": "backend/src/routes/templates.ts", "anchor": "router.put('/templates/:id', auth, controller.update)",
      "title": "`controller.update` が定義されていない",
      "body": "9 行目と同じく、`TemplateController` に `update` が無い。9 行目を直しても、この行でサーバーの起動が失敗する。今回の差分ではなく既存のコード。" },
    { "type": "bug", "file": "backend/src/lib/token.ts", "anchor": "export function verifyToken", "step": "s2",
      "title": "どんなトークンでも id 1 のユーザーとして認証される",
      "body": "`verifyToken` は空でない文字列なら署名も期限も確かめずに `{ id: 1 }` を返す。`Authorization: Bearer x` を送るだけで、誰でも id 1 のユーザーとしてテンプレートを作成できる。今回の差分ではなく既存のコード。" },
    { "type": "concern", "file": "backend/src/middlewares/auth.ts", "anchor": "req.headers.authorization?.replace('Bearer ', '')",
      "title": "認証方式が Bearer かどうかを確かめていない",
      "body": "`replace` は `Bearer ` が無くても何もしないので、`Basic xxx` のような別方式のヘッダーも、文字列全体をトークンとして検証に回す。`verifyToken` が厳密になれば実害は無いが、意図しない形式を受け付けないことを確かめる必要がある。" },
    { "type": "bug", "file": "backend/src/controllers/template.controller.ts", "anchor": "create = async (req: Request, res: Response) => {", "anchorEnd": "res.status(201).json(created)",
      "title": "async の例外が Express に渡らず、応答が返らない",
      "body": "Express 4 は async 関数の reject を拾わない。`validateTemplate` の例外や DB エラーが起きると `next(err)` が呼ばれず、リクエストは応答の無いまま残り、Node.js 15 以降では未処理の reject でプロセスが終了する。`list` も同じ形。" },
    { "type": "improve", "file": "backend/src/controllers/template.controller.ts", "anchor": "private service = new TemplateService()",
      "title": "Service を Controller の中で作っている",
      "body": "`TemplateService` をフィールドで直接 new しているため、テストで差し替えられない。コンストラクターの引数で受け取るようにすると、Controller だけをテストできる。" },
    { "type": "bug", "file": "backend/src/dto/template.ts", "anchor": "tags: body.tags", "step": "s3",
      "title": "`tags` が配列か確かめていない",
      "body": "`tags` をそのまま dto に入れている。`\"tags\": \"abc\"` を送ると `dto.tags?.length` は 3 になり、`insertTags` の `tags.map` で TypeError になる。トランザクションは取り消されるが、利用者には 400 ではなく 500 が返る（上の async の問題があるため、実際には応答が返らない）。" },
    { "type": "concern", "file": "backend/src/dto/template.ts", "anchor": "export function validateTemplate", "step": "s3",
      "title": "長さと件数に上限が無い",
      "body": "`title` があるかしか確かめておらず、`title`・`description` の長さや `tags` の件数に上限が無い。DB の列の長さを超えると 500 になり、極端に大きい `tags` は1回の INSERT で大量の行を書き込む。列の定義と、受け付ける上限を確かめる。" },
    { "type": "concern", "file": "backend/src/services/template.service.ts", "anchor": "validateTemplate(dto)",
      "title": "入力の誤りとサーバーの障害を区別できない",
      "body": "`validateTemplate` は通常の `Error` を投げるため、エラー処理のミドルウェアでは入力の誤りとサーバーの障害を区別できない。エラー処理のミドルウェアが状態コードをどう決めているかを確かめる。" },
    { "type": "bug", "file": "backend/src/services/template.service.ts", "anchor": "insertTags(db, id, dto.tags)",
      "title": "タグ登録がトランザクションの外で実行される",
      "body": "`trx` ではなく `db` を渡しているため、タグ登録は別の接続で実行される。タグ登録が失敗しても本体の登録は取り消されない。\n\nまた、まだコミットされていない本体の行を外部キーで参照するため、DB によっては待ち状態や外部キー違反になる。",
      "fix": "        await this.repo.insertTags(trx, id, dto.tags)" },
    { "type": "concern", "file": "backend/src/repositories/template.repository.ts", "anchor": "const [id] = await trx('template_summaries').insert({",
      "title": "採番された id の取り方が DB によって違う",
      "body": "knex の `insert` の戻り値は DB によって違う。MySQL・SQLite では採番された id の配列が返るが、PostgreSQL では `.returning('id')` を付けないと id の配列が返らず、この行で id を取り出せない。本番の DB の種類を確かめる。" },
    { "type": "concern", "file": "backend/src/repositories/template.repository.ts", "anchor": "description: row.description",
      "title": "`description` が無いと NOT NULL 違反になるおそれがある",
      "body": "`description` は必須の型だが、入力では確かめていない。送られなかった場合は値が入らないまま INSERT され、列が NOT NULL で既定値も無ければ 500 になる。`template_summaries.description` の定義を確かめる。" },
    { "type": "concern", "file": "backend/src/repositories/template.repository.ts", "anchor": "tags.map(name =>",
      "title": "同じ名前のタグが重複すると作成全体が失敗する",
      "body": "`tags` の重複を除いていない。テーブルに一意制約がある場合、重複したタグを送ると INSERT 全体が失敗し、テンプレートの作成自体が 500 エラーになる。一意制約の有無を確かめる。" },
    { "type": "improve", "file": "backend/src/repositories/template.repository.ts", "anchor": "async insertTags(",
      "title": "空配列のときは何もせずに戻る",
      "body": "今は呼び出し側の `if (dto.tags?.length)` だけで空配列を防いでいる。`insertTags` 自身でも空配列なら何もせずに戻るようにしておくと、ほかの呼び出し元から使っても空の INSERT を発行しない。",
      "fix": "    if (tags.length === 0) return" },
    { "type": "improve", "file": "backend/src/repositories/template.repository.ts", "anchor": "template_summary_id: templateId, name",
      "title": "タグ名の前後の空白をそろえていない",
      "body": "`\" api\"` と `\"api\"` が別のタグとして登録される。登録前に前後の空白を取り除き、空文字を除くと、検索や集計で同じタグとして扱える。" }
  ],
  "flow": {
    "nodes": [
      { "id": "t1", "kind": "db", "label": "template_summaries" },
      { "id": "t2", "kind": "db", "label": "template_summary_tags" }
    ],
    "edges": [
      { "from": "s5", "to": "t1" },
      { "from": "s6", "to": "t2" }
    ]
  }
}
```
