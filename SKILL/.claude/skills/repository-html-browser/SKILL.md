---
name: repository-html-browser
description: リポジトリ全体を探索し、各ファイルをVS Code風の閲覧用HTMLへ変換して html-code/ に出力する。ディレクトリ構造を保持し、フォルダーツリー.html から全ファイルへ移動できるようにする。
---

# Repository HTML Browser

## 目的

リポジトリの内容をブラウザだけで読める静的HTMLへ変換する。
AIが1ファイルずつ本文を読み込んでHTMLを書かない。ファイル列挙、読み込み、HTMLエスケープ、ページ生成、リンク生成は `scripts/generate-html-code.mjs` に任せる。

## 出力仕様

リポジトリルートに `html-code/` を生成する。

例:

```text
repository/
├─ src/
│  ├─ index.ts
│  └─ app/service.ts
└─ html-code/
   ├─ フォルダーツリー.html
   └─ src/
      ├─ index.ts.html
      └─ app/
         └─ service.ts.html
```

必須条件:

1. 元ファイルの相対ディレクトリ構造を `html-code/` 配下に保持する。
2. 元ファイル名の末尾に `.html` を追加する。`index.ts` は `index.ts.html` とする。
3. `フォルダーツリー.html` はリポジトリ全体の階層を表示し、各ファイル名を対応する変換HTMLへのリンクにする。
4. 各コードページはVS Code風のダークUIとし、次を表示する。
   - ファイル名
   - リポジトリルートからの相対パス
   - 行番号
   - コード本文
   - シンタックスハイライト（キーワード、文字列、数値、コメント、関数名等）
   - 左側のExplorer風ツリー
5. Explorerのファイルリンクから別ファイルへ移動できるようにする。
6. シンタックスハイライトは生成時にHTMLへ埋め込み、ブラウザ表示時に外部CDNやnpmパッケージを必要としない。TypeScript/JavaScript、Java/Kotlin、Python、Go、Rust、C/C++/C#、Shell、SQL、JSON、YAML/TOML/INI/Properties、HTML/XML、CSS系、Markdown、GraphQLを少なくとも識別する。
7. `.git/` と生成先 `html-code/` 自身は必ず変換対象から除外する。
8. Gitリポジトリでは、原則として `git ls-files -co --exclude-standard` を利用し、`.gitignore` 等でignoreされたファイルを変換しない。
9. `.gitignore` に書かれていなくても、依存ライブラリ、ビルド成果物、キャッシュ、テスト出力、ローカル状態など、一般にソースコード閲覧対象ではないものをデフォルト除外する。
10. デフォルト除外の代表例は次の通り。
   - 依存: `node_modules/`, `vendor/`, `.venv/`, `venv/`, `env/`, `__pypackages__/`
   - ビルド: `dist/`, `build/`, `out/`, `target/`, `bin/`, `obj/`, `.next/`, `.nuxt/`, `.output/`, `.svelte-kit/`, `.astro/`
   - キャッシュ: `.cache/`, `.parcel-cache/`, `.turbo/`, `.nx/`, `.vite/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `__pycache__/`, `.gradle/`, `.m2/`
   - テスト出力: `coverage/`, `htmlcov/`, `test-results/`, `playwright-report/`, `allure-results/`, `allure-report/`
   - IaC/ローカル状態: `.terraform/`, `.serverless/`, `.aws-sam/`, `cdk.out/`, `terraform.tfstate*`
   - IDE/AIツール: `.vscode/`, `.idea/`, `.vs/`, `.cursor/`, `.continue/`, `.codex/`, `.claude/cache/`
   - その他生成物: `generated/`, `gen/`, `docs/generated/`, `storybook-static/`, `.docusaurus/`, `site/`, `.npm/`, `.pnpm-store/`, `.yarn/cache/`, `.yarn/unplugged/`, `tmp/`, `temp/`, `logs/`
   - ファイル: lockファイル、source map、minified JS/CSS、コンパイル済みバイナリ、アーカイブ、画像・動画・フォント等
11. デフォルト除外を意図的に含めたい場合は `--include-dir <ディレクトリ名>` または `--include-file <ファイル名または相対パス>` を利用する。これらは複数回指定できる。`.git/` と `html-code/` は例外指定でも含めない。
12. ignore済みファイルまで列挙する必要がある場合だけ `--include-ignored` を使う。ただし固定のデフォルト除外は引き続き適用する。
13. Gitが利用できない場合はファイルシステム走査へフォールバックする。この場合も固定のデフォルト除外を適用する。
14. デフォルト除外されていないバイナリファイルが存在した場合は、ツリーから消さず、バイナリ用HTMLページを作り「バイナリのため本文表示対象外」と表示する。
15. シンボリックリンクはリンク先を展開せず、シンボリックリンクとしてページを生成する。

## 実行手順

リポジトリルートを現在ディレクトリにして次を実行する。

```bash
node .claude/skills/repository-html-browser/scripts/generate-html-code.mjs
```

このスキル自体が別の場所にある場合は、スクリプトの絶対パスを使い、対象リポジトリを `--root` で渡す。

```bash
node /path/to/generate-html-code.mjs --root /path/to/repository
```

必要に応じて並列数を指定する。

```bash
node .claude/skills/repository-html-browser/scripts/generate-html-code.mjs --concurrency 32
```

デフォルト除外されたものを個別に含める場合:

```bash
node .claude/skills/repository-html-browser/scripts/generate-html-code.mjs \
  --include-dir .vscode \
  --include-file package-lock.json
```

`.gitignore` 等でignoreされたファイルも確認対象にする場合:

```bash
node .claude/skills/repository-html-browser/scripts/generate-html-code.mjs --include-ignored
```

## Claude Codeが行うこと

1. 対象リポジトリのルートを確定する。
2. スクリプトを実行する。
3. スクリプト終了コードが0であることを確認する。
4. `html-code/フォルダーツリー.html` が存在することを確認する。
5. スクリプトが出力した件数サマリを確認する。
6. 列挙された対象ファイル数と生成HTML数が一致していることを確認する。
7. 代表として最低3件を検証する。
   - ルート直下のファイル
   - 2階層以上深いファイル
   - 日本語または空白などURLエンコードが必要な名前を含むファイル（存在する場合）
8. 欠落がある場合、AIが手作業でHTMLを補完せず、原因を特定してスクリプトを修正して再生成する。

## 禁止事項

- Claudeが各ソースファイル本文を順番に読み、HTMLを1件ずつ手書きしない。
- `find` の結果をそのまま大量にプロンプトへ読み込まない。
- `.git/` 内部オブジェクトを変換しない。
- `html-code/` を再帰的に変換しない。
- ソースコードとして通常確認すべきファイルを安易な拡張子判定だけで除外しない。
- デフォルト除外一覧を変更する場合は、依存物・生成物・キャッシュ等である根拠を持つ。
- デフォルト除外対象ではないバイナリファイルを「存在しなかったこと」にしない。

## 完了条件

次のすべてを満たした場合のみ完了とする。

- `html-code/` がリポジトリルート直下に存在する。
- `html-code/フォルダーツリー.html` が存在する。
- 対象となった全ファイルに対応する `.html` が存在する。
- 出力側の相対ディレクトリ構造が元リポジトリと一致する。
- `フォルダーツリー.html` の全ファイルリンクが対応ページを指す。
- 対応言語のコードページでシンタックスハイライト用のトークンクラスが生成される。
- 生成処理がエラー0件で終了している。
