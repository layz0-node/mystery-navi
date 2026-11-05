// 最初の位置の精度待ち（4-1）と、デバッグ用の計算（12章）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialFixStart,
  initialFixStep,
  offsetPosition,
  distanceM,
  bearingDeg,
  makeDebugVisits,
  trophySummary,
  dayKey,
  parseJstLocal,
  formatJstLocal,
  DEBUG_MAX_BULK_VISITS,
} from "../src/logic.js";
import { INITIAL_FIX_TIMEOUT_SEC } from "../src/config.js";
import { BASE, makeShop, jst } from "./fixtures/make-shop.js";

const T = INITIAL_FIX_TIMEOUT_SEC * 1000;
const fix = (accuracy, lat = BASE.lat) => ({ lat, lng: BASE.lng, accuracy });

function run(events) {
  let s = initialFixStart(0);
  for (const e of events) s = initialFixStep(s, e);
  return s;
}

// ---------- 最初の位置の精度待ち ----------

test("最初の位置の誤差が30m → すぐ確定。「精度が低い」は出さない", () => {
  const s = run([{ type: "fix", fix: fix(30), atMs: 500 }]);
  assert.equal(s.done, true);
  assert.deepEqual(s.result, { position: fix(30), lowAccuracy: false });
});

test("誤差がちょうど100m → 確定（100m以下なので）", () => {
  const s = run([{ type: "fix", fix: fix(100), atMs: 500 }]);
  assert.equal(s.done, true);
  assert.equal(s.result.lowAccuracy, false);
});

test("誤差150m、経過3秒 → まだ待つ", () => {
  const s = run([{ type: "fix", fix: fix(150), atMs: 3000 }, { type: "tick", atMs: 3000 }]);
  assert.equal(s.done, false);
});

test("150m の後に 80m が来る → 80m の位置で確定", () => {
  const s = run([
    { type: "fix", fix: fix(150), atMs: 1000 },
    { type: "fix", fix: fix(80, 35.73), atMs: 2000 },
  ]);
  assert.equal(s.done, true);
  assert.deepEqual(s.result.position, fix(80, 35.73));
  assert.equal(s.result.lowAccuracy, false);
});

test("10秒たっても 150m・120m・180m だけ → 一番誤差の小さい 120m で確定し、「精度が低い」を立てる", () => {
  const s = run([
    { type: "fix", fix: fix(150, 35.1), atMs: 1000 },
    { type: "fix", fix: fix(120, 35.2), atMs: 4000 },
    { type: "fix", fix: fix(180, 35.3), atMs: 8000 },
    { type: "tick", atMs: T },
  ]);
  assert.equal(s.done, true);
  assert.deepEqual(s.result, { position: fix(120, 35.2), lowAccuracy: true });
});

test("ちょうど10秒 → 時間切れとして扱う", () => {
  const before = run([{ type: "fix", fix: fix(150), atMs: 100 }, { type: "tick", atMs: T - 1 }]);
  assert.equal(before.done, false);
  const at = run([{ type: "fix", fix: fix(150), atMs: 100 }, { type: "tick", atMs: T }]);
  assert.equal(at.done, true);
});

test("時間切れの後に来た位置 → それまでの一番よい位置と比べて確定する", () => {
  const s = run([{ type: "fix", fix: fix(150, 35.1), atMs: 100 }, { type: "fix", fix: fix(130, 35.2), atMs: T + 1 }]);
  assert.equal(s.done, true);
  assert.deepEqual(s.result, { position: fix(130, 35.2), lowAccuracy: true });
});

test("10秒のあいだ位置が1回も来ない → 待ち続け、最初に来た位置で確定（100m超なら精度が低い）", () => {
  let s = run([{ type: "tick", atMs: T }]);
  assert.equal(s.done, false);
  assert.equal(s.timedOut, true);
  s = initialFixStep(s, { type: "fix", fix: fix(300), atMs: T + 20000 });
  assert.equal(s.done, true);
  assert.deepEqual(s.result, { position: fix(300), lowAccuracy: true });
});

test("10秒たってから最初に来た位置が 50m → 確定。精度は低くない", () => {
  const s = run([{ type: "tick", atMs: T }, { type: "fix", fix: fix(50), atMs: T + 3000 }]);
  assert.equal(s.result.lowAccuracy, false);
});

test("確定した後に位置が来る → 結果は変わらない", () => {
  const s = run([{ type: "fix", fix: fix(30), atMs: 100 }, { type: "fix", fix: fix(5, 35.9), atMs: 200 }]);
  assert.deepEqual(s.result.position, fix(30));
});

