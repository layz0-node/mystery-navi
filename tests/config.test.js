import { test } from "node:test";
import assert from "node:assert/strict";
import * as config from "../src/config.js";

test("トロフィーの段階は回数の少ない順で、id が重ならない", () => {
  const levels = config.TROPHY_LEVELS;
  assert.equal(levels.length, 7);
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i].count > levels[i - 1].count);
  assert.equal(new Set(levels.map((l) => l.id)).size, levels.length);
  assert.deepEqual(levels.map((l) => l.count), [5, 10, 20, 35, 60, 100, 150]);
});

test("点数は6種類の記録すべてにある", () => {
  assert.deepEqual(config.SCORE, { good: 1, bad: -1, declined: -1, closed: -1, skip: 0, full: 0 });
});

test("距離の定数の大小関係", () => {
  assert.ok(config.ARRIVAL_RADIUS_M < config.MIN_TARGET_DISTANCE_M);
  assert.ok(config.HINT2_RADIUS_M < config.HINT1_RADIUS_M);
  assert.ok(config.HINT1_RADIUS_M < config.SEARCH_RADIUS_M);
  assert.ok(config.MIN_TARGET_DISTANCE_M < config.SEARCH_RADIUS_M);
});

test("確率と重みが0〜1の範囲", () => {
  assert.ok(config.UNVISITED_PICK_RATE >= 0 && config.UNVISITED_PICK_RATE <= 1);
  assert.ok(config.BAD_PICK_WEIGHT > 0 && config.BAD_PICK_WEIGHT <= 1);
});

test("地図のURLは {query} を含む", () => {
  assert.match(config.MAP_SEARCH_URL, /\{query\}/);
});
