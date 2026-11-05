// 営業時間・朝5時の切り替え（日本時間）
// 例の日付：2026-11-08 日曜、11-09 月曜、11-10 火曜、11-11 水曜
import { test } from "node:test";
import assert from "node:assert/strict";
import { openStatus, isSelectableHours, dayKey, nextDayBoundary } from "../src/logic.js";
import { makeShop, everyDay, ALWAYS, jst } from "./fixtures/make-shop.js";

const week = (overrides) => ({ ...everyDay([]), ...overrides });

const monLate = makeShop("shop_901", { hours: week({ mon: ["18:00-26:00"] }) });

test("月曜 18:00-26:00 の店が、火曜1:30（日本時間）に営業中", () => {
  const s = openStatus(monLate, jst("2026-11-10T01:30"));
  assert.equal(s.open, true);
  assert.equal(s.minutesToClose, 30);
});

test("UTCの月曜16:30（＝日本時間の火曜1:30）を渡しても、日本時間で判定する", () => {
  const s = openStatus(monLate, new Date("2026-11-09T16:30:00Z"));
  assert.equal(s.open, true);
  assert.equal(s.minutesToClose, 30);
});

test("月曜 18:00-26:00 の店：17:59は営業外、18:00ちょうどは営業中、火曜2:00ちょうどは営業外", () => {
  assert.equal(openStatus(monLate, jst("2026-11-09T17:59")).open, false);
  assert.equal(openStatus(monLate, jst("2026-11-09T18:00")).open, true);
  assert.equal(openStatus(monLate, jst("2026-11-10T02:00")).open, false);
});

test("日曜 18:00-29:00 の店が、月曜3:00に営業中（曜日の境目）", () => {
  const sunLate = makeShop("shop_902", { hours: week({ sun: ["18:00-29:00"] }) });
  const s = openStatus(sunLate, jst("2026-11-09T03:00"));
  assert.equal(s.open, true);
  assert.equal(s.minutesToClose, 120);
});

test("定休日（空の配列）の日は、昼も夜も営業していない", () => {
  // 火曜が定休日で、月曜の営業は 18:00-24:00
  const shop = makeShop("shop_903", { hours: { ...everyDay(["18:00-24:00"]), tue: [] } });
  assert.equal(openStatus(shop, jst("2026-11-10T13:00")).open, false);
  assert.equal(openStatus(shop, jst("2026-11-10T20:00")).open, false);
  assert.equal(openStatus(shop, jst("2026-11-11T20:00")).open, true);
});

test("前日の 17:00-29:00 と当日の 05:00-08:00 はつなげて数える（4:00 → 閉店まで240分）", () => {
  const shop = makeShop("shop_904", { hours: everyDay(["05:00-08:00", "17:00-29:00"]) });
  const s = openStatus(shop, jst("2026-11-10T04:00"));
  assert.equal(s.open, true);
  assert.equal(s.minutesToClose, 240);
});

test("昼休みがある店：15:30は営業外、14:00は閉店まで60分（夜の範囲とつなげない）", () => {
  const shop = makeShop("shop_905", { hours: everyDay(["12:00-15:00", "17:00-23:00"]) });
  assert.equal(openStatus(shop, jst("2026-11-10T15:30")).open, false);
  assert.equal(openStatus(shop, jst("2026-11-10T14:00")).minutesToClose, 60);
});

test("24時間営業（毎日 00:00-24:00）は、いつでも営業中で閉店間際にならない", () => {
  const shop = makeShop("shop_906", { hours: ALWAYS });
  for (const t of ["2026-11-09T00:00", "2026-11-09T23:59", "2026-11-15T23:30", "2026-11-10T04:59"]) {
    const s = openStatus(shop, jst(t));
    assert.equal(s.open, true, t);
    assert.equal(s.minutesToClose, Infinity, t);
    assert.equal(isSelectableHours(shop, jst(t)), true, t);
  }
});

test("選べる営業状態：閉店まで残り75分は選ばない、75分30秒・76分は選ぶ", () => {
  const shop = makeShop("shop_907", { hours: everyDay(["18:00-24:00"]) });
  assert.equal(isSelectableHours(shop, jst("2026-11-10T22:45")), false); // 残り75分
  assert.equal(isSelectableHours(shop, new Date("2026-11-10T22:44:30+09:00")), true); // 75分30秒
  assert.equal(isSelectableHours(shop, jst("2026-11-10T22:44")), true); // 76分
});

test("選べる営業状態：開店10分前は選ばない", () => {
  const shop = makeShop("shop_908", { hours: everyDay(["18:00-24:00"]) });
  assert.equal(isSelectableHours(shop, jst("2026-11-10T17:50")), false);
});

test("朝5時の切り替え：23時と翌2時は同じ日、4:59と5:01は別の日、5:00ちょうどは新しい日", () => {
  assert.equal(dayKey(jst("2026-11-09T23:00")), dayKey(jst("2026-11-10T02:00")));
  assert.notEqual(dayKey(jst("2026-11-10T04:59")), dayKey(jst("2026-11-10T05:01")));
  assert.equal(dayKey(jst("2026-11-10T04:59")), "2026-11-09");
  assert.equal(dayKey(jst("2026-11-10T05:00")), "2026-11-10");
});

test("日付は Z の形でも +09:00 の形でも同じになる", () => {
  assert.equal(dayKey("2026-11-09T19:30:00Z"), dayKey("2026-11-10T04:30:00+09:00"));
  assert.equal(dayKey("2026-11-09T20:00:00Z"), "2026-11-10");
});

test("次の朝5時：月曜23:00 → 火曜5:00、火曜5:01 → 水曜5:00", () => {
  assert.equal(nextDayBoundary(jst("2026-11-09T23:00")).getTime(), jst("2026-11-10T05:00").getTime());
  assert.equal(nextDayBoundary(jst("2026-11-10T05:01")).getTime(), jst("2026-11-11T05:00").getTime());
});
