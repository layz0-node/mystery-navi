// ホーム画面対応のファイル（requirements.md 11章）：マニフェスト・アイコン・index.html・sw.js のキャッシュの一覧
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import zlib from "node:zlib";
import { loadServiceWorker } from "./fixtures/fake-sw.js";
import { APP_CACHE_PREFIX } from "../src/debug.js";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, ROOT));
const readText = (path) => readFile(new URL(path, ROOT), "utf8");

// PNG を読み、チャンクの CRC と、画像データの長さが合っているかを確かめる → { width, height, colorType }
function inspectPng(buf, name) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name}：PNG の先頭ではありません`);
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    assert.equal(zlib.crc32(buf.subarray(off + 4, off + 8 + len)) >>> 0, crc, `${name}：${type} の CRC が合いません`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  assert.equal(chunks[0].type, "IHDR", name);
  assert.equal(chunks.at(-1).type, "IEND", name);
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [bitDepth, colorType] = [ihdr[8], ihdr[9]];
  assert.equal(bitDepth, 8, name);
  const channels = { 2: 3, 6: 4 }[colorType];
  assert.ok(channels, `${name}：色の形式 ${colorType} は想定外です`);
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  assert.equal(raw.length, height * (1 + width * channels), `${name}：画像データの長さが合いません`);
  return { width, height, colorType };
}

// ---------- マニフェスト ----------

test("マニフェスト：名前は「指煙魚」、縦向き固定、ホーム画面から枠なしで開く、色は #0a0a0f", async () => {
  const m = JSON.parse(await readText("manifest.webmanifest"));
  assert.equal(m.name, "指煙魚");
  assert.equal(m.short_name, "指煙魚");
  assert.equal(m.display, "standalone");
  assert.equal(m.orientation, "portrait");
  assert.equal(m.background_color, "#0a0a0f");
  assert.equal(m.theme_color, "#0a0a0f");
  assert.equal(m.lang, "ja");
});

test("マニフェスト：start_url と scope は相対（GitHub Pages のサブパスで公開するため）。id は書かない", async () => {
  const m = JSON.parse(await readText("manifest.webmanifest"));
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  // id はドメインの直下を基準に読まれる。書かなければ start_url（サブパス）と同じになる
  assert.equal("id" in m, false);
});

test("マニフェスト：何のアプリかわかる説明文を入れない", async () => {
  const m = JSON.parse(await readText("manifest.webmanifest"));
  assert.equal("description" in m, false);
  assert.equal(JSON.stringify(m).includes("シーシャ"), false);
});

test("マニフェスト：192px・512px のアイコンが any と maskable の両方であり、実際の大きさが合っている", async () => {
  const m = JSON.parse(await readText("manifest.webmanifest"));
  for (const purpose of ["any", "maskable"]) {
    const sizes = m.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes).sort();
    assert.deepEqual(sizes, ["192x192", "512x512"], purpose);
  }
  for (const icon of m.icons) {
    assert.ok(icon.src.startsWith("./"), icon.src);
    assert.equal(icon.type, "image/png");
    const { width, height } = inspectPng(await read(icon.src), icon.src);
    assert.equal(`${width}x${height}`, icon.sizes, icon.src);
  }
});

// ---------- アイコン ----------

test("アイコンの PNG は透明なし（iPhone は透明な部分を黒にするため）で、壊れていない", async () => {
  for (const [file, size] of [["icons/icon-192.png", 192], ["icons/icon-512.png", 512], ["icons/apple-touch-icon.png", 180]]) {
    const png = inspectPng(await read(file), file);
    assert.deepEqual([png.width, png.height], [size, size], file);
    assert.equal(png.colorType, 2, `${file}：RGB（透明なし）にします`);
  }
});

// ---------- index.html ----------

test("index.html：マニフェスト・iPhone 用のアイコン（180px）・ホーム画面の名前がある", async () => {
  const html = await readText("index.html");
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="指煙魚">/);
  assert.match(html, /<meta name="theme-color" content="#0a0a0f">/);
});

test("index.html：<title> にアプリ名を出さない（起動画面・タブに名前を出さない）", async () => {
  const html = await readText("index.html");
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  assert.equal(title.trim(), "");
});

test("index.html：この中のファイルへのパスはすべて相対（./ で始まる）", async () => {
  const html = await readText("index.html");
  const paths = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((p) => !/^https:\/\//.test(p) && p !== "#");
  assert.ok(paths.length > 0);
  for (const p of paths) assert.ok(p.startsWith("./"), p);
});

test("index.html：Googleフォントは表示を止めない形で読み込む", async () => {
  const html = await readText("index.html");
  const link = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
  assert.match(link, /media="print"/);
  assert.match(link, /onload="this\.media='all'"/);
});

// ---------- sw.js のキャッシュの一覧 ----------

test("sw.js：アプリ本体の一覧に、src/ の JS・index.html・style.css・マニフェスト・アイコンがすべて入っている", async () => {
  const { constants } = await loadServiceWorker();
  const listed = new Set(constants.APP_FILES);
  const src = (await readdir(new URL("src/", ROOT))).filter((f) => f.endsWith(".js")).map((f) => `./src/${f}`);
  const icons = (await readdir(new URL("icons/", ROOT))).filter((f) => !f.startsWith(".")).map((f) => `./icons/${f}`);
  for (const path of [...src, ...icons, "./index.html", "./style.css", "./manifest.webmanifest"]) {
    assert.ok(listed.has(path), `${path} を sw.js の APP_FILES に足してください`);
  }
});

test("sw.js：一覧のファイルはすべて実在し、パスは相対で、重複がない", async () => {
  const { constants } = await loadServiceWorker();
  assert.equal(new Set(constants.APP_FILES).size, constants.APP_FILES.length);
  for (const path of constants.APP_FILES) {
    assert.ok(path.startsWith("./"), path);
    await assert.doesNotReject(read(path), path);
  }
});

test("sw.js とデバッグパネルで、アプリのキャッシュの名前の頭（mystery-navi-）がそろっている", async () => {
  const { constants } = await loadServiceWorker();
  assert.equal(APP_CACHE_PREFIX, constants.CACHE_PREFIX);
});
