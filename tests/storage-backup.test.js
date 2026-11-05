// バックアップの書き出しと読み込み（11章）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, parseBackup, BEFORE_IMPORT_KEY_PREFIX } from "../src/storage.js";
import { STORAGE_KEY } from "../src/config.js";
import { MemoryStorage } from "./fixtures/memory-storage.js";
import { jst } from "./fixtures/make-shop.js";

const NOW = jst("2026-11-10T21:00");
const ALL_VALUES = ["good", "bad", "declined", "closed", "skip", "full"];

function storeWithAllValues(storage = new MemoryStorage()) {
  const store = createStore({ storage, now: NOW });
  ALL_VALUES.forEach((value, i) => store.addVisit(`shop_00${i + 1}`, value, jst(`2026-11-0${i + 1}T21:00`)));
  return store;
}

function backupOf(visits, extra = {}) {
  return JSON.stringify({ app: "mystery-navi", schemaVersion: 1, exportedAt: NOW.toISOString(), visits, ...extra });
}

test("6種類すべてを含む記録を書き出して読み込むと、項目と順番まで元どおりになる", () => {
  const source = storeWithAllValues();
  const text = source.exportBackup(NOW);

  const dest = createStore({ storage: new MemoryStorage(), now: NOW });
  const parsed = parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.equal(dest.importVisits(parsed.visits, NOW).ok, true);
  assert.deepEqual(dest.visits(), source.visits());
  assert.deepEqual(dest.visits().map((v) => v.value), ALL_VALUES);
});

test("書き出しには app・schemaVersion・exportedAt・visits だけが入り、案内先と位置情報は入らない", () => {
  const store = storeWithAllValues();
  store.setTarget({ shopId: "shop_014", selectedAt: NOW, unlockedHints: 1 });
  const text = store.exportBackup(NOW);
  const data = JSON.parse(text);
  assert.deepEqual(Object.keys(data).sort(), ["app", "exportedAt", "schemaVersion", "visits"]);
  assert.equal(data.app, "mystery-navi");
  assert.equal(data.exportedAt, NOW.toISOString());
  for (const v of data.visits) assert.deepEqual(Object.keys(v).sort(), ["at", "shopId", "value"]);
  for (const word of ["currentTarget", "shop_014", "lat", "lng"]) assert.equal(text.includes(word), false, word);
});

test("書き出すと lastExportAt が更新され、作り直しても残る", () => {
  const storage = new MemoryStorage();
  const store = storeWithAllValues(storage);
  store.exportBackup(NOW);
  assert.equal(store.lastExportAt(), NOW.toISOString());
  assert.equal(createStore({ storage, now: NOW }).lastExportAt(), NOW.toISOString());
});

test("読めない記録がある状態で書き出す → 読める記録だけが入り、読み込みの検査に通る", () => {
  const storage = new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      visits: [
        { shopId: "shop_001", value: "good", at: "2026-11-05T21:10:00+09:00", memo: "x" },
        { shopId: "shop_002", value: "good", at: "2026-11-10T03:30:00" },
      ],
    }),
  });
  const text = createStore({ storage, now: NOW }).exportBackup(NOW);
  const parsed = parseBackup(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.visits, [{ shopId: "shop_001", value: "good", at: "2026-11-05T21:10:00+09:00" }]);
});

test("Z の形と +09:00 の形が混ざっていても読み込め、文字列はそのまま保存される", () => {
  const visits = [
    { shopId: "shop_001", value: "good", at: "2026-11-05T12:10:00.000Z" },
    { shopId: "shop_002", value: "bad", at: "2026-11-06T21:10:00+09:00" },
  ];
  const parsed = parseBackup(backupOf(visits));
  assert.equal(parsed.ok, true);
  const store = createStore({ storage: new MemoryStorage(), now: NOW });
  store.importVisits(parsed.visits, NOW);
  assert.deepEqual(store.visits(), visits);
});

test("店リストにない店IDの記録も読み込める", () => {
  const parsed = parseBackup(backupOf([{ shopId: "shop_999", value: "closed", at: "2026-11-05T12:10:00.000Z" }]));
  assert.equal(parsed.ok, true);
});

test("前後の空白や改行が付いていても読み込める（メモアプリから貼り付けたとき）", () => {
  assert.equal(parseBackup(`\n  ${backupOf([])}  \n`).ok, true);
});

test("記録の余分な項目は、読み込みのときだけ捨てる", () => {
  const parsed = parseBackup(backupOf([{ shopId: "shop_001", value: "good", at: "2026-11-05T12:10:00.000Z", memo: "x" }]));
  assert.deepEqual(parsed.visits, [{ shopId: "shop_001", value: "good", at: "2026-11-05T12:10:00.000Z" }]);
});

