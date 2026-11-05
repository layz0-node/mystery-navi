// 距離・方位・距離の表示・ヒントと到着
import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceM, bearingDeg, formatDistance, hintProgress } from "../src/logic.js";
import { BASE, offset } from "./fixtures/make-shop.js";

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} ${actual} は ${expected}±${tol} ではありません`);

test("距離：緯度を0.01度ずらすと約1112m", () => {
  near(distanceM(BASE, { lat: BASE.lat + 0.01, lng: BASE.lng }), 1112, 1);
});

test("距離：同じ地点なら0m", () => {
  assert.equal(distanceM(BASE, BASE), 0);
});

test("方位：真北・真東・真南・真西の店で 0・90・180・270度前後", () => {
  const cases = [
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
  ];
  for (const [b, expected] of cases) {
    const got = bearingDeg(BASE, offset(BASE, 500, b));
    const diff = Math.min(Math.abs(got - expected), 360 - Math.abs(got - expected));
    assert.ok(diff < 0.1, `${b}度の店が ${got}度になりました`);
  }
});

test("方位：結果は0以上360未満", () => {
  const got = bearingDeg(BASE, offset(BASE, 500, 359.99));
  assert.ok(got >= 0 && got < 360);
});

test("距離の表示：1000m未満は10m単位で四捨五入、丸めて1000m以上なら km の小数1桁", () => {
  assert.equal(formatDistance(347), "350m");
  assert.equal(formatDistance(350), "350m");
  assert.equal(formatDistance(994), "990m");
  assert.equal(formatDistance(995), "1.0km");
  assert.equal(formatDistance(1234), "1.2km");
  assert.equal(formatDistance(1250.1), "1.3km");
  assert.equal(formatDistance(0), "0m");
});

test("ヒント：600mで0、500mで1、300mで2", () => {
  assert.equal(hintProgress(600, 10, 0).unlockedHints, 0);
  assert.equal(hintProgress(500, 10, 0).unlockedHints, 1);
  assert.equal(hintProgress(301, 10, 0).unlockedHints, 1);
  assert.equal(hintProgress(300, 10, 0).unlockedHints, 2);
});

test("ヒント：解放済みの数は、離れても減らない（保存値2のまま800m）", () => {
  assert.equal(hintProgress(800, 10, 2).unlockedHints, 2);
  assert.equal(hintProgress(450, 10, 2).unlockedHints, 2);
});

test("到着：100m以内・誤差60mなら到着", () => {
  const r = hintProgress(100, 60, 2);
  assert.equal(r.arrived, true);
  assert.equal(r.lowAccuracy, false);
});

test("到着：100m以内でも、誤差61mなら到着にしない（精度が低い状態を返す）", () => {
  const r = hintProgress(50, 61, 2);
  assert.equal(r.arrived, false);
  assert.equal(r.lowAccuracy, true);
});

test("到着：101mなら誤差10mでも到着にしない", () => {
  assert.equal(hintProgress(101, 10, 2).arrived, false);
});
