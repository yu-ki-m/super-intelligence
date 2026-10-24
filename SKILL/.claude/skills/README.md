# スキル一覧

このディレクトリに収録している20種類のスキルについて、用途・主な成果物・依頼例をまとめています。詳細な実行手順、入力条件、検証方法は、各リンク先の `SKILL.md` を参照してください。

## 一覧

| 分類 | スキル | 主な用途 | 主な成果物 |
| --- | --- | --- | --- |
| 企画・要求分析 | [planning-requirements-dialogue](planning-requirements-dialogue/SKILL.md) | 目的・範囲・成功条件が曖昧な依頼を、相談者と1問ずつ対話して目的・成果仮説・代替案・確認事項へ詰める。1問ごとにファイルへ記録するので、依頼者との打合せをはさんでも続きから再開できる | 依頼者向け提案書・分析・対話記録のMarkdown |
| 企画の壁打ち | [planning-thinking-partner](planning-thinking-partner/SKILL.md) | 企画・施策・企画寄りのUX設計・曖昧な依頼の受け止め方を、質問攻めや決断の強要なしに一緒に考える。Claude が先に見立て・仮置き・別の見方を出し、根拠から推奨までの論理を一緒に組み立て、分かれ道は決め手つきで地図に残す。思考ノートから続きを再開できる | 思考ノート（考えの地図・分岐点・仮置き・アイデア・やりとりの記録）のMarkdown |
| シナリオ・バックログ | [scenario-to-backlog](scenario-to-backlog/SKILL.md) | 想定シナリオを、洗い出し→物語→体験の流れ→ユースケース→ストーリーマップ→ストーリーバックログの順に一緒に細かくする。段の間で漏れと根拠のないストーリーを両方向に点検し、各ストーリーに由来と受入条件を付ける。壁打ちの思考ノートを入力にでき、続きから再開できる | シナリオごとのファイル（物語・体験の流れ・ユースケース）、ストーリーマップ、ストーリーバックログのMarkdown（求めに応じてCSV） |
| 着手前検討 | [pre-task-dialogue](pre-task-dialogue/SKILL.md) | タスク着手前に対話と読み取り調査で目的・影響範囲・成立条件・代替案・リスクを検討する | 根拠付き実施事項一覧、依存関係、リスク・未確定事項、着手可否 |
| 要件・仕様分析 | [analyze-requirements-and-specs](analyze-requirements-and-specs/SKILL.md) | 既存機能の改善・拡張や新機能追加に向け、現行仕様の目的と影響を調べて要件・仕様へ整理する | 要件・仕様一覧のMarkdown／HTML、検証用JSON |
| 業務・システム設計 | [business-model-to-system-spec](business-model-to-system-spec/SKILL.md) | 現状業務を分析し、将来の業務モデルを比較して実装可能なシステム仕様を作る | AS-IS分析、TO-BE比較、システム仕様、根拠・追跡用台帳 |
| 業務モデル設計 | [system-driven-business-model](system-driven-business-model/SKILL.md) | 既存システムの実装能力を起点に、KPI・責任分界・業務プロセスを設計する | 能力マップ、業務モデル、KPI、運用・検証資料 |
| 市場・成長戦略 | [category-creation-growth-marketing](category-creation-growth-marketing/SKILL.md) | 未開拓領域の探索から市場定義、製品の普及、成長、競争への備えまで検討する | 戦略分析のMarkdown、図解付きHTMLレポート |
| SaaS事業レビュー | [saas-business-owner-accountability-review](saas-business-owner-accountability-review/.claude/skills/saas-business-owner-accountability-review/SKILL.md) | 事業計画・KPI・意思決定に残る説明不足や矛盾を経営視点で検出する | 重要論点、確認質問、必要な証拠、判断事項 |
| AWS構成設計 | [aws-architecture-pattern-svg](aws-architecture-pattern-svg/SKILL.md) | AWSサービス間の経路や境界を明示した構成パターンを図解する | 編集可能なSVG構成図、技術解説 |
| 画面モックアップ | [capture-screen-mockup](capture-screen-mockup/SKILL.md) | 操作中の既存Web画面を単一HTMLへ保存し、UI変更や注釈を加えた画面案を作る | 原本・画面案・注釈付きのHTML／PNG、変更記録JSON |
| コード閲覧・読解 | [codebase-guide](codebase-guide/SKILL.md) | リポジトリをHTML化し、必要に応じて読む順番や処理フローの解説を付ける | コード閲覧HTML、定義リンク、読解・レビューガイド |
| コード閲覧 | [repository-html-browser](repository-html-browser/SKILL.md) | リポジトリをディレクトリ構造ごと静的HTMLへ変換する | フォルダーツリーと各ファイルの閲覧HTML |
| シーケンス図 | [sequence-diagram](sequence-diagram/SKILL.md) | ソースコード・設計書・処理仕様から、メソッド単位のライフラインで処理を追跡したシーケンス図を作る。条件分岐・繰り返し・例外・トランザクション・排他ロック・非同期・DBアクセスを表し、根拠のソース行を付けて確認済みと推定を区別する | クリックで引数・戻り値・SQL・根拠を確認できる単一ファイルのHTMLビューア、処理モデルJSON、検証レポート |
| 変更影響分析 | [diff-decision-trees](diff-decision-trees/SKILL.md) | Git差分から変更前後の条件と最終結果を調べ、判定決定木にする | 日本語HTML、調査モデル、テストケース |
| 設計・実装レビュー | [design-impl-review](design-impl-review/SKILL.md) | 設計書と実装コードを突き合わせ、要求違反・設計の矛盾・未定義の振る舞い・影響漏れ・実装の誤りを根拠付きで洗い出す。中断しても途中から再開できる | 要件一覧・要件ごとの指摘のHTML（事象・原因・修正案・再現手順・根拠） |
| コードレビュー | [code-change-review-checklist](code-change-review-checklist/SKILL.md) | コード変更フローを重要度順に確認し、レビューの進捗を記録する | フローレポート、確認済みチェック・重要度付きHTML |
| 汎用HTML出力 | [universal-html-output](universal-html-output/SKILL.md) | 文章・コード・差分・データなどを目的に合うHTMLにまとめる | HTML成果物、生成用JSON |
| スキル設計・可視化 | [flowts-skill-designer](flowts-skill-designer/SKILL.md) | スキル（SKILL.md）の手順をFlowTSで書き、分岐・繰り返し・担当を図にして、スキルの可視化・作成・改善と手順の抜けの検出を行う | `.flow.ts`、フロー図のHTML、検査結果（Findings） |
| コーチング | [trust-coach](trust-coach/SKILL.md) | 難しい会話や報告、失敗後の信頼回復を、状況把握から壁打ち・ロールプレイ・振り返りで練習する | 状況整理、推奨方針と行動計画、言い方の例、反応別の次の一手 |
