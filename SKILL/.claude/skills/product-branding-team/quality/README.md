# 品質契約と検査の基準

品質契約とは、作業開始前に「何を提出し、どの状態なら次の担当が使えるか」を定めるものである。各役割が短い所感を提出して終わることを防ぐため、成果物を受け取る担当が利用可能かを判定する。

| ファイル | 内容 |
| --- | --- |
| `contracts.json` | 成果物の種類ごとの契約。基準の版は `criteria_version` にある |
| `agent_preamble.md` | 全インスタンスへ最初に渡す共通の指示（説明の方針を含む） |
| `examples.md` | 良い例と悪い例 |

検査の指示の本文は `harness/prompts.py` の `_review` と `_crosscheck` にある。依頼文は実行ごとに `prompts/` へ保存されるので、実際に何を渡したかを確かめられる。

## 契約の項目

成果物の種類（`id`）、用途（`purpose`）、読み手（`readers`）、必須の判断（`required_decisions`）、必要な根拠（`required_evidence`）、提供条件（`provision_conditions`）、対象外事項（`out_of_scope`）、合否基準（`pass_criteria`）、検査方法（`inspection_method`）、次工程の利用方法（`downstream_use`）を記録する。機械で確かめる内容は `machine_checks`、`required_headings`、`required_structured` に書く。未確認の主張を残してよいかは `delivery.allows_hypothesis` で事前に示す。

## 判定の考え方

文字数・ページ数・引用数の多さを品質の代わりにしない。根拠不足を長文で埋めない。社名や製品名の置換で通用するかという確認は一般論を見つける補助であり、それだけで合否を決めない。

必須項目の欠落、根拠の捏造、未提供機能の断定、未解決の重大な矛盾、依頼した制作物の未作成は、他の評価が高くても不合格とする。見栄えや総合点で相殺しない。軽微な改善点と、判断を誤らせる重大な欠陥を分け、欠陥ごとに該当箇所・理由・修正条件を記録する。

資料不足を明示すれば常に合格になるわけではない。「仮説として比較する案」なら未確認の条件を残せるが、「実績を根拠にした事例記事」に実績がなければ、その成果物は保留である。仮説案の完成と、事実確認済みの対外成果物の完成を別の納品状態にする（`delivery_class` の `hypothesis` と `fact_checked`）。

## 基準の版の扱い

作業の開始時に契約の全文をハッシュ付きで `state.db` に保存し、以後はその版で判定する。`contracts.json` を変更しても、開始済みの作業の基準は変わらない。失敗が続いたから検査基準を下げる変更はできない。基準を変えたら `criteria_version` を上げ、評価（`evals/run_quality_eval.py`）をやり直す。

## 形式検査の一覧

実装は `validators/formal.py` にある。意味の判断は行わない。

| 検査 | 確かめること |
| --- | --- |
| `headings_have_body` | 必須の項目があり、見出しだけで本文がない節がない。文字数は問わない |
| `required_structured` | 必須の整理項目が正しい形式で記入されている |
| `evidence_refs_valid` | 根拠の参照先と資料が実在し、引用が資料にあり、別の製品の根拠でなく、無効になった根拠でない |
| `claims_have_status` | 確認済みの主張に資料に基づく根拠がある |
| `target_not_universal` | 対象が「すべての企業」「誰でも」でない |
| `demand_needs_real_customer` | 需要や顧客の反応の確認済みの主張に、実際の顧客の発言か行動の根拠がある |
| `no_unbacked_absolutes` | 「唯一」「必ず改善」「対応漏れゼロ」などに確認済みの根拠がある |
| `planned_not_current` | 対外的な資料で、登録された開発予定の機能を提供中のように書いていない。「約束しないこと」などの節は対象にしない |
| `planned_capability_status` | 製品の整理で、開発予定の機能を現在の機能に分類していない |
| `alternatives_include_status_quo` | 比較に手作業、内製、現状維持などが含まれる |
| `stale_competitor_info` | 確認済みの競合情報に、1年以内の確認日がある |
| `candidate_has_rejection_basis` | 判断を覆す条件が書かれている |
| `requires_real_evidence` | 事例に実際の顧客の根拠がある。なければ保留にする |

資料一式の機械検査は `validators/crossdoc.py` にあり、構造で判断できるものだけを欠陥とし、文字列の比較に頼るものは内容検査への確認依頼にする（`templates/cross-document-review.md`）。

通過しても内容が正しいとは言えない。例えば、登録していない言い方で開発予定の機能を書いた文章や、実在する引用で別の主張を支えた文章は形式検査を通る。これらは内容検査の役割である。
