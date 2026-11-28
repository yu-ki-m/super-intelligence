// example-codebase-guide.data.ts
//
// example-codebase-guide.flow.ts のデータ定義。引数と結果の型、作業の間で受け渡す型、作業に渡す決まりを置く。
// 手順（関数・実施・goto）は flow.ts に置く。

// ===== 引数と結果 =====

export type 生成オプション = {
  並列数?: number;               // --concurrency
  含めるディレクトリ?: string[];  // --include-dir（既定で除外されるものを個別に含める。複数可）
  含めるファイル?: string[];      // --include-file（同上）
  ignore済みも含める?: boolean;   // --include-ignored（固定の既定除外は引き続き適用される）
  typescriptの場所?: string;      // --typescript
  javaの場所?: string;            // --java
  定義リンクなし?: boolean;       // --no-xref
};

export type スキル引数 = {
  依頼文: string | null;      // /codebase-guide に続けて書いた文。無ければ null
  スキルの場所: string;
  リポジトリ: string | null;  // 対象リポジトリのルート。null なら現在のディレクトリから求める
  生成オプション: 生成オプション;
  最大やり直し回数: number;   // スキルに上限の記載は無い。直しても失敗が続くときに止めるために足した
  最大読解回数: number;       // スキルに記載なし。コードを読み足す繰り返しを止めるために足した
};

export type 定義リンク情報 = {
  件数: number;
  付けなかった理由: string[];  // 「Definition links: なし。…」の理由や、付けなかったファイルとその理由
};

export type 通常生成の結果 =
  | {
      状態: "完了";
      フォルダーツリー: string;
      対象ファイル数: number;
      生成ページ数: number;
      抜き取り検証: string[];
      定義リンク: 定義リンク情報;
    }
  | { 状態: "失敗"; 理由: string; 問題: string[] };

export type ガイド生成サマリ = {
  表紙: string;                                       // Cover
  ルート数: number;                                   // Routes
  ステップ数: number;                                 // Steps
  指摘件数: Record<string, number>;                   // Notes（種類ごと）
  未確認事項数: number;                               // Unverified
  変更箇所: { 数: number; 順路の外: number } | null;  // Changes（差分が対象のときだけ）
  定義リンク: 定義リンク情報;                         // Definition links
  リンク切れ: number;                                 // Links checked の「リンク切れ」
};

export type ガイド生成の結果 =
  | { 状態: "完了"; サマリ: ガイド生成サマリ }
  | { 状態: "失敗"; 理由: string; 問題: string[] };

export type 実行報告 =
  | { モード: "通常生成"; 結果: 通常生成の結果 }
  | { モード: "ガイド生成"; 結果: ガイド生成の結果 };

// ===== 作業の間で受け渡す型 =====

export type コマンド = {
  プログラム: string;
  引数: string[];
  作業ディレクトリ: string;
};

export type コマンド結果 = {
  終了コード: number;
  標準出力: string;
  標準エラー: string;
};

export type 読む箇所 = {
  ファイル: string;
  探す語: string | null;  // あれば Grep で探して前後を読む。null ならファイルを読む
  理由: string;
};

export type 読んだ内容 = {
  ファイル: string;
  内容: string;
};

export type 判定 = {
  合格: boolean;
  問題: string[];
};

export type スクリプト修正 = {
  原因: string;
  修正: { ファイル: string; 変更前: string; 変更後: string }[];
};

export type 生成サマリ = {
  対象ファイル数: number;      // Input files
  生成ページ数: number;        // Generated pages
  エラー: string[];            // Errors と Count mismatch
  定義リンク: 定義リンク情報;  // Definition links
};

export type 代表ファイル = {
  元ファイル: string;  // リポジトリのルートからの相対パス
  ページ: string;      // 対応する .html
  選んだ理由: "ルート直下" | "2階層以上深い" | "URLエンコードが必要な名前" | "その他";
};

export type ページ観測 = {
  ページ: string;
  存在: boolean;
  抜粋: string;  // ファイル名・相対パス・行番号・トークンクラス・Explorer のリンクの部分
};

export type 差分の指定 =
  | { 種類: "なし" }
  | { 種類: "範囲"; 範囲: string }  // "main...HEAD"、"HEAD~1..HEAD"、"<コミット>"、"working"（未コミットの変更）
  | { 種類: "PR"; PR番号: number }  // PR番号だけが渡された
  | { 種類: "不明" };                // 差分が対象だが、範囲を特定できない

export type 依頼の読み取り = {
  ガイド名: string;         // 短く、内容が分かる名前（例: POST-templates-レビュー）
  差分: 差分の指定;
  レビュー依頼: boolean;    // 「レビュー」「指摘」「問題がないか」などを含む依頼
  ファイルで渡す: boolean;  // 依頼文が長く、--request ではなく --request-file で渡す
};

