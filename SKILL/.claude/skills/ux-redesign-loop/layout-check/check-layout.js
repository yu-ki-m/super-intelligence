// UI崩れの検査（references/layout-check.md の4章）。
// 開いているページの、今の幅と高さでの崩れの候補を返す。ページの中で実行する関数の式で、
// Playwright MCP の browser_evaluate の function に、このファイルの中身をそのまま渡す
// （Playwright のスクリプトなら page.evaluate(関数の文字列)）。
// 返すのは「崩れの候補」である。意図したはみ出し（横に送る一覧など）も出ることがあるので、
// 候補ごとにスクリーンショットで確かめてから崩れと判定する。
() => {
  const 幅 = document.documentElement.clientWidth;
  const 高さ = window.innerHeight;
  const 問題 = [];
  const 上限 = 8; // 種類ごとに返す要素の数

  const 名前 = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const c = [...el.classList].slice(0, 2).join(".");
    if (c) s += `.${c}`;
    const t = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return t ? `${s}「${t}」` : s;
  };
  const 見える = (el) => {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // 祖先に、その向きにスクロールできる入れ物があるか（あれば、はみ出しは入れ物の中で送れる）
  const 送れる入れ物の中 = (el, 向き) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const st = getComputedStyle(p);
      const ov = 向き === "横" ? st.overflowX : st.overflowY;
      if (ov === "auto" || ov === "scroll") return true;
    }
    return false;
  };
  const 切り取る祖先 = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (st.overflowX === "hidden" || st.overflowX === "clip" || st.overflowY === "hidden" || st.overflowY === "clip") return p;
    }
    return null;
  };
  // 検証用パネルは製品の画面ではないので、検査から外す
  const 検証用パネル = (el) => !!el.closest("[data-ux-panel], .ux-panel, #ux-panel, [aria-label*='検証用']");

  const 全要素 = [...document.body.querySelectorAll("*")].filter((el) => !検証用パネル(el) && 見える(el));
  const 操作要素 = 全要素.filter((el) => el.matches("button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=link], [tabindex]:not([tabindex='-1'])"));

  // 1. ページ全体が横にはみ出す（横スクロールが出る）
  const 全体の幅 = document.documentElement.scrollWidth;
  if (全体の幅 > 幅 + 1) {
    const 原因 = 全要素
      .filter((el) => el.getBoundingClientRect().right > 幅 + 1 && !送れる入れ物の中(el, "横"))
      .filter((el, _, a) => !a.some((o) => o !== el && o.contains(el)))
      .slice(0, 上限)
      .map((el) => `${名前(el)}（右端 ${Math.round(el.getBoundingClientRect().right)}px）`);
    問題.push({ 種類: "ページの横はみ出し", 詳細: `ページの幅 ${全体の幅}px が画面の幅 ${幅}px を超える`, 要素: 原因 });
  }

  // 2. 操作要素が画面の左右の外にあり、送って届かない（ページの横スクロールでも届かない）
  const 切る = (v) => v === "hidden" || v === "clip";
  const ページが横に送れる = 全体の幅 > 幅 + 1
    && !切る(getComputedStyle(document.documentElement).overflowX) && !切る(getComputedStyle(document.body).overflowX);
  const 外の操作 = 操作要素
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const 右に外れる = r.right > (ページが横に送れる ? 全体の幅 : 幅) + 1;
      return (r.left + window.scrollX < -1 || 右に外れる) && !送れる入れ物の中(el, "横");
    })
    .slice(0, 上限).map(名前);
  if (外の操作.length) 問題.push({ 種類: "画面の外の操作要素", 詳細: "左右の画面の外にあり、送っても届かない", 要素: 外の操作 });

  // 3. 文字が入れ物で切られている（省略記号の無い切れと、省略記号での省略を分ける）
  const 切れ = [];
  const 省略 = [];
  for (const el of 全要素) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const st = getComputedStyle(el);
    const 横に切る = (st.overflowX === "hidden" || st.overflowX === "clip") && el.scrollWidth > el.clientWidth + 1;
    const 縦に切る = (st.overflowY === "hidden" || st.overflowY === "clip") && el.scrollHeight > el.clientHeight + 1 && st.webkitLineClamp === "none";
    if (横に切る && st.textOverflow === "ellipsis") 省略.push(名前(el));
    else if (横に切る || 縦に切る) 切れ.push(名前(el));
    else if (st.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1) 省略.push(名前(el));
  }
  // 3b. 幅が足りず、数文字ごとに折り返して縦に潰れた文字（1行に3文字も入らない）
  const 潰れ = 全要素.filter((el) => {
    const 文字 = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (文字.length < 6) return false;
    const r = el.getBoundingClientRect();
    const 大きさ = parseFloat(getComputedStyle(el).fontSize) || 16;
    return r.width < 大きさ * 3 && r.height > 大きさ * 4;
  }).slice(0, 上限).map(名前);
  if (潰れ.length) 問題.push({ 種類: "縦に潰れた文字", 詳細: "幅が足りず、1行に3文字も入らないまま折り返している", 要素: 潰れ });

  if (切れ.length) 問題.push({ 種類: "文字の切れ", 詳細: "省略記号なしに文字が切られている", 要素: 切れ.slice(0, 上限) });
  if (省略.length) 問題.push({ 種類: "文字の省略（要確認）", 詳細: "省略記号で省いている。長い名前どうしを区別できるかを画像で確かめる", 要素: 省略.slice(0, 上限) });

  // 4. 操作要素どうしが重なる（入れ子は除く）
  const 重なり = [];
  const 対象 = 操作要素.slice(0, 400);
  for (let i = 0; i < 対象.length && 重なり.length < 上限; i++) {
    const a = 対象[i].getBoundingClientRect();
    for (let j = i + 1; j < 対象.length && 重なり.length < 上限; j++) {
      if (対象[i].contains(対象[j]) || 対象[j].contains(対象[i])) continue;
      const b = 対象[j].getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) 重なり.push(`${名前(対象[i])} と ${名前(対象[j])}`);
    }
  }
  if (重なり.length) 問題.push({ 種類: "操作要素の重なり", 詳細: "別々の操作要素が重なっている", 要素: 重なり });

  // 5. 画面に見えている操作要素が、ほかの要素（固定の帯・端末の枠・キーボードなど）に覆われている。
  //    開いているダイアログ・シートがあれば、その外は覆われていてよいので見ない
  const 開いた窓 = [...document.querySelectorAll("dialog[open], [aria-modal='true']")].filter(見える);
  const 覆い = 操作要素
    .filter((el) => !開いた窓.length || 開いた窓.some((d) => d.contains(el)))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > 幅 || y > 高さ) return false;
      const 上 = document.elementFromPoint(x, y);
      return 上 && 上 !== el && !el.contains(上) && !上.contains(el) && !検証用パネル(上);
    })
    .slice(0, 上限).map((el) => {
      const r = el.getBoundingClientRect();
      return `${名前(el)} を ${名前(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))} が覆う`;
    });
  if (覆い.length) 問題.push({ 種類: "覆われた操作要素", 詳細: "操作要素の中央が別の要素に覆われていて押せない", 要素: 覆い });

  // 6. 下へ切れて届かない（ページも祖先の入れ物も縦に送れない）
  const ページが縦に送れる = getComputedStyle(document.documentElement).overflowY !== "hidden"
    && getComputedStyle(document.body).overflowY !== "hidden";
  const 届かない = 全要素
    .filter((el) => el.getBoundingClientRect().bottom > 高さ + 1 && !送れる入れ物の中(el, "縦"))
    .filter((el) => !ページが縦に送れる || getComputedStyle(el).position === "fixed")
    .filter((el) => { const p = 切り取る祖先(el); return !p || p.getBoundingClientRect().bottom > 高さ + 1; })
    .filter((el, _, a) => !a.some((o) => o !== el && o.contains(el)))
    .slice(0, 上限).map(名前);
  if (届かない.length) 問題.push({ 種類: "下が切れて届かない", 詳細: `画面の高さ ${高さ}px の下にあり、送って見る手段が無い`, 要素: 届かない });

  // 7. 画像・アイコンの読み込み失敗
  const 壊れた画像 = [...document.images].filter((img) => img.complete && img.naturalWidth === 0 && 見える(img)).slice(0, 上限).map(名前);
  const 空のアイコン = [...document.querySelectorAll("svg use")].filter((u) => {
    const id = (u.getAttribute("href") || u.getAttribute("xlink:href") || "").split("#")[1];
    return id && !document.getElementById(id);
  }).slice(0, 上限).map((u) => `use #${(u.getAttribute("href") || u.getAttribute("xlink:href") || "").split("#")[1]}`);
  if (壊れた画像.length || 空のアイコン.length) 問題.push({ 種類: "画像・アイコンの欠け", 詳細: "読み込めない画像か、ページの中に無いアイコンを指している", 要素: [...壊れた画像, ...空のアイコン] });

  return { 幅, 高さ, 件数: 問題.length, 問題 };
}
