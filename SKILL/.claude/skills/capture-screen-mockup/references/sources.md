# 出典と実装上の判断

確認日: 2026-10-12

- https://github.com/gildas-lormeau/SingleFile — 単一HTMLでWeb画面を保存する元プロジェクト。
- https://github.com/gildas-lormeau/single-file-core — getPageDataを持つ保存エンジン。本スキルではnpmの1.6.28を固定し、esbuildでbrowser bundleを生成する。
- https://github.com/gildas-lormeau/single-file-cli — 別起動でのURL保存用CLI。操作中の同一タブを優先するため本スキルの標準経路では使わない。
- https://github.com/microsoft/playwright-mcp — --cdp-endpointを用いて既存Chromiumへ接続する公式MCP。

SingleFile Coreのpackage表記はAGPL-3.0-or-later。依存元のLICENSEと著作権表示を維持する。本スキルにSingleFileのソースや生成bundleを同梱せず、利用環境で依存を取得してビルドする。依存ライセンスが消えるという意味ではない。配布形態を変更する場合は依存元の条件を確認する。

取得方式はPlaywright PageへのSingleFile bundle注入とgetPageData呼び出し。ブラウザ標準fetchを用いるため、拡張機能版と同じ権限は持たない。CORS制限等のため同等の保存率を保証しない。
