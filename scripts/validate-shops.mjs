#!/usr/bin/env node
// 店データ（shops.json）の検査（requirements.md 7章）。
//
// 使い方:
//   node scripts/validate-shops.mjs                 # このリポジトリの shops.json を検査
//   node scripts/validate-shops.mjs path/to/a.json  # 指定したファイルを検査（複数可）
//   （mystery-navi-data から）node ../mystery-navi/scripts/validate-shops.mjs build/shops.json
//
// 問題があれば一覧を出して終了コード1で終わる。

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const WARDS = [
  "千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区",
  "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区",
  "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区",
];

// 東京23区を囲む大まかな四角形
export const TOKYO_23_BOUNDS = { latMin: 35.52, latMax: 35.82, lngMin: 139.56, lngMax: 139.92 };

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const TOP_LEVEL_KEYS = ["dataVersion", "updatedAt", "shops"];
export const SHOP_KEYS = ["id", "name", "ward", "lat", "lng", "hours", "hints"];
export const ID_PATTERN = /^shop_\d{3,}$/;
const RANGE_PATTERN = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;
const MAX_END_MIN = 30 * 60;

// 比べる前に、全角・半角と大文字・小文字をそろえ、空白と記号を取り除く
export function normalizeForNameCheck(text) {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

// "HH:MM-HH:MM" を分に直す。書式の誤りは error に理由を入れて返す
export function parseRange(text) {
  if (typeof text !== "string") return { error: "文字列ではありません" };
  const m = RANGE_PATTERN.exec(text);
  if (!m) return { error: `"HH:MM-HH:MM" の形ではありません（${JSON.stringify(text)}）` };
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  if (sm > 59 || em > 59) return { error: `分が00〜59ではありません（${text}）` };
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start > 23 * 60 + 59) return { error: `開始は00:00〜23:59にしてください（${text}）` };
  if (end <= start) return { error: `終わりが開始より後になっていません（${text}）` };
  if (end > MAX_END_MIN) return { error: `終わりは30:00までにしてください（${text}）` };
  return { start, end };
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateHours(hours, where, errors) {
  if (!isPlainObject(hours)) {
    errors.push(`${where}: hours がオブジェクトではありません`);
    return;
  }
  for (const key of Object.keys(hours)) {
    if (!DAYS.includes(key)) errors.push(`${where}: hours に不明な曜日 "${key}" があります`);
  }
  const parsed = {};
  for (const day of DAYS) {
    const list = hours[day];
    if (!Array.isArray(list)) {
      errors.push(`${where}: hours.${day} がありません（定休日は空配列にしてください）`);
      continue;
    }
    const ranges = [];
    list.forEach((text, i) => {
      const r = parseRange(text);
      if (r.error) errors.push(`${where}: hours.${day}[${i}] ${r.error}`);
      else ranges.push(r);
    });
    if (ranges.length !== list.length) continue; // 書式の誤りがある日は並びを見ない
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start < ranges[i - 1].end) {
        errors.push(`${where}: hours.${day} の範囲が重なっているか、早い順に並んでいません（${list[i - 1]} と ${list[i]}）`);
      }
    }
    parsed[day] = ranges;
  }
  // 前の日の24:00以降の営業が、次の日の開始と重なっていないか（日曜→月曜も見る）
  DAYS.forEach((day, i) => {
    const prevDay = DAYS[(i + 6) % 7];
    const today = parsed[day];
    const prev = parsed[prevDay];
    if (!today || !prev || today.length === 0 || prev.length === 0) return;
    const overflow = Math.max(...prev.map((r) => r.end)) - 24 * 60;
    if (overflow > today[0].start) {
      errors.push(`${where}: hours.${prevDay} の深夜の営業が hours.${day} の開始と重なっています`);
    }
  });
}

