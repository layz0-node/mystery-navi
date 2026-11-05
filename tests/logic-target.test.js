// 保存中の案内先の再開判定（4-1・6章 currentTarget の破棄条件）
// 例の日付：2026-11-09 月曜、11-10 火曜、11-11 水曜
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTarget } from "../src/logic.js";
import { makeShop, everyDay, jst, visit } from "./fixtures/make-shop.js";

const shop = makeShop("shop_001", { distance: 150, hours: everyDay(["18:00-26:00"]) });
const shops = [shop, makeShop("shop_002", { distance: 600 })];
const minutes = (date, n) => new Date(date.getTime() + n * 60 * 1000);

const pending = (selectedAt) => ({ shopId: "shop_001", selectedAt: selectedAt.toISOString(), unlockedHints: 0, arrivedAt: null });
const arrived = (arrivedAt) => ({
  shopId: "shop_001",
  selectedAt: minutes(arrivedAt, -30).toISOString(),
  unlockedHints: 2,
  arrivedAt: arrivedAt.toISOString(),
});
const action = (target, now, visits = []) => resolveTarget(target, shops, visits, now).action;

test("未到着：2時間59分前に選んだ・除外中でない・営業中 → 再開", () => {
  const sel = jst("2026-11-10T19:00");
  const r = resolveTarget(pending(sel), shops, [], minutes(sel, 179));
  assert.equal(r.action, "resume");
  assert.equal(r.shop.id, "shop_001");
});

test("未到着：3時間ちょうど → 再開、3時間1分 → 捨てる", () => {
  const sel = jst("2026-11-10T19:00");
  assert.equal(action(pending(sel), minutes(sel, 180)), "resume");
  assert.equal(action(pending(sel), minutes(sel, 181)), "discard");
});

test("未到着：閉店まで30分でも再開する（75分ルールを使わない）", () => {
  assert.equal(action(pending(jst("2026-11-10T23:30")), jst("2026-11-11T01:30")), "resume");
});

test("未到着：店が150mの距離でも再開する（200mルールは使わない。距離を見ない）", () => {
  assert.equal(action(pending(jst("2026-11-10T19:00")), jst("2026-11-10T20:00")), "resume");
});

test("未到着：営業時間が過ぎた → 捨てる", () => {
  assert.equal(action(pending(jst("2026-11-11T00:30")), jst("2026-11-11T02:10")), "discard");
});

test("未到着：今日その店の記録がある → 捨てる", () => {
  const visits = [visit("shop_001", "skip", jst("2026-11-10T19:30"))];
  assert.equal(action(pending(jst("2026-11-10T19:00")), jst("2026-11-10T20:00"), visits), "discard");
});

test("未到着：店がデータから消えた → 捨てる", () => {
  const t = { ...pending(jst("2026-11-10T19:00")), shopId: "shop_999" };
  assert.equal(action(t, jst("2026-11-10T19:10")), "discard");
});

test("到着済み：5時間前に選んで閉店時刻も過ぎた → 到着画面を出す", () => {
  // 火曜 0:00 着、5時間後の火曜4:30（閉店2:00の後）
  const t = arrived(jst("2026-11-10T00:00"));
  t.selectedAt = jst("2026-11-09T23:30").toISOString();
  assert.equal(action(t, jst("2026-11-10T04:30")), "arrived");
});

test("到着済み：月曜23:00着 → 火曜4:59は到着画面、5:00に捨てる（記録は増えない）", () => {
  const t = arrived(jst("2026-11-09T23:00"));
  assert.equal(action(t, jst("2026-11-10T04:59")), "arrived");
  assert.equal(action(t, jst("2026-11-10T05:00")), "discard");
});

test("到着済み：火曜3:30着 → 6:30ちょうどまで到着画面、6:31に捨てる", () => {
  const t = arrived(jst("2026-11-10T03:30"));
  assert.equal(action(t, jst("2026-11-10T05:00")), "arrived");
  assert.equal(action(t, jst("2026-11-10T06:30")), "arrived");
  assert.equal(action(t, jst("2026-11-10T06:31")), "discard");
});

test("到着済み：火曜5:01着 → 水曜5:00まで到着画面（水曜4:59は到着画面、5:00に捨てる）", () => {
  const t = arrived(jst("2026-11-10T05:01"));
  assert.equal(action(t, jst("2026-11-10T23:00")), "arrived");
  assert.equal(action(t, jst("2026-11-11T04:59")), "arrived");
  assert.equal(action(t, jst("2026-11-11T05:00")), "discard");
});

test("到着済み：店がデータから消えた → 捨てる", () => {
  const t = { ...arrived(jst("2026-11-10T21:00")), shopId: "shop_999" };
  assert.equal(action(t, jst("2026-11-10T21:30")), "discard");
});

test("案内先がない → 捨てる扱い（新しく選ぶ）", () => {
  assert.equal(action(null, jst("2026-11-10T21:00")), "discard");
});

test("Z の形と +09:00 の形の日時が混ざっていても同じ判定になる", () => {
  const t = {
    shopId: "shop_001",
    selectedAt: "2026-11-10T03:00:00+09:00",
    unlockedHints: 2,
    arrivedAt: "2026-11-09T18:30:00Z", // 火曜3:30（日本時間）
  };
  assert.equal(action(t, jst("2026-11-10T06:30")), "arrived");
  assert.equal(action(t, jst("2026-11-10T06:31")), "discard");
});
