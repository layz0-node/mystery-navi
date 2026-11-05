// sensors.js：偽の window で、方位の切り替え・時刻の上書き・位置の上書きを確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSensors, readScreenAngle } from "../src/sensors.js";
import { HEADING_TIMEOUT_SEC } from "../src/config.js";

// Android 相当（deviceorientationabsolute がある）の偽の window
function androidEnv({ angle = 0 } = {}) {
  const env = new EventTarget();
  env.ondeviceorientationabsolute = null;
  env.DeviceOrientationEvent = class {};
  env.screen = { orientation: { angle } };
  env.navigator = {};
  return env;
}

function fire(env, type, props) {
  const e = new Event(type);
  Object.assign(e, props);
  env.dispatchEvent(e);
}

test("画面の回転角：screen.orientation.angle、なければ window.orientation、どちらもなければ0", () => {
  assert.equal(readScreenAngle({ screen: { orientation: { angle: 90 } } }), 90);
  assert.equal(readScreenAngle({ orientation: -90 }), -90);
  assert.equal(readScreenAngle({}), 0);
});

test("方位：使えないと判定した後で有効な値が届く → 方位ありに切り替わる", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const env = androidEnv();
  const sensors = createSensors({ env });
  assert.equal(await sensors.startHeading(), "granted");
  assert.equal(sensors.getState().headingStatus, "waiting");
  t.mock.timers.tick(HEADING_TIMEOUT_SEC * 1000 + 100);
  assert.equal(sensors.getState().headingStatus, "unavailable");
  assert.equal(sensors.getState().heading, null);
  fire(env, "deviceorientationabsolute", { alpha: 90 });
  assert.equal(sensors.getState().headingStatus, "active");
  assert.equal(sensors.getState().heading, 270);
  sensors.stop();
});

test("方位：横向き（画面の回転角90）のとき、補正した値になる", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const env = androidEnv({ angle: 90 });
  const sensors = createSensors({ env });
  await sensors.startHeading();
  fire(env, "deviceorientationabsolute", { alpha: 90 });
  assert.equal(sensors.getState().rawHeading, 0);
  sensors.stop();
});

test("方位：iPhone で許可されなかった → 拒否", async () => {
  const env = new EventTarget();
  env.DeviceOrientationEvent = { requestPermission: async () => "denied" };
  env.navigator = {};
  const sensors = createSensors({ env });
  assert.equal(await sensors.startHeading(), "denied");
  assert.equal(sensors.getState().headingStatus, "denied");
});

test("方位：iPhone で許可された → webkitCompassHeading を使う（相対の alpha は使わない）", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const env = new EventTarget();
  env.DeviceOrientationEvent = { requestPermission: async () => "granted" };
  env.navigator = {};
  const sensors = createSensors({ env });
  await sensors.startHeading();
  fire(env, "deviceorientation", { webkitCompassHeading: 45, alpha: 300 });
  assert.equal(sensors.getState().heading, 45);
  sensors.stop();
});

test("方位：絶対方位のイベントがないブラウザ → absolute が true の値だけ使う", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const env = new EventTarget();
  env.DeviceOrientationEvent = class {};
  env.navigator = {};
  const sensors = createSensors({ env });
  await sensors.startHeading();
  fire(env, "deviceorientation", { alpha: 90, absolute: false });
  assert.equal(sensors.getState().heading, null);
  fire(env, "deviceorientation", { alpha: 90, absolute: true });
  assert.equal(sensors.getState().heading, 270);
  sensors.stop();
});

test("向きの上書き → センサーの値より上書きを使う。解除すると戻る", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const env = androidEnv();
  const sensors = createSensors({ env, overrides: { heading: 123 } });
  await sensors.startHeading();
  fire(env, "deviceorientationabsolute", { alpha: 0 });
  assert.equal(sensors.getState().heading, 123);
  assert.equal(sensors.getState().headingSource, "debug");
  sensors.setOverrides({ heading: null });
  assert.equal(sensors.getState().heading, 0);
  sensors.stop();
});

test("時刻の上書き：11/5 21:00 にしてから3秒たつ → 21:00:03。解除すると実際の時刻", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-01T00:00:00Z") });
  const target = Date.parse("2026-11-05T12:00:00Z");
  const sensors = createSensors({ env: androidEnv(), overrides: { timeOffsetMs: target - Date.now() } });
  t.mock.timers.tick(3000);
  assert.equal(sensors.now().toISOString(), "2026-11-05T12:00:03.000Z");
  sensors.setOverrides({ timeOffsetMs: null });
  assert.equal(sensors.now().toISOString(), "2026-11-01T00:00:03.000Z");
});

test("位置の上書きがあるあいだは、実際の位置情報を取りに行かない。解除すると取りに行く", () => {
  const env = androidEnv();
  let watching = 0;
  env.navigator.geolocation = {
    watchPosition: () => {
      watching++;
      return 1;
    },
    clearWatch: () => {
      watching--;
    },
  };
  const sensors = createSensors({ env, overrides: { position: { lat: 35.7295, lng: 139.7109, accuracy: 10 } } });
  sensors.startPosition();
  assert.equal(watching, 0);
  assert.equal(sensors.getState().position.source, "debug");
  sensors.setOverrides({ position: null });
  assert.equal(watching, 1);
  sensors.setOverrides({ position: { lat: 35.69, lng: 139.7, accuracy: 10 } });
  assert.equal(watching, 0);
});

