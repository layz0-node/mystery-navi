// 店の選出と圏外画面の判定（4-1・4-2）
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectShop } from "../src/logic.js";
import { BASE, makeShop, everyDay, jst, sequence, visit } from "./fixtures/make-shop.js";

const NOW = jst("2026-11-10T20:00"); // 火曜20:00
const PAST = jst("2026-11-01T21:00"); // 除外にかからない昔の記録

function pick({ shops, visits = [], random = sequence(0, 0), avoidShopId = null, now = NOW }) {
  return selectShop({ shops, visits, position: BASE, now, random, avoidShopId });
}

// ---------- 距離の条件 ----------

test("距離：199.9mの店は選ばれない（200m以内にしか店がない → A2）", () => {
  assert.deepEqual(pick({ shops: [makeShop("shop_001", { distance: 199.9 })] }), { result: "A2" });
});

test("距離：200.1mと999.9mの店は選ばれる", () => {
  for (const distance of [200.1, 999.9]) {
    const r = pick({ shops: [makeShop("shop_001", { distance })] });
    assert.equal(r.result, "ok", String(distance));
    assert.equal(r.shop.id, "shop_001");
  }
});

test("距離：1000.1mの店は候補に入らない（1km以内に1軒もない → A1）", () => {
  assert.deepEqual(pick({ shops: [makeShop("shop_001", { distance: 1000.1 })] }), { result: "A1" });
});

test("圏外：店がひとつもない → A1", () => {
  assert.deepEqual(pick({ shops: [] }), { result: "A1" });
});

test("圏外：200m以内と1.5km先に店がある → A2（A1ではない）", () => {
  const shops = [makeShop("shop_001", { distance: 150 }), makeShop("shop_002", { distance: 1500 })];
  assert.deepEqual(pick({ shops }), { result: "A2" });
});

test("圏外：候補がすべて除外中 → B", () => {
  const shops = [makeShop("shop_001"), makeShop("shop_002", { distance: 700 })];
  const visits = [
    visit("shop_001", "good", jst("2026-11-10T19:00")),
    visit("shop_002", "closed", jst("2026-11-07T21:00")),
  ];
  assert.deepEqual(pick({ shops, visits }), { result: "B" });
});

test("圏外：候補が、閉店まで75分以内の店や開店前の店だけ → C", () => {
  const shops = [
    makeShop("shop_001", { hours: everyDay(["18:00-21:15"]) }), // 残り75分
    makeShop("shop_002", { hours: everyDay(["20:10-26:00"]) }), // 開店10分前
  ];
  assert.deepEqual(pick({ shops }), { result: "C" });
});

test("圏外：除外中の店と開店前の店が混ざっている → C", () => {
  const shops = [makeShop("shop_001"), makeShop("shop_002", { hours: everyDay(["22:00-26:00"]) })];
  const visits = [visit("shop_001", "skip", jst("2026-11-10T19:00"))];
  assert.deepEqual(pick({ shops, visits }), { result: "C" });
});

test("営業時間：閉店まで残り75分は選ばない、75分30秒・76分は選ぶ", () => {
  const shops = [makeShop("shop_001", { hours: everyDay(["18:00-24:00"]) })];
  assert.equal(pick({ shops, now: jst("2026-11-10T22:45") }).result, "C");
  assert.equal(pick({ shops, now: new Date("2026-11-10T22:44:30+09:00") }).result, "ok");
  assert.equal(pick({ shops, now: jst("2026-11-10T22:44") }).result, "ok");
});

test("営業時間：開店10分前の店は選ばない", () => {
  const shops = [makeShop("shop_001", { hours: everyDay(["20:10-26:00"]) })];
  assert.equal(pick({ shops }).result, "C");
});

test("店リストにない店の記録は、選出に影響しない", () => {
  const shops = [makeShop("shop_001"), makeShop("shop_002", { distance: 700 })];
  const visits = [visit("shop_999", "good", jst("2026-11-10T19:00"))];
  // 2軒とも未訪問のまま。乱数0.6 → 2軒目
  const r = pick({ shops, visits, random: sequence(0.6) });
  assert.equal(r.shop.id, "shop_002");
});

// ---------- 除外 ----------

test("除外：今日記録した店は選ばれず、翌朝5:00以降は選ばれる", () => {
  const shops = [makeShop("shop_001")];
  const visits = [visit("shop_001", "good", jst("2026-11-09T23:00"))];
  assert.equal(pick({ shops, visits, now: jst("2026-11-10T04:59") }).result, "B");
  assert.equal(pick({ shops, visits, now: jst("2026-11-10T05:00") }).result, "ok");
});

test("除外：closed から167時間後は選ばれない、169時間後は選ばれる", () => {
  const at = jst("2026-11-03T20:00");
  const shops = [makeShop("shop_001")];
  const visits = [visit("shop_001", "closed", at)];
  const h = (n) => new Date(at.getTime() + n * 3600 * 1000);
  assert.equal(pick({ shops, visits, now: h(167) }).result, "B");
  assert.equal(pick({ shops, visits, now: h(169) }).result, "ok");
});

test("除外：bad の店も、翌日以降は選ばれる", () => {
  const shops = [makeShop("shop_001")];
  const visits = [visit("shop_001", "bad", jst("2026-11-09T21:00"))];
  assert.equal(pick({ shops, visits }).shop.id, "shop_001");
});

// ---------- グループと選ばれやすさ ----------

const twoGroups = [makeShop("shop_001"), makeShop("shop_002", { distance: 700 })];
const shop2Visited = [visit("shop_002", "skip", PAST)];

test("グループ：両方に店があり、グループの乱数が0.69 → 未訪問から選ぶ", () => {
  assert.equal(pick({ shops: twoGroups, visits: shop2Visited, random: sequence(0.69, 0) }).shop.id, "shop_001");
});