test("誤差の値がない位置 → 誤差が大きいものとして扱う", () => {
  const s = run([{ type: "fix", fix: { lat: 35, lng: 139 }, atMs: 100 }]);
  assert.equal(s.done, false);
});

// ---------- ワープ先 ----------

test("ワープ：店から南へ50m → 距離が約50m、方位角が約180度", () => {
  const shop = makeShop("shop_w", { distance: 400, bearing: 45 });
  const p = offsetPosition(shop, 180, 50);
  assert.ok(Math.abs(distanceM(p, shop) - 50) < 1);
  assert.ok(Math.abs(bearingDeg(shop, p) - 180) < 0.5);
});

test("ワープ：0m → 店の位置そのもの", () => {
  const p = offsetPosition(BASE, 90, 0);
  assert.ok(Math.abs(p.lat - BASE.lat) < 1e-12);
  assert.ok(Math.abs(p.lng - BASE.lng) < 1e-12);
});

// ---------- 記録をまとめて追加するときの中身 ----------

const SHOPS = [makeShop("shop_a"), makeShop("shop_b")];

test("まとめて3件、基準が11/5 21:00 → 11/4・11/3・11/2 の21:00。店は順に回り、値は指定どおり", () => {
  const v = makeDebugVisits({ count: 3, shops: SHOPS, value: "bad", now: jst("2026-11-05T21:00") });
  assert.deepEqual(v, [
    { shopId: "shop_a", value: "bad", at: jst("2026-11-04T21:00").toISOString() },
    { shopId: "shop_b", value: "bad", at: jst("2026-11-03T21:00").toISOString() },
    { shopId: "shop_a", value: "bad", at: jst("2026-11-02T21:00").toISOString() },
  ]);
});

test("作った記録でトロフィーを数える → 件数どおり", () => {
  const v = makeDebugVisits({ count: 3, shops: SHOPS, value: "good", now: jst("2026-11-05T21:00") });
  assert.equal(trophySummary(v).count, 3);
});

test("店が1軒しかなくても、日付が違うので件数どおり数えられる", () => {
  const v = makeDebugVisits({ count: 12, shops: [SHOPS[0]], value: "good", now: jst("2026-11-05T21:00") });
  assert.equal(trophySummary(v).count, 12);
});

test("日付は朝5時の切り替えで数える：基準が11/6 03:00 なら、最初の記録は11/4の日", () => {
  const now = jst("2026-11-06T03:00");
  assert.equal(dayKey(now), "2026-11-05");
  const v = makeDebugVisits({ count: 2, shops: SHOPS, value: "good", now });
  assert.deepEqual(v.map((x) => dayKey(x.at)), ["2026-11-04", "2026-11-03"]);
});

test("まとめて追加：0件 → 空。上限を超える・整数でない → エラー", () => {
  assert.deepEqual(makeDebugVisits({ count: 0, shops: [], value: "good", now: jst("2026-11-05T21:00") }), []);
  assert.throws(() => makeDebugVisits({ count: DEBUG_MAX_BULK_VISITS + 1, shops: SHOPS, value: "good", now: new Date() }), RangeError);
  assert.throws(() => makeDebugVisits({ count: 1.5, shops: SHOPS, value: "good", now: new Date() }), RangeError);
  assert.throws(() => makeDebugVisits({ count: -1, shops: SHOPS, value: "good", now: new Date() }), RangeError);
});

test("まとめて追加：知らない評価・店がない → エラー", () => {
  assert.throws(() => makeDebugVisits({ count: 1, shops: SHOPS, value: "great", now: new Date() }), TypeError);
  assert.throws(() => makeDebugVisits({ count: 1, shops: [], value: "good", now: new Date() }), TypeError);
});

// ---------- 日本時間の日時の入力 ----------

test("日時の入力は日本時間として読む（端末のタイムゾーンに頼らない）", () => {
  assert.equal(parseJstLocal("2026-11-05T21:00").toISOString(), "2026-11-05T12:00:00.000Z");
  assert.equal(parseJstLocal("2026-11-06T03:30").toISOString(), "2026-11-05T18:30:00.000Z");
  assert.equal(formatJstLocal(new Date("2026-11-05T18:30:00Z")), "2026-11-06T03:30");
});

test("日時の入力：形が違う・存在しない日付 → null", () => {
  assert.equal(parseJstLocal(""), null);
  assert.equal(parseJstLocal("2026-02-30T10:00"), null);
  assert.equal(parseJstLocal("2026-11-05T24:00"), null);
  assert.equal(parseJstLocal("2026/11/05 21:00"), null);
});
