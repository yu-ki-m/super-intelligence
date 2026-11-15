# 判断台帳の書式

正式検討で作る `decision-ledger.json` は、報告書の参照と状態を機械的に点検するための補助である。本文を省くためのものではない。JSONはUTF-8で保存する。トップレベルは以下の配列を持つ。該当がない配列は空にし、報告書に理由を書く。goalsとrequirementsは最低1件必要。

| 配列 | 必須項目 | 意味 |
|---|---|---|
| evidence | id, locator, claim | 案件資料・発言・観測の場所と支える主張 |
| goals | id, text, status, evidence_ids | 事業目標または守るべき制約目標 |
| impacts | id, goal_id, actor, change, status, evidence_ids | 行動の変化 |
| contexts | id, name, owner, status, evidence_ids | 境界候補と所有者 |
| requirements | id, goal_id, impact_ids, context_ids, text, acceptance, owner, disposition, status, evidence_ids | 必要な結果と受入条件 |
| decisions | id, requirement_ids, alternatives, selected, rationale, downside, revisit, status, evidence_ids | 構成等の判断 |
| experiments | id, decision_ids, hypothesis, method, falsifier, stop, owner, next_action | 判断を変える検証 |
| issues | id, text, affects, owner, resolve, status | 未決事項と解消方法 |

全IDは台帳内で一意な非空文字列とする。各 `*_ids` / `affects` はIDの配列。`goal_id` は1つの目標ID。複数目標に関わる要件は主目的を1つ選び、本文に副次効果を記す。境界未定ではcontext_idsを空にできるが、要件IDに紐付くissueを作る。非ソフトウェア要件では `context_exemption` に適用外理由を書ける。

行動変化を介さない契約・安全性等の要件はimpact_idsを空にし、`impact_exemption` に理由を記す。欠落を適用外と偽装しない。目標自体もその制約の意味を表すこと。

`status` はgoals/impacts/contexts/requirementsでは `hypothesis` または `confirmed`。confirmedには1つ以上の案件のevidence参照が必要。ownerが未定なら `未確認` と書き、その項目IDに紐付くopen issueを用意する。推測した実名を埋めない。

requirementsのdispositionは `keep`, `change`, `merge`, `split`, `defer`, `remove-candidate`, `add`。merge/splitの新旧対応と廃止候補の影響は本文で説明する。

decisionsのstatusは `proposed`, `accepted`, `deferred`, `superseded`。alternativesは異なる名前を2つ以上持つ配列。selectedはその中の1つかnull。deferredはnullにする。acceptedには証拠と追加項目 `decision_owner`, `decision_date` が必要。proposedを「権限者承認済み」に読み替えない。revisitには期限・トリガーと取得する情報を記す。supersededにした判断には、置き換えた判断のIDを `superseded_by` に書く。古い判断を削除せずに残すのは、なぜ方針が変わったのかを後から追えるようにするためである。

issuesのstatusは `open` または `resolved`。resolvedでも何により解消したかをresolveに残す。affectsには実在IDを指定する。

最小例（架空、未確認を残した初期案）：

```json
{
  "evidence": [],
  "goals": [{"id":"G1","text":"利用開始までの待ちを減らす","status":"hypothesis","evidence_ids":[]}],
  "impacts": [{"id":"I1","goal_id":"G1","actor":"承認者","change":"不足情報の再照会なしで判断できる","status":"hypothesis","evidence_ids":[]}],
  "contexts": [],
  "requirements": [{"id":"R1","goal_id":"G1","impact_ids":["I1"],"context_ids":[],"text":"承認者が判断材料を確認できる","acceptance":"代表申請を使い、不足情報と判断可能性を専門家と確認する。項目は未確定","owner":"未確認","disposition":"add","status":"hypothesis","evidence_ids":[]}],
  "decisions": [{"id":"D1","requirement_ids":["R1"],"alternatives":["入力画面改善","申請案内改善"],"selected":null,"rationale":"不足情報の原因が未確認","downside":"待機中は現行負担が続く","revisit":"代表申請の再照会理由を確認した時点","status":"deferred","evidence_ids":[]}],
  "experiments": [{"id":"X1","decision_ids":["D1"],"hypothesis":"不足情報が待ち時間を増やす","method":"代表申請と再照会記録を突合する","falsifier":"情報が揃っている申請でも同じ待ちがある","stop":"対象記録にアクセスできなければ追加取得に切り替える","owner":"未確認","next_action":"主因が別なら目標から手段を再検討する"}],
  "issues": [{"id":"U1","text":"境界・業務責任者・検証担当の確認","affects":["R1","X1"],"owner":"利用者に確認","resolve":"業務責任者を特定し、代表申請を調査する","status":"open"}]
}
```

検査スクリプトは構造上の欠落に終了コード1、不正JSONに終了コード2を返す。合格でも配列ごとの状態の件数（仮説・保留・未決など）を表示する。

`ERROR` は構造の欠落であり、直す。`WARN` は、多くの場合は抜けだが正当な理由もありうるパターンである。例えば、要件が1つもない目標、どの要件にも使われていない境界や行動変化、置き換え先のない superseded の判断、判断が1件もない台帳。WARN が残る場合は、報告書でその理由を説明できるかを確かめる。

空欄でないことは内容が十分なことを保証しない。数値の根拠、品質の網羅、因果、受入条件の強さ、移行可能性は内容レビューで判断する。