export type 読解の状態 = {
  入口: string[];                // 変更箇所や依頼の対象にたどり着く入口
  呼び出し関係: string[];        // コードで確かめたもの（「A が B を呼ぶ」と、その場所）
  呼び出し元が未確認: string[];  // DI・動的な呼び出し・イベント経由などで追えなかったもの
  追加で読む箇所: 読む箇所[];    // 空なら読解を終える
};

export type 生成失敗の原因 = {
  直す場所: "guide.json" | "スクリプト";
  説明: string;
};

export type 完了点検の結果 = {
  満たしていない条件: string[];
  戻る先: "なし" | "読解" | "入力の作成";
  追加で読む箇所: 読む箇所[];  // 戻る先が「読解」のとき
};

// 1つの作業だけが返す型
export type ファイルの有無 = { 存在: boolean };
export type ファイルの場所 = { パス: string };
export type 範囲の回答 = { 範囲: string };
export type PRの枝 = { baseRefName: string; headRefName: string };  // gh pr view の出力
export type 掲載の確認 = { 表紙あり: boolean; ツリーに掲載: boolean };

// ===== guide.json（AI が書く入力。項目名はファイルの書式に合わせる） =====

export type 範囲指定 = {
  file: string;         // リポジトリのルートからの相対パス
  anchor: string;       // 対象の行にあるコード片（1行の部分一致）。行番号は書かない
  anchorEnd?: string;   // 範囲の終わりの行のコード片
  lines?: number;       // 範囲の行数
  occurrence?: number;  // anchor が複数行に一致するとき、何番目か（1から）
};

export type ステップ = 範囲指定 & {
  id: string;
  kind?: "entry" | "branch" | "call" | "process" | "data" | "external";
  parent?: string | string[];  // 呼び出し元。複数あれば全部
  callerUnknown?: string;      // 呼び出し元を確かめられなかった理由
  title: string;
  summary?: string;
  body: string;
  branches?: { when: string; then: string; to?: string }[];  // to の無い分岐は処理の終わり
  links?: { to: string; label: string }[];
  unverified?: string;
};

export type 注釈 = 範囲指定 & {
  type: string;  // explain・bug・concern・improve と、noteTypes で足した種類
  title: string;
  body: string;
  fix?: string;
  step?: string;
};

export type ガイド入力 = {
  title: string;
  request: string;
  diff: string | null;
  review: boolean;
  summary: string[];
  steps: ステップ[];
  routes?: { entry: string; title?: string; group?: string; end?: string }[];
  notes?: 注釈[];
  unverified?: (string | { text: string; step?: string })[];
  flow?: {
    auto?: boolean;
    nodes?: { id: string; kind: "db" | "external" | "result" | "other"; label: string; sub?: string }[];
    edges?: { from: string; to: string; label?: string }[];
  };
  noteTypes?: Record<string, {
    label?: string;
    short?: string;
    color?: string;
    shape?: "square" | "circle" | "triangle" | "diamond";
    finding?: boolean;
  }>;
};

// ===== 作業に渡す決まり =====

export const 禁止事項 = [
  "各ソースファイルの本文を順番に読み、HTML を1件ずつ手で書かない",
  "ガイドの HTML を手で書いたり直したりしない。内容は guide.json を直して build-guide.mjs で作り直し、見た目はスクリプトを直す",
  "find の結果をそのまま大量にプロンプトへ読み込まない",
  ".git/ の内部オブジェクトと .codebase-guide-out/ 自身を変換しない",
  "通常確認すべきファイルを拡張子だけで除外しない。既定の除外一覧を変えるときは、依存物・生成物・キャッシュなどである根拠を持つ",
  "既定で除外されないバイナリファイルを、存在しなかったことにしない",
  "レビュー依頼でないのに指摘を書かない",
  "呼び出し関係を名前の一致だけで決めない。確かめられない箇所を、もっともらしい推測でつながない",
  "順路を、変更箇所や定数から始めない",
  "変更箇所や依頼の対象にたどり着く入口を、ステップにせず要約だけで済ませない",
  "呼び出し元が分からないステップを入口（kind: entry）にしない。callerUnknown に理由を書く",
  "レビューの指摘を、件数を減らすためにまとめたり省いたりしない",
  "定義リンクを、名前の一致や正規表現で補わない",
  "typescript や JDK が見つからなくても、利用者の了承なしにインストールしない",
];

