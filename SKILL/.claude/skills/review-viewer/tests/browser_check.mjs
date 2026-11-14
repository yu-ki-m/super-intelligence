// レビュー画面をブラウザで実際に操作して確かめる（任意のテスト）。
//
//   node tests/browser_check.mjs
//
// Playwright が必要。見つからない場合は PLAYWRIGHT_PATH に playwright パッケージのフォルダを指定する。
// 例: PLAYWRIGHT_PATH="$(npm root -g)/@playwright/mcp/node_modules/playwright"
// ブラウザはインストール済みの Chrome（なければ Edge）を使う。BROWSER_CHANNEL=msedge で Edge を指定できる。
//
// 画面は2つのウィンドウに分かれる。レビュー対象のウィンドウ（サーバーの URL のページ）と、
// 判定とコメントを書くレビュー用ウィンドウ（Document Picture-in-Picture か window.open で開く別ウィンドウ）。
// レビュー用ウィンドウも Playwright には新しいページとして見えるので、そのページを直接操作する。

import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "scripts", "review_server.py");
const FIXTURE = path.join(HERE, "fixtures", "mixed");
const PY = process.env.PYTHON || "python";
const SHOTS = process.env.SHOT_DIR || null;

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, "playwright", "playwright-core"].filter(Boolean);
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    tries.push(path.join(root, "playwright"), path.join(root, "@playwright", "mcp", "node_modules", "playwright"),
      path.join(root, "@playwright", "cli", "node_modules", "playwright"));
  } catch (_) {}
  for (const t of tries) {
    try { return require(t); } catch (_) {}
  }
  console.error("Playwright が見つかりません。PLAYWRIGHT_PATH を指定してください。");
  process.exit(3);
}
const { chromium } = loadPlaywright();

let failures = 0;
function check(cond, label, detail) {
  console.log((cond ? "PASS " : "FAIL ") + label + (cond || detail === undefined ? "" : "  -> " + detail));
  if (!cond) failures++;
}

function occupy() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

// 途中の例外でテストが止まっても、起動したサーバーと一時フォルダーを残さない
const servers = [];
const tempDirs = [];
function removeTempDirs() {
  for (const d of tempDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) {}
  }
}
process.on("exit", () => {
  for (const p of servers) { if (p.exitCode === null) p.kill(); }
  removeTempDirs();
});
function startServer(manifest, port, extra = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PY, [SERVER, manifest, "--no-browser", "--port", String(port), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
    servers.push(proc);
    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error("server start timeout: " + out + err)), 15000);
    proc.stdout.on("data", (d) => {
      out += d.toString("utf8");
      const m = out.match(/URL: (http:\/\/127\.0\.0\.1:(\d+)\/)/);
      if (m && !proc._resolved) { proc._resolved = true; clearTimeout(timer); resolve({ proc, url: m[1], port: +m[2], out: () => out }); }
    });
    proc.stderr.on("data", (d) => { err += d.toString("utf8"); });
    proc.on("exit", (code) => { proc.exitCode_ = code; if (!proc._resolved) reject(new Error("exited " + code + ": " + out + err)); });
  });
}

function waitExit(proc, ms) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve(proc.exitCode);
    const t = setTimeout(() => resolve(null), ms);
    proc.on("exit", (code) => { clearTimeout(t); resolve(code); });
  });
}

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rv-ブラウザ-"));
  tempDirs.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "案B", "breaker.txt"), "閉じタグ </script> と <!-- と U+2028[ ]\n", "utf8");
  return dir;
}
const readFb = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"));

async function launch() {
  const channels = process.env.BROWSER_CHANNEL ? [process.env.BROWSER_CHANNEL] : ["chrome", "msedge", undefined];
  for (const channel of channels) {
    try { return await chromium.launch({ channel, headless: true }); } catch (_) {}
  }
  throw new Error("ブラウザを起動できません: " + channels.join(", "));
}

const browser = await launch();
console.log("ブラウザ: " + browser.browserType().name() + " " + browser.version() + (process.env.BROWSER_CHANNEL ? "（" + process.env.BROWSER_CHANNEL + "）" : ""));
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); } };

