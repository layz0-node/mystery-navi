// 端末への保存・壊れたデータの退避・新しい版のデータ・読めない記録（6章）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, getLocalStorage, BROKEN_KEY_PREFIX } from "../src/storage.js";
import { STORAGE_KEY } from "../src/config.js";
import { trophySummary, selectShop } from "../src/logic.js";
import { MemoryStorage } from "./fixtures/memory-storage.js";
import { jst, makeShop, BASE } from "./fixtures/make-shop.js";

const NOW = jst("2026-11-10T21:00");

function stored(data) {
  return new MemoryStorage({ [STORAGE_KEY]: JSON.stringify(data) });
}

function brokenKeys(storage) {
  return storage.keys().filter((k) => k.startsWith(BROKEN_KEY_PREFIX));
}

// ---------- 保存 ----------

test("評価を追加すると末尾に1件増え、作り直しても読める。前の記録は変わらない", () => {
  const before = [{ shopId: "shop_001", value: "good", at: "2026-11-05T21:10:00+09:00" }];
  const storage = stored({ schemaVersion: 1, visits: before, currentTarget: null, trophy: { announcedLevel: null }, lastExportAt: null });
  const store = createStore({ storage, now: NOW });
  store.addVisit("shop_002", "closed", NOW);

  const again = createStore({ storage, now: NOW });
  assert.deepEqual(again.visits(), [before[0], { shopId: "shop_002", value: "closed", at: NOW.toISOString() }]);
  assert.deepEqual(storage.json(STORAGE_KEY).visits[0], before[0]);
});

test("キーがない → 空の状態で始まる", () => {
  const store = createStore({ storage: new MemoryStorage(), now: NOW });
  assert.deepEqual(store.visits(), []);
  assert.equal(store.getTarget(), null);
  assert.equal(store.lastExportAt(), null);
  assert.deepEqual(store.status(), { saving: true, reason: null, recoveredKey: null, lastWriteFailed: false });
});

test("localStorage が使えない（null）→ 止まらずメモリ上で動き、評価の追加と取り消しもできる", () => {
  const store = createStore({ storage: null, now: NOW });
  assert.equal(store.status().saving, false);
  assert.equal(store.status().reason, "unavailable");
  store.addVisit("shop_001", "good", NOW);
  assert.equal(store.visits().length, 1);
  assert.equal(store.undo(new Date(NOW.getTime() + 1000)), true);
  assert.equal(store.visits().length, 0);
});

test("localStorage が読むだけで例外になる → 止まらず、保存しないモードで動く", () => {
  const storage = new MemoryStorage();
  storage.failReads = true;
  const store = createStore({ storage, now: NOW });
  assert.equal(store.status().saving, false);
  store.addVisit("shop_001", "good", NOW);
  assert.equal(store.visits().length, 1);
});

// globalThis.localStorage を一時的に差し替えて fn を実行する
function withGlobalLocalStorage(descriptor, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, ...descriptor });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
}

test("getLocalStorage：localStorage を読むだけで例外になる端末・書くと例外になる端末・ない環境では null", () => {
  withGlobalLocalStorage({ get() { throw new Error("SecurityError"); } }, () => {
    assert.equal(getLocalStorage(), null);
  });
  const full = new MemoryStorage();
  full.failWrites = true;
  withGlobalLocalStorage({ value: full }, () => assert.equal(getLocalStorage(), null));
  withGlobalLocalStorage({ value: undefined }, () => assert.equal(getLocalStorage(), null));
});

test("getLocalStorage：使える localStorage はそのまま返し、確認用のキーを残さない", () => {
  const ok = new MemoryStorage();
  withGlobalLocalStorage({ value: ok }, () => assert.equal(getLocalStorage(), ok));
  assert.deepEqual(ok.keys(), []);
});

test("書き込みで例外（容量オーバー）→ 止まらず、メモリ上は更新され、status でわかる", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: NOW });
  storage.failWrites = true;
  store.addVisit("shop_001", "good", NOW);
  assert.equal(store.visits().length, 1);
  assert.equal(store.status().lastWriteFailed, true);
  storage.failWrites = false;
  store.addVisit("shop_002", "good", NOW);
  assert.equal(store.status().lastWriteFailed, false);
});

test("案内先の解放済みヒントと到着日時が保存され、作り直しても残る", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: NOW });
  store.setTarget({ shopId: "shop_014", selectedAt: jst("2026-11-10T20:05") });
  store.updateTarget({ unlockedHints: 2 });
  store.updateTarget({ arrivedAt: jst("2026-11-10T20:31") });

  const again = createStore({ storage, now: NOW });
  assert.deepEqual(again.getTarget(), {
    shopId: "shop_014",
    selectedAt: jst("2026-11-10T20:05").toISOString(),
    unlockedHints: 2,
    arrivedAt: jst("2026-11-10T20:31").toISOString(),
  });
});

