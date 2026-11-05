// デバッグ用の保存データの操作：まとめて追加・リセット（前に退避）・一覧・デバッグの設定（12章）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStore,
  listStoredEntries,
  readDebugSettings,
  saveDebugSettings,
  loadDebugSettings,
  DEBUG_KEY,
  BROKEN_KEY_PREFIX,
  BEFORE_IMPORT_KEY_PREFIX,
  BEFORE_RESET_KEY_PREFIX,
} from "../src/storage.js";
import { STORAGE_KEY } from "../src/config.js";
import { MemoryStorage } from "./fixtures/memory-storage.js";
import { jst, visit } from "./fixtures/make-shop.js";

const NOW = jst("2026-11-10T21:00");
const V1 = visit("shop_001", "good", "2026-11-05T21:10:00+09:00");

function stored(data, extra = {}) {
  return new MemoryStorage({ [STORAGE_KEY]: JSON.stringify(data), ...extra });
}

function base(visits = [V1], currentTarget = null) {
  return { schemaVersion: 1, visits, currentTarget, trophy: { announcedLevel: null }, lastExportAt: null };
}

const TARGET = { shopId: "shop_009", selectedAt: "2026-11-10T11:50:00.000Z", unlockedHints: 1, arrivedAt: null };

// ---------- まとめて追加 ----------

test("まとめて追加 → 末尾に増え、前からある記録と案内先は変わらない", () => {
  const storage = stored(base([V1], TARGET));
  const store = createStore({ storage, now: NOW });
  const added = [visit("shop_002", "good", jst("2026-11-09T21:00")), visit("shop_003", "bad", jst("2026-11-08T21:00"))];
  store.debugAppendVisits(added);
  const saved = storage.json(STORAGE_KEY);
  assert.deepEqual(saved.visits, [V1, ...added]);
  assert.deepEqual(saved.currentTarget, TARGET);
});

test("評価した直後（5秒以内）にまとめて追加 → 取り消しはできなくなる", () => {
  const store = createStore({ storage: stored(base()), now: NOW });
  store.addVisit("shop_002", "good", NOW);
  store.debugAppendVisits([visit("shop_003", "good", jst("2026-11-09T21:00"))]);
  const t = new Date(NOW.getTime() + 1000);
  assert.equal(store.canUndo(t), false);
  assert.equal(store.undo(t), false);
  assert.equal(store.visits().length, 3);
});

test("値が6種類のどれでもない記録を混ぜる → 何も追加せずエラー", () => {
  const storage = stored(base());
  const store = createStore({ storage, now: NOW });
  assert.throws(() => store.debugAppendVisits([visit("shop_002", "good", NOW), visit("shop_003", "great", NOW)]), TypeError);
  assert.deepEqual(storage.json(STORAGE_KEY).visits, [V1]);
});

test("別のタブで記録が増えた後に追加する → 別のタブの記録も残っている", () => {
  const storage = stored(base());
  const store = createStore({ storage, now: NOW });
  const other = visit("shop_007", "skip", jst("2026-11-10T20:00"));
  storage.setItem(STORAGE_KEY, JSON.stringify(base([V1, other])));
  const mine = visit("shop_008", "good", jst("2026-11-09T20:00"));
  store.debugAppendVisits([mine]);
  assert.deepEqual(storage.json(STORAGE_KEY).visits, [V1, other, mine]);
});

test("保存しないで動いているとき → 画面上の記録には増える", () => {
  const store = createStore({ storage: null, now: NOW });
  store.debugAppendVisits([V1]);
  assert.deepEqual(store.visits(), [V1]);
});

// ---------- 保存データの一覧 ----------

test("保存データの一覧 → 本体と3種類の退避が、加工しない文字列のまま出る。ほかのキーは出ない", () => {
  const mainRaw = JSON.stringify(base());
  const storage = new MemoryStorage({
    other: "x",
    [DEBUG_KEY]: "{}",
    [`${BEFORE_RESET_KEY_PREFIX}2026-11-09T12:00:00.000Z`]: "reset-raw",
    [`${BROKEN_KEY_PREFIX}2026-11-01T12:00:00.000Z`]: "{broken",
    [STORAGE_KEY]: mainRaw,
    [`${BEFORE_IMPORT_KEY_PREFIX}2026-11-05T12:00:00.000Z`]: "import-raw",
  });
  const list = listStoredEntries(storage);
  assert.deepEqual(list.map((e) => e.kind), ["main", "beforeImport", "beforeReset", "broken"]);
  assert.equal(list[0].raw, mainRaw);
  assert.equal(list.find((e) => e.kind === "broken").raw, "{broken");
  assert.ok(!list.some((e) => e.key === DEBUG_KEY || e.key === "other"));
});

test("保存データの一覧：保存できない端末 → 空", () => {
  assert.deepEqual(listStoredEntries(null), []);
});

// ---------- リセット ----------

test("リセット → 前のデータが beforeReset にそのまま退避され、本体は消え、記録0件・案内先なしになる", () => {
  const raw = JSON.stringify(base([V1, { shopId: "x", value: "unknown", at: "bad", extra: 1 }], TARGET));
  const storage = new MemoryStorage({ [STORAGE_KEY]: raw });
  const store = createStore({ storage, now: NOW });
  const r = store.debugReset(NOW);
  assert.equal(r.ok, true);
  assert.equal(r.backupKey, `${BEFORE_RESET_KEY_PREFIX}${NOW.toISOString()}`);
  assert.equal(storage.getItem(r.backupKey), raw);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual(store.visits(), []);
  assert.equal(store.getTarget(), null);
  assert.equal(store.unreadableCount(), 0);
});