// 成果物の iframe（/raw/ から読んだページ）が出すエラーは、遮断が働いた結果なので数えない。
// 静的表示の iframe（about:srcdoc）が相対パスの CSS などを読めないのは、仕様どおりの制約なので数えない。
// 離れる直前の保存は、離れたページ側で「読み込み失敗」と遅れて記録される（保存自体は届く）。
// 保存が本当に失敗したかは、feedback.json の中身と画面の保存状態の表示で確かめる。
function watchErrors(p, errors, label) {
  p.on("pageerror", (e) => errors.push(label + ": " + String(e)));
  p.on("console", (m) => {
    const where = m.location().url || "";
    if (m.type() !== "error" || where.includes("/raw/") || where.startsWith("about:srcdoc") || m.text().includes("origin 'null'")) return;
    if (m.text().startsWith("Failed to load resource") && where.endsWith("/api/feedback")) return;
    errors.push(label + ": " + m.text() + " @" + where);
  });
  p.on("dialog", (d) => { errors.push(label + ": unexpected dialog: " + d.message()); d.dismiss(); });
}

// レビュー対象のウィンドウの「レビュー用ウィンドウを開く」を押し、開いた別ウィンドウのページを返す
async function openPanel(page, errors) {
  const [win] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 10000 }),
    page.locator("#openPanelBtn").click(),
  ]);
  if (errors) watchErrors(win, errors, "レビュー用ウィンドウ");
  await win.waitForSelector(".rp-body");
  return win;
}
// 入力のあとの自動保存（0.8秒後）が終わるまで待つ
async function waitSaved(panel) {
  await panel.waitForFunction(() => (document.getElementById("saveStatus").textContent || "").startsWith("保存済み"), null, { timeout: 8000 });
}
const pressedVerdict = (panel) => panel.locator('.verdict-btn[aria-pressed="true"]').textContent().catch(() => "");
const panelKind = (page) => page.evaluate(() => document.documentElement.getAttribute("data-panel"));
const hOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---------------------------------------------------------------------------
// 1. 2つのウィンドウでのレビュー：表示、判定とコメント、保存と復元、完了による終了
// ---------------------------------------------------------------------------
{
  const dir = copyFixture();
  const blocker = await occupy();
  const busyPort = blocker.address().port;
  const srv = await startServer(path.join(dir, "review.json"), busyPort);
  check(srv.port !== busyPort, "既定のポートが使用中なら別のポートで起動する", srv.port);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors, "レビュー対象");

  await page.goto(srv.url);
  await page.waitForSelector("#startView");
  check(await page.title() === "ログイン画面の改善案レビュー — レビュー", "日本語のタイトルが化けずに表示される", await page.title());
  check((await page.locator("#startView").textContent()).includes("案A と案B のどちらを残すか"), "instructions があれば、始める前の画面に説明を出す");
  check(await panelKind(page) === "none", "最初はレビュー用ウィンドウを開いていない");
  check(await page.locator("#startBtn").count() === 1 && await page.locator("#openPanelBtn").count() === 1, "始める前の画面と上部の帯に「レビュー用ウィンドウを開く」がある");
  await shot(page, "01-start");

  let panel = await openPanel(page, errors);
  check(await panelKind(page) === "pip", "Chrome では、常に手前に表示される別ウィンドウ（Document Picture-in-Picture）で開く", await panelKind(page));
  check(await panel.title() === "判定とコメント — ログイン画面の改善案レビュー", "レビュー用ウィンドウのタイトル", await panel.title());
  check(await panel.locator("#itemList .o-entry").count() === 5, "レビュー用ウィンドウの一覧に5項目が並ぶ");
  check((await panel.locator("#itemList .olist-group").allTextContents()).join("|").includes("案A"), "一覧にグループ見出しが表示される");
  check(await page.locator("#startBtn").count() === 0 && (await page.locator("#startView").textContent()).includes("一覧で項目を選ぶと"), "開いた後は、始める前の画面が「一覧で選ぶ」の案内に変わる");
  check((await page.locator("#tbarTools").textContent()).includes("レビュー用ウィンドウに書きます"), "上部の帯に、判定とコメントの書き場所を示す");
  await shot(panel, "02-panel-overview");

  // Markdown（一覧で選ぶと、レビュー対象のウィンドウに成果物が出る）
  await panel.locator("#itemList .o-entry", { hasText: "案Aの提案書" }).click();
  check(await page.locator("#targetTitle").textContent() === "案Aの提案書", "一覧で選んだ項目が、レビュー対象のウィンドウに表示される");
  check(await panel.locator("#itemTitle").textContent() === "案Aの提案書", "レビュー用ウィンドウは、その項目の判定とコメントに切り替わる");
  check((await panel.locator("#itemDesc").textContent()).includes("目的と変更点"), "見てほしいことはレビュー用ウィンドウに出る");
  check(await page.locator(".verdict-btn, textarea, #completeBtn, #itemDesc").count() === 0, "レビュー対象のウィンドウには、判定・コメント・説明・完了の欄が無い");
  const md = page.locator(".md");
  check(await md.locator("h1").textContent() === "ログイン画面の改善案（案A）", "Markdown の見出しが整形される");
  check(await md.locator("table td").count() >= 6, "Markdown の表が整形される");
  check(await md.locator("pre code").textContent().then((t) => t.includes("</script><script>alert(1)</script>")), "コードブロック内の </script> が文字として表示される");
  check(await md.locator("a", { hasText: "危険なリンク" }).count() === 0, "javascript: のリンクはリンクにしない");
  check((await md.textContent()).includes("[危険なリンク](javascript:alert(1))"), "javascript: のリンクは書かれたとおり文字で残す");
  check(await md.locator('a[href="https://example.com"]').count() === 1, "https のリンクはリンクになる");
  check(await md.locator("input[type=checkbox]").count() === 1, "タスクリストがチェックボックスになる");
  check(await md.locator("ol > li > ul > li").count() >= 2, "入れ子のリストが整形される");

  // 判定（数字キー）とコメントは、レビュー用ウィンドウで入力する
  await panel.keyboard.press("2");
  check((await pressedVerdict(panel)).includes("要修正"), "レビュー用ウィンドウで数字キー2を押すと「要修正」になる");
  await panel.locator("#commentBox").fill("目標値の根拠を追記してください。");
  await waitSaved(panel);
  await shot(page, "03-target-markdown");
  await shot(panel, "04-panel-item");

  // HTML（sandbox）。→キーはレビュー用ウィンドウで押しても、レビュー対象のウィンドウが次の項目に変わる
  await panel.locator("#itemTitle").click();
  await panel.keyboard.press("ArrowRight");
  check(await page.locator("#targetTitle").textContent() === "案Aの画面", "レビュー用ウィンドウで→キーを押すと、レビュー対象のウィンドウが次の項目に変わる");
  check(await panel.locator("#itemTitle").textContent() === "案Aの画面", "レビュー用ウィンドウも次の項目になる");
  const frameEl = await page.waitForSelector("iframe");
  const frame = await frameEl.contentFrame();
  await frame.waitForFunction(() => document.getElementById("probe").textContent.includes("親画面へのアクセス: ") && !document.getElementById("probe").textContent.includes("未確認"));
  check((await frame.locator("#probe").textContent()).includes("遮断された"), "HTML 成果物のスクリプトはレビュー画面を操作できない", await frame.locator("#probe").textContent());
  await frame.waitForFunction(() => document.title.startsWith("fetch:"), null, { timeout: 5000 }).catch(() => {});
  const ft = await frame.evaluate(() => document.title);
  check(ft === "fetch:403" || ft === "fetch:blocked", "HTML 成果物から保存 API に書き込めない", ft);
  const bg = await frame.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === "rgb(238, 246, 255)", "HTML 成果物が相対パスの CSS を読める", bg);
  check(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) !== "rgb(255, 0, 0)", "レビュー画面の背景が書き換えられていない");
  const frameH = await frameEl.evaluate((f) => f.getBoundingClientRect().height);
  check(frameH >= 900 - 160, "HTML の成果物は、レビュー対象のウィンドウの高さいっぱいに表示する", frameH);
  await shot(page, "05-target-html");

  // レビュー対象のウィンドウで押した数字キーも、表示中の項目の判定になる
  await page.locator("#tbarWhere").click();
  await page.keyboard.press("1");
  check((await pressedVerdict(panel)).includes("採用"), "レビュー対象のウィンドウで数字キー1を押すと、レビュー用ウィンドウの判定が「採用」になる");
  await page.keyboard.press("0");
  check(await panel.locator('.verdict-btn[aria-pressed="true"]').count() === 0, "0 で判定を外せる");

  // レビュー用ウィンドウを閉じても、開き直せば同じ項目の続きから書ける
  await panel.close();
  await page.waitForSelector("#openPanelBtn", { timeout: 5000 });
  check(await panelKind(page) === "none", "レビュー用ウィンドウを閉じると、上部の帯に「開く」が戻る");
  check(await page.locator("#targetTitle").textContent() === "案Aの画面", "閉じてもレビュー対象のウィンドウの表示はそのまま");
  panel = await openPanel(page, errors);
  check(await panel.locator("#itemTitle").textContent() === "案Aの画面", "開き直すと、表示中の項目の判定とコメントが出る");

  // CSV・画像・バイナリ・存在しないファイル
  await panel.locator("#tabOverview").click();
  await panel.locator("#itemList .o-entry", { hasText: "案Bの根拠データ" }).click();
  check(await panel.locator("#itemFiles button").count() === 3, "ファイルが複数ある項目では、レビュー用ウィンドウにファイルごとの移動ボタンが出る");
  check(await page.locator("pre.code").first().textContent().then((t) => t.includes("新規顧客, 2社")), "CSV が等幅で表示される");
  check(await page.locator(".fmeta", { hasText: "cp932" }).count() === 1, "Shift_JIS の CSV を cp932 として読み、そのことを示す");
  check(await page.locator("pre.code").nth(2).textContent().then((t) => t.includes("りんご")), "cp932 の CSV の日本語が化けない");
  await page.locator(".file-head", { hasText: "売上.csv" }).locator("button", { hasText: "表" }).click();
  check(await page.locator("table.data td", { hasText: '"値引き"あり' }).count() === 1, "CSV を表に切り替えると引用符が解釈される");
  await shot(page, "06-target-csv");
  await panel.locator("#nextBtn").click();
  check(await page.locator("#targetTitle").textContent() === "案Bのロゴ", "レビュー用ウィンドウの「次の項目」で移動する");
  check(await page.locator(".img-wrap img").evaluate((img) => img.complete && img.naturalWidth === 120), "画像がそのまま表示される");
  check(await page.locator(".card-body", { hasText: "表示できない形式" }).count() === 1, "バイナリは表示できない旨とリンクを示す");
  await panel.locator("#nextBtn").click();
  check(await page.locator("#targetTitle").textContent() === "その他（</script> 入りと存在しないファイル）", "タイトルの </script> も文字として表示される");
  check(await page.locator("pre.code").first().textContent().then((t) => t.includes("</script>") && t.includes("<!--")), "</script> を含むファイルが崩れずに表示される");
  check(await page.locator(".error-box", { hasText: "ファイルが見つかりません" }).count() === 1, "存在しないファイルはエラーとして示し、ページは壊れない");
  check(await panel.locator("#nextBtn").textContent() === "一覧へ", "最後の項目では「次の項目」が「一覧へ」になる");

  // 再読み込み：レビュー用ウィンドウは閉じるが、入力は残り、開き直せば復元される
  await page.waitForTimeout(1200);
  const closed = panel.waitForEvent("close", { timeout: 5000 }).then(() => true).catch(() => false);
  await page.reload();
  check(await closed, "レビュー対象のウィンドウを再読み込みすると、レビュー用ウィンドウは閉じる");
  await page.waitForSelector("#openPanelBtn");
  check(await page.locator("#targetTitle").textContent() === "その他（</script> 入りと存在しないファイル）", "再読み込みしても同じ項目を表示する");
  panel = await openPanel(page, errors);
  await panel.locator("#tabOverview").click();
  check(await panel.locator("#itemList .o-entry", { hasText: "案Aの提案書" }).locator(".meta").textContent().then((t) => t.includes("要修正") && t.includes("コメントあり")), "一覧に判定とコメントの状態が出る");
  await panel.locator("#itemList .o-entry", { hasText: "案Aの提案書" }).click();
  check((await pressedVerdict(panel)).includes("要修正"), "再読み込み後も判定が残る");
  check(await panel.locator("#commentBox").inputValue() === "目標値の根拠を追記してください。", "再読み込み後もコメントが残る");
  const counts = await panel.locator("#counts").textContent();
  check(counts.includes("要修正 1") && counts.includes("未判定 4"), "レビュー用ウィンドウの上部に判定ごとの件数が出る", counts);

  const fb1 = readFb(dir);
  check(fb1.status === "in_progress", "途中保存は status: in_progress");
  check(fb1.reviews.filter((r) => r.verdict === null).length === 4, "判定していない項目は verdict: null");
  check(fs.readFileSync(path.join(dir, "feedback.json"), "utf8").includes("目標値の根拠"), "feedback.json に日本語がそのまま保存される");

  // 入力直後（0.8秒待つ前）にレビュー対象のウィンドウを離れても、離れる直前の保存で残る
  await panel.locator("#tabOverview").click();
  await panel.locator("#itemList .o-entry", { hasText: "案Bのロゴ" }).click();
  await panel.locator("#commentBox").fill("色を案Aに合わせる");
  await page.goto("about:blank");
  await new Promise((r) => setTimeout(r, 1000));
  check(readFb(dir).reviews.find((r) => r.id === "b-logo").comment === "色を案Aに合わせる", "入力直後にページを離れてもコメントが保存される");

  // 全体コメントと完了
  await page.goto(srv.url);
  await page.waitForSelector("#startView");
  panel = await openPanel(page, errors);
  check(await panel.locator("#tabOverview[aria-pressed='true']").count() === 1, "項目を表示していないときは、レビュー用ウィンドウは一覧から始まる");
  await panel.locator("#overallBox").fill("案Aを基本に進めてください。");
  await waitSaved(panel);
  check(!(await panel.locator("#saveStatus").textContent()).includes("失敗"), "保存状態の表示に失敗が出ていない", await panel.locator("#saveStatus").textContent());
  await panel.locator("#completeBtn").click();
  const warn = await panel.locator("#unjudgedWarn strong").textContent();
  check(warn === "未判定の項目が 4 件あります。", "完了時に未判定の件数を示して確認する", warn);
  await shot(panel, "07-panel-confirm");
  await panel.locator("#confirmComplete").click();
  await panel.waitForSelector("#doneBanner");
  check((await panel.locator("#doneBanner").textContent()).includes("受け付けました"), "完了後、レビュー用ウィンドウに受付のメッセージが出る");
  check((await page.locator("#banner").textContent()).includes("受け付けました"), "レビュー対象のウィンドウにも受付のメッセージが出る");
  check(await panel.locator("#completeBtn").isDisabled(), "完了後は完了ボタンを押せない");
  const code = await waitExit(srv.proc, 5000);
  check(code === 0, "完了ボタンでサーバーが終了する（終了コード 0）", code);
  check(srv.out().includes("REVIEW_COMPLETE:"), "終了時に REVIEW_COMPLETE を出力する");
  const fb2 = readFb(dir);
  check(fb2.status === "complete" && fb2.reviews.length === 5, "完了時は全項目を含めて status: complete で保存する");
  check(fb2.overall_comment === "案Aを基本に進めてください。", "全体コメントが保存される");
  check(fb2.reviews.every((r) => r.viewed), "表示した項目は viewed: true になる");
  check(errors.length === 0, "ページでスクリプトのエラーが起きない", errors.join(" / "));
  await shot(page, "08-target-done");
  await ctx.close();
  blocker.close();
}

