// ナビ画面の表示に使う純粋な関数（S1・4-2・12章）
import { test } from "node:test";
import assert from "node:assert/strict";
import { compassAngles, spinAngle, hintSlots, reselectOutcome, appMode, headingUsable } from "../src/logic.js";
import { testShopsStorage, TEST_SHOPS_STORAGE_KEY } from "../src/storage.js";
import { STORAGE_KEY } from "../src/config.js";
import { MemoryStorage } from "./fixtures/memory-storage.js";

test("方位がないときは N を上に固定し、矢印は方位角そのまま", () => {
  assert.deepEqual(compassAngles(90, null), { northUp: true, dial: 0, arrow: 90 });
});

test("文字盤と矢印は同じ補正後の向きを使う", () => {
  const a = compassAngles(90, 80, -7);
  assert.equal(a.dial, 287); // -(80-7) = -73
  assert.equal(a.arrow, 17); // 90-(80-7)
  assert.equal(compassAngles(45, 45, 0).arrow, 0); // 店の方向を向くと真上
});

test("行き先の変更は時計回りに1回転してから止まる", () => {
  assert.equal(spinAngle(10, 100), 10 + 90 + 360);
  assert.equal(spinAngle(100, 10), 100 + 270 + 360);
  assert.equal(spinAngle(null, 0), 360);
});

test("ヒント欄：3つ目はナビ画面では解放しない", () => {
  const s = hintSlots(["a", "b", "c"], 2);
  assert.deepEqual(s.map((x) => x.open), [true, true, false]);
  assert.equal(s[2].lockLabel, "到着で解放");
  assert.equal(hintSlots(["a", "b", "c"], 0)[0].lockLabel, "500m で解放");
  assert.equal(hintSlots(["a", "b", "c"], 0)[0].text, null);
});

test("選び直しの結果", () => {
  assert.equal(reselectOutcome("x", { result: "C" }), "none");
  assert.equal(reselectOutcome("x", { result: "ok", shop: { id: "x" } }), "same");
  assert.equal(reselectOutcome("x", { result: "ok", shop: { id: "y" } }), "changed");
});

test("ダミー店モードは ?debug=1 のときだけ効く", () => {
  assert.deepEqual(appMode("?debug=1&shops=test"), { debug: true, testShops: true });
  assert.deepEqual(appMode("?shops=test"), { debug: false, testShops: false });
  assert.deepEqual(appMode(""), { debug: false, testShops: false });
});

test("方位が使えるのは動いていて値があるときだけ", () => {
  assert.equal(headingUsable({ headingStatus: "active", heading: 10 }), true);
  assert.equal(headingUsable({ headingStatus: "waiting", heading: 10 }), false);
  assert.equal(headingUsable({ headingStatus: "active", heading: null }), false);
});

test("ダミー店モードの保存先は本物の保存データと分かれる", () => {
  const real = new MemoryStorage({ [STORAGE_KEY]: "本物", "mysteryNavi.debug": "{}" });
  const s = testShopsStorage(real);
  assert.equal(s.getItem(STORAGE_KEY), null);
  s.setItem(STORAGE_KEY, "ダミー");
  s.setItem(`${STORAGE_KEY}.beforeReset.x`, "退避");
  assert.equal(real.getItem(STORAGE_KEY), "本物");
  assert.equal(real.getItem(TEST_SHOPS_STORAGE_KEY), "ダミー");
  assert.equal(real.getItem(`${TEST_SHOPS_STORAGE_KEY}.beforeReset.x`), "退避");
  const keys = Array.from({ length: s.length }, (_, i) => s.key(i)).sort();
  assert.deepEqual(keys, ["mysteryNavi.debug", STORAGE_KEY, `${STORAGE_KEY}.beforeReset.x`].sort());
  assert.equal(s.getItem("mysteryNavi.debug"), "{}");
  assert.equal(s.realKey(STORAGE_KEY), TEST_SHOPS_STORAGE_KEY);
});
