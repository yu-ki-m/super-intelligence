#!/usr/bin/env python3
"""役割の定義から references/agent-roles.md を生成する。正本は graphs/roles.json である。"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HEAD = """# 50役割の定義

この文書は `graphs/roles.json` から生成している。直接編集しない。

50役割は業務の初期分担であり、人間50人分の生産性を達成した証拠ではない。役割は注意を向ける観点を分けるものであり、架空の経歴、実際の顧客を代表する権限、独立した実証データがあることを意味しない。各役割には共通の依頼目的と、その仕事に必要な資料を渡す。50役割分の全履歴を全員へ配布しない。関連する原資料への参照は残し、要約だけで確認できない主張は原資料を確認させる。

全員に提案、具体的な称賛、批判、反論、修正の権限がある。提案する人と否定する人を固定しない。同じ成果物の作成者と最終検査者は別インスタンスにする。依頼範囲に該当する仕事がない役割は起動せず、理由を記録する。1役割を1体へ永久に固定せず、成果物と依存関係を基準に割り当てる。G01 は親の会話の役割に相当するが、判断の作業はハーネスが起動するインスタンスが行い、親の案や統合結果も批判の対象になる。

役割間の依存関係と実行の順序は `graphs/standard.graph.json` にある。例えば B03 の選択理由は C02 と M03 の結果を参照して作り、D02 の紹介ページは採用された戦略に基づいて作り、V05 が実際の機能・運用条件と照合する。役割と成果物の種類の対応により、適用する品質契約（`quality/contracts.json`）が決まる。
"""


def main():
    data = json.loads((ROOT / "graphs" / "roles.json").read_text(encoding="utf-8"))
    groups = {}
    for role in data["roles"]:
        groups.setdefault(role["group"], []).append(role)
    parts = [HEAD]
    for group, roles in groups.items():
        parts.append(f"## {group}（{len(roles)}役割）")
        for r in roles:
            extra = []
            if r.get("stages"):
                extra.append(f"提供段階の条件：{'、'.join(r['stages'])} のときだけ実施する")
            if r.get("deliverable_tag"):
                extra.append(f"依頼範囲の条件：`deliverables` に「{r['deliverable_tag']}」があるときだけ実施する（`deliverables` が空なら実施する）")
            rows = [
                f"### {r['id']} {r['name']}",
                f"- 入力：{r['inputs']}",
                f"- 作業：{r['work']}",
                f"- 成果物：{r['deliverable']}（品質契約 `{r['artifact_type']}`）",
                f"- 完了条件：{r['done_when']}",
                f"- 検査担当：{r['reviewer']}",
                f"- 提案・評価・応答の責任：{r['responsibility']}",
            ] + [f"- {e}" for e in extra]
            parts.append("\n".join(rows))
    (ROOT / "references" / "agent-roles.md").write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    print(f"{len(data['roles'])} 役割を書き出した")


if __name__ == "__main__":
    main()
