// トロフィーの形（8章）：すべての段階に形があること
import { test } from "node:test";
import assert from "node:assert/strict";
import { TROPHY_SHAPES } from "../src/trophy-icons.js";
import { TROPHY_LEVELS } from "../src/config.js";

test("アイアン前と7段階のすべてに形がある", () => {
  for (const id of ["none", ...TROPHY_LEVELS.map((l) => l.id)]) {
    assert.ok(Array.isArray(TROPHY_SHAPES[id]) && TROPHY_SHAPES[id].length > 0, id);
  }
});

test("シルバーとポラリスは部品の数が違う（形だけで見分ける）", () => {
  assert.notEqual(TROPHY_SHAPES.silver.length, TROPHY_SHAPES.polaris.length);
});
