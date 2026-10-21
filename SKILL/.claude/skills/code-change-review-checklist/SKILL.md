---
name: code-change-review-checklist
description: "コード変更(コミット)のフローレポート(入口から変更箇所までを入れ子の比較表で示すHTML)に、テーブルごとの「確認済み」チェックボックスと、見逃した場合の影響の大きさを表す重要度(0〜10)を重ね、重要度の高い順に確認できる別のHTMLを出力する。コード変更フローのレポートを人が1つずつ確認してレビューしたい、どのテーブルから見るべきか優先度を付けたい、レビューの見落としを防ぎたい場合に使用する。レポートと入力のreview-data.jsonがまだ無い場合も、同梱の手順で生成してから続行する(ユーザーへ確認して止まらない)。チェックリストを伴わない単なる差分の要約や、Gitの差分だけからの重要度判定には使用しない。"
---

# コード変更レビュー確認リスト

コード変更フローのレポートの各テーブル(コードの断片)に、次の2つを付けた別のHTMLを作る。レポートが無ければ、同梱の手順で作るところから行う。

- **確認済みチェックボックス**: 人が1つずつ確認したかを記録する。
- **重要度(0〜10)**: 人がそのテーブルを確認しなかった場合に、問題を見逃す影響の大きさ。高い順に確認できる。

元のレポートは変更しない。出力は元のHTMLに部品を差し込んだ別ファイルで、差し込み部分を除くと元のHTMLと一致することをスクリプトが検査する。

重要度は調査担当の判断であり、重要度が低いことは「人が見なくてよい」ことを保証しない。最終回答でもこの前提を守る。

## 前提: 入力は最初は存在しない。無ければ生成して続行する

このスキルは、次の2つを入力にする。

- `review-data.json`: レポートの元になるJSON。
- レポートHTML(テンプレート版`2026.09.13.3`)。

**最初はどちらも存在しないのが通常である。** 存在しないことを理由に、ユーザーへ「どうしますか」と尋ねたり、見つからないと報告して止まったりしない。このスキルに生成手順が同梱されている(`report-generation/`)ので、自分で作って続行する。他のスキル(`code-change-flow-report`など)がその環境に入っているかどうかは関係なく、同梱の手順を使う。

1. **対象を確定する。** ユーザーの指定に従う(例: 「直近1コミット」= `HEAD`と、その親との比較。対象リポジトリは作業ディレクトリ)。対象が指定されていない場合だけ、ユーザーへ確認する。
2. **既存の入力を探す。** 作業ディレクトリの`.agent-work/`以下の`review.json`、`review-data.json`、レポートHTML(`<meta name="code-change-flow-template-version">`を持つHTML)を探す。対象コミットと一致し、検証済みで、対象コミットより新しいものだけを再利用する。見つからない、または使えない場合は次へ進む(尋ねない)。
3. **同梱の手順で生成する。** [レポート生成手順](report-generation/PROCEDURE.md) を読み、その手順どおりに`review-data.json`とレポートHTMLを作る。
   - 作業ファイルは、対象リポジトリの作業ディレクトリ配下の`.agent-work/review-<yyyy-mm-dd>/`に置く(未追跡のファイルが増える)。`review.json`と、それが参照する証跡ファイル(`orchestration-artifacts/`など)は、**同じ場所のまま**使う(証跡のパスは`review.json`からの相対で書かれるため、別の場所へコピーすると生成に失敗する)。
   - 調査担当と検証担当のサブエージェントが必要である。利用できない場合だけ、その理由を報告して止まる。
   - コミットごとの調査と独立した検証を行うため、時間がかかる。始める前に、その旨を1行で伝える(確認ではなく通知)。
   - 初回は、同梱の生成器が依存パッケージ(HTMLの構文強調用)を`npm ci`で取得する。ネットワークが使えず失敗する場合は、その理由を報告して止まる。
4. **チェックリストの手順(下の「実行手順」)へ進む。** 入力の扱い(何を再利用した、何を生成した)は、最終回答の「入力の扱い」に書く。

### 入力が揃わない・使えない場合の扱い

入力が「あるが使えない」場合もある。次の表で決め、決めた内容を最終回答の「入力の扱い」に書く。