test("最初の位置を待つ：上書きの誤差が150m → 10秒後に「精度が低い」で確定", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sensors = createSensors({ env: androidEnv(), overrides: { position: { lat: 35.7295, lng: 139.7109, accuracy: 150 } } });
  const p = sensors.waitInitialFix();
  t.mock.timers.tick(10000);
  const r = await p;
  assert.equal(r.lowAccuracy, true);
  assert.equal(r.position.accuracy, 150);
});

test("最初の位置を待つ：待っているあいだに誤差を80mに変える → すぐ確定", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const sensors = createSensors({ env: androidEnv(), overrides: { position: { lat: 35.7295, lng: 139.7109, accuracy: 150 } } });
  const p = sensors.waitInitialFix();
  t.mock.timers.tick(2000);
  sensors.setOverrides({ position: { lat: 35.7295, lng: 139.7109, accuracy: 80 } });
  const r = await p;
  assert.equal(r.lowAccuracy, false);
  assert.equal(r.position.accuracy, 80);
});

// ---------- 位置のエラーの上書きと、位置の監視のやり直し（S4） ----------

const IKEBUKURO = { lat: 35.7295, lng: 139.7109, accuracy: 10 }; // 池袋駅

test("位置のエラーの上書きが「拒否」 → 位置は null、エラーの code は 1（位置の上書きより優先）", () => {
  const sensors = createSensors({ env: androidEnv(), overrides: { position: IKEBUKURO, positionFailure: "denied" } });
  const s = sensors.getState();
  assert.equal(s.position, null);
  assert.equal(s.positionError.code, 1);
});

test("位置のエラーの上書きが「取れない」「タイムアウト」 → code 2・3", () => {
  const sensors = createSensors({ env: androidEnv(), overrides: { positionFailure: "unavailable" } });
  assert.equal(sensors.getState().positionError.code, 2);
  sensors.setOverrides({ positionFailure: "timeout" });
  assert.equal(sensors.getState().positionError.code, 3);
});

test("位置のエラーの上書きが「黙り続ける」 → 位置もエラーも null のまま", () => {
  const sensors = createSensors({ env: androidEnv(), overrides: { position: IKEBUKURO, positionFailure: "silent" } });
  sensors.startPosition();
  const s = sensors.getState();
  assert.equal(s.position, null);
  assert.equal(s.positionError, null);
});

test("位置のエラーの上書きが「HTTPSでない扱い」 → secureContext が false", () => {
  const sensors = createSensors({ env: androidEnv(), overrides: { positionFailure: "insecure" } });
  assert.equal(sensors.getState().secureContext, false);
  sensors.setOverrides({ positionFailure: null });
  assert.equal(sensors.getState().secureContext, true);
});

test("HTTPSでない接続 → secureContext が false。位置を上書きしているときは true", () => {
  const env = androidEnv();
  env.isSecureContext = false;
  const sensors = createSensors({ env });
  assert.equal(sensors.getState().secureContext, false);
  sensors.setOverrides({ position: IKEBUKURO });
  assert.equal(sensors.getState().secureContext, true);
});

test("位置のエラーの上書きを「なし」に戻す → 位置の上書き（池袋駅）が再び効く", () => {
  const sensors = createSensors({ env: androidEnv(), overrides: { position: IKEBUKURO, positionFailure: "denied" } });
  sensors.setOverrides({ positionFailure: null });
  const s = sensors.getState();
  assert.equal(s.position.lat, IKEBUKURO.lat);
  assert.equal(s.positionError, null);
});

test("位置のエラーを上書きしているあいだは、実際の位置情報を取りに行かない", () => {
  const env = androidEnv();
  let watching = 0;
  env.navigator.geolocation = {
    watchPosition: () => {
      watching++;
      return 1;
    },
    clearWatch: () => {
      watching--;
    },
  };
  const sensors = createSensors({ env, overrides: { positionFailure: "silent" } });
  sensors.startPosition();
  assert.equal(watching, 0);
  sensors.setOverrides({ positionFailure: null });
  assert.equal(watching, 1);
});

test("restartPosition()：前の監視を止め、新しい watchPosition が1回だけ始まり、前のエラーが消える", () => {
  const env = androidEnv();
  const started = [];
  const cleared = [];
  let onError = null;
  env.navigator.geolocation = {
    watchPosition: (ok, err) => {
      onError = err;
      started.push(started.length + 1);
      return started.length;
    },
    clearWatch: (id) => cleared.push(id),
  };
  const sensors = createSensors({ env });
  sensors.startPosition();
  onError({ code: 1, message: "denied" });
  assert.equal(sensors.getState().positionError.code, 1);
  sensors.restartPosition();
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(cleared, [1]);
  assert.equal(sensors.getState().positionError, null);
});
