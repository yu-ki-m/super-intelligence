# System Evidence Guide

## Evidence Type

- CODE: 実装コード
- TEST: 自動テスト
- SCHEMA: DB/型/スキーマ
- API: API定義
- CONFIG: 設定
- DOC: 設計・仕様文書
- HISTORY: Git履歴
- USER: ユーザー明示情報
- INFERENCE: 推論

## Confidence

### HIGH
複数の実装証拠が一致する、または実行可能なテストで確認できる。

### MEDIUM
単一の強い実装証拠があるが、周辺仕様まで確定できない。

### LOW
文書のみ、古い履歴のみ、推論のみ、または証拠が矛盾する。

LOWを業務モデルの中核依存に使用してはならない。
