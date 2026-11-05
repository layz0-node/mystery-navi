// 取り消し（4-4）と昇格のお知らせ（4-3）
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, parseBackup } from "../src/storage.js";
import { STORAGE_KEY } from "../src/config.js";
import { MemoryStorage } from "./fixtures/memory-storage.js";
import { jst } from "./fixtures/make-shop.js";

const T0 = jst("2026-11-10T21:00");
const after = (ms) => new Date(T0.getTime() + ms);

// 到着済みの案内先がある状態で評価する
function arrivedAndRated(storage = new MemoryStorage()) {
  const store = createStore({ storage, now: T0 });
  store.addVisit("shop_000", "good", jst("2026-11-09T21:00")); // 前からある記録
  store.setTarget({ shopId: "shop_001", selectedAt: jst("2026-11-10T20:05") });
  store.updateTarget({ unlockedHints: 2, arrivedAt: jst("2026-11-10T20:31") });
  const before = store.getTarget();
  store.addVisit("shop_001", "good", T0);
  store.setTarget({ shopId: "shop_002", selectedAt: after(500) }); // 次の店を選んだ
  return { store, storage, before };
}

// ---------- 取り消し ----------

test("評価の3秒後に取り消す → 直前の1件だけ消え、案内先は評価した店（到着済み・ヒントも元どおり）に戻る", () => {
  const { store, storage, before } = arrivedAndRated();
  assert.equal(store.canUndo(after(3000)), true);
  assert.equal(store.undo(after(3000)), true);
  assert.deepEqual(store.visits().map((v) => v.shopId), ["shop_000"]);
  assert.deepEqual(store.getTarget(), before);
  assert.equal(before.arrivedAt, jst("2026-11-10T20:31").toISOString());
  assert.equal(before.unlockedHints, 2);
  // 保存データにも反映されている
  assert.deepEqual(createStore({ storage, now: T0 }).getTarget(), before);
});

test("ちょうど5秒後は取り消せる", () => {
  const { store } = arrivedAndRated();
  assert.equal(store.undo(after(5000)), true);
});

test("5.001秒後は取り消せず、何も変わらない", () => {
  const { store } = arrivedAndRated();
  assert.equal(store.canUndo(after(5001)), false);
  assert.equal(store.undo(after(5001)), false);
  assert.equal(store.visits().length, 2);
  assert.equal(store.getTarget().shopId, "shop_002");
});

test("2件続けて評価 → 取り消せるのは2件目だけ。2回目の取り消しは何もしない", () => {
  const store = createStore({ storage: new MemoryStorage(), now: T0 });
  store.addVisit("shop_001", "good", T0);
  store.addVisit("shop_002", "bad", after(1000));
  assert.equal(store.undo(after(2000)), true);
  assert.deepEqual(store.visits().map((v) => v.shopId), ["shop_001"]);
  assert.equal(store.canUndo(after(2500)), false);
  assert.equal(store.undo(after(2500)), false);
  assert.deepEqual(store.visits().map((v) => v.shopId), ["shop_001"]);
});

test("評価の後に記録を読み込んだら、取り消せない", () => {
  const { store } = arrivedAndRated();
  const backup = JSON.stringify({ app: "mystery-navi", schemaVersion: 1, exportedAt: T0.toISOString(), visits: [] });
  store.importVisits(parseBackup(backup).visits, after(1000));
  assert.equal(store.canUndo(after(2000)), false);
  assert.equal(store.undo(after(2000)), false);
});

test("別のタブが後から記録を足していたら、取り消しでその記録を消さない", () => {
  const storage = new MemoryStorage();
  const store = createStore({ storage, now: T0 });
  store.addVisit("shop_001", "good", T0);
  createStore({ storage, now: T0 }).addVisit("shop_002", "good", after(1000));
  assert.equal(store.undo(after(2000)), false);
  assert.deepEqual(storage.json(STORAGE_KEY).visits.map((v) => v.shopId), ["shop_001", "shop_002"]);
});

test("アプリを開き直す（作り直す）と、5秒以内でも取り消せない", () => {
  const { storage } = arrivedAndRated();
  const again = createStore({ storage, now: after(1000) });
  assert.equal(again.canUndo(after(2000)), false);
  assert.equal(again.undo(after(2000)), false);
  assert.equal(again.visits().length, 2);
});

// ---------- 昇格のお知らせ ----------

// 別々の店を n 回評価した状態（1日ずつずらす）
function storeWithCount(n, storage = new MemoryStorage()) {
  const store = createStore({ storage, now: T0 });
  for (let i = 0; i < n; i++) {
    store.addVisit(`shop_${String(i + 1).padStart(3, "0")}`, "good", new Date(jst("2026-10-01T21:00").getTime() + i * 86400000));
  }
  return store;
}

test("4回から5回目を評価して6秒後 → アイアンのお知らせが必要。出した後は不要", () => {
  const store = storeWithCount(4);
  assert.equal(store.pendingTrophyNotice(T0), null);
  store.addVisit("shop_100", "good", T0);
  assert.equal(store.pendingTrophyNotice(after(6000)).id, "iron");
  store.markAnnounced("iron");
  assert.equal(store.pendingTrophyNotice(after(7000)), null);
});

test("5回目の直後（取り消しの5秒の間）は、まだお知らせしない", () => {
  const store = storeWithCount(4);
  store.addVisit("shop_100", "good", T0);
  assert.equal(store.pendingTrophyNotice(after(2000)), null);
  assert.equal(store.pendingTrophyNotice(after(5000)), null);
});

test("5回目を取り消すと、5秒が過ぎてもお知らせしない", () => {
  const store = storeWithCount(4);
  store.addVisit("shop_100", "good", T0);
  store.undo(after(2000));
  assert.equal(store.pendingTrophyNotice(after(6000)), null);
});

test("5回目の直後にアプリを閉じた → 次に開いたときにお知らせが必要", () => {
  const storage = new MemoryStorage();
  storeWithCount(4, storage).addVisit("shop_100", "good", T0);
  const again = createStore({ storage, now: after(1000) });
  assert.equal(again.pendingTrophyNotice(after(1000)).id, "iron");
});

test("お知らせ済みは、開き直しても二度出ない", () => {
  const storage = new MemoryStorage();
  const store = storeWithCount(5, storage);
  store.markAnnounced("iron");
  assert.equal(createStore({ storage, now: T0 }).pendingTrophyNotice(after(6000)), null);
});

test("段階を飛ばして上がった（4回 → 12回）→ ブロンズを1回だけお知らせする", () => {
  const store = storeWithCount(12);
  assert.equal(store.pendingTrophyNotice(after(6000)).id, "bronze");
  store.markAnnounced("bronze");
  assert.equal(store.pendingTrophyNotice(after(7000)), null);
});

test("回数が段階に届いていない → お知らせしない", () => {
  assert.equal(storeWithCount(0).pendingTrophyNotice(T0), null);
  assert.equal(storeWithCount(3).pendingTrophyNotice(after(6000)), null);
});
