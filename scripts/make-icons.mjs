#!/usr/bin/env node
// ホーム画面用のアイコンを作る（開発用。アプリ本体からは使わない）。
//
// モチーフは「指南魚」（魚の形をした昔の羅針盤の針）。シーシャのモチーフは使わない（requirements.md 8章）。
// 図形をこのファイルの中で座標として定義し、同じ定義から SVG と PNG を書き出す。
// 依存はなし（PNG は Node 標準の zlib で書き出す）。ブラウザもサンドボックスの外も使わない。
//
// 使い方:
//   node scripts/make-icons.mjs              # 案A で icons/ に書き出す
//   node scripts/make-icons.mjs --design=b   # 案B で書き出す
//   node scripts/make-icons.mjs --preview    # 3案の見本を screenshots/icon-preview.png に書き出す（コミットしない）
//
// 書き出すもの（icons/）
//   icon.svg              ブラウザのタブ用
//   icon-512.png          マニフェスト（any・maskable）
//   icon-192.png          マニフェスト（any・maskable）
//   apple-touch-icon.png  iPhone のホーム画面用（180px）
//
// 背景は全面を塗る（iPhone は透明な部分を黒にするため）。Android で丸く切り抜かれても欠けないよう、
// 図柄は中央から半径 40%（512px で 204.8px）の内側に収める。

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_DIR = path.join(ROOT, "icons");
const PREVIEW_FILE = path.join(ROOT, "screenshots", "icon-preview.png");

const BASE = 512; // 図形の座標はこの大きさで書く
const CENTER = BASE / 2;
const SAFE_RADIUS = BASE * 0.4; // Android の丸い切り抜き（maskable）で必ず見える範囲

const COLORS = {
  bg: "#0a0a0f",
  bgCenter: "#15151e",
  fish: "#c8b89a", // 通常の矢印と同じゴールドベージュ
  fishShade: "#9a8a6e", // 針の左半分（羅針盤の針のように2色に分ける）
  water: "#10151f",
};

// ---------- 図形（パス）----------
// パスは [["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"]] の配列

const KAPPA = 0.5522847498; // 円を4本の3次ベジェで近似するときの係数

function circle(cx, cy, r) {
  const k = KAPPA * r;
  return [
    ["M", cx + r, cy],
    ["C", cx + r, cy + k, cx + k, cy + r, cx, cy + r],
    ["C", cx - k, cy + r, cx - r, cy + k, cx - r, cy],
    ["C", cx - r, cy - k, cx - k, cy - r, cx, cy - r],
    ["C", cx + k, cy - r, cx + r, cy - k, cx + r, cy],
    ["Z"],
  ];
}

// 輪（偶奇規則で塗る）
function ring(cx, cy, r, width) {
  return [...circle(cx, cy, r + width / 2), ...circle(cx, cy, r - width / 2)];
}

function rect(x, y, w, h) {
  return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
}

