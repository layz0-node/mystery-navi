// デバッグパネルの「アプリのキャッシュを消して読み込み直す」（12章）
// サービスワーカーの登録とアプリのキャッシュだけを消し、評価の記録（localStorage）には絶対に触らない
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearAppCaches } from "../src/debug.js";

const SCOPE = "https://example.test/mystery-navi/";

function fakes() {
  const unregistered = [];
  const reg = (scope) => ({
    scope,
    unregister: async () => {
      unregistered.push(scope);
      return true;
    },
  });
  const serviceWorker = {
    getRegistrations: async () => [reg(SCOPE), reg("https://example.test/other-app/")],
  };
  const names = new Set(["mystery-navi-app-v9", "mystery-navi-data", "other-app-v1"]);
  const caches = {
    keys: async () => [...names],
    delete: async (name) => names.delete(name),
  };
  return { serviceWorker, caches, unregistered, names };
}

// localStorage・sessionStorage・indexedDB に少しでも触ったら記録する
function watchStorage(t) {
  const touched = [];
  for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
    const had = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        touched.push(name);
        return new Proxy({}, { get: (_, key) => (touched.push(`${name}.${String(key)}`), () => {}) });
      },
    });
    t.after(() => {
      if (had) Object.defineProperty(globalThis, name, had);
      else delete globalThis[name];
    });
  }
  return touched;
}

test("このアプリの範囲の登録だけを解除し、mystery-navi- で始まるキャッシュだけを消す", async () => {
  const f = fakes();
  const r = await clearAppCaches({ serviceWorker: f.serviceWorker, caches: f.caches, scopeUrl: SCOPE });
  assert.deepEqual(f.unregistered, [SCOPE]);
  assert.deepEqual([...f.names], ["other-app-v1"]);
  assert.deepEqual(r, { registrations: 1, caches: ["mystery-navi-app-v9", "mystery-navi-data"] });
});

test("評価の記録（localStorage）などの端末の保存データには一切触らない", async (t) => {
  const touched = watchStorage(t);
  const f = fakes();
  await clearAppCaches({ serviceWorker: f.serviceWorker, caches: f.caches, scopeUrl: SCOPE });
  assert.deepEqual(touched, []);
});

test("サービスワーカーやキャッシュが使えない端末でも止まらない", async () => {
  assert.deepEqual(await clearAppCaches({ serviceWorker: undefined, caches: undefined, scopeUrl: SCOPE }), { registrations: 0, caches: [] });
});