// 通常生成の出力が満たすこと。スクリプトが実装している。抜き取り検証とスクリプトの修正で使う
export const 通常生成の要件 = [
  "元ファイルの相対ディレクトリ構造を .codebase-guide-out/ の下に保ち、ファイル名の末尾に .html を足す（index.ts → index.ts.html）",
  "フォルダーツリー.html はリポジトリ全体の階層を表示し、各ファイル名を対応するページへのリンクにする。ガイドがあればガイドの一覧も表示する",
  "コードページは VS Code 風のダーク UI で、ファイル名・相対パス・行番号・コード本文・シンタックスハイライト・左側の Explorer 風ツリー（iframe を使わず各ページに埋め込む）を表示する",
  "Explorer のファイルリンクから別のファイルへ移れる",
  "シンタックスハイライトは生成時に HTML へ埋め込み、表示するときに外部の CDN や npm パッケージを必要としない",
  ".git/ と .codebase-guide-out/ 自身は、例外の指定があっても変換しない",
  "Git リポジトリでは git ls-files -co --exclude-standard で列挙し、ignore されたファイルを変換しない。Git が使えなければファイルシステムを走査する",
  "依存ライブラリ・ビルド成果物・キャッシュ・テスト出力・ローカル状態・lock ファイル・source map・minified・バイナリ・アーカイブ・画像・動画・フォントなどは、.gitignore に無くても既定で除外する",
  "既定で除外されないバイナリはツリーから消さず、「バイナリのため本文表示対象外」と表示するページを作る",
  "シンボリックリンクはリンク先を展開せず、シンボリックリンクとしてページを作る",
  "通常生成をやり直しても .codebase-guide-out/ガイド/ を消さない",
  "TypeScript / JavaScript / Java の識別子は、コンパイラーで求めたリポジトリ内の定義の行へリンクする。リポジトリの外の定義にはリンクしない",
  "typescript や JDK が無い、または解析に失敗したときは、その言語にリンクを付けずに生成を続け、理由を出力する",
];

export const 読み方の基本 = [
  "全ファイルを順に読まない。下準備メモの候補を起点に、必要な範囲だけを読む",
  "呼び出し候補は名前の一致による推定なので、呼び出し関係はコードで確かめる",
  "順路は入口（ボタン操作・画面の初期表示・エンドポイント・ジョブ・イベントの受信・CLI のコマンド・ライブラリの公開関数など、処理のきっかけ）から始める",
];

export const 差分の読み方 = [
  "下準備メモの「変更箇所からさかのぼった入口の候補」を起点に、入口から変更箇所までのつながりをコードで確かめる",
];

export const レビューの読み方 = [
  "順路の各ステップは、そのステップを含む関数全体を読み、そこから呼ぶ入力の検証・共通処理の中身も読む",
];

export const 差分レビューの読み方 = [
  "順路に乗らない変更箇所（下準備メモの「変更を含む関数」）もすべて読む",
];

export const ガイドの書き方 = [
  "指摘はレビュー依頼のとき（review: true）だけ書く。レビュー依頼でなければ解説だけにする",
  "指摘の種類は bug・concern・improve。bug は、特定の入力や状態で誤動作することをコードから示せるものに限る",
  "レビューでは、読んだ範囲ごとに観点（入力、エラー処理、境界と状態、データの整合性、認証・認可、セキュリティ、性能、運用、保守性）を全部確かめる",
  "件数の目安は無い。見つけたものは全部書く。同じ種類の問題が複数の場所にあれば、場所ごとに1件ずつ書く",
  "確かめられないことは推測で埋めない。安全だとコードから確かめられない箇所は concern に、読解上の不明点は unverified に書く",
  "順路は入口から始め、実行される順に並べる。差分やレビューでも、変更箇所（定数・設定値など）から始めず、入口から変更箇所までをつなぐ",
  "変更箇所や依頼の対象にたどり着く入口は、全部 kind: entry のステップにする。画面の操作からエンドポイントへ続く場合は両方を入口にし、API を呼ぶステップの branches の to でエンドポイントにつなぐ",
  "複数の入口から通る処理は、ステップを複製せず parent に呼び出し元を全部書く。共通の処理は、各ルートでそれより先に呼ばれる処理の後ろに置く",
  "呼び出し元を確かめられなかったステップは、入口にせず callerUnknown に理由を書く",
  "エラーで途中で終わる流れは、ルートを分けず、to の無い branches で示す。routes は名前・グループ・終わり方を指定したいときだけ書く",
  "常体（だ・である）で、何が・どこで・どうなるかを具体的に書く",
];

// 機械的に確かめられる条件（終了コード 0、リンク切れ 0 件、表紙とガイド一覧）は、フローの中で確かめる
export const ガイドの完了条件 = [
  "順路が入口から始まり、実行される順に並び、依頼に答えるのに必要なステップを含む。差分・レビューでも、変更箇所は入口からの流れの中に置いている",
  "変更箇所や依頼の対象にたどり着く入口が全部ステップになっていて、入口ごとのルートで読める",
  "レビュー依頼の場合は、順路の各ステップの関数全体と差分のすべての変更箇所を、観点の一覧で確かめたうえで指摘を書いている（問題が無ければ 0 件でよい）",
  "確かめられなかった事項を、未確認事項として残している",
];