| 状況 | 扱い |
|---|---|
| 対象を「直近N件のコミット」と指定されたが、`review-data.json`がそれより多いコミットを含む | 指定に合うコミット分だけの入力を使う。作業ディレクトリ(例: `.agent-work/<レポート名>/<コミット>/review.json`)に、コミット単位の検証済み入力があればそれを使う。なければ同梱の手順(`report-generation/PROCEDURE.md`)で、指定のコミットだけを対象に作り直す。`list-review-units.mjs --commit`は表示を絞るだけで、`validate-risk-scores.mjs`と`build-checklist-report.mjs`は入力内の全テーブルを要求するため、絞る代わりにならない。 |
| `review-data.json`の更新日時が、コミット単位の入力(`review.json`)より古い、または内容が食い違う | 新しく検証済みの方を入力にし、古い方は変更しない。食い違いの内容(ステップ数など)を最終回答に書く。 |
| レポートHTMLがない | 入力にする`review.json`から、同梱の`report-generation/scripts/generate-report.sh`で生成する(`bash <skill-root>/report-generation/scripts/generate-report.sh <review.json> <出力するHTML>`)。**入力は元の場所のまま**渡す(`orchestration`の証跡ファイルのパスが、入力ファイルからの相対パスで書かれているため。scratchpadなどへコピーすると`cannot read evidence artifact`で失敗する)。出力先だけ別の場所にする。 |
| 生成スクリプトが`orchestration`の欠落などで失敗する | 証跡や`orchestration`を補って作らない。作業ディレクトリに完全な入力がないか探し、なければ同梱の手順(`report-generation/PROCEDURE.md`)で調査と検証からやり直す。 |
| 元のHTMLのテンプレート版が`2026.09.13.3`以外 | 停止する。`assets/templates/`と`scripts/build-checklist-report.mjs`の差し込み位置を確認してから対応版を追加する。 |

作業用のファイルは、対象リポジトリの作業ディレクトリ配下(例: 入力と同じ`.agent-work/…/out/`)かscratchpadに置く。Windowsでは、Git Bashの`/tmp`をNodeが読めない(`C:\tmp`を探す)ため使わない。

## 必ず読む資料

- 入力(`review-data.json`とレポートHTML)が無い場合は、生成の前に [レポート生成手順](report-generation/PROCEDURE.md) と、そこから指示される`report-generation/references/`の資料を読む。
- 採点の前に [重要度の付け方](references/risk-scoring.md) を読む。
- 採点を書く前に [採点パターン集](references/scoring-patterns.md) を読む。点数・category・reason・checkPointsの型があり、`assets/example/`に検証を通る全パターンの見本がある。
- 最終回答は [最終回答の雛形](assets/final-answer.template.md) に沿って書く。

## 部品(テンプレート)

出力HTMLに差し込む部品は、スクリプトに埋め込まず`assets/templates/`に置いている。出力の見た目や文言を変える時は、スクリプトではなくここを直す。

| ファイル | 内容 |
|---|---|
| `style.css` | 差し込むスタイル |
| `script.js` | チェックの保存、進捗、ジャンプなどの動作 |
| `bar.html` | 各テーブルの直前に入るバー(確認済み、点数、帯、category、reason、確認すること) |
| `points.html` / `point-item.html` | バーの「確認すること」の一覧(checkPointsが空なら出さない) |
| `panel.html` / `queue-item.html` | 上部のパネル(進捗、未確認件数、優先度順の一覧) |

書式は`{{name}}`(エスケープして埋め込む)と`{{{name}}}`(生のHTML)。`*.html`は行頭・行末の空白と改行を除いて1行にするため、1つのタグの属性は同じ行に書く。描画の関数は`scripts/checklist-render.mjs`にあり、本番の生成と見本の生成が同じ関数を使う。

**見本は2種類ある。役割が違うので混同しない。**

| 見本 | 何が分かるか |
|---|---|
| `assets/example/full-report/report.checklist.html` | **レポート全体の完成形。** 入れ子の流れ、接続線、独立フロー、解説(概説・変更理由・処理仕様・備考)、変更前後の比較と差分色、コミットタブを含むレポートに、チェックリストを重ねたもの。元のレポートの文脈がどう残るかの基準。同じフォルダに、土台のレポート`report.html`、入力`review-data.json`、採点`risk-scores.json`がそろっている。 |
| `assets/template-catalog.html` | **部品(バーとパネル)だけの一覧。** 全パターン(0〜10点、4つの帯、確認点0〜3件、確認済みの状態、特殊文字のエスケープ)を並べる。レポート本体の文脈は含まない。 |

`verify-templates.mjs`は、完成形を本番と同じ`build-checklist-report.mjs`で作り直し、元のレポートの構造(コミット、フローの入れ子と接続線、解説、変更前後の比較、差分色)が1つも失われていないことと、全テーブルにバーが付くことを検査する。元のレポートの構造を変える変更(スクリプトやテンプレートの修正)は、この検査で止まる。

`full-report/`は、このスキルの中で完結する固定の見本である。ビルドと検査(`verify-templates.mjs`)は、このフォルダの`report.html`、`review-data.json`、`risk-scores.json`だけを使い、他のスキルやリポジトリのファイルを読まない。`report.html`は元のレポートのテンプレート版`2026.09.13.3`のスナップショットで、版が上がった場合は、新しい版のレポートに差し替えて採点を合わせ、`--write-catalog`で再生成する。

部品や見本を直したら、次で再生成して検査する。

```bash
node <skill-root>/scripts/verify-templates.mjs --write-catalog
node <skill-root>/scripts/verify-templates.mjs
```

## 実行手順

1. 入力を用意する(上の「前提」)。既存の入力を再利用するか、同梱の手順で生成する。そのうえで、`review-data.json`と元のHTMLのパス、出力先(元のHTMLとは別のファイル名。既定は`<元のHTML名>.checklist.html`)、作業用のディレクトリ(`risk-scores.json`を置く場所。生成した場合は入力と同じ`.agent-work/review-<yyyy-mm-dd>/`)を決める。
2. 採点の雛形を作る。全テーブルを1件ずつ含み、`score`などが空になる。