// ---------------------------------------------------------------------------
// 2. 判定の選択肢を変えたとき・判定欄を消したとき
// ---------------------------------------------------------------------------
{
  const dir = copyFixture();
  const custom = path.join(dir, "custom.json");
  fs.writeFileSync(custom, JSON.stringify({
    title: "見出し案の選定",
    verdict: { options: [{ value: "keep", label: "残す", tone: "good" }, "保留", { value: "drop", label: "捨てる", tone: "bad" }, { value: "merge", label: "統合する" }] },
    items: [{ id: "x", title: "見出し1", files: ["案A/提案書.md"] }, { id: "y", title: "見出し2", files: [] }],
  }), "utf8");
  const s1 = await startServer(custom, 0);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(s1.url);
  await page.waitForSelector(".md h1");
  check(await page.locator("#targetTitle").textContent() === "見出し1", "instructions が無ければ、最初の項目の成果物から表示する");
  let panel = await openPanel(page);
  const labels = await panel.locator(".verdict-btn .lbl").allTextContents();
  check(labels.join(",") === "残す,保留,捨てる,統合する", "マニフェストで変えた判定の選択肢が表示される", labels.join(","));
  await panel.keyboard.press("4");
  await page.waitForTimeout(500);
  const fb = readFb(dir);
  check(fb.reviews[0].verdict === "merge" && fb.reviews[0].verdict_label === "統合する", "判定を変えるとすぐ保存される（0.8秒を待たない）");
  await panel.locator("#nextBtn").click();
  check((await page.locator(".stage-empty").textContent()).includes("ファイルがありません"), "ファイルの無い項目は、レビュー対象のウィンドウにその旨を出す");
  await shot(panel, "09-panel-custom");
  s1.proc.kill();

  const nov = path.join(dir, "nov.json");
  fs.writeFileSync(nov, JSON.stringify({ verdict: false, items: [{ id: "x", title: "文章", files: ["案A/提案書.md"] }] }), "utf8");
  const s2 = await startServer(nov, 0);
  await page.goto(s2.url);
  await page.waitForSelector(".md h1");
  panel = await openPanel(page);
  await panel.waitForSelector("#commentBox");
  check(await panel.locator(".verdict-btn").count() === 0, "判定欄を非表示にすると判定ボタンが出ない");
  check(!(await panel.locator("#counts").textContent()).includes("未判定"), "判定欄なしでは未判定の件数を出さない");
  await panel.locator("#completeBtn").click();
  check(await panel.locator("#unjudgedWarn").count() === 0, "判定欄なしでは完了時に未判定の警告を出さない");
  await panel.locator("#confirmComplete").click();
  check(await waitExit(s2.proc, 5000) === 0, "判定欄なしでも完了でサーバーが終了する");
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3. --static（サーバーなし）
// ---------------------------------------------------------------------------
{
  const dir = copyFixture();
  const out = path.join(dir, "静的", "review.html");
  execSync(`"${PY}" "${SERVER}" "${path.join(dir, "review.json")}" --static "${out}"`);
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors, "静的");
  await page.goto("file:///" + out.replace(/\\/g, "/"));
  await page.waitForSelector("#startView");
  let panel = await openPanel(page, errors);
  check(await panelKind(page) === "pip", "静的表示（file://）でも、常に手前に表示される別ウィンドウで開ける", await panelKind(page));
  await panel.locator("#itemList .o-entry", { hasText: "案Aの画面" }).click();
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await frame.waitForFunction(() => !document.getElementById("probe").textContent.includes("未確認"));
  check((await frame.locator("#probe").textContent()).includes("遮断された"), "静的表示でも HTML 成果物は sandbox で隔離される");
  await panel.keyboard.press("1");
  await page.reload();
  await page.waitForSelector("#openPanelBtn");
  panel = await openPanel(page, errors);
  check((await pressedVerdict(panel)).includes("採用"), "静的表示でも再読み込み後に判定が残る（ブラウザ内の控え）");
  await panel.locator("#completeBtn").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), panel.locator("#confirmComplete").click()]);
  check(dl.suggestedFilename() === "feedback.json", "静的表示では完了で feedback.json がダウンロードされる");
  const saved = path.join(dir, "dl.json");
  await dl.saveAs(saved);
  const fb = JSON.parse(fs.readFileSync(saved, "utf8"));
  check(fb.status === "complete" && fb.reviews.length === 5 && fb.reviews.filter((r) => r.verdict === null).length === 4, "ダウンロードした feedback.json の形がサーバー版と同じ");
  check(errors.length === 0, "静的表示でスクリプトのエラーが起きない", errors.join(" / "));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 4. Document Picture-in-Picture が使えないブラウザ：通常の別ウィンドウで開く