function roundedRect(x, y, w, h, r) {
  const k = KAPPA * r;
  return [
    ["M", x + r, y],
    ["L", x + w - r, y],
    ["C", x + w - r + k, y, x + w, y + r - k, x + w, y + r],
    ["L", x + w, y + h - r],
    ["C", x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
    ["L", x + r, y + h],
    ["C", x + r - k, y + h, x, y + h - r + k, x, y + h - r],
    ["L", x, y + r],
    ["C", x, y + r - k, x + r - k, y, x + r, y],
    ["Z"],
  ];
}

// 中心から angle 度（0 が上、時計回り）の向きに、半径 r0〜r1 の細長い四角（目盛り）
function tick(angle, r0, r1, width) {
  const a = (angle * Math.PI) / 180;
  const d = [Math.sin(a), -Math.cos(a)];
  const n = [Math.cos(a), Math.sin(a)];
  const p = (r, s) => [CENTER + d[0] * r + (n[0] * width * s) / 2, CENTER + d[1] * r + (n[1] * width * s) / 2];
  const [a0, a1, a2, a3] = [p(r0, -1), p(r1, -1), p(r1, 1), p(r0, 1)];
  return [["M", ...a0], ["L", ...a1], ["L", ...a2], ["L", ...a3], ["Z"]];
}

function mapPath(cmds, fn) {
  return cmds.map(([op, ...xy]) => {
    const out = [op];
    for (let i = 0; i < xy.length; i += 2) out.push(...fn(xy[i], xy[i + 1]));
    return out;
  });
}

// 指南魚。鼻先 (0,0) から尾びれの先 (±52, 300) まで、頭を上に向けた形で書き、
// 胴の真ん中（y=150）が (CENTER, CENTER + offsetY) に来るように scale 倍して置く
const FISH_RIGHT = [
  ["C", 14, 10, 44, 42, 44, 92], // 頭から胴の一番太いところ
  ["C", 44, 150, 24, 196, 11, 228], // 胴から尾の付け根
  ["C", 22, 250, 40, 276, 52, 300], // 尾びれの外側
  ["C", 34, 292, 14, 284, 0, 272], // 尾びれの切れ込み
];
// 右の胸びれ（胴から外へ、後ろ向きに張り出す）
const FIN_RIGHT = [["M", 40, 106], ["C", 56, 114, 67, 134, 71, 158], ["C", 59, 151, 50, 146, 39, 146], ["Z"]];
const mirror = (cmds) => cmds.map(([op, ...xy]) => [op, ...xy.map((v, i) => (i % 2 === 0 ? -v : v))]);
// 右半分を逆にたどった線（切れ込み → 鼻先）
function reverseSide(cmds) {
  const points = [[0, 0], ...cmds.map((c) => c.slice(-2))];
  return cmds
    .map((c, i) => ["C", c[3], c[4], c[1], c[2], ...points[i]])
    .reverse();
}

function fishShapes({ scale, offsetY = 0 }) {
  const place = (cmds) => mapPath(cmds, (x, y) => [CENTER + x * scale, CENTER + offsetY + (y - 150) * scale]);
  const leftSide = reverseSide(mirror(FISH_RIGHT)); // 切れ込み → 鼻先（左側）
  const body = place([["M", 0, 0], ...FISH_RIGHT, ...leftSide, ["Z"]]);
  // 左半分だけ暗くして、羅針盤の針のような2色にする
  const shade = place([["M", 0, 0], ...mirror(FISH_RIGHT), ["L", 0, 0], ["Z"]]);
  const eyes = [-19, 19].map((x) => place(circle(x, 58, 5)));
  return [
    { path: place(FIN_RIGHT), fill: COLORS.fish },
    { path: place(mirror(FIN_RIGHT)), fill: COLORS.fishShade },
    { path: body, fill: COLORS.fish },
    { path: shade, fill: COLORS.fishShade },
    ...eyes.map((p) => ({ path: p, fill: COLORS.bg })),
  ];
}

// 背景（全面）。中央を少し明るく
const background = () => ({
  path: rect(0, 0, BASE, BASE),
  gradient: { cx: CENTER, cy: CENTER, r: BASE * 0.72, stops: [[0, COLORS.bgCenter, 1], [1, COLORS.bg, 1]] },
});

// 魚の後ろの淡い光（ナビ画面の矢印の光と同じ雰囲気）
const glow = (r) => ({
  path: circle(CENTER, CENTER, r),
  gradient: { cx: CENTER, cy: CENTER, r, stops: [[0, COLORS.fish, 0.16], [1, COLORS.fish, 0]] },
});

// ---------- 3案 ----------

const DESIGNS = {
  // 案A：魚だけ。小さく表示しても形がわかる
  a: () => [background(), glow(190), ...fishShapes({ scale: 1.13 })],

  // 案B：方位盤の輪と目盛りの中に魚。起動画面のコンパスのマークとそろう
  b: () => [
    background(),
    { path: ring(CENTER, CENTER, 192, 5), fill: COLORS.fish, opacity: 0.5, rule: "evenodd" },
    { path: ring(CENTER, CENTER, 174, 2), fill: COLORS.fish, opacity: 0.22, rule: "evenodd" },
    ...[0, 90, 180, 270].map((a) => ({ path: tick(a, 150, 170, 5), fill: COLORS.fish, opacity: a === 0 ? 0.95 : 0.5 })),
    ...[45, 135, 225, 315].map((a) => ({ path: tick(a, 158, 170, 3), fill: COLORS.fish, opacity: 0.35 })),
    glow(140),
    ...fishShapes({ scale: 0.86 }),
  ],

  // 案C：水を張った器に浮かぶ魚と波紋。指南魚の本来の使い方
  c: () => [
    background(),
    {
      path: circle(CENTER, CENTER, 194),
      gradient: { cx: CENTER, cy: CENTER, r: 194, stops: [[0, "#24324a", 1], [1, COLORS.water, 1]] },
    },
    { path: ring(CENTER, CENTER, 194, 7), fill: COLORS.fish, opacity: 0.55, rule: "evenodd" },
    ...[
      [170, 0.12],
      [146, 0.2],
      [122, 0.3],
    ].map(([r, o]) => ({ path: ring(CENTER, CENTER, r, 2.5), fill: "#9fb4cf", opacity: o, rule: "evenodd" })),
    ...fishShapes({ scale: 0.78 }),
  ],
};

// ---------- 色 ----------

function parseColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 放射状のグラデーション。t は中心からの距離 / 半径
function gradientAt(g, x, y) {
  const t = Math.min(1, Math.hypot(x - g.cx, y - g.cy) / g.r);
  const stops = g.stops;
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0, a0] = stops[i];
  const [t1, c1, a1] = stops[i + 1];
  const u = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const [p, q] = [parseColor(c0), parseColor(c1)];
  return { rgb: p.map((v, k) => v + (q[k] - v) * u), alpha: a0 + (a1 - a0) * u };
}

