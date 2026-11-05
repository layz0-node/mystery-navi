// 点数・矢印の色・除外・グループ（6章「記録から決まること」）
import { test } from "node:test";
import assert from "node:assert/strict";
import { shopRecord } from "../src/logic.js";
import { jst, visit } from "./fixtures/make-shop.js";

const NOW = jst("2026-11-20T21:00");
const S = "shop_001";
const rec = (visits, now = NOW) => shopRecord(S, visits, now);

test("点数と色：good 1件 → ＋1・ミント", () => {
  const r = rec([visit(S, "good", jst("2026-11-01T21:00"))]);
  assert.equal(r.score, 1);
  assert.equal(r.color, "mint");
});

test("点数と色：good・closed（別の日）→ 0・通常", () => {
  const r = rec([visit(S, "good", jst("2026-11-01T21:00")), visit(S, "closed", jst("2026-11-02T21:00"))]);
  assert.equal(r.score, 0);
  assert.equal(r.color, "normal");
});

test("点数と色：good・closed・good（すべて別の日）→ ＋1・ミント", () => {
  const r = rec([
    visit(S, "good", jst("2026-11-01T21:00")),
    visit(S, "closed", jst("2026-11-02T21:00")),
    visit(S, "good", jst("2026-11-12T21:00")),
  ]);
  assert.equal(r.score, 1);
  assert.equal(r.color, "mint");
});

test("点数と色：bad 1件 → −1・赤黒", () => {
  const r = rec([visit(S, "bad", jst("2026-11-01T21:00"))]);
  assert.equal(r.score, -1);
  assert.equal(r.color, "bad");
});

test("点数と色：declined 1件 → −1・赤黒", () => {
  const r = rec([visit(S, "declined", jst("2026-11-01T21:00"))]);
  assert.equal(r.score, -1);
  assert.equal(r.color, "bad");
});

test("点数と色：good・declined → 0・通常", () => {
  const r = rec([visit(S, "good", jst("2026-11-01T21:00")), visit(S, "declined", jst("2026-11-03T21:00"))]);
  assert.equal(r.score, 0);
  assert.equal(r.color, "normal");
});

test("点数と色：skip・full だけ → 0・通常", () => {
  const r = rec([visit(S, "skip", jst("2026-11-01T21:00")), visit(S, "full", jst("2026-11-03T21:00"))]);
  assert.equal(r.score, 0);
  assert.equal(r.color, "normal");
});

test("点数と色：記録なし → 0・通常", () => {
  const r = rec([]);
  assert.equal(r.score, 0);
  assert.equal(r.color, "normal");
});

test("ほかの店の記録は、この店の点数に関係しない", () => {
  const r = rec([visit("shop_002", "bad", jst("2026-11-01T21:00"))]);
  assert.equal(r.score, 0);
  assert.equal(r.visited, false);
});

test("除外：今日（朝5時切り替え）記録した店は、6種類のどの評価でも除外中", () => {
  for (const value of ["good", "bad", "declined", "closed", "skip", "full"]) {
    assert.equal(rec([visit(S, value, jst("2026-11-20T19:00"))]).excluded, true, value);
  }
});

test("除外：月曜23時に good → 火曜4:59は除外中、火曜5:00は除外されない", () => {
  const v = [visit(S, "good", jst("2026-11-09T23:00"))];
  assert.equal(rec(v, jst("2026-11-10T04:59")).excluded, true);
  assert.equal(rec(v, jst("2026-11-10T05:00")).excluded, false);
});

test("除外：closed から167時間後は除外中、168時間ちょうども除外中、169時間後は除外されない", () => {
  const at = jst("2026-11-10T20:00");
  const v = [visit(S, "closed", at)];
  const h = (n) => new Date(at.getTime() + n * 3600 * 1000);
  assert.equal(rec(v, h(167)).excluded, true);
  assert.equal(rec(v, h(168)).excluded, true);
  assert.equal(rec(v, h(169)).excluded, false);
});

test("除外：closed の後に別の日の good があっても、最後の closed から7日数える", () => {
  const v = [
    visit(S, "closed", jst("2026-11-01T20:00")),
    visit(S, "good", jst("2026-11-10T20:00")),
    visit(S, "closed", jst("2026-11-15T20:00")),
  ];
  assert.equal(rec(v, jst("2026-11-20T21:00")).excluded, true);
});

test("除外：bad の店も、翌日以降は除外されない（重み0.5で残る）", () => {
  const r = rec([visit(S, "bad", jst("2026-11-19T21:00"))]);
  assert.equal(r.excluded, false);
  assert.equal(r.weight, 0.5);
});

test("グループ：記録が1件もない店は未訪問、skip だけの店は訪問済み", () => {
  assert.equal(rec([]).visited, false);
  assert.equal(rec([visit(S, "skip", jst("2026-11-01T21:00"))]).visited, true);
});

test("重み：点数マイナスは0.5、0やプラスは1", () => {
  assert.equal(rec([visit(S, "declined", jst("2026-11-01T21:00"))]).weight, 0.5);
  assert.equal(rec([visit(S, "full", jst("2026-11-01T21:00"))]).weight, 1);
  assert.equal(rec([visit(S, "good", jst("2026-11-01T21:00"))]).weight, 1);
});
