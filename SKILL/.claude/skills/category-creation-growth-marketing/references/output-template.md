# 出力テンプレート

この出力は分析の記録であり、`SKILL.md` 9章のレポート生成の元データになる。出力を作った後、`references/report-generation.md` に従ってHTMLレポートを作る。

すべてのモードで、冒頭に以下を書く。

```text
モード: White Space Discovery / Quick Diagnosis / Full Strategy / Single Phase（対象: P○）
前提・仮定: （P0で置いた仮定の一覧）
先行事例の確認: 実施（調査日・期間） / 一部実施（確認した範囲と、未了の確認） / 未実施（理由。未実施の場合は「未開拓・競合なしの判断はできない」と明記） / 省略（Single Phase のみ。理由）
証拠ラベル: [事実: 出典] / [推定] / [仮説] / [不在確認: 調査範囲]
差し戻し: （SKILL.md 4.4 で上流に戻った場合、何が見つかり、どのPhaseに戻り、結論がどう変わったか。なければ「なし」）
```

先行事例の確認が「一部実施」「未実施」の場合は、`SKILL.md` 7章の Completion Gate を満たさない。「分析完了」とは書かない。

---

## Full Strategy 形式

| # | セクション | 対応Phase | 内容 |
| --- | --- | --- | --- |
| 1 | Executive Summary | 全体 | 2〜5文。市場定義の判定、最大の勝ち筋、最大のリスクを含める |
| 2 | Intake & Assumptions | P0 | 受け取った情報と、置いた仮定 |
| 3 | Prior Art | P0.5 | 先行事例の表（一次資料つき）、調査の記録、判定、残る隙間 |
| 4 | Existing World | P1 | 現在のワークフロー、前提、受け入れられている非効率 |
| 5 | Hidden Problem & Root Cause | P2 | 症状と構造原因、再定義された問題 |
| 6 | Contrarian Thesis | P3 | 証拠付きの反対仮説 |
| 7 | Enemy | P4 | 置き換える古い方法 |
| 8 | ICP & Beachhead | P5 | 最初に勝つ顧客と、広げる順序 |
| 9 | Category Decision | P6 | 新カテゴリー／サブカテゴリー／再ポジショニングの判定、名前、一文定義 |
| 10 | Competitive Axis | P7 | 新しい比較軸 |
| 11 | Positioning | P8 | 既存製品との役割分担 |
| 12 | Product Primitive | P9 | 製品の最小の説明 |
| 13 | Messaging | P10 | 5秒 / 30秒 / 3分 / 技術者 / 専門家 |
| 14 | Quantitative Hooks & Number Framing | P11 | 数値による差別化と見せ方（条件付き） |
| 15 | Proof | P12 | 主張と証拠の対応表 |
| 16 | Demo Strategy | P13 | Business Demo / Viral Demo |
| 17 | Founder Story | P14 | または「対象外」と理由 |
| 18 | Timing | P15 | なぜ今なのか |
| 19 | Controversy | P16 | 適用範囲を限定した主張 |
| 20 | Criticism & Counterarguments | P17 | 批判と回答。事実確認の欄に出典・調査範囲 |
| 21 | GTM Motion | P18 | 売り方と切り替えの条件 |
| 22 | Pricing | P19 | 課金単位、価格、無料枠 |
| 23 | Launch Strategy | P20 | 束ねる材料と第2波 |
| 24 | Distribution Strategy | P21 | 優先チャネル |
| 25 | Time-to-First-Value | P22 | 最初の価値体験までの時間と短縮策 |
| 26 | UGC Strategy | P23 | 用途を発明させる仕組み |
| 27 | Growth Loop | P24 | 自己増殖の構造と、途切れやすい箇所 |
| 28 | Third-Party Amplification | P25 | 第三者による市場教育 |
| 29 | Adoption Metrics | P26 | Funnelの指標、North Star |
| 30 | Business Viability | P27 | Unit Economics、市場規模、判定 |
| 31 | Competitive Response | P28 | 競合・大手の反応とコピーリスク |
| 32 | Defensibility & Standardization | P29 | Moat、Ecosystem、標準化 |
| 33 | Category Ownership | P30 | 最終的な市場ポジション |
| 34 | Reality Check | P31 | 反証パスの結果、致命的・重大な問題 |
| 35 | Consistency Check | 全体 | `SKILL.md` 4.3 の組み合わせごとの確認結果。矛盾があれば、その解消方針 |
| 36 | Missing Evidence | 全体 | [仮説] と未検証項目の一覧 |
| 37 | Next Experiments | P32 | 実験の表（判断ルールつき） |
| 38 | Coverage Matrix | 全体 | `SKILL.md` 6章の表 |

