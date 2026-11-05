# product-branding-team

複数のAIサブエージェントが、プロダクトブランディングに必要な調査、戦略立案、制作、検証設計を分担し、成果物について評価・反論・再反論して修正するチームの実行系である。スキル（`SKILL.md`）が入口で、ハーネス（`pbteam.py`）が実際にサブエージェントを起動する。作るのは「ブランドの仮説」であり、需要や差別化の検証結果ではない。

## 前提条件

| 項目 | 内容 |
| --- | --- |
| Python | 3.10 以上。標準ライブラリだけで動く。追加の導入は要らない |
| Claude Code | `claude` コマンドにログイン済みであること。API キーは不要である。2.1.318 で確認した |
| 外部サービス | なし。公開情報の調査を許す場合だけ `--allow-web` を付ける |

実接続を確かめるには、次を実行する。約1分で終わり、小さなモデルの呼び出しが2回発生する。

```bash
python pbteam.py probe --model haiku --workdir .pbteam-probe
```

`debate_possible` が `true` なら、起動、再開、結果の取得、発言の受け渡しが確認できている。`false` なら実討論は実施できない。設計資料の作成に留まることを依頼者へ伝える。

## 実行の方法

最初の依頼は Claude Code に次のように伝える。スキルが資料の確認から案内する。

> ヒキツギ帳という社内受付向けの製品について、試験提供が終わったので、誰に何を約束して提供を始めるかを考えたい。資料は docs/ にある。紹介ページの草案と30日の検証計画まで作ってほしい。

コマンドで直接実行する場合は、`brief.json`（例：`evals/fixtures/hikitsugi/brief.json`、形式：`schemas/brief.schema.json`）を用意する。

```bash
# 実行を作る。呼び出し数の上限の目安が表示される
python pbteam.py init --brief brief.json --graph minimal --run-dir .product-branding-team/hikitsugi --concurrency 1 --model sonnet

# 実行する。時間がかかるのでバックグラウンドで実行するとよい
python pbteam.py run --run-dir .product-branding-team/hikitsugi
```

`minimal` の実行は、sonnet で26〜73回の呼び出し、17〜51分、API 定価換算で約4〜15ドルだった（記録は `evals/results/README.md`）。差し戻しが多いほど増える。`standard` は依頼範囲によって大きく変わる。先に `python pbteam.py check-graph standard` で上限の目安を確かめ、`--max-calls` で上限を決める。

## 確認・再開・停止

```bash
python pbteam.py status --run-dir <run>     # 現在地、次の作業、保留、失敗、未回答の批判
python pbteam.py run --run-dir <run>        # 続きから再開する。完了した作業は再実行しない
python pbteam.py stop --run-dir <run>       # 実行中の呼び出しが終わったら一時停止する
python pbteam.py abort --run-dir <run>      # 中止する
python pbteam.py update-source --run-dir <run> --source S1 --file 新しい資料.md   # 資料を更新する
python pbteam.py log-human --run-dir <run> --minutes 30 --activity "内容の確認"   # 人間の介入時間を記録する
python pbteam.py export --run-dir <run>     # 提出物を <run>/output/ へ書き出す
```

実行が止まった場合（PC の停止、利用上限、セッション切れ）は、同じ `run` で再開する。利用上限で止まった場合は、解除されてから再開する。

## 結果の確認

`<run>/output/` の `summary.md` から読む。主なファイルは `SKILL.md` の表にある。実行フォルダーの中身は次のとおりである。

| 場所 | 内容 |
| --- | --- |
| `state.db` | 実行状態の正本（SQLite） |
| `artifacts/<成果物ID>/v<版>.md` | 成果物の全版 |
| `sources/<資料ID>/v<版>.md` | 資料の全版 |
| `prompts/<試行ID>.md` | 各試行に渡した依頼文 |
| `raw/<試行ID>.json` | 実行基盤の応答そのもの |
| `views/<インスタンスID>/` | インスタンスごとの作業フォルダー。そのインスタンスに渡した資料だけがある |
| `late_results/` | 遅れて届いた古い試行の結果 |

## 試験と評価

```bash
# 状態制御の試験。模擬実装なので呼び出しは発生しない。約1分
cd tests && python -W ignore::ResourceWarning -m unittest discover -s . -p "test_*.py"

# 実エージェントの評価。止まっても同じコマンドで続きから進む
python evals/run_e2e.py --name e2e_real_2 --model sonnet       # 調査から提出まで、差し込み、中断、更新を含む
python evals/run_quality_eval.py --name quality_real_1         # 不良成果物の拒否と良質な成果物の通過
python evals/run_crossdoc_eval.py --name crossdoc_real_1       # 資料横断の検査
python evals/run_compare.py --name compare_real_1              # 単一担当、一度だけの分担、本方式の比較
```

実行した評価の結果、実行条件、費用、失敗、未実施は `evals/results/README.md` にある。

## ファイルの構成

| 場所 | 内容 |
| --- | --- |
| `SKILL.md` | 起動条件、入力整理、起動、討論の進行、終了・再開、成果物 |
| `architecture.md` | 責任の分担と技術選択の理由 |
| `references/` | 説明方針とブランド検討項目、50役割、編成、討論、稼働の評価 |
| `templates/` | 記録と提出物の形式 |
| `examples/` | 架空の討論例と実行例 |
| `graphs/` | 実行可能なグラフ定義と図。`build_graphs.py` と `roles.json` が正本である |
| `schemas/` | データとエージェント出力の定義 |
| `harness/` | スケジューラー、状態管理、実行権、討論、更新影響、報告 |
| `adapters/` | 実接続（`claude_cli.py`）、模擬（`mock.py`）、評価用の差し込み（`injecting.py`） |
| `validators/` | 形式検査、グラフ検査、資料横断の機械検査 |
| `quality/` | 品質契約、エージェントへの共通の指示、良い例と悪い例 |
| `tests/` | 状態遷移、再開、競合、更新影響、予算と修正上限の試験 |
| `evals/` | 動作確認のシナリオ、題材、評価の実行プログラムと結果 |

グラフや役割を変えたら `python graphs/build_graphs.py` と `python harness/gen_docs.py` を実行する。

## 保証しないこと

低品質な成果物を出さないこと、50人分を実現したこと、顧客に受け入れられることは保証しない。品質ゲートは定義した基準で検査するものであり、検査担当のAIも誤る。実際の顧客の反応は含まれない。
