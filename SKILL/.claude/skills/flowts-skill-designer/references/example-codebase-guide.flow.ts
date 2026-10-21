// codebase-guide.flow.ts
//
// スキル codebase-guide（~/.claude/skills/codebase-guide/SKILL.md）の手順を FlowTS 0.4.0 で表したもの（このスキルの例。正は SKILL.md）。
// 出力の形・除外の一覧・定義リンクの解析・guide.json の検査・HTML の生成は、スキルのスクリプトが持つ。
// guide.json の書式の詳細は、スキルの references/guide-format.md が持つ。
// ここでは、手順の順序・分岐・繰り返しと、AI・スクリプト・利用者の役割分担を表す。
//
// 実行環境が提供する能力:
//   shell.exec … コマンドを実行し、終了コード・標準出力・標準エラーを手を加えずに返す
//   file.read  … ファイルを読む・語を探す（Read / Grep に当たる）
//   file.write … ファイルを書く・直す
//   user.ask   … 利用者本人に質問し、回答を返す
// 担当が model で能力を付けた作業は、その能力でファイルを読みながら考える作業を表す。
//
// 実行の例（AI直接実行モード）:
//   関数: codebaseGuide
//   引数: {
//     依頼文: "main...HEAD の差分をレビューしたい",   // 通常生成だけなら null
//     スキルの場所: ".claude/skills/codebase-guide",   // リポジトリの外にあれば絶対パス
//     リポジトリ: null,
//     生成オプション: {},
//     最大やり直し回数: 3,
//     最大読解回数: 10,
//   }

// ===== 引数と結果 =====

type 生成オプション = {
  並列数?: number;               // --concurrency
  含めるディレクトリ?: string[];  // --include-dir（既定で除外されるものを個別に含める。複数可）
  含めるファイル?: string[];      // --include-file（同上）
  ignore済みも含める?: boolean;   // --include-ignored（固定の既定除外は引き続き適用される）
  typescriptの場所?: string;      // --typescript
  javaの場所?: string;            // --java
  定義リンクなし?: boolean;       // --no-xref
};

type スキル引数 = {
  依頼文: string | null;      // /codebase-guide に続けて書いた文。無ければ null
  スキルの場所: string;
  リポジトリ: string | null;  // 対象リポジトリのルート。null なら現在のディレクトリから求める
  生成オプション: 生成オプション;
  最大やり直し回数: number;   // スキルに上限の記載は無い。直しても失敗が続くときに止めるために足した
  最大読解回数: number;       // スキルに記載なし。コードを読み足す繰り返しを止めるために足した
};

type 定義リンク情報 = {
  件数: number;
  付けなかった理由: string[];  // 「Definition links: なし。…」の理由や、付けなかったファイルとその理由
};

type 通常生成の結果 =
  | {
      状態: "完了";
      フォルダーツリー: string;
      対象ファイル数: number;
      生成ページ数: number;
      抜き取り検証: string[];
      定義リンク: 定義リンク情報;
    }
  | { 状態: "失敗"; 理由: string; 問題: string[] };

type ガイド生成サマリ = {
  表紙: string;                                       // Cover
  ルート数: number;                                   // Routes
  ステップ数: number;                                 // Steps
  指摘件数: Record<string, number>;                   // Notes（種類ごと）
  未確認事項数: number;                               // Unverified
  変更箇所: { 数: number; 順路の外: number } | null;  // Changes（差分が対象のときだけ）
  定義リンク: 定義リンク情報;                         // Definition links
  リンク切れ: number;                                 // Links checked の「リンク切れ」
};

type ガイド生成の結果 =
  | { 状態: "完了"; サマリ: ガイド生成サマリ }
  | { 状態: "失敗"; 理由: string; 問題: string[] };

type 実行報告 =
  | { モード: "通常生成"; 結果: 通常生成の結果 }
  | { モード: "ガイド生成"; 結果: ガイド生成の結果 };

// ===== 作業の間で受け渡す型 =====

type コマンド = {
  プログラム: string;
  引数: string[];
  作業ディレクトリ: string;
};