test("リセット → ほかの退避データは残る。同じ時刻に2回リセットしても前の退避を上書きしない", () => {
  const brokenKey = `${BROKEN_KEY_PREFIX}2026-11-01T12:00:00.000Z`;
  const storage = stored(base(), { [brokenKey]: "{broken" });
  const store = createStore({ storage, now: NOW });
  const first = store.debugReset(NOW);
  store.addVisit("shop_002", "good", NOW);
  const second = store.debugReset(NOW);
  assert.notEqual(first.backupKey, second.backupKey);
  assert.equal(storage.getItem(brokenKey), "{broken");
  assert.equal(storage.json(first.backupKey).visits.length, 1);
  assert.equal(storage.json(second.backupKey).visits[0].shopId, "shop_002");
});

test("リセットの退避に失敗する → 何も変えず、エラーを返す", () => {
  const storage = stored(base());
  const store = createStore({ storage, now: NOW });
  storage.failWritesTo = (key) => key.startsWith(BEFORE_RESET_KEY_PREFIX);
  const r = store.debugReset(NOW);
  assert.deepEqual(r, { ok: false, reason: "backup-failed" });
  assert.deepEqual(storage.json(STORAGE_KEY).visits, [V1]);
  assert.deepEqual(store.visits(), [V1]);
});

test("保存データがまだないときのリセット → 退避はせず、空のまま", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: NOW });
  const r = store.debugReset(NOW);
  assert.deepEqual(r, { ok: true, backupKey: null });
  assert.equal(storage.keys().length, 0);
});

test("リセットの後に評価する → 新しく保存される", () => {
  const storage = stored(base());
  const store = createStore({ storage, now: NOW });
  store.debugReset(NOW);
  store.addVisit("shop_005", "good", NOW);
  assert.equal(storage.json(STORAGE_KEY).visits.length, 1);
  assert.equal(store.status().saving, true);
});

// ---------- デバッグの設定 ----------

test("デバッグの設定が壊れたJSON → 上書きなしとして扱う", () => {
  assert.deepEqual(readDebugSettings("{oops"), { position: null, heading: null, timeOffsetMs: null, tempTarget: null, positionFailure: null });
  assert.deepEqual(readDebugSettings("[]"), { position: null, heading: null, timeOffsetMs: null, tempTarget: null, positionFailure: null });
});

test("仮の目的地の緯度が90を超える、または数値でない → 受け付けない", () => {
  assert.equal(readDebugSettings(JSON.stringify({ tempTarget: { lat: 91, lng: 139 } })).tempTarget, null);
  assert.equal(readDebugSettings(JSON.stringify({ tempTarget: { lat: "35", lng: 139 } })).tempTarget, null);
});

test("仮の目的地の色が知らない値 → 通常", () => {
  const s = readDebugSettings(JSON.stringify({ tempTarget: { lat: 35.7, lng: 139.7, color: "pink" } }));
  assert.deepEqual(s.tempTarget, { lat: 35.7, lng: 139.7, color: "normal" });
});

test("デバッグの設定を保存して読み直す → 同じ値。評価の保存データには入らない", () => {
  const storage = stored(base());
  const before = storage.getItem(STORAGE_KEY);
  const settings = {
    position: { lat: 35.7295, lng: 139.7109, accuracy: 120 },
    heading: 370,
    timeOffsetMs: -3600000,
    tempTarget: { lat: 35.69, lng: 139.7, color: "bad" },
  };
  saveDebugSettings(storage, settings);
  assert.deepEqual(loadDebugSettings(storage), { ...settings, heading: 10, positionFailure: null });
  assert.equal(storage.getItem(STORAGE_KEY), before);
});

test("デバッグの設定がまだない → null（初めて開いた）", () => {
  assert.equal(loadDebugSettings(new MemoryStorage()), null);
  assert.equal(loadDebugSettings(null), null);
});

test("デバッグの設定を書けない端末 → 止まらずに、その場の設定を返す", () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const s = saveDebugSettings(storage, { heading: 90 });
  assert.equal(s.heading, 90);
});

// ---------- 位置のエラーの上書き（S4 の再現用） ----------

test("位置のエラーの上書きが5種類のどれか → その値を読み込む", () => {
  for (const f of ["denied", "unavailable", "timeout", "silent", "insecure"]) {
    assert.equal(readDebugSettings(JSON.stringify({ positionFailure: f })).positionFailure, f);
  }
});

test("位置のエラーの上書きが知らない値や数値 → なし（null）", () => {
  assert.equal(readDebugSettings(JSON.stringify({ positionFailure: "broken" })).positionFailure, null);
  assert.equal(readDebugSettings(JSON.stringify({ positionFailure: 1 })).positionFailure, null);
});

test("位置のエラーの項目がない古い設定 → なしになり、ほかの項目は今までどおり読める", () => {
  const s = readDebugSettings(JSON.stringify({ heading: 90, timeOffsetMs: 1000 }));
  assert.equal(s.positionFailure, null);
  assert.equal(s.heading, 90);
  assert.equal(s.timeOffsetMs, 1000);
});

test("位置のエラーの上書きを保存して読み直す → 同じ値", () => {
  const storage = new MemoryStorage();
  saveDebugSettings(storage, { positionFailure: "silent" });
  assert.equal(loadDebugSettings(storage).positionFailure, "silent");
});
