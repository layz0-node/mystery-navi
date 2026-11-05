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
  const opts = { browser: "webkit", url: "?debug=1", name: "page", full: false, reducedMotion: false };
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    const value = rest.join("=");
    if (key === "browser") opts.browser = value;
    else if (key === "url") opts.url = value;
    else if (key === "name") opts.name = value;
    else if (key === "full") opts.full = true;
    else if (key === "reduced-motion") opts.reducedMotion = true;
    else throw new Error(`不明な引数です: ${arg}`);
  }
  if (!["webkit", "chromium"].includes(opts.browser)) throw new Error("--browser は webkit か chromium です");
  if (!/^[\w.-]+$/.test(opts.name)) throw new Error("--name は英数字・-・_・. だけにしてください");
  return opts;
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const url = new URL(opts.url, `http://localhost:${port}/`).href;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await mkdir(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, `${opts.name}-${opts.browser}.png`);
    await page.screenshot({ path: out, fullPage: opts.full });
    console.log(`保存しました: ${path.relative(ROOT, out)}（${opts.browser}・${device.viewport.width}x${device.viewport.height}・${url}）`);
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
