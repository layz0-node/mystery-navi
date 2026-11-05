#!/usr/bin/env node
// ローカルの画面を開いてスクリーンショットを撮る（開発用。アプリ本体からは使わない）。
//
// 使い方:
//   npm run screenshot                                   # WebKit・iPhone相当で ?debug=1 を撮る
//   npm run screenshot -- --name=s1                      # 保存名を変える → screenshots/s1-webkit.png
//   npm run screenshot -- --url="?debug=1&x=1"           # 開くURL（ルートからの相対）
//   npm run screenshot -- --browser=chromium             # Chromium で撮る（必要なときだけ）
//   npm run screenshot -- --full                         # ページ全体を撮る
//   npm run screenshot -- --reduced-motion               # 動きを減らす設定で撮る
//   npm run screenshot -- --steps=scripts/screenshot-steps/phase3.json  # 手順を順に実行して撮る
//
// 手順ファイル（JSON の配列）で使える操作は次の6つだけ。1つの手順に1つの操作を書く。
//   { "fill": "<セレクタ>", "value": "<文字列>" }        入力
//   { "click": "<セレクタ>" }                             クリック（確認ダイアログは「OK」で閉じる）
//   { "select": "<セレクタ>", "value": "<文字列>" }      選択
//   { "wait": <ミリ秒（10000まで）> }                    待つ
//   { "shot": "<保存名>", "full": true }                  撮影 → screenshots/<保存名>-<ブラウザ>.png
//   { "localStorage": { "<キー>": "<文字列>" } }          localStorage に値を置いて、ページを開き直す
// 手順ファイルでは Node 側の任意のコードは実行できない。
//
// このリポジトリのフォルダを Node 標準の http サーバーで配信してから開く（別にサーバーを立てなくてよい）。
// 画像は screenshots/ に保存する（.gitignore 済み。コミットしない）。

import http from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { webkit, chromium, devices } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "screenshots");
const DEVICE = devices["iPhone 15"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function parseArgs(argv) {
  const opts = { browser: "webkit", url: "?debug=1", name: "page", full: false, reducedMotion: false, steps: null };
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    const value = rest.join("=");
    if (key === "browser") opts.browser = value;
    else if (key === "url") opts.url = value;
    else if (key === "name") opts.name = value;
    else if (key === "full") opts.full = true;
    else if (key === "reduced-motion") opts.reducedMotion = true;
    else if (key === "steps") opts.steps = value;
    else throw new Error(`不明な引数です: ${arg}`);
  }
  if (!["webkit", "chromium"].includes(opts.browser)) throw new Error("--browser は webkit か chromium です");
  if (!NAME_PATTERN.test(opts.name)) throw new Error("--name は英数字・-・_・. だけにしてください");
  return opts;
}

const NAME_PATTERN = /^[\w.-]+$/;
const MAX_WAIT_MS = 10000;

// 手順ファイルを読み、決まった6つの操作だけからなるかを検査する
async function loadSteps(file) {
  const steps = JSON.parse(await readFile(path.resolve(ROOT, file), "utf8"));
  if (!Array.isArray(steps)) throw new Error("手順ファイルは配列にしてください");
  const isStr = (v) => typeof v === "string" && v.length > 0;
  steps.forEach((step, i) => {
    const where = `手順${i + 1}`;
    if (step === null || typeof step !== "object" || Array.isArray(step)) throw new Error(`${where}：オブジェクトにしてください`);
    const keys = Object.keys(step);
    const has = (allowed) => keys.every((k) => allowed.includes(k));
    if ("fill" in step || "select" in step) {
      const action = "fill" in step ? "fill" : "select";
      if (!has([action, "value"]) || !isStr(step[action]) || typeof step.value !== "string") throw new Error(`${where}：${action} にはセレクタと value（文字列）が要ります`);
    } else if ("click" in step) {
      if (!has(["click"]) || !isStr(step.click)) throw new Error(`${where}：click にはセレクタが要ります`);
    } else if ("wait" in step) {
      if (!has(["wait"]) || !Number.isInteger(step.wait) || step.wait < 0 || step.wait > MAX_WAIT_MS) throw new Error(`${where}：wait は0〜${MAX_WAIT_MS}のミリ秒にしてください`);
    } else if ("shot" in step) {
      if (!has(["shot", "full"]) || !isStr(step.shot) || !NAME_PATTERN.test(step.shot)) throw new Error(`${where}：shot の保存名は英数字・-・_・. だけにしてください`);
      if ("full" in step && typeof step.full !== "boolean") throw new Error(`${where}：full は true か false です`);
    } else if ("localStorage" in step) {
      const values = step.localStorage;
      if (!has(["localStorage"]) || values === null || typeof values !== "object" || Array.isArray(values) || !Object.values(values).every((v) => typeof v === "string")) {
        throw new Error(`${where}：localStorage は { キー: 文字列 } にしてください`);
      }
    } else {
      throw new Error(`${where}：使えない操作です（fill・click・select・wait・shot・localStorage だけ）`);
    }
  });
  return steps;
}

// 手順を順に実行する。撮影は screenshots/ の中だけに保存する
async function runSteps(page, steps, opts) {
  const saved = [];
  for (const step of steps) {
    if ("fill" in step) await page.fill(step.fill, step.value);
    else if ("select" in step) await page.selectOption(step.select, step.value);
    else if ("click" in step) await page.click(step.click);
    else if ("wait" in step) await page.waitForTimeout(step.wait);
    else if ("localStorage" in step) {
      await page.evaluate((values) => {
        for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v);
      }, step.localStorage);
      await page.reload({ waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
    } else if ("shot" in step) {
      const out = path.join(OUT_DIR, `${step.shot}-${opts.browser}.png`);
      if (path.dirname(out) !== OUT_DIR) throw new Error("保存先が screenshots/ の外です");
      await page.screenshot({ path: out, fullPage: step.full === true });
      saved.push(path.relative(ROOT, out));
    }
  }
  return saved;
}

// リポジトリのフォルダだけを配信する（外に出るパスは404）
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      let file = path.join(ROOT, decodeURIComponent(pathname));
      if (!file.startsWith(ROOT + path.sep) && file !== ROOT) throw new Error("outside");
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const steps = opts.steps ? await loadSteps(opts.steps) : null;
  const server = await startServer();
  const { port } = server.address();
  const browserType = opts.browser === "webkit" ? webkit : chromium;
  const { defaultBrowserType, ...device } = DEVICE;
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({
      ...device,
      locale: "ja-JP",
      reducedMotion: opts.reducedMotion ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    page.on("dialog", (d) => d.accept());
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const url = new URL(opts.url, `http://localhost:${port}/`).href;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await mkdir(OUT_DIR, { recursive: true });
    if (steps) {
      const saved = await runSteps(page, steps, opts);
      for (const s of saved) console.log(`保存しました: ${s}（${opts.browser}・${device.viewport.width}x${device.viewport.height}・${url}）`);
    } else {
      const out = path.join(OUT_DIR, `${opts.name}-${opts.browser}.png`);
      await page.screenshot({ path: out, fullPage: opts.full });
      console.log(`保存しました: ${path.relative(ROOT, out)}（${opts.browser}・${device.viewport.width}x${device.viewport.height}・${url}）`);
    }
    if (errors.length > 0) {
      console.error("ページのエラー:");
      for (const e of errors) console.error(`  - ${e}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
