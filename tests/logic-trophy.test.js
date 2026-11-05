// トロフィーの集計（4-3・S5）
import { test } from "node:test";
import assert from "node:assert/strict";
import { trophySummary } from "../src/logic.js";
import { jst, visit } from "./fixtures/make-shop.js";

// 別々の店を n 回評価した記録（同じ日にまとめない）
function visitsOfCount(n) {
  return Array.from({ length: n }, (_, i) => visit(`shop_${String(i + 1).padStart(3, "0")}`, "good", jst("2026-11-10T21:00")));
}

test("6種類どの記録も1回に数える", () => {
  const values = ["good", "bad", "declined", "closed", "skip", "full"];
  const visits = values.map((v, i) => visit(`shop_00${i + 1}`, v, jst("2026-11-10T21:00")));
  assert.equal(trophySummary(visits).count, 6);
});

test("同じ店を月曜23:00と火曜2:00に評価 → 1回（同じ日）", () => {
  const visits = [visit("shop_001", "good", jst("2026-11-09T23:00")), visit("shop_001", "bad", jst("2026-11-10T02:00"))];
  assert.equal(trophySummary(visits).count, 1);
});

test("同じ店を4:59と5:01に評価 → 2回（別の日）", () => {
  const visits = [visit("shop_001", "good", jst("2026-11-10T04:59")), visit("shop_001", "good", jst("2026-11-10T05:01"))];
  assert.equal(trophySummary(visits).count, 2);
});

test("別の店なら、同じ日でも別々に数える", () => {
  const visits = [visit("shop_001", "good", jst("2026-11-10T21:00")), visit("shop_002", "good", jst("2026-11-10T23:00"))];
  assert.equal(trophySummary(visits).count, 2);
});

test("店リストから消えた店の記録も数える（店リストを渡さない集計なので、どの店IDでも数える）", () => {
  const visits = [visit("shop_gone", "good", jst("2026-11-10T21:00"))];
  const s = trophySummary(visits);
  assert.equal(s.count, 1);
  assert.equal(s.visitedShops, 1);
});

test("Z と +09:00 の日時が混ざっていても、同じ日・同じ回数になる", () => {
  const visits = [
    { shopId: "shop_001", value: "good", at: "2026-11-09T14:00:00Z" }, // 月曜23:00（日本時間）
    { shopId: "shop_001", value: "good", at: "2026-11-10T02:00:00+09:00" }, // 同じ日
    { shopId: "shop_002", value: "good", at: "2026-11-09T19:59:00Z" }, // 火曜4:59
    { shopId: "shop_002", value: "good", at: "2026-11-10T05:01:00+09:00" }, // 別の日
  ];
  assert.equal(trophySummary(visits).count, 3);
});

test("0回 → なし、次はアイアン、あと5回", () => {
  const s = trophySummary([]);
  assert.equal(s.count, 0);
  assert.equal(s.level, null);
  assert.equal(s.nextLevel.id, "iron");
  assert.equal(s.remaining, 5);
  assert.equal(s.isMax, false);
});

test("回数ごとの段階：4でなし、5でアイアン、9でアイアン、10でブロンズ、20でシルバー、149でダイヤ、150でポラリス", () => {
  const cases = [
    [4, null],
    [5, "iron"],
    [9, "iron"],
    [10, "bronze"],
    [20, "silver"],
    [149, "diamond"],
    [150, "polaris"],
  ];
  for (const [n, id] of cases) assert.equal(trophySummary(visitsOfCount(n)).level?.id ?? null, id, `${n}回`);
});

// 段階の回数と名前を、config.js に頼らず直接書いて確かめる
const EXPECTED_LEVELS = [
  { count: 5, id: "iron", name: "アイアン", prev: null },
  { count: 10, id: "bronze", name: "ブロンズ", prev: "iron" },
  { count: 20, id: "silver", name: "シルバー", prev: "bronze" },
  { count: 35, id: "gold", name: "ゴールド", prev: "silver" },
  { count: 60, id: "emerald", name: "エメラルド", prev: "gold" },
  { count: 100, id: "diamond", name: "ダイヤ", prev: "emerald" },
  { count: 150, id: "polaris", name: "ポラリス", prev: "diamond" },
];

for (const { count, id, name, prev } of EXPECTED_LEVELS) {
  test(`${name}：${count - 1}回ではまだ前の段階で「あと1回」、${count}回ちょうどで${name}`, () => {
    const before = trophySummary(visitsOfCount(count - 1));
    assert.equal(before.level?.id ?? null, prev);
    assert.equal(before.nextLevel.id, id);
    assert.equal(before.nextLevel.name, name);
    assert.equal(before.remaining, 1);

    const at = trophySummary(visitsOfCount(count));
    assert.equal(at.level.id, id);
    assert.equal(at.level.name, name);
  });
}

test("次の段階まであと何回：23回 → 次はゴールド、あと12回", () => {
  const s = trophySummary(visitsOfCount(23));
  assert.equal(s.level.id, "silver");
  assert.equal(s.nextLevel.id, "gold");
  assert.equal(s.remaining, 12);
});

test("ポラリスでは最上級（「あと何回」はなし）。151回でもポラリス", () => {
  for (const n of [150, 151]) {
    const s = trophySummary(visitsOfCount(n));
    assert.equal(s.level.id, "polaris");
    assert.equal(s.isMax, true);
    assert.equal(s.nextLevel, null);
    assert.equal(s.remaining, null);
  }
});

test("訪れた店の数：同じ店を何回評価しても1軒", () => {
  const visits = [
    visit("shop_001", "good", jst("2026-11-01T21:00")),
    visit("shop_001", "bad", jst("2026-11-05T21:00")),
    visit("shop_001", "skip", jst("2026-11-09T21:00")),
  ];
  assert.equal(trophySummary(visits).visitedShops, 1);
});

test("良い店・悪い店：点数のプラス・マイナスで数え、0の店はどちらにも入らない（消えた店も含む）", () => {
  const visits = [
    visit("shop_001", "good", jst("2026-11-01T21:00")), // ＋1
    visit("shop_002", "bad", jst("2026-11-01T22:00")), // −1
    visit("shop_003", "good", jst("2026-11-02T21:00")),
    visit("shop_003", "closed", jst("2026-11-03T21:00")), // 0
    visit("shop_gone", "declined", jst("2026-11-04T21:00")), // −1（店リストから消えた店）
    visit("shop_004", "full", jst("2026-11-04T22:00")), // 0
  ];
  const s = trophySummary(visits);
  assert.equal(s.visitedShops, 5);
  assert.equal(s.goodShops, 1);
  assert.equal(s.badShops, 2);
});
