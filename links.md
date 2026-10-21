# Intelligence Collections

## 1. 標準仕様・配布・導入｜Agent Skills仕様

| リンク | 解説 | その他 |
| --- | --- | --- |
| [agentskills/agentskills](https://github.com/agentskills/agentskills) ⭐ 25,900 | Agent Skillsの仕様と公式ドキュメント。`SKILL.md`、`scripts/`、`references/`、`assets/`など、Skillを構成する形式を定義する。 | |
| [Agent Skills公式サイト](https://agentskills.io/) | Agent Skillsの仕様、作成方法、対応クライアントを確認する入口。 | |

## 1. 標準仕様・配布・導入｜Agent Plugins仕様

| リンク | 解説 | その他 |
| --- | --- | --- |
| [Agent Plugins](https://agent-plugins.org/) | Agent SkillsとMCPサーバー設定を1つの配布単位へまとめる、ベンダー中立のパッケージ仕様。 | |
| [Agent Plugins Specification](https://agent-plugins.org/specification) | `plugin.json`、`skills/`、MCP設定などの構造と適合条件を定義する仕様本文。 | |

## 1. 標準仕様・配布・導入｜エージェント向け指示ファイルの仕様

| リンク | 解説 | その他 |
| --- | --- | --- |
| [AGENTS.md](https://agents.md/) | コーディングエージェントにプロジェクトの文脈と作業手順を渡すための、オープンな書式。「エージェント向けのREADME」として、ビルドやテストのコマンド、コードの書き方の決まり、セキュリティ上の注意、コミットやPRの決まりなど、人向けのREADMEには書きにくい内容をリポジトリに置く。必須の項目はなく、普通のMarkdownで書く。モノレポでは各パッケージに置け、編集するファイルに最も近いAGENTS.mdが優先される。チャットでの利用者の明示的な指示は、すべてのAGENTS.mdより優先される。Codex、Jules、Cursor、Gemini CLI、GitHub Copilotのコーディングエージェント、VS Code、Devin、Windsurfなど多くのツールが読む。 | Linux Foundation傘下のAgentic AI Foundationが管理する。リポジトリは`agentsmd/agents.md`（MIT）。6万以上のオープンソースプロジェクトで使われている。既存の指示ファイルから移すときは、名前をAGENTS.mdに変え、元の名前でシンボリックリンクを張る。 |
| [google-labs-code/design.md](https://github.com/google-labs-code/design.md) ⭐ 28,399 | デザインシステムの見た目の決まりをコーディングエージェントへ伝えるための、ファイル形式（DESIGN.md）の仕様とCLI。色、文字、角丸、余白、コンポーネントの値をYAMLのデザイントークンとして機械可読に書き、その値を使う理由や使い方をMarkdownの本文で説明する。CLIは、壊れたトークン参照、WCAGのコントラスト比、セクションの順序などを検査してJSONで返す`lint`、2つの版を比べて後退を見つける`diff`、Tailwind（v3／v4）やW3C Design Tokensの形式へ書き出す`export`を備える。 | Apache-2.0。Google Labs製。形式はalpha版で、仕様、トークンの構造、CLIは今後変わる可能性がある。検査: `npx @google/design.md lint DESIGN.md`。Windows／PowerShellでは、`design.md`というコマンド名がMarkdownのファイル関連付けと衝突して何も出力されないことがあるため、`npx -p @google/design.md designmd lint DESIGN.md`を使う。 |

## 1. 標準仕様・配布・導入｜外部ツール接続・エディタ接続の仕様

| リンク | 解説 | その他 |
| --- | --- | --- |
| [modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol) ⭐ 9,379 | MCPの仕様、スキーマ、公式ドキュメント。AIエージェントが外部サービスやツールを呼び出す接続方式を定義する。 | |
| [agentclientprotocol/agent-client-protocol](https://github.com/agentclientprotocol/agent-client-protocol) ⭐ 4,369 | Agent Client Protocol（ACP）の仕様。コードエディタとコーディングエージェントの間で、セッションや操作をやり取りする方式を定義する。 | |

## 1. 標準仕様・配布・導入｜Skillの検索・インストール

| リンク | 解説 | その他 |
| --- | --- | --- |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) ⭐ 33,099 | `npx skills`を提供するCLI。GitHub、GitLab、ローカルディレクトリなどからSkillを取得し、Claude Code、Codex、Cursorなどへ配置する。 | リポジトリ内のSkillを確認: `npx skills add <owner>/<repository> --list`。プロジェクトへ導入: `npx skills add <owner>/<repository> --skill <skill-name>`。ユーザー単位で導入: `npx skills add <owner>/<repository> --skill <skill-name> -g` |
| [skills.sh](https://skills.sh/) | 公開Agent Skillsを検索し、内容や導入コマンドを確認するカタログ。 | |

## 2. 公式・大規模カタログ

| リンク | 解説 | その他 |
| --- | --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) ⭐ 179,597 | Anthropicが公開するAgent Skillsの実装例。文書、PDF、スライド、表計算、デザイン、技術作業などのSkillとテンプレートを収録する。 | |
| [openai/plugins](https://github.com/openai/plugins) ⭐ 7,293 | OpenAIが公開するCodex向けPluginの公式例。Skillだけでなく、アプリ、MCP、エージェント、コマンド、フック、アセットをまとめた構成例を収録する。 | `openai/skills`は廃止済みであり、現在はこのリポジトリが後継。 |
| [github/awesome-copilot](https://github.com/github/awesome-copilot) ⭐ 39,683 | GitHub Copilot向けのカスタムエージェント、instructions、Skills、hooks、workflows、pluginsを集めた公式コミュニティカタログ。 | |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) ⭐ 31,910 | Vercelが公開するSkill集。React／Next.jsの性能、Webデザイン、アクセシビリティ、文書作成、Vercel運用などを対象とする。 | |
| [cloudflare/skills](https://github.com/cloudflare/skills) ⭐ 2,978 | Cloudflareが公開するSkill集。Workers、Agents SDK、Durable Objects、Sandbox、Wrangler、Cloudflare Oneなど、Cloudflare上での開発と運用を対象とする。Plugin形式で導入すると、Cloudflare APIと最新ドキュメントへアクセスするCloudflareのリモートMCPサーバーも同時に設定される。 | Apache-2.0。Claude Codeへ導入: `/plugin marketplace add cloudflare/skills`、`/plugin install cloudflare@cloudflare`。Skillだけを導入: `npx skills add https://github.com/cloudflare/skills` |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) ⭐ 35,187 | 公式チームとコミュニティが公開するAgent Skillsを分野別に探すための大規模カタログ。導入前に、Skill内のスクリプトと外部通信先を個別に確認する。 | |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) ⭐ 76,466 | Claude Skills、関連ツール、参考資料を分野別に整理したリンク集。Skill本体ではなくカタログに当たる。 | |
| [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community) ⭐ 4,465 | Anthropicの審査を通過したClaude Code／Cowork向けコミュニティプラグインのマーケットプレイス。 | 読み取り専用ミラー。プラグインの提出先は `clau.de/plugin-directory-submission`。 |

## 3. ソフトウェア開発向け｜開発工程全般

| リンク | 解説 | その他 |
| --- | --- | --- |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) ⭐ 101,034 | 要件定義、計画、実装、テスト、レビュー、リリースまでの工程と品質ゲートを、Claude CodeやCodexなどへ守らせる実務向けSkill集。 | |
| [mattpocock/skills](https://github.com/mattpocock/skills) ⭐ 275,764 | `grill-me`や`grill-with-docs`による要件の掘り下げ、用語整理、チケット運用など、開発者が制御権を維持するための小さなSkillを収録する。 | |
| [humanlayer/skills](https://github.com/humanlayer/skills) ⭐ 4,917 | Claude Code向けSkill集。図やHTMLで説明する `show-me`、CLAUDE.md改善、React型整理などを収録する。 | |

## 3. ソフトウェア開発向け｜エージェントの振る舞いの矯正

| リンク | 解説 | その他 |
| --- | --- | --- |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) ⭐ 154,338 | AIコーディングエージェントが不要な依存関係や抽象化を増やす動作を抑え、既存実装、標準ライブラリ、プラットフォーム標準機能を優先させるルールセット兼Plugin。 | |
| [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) ⭐ 216,799 | Andrej Karpathy氏の指摘を基に、AIの過剰実装や未確認の思い込みを抑えるCLAUDE.md。 | |
| [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) ⭐ 53,395 | コーディングエージェントの回答を、次の行動から始める、手順を番号化する、脱線や不要な前置き・締めを抑えるなど、ADHDに配慮した実行しやすい出力へ整えるSkill／Plugin。 | `/i-have-adhd`（Codexは`$i-have-adhd`）で明示的に有効化。 |

## 3. ソフトウェア開発向け｜コードレビュー・テスト・品質

| リンク | 解説 | その他 |
| --- | --- | --- |
| [alibaba/open-code-review](https://github.com/alibaba/open-code-review) ⭐ 43,635 | Alibaba製のAIコードレビューCLI（`ocr`）。Alibaba社内の公式AIコードレビュー支援ツールをOSS化したもの。対象ファイルの選定、関連ファイルの束ね、ルール照合、指摘位置の補正を決定的な処理で担い、LLMエージェントが行単位のレビューコメントを生成する。 | Alibaba製（Apache-2.0）。導入: `npm install -g @alibaba-group/open-code-review`。変更差分をレビュー: `ocr review` |
| [akkie76/code-review-skills](https://github.com/akkie76/code-review-skills) ⭐ 81 | 書籍『コードレビューの教科書』（技術評論社）の考え方をAIコーディングエージェント向けに独自に翻案した、Codex／Claude Code向けのコードレビューSkill。変更行の外まで挙動を追跡し、すべての指摘に具体的な発生条件と影響を求めることで、スタイルだけの指摘や根拠のない推測を抑える。各指摘には`MUST(Functionality):`のように対応の必要度と観点を付け、日本語または英語で優先順位付きの指摘を出力する。 | MIT。現在はベータ版。Skill名は`evidence-code-review`。Claude Codeへ導入: リポジトリを取得し、`cp -R dist/claude-code/evidence-code-review ~/.claude/skills/`。確実に使うときは`/evidence-code-review`で呼び出す。 |
| [devdotfast/whiteboard](https://github.com/devdotfast/whiteboard) ⭐ 2,691 | 人間とコーディングエージェントが同じキャンバス上でソフトウェアを設計・レビューするデスクトップアプリ。Claude CodeやCodexからSDK経由でシーケンス図やER図を描かせ、図やエージェントの作業記録から該当コードへ移動できる。AST解析による意味単位の差分表示と、エージェントが自律的に下した判断を追跡する決定ログを備える。 | MIT。Code - OSSをベースにしている。macOS、Windows、Linux向けのアプリを`dev.fast/install`から入手する。現時点ではアプリ内でファイルを編集できない。匿名のテレメトリーを送信する（コードやプロンプトは含まない）が、無効化できる。 |
| [tester-army/e2e](https://github.com/tester-army/e2e) ⭐ 2,554 | Webアプリとモバイルアプリ向けのE2Eテストフレームワーク。自然言語で書いた目標に沿ってエージェントがアプリを操作し、同じテスト内でロケーターとアサーションによって結果を検証する。後続のアサーションで検証されたエージェントの操作は記録され、アプリが変わるまでは次回以降モデルを呼ばずに再生する。WebはPlaywright経由でChromium、Firefox、WebKitに、モバイルはiOS／Androidのシミュレーターとエミュレーターに対応する。 | Apache-2.0。TesterArmy製。導入: `npx e2e init`。1.0前のため、マイナーリリース間でもAPIと設定が変わる可能性がある。CLIは匿名の利用状況データを送信する。無効化: `npx e2e telemetry disable` |
| [saurabhkumar8112/cyclomatic-complexity-skill](https://github.com/saurabhkumar8112/cyclomatic-complexity-skill) ⭐ 404 | 関数の循環的複雑度を計測し、ガード節や関数抽出によって複雑なコードをリファクタリングするClaude Skill。 | |

## 3. ソフトウェア開発向け｜セキュリティ

| リンク | 解説 | その他 |
| --- | --- | --- |
| [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) ⭐ 24,025 | 偵察、カバレッジ主導の脆弱性探索、候補検証、機械可読な`findings.json`、独立検証、レポート生成までを行う、多段階セキュリティ監査用Agent Skill。 | `npx skills add https://github.com/cloudflare/security-audit-skill --skill security-audit` |
| [trailofbits/skills](https://github.com/trailofbits/skills) ⭐ 7,359 | Trail of Bitsが公開するセキュリティ向けSkill／Plugin集。コード監査、差分レビュー、静的解析、Semgrep、依存関係、GitHub Actionsなどを対象とする。 | |
| [zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill) ⭐ 39,598 | リバースエンジニアリング、許可を得たペネトレーションテスト、セキュリティ研究向けのSkillルーター集。APK、実行ファイル、フロントエンドJSの暗号化処理、マルウェア、CTFなどの対象に応じて、AIコーディングエージェントを適切な手順と道具（jadx、Frida、IDA、radare2など）へ振り分ける。手元のツールの検出、許可範囲（スコープ）の確認、証拠の記録、レポート作成までの作業手順を備え、作業で得た知見を蓄積して再利用する。 | MIT（同梱の`CTF-Sandbox-Orchestrator/`はGPLv3）。利用は、自分が管理するシステムか、明示的に検査の許可を得たシステムに限られる。READMEや`README_AI.md`にAIエージェント向けの指示が含まれ、ツールを導入するスクリプトも同梱されるため、エージェントに読ませる前に内容を確認する。Java、Node.js 22.12以降、Python 3が必要。 |
| [morluto/rea](https://github.com/morluto/rea) ⭐ 299,758 | ソースコードのないアプリの機能がどう作られているかを、エージェントに調べさせるリバースエンジニアリング用のMCPサーバー兼CLI。ネイティブバイナリ、JavaScript／Electronアプリ、.NETアセンブリ、Webサイト、Android APK、ファームウェア、パケットの記録などを扱い、疑似コード、アセンブリ、モジュール間の関係、通信内容などを、根拠と分からない点を添えて返す。エージェントはその結果を使って挙動を説明し、自分のプロジェクト向けに似た機能を実装・テストする。解析は手元で行う（結果はエージェントを通じてモデルの提供元へ渡る）。 | MIT。導入: `npx rea-agents setup`（対象のエージェントを選び、提案された設定変更を承認する。既存の設定はバックアップされる。Claude Code、Codex、Cursor、Gemini CLIなどに対応）。導入後はエージェントを再起動する。Node.js 22.19以降、24.11以降、または26以降が必要。ネイティブバイナリを詳しく解析するにはHopper、Ghidra、IDAのいずれかが必要で、商用ツールは正規のライセンスで使う。静的なJavaScriptと.NETの解析はこれらがなくても動く。更新が頻繁なため、`npx rea-agents@latest setup`で最新に保つ。名前の似たリポジトリやREADMEを写したものは公式とは限らないため、`morluto/rea`、`rea.tools`、npmの`rea-agents`から入手する。利用は、自分が所有するソフトウェアか、調べる許可を得たソフトウェアに限られる。 |
| [GitHubSecurityLab/gh-secure](https://github.com/GitHubSecurityLab/gh-secure) ⭐ 509 | GitHub Security Labの推奨設定に沿って、リポジトリのセキュリティ機能を有効化するGitHub CLI拡張機能。ブランチ保護、非公開の脆弱性報告、シークレットスキャン、Dependabot、CodeQLによるコードスキャンの5機能を、対話形式または一括で設定する。GitHub Copilot CLIなどのAIアシスタントから呼び出して、現状の確認や不足機能の有効化を任せることもできる。 | MIT。導入: `gh extension install GitHubSecurityLab/gh-secure`。現状を確認: `gh secure status`。変更内容を事前に確認: `gh secure --yes --dry-run`。対象リポジトリの管理者またはmaintain権限が必要。ブランチ保護を有効化すると、既定ブランチへの直接pushができなくなる場合がある。 |
| [vercel-labs/deepsec](https://github.com/vercel-labs/deepsec) ⭐ 8,183 | Vercelが公開する、コーディングエージェントを使った脆弱性スキャナー。自分の環境で動かし、大規模な既存リポジトリのコード全体を調べて、長く見逃されてきた脆弱性を見つける。正規表現で候補箇所を拾う（AIは使わない）、AIが調べて指摘と推奨対応を出す、指摘を再確認して誤検知を減らす、コミット情報から担当者を付ける、指摘をMarkdownやJSONで書き出す、の順に進む。変更差分だけを調べるPR向けのモードと、Vercel Sandboxでの並列実行も備える。途中で止まっても、同じコマンドを再実行すれば続きから再開する。 | Apache-2.0。リポジトリのルートで導入: `npx deepsec init`（リポジトリには`.deepsec/`フォルダーだけを追加する）。費用と時間に上限を付ける: `npx deepsec init --max-cost-usd 100 --max-duration 2h`。既定では最上位のモデルを最大の思考レベルで使うため、大規模なコードベースでは数千〜数万ドルかかることがある。モデルの呼び出しは既定でVercel AI Gatewayを経由し、OpenAIやAnthropicの自分のAPIキーも使える。deepsec自体は、シェルを自由に実行できるコーディングエージェントと同じように扱う。 |
| [Introducing deepsec（Vercelブログ）](https://vercel.com/blog/introducing-deepsec-find-and-fix-vulnerabilities-in-your-code-base) | deepsecを発表したVercelの公式記事。処理の流れ、ClaudeとCodexを使った調査、Vercel Sandboxでの並列実行（Vercel社内では1,000以上のSandboxを同時に動かしている）、誤検知の割合（経験上10〜20%程度）を説明する。アプリケーションやサービス向けで、ライブラリやフレームワークには独自のプロンプトや検出ルールが必要になることがあるとしている。 | 2026年5月4日公開。最新の導入手順はリポジトリのREADMEを見る。 |

## 4. 業務・調査・図解向け｜業務・調査

| リンク | 解説 | その他 |
| --- | --- | --- |
| [Ted0321/kotetsu-work-ai-skills](https://github.com/Ted0321/kotetsu-work-ai-skills) ⭐ 56 | 論点整理、調査結果からの示唆抽出、資料レビュー、企業調査、HTMLレポート作成など、業務を進めるための日本語Skill集。 | |
| [ReScienceLab/opc-skills](https://github.com/ReScienceLab/opc-skills) ⭐ 1,842 | 個人開発者や一人会社向けに、需要調査、SEO／GEO、ドメイン探索、ロゴ・バナー制作などをAIへ実行させるSkill集。 | |
| [SeanJ1ang/design-judge-skills](https://github.com/SeanJ1ang/design-judge-skills) ⭐ 712 | デザイン賞の公式情報確認、作品評価、応募先選定、申請文作成、提出前確認を、根拠と採点基準を残しながら実行するSkill集。 | |
| [ferdinandobons/startup-skill](https://github.com/ferdinandobons/startup-skill) ⭐ 1,162 | 市場調査、競合分析、価格分析、事業アイデア検証などを実行するスタートアップ向けSkill集。 | |
| [mathbullet/skills](https://github.com/mathbullet/skills) ⭐ 170 | 日本語説明、出典付き調査、論文解説、HTML図解などの出力規則を定義したAgent Skill集。 | |
| [koala73/worldmonitor](https://github.com/koala73/worldmonitor) ⭐ 87,753 | ニュース、地政学、災害、インフラなどの世界情勢を集約するリアルタイム監視ダッシュボード。 | |

## 4. 業務・調査・図解向け｜図解・HTML出力・デザイン

| リンク | 解説 | その他 |
| --- | --- | --- |
| [imxv/Pretty-mermaid-skills](https://github.com/imxv/Pretty-mermaid-skills) ⭐ 1,511 | MermaidソースからSVG、PNG、ターミナル向け表現をローカル生成するSkill。Mermaidの構文を維持したまま見た目を整える用途に向く。 | |
| [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design) ⭐ 43,295 | アーキテクチャ図、状態遷移、シーケンス、ロードマップなどを、HTML＋SVGの編集可能な図として生成するSkill。Mermaid以外の誌面向けレイアウトを作る用途に向く。 | |
| [sagochiko/aws-drawio-diagram-skill](https://github.com/sagochiko/aws-drawio-diagram-skill) ⭐ 35 | AWSの構成を箇条書きで伝えるだけで、AWS公式アイコンを使った構成図をdraw.io形式（`.drawio`）で描くClaude Code向けSkill。枠の入れ子、ラベルの位置、線の引き方、色などの描き方をSkill側で定め、タイトルや凡例などの飾りを足さない。既存の`.drawio`へのサービス追加にも対応する。 | Apache-2.0。AWSとdraw.ioの公式Skillではない。Claude Codeへ導入: `/plugin marketplace add sagochiko/aws-drawio-diagram-skill`、`/plugin install aws-drawio-diagram@aws-drawio-diagram-skill`。Python 3が必要。draw.io desktopがあると、PNGへ書き出して描画結果を確認してから渡す。動作確認はmacOSのみで、Windowsでは未確認。 |
| [plannotator/effective-html](https://github.com/plannotator/effective-html) ⭐ 3,528 | AIにHTML形式のワイヤーフレーム、プロトタイプ、計画書、図解を生成させるAgent Skill集。 | |
| [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) ⭐ 10,242 | ターミナルのASCII図や大きな表の代わりに、構成図、差分レビュー、計画と実装の照合、プロジェクトの振り返りなどを自己完結型のHTMLページまたはスライドとして生成するAgent Skill。`/diff-review`、`/plan-review`、`/fact-check`などのコマンドと、テーマ切替、PPTX出力、ローカルMCPサーバーを備える。 | MIT。Claude Codeへ導入: `/plugin marketplace add nicobailon/visual-explainer`、`/plugin install visual-explainer@visual-explainer-marketplace`。出力先は既定で`~/.agent/diagrams/`。 |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) ⭐ 92,490 | AIが生成するWeb UIから、凡庸な配色・レイアウト・装飾を減らすためのデザイン規則を提供する。 | |
| [microsoft/flint-chart](https://github.com/microsoft/flint-chart) ⭐ 4,377 | AIエージェントが見栄えのよいグラフを安定して作るための、可視化用の中間言語。各項目の意味（`Rank`、`Price`、`Country`など70種類以上）と簡潔なグラフ指定から、大きさ、間隔、ラベル、凡例、レイアウトをデータに合わせて決め、Vega-Lite、ECharts、Chart.js、Plotlyの仕様や、編集できるExcelのグラフへ変換する。Economist、Swissなど10種類の組み込みテーマを持ち、独自のテーマも定義できる。TypeScriptのライブラリ（`flint-chart`）と、エージェントがグラフを作成・検証・表示するMCPサーバー（`flint-chart-mcp`）からなる。 | MIT。Microsoft Research製。ライブラリを導入: `npm install flint-chart`。MCPサーバーを起動: `npx -y flint-chart-mcp`。公開中のMCPサーバー（`https://flint.data-formulator.ai/mcp`）をClaudeのカスタムコネクターとして追加して試すこともできるが、大きなデータには手元で動かすMCPサーバーを勧めている。MCPを使わない場合のAgent Skill（`agent-skills/flint-chart-author/SKILL.md`）も同梱する。Python版はソースのみのプレビュー。 |

## 4. 業務・調査・図解向け｜日本語の文章

| リンク | 解説 | その他 |
| --- | --- | --- |
| [japanese-tech-writing/SKILL](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d) ⭐ 2,088 | 日本語の技術文書・書籍原稿向けの文章規範。段落構成、論証の厳密さ、読み手の負荷、LLMらしい空句、翻訳調の比喩、冗長さなどを点検する。 | Unlicense。 |
| [cognitive-rhythm-writing/SKILL](https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432) ⭐ 1,072 | 日本語の説明文に認知リズムを設計する文章規範。観察・逡巡・断定・再観察の切替、文の拍、段落の密度波形、未回収の緊張、問いの回収、駄文の点検などを扱う。 | `japanese-tech-writing/SKILL.md`との併用を前提とする。 |
| [nanaism/yomiyasu](https://github.com/nanaism/yomiyasu) ⭐ 1,367 | AIが生成した日本語を、読みやすく情報密度の高い日本語へ推敲するAgent Skill。動作主の復元、非生物主語の解体、比喩動詞の具体的な操作への置き換えなど7つの変換原則を適用し、tech／business／essayのドメイン別に文体を調整する。AIっぽさを検査する`yomiyasu_lint.py`と、推敲前後の意味の変化を確認する`yomiyasu_diff.py`を同梱する。 | MIT。導入: `npx skills add nanaism/yomiyasu`。他の日本語校正Skillと同時に有効化すると指示が干渉するため、類似Skillを一時的に無効化して使う。 |
| [coji/natural-japanese](https://github.com/coji/natural-japanese) ⭐ 1,863 | 議事録、調査レポート、社内ガイド、企画書、ブログ記事など、仕事の日本語を読みやすく書く・直すためのAgent Skill。書く前に見出しの骨組みを固めて12箇条の文体ルールを適用し、それでも残る定型句、単調な文のリズム、英語の直訳調を形態素解析（sudachipy）による`lint.py`で検出する。直すかどうかの判断は機械に任せず、6軸の推敲基準を満たすまでエージェントが推敲を繰り返す。 | MIT。導入: `npx skills add coji/natural-japanese`。書き換えずに自然度（0〜100）だけを測る: `/natural-japanese score <ファイル>`。検査スクリプトを単体で使うにはuvが必要。`japanese-tech-writing/SKILL.md`の空句の分類を参考にしている。 |

## 5. Skillの生成・変換・評価

| リンク | 解説 | その他 |
| --- | --- | --- |
| [virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill) ⭐ 33,612 | PDF、EPUB、DOCX、Markdown、HTMLなどの資料を、章別参照、用語集、パターン、チートシートを備えたAgent Skillへ変換する。 | |
| [microsoft/skill-recorder](https://github.com/microsoft/skill-recorder) ⭐ 4,192 | 人間の画面操作と任意の音声説明を記録し、GitHub Copilot CLIで手順を復元して、SkillまたはAutomationへ変換する。 | 解析時には記録データがGitHubのクラウドへ送信されるため、機密情報を録画へ含めない。 |
| [microsoft/waza](https://github.com/microsoft/waza) ⭐ 1,391 | Agent Skillの評価スイートを作成し、ベンチマーク、採点、モデル比較、評価要件の充足確認を実行するGo製CLI。 | Windowsへ導入: `irm https://raw.githubusercontent.com/microsoft/waza/main/install.ps1 \| iex`。雛形作成: `waza init my-project`、`cd my-project`、`waza new skill my-skill`、`waza new eval my-skill`。評価・構造検査: `waza run my-skill -v`、`waza check skills/my-skill`。一時的にPATHを追加: `$env:Path += ";$env:LOCALAPPDATA\Microsoft\Waza"` |
| [microsoft/SkillOpt](https://github.com/microsoft/SkillOpt) ⭐ 18,004 | モデルの重みを変えずに、Skill文書そのものを学習対象として最適化するPython製フレームワーク。実行結果の採点を基に追加・削除・置換の編集を提案し、検証スコアが改善した編集だけを採用して、配布可能な`best_skill.md`を出力する。 | MIT。導入: `pip install skillopt`。過去のセッションから夜間にSkillを改善する`skillopt-sleep` CLIも同梱（Claude Code、Codex、Copilot向けの連携ファイルはリポジトリ側にある）。 |

## 6. Cookbook・実装例

| リンク | 解説 | その他 |
| --- | --- | --- |
| [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks) ⭐ 53,178 | Claude API、Claude Agent SDK、Managed Agents、評価、ツール利用などの実装例を収録する。 | `patterns/agents/`: 直列処理、並列処理、ルーティング、評価・改善ループなどのエージェント設計パターン。`claude_agent_sdk/`: エージェント、サブエージェント、動的ワークフロー、ホスティング。`managed_agents/`: 継続実行するエージェント、外部サービス連携、セルフホスト型サンドボックス。`skills/`: Skills APIとSkill利用の実装例。`evals/`、`tool_evaluation/`: エージェントおよびツールの評価例。`cost_optimization/`: 成功率、品質、コストを比較して構成を選ぶ例 |

## 7. AI駆動開発の方法論・ワークフロー

| リンク | 解説 | その他 |
| --- | --- | --- |
| [obra/superpowers](https://github.com/obra/superpowers) ⭐ 295,147 | 対話による仕様化、設計承認、実装計画、TDD、サブエージェントによる実装とレビューを組み合わせた、Skillベースのソフトウェア開発方法論。 | |
| [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) ⭐ 53,771 | PM、アーキテクト、開発者などの役割を分け、規模に応じて企画、要件、設計、実装の深さを変えるAI駆動開発手法。 | |
| [awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows) ⭐ 4,980 | AWS LabsのAI-Driven Development Life Cycle実装。5フェーズ、33ステージ、複数の専門エージェント、各段階の承認ゲートによって開発工程を制御する。 | |
| [garrytan/gstack](https://github.com/garrytan/gstack) ⭐ 135,036 | CEO、エンジニアリングマネージャー、デザイナー、QA、セキュリティ、リリースなどの役割を持つSkillを、企画・レビュー・出荷の工程で使い分ける開発ワークフロー。 | |
| [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) ⭐ 10,157 | Discuss、Plan、Execute、Verify、Shipのフェーズを繰り返し、重い調査・計画・実装を新しいコンテキストのサブエージェントへ分離する開発フレームワーク。 | 旧`gsd-build/get-shit-done`はアーカイブ済みで、現在はこのリポジトリへ移転。 |
| [github/spec-kit](https://github.com/github/spec-kit) ⭐ 140,084 | constitution、specify、plan、tasks、implementなどの成果物とコマンドを使い、仕様を実装の基準として残すGitHub製ツールキット。 | |
| [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) ⭐ 71,029 | 変更単位でproposal、requirements、design、tasksを作成し、実装後に変更記録をアーカイブする仕様駆動開発フレームワーク。 | |
| [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering) ⭐ 18,915 | AIエージェントを制御するハーネスの設計を、初学者向けに段階的に解説するチュートリアル。 | |
| [openai/openai-cookbook — Using PLANS.md for multi-hour problem solving](https://github.com/openai/openai-cookbook/blob/main/articles/codex_exec_plans.md) ⭐ 76,663 | Codexに数時間かかる複雑な実装を最後までやり切らせるための、計画書（ExecPlan）の書き方を定めた`PLANS.md`の全文と使い方。`AGENTS.md`に「複雑な機能や大きなリファクタリングではExecPlanを使う」と書き、`.agent/PLANS.md`に置いた規則に沿って計画を書かせる。計画書は、リポジトリを初めて見る人でもそれだけで最後まで実装できるよう自己完結させ、進捗、想定外の発見、判断の記録、結果と振り返りを作業しながら更新し続ける。完了の条件は、内部の実装ではなく、人が確かめられる振る舞い（実行するコマンドと期待する出力）で書く。 | OpenAIによる記事。2025年10月公開（2026年1月更新）。これに近い`PLANS.md`で、Codexが1つのプロンプトから7時間以上作業を続けたとしている。推奨モデルは`gpt-5.2-codex`。ExecPlanはCodexが学習している用語ではなく、プロンプトから定義を指すための呼び名。必要に応じて必須の項目を足し引きしてよいとしている。 |

## 8. 汎用エージェントSDK・実行基盤

| リンク | 解説 | その他 |
| --- | --- | --- |
| [microsoft/agent-framework](https://github.com/microsoft/agent-framework) ⭐ 13,938 | Python、.NET、Goでエージェントとマルチエージェントワークフローを構築するSDK。直列、並列、引き継ぎ、チェックポイント、Human-in-the-loop、OpenTelemetryなどを扱う。 | |
| [openai/openai-agents-python](https://github.com/openai/openai-agents-python) ⭐ 29,829 | OpenAIのPython向けAgents SDK。エージェント、ツール、引き継ぎ、ガードレール、セッション、トレーシングを実装する。 | |
| [google/adk-python](https://github.com/google/adk-python) ⭐ 21,702 | GoogleのPython向けAgent Development Kit。モデルやデプロイ先を固定せず、エージェント、ツール、ワークフロー、評価を実装する。 | |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) ⭐ 42,704 | 状態を持つ長時間実行ワークフローをグラフとして実装するフレームワーク。中断・再開、人間承認、永続化を必要とする処理に向く。 | |
| [vercel/eve](https://github.com/vercel/eve) ⭐ 5,455 | instructions、tools、skills、channels、schedulesをファイルとして管理する、ファイルシステム中心の永続型エージェントフレームワーク。 | 現在はベータ版。 |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) ⭐ 251,115 | CLIや各種メッセージングチャネルから利用できる汎用エージェント本体。会話検索、ユーザー情報の継続利用、Skillの生成・更新、スケジュール実行、サブエージェント、複数の実行バックエンドを備える。 | |

## 8. 汎用エージェントSDK・実行基盤｜AIエージェント環境・運用基盤

| リンク | 解説 | その他 |
| --- | --- | --- |
| [odysseus-dev/odysseus](https://github.com/odysseus-dev/odysseus) ⭐ 89,305 | AIエージェント、検索、画像生成などを自分の環境で運用するセルフホスト型AIワークスペース。 | |
| [lobehub/lobehub](https://github.com/lobehub/lobehub) ⭐ 82,981 | 複数のAIエージェントを登録し、スケジュール実行や作業報告を管理するAIエージェント運用基盤。 | |
| [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) ⭐ 52,357 | 複数のLLM、チャット、ナレッジベース、AIエージェント、300種類以上のアシスタントを統合するデスクトップアプリ。 | |
| [strands-agents/box](https://github.com/strands-agents/box) ⭐ 425 | AIエージェントを、実行できるもの、読み書きできるファイル、通信先を制限したサンドボックスの中で動かすRust製のツール。OSによる隔離（macOSのSeatbelt）と、Dogwood（Cedar互換で、時間の前後関係も書けるポリシー言語）による既定拒否のポリシーを組み合わせる。シェルコマンド、Pythonのファイル操作、ネットワーク通信、ツールの起動、MCPの呼び出しをポリシーで判定し、「顧客のファイルを読んだ後は他のホストへのアップロードを禁止する」のように、操作を時系列でつなげた規則も書ける。認証情報はエージェントの外に置き、通信の出口で差し込む。中で動かすエージェントは選べ、Strands CLI、Claude Code、Codex CLIなどを動かせる。判定の記録はOTLP JSONでローカルに書き出す。 | Apache-2.0。0.1系のプレリリースで、設定項目、ポリシーの操作名、CLIのオプションはリリース間で変わることがある。対応するのはApple silicon搭載のmacOS 15以降だけで、Linuxは対応予定、Windowsは対象外。導入: `curl -fsSL https://raw.githubusercontent.com/strands-agents/box/main/download.sh \| sh`。設定は`box.toml`、ポリシーは`policy.dw`に書き、`./box-core/box run --config <box.tomlのパス>`で起動する。エージェントに組み込まれたファイル操作ツールはポリシーを通らないため、すべてのファイル変更を判定させたいときは、ファイル操作をシェルだけに限る。box内のプロセスは`box.toml`で宣言したすべての認証情報を使えるため、使わせたくない認証情報は別のboxに分ける。 |
| [Strands Box ドキュメント](https://strandsagents.com/docs/user-guide/box/) | Strands Boxの概要。OSによる隔離とポリシーの2層の仕組み、boxを構成する要素（エージェントのシェルとPythonを置き換えるStrands ShellとMonty、ツール、認証情報、通信の出口のゲートウェイ、MCPブローカー、判定の記録）、対応環境、セキュリティ上の注意を説明する。 | 導入手順は`getting-started/`、Claude CodeやCodex CLIを中で動かす手順は`guides/`以下にある。入門の手順は、Strands CLIとAmazon BedrockのClaudeを使う。 |
| [microsoft/mxc](https://github.com/microsoft/mxc) ⭐ 2,887 | AIが生成したコード、プラグイン、ツール、エージェント本体など、信頼できない処理を隔離して動かすMicrosoftの実行基盤（Microsoft Execution Containers、MXC）。アプリにSDK（Rust、.NET、Node）として組み込み、書き込みできる場所・読み取り専用の場所・アクセスさせない場所、通信先、クリップボードや画面などUIへのアクセスをJSONで指定すると、OSに合った方式で隔離して実行する。既定の方式は、WindowsではAppContainerを使うプロセスコンテナー、LinuxではBubblewrap、macOSではSeatbeltで、Windowsでは別のアカウントとセッションで動かす方式、WSL、MicroVMなども選べる。ポリシーはエージェントの外にあるため、エージェントが自分で権限を広げることはできない。 | MIT。導入: Nodeは`@microsoft/mxc-sdk`、.NETは`Microsoft.Mxc.Sdk`、Rustは`mxc-sdk`。SDKを組み込めない場合は、`wxc-exec.exe`などの実行ファイルにJSONの設定を渡して動かせる。Windows Sandbox、MicroVM、Hyperlightなど一部の方式は試験的。`--audit`はサンドボックスの保護をすべて切るため、信頼できないコードには使わない。公式ビルドは任意の診断テレメトリーを送れるが、利用者の同意などがなければ送らない。 |
| [Microsoft Execution Containers: policy-driven containment for AI agents（Windows Developer Blog）](https://blogs.windows.com/windowsdeveloper/2026/10/07/microsoft-execution-containers-policy-driven-containment-for-ai-agents/) | MXCの一般提供を発表したMicrosoftの公式記事。ログイン中の利用者と同じ権限でエージェントを動かす危険と、開発者や組織が決めた境界をエージェントとは独立して強制する考え方、4種類の隔離方式の使い分け、ポリシーの対象（隔離の方式、プロセス、ファイル、ネットワーク、UI）、組織のポリシーの上乗せ、ポリシーを作るための3つの動作モード（適用、学習、許容）を説明する。GitHub Copilot、OpenAI Codex、OpenClaw、LM Studioなどがすでに対応し、Claude CodeやHermes Agentなどが対応を表明している。 | 2026年10月7日公開。Windows 365（Cloud PC）での利用も一般提供。Intuneによる管理、Microsoft Entraによるエージェントの識別、Agent 365での管理は今後提供予定。 |

## 9. コーディングエージェントの実行・オーケストレーション｜プロジェクト／組織単位の制御

| リンク | 解説 | その他 |
| --- | --- | --- |
| [paperclipai/paperclip](https://github.com/paperclipai/paperclip) ⭐ 96,982 | 複数のAIエージェントへ目標と仕事を割り当て、組織図、権限、承認、予算、進捗、監査情報を一元管理するNode.js＋React製のOSS。 | |
| [Untrivial-ai/agent-orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) ⭐ 12,726 | タスクごとにブランチとWorktreeを分離し、複数のコーディングエージェント、差分、PR、CI、レビューをKanban形式で管理するローカルデスクトップアプリ。 | |
| [stablyai/orca](https://github.com/stablyai/orca) ⭐ 84,742 | Claude Code、Codex、OpenCodeなどをタスク別のWorktree・ターミナル・ブラウザで並列実行するAgent Development Environment。Run、Task、Dispatch、メッセージ、判断ゲートによる構造化オーケストレーションも提供する。 | |

## 9. コーディングエージェントの実行・オーケストレーション｜プロジェクト／組織単位の制御｜stablyai/orca

| リンク | 解説 | その他 |
| --- | --- | --- |
| [Orca Docs](https://www.onorca.dev/docs) | Orcaの公式ドキュメント。 | |
| [Orchestration](https://www.onorca.dev/docs/cli/orchestration) | Orcaのオーケストレーション機能の説明。 | 現時点ではExperimental。 |

## 9. コーディングエージェントの実行・オーケストレーション｜コーディングエージェント

| リンク | 解説 | その他 |
| --- | --- | --- |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) ⭐ 89,962 | コード編集、コマンド実行、テスト、問題修正を自律的に進めるOSSのAI開発エージェント。 | |
| [cline/cline](https://github.com/cline/cline) ⭐ 69,828 | IDE拡張、CLI、SDKとして利用できる自律型コーディングエージェント。ファイル編集やコマンド実行に対応する。 | |
| [aaif-goose/goose](https://github.com/aaif-goose/goose) ⭐ 54,937 | LLMを選択して、コード編集、コマンド実行、テスト、外部ツール連携を行える拡張可能なAIエージェント。 | |

## 9. コーディングエージェントの実行・オーケストレーション｜ターミナル／セッション単位の実行

| リンク | 解説 | その他 |
| --- | --- | --- |
| [herdrdev/herdr](https://github.com/herdrdev/herdr) ⭐ 42,179 | 複数のコーディングエージェントを実ターミナル上で継続稼働させるターミナルマルチプレクサ兼バックグラウンドランタイム。各ペインの稼働中・待機中・停止状態を集約し、CLIやスクリプトから操作できる。 | |
| [Herdr Docs](https://herdr.dev/docs/agents/) | 対応するエージェント、ペイン管理、状態検出の説明。 | |
| [Herdr Agent automation](https://herdr.dev/docs/agent-automation/) | スクリプトまたは別のエージェントが、エージェントの起動、状態確認、入力、結果回収を行う方法。 | |

## 9. コーディングエージェントの実行・オーケストレーション｜オーケストレーターのカタログ

| リンク | 解説 | その他 |
| --- | --- | --- |
| [andyrewlee/awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators) ⭐ 2,092 | エージェントへの仕事の割当、実行場所、実行時刻、成果物の処理を制御するツールとフレームワークの一覧。 | |

## 10. コンテキスト・知識・記憶基盤

| リンク | 解説 | その他 |
| --- | --- | --- |
| [trailhq/Graft](https://github.com/trailhq/Graft) ⭐ 9,560 | コードベースの構造、依存関係、変更影響をグラフ化し、Claude CodeやCodexなどへタスクに関係するコード情報を渡すコンテキスト層。 | |
| [semantica-agi/semantica](https://github.com/semantica-agi/semantica) ⭐ 13,642 | AIが使用する情報をコンテキストグラフ、知識グラフ、オントロジー、意思決定履歴として保存し、根拠と経路を追跡できるPython基盤。 | |
| [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki/blob/main/README_JA.md) ⭐ 20,194 | 文書を取り込み、相互リンクされたWikiと知識グラフを継続更新するデスクトップアプリ。検索、出典参照、MCP、Agent Skillを提供する。 | |
| [Andrej Karpathy: LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) | LLMが資料を読み、正規化されたWikiを増分更新するナレッジ管理パターン。 | `nashsu/llm_wiki`が実装する元の考え方。 |
| [GoogleCloudPlatform/knowledge-catalog — OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) ⭐ 9,374 | Open Knowledge Format（OKF）の資料と実装例。AIエージェントへ知識を渡す際の、機械可読な知識パッケージを扱う。 | |
| [Open Knowledge Formatの解説](https://cloud.google.com/blog/ja/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/) | Google CloudによるOKFの目的と利用方法の解説。 | |
| [infiniflow/ragflow](https://github.com/infiniflow/ragflow) ⭐ 91,668 | 文書解析、検索、引用付き回答、エージェント機能を提供するRAG基盤。 | |
| [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) ⭐ 85,245 | コードベースを解析し、ファイル、関数、依存関係を対話可能なナレッジグラフへ変換する。Codexにも対応する。 | |
| [upstash/context7](https://github.com/upstash/context7) ⭐ 62,664 | ライブラリの最新公式ドキュメントを取得し、AIコーディングツールへ渡すMCP対応サービス。 | |
| [MemPalace/mempalace](https://github.com/MemPalace/mempalace) ⭐ 59,407 | 会話履歴を要約せず原文のままローカル保存し、階層構造と意味検索によってAIへ過去情報を返す長期記憶基盤。 | |
| [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) ⭐ 45,344 | 会話を思い出すだけでなく、経験から学習することを目指すAIエージェント向けの記憶基盤。retain（記憶の保存）、recall（検索）、reflect（記憶を分析して新しい理解を作る）の3操作を提供する。recallでは、意味検索、キーワード検索（BM25）、エンティティ間の関係をたどるグラフ検索、時間範囲での絞り込みを並列に実行する。記憶はユーザー、エージェント、プロジェクトごとに分離して保存する。MCPエンドポイントも標準で備える。 | MIT。サーバーはDockerやpipで起動し、LLMのAPIキーまたは既存のサブスクリプションを使う。有料のマネージド版（Hindsight Cloud）もある。コーディングエージェントへ導入: `npx @vectorize-io/hindsight-coding-agents install claude-code`（Gitの履歴と過去のセッションから、リポジトリごとの記憶を自動で作る） |

## 11. 評価・観測・改善

| リンク | 解説 | その他 |
| --- | --- | --- |
| [microsoft/AI-Engineering-Coach](https://github.com/microsoft/AI-Engineering-Coach) ⭐ 4,309 | ローカルのAIコーディングセッション履歴を解析し、プロンプト、セッション管理、レビュー、ツール利用、コンテキスト管理の傾向を可視化するVS Code拡張機能。 | Marketplace配布ではないため、利用者がVSIXをビルドする。 |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) ⭐ 25,697 | LLMアプリとエージェントの評価、モデル比較、回帰テスト、レッドチーミングをCLIとCI/CDで実行するOSS。 | |
| [langfuse/langfuse](https://github.com/langfuse/langfuse) ⭐ 35,366 | LLMアプリのトレース、プロンプト管理、評価、メトリクスを扱うオープンソースの観測基盤。セルフホストにも対応する。 | |
| [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix) ⭐ 11,703 | OpenTelemetryベースで、LLM／エージェントのトレース、評価、実験、問題分析を行うオープンソース基盤。 | |
| [microsoft/Echoverse](https://github.com/microsoft/Echoverse) ⭐ 41 | 画面を操作するAIエージェント（computer-use agent）の学習と評価に使う、作り込まれたWeb環境群。各環境はFastAPI、React、SQLiteで動く実際のWebアプリで、リセットできる状態、状態を変える操作とその結果、データベースに基づく正解判定を備える。公開されているのは、宿泊予約サイト（EchoStay）と開発者向けのコードホスティング（EchoForge）の業務全体を再現した2環境と、日付ピッカーと入れ子のフィルターという1つの操作を多様な画面構成で練習させる2環境、およびそのテストタスク722件。1つの操作を扱う環境は、学習済みの画面と未知の画面にタスクが分かれ、画面の暗記ではなく操作を身につけたかを比べられる。 | MIT。研究目的で公開されている。付属のハーネスが環境の起動、多数の環境の同時実行、結果の採点を担い、エージェントは利用者が用意する（MicrosoftのFara1.5モデルをGPUで動かす参照用エージェントも同梱）。採点はOpenAI互換APIのLLMが行う。Python 3.10以降、uv、Node.js 18以降、`sqldiff`が必要。正解判定用のデータベースはGitに含まれないため、Hugging Faceから取得する: `hf download microsoft/Echoverse --repo-type dataset --include "*/*.db" --local-dir ./envs` |

## 12. 意思決定記録・設計履歴

| リンク | 解説 | その他 |
| --- | --- | --- |
| [architecture-decision-record/architecture-decision-record](https://github.com/architecture-decision-record/architecture-decision-record) ⭐ 17,082 | Architecture Decision Record（ADR）の説明、テンプレート、関連ツールを集めた情報ハブ。ADRは、重要な技術判断、その前提、採用理由、結果を文書として残す。 | |
| [adr/madr](https://github.com/adr/madr) ⭐ 2,534 | Markdown Architectural Decision Records（MADR）のテンプレート。ADRをMarkdownで統一して管理する。 | |
| [AIとの対話履歴を資産にするDDR](https://zenn.dev/softbank/articles/ee93e87a9d5dac) | AIとの対話からDesign Decision Record（DDR）を自動記録し、設計判断の理由と変更経緯を残す事例。 | |

## 13. 付帯ツール

| リンク | 解説 | その他 |
| --- | --- | --- |
| [microsoft/coreutils](https://github.com/microsoft/coreutils) ⭐ 5,223 | `ls`、`cat`、`grep`、`find`などのUNIX系コマンドをWindows上で提供するMicrosoft管理のプレビュー版。 | PowerShellの同名エイリアスや組み込みコマンドとの競合に注意。導入: `winget install Microsoft.Coreutils` |
| [vercel-labs/portless](https://github.com/vercel-labs/portless) ⭐ 12,643 | `localhost:5173`のようなポート番号を、安定した名前付きローカルURLへ置き換える開発ツール。 | |