test("「別のお店にする」で案内先が消え、評価の記録は1文字も変わらない", () => {
  const storage = stored({
    schemaVersion: 1,
    visits: [{ shopId: "shop_001", value: "skip", at: "2026-11-05T21:10:00+09:00", memo: "残す" }],
    currentTarget: { shopId: "shop_002", selectedAt: "2026-11-10T11:00:00.000Z", unlockedHints: 1, arrivedAt: null },
  });
  const visitsBefore = JSON.stringify(storage.json(STORAGE_KEY).visits);
  const store = createStore({ storage, now: NOW });
  store.clearTarget();
  assert.equal(store.getTarget(), null);
  assert.equal(storage.json(STORAGE_KEY).currentTarget, null);
  assert.equal(JSON.stringify(storage.json(STORAGE_KEY).visits), visitsBefore);
});

test("店リストにない店IDの記録は、読み込みでも書き込みでも消えない", () => {
  const gone = { shopId: "shop_999", value: "good", at: "2026-11-05T12:00:00.000Z" };
  const storage = stored({ schemaVersion: 1, visits: [gone] });
  const store = createStore({ storage, now: NOW });
  assert.deepEqual(store.visits(), [gone]);
  store.addVisit("shop_001", "good", NOW);
  assert.deepEqual(storage.json(STORAGE_KEY).visits[0], gone);
});

test("別のタブが先に評価を足していても、両方の記録が残る", () => {
  const storage = new MemoryStorage();
  const tabA = createStore({ storage, now: NOW });
  const tabB = createStore({ storage, now: NOW });
  tabA.addVisit("shop_001", "good", NOW);
  tabB.addVisit("shop_002", "bad", NOW);
  assert.deepEqual(
    storage.json(STORAGE_KEY).visits.map((v) => v.shopId),
    ["shop_001", "shop_002"],
  );
});

test("書き戻すとき、知らない項目も元の形のまま残す", () => {
  const original = {
    schemaVersion: 1,
    visits: [{ shopId: "shop_001", value: "good", at: "2026-11-05T21:10:00+09:00", memo: "読める記録の余分な項目" }],
    currentTarget: null,
    trophy: { announcedLevel: null, extra: 1 },
    lastExportAt: null,
    future: { a: [1, 2] },
  };
  const storage = stored(original);
  const store = createStore({ storage, now: NOW });
  store.addVisit("shop_002", "good", NOW);
  store.markAnnounced("iron");
  const saved = storage.json(STORAGE_KEY);
  assert.deepEqual(saved.visits[0], original.visits[0]);
  assert.deepEqual(saved.future, original.future);
  assert.deepEqual(saved.trophy, { announcedLevel: "iron", extra: 1 });
});

// ---------- 壊れたデータの退避 ----------

test("JSONとして読めない → 元の文字列がそのまま退避され、空で始まる。その後に評価しても退避は残る", () => {
  const raw = '{"schemaVersion":1,"visits":[{"shopId":"shop_001"';
  const storage = new MemoryStorage({ [STORAGE_KEY]: raw });
  const store = createStore({ storage, now: NOW });

  const keys = brokenKeys(storage);
  assert.deepEqual(keys, [BROKEN_KEY_PREFIX + NOW.toISOString()]);
  assert.equal(storage.getItem(keys[0]), raw);
  assert.deepEqual(store.visits(), []);
  assert.deepEqual(store.status(), { saving: true, reason: null, recoveredKey: keys[0], lastWriteFailed: false });

  store.addVisit("shop_002", "good", NOW);
  assert.equal(storage.getItem(keys[0]), raw);
  assert.equal(storage.json(STORAGE_KEY).visits.length, 1);
});

test("退避して空で始めたことは、作り直すと（次に開くと）もう出ない", () => {
  const storage = new MemoryStorage({ [STORAGE_KEY]: "{abc" });
  createStore({ storage, now: NOW });
  assert.equal(createStore({ storage, now: NOW }).status().recoveredKey, null);
});

test("schemaVersion がない・1より小さい・数値でない・visits が配列でない → 壊れたデータとして退避される", () => {
  for (const data of [
    { visits: [] },
    { schemaVersion: 0, visits: [] },
    { schemaVersion: "1", visits: [] },
    { schemaVersion: 1, visits: null },
    { schemaVersion: 1, visits: 5 },
  ]) {
    const storage = stored(data);
    const raw = storage.getItem(STORAGE_KEY);
    const store = createStore({ storage, now: NOW });
    const keys = brokenKeys(storage);
    assert.equal(keys.length, 1, JSON.stringify(data));
    assert.equal(storage.getItem(keys[0]), raw);
    assert.equal(store.status().saving, true);
  }
});

test("2回壊れる → 退避先が2つでき、1回目の退避は消えない", () => {
  const storage = new MemoryStorage({ [STORAGE_KEY]: "壊れた1" });
  createStore({ storage, now: NOW });
  storage.setItem(STORAGE_KEY, "壊れた2");
  createStore({ storage, now: NOW }); // 同じ時刻でも重ならない
  const values = brokenKeys(storage).map((k) => storage.getItem(k)).sort();
  assert.deepEqual(values, ["壊れた1", "壊れた2"]);
});

