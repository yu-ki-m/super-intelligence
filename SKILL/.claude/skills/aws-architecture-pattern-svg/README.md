# AWS Architecture Pattern SVG Generator

このパッケージは、AWSの中級～上級者向けデザインパターンを、通信経路を中心とするSVG図で学ぶためのエージェントスキルです。

## 内容

- `SKILL.md` — スキルのトリガー、既定条件、作業手順、品質基準
- `references/pattern-selection.md` — パターン選定と最近の機能を調査する方針
- `references/diagram-contract.md` — AWSの境界・通信線・SVGの表現規則
- `scripts/validate_svg.py` — SVG構文と外部依存の簡易チェック（Python標準ライブラリのみ）
- `assets/layout-reference.png` — ユーザー提供の図の視覚スタイル参考（図の接続・正確性を保証するものではない）

## 利用

対応している ChatGPT の「Skills」機能では、Skills → Create → Upload from your computer に、このフォルダをまとめたZIPをアップロードします。利用できるかどうかはアカウント/ワークスペースの設定に依存します。Claude Code等のAgent Skills互換環境では、`SKILL.md` を含むフォルダを、その環境のスキル配置先に配置してください。

## SVGチェック

```sh
python scripts/validate_svg.py /path/to/pattern-*.svg
```

XML/外部リソースの簡易検査のみです。AWSの実現可能性、文字重なり、リージョンの配置、通信方向等は別途確認してください。
