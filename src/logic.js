// 距離・方位・営業時間・点数・選出・案内先の再開判定・トロフィーの集計。
// DOMに触らない純粋な関数だけを置く。乱数と現在時刻は引数で受け取る。
// 時刻の判定はすべて日本時間（UTC+9）で行い、端末のタイムゾーンに頼らない（requirements.md T4）。

import {
  SEARCH_RADIUS_M,
  MIN_TARGET_DISTANCE_M,
  HINT1_RADIUS_M,
  HINT2_RADIUS_M,
  ARRIVAL_RADIUS_M,
  MAX_ACCURACY_FOR_ARRIVAL_M,
  MIN_REMAINING_OPEN_MIN,
  UNVISITED_PICK_RATE,
  BAD_PICK_WEIGHT,
  CLOSED_EXCLUDE_DAYS,
  TARGET_TTL_HOURS,
  ARRIVAL_MIN_HOLD_HOURS,
  DAY_BOUNDARY_HOUR,
  JST_OFFSET_MIN,
  TROPHY_LEVELS,
  SCORE,
} from "./config.js";

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = JST_OFFSET_MIN * MIN_MS;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]; // getUTCDay() の順
const EARTH_RADIUS_M = 6371000;

function toMs(time) {
  return time instanceof Date ? time.getTime() : Date.parse(time);
}

// ---------- 距離・方位 ----------

const rad = (deg) => (deg * Math.PI) / 180;

