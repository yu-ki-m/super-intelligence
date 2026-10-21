"""案件のフォルダを作り、進行の記録（00_進行.md）をひな形から作る。

使い方：
    python new_case.py --base <企画要求のフォルダ> --name <案件名> [--date YYYY-MM-DD]

- <base>/<YYYY_MMDD>_<案件名>/ を作り、00_進行.md をひな形 assets/progress.md から作る。
- ひな形の〔案件名〕と、更新の日時を埋める。
- 01_対話記録.md は Claude が最初の応答のときに、02_分析.md と 03_提案書.md は最初に提案書を作るときに作る。
- 同じ名前のフォルダがあれば、何も書かずに止まる（前の案件を上書きしないため）。
- 作ったフォルダのパスと、使った日付を表示する。
"""
import argparse
import datetime as dt
import sys
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"


def main():
    # Windows の端末の文字コード（cp932 など）でも、表示とエラーの文が化けないようにする
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="企画要求", help="企画要求のフォルダ（既定：作業フォルダの 企画要求）")
    ap.add_argument("--name", required=True, help="案件名（20文字以内）")
    ap.add_argument("--date", help="日付 YYYY-MM-DD（既定：今日）")
    args = ap.parse_args()

    name = args.name.strip()
    if not name or len(name) > 20 or any(c in name for c in r'\/:*?"<>|'):
        sys.exit(r'案件名は1〜20文字で、\ / : * ? " < > | を含めないでください')

    now = dt.datetime.now()
    day = dt.date.fromisoformat(args.date) if args.date else now.date()
    folder = Path(args.base) / f"{day:%Y_%m%d}_{name}"
    if folder.exists():
        sys.exit(f"すでにあります：{folder}")
    folder.mkdir(parents=True)

    text = (ASSETS / "progress.md").read_text(encoding="utf-8")
    text = text.replace("〔案件名〕", name)
    text = text.replace("- 更新：\n", f"- 更新：{day:%Y-%m-%d} {now:%H:%M}\n")
    (folder / "00_進行.md").write_text(text, encoding="utf-8", newline="\n")

    print(folder.resolve())
    print(f"date={day:%Y-%m-%d}")


if __name__ == "__main__":
    main()