test("グループ：両方に店があり、グループの乱数が0.71 → 訪問済みから選ぶ", () => {
  assert.equal(pick({ shops: twoGroups, visits: shop2Visited, random: sequence(0.71, 0) }).shop.id, "shop_002");
});

test("グループ：グループの乱数が0.70ちょうど → 訪問済みから選ぶ", () => {
  assert.equal(pick({ shops: twoGroups, visits: shop2Visited, random: sequence(0.7, 0) }).shop.id, "shop_002");
});

test("グループ：skip だけの店は訪問済みグループに入る（乱数0.69で未訪問の店が選ばれる）", () => {
  // 0.69 で未訪問グループ。skip だけの shop_002 が未訪問なら候補が2軒になり、乱数0.99で shop_002 になるはず
  assert.equal(pick({ shops: twoGroups, visits: shop2Visited, random: sequence(0.69, 0.99) }).shop.id, "shop_001");
});

test("グループ：未訪問だけのときは、乱数に関係なくそちらから選ぶ（グループの乱数を使わない）", () => {
  for (const r of [0, 0.99]) {
    const got = pick({ shops: [makeShop("shop_001")], random: sequence(r) });
    assert.equal(got.shop.id, "shop_001");
  }
});

test("グループ：訪問済みだけのときは、乱数に関係なくそちらから選ぶ", () => {
  const shops = [makeShop("shop_001")];
  const visits = [visit("shop_001", "good", PAST)];
  for (const r of [0, 0.99]) {
    assert.equal(pick({ shops, visits, random: sequence(r) }).shop.id, "shop_001");
  }
});

const weighted = [makeShop("shop_A"), makeShop("shop_B", { distance: 700 })];
const weightedVisits = [visit("shop_A", "good", PAST), visit("shop_B", "bad", PAST)];

test("重み：訪問済みにプラスのAとマイナスのB → 店の乱数0.66ならA、0.67ならB", () => {
  assert.equal(pick({ shops: weighted, visits: weightedVisits, random: sequence(0.66) }).shop.id, "shop_A");
  assert.equal(pick({ shops: weighted, visits: weightedVisits, random: sequence(0.67) }).shop.id, "shop_B");
});

test("重み：乱数を等間隔に3000通り試すと、Bが選ばれるのはちょうど1/3（1000回）", () => {
  let countB = 0;
  for (let i = 0; i < 3000; i++) {
    const r = pick({ shops: weighted, visits: weightedVisits, random: sequence((i + 0.5) / 3000) });
    if (r.shop.id === "shop_B") countB++;
  }
  assert.equal(countB, 1000);
});

test("未訪問グループの3軒は、乱数の区間どおり均等に選ぶ", () => {
  const shops = [
    makeShop("shop_001", { distance: 300 }),
    makeShop("shop_002", { distance: 500 }),
    makeShop("shop_003", { distance: 700 }),
  ];
  assert.equal(pick({ shops, random: sequence(0.33) }).shop.id, "shop_001");
  assert.equal(pick({ shops, random: sequence(0.34) }).shop.id, "shop_002");
  assert.equal(pick({ shops, random: sequence(0.66) }).shop.id, "shop_002");
  assert.equal(pick({ shops, random: sequence(0.67) }).shop.id, "shop_003");
});

test("乱数を固定すると、毎回同じ店が選ばれる", () => {
  const shops = [1, 2, 3, 4, 5].map((n) => makeShop(`shop_00${n}`, { distance: 250 + n * 100, bearing: n * 60 }));
  const visits = [visit("shop_002", "good", PAST), visit("shop_004", "bad", PAST)];
  const ids = [1, 2, 3].map(() => pick({ shops, visits, random: sequence(0.8, 0.4) }).shop.id);
  assert.equal(new Set(ids).size, 1);
});

test("選んだ店の距離も返す", () => {
  const r = pick({ shops: [makeShop("shop_001", { distance: 640 })] });
  assert.ok(Math.abs(r.distanceM - 640) < 0.01);
  assert.equal(r.onlyThisShop, false);
});

// ---------- 別のお店にする ----------

test("別のお店にする：直前の店と、ほかの候補がある → 直前の店は乱数を変えても選ばれない", () => {
  const shops = [makeShop("shop_001"), makeShop("shop_002", { distance: 700 })];
  for (const r of [0, 0.5, 0.99]) {
    const got = pick({ shops, avoidShopId: "shop_001", random: sequence(r) });
    assert.equal(got.shop.id, "shop_002");
    assert.equal(got.onlyThisShop, false);
  }
});

test("別のお店にする：候補が直前の店だけ → その店を選び、「ここだけ」になる", () => {
  const shops = [makeShop("shop_001"), makeShop("shop_002", { distance: 150 })];
  const r = pick({ shops, avoidShopId: "shop_001" });
  assert.equal(r.result, "ok");
  assert.equal(r.shop.id, "shop_001");
  assert.equal(r.onlyThisShop, true);
});

test("別のお店にする：直前の店が距離・除外・営業時間で外れ、ほかに候補がない → 圏外画面", () => {
  assert.equal(pick({ shops: [makeShop("shop_001", { distance: 50 })], avoidShopId: "shop_001" }).result, "A2");
  const visits = [visit("shop_001", "skip", jst("2026-11-10T19:00"))];
  assert.equal(pick({ shops: [makeShop("shop_001")], visits, avoidShopId: "shop_001" }).result, "B");
  const closedShop = makeShop("shop_001", { hours: everyDay(["22:00-26:00"]) });
  assert.equal(pick({ shops: [closedShop], avoidShopId: "shop_001" }).result, "C");
});