// 2点間の距離（m）。ハバーサイン式
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// from から to への方位角（真北基準・時計回り、0以上360未満）
export function bearingDeg(from, to) {
  const φ1 = rad(from.lat);
  const φ2 = rad(to.lat);
  const dλ = rad(to.lng - from.lng);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// 距離の表示。1000m未満は10m単位で四捨五入。丸めて1000m以上なら km の小数1桁（S1）
export function formatDistance(m) {
  const rounded = Math.round(m / 10) * 10;
  if (rounded < 1000) return `${rounded}m`;
  const km = Math.max(1, Math.round(m / 100) / 10);
  return `${km.toFixed(1)}km`;
}

// ---------- 日付（朝5時切り替え） ----------

const BOUNDARY_SHIFT_MS = JST_OFFSET_MS - DAY_BOUNDARY_HOUR * HOUR_MS;

// その「日」が始まる時刻（日本時間の朝5時）のミリ秒
function dayStartMs(time) {
  const shifted = toMs(time) + BOUNDARY_SHIFT_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - BOUNDARY_SHIFT_MS;
}

// 朝5時で切り替える日本時間の日付（"YYYY-MM-DD"）
export function dayKey(time) {
  return new Date(toMs(time) + BOUNDARY_SHIFT_MS).toISOString().slice(0, 10);
}

// その「日」が終わる時刻（次の朝5時）
export function nextDayBoundary(time) {
  return new Date(dayStartMs(time) + DAY_MS);
}

// ---------- 営業時間 ----------

function parseRange(text) {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [sh, sm, eh, em] = m.slice(1).map(Number);
  return { start: sh * 60 + sm, end: eh * 60 + em };
}

// 今いる営業時間の範囲と、閉店までの分数（日本時間）。
// 前日の24:00以降の営業も見る。隣り合う・重なる範囲はつなげる。
// 7日以上つながっている（24時間営業）なら minutesToClose は Infinity。
export function openStatus(shop, now) {
  const jstMs = toMs(now) + JST_OFFSET_MS;
  const dayIndex = Math.floor(jstMs / DAY_MS); // 日本時間の暦日の通し番号
  const minuteOfDay = (jstMs - dayIndex * DAY_MS) / MIN_MS;

  const LOOK_AHEAD_DAYS = 8;
  const intervals = [];
  for (let k = -1; k <= LOOK_AHEAD_DAYS; k++) {
    const key = DAY_KEYS[new Date((dayIndex + k) * DAY_MS).getUTCDay()];
    for (const text of shop.hours?.[key] ?? []) {
      const r = parseRange(text);
      if (r) intervals.push({ start: r.start + k * 1440, end: r.end + k * 1440 });
    }
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }

  const current = merged.find((iv) => iv.start <= minuteOfDay && minuteOfDay < iv.end);
  if (!current) return { open: false, minutesToClose: null };
  const remaining = current.end - minuteOfDay;
  return { open: true, minutesToClose: remaining >= 7 * 1440 ? Infinity : remaining };
}

// 選べる営業状態か（営業中で、閉店まで残り75分を超える）
export function isSelectableHours(shop, now) {
  const s = openStatus(shop, now);
  return s.open && s.minutesToClose > MIN_REMAINING_OPEN_MIN;
}

// ---------- 評価の記録から決まること ----------

// visits を店ごとにまとめる
export function groupVisitsByShop(visits) {
  const map = new Map();
  for (const v of visits ?? []) {
    if (!map.has(v.shopId)) map.set(v.shopId, []);
    map.get(v.shopId).push(v);
  }
  return map;
}

function scoreOf(shopVisits) {
  return shopVisits.reduce((sum, v) => sum + (SCORE[v.value] ?? 0), 0);
}

function colorOf(score) {
  if (score > 0) return "mint";
  if (score < 0) return "bad";
  return "normal";
}

// ある店の点数・矢印の色・訪問済みか・除外中か・選ばれやすさ（6章）
// shopVisits はその店の記録だけ（groupVisitsByShop の値）
export function shopRecordFrom(shopVisits, now) {
  const list = shopVisits ?? [];
  const score = scoreOf(list);
  const nowMs = toMs(now);
  const today = dayKey(now);
  const recordedToday = list.some((v) => dayKey(v.at) === today);
  const closedTimes = list.filter((v) => v.value === "closed").map((v) => toMs(v.at));
  const lastClosed = closedTimes.length ? Math.max(...closedTimes) : null;
  const closedRecently =
    lastClosed !== null && nowMs - lastClosed <= CLOSED_EXCLUDE_DAYS * DAY_MS;
  return {
    score,
    color: colorOf(score),
    visited: list.length > 0,
    excluded: recordedToday || closedRecently,
    weight: score < 0 ? BAD_PICK_WEIGHT : 1,
  };
}

export function shopRecord(shopId, visits, now) {
  return shopRecordFrom(groupVisitsByShop(visits).get(shopId), now);
}

// ---------- 案内先の再開 ----------

// 到着画面を保つ期限か（「到着した日の翌朝5時」より前、または到着から3時間以内）
export function isArrivalHeld(arrivedAt, now) {
  const nowMs = toMs(now);
  const arrivedMs = toMs(arrivedAt);
  return (
    nowMs < nextDayBoundary(arrivedAt).getTime() ||
    nowMs - arrivedMs <= ARRIVAL_MIN_HOLD_HOURS * HOUR_MS
  );
}

// 保存中の案内先をどうするか（4-1・6章）
// → { action: "arrived" | "resume" | "discard", shop }
export function resolveTarget(target, shops, visits, now) {
  if (!target) return { action: "discard", shop: null };
  const shop = shops.find((s) => s.id === target.shopId);
  if (!shop) return { action: "discard", shop: null };

  if (target.arrivedAt) {
    return isArrivalHeld(target.arrivedAt, now)
      ? { action: "arrived", shop }
      : { action: "discard", shop: null };
  }

  const elapsed = toMs(now) - toMs(target.selectedAt);
  if (elapsed > TARGET_TTL_HOURS * HOUR_MS) return { action: "discard", shop: null };
  if (shopRecord(shop.id, visits, now).excluded) return { action: "discard", shop: null };
  if (!openStatus(shop, now).open) return { action: "discard", shop: null };
  return { action: "resume", shop };
}

// ---------- 選出 ----------

// 重みの区間を店の順に並べ、random 1回で選ぶ
function weightedPick(items, weights, r) {
  const total = weights.reduce((a, b) => a + b, 0);
  const x = r * total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i];
    if (x < acc) return items[i];
  }
  return items[items.length - 1];
}

