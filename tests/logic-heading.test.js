// 方位センサーの計算：横向きの補正・矢印の角度・平滑化・状態（requirements.md 10章）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDeg,
  angleDiff,
  headingFromReading,
  arrowAngle,
  smoothHeading,
  unwrapAngle,
  headingStatusStart,
  nextHeadingStatus,
} from "../src/logic.js";
import { HEADING_TIMEOUT_SEC } from "../src/config.js";

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} は ${expected} に近くない`);

// ---------- 角度の基本 ----------

test("角度をそろえる：-90 → 270、360 → 0、725 → 5", () => {
  assert.equal(normalizeDeg(-90), 270);
  assert.equal(normalizeDeg(360), 0);
  assert.equal(normalizeDeg(725), 5);
  assert.ok(Object.is(normalizeDeg(-360), 0));
});

test("最短の角度差：350→10 は +20、10→350 は −20", () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), -20);
  assert.equal(angleDiff(0, 180), 180);
});

// ---------- 端末の方位（横向きの補正） ----------

test("iPhone：webkitCompassHeading が90、縦向き → 90", () => {
  assert.equal(headingFromReading({ compass: 90 }, 0), 90);
});

test("Android：alpha が90 → 270（360 − alpha）", () => {
  assert.equal(headingFromReading({ alpha: 90 }, 0), 270);
});

test("Android：alpha が0 → 0（360 にはしない）", () => {
  assert.equal(headingFromReading({ alpha: 0 }, 0), 0);
});

test("横向きの補正：iPhone 270 で画面の回転角が90 → 0", () => {
  assert.equal(headingFromReading({ compass: 270 }, 90), 0);
});

test("横向きの補正：Android alpha 90 で画面の回転角が90 → 0", () => {
  assert.equal(headingFromReading({ alpha: 90 }, 90), 0);
});

test("横向きの補正：古いiPhoneの window.orientation が −90 → 270 と同じに補正する", () => {
  assert.equal(headingFromReading({ compass: 100 }, -90), headingFromReading({ compass: 100 }, 270));
  assert.equal(headingFromReading({ compass: 100 }, -90), 10);
});

test("横向きの補正：画面の回転角が180（逆さま） → 180 を足す", () => {
  assert.equal(headingFromReading({ compass: 30 }, 180), 210);
});

test("方位の値がない → null（使わない）", () => {
  assert.equal(headingFromReading({}, 0), null);
  assert.equal(headingFromReading({ compass: undefined, alpha: null }, 0), null);
  assert.equal(headingFromReading(null, 0), null);
});

test("iPhone の値を Android の値より先に使う", () => {
  assert.equal(headingFromReading({ compass: 45, alpha: 90 }, 0), 45);
});

// ---------- 矢印の角度 ----------

test("矢印：店が90度、端末が0度、補正0 → 90", () => {
  assert.equal(arrowAngle(90, 0, 0), 90);
});

test("矢印：店が10度、端末が350度 → 20", () => {
  assert.equal(arrowAngle(10, 350, 0), 20);
});

test("矢印：店が0度、端末が0度、補正 −7（東京） → 7", () => {
  assert.equal(arrowAngle(0, 0, -7), 7);
});

test("矢印の角度は常に0以上360未満", () => {
  for (const [b, h, d] of [[0, 359, 0], [359, 0, 0], [0, 0, 7], [180, 180, -7], [720, -720, 0]]) {
    const a = arrowAngle(b, h, d);
    assert.ok(a >= 0 && a < 360, `${a}`);
  }
});

// ---------- 平滑化（359度と0度の境目） ----------

test("平滑化：前が359、新しい値が1 → 0付近になり、180付近を通らない", () => {
  const s = smoothHeading(359, 1, 0.5);
  close(s, 0);
  const s2 = smoothHeading(359, 1, 0.25);
  assert.ok(s2 > 359 || s2 < 1, `${s2}`);
});

test("平滑化：前が1、新しい値が359 → 0付近", () => {
  const s = smoothHeading(1, 359, 0.25);
  assert.ok(s > 359 || s < 1, `${s}`);
});

test("平滑化：初回（前の値がない） → 新しい値そのまま", () => {
  assert.equal(smoothHeading(null, 123), 123);
  assert.equal(smoothHeading(undefined, 370), 10);
});

test("平滑化：同じ値を何回も入れる → その値に近づいていく（境目をまたいでも）", () => {
  let s = 350;
  for (let i = 0; i < 60; i++) s = smoothHeading(s, 20);
  close(s, 20, 0.01);
});

test("平滑化：結果は常に0以上360未満", () => {
  let s = 0;
  for (const raw of [359, 1, 358, 2, 180, 0, 359.9]) {
    s = smoothHeading(s, raw);
    assert.ok(s >= 0 && s < 360, `${s}`);
  }
});

test("平滑化：値がない（null）ときは前の値のまま", () => {
  assert.equal(smoothHeading(42, null), 42);
});

// ---------- 矢印を回すときの連続した角度 ----------

test("連続した角度：前が350、次が10 → 370（逆回りの −340 にはしない）", () => {
  assert.equal(unwrapAngle(350, 10), 370);
});

test("連続した角度：前が10、次が350 → −10", () => {
  assert.equal(unwrapAngle(10, 350), -10);
});

test("連続した角度：前が725（2周した後）、次が5 → 725 のまま", () => {
  assert.equal(unwrapAngle(725, 5), 725);
});

test("連続した角度：初回は 0〜360 の値", () => {
  assert.equal(unwrapAngle(null, -30), 330);
});

// ---------- 方位センサーの状態 ----------

const T = HEADING_TIMEOUT_SEC * 1000;

test("方位：開始直後は待機中。値が来たら取得中", () => {
  const s0 = headingStatusStart(0);
  assert.equal(s0.status, "waiting");
  assert.equal(nextHeadingStatus(s0, { type: "value", heading: 10, atMs: 100 }).status, "active");
});

test(`方位：${HEADING_TIMEOUT_SEC}秒たっても値が来ない → 使えない`, () => {
  let s = headingStatusStart(1000);
  s = nextHeadingStatus(s, { type: "tick", atMs: 1000 + T - 1 });
  assert.equal(s.status, "waiting");
  s = nextHeadingStatus(s, { type: "tick", atMs: 1000 + T });
  assert.equal(s.status, "unavailable");
});

test("方位：使えないと判定した後で有効な値が届く → 取得中に切り替わる", () => {
  let s = headingStatusStart(0);
  s = nextHeadingStatus(s, { type: "tick", atMs: T + 500 });
  assert.equal(s.status, "unavailable");
  s = nextHeadingStatus(s, { type: "value", heading: 200, atMs: T + 4000 });
  assert.equal(s.status, "active");
});

test("方位：使えないの後に値のないイベント（null）が来ても、使えないのまま", () => {
  let s = nextHeadingStatus(headingStatusStart(0), { type: "tick", atMs: T });
  s = nextHeadingStatus(s, { type: "value", heading: null, atMs: T + 10 });
  assert.equal(s.status, "unavailable");
});

test("方位：取得中になった後は、時間がたっても使えないにならない", () => {
  let s = nextHeadingStatus(headingStatusStart(0), { type: "value", heading: 1, atMs: 10 });
  s = nextHeadingStatus(s, { type: "tick", atMs: T * 10 });
  assert.equal(s.status, "active");
});

test("方位：iPhone で許可されなかった → 拒否。後で値が届けば取得中", () => {
  let s = nextHeadingStatus(headingStatusStart(0), { type: "denied" });
  assert.equal(s.status, "denied");
  s = nextHeadingStatus(s, { type: "tick", atMs: T * 2 });
  assert.equal(s.status, "denied");
  s = nextHeadingStatus(s, { type: "value", heading: 5, atMs: T * 3 });
  assert.equal(s.status, "active");
});