type コマンド結果 = {
  終了コード: number;
  標準出力: string;
  標準エラー: string;
};

type 読む箇所 = {
  ファイル: string;
  探す語: string | null;  // あれば Grep で探して前後を読む。null ならファイルを読む
  理由: string;
};

type 読んだ内容 = {
  ファイル: string;
  内容: string;
};

type 判定 = {
  合格: boolean;
  問題: string[];
};

type スクリプト修正 = {
  原因: string;
  修正: { ファイル: string; 変更前: string; 変更後: string }[];
};

type 生成サマリ = {
  対象ファイル数: number;      // Input files
  生成ページ数: number;        // Generated pages
  エラー: string[];            // Errors と Count mismatch
  定義リンク: 定義リンク情報;  // Definition links
};

type 代表ファイル = {
  元ファイル: string;  // リポジトリのルートからの相対パス
  ページ: string;      // 対応する .html
  選んだ理由: "ルート直下" | "2階層以上深い" | "URLエンコードが必要な名前" | "その他";
};

type ページ観測 = {
  ページ: string;
  存在: boolean;
  抜粋: string;  // ファイル名・相対パス・行番号・トークンクラス・Explorer のリンクの部分
};

type 差分の指定 =
  | { 種類: "なし" }
  | { 種類: "範囲"; 範囲: string }  // "main...HEAD"、"HEAD~1..HEAD"、"<コミット>"、"working"（未コミットの変更）
  | { 種類: "PR"; PR番号: number }  // PR番号だけが渡された
  | { 種類: "不明" };                // 差分が対象だが、範囲を特定できない

type 依頼の読み取り = {
  ガイド名: string;         // 短く、内容が分かる名前（例: POST-templates-レビュー）
  差分: 差分の指定;
  レビュー依頼: boolean;    // 「レビュー」「指摘」「問題がないか」などを含む依頼
  ファイルで渡す: boolean;  // 依頼文が長く、--request ではなく --request-file で渡す
};

type 読解の状態 = {
  入口: string[];                // 変更箇所や依頼の対象にたどり着く入口
  呼び出し関係: string[];        // コードで確かめたもの（「A が B を呼ぶ」と、その場所）
  呼び出し元が未確認: string[];  // DI・動的な呼び出し・イベント経由などで追えなかったもの
  追加で読む箇所: 読む箇所[];    // 空なら読解を終える
};

type 生成失敗の原因 = {
  直す場所: "guide.json" | "スクリプト";
  説明: string;
};

type 完了点検の結果 = {
  満たしていない条件: string[];
  戻る先: "なし" | "読解" | "入力の作成";
  追加で読む箇所: 読む箇所[];  // 戻る先が「読解」のとき
};

// ===== guide.json（AI が書く入力。項目名はファイルの書式に合わせる） =====

type 範囲指定 = {
  file: string;         // リポジトリのルートからの相対パス
  anchor: string;       // 対象の行にあるコード片（1行の部分一致）。行番号は書かない
  anchorEnd?: string;   // 範囲の終わりの行のコード片
  lines?: number;       // 範囲の行数
  occurrence?: number;  // anchor が複数行に一致するとき、何番目か（1から）
};

