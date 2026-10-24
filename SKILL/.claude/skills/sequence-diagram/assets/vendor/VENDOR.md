# 同梱ライブラリ

## Mermaid

| 項目 | 値 |
|---|---|
| パッケージ | `mermaid`（npm） |
| バージョン | 11.17.2 |
| ファイル | `dist/mermaid.min.js`（IIFE 版。グローバル `mermaid` を定義） |
| SHA-256 | `581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8` |
| SRI（CDN 用） | `sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2` |
| サイズ | 3,572,661 bytes |
| ライセンス | MIT（`mermaid-LICENSE.txt`） |
| 取得元 | https://registry.npmjs.org/mermaid/-/mermaid-11.17.2.tgz |
| 更新日 | 2026-10-24 |

### 採用理由

- シーケンス図の公式構文（alt / opt / loop / par / critical / break / rect / box / autonumber / Note / 活性化）をすべて備え、
  描画結果の SVG 要素に `data-et`（message / note / control-structure / participant / life-line）と `data-id`・`data-from`・`data-to`
  属性が付く。ビューアはこの属性で「モデルのステップ ⇔ SVG 要素」を確実に対応付けている。
- 単一ファイル（IIFE）で配布されており、HTML に埋め込んでオフラインで表示できる。

### 12 系を採用していない理由（2026-10 時点）

- 12.0.0（2026-09 公開）は既定の見た目（look / theme）が変わり、IIFE 版に ELK が同梱されて約 5.5MB（11.17.2 は約 3.6MB）。
  シーケンス図には ELK は使われないため、HTML が大きくなるだけで利点が無い。
- 12 系は ES2024 を前提にしており、更新が制限された企業内ブラウザで動かない可能性がある。
- 11.17.2 は 11 系の最終版で、公開から 2 か月が経過している。

### バージョン管理方針

- **バージョンは固定する**（`scripts/lib/core.cjs` の `MERMAID_VERSION` と、この表）。CDN モードも同じバージョンを SRI 付きで読み込む。
- 更新は `node scripts/update-mermaid.cjs <version>` で行い、更新後は必ず `examples/order-system` を build → verify して、
  全図で対応付けが成立する（メッセージ・注記・枠・ライフラインの数が一致する）ことを確認する。
  data-et 属性の仕様が変わった場合、ビューアは対応付けをあきらめて図だけを表示し、検証タブに警告を出す（図が壊れることはない）。
- 既知の制約（11.17.2）：`participant X@{ "type": "database" }` などの特殊な参加者形状は、名前が長いとアイコンとラベルが重なる。
  このため DB・キューは通常の participant で描き、色と形（角丸・破線）で区別している。
