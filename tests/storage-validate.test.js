// 日時・記録の形の検査と、保存データの分類（6章・11章）
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidTimestamp, isValidVisit, classifyStored, readTarget } from "../src/storage.js";

test("日時：Z の形と、時差（±HH:MM）付きの形は受け付ける", () => {
  for (const s of [
    "2026-11-05T12:10:00.000Z",
    "2026-11-05T12:10:00Z",
    "2026-11-05T21:10:00+09:00",
    "2026-11-05T21:10:00-05:00",
    "2026-11-05T21:10:00.5+09:00",
    "2028-02-29T00:00:00Z", // うるう日
  ]) {
    assert.equal(isValidTimestamp(s), true, s);
  }
});

test("日時：時差の書かれていない日時は受け付けない（端末のタイムゾーンで読まれてずれるため）", () => {
  assert.equal(isValidTimestamp("2026-11-10T03:30:00"), false);
  assert.equal(isValidTimestamp("2026-11-10T03:30:00.000"), false);
});

test("日時：形の違うものは受け付けない", () => {
  for (const s of [
    "2026-11-10",
    "2026-11-10 03:30:00Z", // T ではなく空白
    "2026-11-10T03:30:00z", // 小文字の z
    "2026-11-10T03:30Z", // 秒なし
    "2026-11-10T03:30:00+0900", // コロンなしの時差
    "2026-11-10T03:30:00.1234Z", // 小数秒4桁
    "abc",
    "",
  ]) {
    assert.equal(isValidTimestamp(s), false, s);
  }
});

test("日時：存在しない日付・時刻は受け付けない（Date.parse が繰り上げて読むものも）", () => {
  for (const s of [
    "2026-02-30T00:00:00Z",
    "2026-02-29T00:00:00Z", // うるう年でない
    "2026-04-31T00:00:00Z",
    "2026-11-10T24:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-00-10T00:00:00Z",
    "2026-11-10T23:60:00Z",
    "2026-11-10T23:59:60Z",
    "2026-11-10T03:30:00+24:00",
    "2026-11-10T03:30:00+09:60",
  ]) {
    assert.equal(isValidTimestamp(s), false, s);
  }
});

test("日時：文字列でない値は受け付けない", () => {
  for (const v of [null, undefined, 1794355200000, new Date(), {}]) {
    assert.equal(isValidTimestamp(v), false, String(v));
  }
});

test("記録：店ID・6種類の値・日時がそろっていれば読める", () => {
  for (const value of ["good", "bad", "declined", "closed", "skip", "full"]) {
    assert.equal(isValidVisit({ shopId: "shop_001", value, at: "2026-11-05T12:10:00.000Z" }), true, value);
  }
});

test("記録：読めないもの", () => {
  const at = "2026-11-05T12:10:00.000Z";
  for (const v of [
    null,
    "good",
    [],
    { shopId: "", value: "good", at },
    { shopId: "x".repeat(65), value: "good", at },
    { shopId: 1, value: "good", at },
    { shopId: "shop_001", value: "great", at },
    { shopId: "shop_001", value: "toString", at }, // 継承したプロパティ名
    { shopId: "shop_001", value: "good", at: "abc" },
    { shopId: "shop_001", value: "good", at: "2026-11-10T03:30:00" },
    { shopId: "shop_001", value: "good" },
  ]) {
    assert.equal(isValidVisit(v), false, JSON.stringify(v));
  }
});

test("保存データの分類：キーがない → empty", () => {
  assert.equal(classifyStored(null).kind, "empty");
});

test("保存データの分類：schemaVersion 1 で visits が配列 → ok", () => {
  assert.equal(classifyStored(JSON.stringify({ schemaVersion: 1, visits: [] })).kind, "ok");
});

test("保存データの分類：schemaVersion が 1 より大きい → 新しい版（壊れたデータではない）", () => {
  assert.equal(classifyStored(JSON.stringify({ schemaVersion: 2, visits: [] })).kind, "newer");
  assert.equal(classifyStored(JSON.stringify({ schemaVersion: 7, visits: "形が違ってもよい" })).kind, "newer");
});

test("保存データの分類：壊れている", () => {
  for (const raw of [
    "{abc",
    "",
    "null",
    "123",
    "[]",
    JSON.stringify({ visits: [] }), // schemaVersion がない
    JSON.stringify({ schemaVersion: 0, visits: [] }),
    JSON.stringify({ schemaVersion: -1, visits: [] }),
    JSON.stringify({ schemaVersion: "2", visits: [] }), // 数値でない
    JSON.stringify({ schemaVersion: null, visits: [] }),
    JSON.stringify({ schemaVersion: 1, visits: {} }),
    JSON.stringify({ schemaVersion: 1 }),
  ]) {
    assert.equal(classifyStored(raw).kind, "broken", raw);
  }
});

test("案内先：日時やヒントの数が読めなければ null", () => {
  const ok = { shopId: "shop_001", selectedAt: "2026-11-05T12:00:00.000Z", unlockedHints: 1, arrivedAt: null };
  assert.deepEqual(readTarget(ok), ok);
  assert.equal(readTarget({ ...ok, selectedAt: "abc" }), null);
  assert.equal(readTarget({ ...ok, selectedAt: "2026-11-05T12:00:00" }), null);
  assert.equal(readTarget({ ...ok, unlockedHints: 3 }), null);
  assert.equal(readTarget({ ...ok, unlockedHints: "1" }), null);
  assert.equal(readTarget({ ...ok, arrivedAt: "abc" }), null);
  assert.equal(readTarget({ ...ok, shopId: "" }), null);
  assert.equal(readTarget(null), null);
});