各セクションは、対応するPhaseの references に書かれた「出力」の形式に従う。各セクションを書き終えたら、`SKILL.md` 4.2 の Depth Check（具体性・因果・比較・反証・接続）を確認する。

---

## White Space Discovery 形式

```text
1. 結論（3文以内）
   - 推奨する領域（1〜3個）と、その判定
   - 推奨する理由
   - 最大のリスク

2. 探索の条件（P0 探索版）
   - 探索する範囲 / 依頼者の強み・制約 / 目的 / 判断の基準

3. 候補ごとの判定表（捨てた候補も含めて、すべて載せる）
```

| 候補（顧客 × 問題 × 条件） | 主要な先行事例 | 解決していること | 残る隙間 | 判定 | 根拠（証拠ラベル） | 扱い（深掘り／捨てる＋理由） |
| --- | --- | --- | --- | --- | --- | --- |

```text
4. 調査の記録（候補ごと）
   - 検索語、確認した情報源の種類と確認しなかった種類（理由）、期間、調査日

5. 通過した候補の評価表（references/white-space-discovery.md Step 5）

6. 選んだ候補の深掘り（候補ごと）
   - 顧客の今のやり方（P1）
   - 残る隙間の構造原因と、なぜ誰も解いていないか（P2）
   - 反対仮説（P3）
   - 市場定義の見込み（P6 判定のみ）
   - なぜ今か（P15）
   - 反証パスの結果と Reality Check（P31）

7. 次にやるべき検証（P32、上位3件の表）

8. Coverage Matrix（実行したPhaseのみ。SKILL.md 6章）
```

---

## Quick Diagnosis 形式

```text
1. 結論（3文以内）
   - 市場定義の判定: 新カテゴリー / サブカテゴリー / 再ポジショニング
   - 最大の勝ち筋:
   - 最大のリスク:

2. 先行事例（P0.5）
   - 主要な先行事例と、解決していること／していないこと
   - 判定と残る隙間

3. 再定義された問題（P2）
   本当の問題は「○○」ではなく「△△」である。

4. 根拠
   - 既存の前提（P1、上位3件）
   - 反対仮説（P3、上位1〜2件）
   - 敵（P4）
   - 市場定義の判定の理由と、選ばなかった2つの理由（P6 判定のみ）

5. Reality Check（P31。反証パスの結果を含む）

6. 次にやるべき検証（P32、上位3件の表）

7. Full Strategyに進む場合に必要な追加情報（P32 の上位3件に入らなかった未検証事項の検証方法を含む）

8. Coverage Matrix（実行したPhaseのみ。SKILL.md 6章）
```

---

## Single Phase 形式

```text
1. 対象Phaseと、その問い
2. 先行事例の確認（P0.5）の結果。省略した場合はその理由
3. 前提（前のPhaseの結論を仮置きしたもの）
4. 対象Phaseの出力（各referencesファイルの出力形式に従う）
5. 前提が崩れた場合に結論がどう変わるか
6. 未検証事項と検証方法
7. Coverage Matrix（P0、P0.5、対象Phaseのみ。SKILL.md 6章）
```