// 店を1軒選ぶ（4-1・4-2）
// → { result: "ok", shop, distanceM, onlyThisShop } または { result: "A1" | "A2" | "B" | "C" }
// onlyThisShop：直前に外した店しか候補がなく、同じ店を選んだ
export function selectShop({ shops, visits, position, now, random, avoidShopId = null }) {
  const withDistance = shops.map((shop) => ({ shop, d: distanceM(position, shop) }));
  const inRadius = withDistance.filter((x) => x.d <= SEARCH_RADIUS_M);
  if (inRadius.length === 0) return { result: "A1" };

  // ① 200mより遠く、1km以内
  const far = inRadius.filter((x) => x.d > MIN_TARGET_DISTANCE_M);
  if (far.length === 0) return { result: "A2" };

  // ② 除外中の店を外す
  const byShop = groupVisitsByShop(visits);
  const records = new Map(far.map((x) => [x.shop.id, shopRecordFrom(byShop.get(x.shop.id), now)]));
  const notExcluded = far.filter((x) => !records.get(x.shop.id).excluded);
  if (notExcluded.length === 0) return { result: "B" };

  // ③ 今営業中で、閉店まで残り75分を超える
  const openNow = notExcluded.filter((x) => isSelectableHours(x.shop, now));
  if (openNow.length === 0) return { result: "C" };

  // 直前に外した店は、他に候補があればこの1回だけ選ばない
  let pool = openNow.filter((x) => x.shop.id !== avoidShopId);
  let onlyThisShop = false;
  if (pool.length === 0) {
    pool = openNow;
    onlyThisShop = true;
  }

  // ④⑤ グループに分けて選ぶ
  const unvisited = pool.filter((x) => !records.get(x.shop.id).visited);
  const visited = pool.filter((x) => records.get(x.shop.id).visited);
  let group;
  if (unvisited.length && visited.length) {
    group = random() < UNVISITED_PICK_RATE ? "unvisited" : "visited";
  } else {
    group = unvisited.length ? "unvisited" : "visited";
  }

  // ⑥ グループの中から1軒
  const list = group === "unvisited" ? unvisited : visited;
  const weights = list.map((x) => (group === "unvisited" ? 1 : records.get(x.shop.id).weight));
  const picked = weightedPick(list, weights, random());
  return { result: "ok", shop: picked.shop, distanceM: picked.d, onlyThisShop };
}

// ---------- ヒントと到着 ----------

// 今の距離と保存済みの解放数から、ヒントの解放数と到着かどうか（5章）
export function hintProgress(distance, accuracy, savedHints = 0) {
  let fromDistance = 0;
  if (distance <= HINT2_RADIUS_M) fromDistance = 2;
  else if (distance <= HINT1_RADIUS_M) fromDistance = 1;
  const lowAccuracy = accuracy > MAX_ACCURACY_FOR_ARRIVAL_M;
  return {
    unlockedHints: Math.max(savedHints ?? 0, fromDistance),
    arrived: distance <= ARRIVAL_RADIUS_M && !lowAccuracy,
    lowAccuracy,
  };
}

// ---------- トロフィー ----------

// 評価の記録から、回数・段階・訪れた店の数など（4-3・S5）
// 店リストから消えた店の記録も数える
export function trophySummary(visits, levels = TROPHY_LEVELS) {
  const counted = new Set();
  for (const v of visits ?? []) counted.add(`${v.shopId}\n${dayKey(v.at)}`);
  const count = counted.size;

  let level = null;
  let nextLevel = null;
  for (const l of levels) {
    if (count >= l.count) level = l;
    else {
      nextLevel = l;
      break;
    }
  }

  const byShop = groupVisitsByShop(visits);
  let goodShops = 0;
  let badShops = 0;
  for (const list of byShop.values()) {
    const s = scoreOf(list);
    if (s > 0) goodShops++;
    else if (s < 0) badShops++;
  }

  return {
    count,
    level,
    nextLevel,
    remaining: nextLevel ? nextLevel.count - count : null,
    isMax: nextLevel === null,
    visitedShops: byShop.size,
    goodShops,
    badShops,
  };
}