// ---------------------------------------------------------------------------
{
  const dir = copyFixture();
  const s = await startServer(path.join(dir, "review.json"), 0);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => { Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }); });
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors, "レビュー対象");
  await page.goto(s.url + "#a-doc");
  await page.waitForSelector(".md h1");
  let panel = await openPanel(page, errors);
  check(await panelKind(page) === "popup", "Document Picture-in-Picture が無ければ、通常の別ウィンドウで開く", await panelKind(page));
  check(await page.locator("#tbarTools button", { hasText: "前に出す" }).count() === 1, "通常の別ウィンドウのときは「前に出す」ボタンを出す");
  await panel.locator(".verdict-btn", { hasText: "不採用" }).click();
  await page.waitForTimeout(500);
  check(readFb(dir).reviews.find((r) => r.id === "a-doc").verdict === "reject", "通常の別ウィンドウでも、判定を押すと保存される");
  await panel.close();
  await page.waitForSelector("#openPanelBtn", { timeout: 5000 });
  check(await panelKind(page) === "none", "通常の別ウィンドウを閉じたことも分かり、「開く」が戻る");
  panel = await openPanel(page, errors);
  check((await pressedVerdict(panel)).includes("不採用"), "開き直すと判定が残っている");
  const popupClosed = panel.waitForEvent("close", { timeout: 5000 }).then(() => true).catch(() => false);
  await page.goto("about:blank");
  check(await popupClosed, "レビュー対象のウィンドウを離れると、通常の別ウィンドウも閉じる");
  check(errors.length === 0, "通常の別ウィンドウでスクリプトのエラーが起きない", errors.join(" / "));
  s.proc.kill();
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 5. 別ウィンドウを開けないとき：案内を出し、選べばこのウィンドウの右側に表示する
// ---------------------------------------------------------------------------
{
  const dir = copyFixture();
  const s = await startServer(path.join(dir, "review.json"), 0);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true });
    window.open = () => null; // ポップアップのブロックを再現する
  });
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors, "レビュー対象");
  await page.goto(s.url + "#a-doc");
  await page.waitForSelector(".md h1");
  await page.locator("#openPanelBtn").click();
  await page.waitForSelector("#dockBtn");
  check((await page.locator("#notice").textContent()).includes("止めました"), "別ウィンドウを開けないと、理由と代わりの方法を示す");
  check(await panelKind(page) === "none", "利用者が選ぶまでは、勝手にこのウィンドウへ表示しない");
  await page.locator("#dockBtn").click();
  await page.waitForSelector("#dock .rp-body");
  check(await panelKind(page) === "dock", "選ぶと、このウィンドウの右側にレビュー用の欄を出す");
  check(await page.locator("#notice").isHidden(), "右側に出したら案内は消える");
  await page.locator("#dock .verdict-btn", { hasText: "採用" }).first().click();
  await page.waitForTimeout(500);
  check(readFb(dir).reviews.find((r) => r.id === "a-doc").verdict === "adopt", "右側の欄でも、判定を押すと保存される");
  check(await page.locator("#undockBtn").count() === 1, "右側に出しているときは「別ウィンドウに移す」を出す");
  check(await hOverflow(page) <= 1, "右側に出しても横にはみ出さない", await hOverflow(page));
  await shot(page, "10-dock");
  check(errors.length === 0, "右側の表示でスクリプトのエラーが起きない", errors.join(" / "));
  s.proc.kill();
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 6. 狭い画面
// ---------------------------------------------------------------------------
{
  const dir = copyFixture();
  const s = await startServer(path.join(dir, "review.json"), 0);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(s.url);
  await page.waitForSelector("#startView");
  check(await hOverflow(page) <= 1, "幅390pxでも、始める前の画面が横にはみ出さない", await hOverflow(page));
  await page.goto(s.url + "#a-doc");
  await page.waitForSelector(".md h1");
  check(await hOverflow(page) <= 1, "幅390pxでも、成果物の表示が横にはみ出さない", await hOverflow(page));
  await shot(page, "11-narrow-target");
  const panel = await openPanel(page);
  await panel.setViewportSize({ width: 340, height: 600 });
  check(await hOverflow(panel) <= 1, "幅340pxのレビュー用ウィンドウでも横にはみ出さない", await hOverflow(panel));
  const bodyOverflow = await panel.locator("#panelBody").evaluate((b) => b.scrollWidth - b.clientWidth);
  check(bodyOverflow <= 1, "幅340pxのレビュー用ウィンドウで、中身が横にはみ出さない", bodyOverflow);
  await shot(panel, "12-narrow-panel");
  s.proc.kill();
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(() => {
    Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true });
    window.open = () => null;
  });
  const s2 = await startServer(path.join(dir, "review.json"), 0);
  const page2 = await ctx2.newPage();
  await page2.goto(s2.url + "#a-doc");
  await page2.waitForSelector(".md h1");
  await page2.locator("#openPanelBtn").click();
  await page2.locator("#dockBtn").click();
  await page2.waitForSelector("#dock .rp-body");
  check(await hOverflow(page2) <= 1, "幅390pxで右側の欄を出すと、成果物の下に並び、横にはみ出さない", await hOverflow(page2));
  await shot(page2, "13-narrow-dock");
  s2.proc.kill();
  await ctx2.close();
}

await browser.close();
for (const p of servers) { if (p.exitCode === null) p.kill(); }
await Promise.all(servers.map((p) => waitExit(p, 3000)));
removeTempDirs();
console.log(failures ? `\n${failures} 件失敗` : "\nすべて成功");
process.exit(failures ? 1 : 0);
