# SVG図解の契約

## レイアウト

- 推奨 canvas/viewBox: 1400×800 前後。背景は白かほぼ白、グリッドはごく薄く。
- 左→右の主要経路、上→下の副経路。折れ線は直交配線とし、矢印とラベルが他要素に重ならないようにする。
- アイコンの真下または右側にサービス名を配置する。専門用語を省略して似たサービスを同一視しない。
- RegionはAWSのリージョナル資源だけ、VPCはVPC所属資源だけ、Subnetは該当リソースだけを包含する。
- ALBなど複数サブネットにまたがる論理リソースは、単一AZのサブネット内のリソースであるかのような誤表現を避ける。AWS Account/Region/VPC/AZを混同しない。
- Route 53やCloudFrontなどグローバルサービスは、AWS Regionボックスの外に配置し必要な論理関係を示す。

## 通信線の表現

| 分類 | 描画 | 例 | 注意 |
|---|---|---|---|
| データプレーン/同期 | 実線、主経路はやや太線 | HTTPS、TCP、SQL | リクエスト方向と必要なら応答経路を区別 |
| 非同期イベント | 破線 | Event、Message、Stream | EventBridge、SQS、Streams等の配送方式は実装に即して |
| DNS/制御/監視 | 点線、控えめな色 | DNS lookup、Configure、Metrics | エンドユーザーのHTTP転送のように描かない |
| IAM/認可関係 | 目立ちすぎない点線 | IAM policy、AssumeRole | トラフィック経路と混同しない |
| 障害・DLQ経路 | 破線+ラベル | Failure、DLQ | 実際にその方式が利用可能な場合に限定 |

必ず線の凡例を図中に記載するか、線の分類が文字ラベルから明白になるようにする。色だけで線を区別しない。

## 分かりやすさを保つ実装要件

1. サービス名は正式名称を優先する。略称は一般的な場合にのみ括弧で記載。
2. 主要ノードに一意のIDを付け、`<g id="...">` で編集単位を分ける。
3. 可視テキストは `<text>` または `<tspan>`。`foreignObject` は使わない。
4. `xmlns="http://www.w3.org/2000/svg"` と、正の値を持つ4要素 `viewBox` が必要。
5. 意味のない直線より、実際の通信機能（例: Private integration / VPC Link）を線または中継ノードのラベルで示す。
6. SVG内JavaScript、リモート画像、外部CSS、外部フォントを使わない。
7. AWS公式アイコンを利用するなら正規に入手した素材のみ。そうでなければ単純な独自記号にする。
8. レンダリング後は線の前後、端点、文字のはみ出し、コントラスト、拡大時の品質を確認する。

## 誤解を生みやすい例

- Route 53 → CloudFront を一方向のHTTP転送として描く: 誤り。DNS解決とHTTPを分ける。
- API GatewayをVPC内部に置く: API Gateway自体の所属先の誤り。VPC Link / private integrationの意味を正確に示す。
- Private Subnetからインターネット到達を無条件に描く: NAT等の条件を確認する。
- RDSを「Subnet外のVPC内部」として表現して終える: 物理配置を見せるときはDBサブネット群を正確に描く。
- セキュリティグループやIAMポリシーをHTTP転送の中継ホップのように描く: 誤り。

## 命名例

- `pattern-01-api-private-integration.svg`
- `pattern-02-eventbridge-pipes.svg`
- `patterns.md` または `README.md` に実装条件/構成/解説/参照先を集約。