type ステップ = 範囲指定 & {
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

type 注釈 = 範囲指定 & {
  type: string;  // explain・bug・concern・improve と、noteTypes で足した種類
  title: string;
  body: string;
  fix?: string;
  step?: string;
};

type ガイド入力 = {
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

const 禁止事項 = [
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
const 通常生成の要件 = [
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

const 読み方の基本 = [
  "全ファイルを順に読まない。下準備メモの候補を起点に、必要な範囲だけを読む",
  "呼び出し候補は名前の一致による推定なので、呼び出し関係はコードで確かめる",
  "順路は入口（ボタン操作・画面の初期表示・エンドポイント・ジョブ・イベントの受信・CLI のコマンド・ライブラリの公開関数など、処理のきっかけ）から始める",
];

const 差分の読み方 = [
  "下準備メモの「変更箇所からさかのぼった入口の候補」を起点に、入口から変更箇所までのつながりをコードで確かめる",
];

const レビューの読み方 = [
  "順路の各ステップは、そのステップを含む関数全体を読み、そこから呼ぶ入力の検証・共通処理の中身も読む",
];

const 差分レビューの読み方 = [
  "順路に乗らない変更箇所（下準備メモの「変更を含む関数」）もすべて読む",
];

const ガイドの書き方 = [
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
const ガイドの完了条件 = [
  "順路が入口から始まり、実行される順に並び、依頼に答えるのに必要なステップを含む。差分・レビューでも、変更箇所は入口からの流れの中に置いている",
  "変更箇所や依頼の対象にたどり着く入口が全部ステップになっていて、入口ごとのルートで読める",
  "レビュー依頼の場合は、順路の各ステップの関数全体と差分のすべての変更箇所を、観点の一覧で確かめたうえで指摘を書いている（問題が無ければ 0 件でよい）",
  "確かめられなかった事項を、未確認事項として残している",
];

// ===== 補助関数（ステップを持たない通常の関数） =====

function スクリプトの場所(引数: スキル引数): string {
  return `${引数.スキルの場所}/scripts`;
}

function コマンド実行(コマンド: コマンド): Promise<コマンド結果> {
  return 実施<コマンド結果>(
    "コマンドを実行し、終了コードと出力を手を加えずに返す",
    { コマンド },
    { 担当: "tool", 能力: "shell.exec" }
  );
}

function 生成の引数(引数: スキル引数, ルート: string): string[] {
  const o = 引数.生成オプション;
  return [
    `${スクリプトの場所(引数)}/generate-html-code.mjs`,
    "--root", ルート,
    ...(o.並列数 === undefined ? [] : ["--concurrency", String(o.並列数)]),
    ...(o.含めるディレクトリ ?? []).flatMap(d => ["--include-dir", d]),
    ...(o.含めるファイル ?? []).flatMap(f => ["--include-file", f]),
    ...(o.ignore済みも含める ? ["--include-ignored"] : []),
    ...(o.typescriptの場所 === undefined ? [] : ["--typescript", o.typescriptの場所]),
    ...(o.javaの場所 === undefined ? [] : ["--java", o.javaの場所]),
    ...(o.定義リンクなし ? ["--no-xref"] : []),
  ];
}

function 読み方(レビュー依頼: boolean, 差分あり: boolean): string[] {
  return [
    ...読み方の基本,
    ...(差分あり ? 差分の読み方 : []),
    ...(レビュー依頼 ? レビューの読み方 : []),
    ...(レビュー依頼 && 差分あり ? 差分レビューの読み方 : []),
  ];
}

// ===== 入口 =====

// 戻り値を利用者へ伝える。定義リンクが 0 件なら、その理由もそのまま伝える。
export async function codebaseGuide(引数: スキル引数): Promise<実行報告> {
  let ルート: string | null = 引数.リポジトリ;

  ルートの確定: {
    if (ルート !== null) goto モードの判定;

    const git = await コマンド実行({
      プログラム: "git",
      引数: ["rev-parse", "--show-toplevel"],
      作業ディレクトリ: ".",
    });
    if (git.終了コード === 0) {
      ルート = git.標準出力.trim();
      goto モードの判定;
    }

    // Git が使えなければ現在のディレクトリを使う（スクリプトはファイルシステムの走査に切り替える）
    const 現在 = await コマンド実行({
      プログラム: "node",
      引数: ["-p", "process.cwd()"],
      作業ディレクトリ: ".",
    });
    ルート = 現在.標準出力.trim();
    goto モードの判定;
  }

  モードの判定: {
    if (引数.依頼文 === null || 引数.依頼文.trim() === "") goto 通常生成モード;
    goto ガイド生成モード;
  }

  通常生成モード: {
    if (ルート === null) throw new Error("ルートが決まっていない");
    return { モード: "通常生成", 結果: await 通常生成(引数, ルート) };
  }

  ガイド生成モード: {
    if (ルート === null || 引数.依頼文 === null) throw new Error("ルートまたは依頼文が無い");
    // .codebase-guide-out/ が無い、または古い場合の通常生成は、下準備のスクリプトが行う
    return { モード: "ガイド生成", 結果: await ガイド生成(引数, ルート, 引数.依頼文) };
  }
}

// ===== 通常生成 =====

async function 通常生成(引数: スキル引数, ルート: string): Promise<通常生成の結果> {
  const 出力先 = `${ルート}/.codebase-guide-out`;
  const スクリプト = スクリプトの場所(引数);
  let 出力: コマンド結果 | null = null;
  let サマリ: 生成サマリ | null = null;
  let 抜き取り: string[] = [];
  let 問題: string[] = [];
  let やり直し回数 = 0;

  生成: {
    出力 = await コマンド実行({
      プログラム: "node",
      引数: 生成の引数(引数, ルート),
      作業ディレクトリ: ルート,
    });
    if (出力.終了コード !== 0) {
      問題 = [`終了コード ${出力.終了コード}`, 出力.標準エラー];
      goto 原因の調査;
    }
    goto 件数の確認;
  }

  件数の確認: {
    if (出力 === null) throw new Error("生成の出力が無い");

    const 読み取り = await 実施<生成サマリ>(
      "スクリプトの出力から Input files・Generated pages・Errors・Count mismatch・Definition links を読み取る。出力に無い値は作らない",
      { 標準出力: 出力.標準出力, 標準エラー: 出力.標準エラー }
    );
    サマリ = 読み取り;

    const ツリー = await 実施<{ 存在: boolean }>(
      "フォルダーツリー.html があるかを確かめる",
      { パス: `${出力先}/フォルダーツリー.html` },
      { 担当: "tool", 能力: "file.read" }
    );

    問題 = [...読み取り.エラー];
    if (!ツリー.存在) 問題.push("フォルダーツリー.html が無い");
    if (読み取り.対象ファイル数 !== 読み取り.生成ページ数) {
      問題.push(`対象ファイル ${読み取り.対象ファイル数} 件に対して、生成したページが ${読み取り.生成ページ数} 件`);
    }

    if (問題.length > 0) goto 原因の調査;
    goto 抜き取り検証;
  }

  抜き取り検証: {
    const 代表 = await 実施<代表ファイル[]>(
      "通常生成の記録にあるファイル一覧から、ルート直下・2階層以上深い・日本語や空白などURLエンコードが必要な名前（あれば）のファイルを選び、合わせて3件以上にする。一覧全体をプロンプトへ読み込まない",
      { 記録: `${出力先}/.codebase-guide.json` },
      { 担当: "tool", 能力: "shell.exec" }
    );

    const 観測 = await Promise.all(
      代表.map(f =>
        実施<ページ観測>(
          "変換したページを開き、ファイル名・相対パス・行番号・トークンクラス・Explorer のリンクの部分を抜き出す",
          { ページ: f.ページ },
          { 担当: "tool", 能力: "file.read" }
        )
      )
    );

    const 結果 = await 実施<判定>(
      "観測したページが、通常生成の要件のうちコードページとリンクに関するものを満たすかを判定する",
      { 代表, 観測, 要件: 通常生成の要件 }
    );

    抜き取り = 代表.map(f => `${f.選んだ理由}: ${f.元ファイル}`);
    if (!結果.合格) {
      問題 = 結果.問題;
      goto 原因の調査;
    }
    goto 報告;
  }

  原因の調査: {
    やり直し回数++;
    if (やり直し回数 > 引数.最大やり直し回数) goto 打ち切り;

    // 欠けたページを AI が手で補わない。原因を特定してスクリプトを直し、生成し直す
    const 修正 = await 実施<スクリプト修正>(
      "問題の原因を、スクリプトとその出力から特定し、スクリプトの直し方を決める",
      { 問題, スクリプト, 要件: 通常生成の要件, 禁止事項 },
      { 担当: "model", 能力: "file.read" }
    );
    await 実施<void>(
      "決めた修正をスクリプトに反映する",
      { 修正: 修正.修正 },
      { 担当: "tool", 能力: "file.write" }
    );
    goto 生成;
  }

  報告: {
    if (サマリ === null) throw new Error("件数サマリが無い");
    return {
      状態: "完了",
      フォルダーツリー: `${出力先}/フォルダーツリー.html`,
      対象ファイル数: サマリ.対象ファイル数,
      生成ページ数: サマリ.生成ページ数,
      抜き取り検証: 抜き取り,
      定義リンク: サマリ.定義リンク,
    };
  }

  打ち切り: {
    return {
      状態: "失敗",
      理由: `スクリプトを ${引数.最大やり直し回数} 回直しても問題が残った`,
      問題,
    };
  }
}

// ===== ガイド生成 =====

async function ガイド生成(
  引数: スキル引数,
  ルート: string,
  依頼文: string
): Promise<ガイド生成の結果> {
  const スクリプト = スクリプトの場所(引数);
  let 読み取り: 依頼の読み取り | null = null;
  let 読み方の一覧: string[] = [];
  let 差分範囲: string | null = null;
  let 下準備メモ = "";
  let guideJsonの場所 = "";
  let 次に読む: 読む箇所[] = [];
  let 読んだもの: 読んだ内容[] = [];
  let 読解: 読解の状態 | null = null;
  let 書式 = "";
  let 書いた入力: ガイド入力 | null = null;
  let 検査の指摘: string[] = [];
  let サマリ: ガイド生成サマリ | null = null;
  let やり直し回数 = 0;
  let 読解回数 = 0;

  依頼の解釈: {
    const 結果 = await 実施<依頼の読み取り>(
      "依頼文から、ガイド名・差分の範囲・レビュー依頼かどうか・依頼文をファイルで渡すかを決める。差分が対象でなければ、差分の種類は「なし」にする",
      { 依頼文 }
    );
    読み取り = 結果;
    読み方の一覧 = 読み方(結果.レビュー依頼, 結果.差分.種類 !== "なし");

    switch (結果.差分.種類) {
      case "なし":
        goto 下準備;
      case "範囲":
        差分範囲 = 結果.差分.範囲;
        goto 下準備;
      case "PR":
        goto PRの範囲;
      case "不明":
        goto 範囲の確認;
    }
    throw new Error("不明な差分の指定");
  }

  PRの範囲: {
    if (読み取り === null || 読み取り.差分.種類 !== "PR") throw new Error("PR番号が無い");

    const pr = await コマンド実行({
      プログラム: "gh",
      引数: ["pr", "view", String(読み取り.差分.PR番号), "--json", "baseRefName,headRefName"],
      作業ディレクトリ: ルート,
    });
    if (pr.終了コード !== 0) goto 範囲の確認;

    const 枝 = JSON.parse(pr.標準出力) as { baseRefName: string; headRefName: string };
    差分範囲 = `${枝.baseRefName}...${枝.headRefName}`;
    goto 下準備;
  }

  範囲の確認: {
    // 差分が対象なのに範囲を特定できないときだけ、利用者に確かめる
    const 回答 = await 実施<{ 範囲: string }>(
      "どの差分を対象にするか（main...HEAD、HEAD~1..HEAD、コミット、working のいずれか）を利用者本人に確かめる",
      { 依頼文 },
      { 担当: "human", 能力: "user.ask" }
    );
    差分範囲 = 回答.範囲;
    goto 下準備;
  }

  下準備: {
    if (読み取り === null) throw new Error("依頼を解釈していない");

    let 依頼の渡し方 = ["--request", 依頼文];
    if (読み取り.ファイルで渡す) {
      const 書いた = await 実施<{ パス: string }>(
        "依頼文を一時ファイルに書き、そのパスを返す",
        { 内容: 依頼文 },
        { 担当: "tool", 能力: "file.write" }
      );
      依頼の渡し方 = ["--request-file", 書いた.パス];
    }

    // .codebase-guide-out/ が無い、または古い場合は、このスクリプトが通常生成もやり直す
    const 実行 = await コマンド実行({
      プログラム: "node",
      引数: [
        `${スクリプト}/prepare-guide.mjs`,
        "--root", ルート,
        ...依頼の渡し方,
        "--name", 読み取り.ガイド名,
        ...(差分範囲 === null ? [] : ["--diff", 差分範囲]),
      ],
      作業ディレクトリ: ルート,
    });
    if (実行.終了コード !== 0) {
      return { 状態: "失敗", 理由: "下準備（prepare-guide.mjs）が失敗した", 問題: [実行.標準エラー] };
    }

    // 変更行・変更を含む関数・呼び出し候補・入口の候補・guide.json の場所が出る（guide.brief.md にも保存される）
    下準備メモ = 実行.標準出力;
    const 場所 = await 実施<{ パス: string }>(
      "下準備の出力から guide.json の場所を読み取る",
      { 下準備メモ }
    );
    guideJsonの場所 = 場所.パス;
    goto 読む箇所の選定;
  }

  読む箇所の選定: {
    次に読む = await 実施<読む箇所[]>(
      "下準備メモの候補を起点に、最初に読む箇所を決める",
      { 依頼文, 下準備メモ, 読み方: 読み方の一覧, 禁止事項 }
    );
    goto コードを読む;
  }

  コードを読む: {
    const 内容 = await Promise.all(
      次に読む.map(箇所 =>
        実施<読んだ内容>(
          "指定の箇所を読む。探す語があれば Grep で探し、一致した前後を読む",
          { 箇所 },
          { 担当: "tool", 能力: "file.read" }
        )
      )
    );
    読んだもの.push(...内容);
    goto 読解の整理;
  }

  読解の整理: {
    const 状態 = await 実施<読解の状態>(
      "読んだコードで、入口から依頼の対象や変更箇所までの呼び出し関係を確かめる。確かめられない呼び出し元は推測でつながずに未確認とし、まだ読む必要がある箇所を挙げる",
      { 依頼文, 下準備メモ, 読んだもの, 読み方: 読み方の一覧, 禁止事項 }
    );
    読解 = 状態;
    読解回数++;

    if (状態.追加で読む箇所.length > 0 && 読解回数 < 引数.最大読解回数) {
      次に読む = 状態.追加で読む箇所;
      goto コードを読む;
    }
    if (書式 !== "") goto 入力の作成;
    goto 書式の確認;
  }

  書式の確認: {
    const 読んだ = await 実施<読んだ内容>(
      "guide.json の書式と書き方を読む",
      {
        箇所: {
          ファイル: `${引数.スキルの場所}/references/guide-format.md`,
          探す語: null,
          理由: "guide.json を書く前に読む",
        },
      },
      { 担当: "tool", 能力: "file.read" }
    );
    書式 = 読んだ.内容;
    goto 入力の作成;
  }

  入力の作成: {
    if (読み取り === null || 読解 === null) throw new Error("依頼の解釈か読解が無い");

    const 下書き = await 実施<ガイド入力>(
      "書式に従って guide.json の内容を書く。検査の指摘があれば、それを直す",
      {
        書式,
        書き方: ガイドの書き方,
        依頼文,
        レビュー依頼: 読み取り.レビュー依頼,
        読解,
        読んだもの,
        検査の指摘,
        禁止事項,
      }
    );
    // 依頼文・差分の範囲・レビュー依頼かどうかは、AI の書いた値ではなく、このフローで決めた値を使う
    const 入力: ガイド入力 = {
      ...下書き,
      request: 依頼文,
      diff: 差分範囲,
      review: 読み取り.レビュー依頼,
    };
    書いた入力 = 入力;

    await 実施<void>(
      "guide.json を書き出す",
      { パス: guideJsonの場所, 内容: 入力 },
      { 担当: "tool", 能力: "file.write" }
    );
    goto ガイドの組み立て;
  }

  ガイドの組み立て: {
    if (読み取り === null) throw new Error("依頼を解釈していない");

    const 実行 = await コマンド実行({
      プログラム: "node",
      引数: [`${スクリプト}/build-guide.mjs`, "--root", ルート, "--name", 読み取り.ガイド名],
      作業ディレクトリ: ルート,
    });
    // guide.json の問題（アンカーが複数行に一致する、順路が入口から始まっていない など）とリンク切れは、終了コード 1 になる
    if (実行.終了コード !== 0) {
      検査の指摘 = [実行.標準エラー, 実行.標準出力];
      goto 生成失敗の対処;
    }

    const 結果 = await 実施<ガイド生成サマリ>(
      "build-guide.mjs の出力から Cover・Routes・Steps・Notes・Unverified・Changes・Definition links・Links checked を読み取る。出力に無い値は作らない",
      { 標準出力: 実行.標準出力 }
    );
    サマリ = 結果;

    if (結果.リンク切れ > 0) {
      検査の指摘 = [`リンク切れ ${結果.リンク切れ} 件`, 実行.標準出力];
      goto 生成失敗の対処;
    }
    goto 完了点検;
  }

  生成失敗の対処: {
    やり直し回数++;
    if (やり直し回数 > 引数.最大やり直し回数) goto 打ち切り;

    // ガイドの HTML は手で直さない。guide.json を直すか、スクリプトを直して作り直す
    const 原因 = await 実施<生成失敗の原因>(
      "build-guide.mjs の失敗が、guide.json の問題か、スクリプトの不具合かを見分ける",
      { 検査の指摘 }
    );
    if (原因.直す場所 === "guide.json") goto 入力の作成;
    goto スクリプトの修正;
  }

  スクリプトの修正: {
    const 修正 = await 実施<スクリプト修正>(
      "build-guide.mjs の不具合の原因を特定し、スクリプトの直し方を決める",
      { 検査の指摘, スクリプト, 禁止事項 },
      { 担当: "model", 能力: "file.read" }
    );
    await 実施<void>(
      "決めた修正をスクリプトに反映する",
      { 修正: 修正.修正 },
      { 担当: "tool", 能力: "file.write" }
    );
    goto ガイドの組み立て;
  }

  完了点検: {
    if (読み取り === null || 読解 === null || 書いた入力 === null) {
      throw new Error("点検に使うものがそろっていない");
    }

    const 掲載 = await 実施<{ 表紙あり: boolean; ツリーに掲載: boolean }>(
      "表紙.html があるか、フォルダーツリー.html のガイド一覧にこのガイドが載っているかを確かめる",
      { ガイド名: 読み取り.ガイド名, 出力先: `${ルート}/.codebase-guide-out` },
      { 担当: "tool", 能力: "file.read" }
    );
    if (!掲載.表紙あり || !掲載.ツリーに掲載) {
      検査の指摘 = ["表紙.html が無いか、フォルダーツリー.html のガイド一覧に載っていない"];
      goto 生成失敗の対処;
    }

    const 点検 = await 実施<完了点検の結果>(
      "書いた guide.json と読解の結果を、ガイド生成の完了条件と照らす。満たしていなければ、コードを読み足すのか、guide.json を直すのかを決める",
      {
        完了条件: ガイドの完了条件,
        依頼文,
        差分: 差分範囲,
        レビュー依頼: 読み取り.レビュー依頼,
        読解,
        入力: 書いた入力,
      }
    );
    if (点検.戻る先 === "なし") goto 報告;

    やり直し回数++;
    検査の指摘 = 点検.満たしていない条件;
    if (やり直し回数 > 引数.最大やり直し回数) goto 打ち切り;

    switch (点検.戻る先) {
      case "読解":
        次に読む = 点検.追加で読む箇所;
        goto コードを読む;
      case "入力の作成":
        goto 入力の作成;
    }
    throw new Error("不明な戻る先");
  }

  報告: {
    if (サマリ === null) throw new Error("生成サマリが無い");
    // 表紙のパス・ルート数・ステップ数・指摘の件数（種類別）・未確認事項の件数・定義リンクの件数（付けなかったファイルがあればその理由）を伝える。
    // 差分が対象なら、変更箇所の数と、そのうち順路の外にある数も伝える
    return { 状態: "完了", サマリ };
  }

  打ち切り: {
    return {
      状態: "失敗",
      理由: `${引数.最大やり直し回数} 回やり直しても完了条件を満たせなかった`,
      問題: 検査の指摘,
    };
  }
}