// ---------- 塗りつぶし（ラスタライズ）----------

// パスを折れ線の集まりにする（座標は scale 倍する）
function flatten(cmds, scale) {
  const polys = [];
  let cur = null;
  let last = [0, 0];
  for (const [op, ...v] of cmds) {
    if (op === "M") {
      cur = [[v[0] * scale, v[1] * scale]];
      polys.push(cur);
      last = [v[0], v[1]];
    } else if (op === "L") {
      cur.push([v[0] * scale, v[1] * scale]);
      last = [v[0], v[1]];
    } else if (op === "C") {
      const p = [last, [v[0], v[1]], [v[2], v[3]], [v[4], v[5]]];
      const len = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) + Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) + Math.hypot(p[3][0] - p[2][0], p[3][1] - p[2][1]);
      const n = Math.min(96, Math.max(6, Math.ceil((len * scale) / 2)));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const s = 1 - t;
        const x = s * s * s * p[0][0] + 3 * s * s * t * p[1][0] + 3 * s * t * t * p[2][0] + t * t * t * p[3][0];
        const y = s * s * s * p[0][1] + 3 * s * s * t * p[1][1] + 3 * s * t * t * p[2][1] + t * t * t * p[3][1];
        cur.push([x * scale, y * scale]);
      }
      last = [v[4], v[5]];
    }
  }
  return polys;
}

const SUBSAMPLES = 16; // 1ピクセルの高さを何本の線で調べるか（横方向は面積で数える）

// 各ピクセルが図形に覆われている割合（0〜1）
function coverage(width, height, cmds, scale, rule = "nonzero") {
  const cov = new Float32Array(width * height);
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of flatten(cmds, scale)) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      if (y0 === y1) continue;
      edges.push({ x0, y0, x1, y1, dir: y1 > y0 ? 1 : -1, lo: Math.min(y0, y1), hi: Math.max(y0, y1) });
      minY = Math.min(minY, y0, y1);
      maxY = Math.max(maxY, y0, y1);
    }
  }
  const rowStart = Math.max(0, Math.floor(minY));
  const rowEnd = Math.min(height, Math.ceil(maxY));
  const hits = [];
  for (let row = rowStart; row < rowEnd; row++) {
    for (let k = 0; k < SUBSAMPLES; k++) {
      const y = row + (k + 0.5) / SUBSAMPLES;
      hits.length = 0;
      for (const e of edges) {
        if (y < e.lo || y >= e.hi) continue;
        hits.push({ x: e.x0 + ((y - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0), dir: e.dir });
      }
      hits.sort((a, b) => a.x - b.x);
      let winding = 0;
      for (let i = 0; i < hits.length - 1; i++) {
        winding += rule === "evenodd" ? 1 : hits[i].dir;
        const inside = rule === "evenodd" ? winding % 2 === 1 : winding !== 0;
        if (!inside) continue;
        const xa = Math.max(0, hits[i].x);
        const xb = Math.min(width, hits[i + 1].x);
        for (let px = Math.floor(xa); px < Math.ceil(xb); px++) {
          const overlap = Math.min(xb, px + 1) - Math.max(xa, px);
          if (overlap > 0) cov[row * width + px] += overlap / SUBSAMPLES;
        }
      }
    }
  }
  return cov;
}