const ok = { shopId: "shop_001", value: "good", at: "2026-11-05T12:10:00.000Z" };
const REJECTED = [
  ["壊れたJSON", '{"app":"mystery-navi",', "json"],
  ["空の文字列", "", "json"],
  ["別のアプリ", JSON.stringify({ app: "other-app", schemaVersion: 1, visits: [] }), "app"],
  ["app がない", JSON.stringify({ schemaVersion: 1, visits: [] }), "app"],
  ["配列", "[]", "app"],
  ["schemaVersion が 2", backupOf([], { schemaVersion: 2 }), "version"],
  ["visits が配列でない", backupOf({}), "visits"],
  ["値が6種類以外の記録が1件", backupOf([ok, { ...ok, value: "great" }]), "record"],
  ["時差なしの日時が1件", backupOf([ok, { ...ok, at: "2026-11-10T03:30:00" }]), "record"],
  ["店IDが空の記録", backupOf([ok, { ...ok, shopId: "" }]), "record"],
  ["存在しない日付", backupOf([{ ...ok, at: "2026-02-30T00:00:00Z" }]), "record"],
];

for (const [name, text, reason] of REJECTED) {
  test(`読み込みを拒否し、今の記録・案内先・お知らせ済みの段階を変えない：${name}`, () => {
    const storage = new MemoryStorage();
    const store = storeWithAllValues(storage);
    store.setTarget({ shopId: "shop_014", selectedAt: NOW });
    store.markAnnounced("iron");
    const before = storage.getItem(STORAGE_KEY);

    const parsed = parseBackup(text);
    assert.deepEqual(parsed, { ok: false, reason });
    assert.equal(storage.getItem(STORAGE_KEY), before);
    assert.equal(store.getTarget().shopId, "shop_014");
  });
}

test("parseBackup を通っていない記録は importVisits に渡せない", () => {
  const store = storeWithAllValues();
  assert.throws(() => store.importVisits([{ shopId: "shop_001", value: "great", at: "x" }], NOW), TypeError);
  assert.equal(store.visits().length, 6);
});

function countVisits(n) {
  return Array.from({ length: n }, (_, i) => ({
    shopId: `shop_${String(i + 1).padStart(3, "0")}`,
    value: "good",
    at: "2026-11-05T12:10:00.000Z",
  }));
}

test("読み込みで回数が20になる → お知らせ済みの段階がシルバーになり、お知らせは出ない", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: NOW });
  store.importVisits(parseBackup(backupOf(countVisits(20))).visits, NOW);
  assert.equal(store.pendingTrophyNotice(NOW), null);
  assert.equal(storage.json(STORAGE_KEY).trophy.announcedLevel, "silver");
});

test("読み込みで回数が段階に届かない → お知らせ済みの段階は「なし」になる", () => {
  const store = storeWithAllValues();
  store.markAnnounced("iron");
  store.importVisits(parseBackup(backupOf(countVisits(2))).visits, NOW);
  assert.equal(store.pendingTrophyNotice(NOW), null);
});

test("読み込むと案内先は消え、lastExportAt は変わらない", () => {
  const storage = new MemoryStorage();
  const store = storeWithAllValues(storage);
  store.exportBackup(jst("2026-11-08T12:00"));
  store.setTarget({ shopId: "shop_014", selectedAt: NOW });
  store.importVisits(parseBackup(backupOf([])).visits, NOW);
  assert.equal(store.getTarget(), null);
  assert.equal(store.lastExportAt(), jst("2026-11-08T12:00").toISOString());
});

test("上書きの前に、今の保存データがそのまま別のキーに退避される", () => {
  const storage = new MemoryStorage();
  const store = storeWithAllValues(storage);
  const before = storage.getItem(STORAGE_KEY);
  const result = store.importVisits(parseBackup(backupOf([])).visits, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.backupKey, BEFORE_IMPORT_KEY_PREFIX + NOW.toISOString());
  assert.equal(storage.getItem(result.backupKey), before);
  assert.equal(store.visits().length, 0);
});

test("2回読み込んでも、1回目の退避は消えない", () => {
  const storage = new MemoryStorage();
  const store = storeWithAllValues(storage);
  const first = store.importVisits(parseBackup(backupOf(countVisits(3))).visits, NOW);
  const second = store.importVisits(parseBackup(backupOf([])).visits, NOW);
  assert.notEqual(first.backupKey, second.backupKey);
  assert.equal(JSON.parse(storage.getItem(first.backupKey)).visits.length, 6);
  assert.equal(JSON.parse(storage.getItem(second.backupKey)).visits.length, 3);
});

test("上書き前の退避に失敗したら、読み込まずに今の記録を残す", () => {
  const storage = new MemoryStorage();
  const store = storeWithAllValues(storage);
  const before = storage.getItem(STORAGE_KEY);
  storage.failWritesTo = (key) => key.startsWith(BEFORE_IMPORT_KEY_PREFIX);
  const result = store.importVisits(parseBackup(backupOf([])).visits, NOW);
  assert.deepEqual(result, { ok: false, reason: "backup-failed" });
  assert.equal(storage.getItem(STORAGE_KEY), before);
  assert.equal(store.visits().length, 6);
});

test("まだ何も保存されていない端末では、退避なしで読み込む", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: NOW });
  const result = store.importVisits(parseBackup(backupOf(countVisits(3))).visits, NOW);
  assert.deepEqual(result, { ok: true, backupKey: null });
  assert.equal(store.visits().length, 3);
});
