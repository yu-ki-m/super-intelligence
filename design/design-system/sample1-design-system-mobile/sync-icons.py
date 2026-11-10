"""icons.svg の symbol を、同じフォルダーの HTML（スマートフォン版） に埋め込んだアイコン定義へ書き写す。

使い方: python sync-icons.py
HTML の中の <svg xmlns="http://www.w3.org/2000/svg" style="display:none"> ... </svg> を置き換える。
"""
from pathlib import Path
import re

here = Path(__file__).resolve().parent
icons = (here / "icons.svg").read_text(encoding="utf-8")
symbols = "\n".join(line for line in icons.splitlines() if line.strip().startswith("<symbol"))
block = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n' + symbols + "\n</svg>"
pattern = re.compile(r'<svg xmlns="http://www\.w3\.org/2000/svg" style="display:none">.*?</svg>', re.S)

for html in sorted(here.glob("*.html")):
    text = html.read_text(encoding="utf-8")
    new, n = pattern.subn(lambda _: block, text, count=1)
    if n:
        html.write_text(new, encoding="utf-8")
    print(f"{html.name}: {'更新' if n else '埋め込みなし'}")
