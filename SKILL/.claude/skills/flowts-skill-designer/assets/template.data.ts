// <スキル名>.data.ts
//
// <スキル名>.flow.ts のデータ定義。引数と結果の型、作業の間で受け渡す型、作業に渡す決まりを置く。
// 手順（関数・実施・goto）は flow.ts に置く。

// ===== 引数と結果 =====

export type スキル引数 = {
  依頼文: string;
  最大やり直し回数: number;  // スキルに記載なし。直しても失敗が続くときに止めるために足した
};

export type 実行結果 =
  | { 状態: "完了"; 成果物: string; 要約: string[] }
  | { 状態: "失敗"; 理由: string; 問題: string[] };

// ===== 作業の間で受け渡す型 =====

export type コマンド = { プログラム: string; 引数: string[]; 作業ディレクトリ: string };
export type コマンド結果 = { 終了コード: number; 標準出力: string; 標準エラー: string };

export type 依頼の読み取り = {
  対象: string;
  確認が要ること: string[];  // 依頼文だけでは決められないこと
};

export type 確認の回答 = { 対象: string };

export type 判定 = { 合格: boolean; 問題: string[] };

// ===== 作業に渡す決まり =====

export const 禁止事項 = [
  "実行していないコマンドの結果や、得ていない利用者の回答を作らない",
];