function createCanvas(width, height, color) {
  const data = new Float32Array(width * height * 3);
  const [r, g, b] = parseColor(color);
  for (let i = 0; i < width * height; i++) data.set([r, g, b], i * 3);
  return { width, height, data };
}

function fillShape(canvas, shape, scale) {
  const { width, height, data } = canvas;
  const cov = coverage(width, height, shape.path, scale, shape.rule);
  const solid = shape.fill ? parseColor(shape.fill) : null;
  for (let i = 0; i < cov.length; i++) {
    if (cov[i] <= 0) continue;
    let rgb = solid;
    let alpha = shape.opacity ?? 1;
    if (shape.gradient) {
      const x = (i % width) + 0.5;
      const y = Math.floor(i / width) + 0.5;
      const g = gradientAt(shape.gradient, x / scale, y / scale);
      rgb = g.rgb;
      alpha *= g.alpha;
    }
    const a = Math.min(1, cov[i]) * alpha;
    for (let k = 0; k < 3; k++) data[i * 3 + k] = data[i * 3 + k] * (1 - a) + rgb[k] * a;
  }
}

function renderIcon(shapes, size) {
  const canvas = createCanvas(size, size, COLORS.bg);
  const scale = size / BASE;
  for (const s of shapes) fillShape(canvas, s, scale);
  return canvas;
}

// ---------- PNG ----------

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

