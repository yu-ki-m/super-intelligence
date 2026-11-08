// レビュー画面をブラウザで実際に操作して確かめる（任意のテスト）。
//
//   node tests/browser_check.mjs
//
// Playwright が必要。見つからない場合は PLAYWRIGHT_PATH に playwright パッケージのフォルダを指定する。
// 例: PLAYWRIGHT_PATH="$(npm root -g)/@playwright/mcp/node_modules/playwright"
// ブラウザはインストール済みの Chrome（なければ Edge）を使う。

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

function startServer(manifest, port, extra = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PY, [SERVER, manifest, "--no-browser", "--port", String(port), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
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
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "案B", "breaker.txt"), "閉じタグ </script> と <!-- と U+2028[ ]\n", "utf8");
  return dir;
}

async function launch() {
  for (const channel of ["chrome", "msedge", undefined]) {
    try { return await chromium.launch({ channel, headless: true }); } catch (_) {}
  }
  throw new Error("ブラウザを起動できません");
}

const browser = await launch();
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); } };

// ---------------------------------------------------------------------------
// 1. 混在した成果物の表示、保存と復元、完了による終了
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
  page.on("pageerror", (e) => errors.push(String(e)));
  // 成果物の iframe（/raw/ から読んだページ）が出すエラーは、遮断が働いた結果なので数えない
  // 離れる直前の保存は、離れたページ側で「読み込み失敗」と遅れて記録される（保存自体は届く）。
  // 保存が本当に失敗したかは、feedback.json の中身と画面の保存状態の表示で確かめる
  page.on("console", (m) => {
    const where = m.location().url || "";
    if (m.type() !== "error" || where.includes("/raw/") || m.text().includes("origin 'null'")) return;
    if (m.text().startsWith("Failed to load resource") && where.endsWith("/api/feedback")) return;
    errors.push(m.text() + " @" + where);
  });
  page.on("dialog", (d) => { errors.push("unexpected dialog: " + d.message()); d.dismiss(); });

  await page.goto(srv.url);
  await page.waitForSelector("#list .list-entry");
  check(await page.title() === "ログイン画面の改善案レビュー — レビュー", "日本語のタイトルが化けずに表示される", await page.title());
  check(await page.locator("#content h2").first().textContent() === "概要と全体コメント", "instructions があれば概要から始まる");
  check((await page.locator("#list .list-entry:not(.list-overview)").count()) === 5, "一覧に5項目が並ぶ");
  check((await page.locator("#list .list-group").allTextContents()).join("|").includes("案A"), "グループ見出しが表示される");
  await shot(page, "01-overview");

  // Markdown
  await page.locator("#list .list-entry", { hasText: "案Aの提案書" }).click();
  const md = page.locator(".md");
  check(await md.locator("h1").textContent() === "ログイン画面の改善案（案A）", "Markdown の見出しが整形される");
  check(await md.locator("table td").count() >= 6, "Markdown の表が整形される");
  check(await md.locator("pre code").textContent().then((t) => t.includes("</script><script>alert(1)</script>")), "コードブロック内の </script> が文字として表示される");
  check(await md.locator("a", { hasText: "危険なリンク" }).count() === 0, "javascript: のリンクはリンクにしない");
  check((await md.textContent()).includes("[危険なリンク](javascript:alert(1))"), "javascript: のリンクは書かれたとおり文字で残す");
  check(await md.locator('a[href="https://example.com"]').count() === 1, "https のリンクはリンクになる");
  check(await md.locator("input[type=checkbox]").count() === 1, "タスクリストがチェックボックスになる");
  check(await md.locator("ol > li > ul > li").count() >= 2, "入れ子のリストが整形される");
  await shot(page, "02-markdown");

  // 判定（数字キー）とコメント
  await page.keyboard.press("2");
  check(await page.locator('.verdict-btn[aria-pressed="true"]').textContent().then((t) => t.includes("要修正")), "数字キー2で「要修正」になる");
  await page.locator("#commentBox").fill("目標値の根拠を追記してください。");
  await page.waitForTimeout(1300);

  // HTML（sandbox）
  await page.keyboard.press("Escape");
  await page.locator("#content").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowRight");
  check(await page.locator("#content h2").textContent() === "案Aの画面", "→キーで次の項目へ移動する");
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
  await shot(page, "03-html");

  // CSV・画像・バイナリ・存在しないファイル
  await page.locator("#list .list-entry", { hasText: "案Bの根拠データ" }).click();
  check(await page.locator("pre.code").first().textContent().then((t) => t.includes("新規顧客, 2社")), "CSV が等幅で表示される");
  check(await page.locator(".fmeta", { hasText: "cp932" }).count() === 1, "Shift_JIS の CSV を cp932 として読み、そのことを示す");
  check(await page.locator("pre.code").nth(2).textContent().then((t) => t.includes("りんご")), "cp932 の CSV の日本語が化けない");
  await page.locator(".file-head", { hasText: "売上.csv" }).locator("button", { hasText: "表" }).click();
  check(await page.locator("table.data td", { hasText: '"値引き"あり' }).count() === 1, "CSV を表に切り替えると引用符が解釈される");
  await shot(page, "04-csv");
  await page.locator("#list .list-entry", { hasText: "案Bのロゴ" }).click();
  check(await page.locator(".img-wrap img").evaluate((img) => img.complete && img.naturalWidth === 120), "画像がそのまま表示される");
  check(await page.locator(".card-body", { hasText: "表示できない形式" }).count() === 1, "バイナリは表示できない旨とリンクを示す");
  await page.locator("#list .list-entry", { hasText: "その他" }).click();
  check(await page.locator("#content h2").textContent() === "その他（</script> 入りと存在しないファイル）", "タイトルの </script> も文字として表示される");
  check(await page.locator("pre.code").first().textContent().then((t) => t.includes("</script>") && t.includes("<!--")), "</script> を含むファイルが崩れずに表示される");
  check(await page.locator(".error-box", { hasText: "ファイルが見つかりません" }).count() === 1, "存在しないファイルはエラーとして示し、ページは壊れない");

  // 再読み込みで復元（保存の途中で再読み込みすると、その要求は「中断」と記録されるため、保存を待つ）
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForSelector("#list .list-entry");
  check(await page.locator("#content h2").textContent() === "その他（</script> 入りと存在しないファイル）", "再読み込みしても同じ項目を開く");
  await page.locator("#list .list-entry", { hasText: "案Aの提案書" }).click();
  check(await page.locator('.verdict-btn[aria-pressed="true"]').textContent().then((t) => t.includes("要修正")), "再読み込み後も判定が残る");
  check(await page.locator("#commentBox").inputValue() === "目標値の根拠を追記してください。", "再読み込み後もコメントが残る");
  check(await page.locator("#list .list-entry", { hasText: "案Aの提案書" }).locator(".meta").textContent().then((t) => t.includes("要修正") && t.includes("コメントあり")), "一覧に判定とコメントの状態が出る");
  const counts = await page.locator("#counts").textContent();
  check(counts.includes("要修正 1") && counts.includes("未判定 4"), "上部に判定ごとの件数が出る", counts);

  const fb1 = JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"));
  check(fb1.status === "in_progress", "途中保存は status: in_progress");
  check(fb1.reviews.filter((r) => r.verdict === null).length === 4, "判定していない項目は verdict: null");
  check(fs.readFileSync(path.join(dir, "feedback.json"), "utf8").includes("目標値の根拠"), "feedback.json に日本語がそのまま保存される");

  // 入力直後（0.8秒待つ前）に離れても、離れる直前の保存で残る
  await page.locator("#list .list-entry", { hasText: "案Bのロゴ" }).click();
  await page.locator("#commentBox").fill("色を案Aに合わせる");
  await page.goto("about:blank");
  await new Promise((r) => setTimeout(r, 1000));
  const fbLeave = JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"));
  check(fbLeave.reviews.find((r) => r.id === "b-logo").comment === "色を案Aに合わせる", "入力直後にページを離れてもコメントが保存される");
  await page.goto(srv.url + "#__overview__");
  await page.waitForSelector("#list .list-entry");

  // 全体コメントと完了
  await page.locator("#list .list-overview").click();
  await page.locator("textarea[aria-label='全体へのコメント']").fill("案Aを基本に進めてください。");
  await page.waitForTimeout(1100);
  check(!(await page.locator("#saveStatus").textContent()).includes("失敗"), "保存状態の表示に失敗が出ていない", await page.locator("#saveStatus").textContent());
  await page.locator("#completeBtn").click();
  const warn = await page.locator("#unjudgedWarn strong").textContent();
  check(warn === "未判定の項目が 4 件あります。", "完了時に未判定の件数を示して確認する", warn);
  await shot(page, "05-confirm");
  await page.locator("#confirmComplete").click();
  await page.waitForSelector(".banner");
  check((await page.locator(".banner").textContent()).includes("受け付けました"), "完了後に受付のメッセージが出る");
  const code = await waitExit(srv.proc, 5000);
  check(code === 0, "完了ボタンでサーバーが終了する（終了コード 0）", code);
  check(srv.out().includes("REVIEW_COMPLETE:"), "終了時に REVIEW_COMPLETE を出力する");
  const fb2 = JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"));
  check(fb2.status === "complete" && fb2.reviews.length === 5, "完了時は全項目を含めて status: complete で保存する");
  check(fb2.overall_comment === "案Aを基本に進めてください。", "全体コメントが保存される");
  check(fb2.reviews.every((r) => r.viewed), "表示した項目は viewed: true になる");
  check(errors.length === 0, "ページでスクリプトのエラーが起きない", errors.join(" / "));
  await shot(page, "06-done");
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
  await page.waitForSelector(".verdict-btn");
  const labels = await page.locator(".verdict-btn .lbl").allTextContents();
  check(labels.join(",") === "残す,保留,捨てる,統合する", "マニフェストで変えた判定の選択肢が表示される", labels.join(","));
  await page.keyboard.press("4");
  await page.waitForTimeout(500);
  const fb = JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"));
  check(fb.reviews[0].verdict === "merge" && fb.reviews[0].verdict_label === "統合する", "判定を変えるとすぐ保存される（0.8秒を待たない）");
  await shot(page, "07-custom");
  s1.proc.kill();

  const nov = path.join(dir, "nov.json");
  fs.writeFileSync(nov, JSON.stringify({ verdict: false, items: [{ id: "x", title: "文章", files: ["案A/提案書.md"] }] }), "utf8");
  const s2 = await startServer(nov, 0);
  await page.goto(s2.url);
  await page.waitForSelector("#commentBox");
  check(await page.locator(".verdict-btn").count() === 0, "判定欄を非表示にすると判定ボタンが出ない");
  check(!(await page.locator("#counts").textContent()).includes("未判定"), "判定欄なしでは未判定の件数を出さない");
  await page.locator("#completeBtn").click();
  check(await page.locator("#unjudgedWarn").count() === 0, "判定欄なしでは完了時に未判定の警告を出さない");
  await shot(page, "08-noverdict");
  await page.locator("#confirmComplete").click();
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
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file:///" + out.replace(/\\/g, "/"));
  await page.waitForSelector("#list .list-entry");
  await page.locator("#list .list-entry", { hasText: "案Aの画面" }).click();
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await frame.waitForFunction(() => !document.getElementById("probe").textContent.includes("未確認"));
  check((await frame.locator("#probe").textContent()).includes("遮断された"), "静的表示でも HTML 成果物は sandbox で隔離される");
  await page.keyboard.press("1");
  await page.reload();
  await page.waitForSelector("#list .list-entry");
  check(await page.locator('.verdict-btn[aria-pressed="true"]').textContent().then((t) => t.includes("採用")).catch(() => false), "静的表示でも再読み込み後に判定が残る（ブラウザ内の控え）");
  await page.locator("#completeBtn").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#confirmComplete").click()]);
  check(dl.suggestedFilename() === "feedback.json", "静的表示では完了で feedback.json がダウンロードされる");
  const saved = path.join(dir, "dl.json");
  await dl.saveAs(saved);
  const fb = JSON.parse(fs.readFileSync(saved, "utf8"));
  check(fb.status === "complete" && fb.reviews.length === 5 && fb.reviews.filter((r) => r.verdict === null).length === 4, "ダウンロードした feedback.json の形がサーバー版と同じ");
  check(errors.length === 0, "静的表示でスクリプトのエラーが起きない", errors.join(" / "));
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 4. 狭い画面
// ---------------------------------------------------------------------------
{
  const dir = copyFixture();
  const s = await startServer(path.join(dir, "review.json"), 0);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(s.url + "#a-doc");
  await page.waitForSelector(".md h1");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, "幅390pxでも横にはみ出さない", overflow);
  await shot(page, "09-narrow");
  s.proc.kill();
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} 件失敗` : "\nすべて成功");
process.exit(failures ? 1 : 0);