test("退避の書き込みに失敗 → 元のキーは書き換えず、保存しないモード。評価しても元のキーは変わらない", () => {
  const raw = "{壊れている";
  const storage = new MemoryStorage({ [STORAGE_KEY]: raw });
  storage.failWritesTo = (key) => key.startsWith(BROKEN_KEY_PREFIX);
  const store = createStore({ storage, now: NOW });
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.deepEqual(store.status(), { saving: false, reason: "unsafe", recoveredKey: null, lastWriteFailed: false });
  store.addVisit("shop_001", "good", NOW);
  assert.equal(store.visits().length, 1);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
});

// ---------- 新しい版のデータ ----------

test("schemaVersion が 2 → 退避も上書きもせず、保存しないモードで動く", () => {
  const raw = JSON.stringify({ schemaVersion: 2, records: [{ id: 1 }] });
  const storage = new MemoryStorage({ [STORAGE_KEY]: raw });
  const store = createStore({ storage, now: NOW });
  assert.deepEqual(store.status(), { saving: false, reason: "newer", recoveredKey: null, lastWriteFailed: false });
  assert.deepEqual(brokenKeys(storage), []);
  assert.deepEqual(store.visits(), []);

  store.addVisit("shop_001", "good", NOW);
  store.setTarget({ shopId: "shop_002", selectedAt: NOW });
  store.exportBackup(NOW);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.deepEqual(storage.keys(), [STORAGE_KEY]);
});

test("使っている途中で別のタブが新しい版のデータを書いた → そこから保存をやめ、上書きしない", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: NOW });
  const raw = JSON.stringify({ schemaVersion: 2, visits: [] });
  storage.setItem(STORAGE_KEY, raw);
  store.addVisit("shop_001", "good", NOW);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(store.status().saving, false);
  assert.equal(store.status().reason, "newer");
});

test("使っている途中で保存データが壊れた → 上書きせず、保存しないモードになる", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: NOW });
  storage.setItem(STORAGE_KEY, "{壊れた");
  store.addVisit("shop_001", "good", NOW);
  assert.equal(storage.getItem(STORAGE_KEY), "{壊れた");
  assert.equal(store.status().reason, "unsafe");
});

// ---------- 読めない記録 ----------

const MIXED = [
  { shopId: "shop_001", value: "good", at: "2026-11-05T21:10:00+09:00" },
  { shopId: "shop_002", value: "good", at: "abc" },
  { shopId: "shop_003", value: "good", at: "2026-11-10T03:30:00" }, // 時差なし
  { shopId: "shop_004", value: "great", at: "2026-11-06T21:10:00+09:00", memo: "x" },
  { shopId: "shop_005", value: "skip", at: "2026-11-07T21:10:00+09:00" },
];

test("読めない記録が混ざっている → 止まらず、計算からは外され、件数がわかる", () => {
  const store = createStore({ storage: stored({ schemaVersion: 1, visits: MIXED }), now: NOW });
  assert.deepEqual(store.visits().map((v) => v.shopId), ["shop_001", "shop_005"]);
  assert.equal(store.unreadableCount(), 3);
});

test("読めない記録がある状態で評価を足しても、読めない記録は元の位置・元の形のまま残る", () => {
  const storage = stored({ schemaVersion: 1, visits: MIXED });
  createStore({ storage, now: NOW }).addVisit("shop_006", "good", NOW);
  const saved = storage.json(STORAGE_KEY).visits;
  assert.deepEqual(saved.slice(0, 5), MIXED);
  assert.equal(saved[5].shopId, "shop_006");
});

test("読めない記録があっても、トロフィーの集計と店選びは止まらない", () => {
  const store = createStore({ storage: stored({ schemaVersion: 1, visits: MIXED }), now: NOW });
  assert.equal(trophySummary(store.visits()).count, 2);
  const shops = [makeShop("shop_010", { distance: 500 })];
  const r = selectShop({ shops, visits: store.visits(), position: BASE, now: NOW, random: () => 0 });
  assert.equal(r.result, "ok");
});

test("案内先の selectedAt が読めない → 案内先なしとして扱う", () => {
  const store = createStore({
    storage: stored({
      schemaVersion: 1,
      visits: [],
      currentTarget: { shopId: "shop_001", selectedAt: "abc", unlockedHints: 0, arrivedAt: null },
    }),
    now: NOW,
  });
  assert.equal(store.getTarget(), null);
});

test("お知らせ済みの段階が知らない値・lastExportAt が読めない → どちらも未設定として扱う", () => {
  const store = createStore({
    storage: stored({ schemaVersion: 1, visits: [], trophy: { announcedLevel: "platinum" }, lastExportAt: "abc" }),
    now: NOW,
  });
  assert.equal(store.lastExportAt(), null);
  // 知らない段階は「お知らせ済みなし」なので、5回に達していればアイアンをお知らせする
  const visits = Array.from({ length: 5 }, (_, i) => ({ shopId: `shop_00${i + 1}`, value: "good", at: "2026-11-05T12:00:00.000Z" }));
  const store2 = createStore({
    storage: stored({ schemaVersion: 1, visits, trophy: { announcedLevel: "platinum" } }),
    now: NOW,
  });
  assert.equal(store2.pendingTrophyNotice(NOW).id, "iron");
});