// 8bit の RGB（透明なし）で書き出す。行ごとに None・Sub・Up のうち差の小さいフィルタを選ぶ
function encodePng({ width, height, data }) {
  const stride = width * 3;
  const pixels = Buffer.alloc(stride * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.max(0, Math.min(255, Math.round(data[i])));
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const line = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    const candidates = [0, 1, 2].map((type) => {
      const out = Buffer.alloc(stride);
      for (let x = 0; x < stride; x++) {
        const left = x >= 3 ? line[x - 3] : 0;
        const up = prev ? prev[x] : 0;
        out[x] = (line[x] - (type === 1 ? left : type === 2 ? up : 0)) & 255;
      }
      let cost = 0;
      for (const v of out) cost += v < 128 ? v : 256 - v;
      return { type, out, cost };
    });
    const best = candidates.reduce((a, b) => (b.cost < a.cost ? b : a));
    raw[y * (stride + 1)] = best.type;
    best.out.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8bit・RGB・圧縮0・フィルタ0・インターレースなし
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- SVG ----------

function svgPath(cmds) {
  const f = (v) => Number(v.toFixed(2));
  return cmds.map(([op, ...v]) => op + v.map(f).join(" ")).join("");
}

function toSvg(shapes) {
  const defs = [];
  const body = shapes.map((s, i) => {
    let fill = s.fill;
    if (s.gradient) {
      const id = `g${i}`;
      const stops = s.gradient.stops.map(([t, c, a]) => `<stop offset="${t}" stop-color="${c}" stop-opacity="${a}"/>`).join("");
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${s.gradient.cx}" cy="${s.gradient.cy}" r="${s.gradient.r}">${stops}</radialGradient>`);
      fill = `url(#${id})`;
    }
    const attrs = [`d="${svgPath(s.path)}"`, `fill="${fill}"`];
    if (s.opacity !== undefined && s.opacity !== 1) attrs.push(`fill-opacity="${s.opacity}"`);
    if (s.rule === "evenodd") attrs.push(`fill-rule="evenodd"`);
    return `<path ${attrs.join(" ")}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BASE} ${BASE}"><defs>${defs.join("")}</defs>${body.join("")}</svg>\n`;
}

// 図柄が Android の丸い切り抜きの内側に収まっているか（背景・器の全面の図形は除く）
function checkSafeZone(name, shapes) {
  for (const s of shapes) {
    if (s.gradient) continue; // 背景・器・光は切れてもよい
    for (const poly of flatten(s.path, 1)) {
      for (const [x, y] of poly) {
        const r = Math.hypot(x - CENTER, y - CENTER);
        if (r > SAFE_RADIUS) throw new Error(`案${name.toUpperCase()}：中央から ${r.toFixed(1)}px の点があり、丸い切り抜きで欠けます`);
      }
    }
  }
}

// ---------- 見本 ----------

// 3案を、iPhone（角丸）と Android（丸）の切り抜きで、暗い壁紙と明るい壁紙に並べる。左から A・B・C
function renderPreview() {
  const width = 1170;
  const rows = [
    { bg: "#1d2230", mask: "ios" },
    { bg: "#dde2ea", mask: "ios" },
    { bg: "#1d2230", mask: "android" },
  ];
  const rowH = 330;
  const canvas = createCanvas(width, rowH * rows.length, "#000000");
  const columns = [195, 585, 975];
  rows.forEach((row, ri) => {
    fillShape(canvas, { path: rect(0, ri * rowH, width, rowH), fill: row.bg }, 1);
    Object.values(DESIGNS).forEach((design, ci) => {
      const shapes = design();
      // 大：180px（iPhone の実際の大きさ）。小：60px と 40px
      const big = 180;
      const x = columns[ci] - big / 2;
      const y = ri * rowH + 30;
      blit(canvas, renderIcon(shapes, big), x, y, row.mask);
      blit(canvas, renderIcon(shapes, 60), columns[ci] - 70, y + big + 40, row.mask);
      blit(canvas, renderIcon(shapes, 40), columns[ci] + 20, y + big + 50, row.mask);
    });
  });
  return canvas;
}

function blit(dst, src, x0, y0, mask) {
  const size = src.width;
  const shape = mask === "ios" ? roundedRect(x0, y0, size, size, size * 0.225) : circle(x0 + size / 2, y0 + size / 2, size / 2);
  const cov = coverage(dst.width, dst.height, shape, 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const di = (y0 + y) * dst.width + (x0 + x);
      const a = Math.min(1, cov[di]);
      if (a <= 0) continue;
      const si = y * size + x;
      for (let k = 0; k < 3; k++) dst.data[di * 3 + k] = dst.data[di * 3 + k] * (1 - a) + src.data[si * 3 + k] * a;
    }
  }
}

// ---------- 実行 ----------

async function main() {
  const args = process.argv.slice(2);
  const preview = args.includes("--preview");
  const designArg = args.find((a) => a.startsWith("--design="))?.slice("--design=".length) ?? "a";
  for (const a of args) if (a !== "--preview" && !a.startsWith("--design=")) throw new Error(`不明な引数です: ${a}`);
  if (!DESIGNS[designArg]) throw new Error(`--design は ${Object.keys(DESIGNS).join("・")} のどれかです`);
  for (const [name, design] of Object.entries(DESIGNS)) checkSafeZone(name, design());

  if (preview) {
    await mkdir(path.dirname(PREVIEW_FILE), { recursive: true });
    await writeFile(PREVIEW_FILE, encodePng(renderPreview()));
    console.log(`見本を書き出しました: ${path.relative(ROOT, PREVIEW_FILE)}（左から 案A・案B・案C）`);
    return;
  }

  const shapes = DESIGNS[designArg]();
  await mkdir(ICONS_DIR, { recursive: true });
  await writeFile(path.join(ICONS_DIR, "icon.svg"), toSvg(shapes));
  for (const [file, size] of [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180]]) {
    await writeFile(path.join(ICONS_DIR, file), encodePng(renderIcon(shapes, size)));
  }
  console.log(`案${designArg.toUpperCase()} で icons/ に書き出しました（icon.svg・icon-512.png・icon-192.png・apple-touch-icon.png）`);
}

await main();