```bash
node <skill-root>/scripts/list-review-units.mjs <review-data.json> --skeleton <risk-scores.json>
```

3. 採点対象を確認する。標準出力に、各テーブルの位置、変更の有無、備考の指摘分類、呼び出し元の数が出る。説明とコードも見る場合は`--with-code`を付ける。コミットを絞る場合は`--commit <hash>`を付ける。

```bash
node <skill-root>/scripts/list-review-units.mjs <review-data.json> --with-code
```

4. `risk-scores.json`の各テーブルへ、`score`(0〜10の整数)、`category`、`reason`、`checkPoints`を書く。基準は`risk-scoring.md`に従い、書き方は`scoring-patterns.md`と`assets/example/risk-scores.example.json`の型に合わせる。変更のあるテーブルは、変更前後のコード、`reason`(変更理由)、備考の`[バグ]`・`[懸念点]`・`[考慮漏れ]`、`callerCount`を根拠にする。変更のないテーブルは、変更箇所の理解に必要な文脈として低い点数にする。テーブルが多い(30件を超える)場合に限り、コミット単位で採点を並列化してよい。その場合も全員が`risk-scoring.md`を読み、統合後に点数の分布を見直す。
5. 採点を検証する。欠落、重複、範囲外、基準との不整合があれば、原因を直して再実行する。

```bash
node <skill-root>/scripts/validate-risk-scores.mjs --self-test
node <skill-root>/scripts/validate-risk-scores.mjs <review-data.json> <risk-scores.json>
```

6. 部品を検査してから、チェックリスト付きHTMLを生成する。

```bash
node <skill-root>/scripts/verify-templates.mjs
node <skill-root>/scripts/build-checklist-report.mjs <review-data.json> <risk-scores.json> <元のHTML> <出力するHTML>
```

7. 出力に`Template verification passed`と`Checklist verification passed`が表示されたことを確認する。表示されない場合は完成扱いにしない。
8. 出力したHTMLをブラウザで直接開き、上部のパネルに全テーブルが点数の高い順に並ぶこと、各テーブルの上に点数とチェックボックスがあること、チェックで進捗が変わることを確認する。確認のためにサーバーを起動しない。ブラウザで開けない場合(パスに全角文字を含む、ブラウザの制限など)は、確認していないことを最終回答に書き、ユーザーへ開いて確認するよう頼む。見た目の見本は`assets/template-catalog.html`で代替できるが、実際の出力の確認にはならない。
9. 最終回答は [最終回答の雛形](assets/final-answer.template.md) に沿って書く。雛形の必須の節(出力先、結果、検証、注意)を省かない。入力を差し替えた・絞った・作り直した場合は「入力の扱い」を書く。

## 完了条件

- 入力を生成した場合は、`report-generation/PROCEDURE.md`の完了条件を満たしている(`generate-report.sh`が出力する全検査のメッセージ、独立した検証担当による検証を含む)。
- 元のHTMLを変更していない(出力先が別ファイルである)。
- 全テーブルに、0〜10の整数の点数、`category`、`reason`がある。3以上のテーブルには`checkPoints`がある。
- 検証スクリプトが`Risk score self-test passed`と`Risk score validation passed`を出力している。
- `verify-templates.mjs`が`Template verification passed`を出力している(部品、見本、カタログが整合している)。
- 生成スクリプトが`Checklist verification passed`を出力し、テーブル数が元のレポートと一致している。
- 出力が外部ファイルやサーバーを必要としない単体のHTMLである。
- サーバープロセスを起動しておらず、ポートを待ち受けていない。

## 制約

- 対象リポジトリのソースコード、Git履歴、リモートを変更しない。作業ファイルは`.agent-work/`(未追跡)にだけ作る。
- 入力が存在しないことを理由に、ユーザーへ確認して止まらない。止まってよいのは、対象が指定されていない、サブエージェントが使えない、生成に必要な依存を取得できない、の場合だけである(理由を報告する)。
- `report-generation/`の本文は上流の手順と同じに保つ。手順の改善が必要な場合は、そこを直さず、ユーザーへ提案する。
- 元のレポートHTMLと`review-data.json`を編集しない。
- 点数をブラウザ上で再計算しない。点数は`risk-scores.json`だけが正本である。
- 確認済みの状態は、そのブラウザの`localStorage`にだけ保存される。別の端末や別のブラウザへは共有されない。この点をユーザーへ尋ねられたときに説明する。
- 元のレポートのテンプレート版が`2026.09.13.3`以外の場合、スクリプトは停止する。テンプレートが更新された場合は、`scripts/build-checklist-report.mjs`の対応版と差し込み位置、`assets/templates/`のクラス名やCSS変数(元のレポートの`:root`に依存する)を確認してから更新する。
- 出力の見た目や文言を変える時は、`assets/templates/`を直し、`verify-templates.mjs --write-catalog`でカタログを再生成する。スクリプト内へHTMLやCSSを直接書き足さない。
