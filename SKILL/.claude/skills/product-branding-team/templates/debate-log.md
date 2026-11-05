# 相互討論の記録

`python pbteam.py export` が `output/debate-log.md` に書き出す。実際に送受信した発言に基づき、後から迫力のある会話へ脚色しない。全文と要約は区別し、引用には発言IDを付ける。

## 論点

| 項目 | 内容 |
| --- | --- |
| 論点ID、題名 | 例：`I-debate_change`「現在の方法から変える理由は十分か」 |
| なぜ検討するか | どの判断に使うか |
| 結果 | `resolved`（重大な批判が解消または撤回された）、`unresolved`（未解決のまま提出する）、`unanswered`（提案者の応答が得られなかった） |
| 実行した巡、上限 | |

## 発言

| 項目 | 内容 |
| --- | --- |
| 発言ID | `M12` など |
| 巡 | 第何巡か |
| 発言者、インスタンス | 役割IDとインスタンスID |
| 宛先 | 役割ID |
| 種別 | `critique`（批判）、`support`（支持）、`question`（質問）、`propose`（提案）、`respond`（応答）、`reevaluate`（再評価） |
| 対象 | 成果物ID、版、主張ID、対象の引用 |
| 本文 | 自然な文章の全文 |
| 理由、根拠、成立条件、反例 | |
| 求める修正、維持したい長所、判断が変わる条件 | |
| 応答先、批判 | 応答した発言IDと、再評価が対象とする批判の発言ID |
| 新しい版 | この応答で作られた案の版 |
| 扱い | 批判は `open`、`answered`、`resolved`、`partially_resolved`、`unresolved`、`withdrawn`、`external`。応答は受け入れて修正、条件を限定、反論、撤回、保留 |
| 送達 | `queued`（未送達）、`delivered`（送達済み）と送達した試行 |
| 試行、セッション | 実行の証跡。模擬実装の発言には「模擬」と表示する |

## 記入例（架空。実行記録ではない）

```
M12　第1巡　V03（I-V03-1）→ B08　critique・major
対象：candidate_a v1 の C4／扱い：unresolved／送達：delivered
「依頼を見失わない」は共有表でもできるのではないか。変える理由が示されていない。

M15　第1巡　B08（I-B08-1）→ V03　respond
対象：candidate_a v1／応答先：M12／新しい版：v2／扱い：limit_condition
対象を3名以上で分担する窓口に限定し、…

M17　第1巡　V03（I-V03-1）→ B08　reevaluate
対象：candidate_a／応答先：M15／批判：M12／扱い：partially_resolved
対象の限定で場面は明確になった。ただし共有表の備考欄との違いはまだ示されていない。
```