function validateHints(hints, name, where, errors) {
  if (!Array.isArray(hints) || hints.length !== 3) {
    errors.push(`${where}: hints は3つの配列にしてください`);
    return;
  }
  const normalizedName = typeof name === "string" ? normalizeForNameCheck(name) : "";
  hints.forEach((hint, i) => {
    if (typeof hint !== "string" || hint.trim() === "") {
      errors.push(`${where}: hints[${i}] が空です`);
      return;
    }
    if (normalizedName !== "" && normalizeForNameCheck(hint).includes(normalizedName)) {
      errors.push(`${where}: hints[${i}] に店名が含まれています`);
    }
  });
}

function validateShop(shop, index, errors) {
  const label = shop && typeof shop.id === "string" ? shop.id : `#${index}`;
  const where = `shops[${index}] (${label})`;
  if (!isPlainObject(shop)) {
    errors.push(`${where}: 店がオブジェクトではありません`);
    return;
  }
  for (const key of Object.keys(shop)) {
    if (!SHOP_KEYS.includes(key)) errors.push(`${where}: 公開用データにない項目 "${key}" があります`);
  }
  for (const key of SHOP_KEYS) {
    if (!(key in shop)) errors.push(`${where}: 項目 "${key}" がありません`);
  }
  if (typeof shop.id !== "string" || !ID_PATTERN.test(shop.id)) {
    errors.push(`${where}: id は shop_001 の形にしてください`);
  }
  if (typeof shop.name !== "string" || shop.name.trim() === "") {
    errors.push(`${where}: name が空です`);
  } else if (normalizeForNameCheck(shop.name) === "") {
    errors.push(`${where}: name が記号と空白だけです`);
  }
  if (!WARDS.includes(shop.ward)) {
    errors.push(`${where}: ward が東京23区の区名ではありません（${JSON.stringify(shop.ward)}）`);
  }
  const { latMin, latMax, lngMin, lngMax } = TOKYO_23_BOUNDS;
  if (typeof shop.lat !== "number" || !Number.isFinite(shop.lat) || typeof shop.lng !== "number" || !Number.isFinite(shop.lng)) {
    errors.push(`${where}: lat・lng が数値ではありません`);
  } else if (shop.lat < latMin || shop.lat > latMax || shop.lng < lngMin || shop.lng > lngMax) {
    errors.push(`${where}: 座標が東京23区の範囲外です（${shop.lat}, ${shop.lng}）`);
  }
  if ("hours" in shop) validateHours(shop.hours, where, errors);
  if ("hints" in shop) validateHints(shop.hints, shop.name, where, errors);
}

// 店データを検査し、問題の一覧（文字列の配列）を返す。問題がなければ空配列
export function validateShopsData(data) {
  const errors = [];
  if (!isPlainObject(data)) return ["一番上がオブジェクトではありません"];
  for (const key of Object.keys(data)) {
    if (!TOP_LEVEL_KEYS.includes(key)) errors.push(`一番上に不明な項目 "${key}" があります`);
  }
  if (typeof data.dataVersion !== "string" || data.dataVersion.trim() === "") {
    errors.push("dataVersion がありません");
  }
  if (typeof data.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.updatedAt)) {
    errors.push("updatedAt は YYYY-MM-DD の形にしてください");
  }
  if (!Array.isArray(data.shops) || data.shops.length === 0) {
    errors.push("shops が空か、配列ではありません");
    return errors;
  }
  const seen = new Set();
  data.shops.forEach((shop, i) => {
    validateShop(shop, i, errors);
    const id = shop?.id;
    if (typeof id === "string") {
      if (seen.has(id)) errors.push(`shops[${i}]: id "${id}" が重複しています`);
      seen.add(id);
    }
  });
  return errors;
}

export async function validateShopsFile(filePath) {
  let data;
  try {
    data = JSON.parse(await readFile(filePath, "utf8"));
  } catch (e) {
    return [`読み込めません: ${e.message}`];
  }
  return validateShopsData(data);
}

async function main(args) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = args.length > 0 ? args : [path.join(repoRoot, "shops.json")];
  let failed = false;
  for (const file of files) {
    const errors = await validateShopsFile(file);
    if (errors.length === 0) {
      console.log(`OK: ${file}`);
    } else {
      failed = true;
      console.error(`NG: ${file}（${errors.length}件）`);
      for (const e of errors) console.error(`  - ${e}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
