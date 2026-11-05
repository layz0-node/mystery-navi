// sw.js をブラウザなしで動かすための作り物（テスト用）。
// sw.js を Node の vm で読み込み、キャッシュ（caches）と通信（fetch）を作り物に差し替える。
// 通信は実際には行わない。店リストのファイルも読まない（URL の文字列として扱うだけ）。

import vm from "node:vm";
import { readFile } from "node:fs/promises";

export const ORIGIN = "https://example.test";
export const SCOPE = `${ORIGIN}/mystery-navi/`; // GitHub Pages のサブパスで公開したときと同じ形

const SW_FILE = new URL("../../sw.js", import.meta.url);

const stripSearch = (href) => {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  return u.href;
};
const urlOf = (req) => (typeof req === "string" ? req : req.url);

// 中身は文字列で持ち、取り出すたびに新しい Response を作る（本物のキャッシュと同じく、何度でも読める）
class FakeCache {
  constructor(env) {
    this.env = env;
    this.entries = new Map(); // URL → { body, status }
  }
  async match(req, opts = {}) {
    const want = opts.ignoreSearch ? stripSearch(urlOf(req)) : urlOf(req);
    for (const [url, e] of this.entries) {
      if ((opts.ignoreSearch ? stripSearch(url) : url) === want) return new Response(e.body, { status: e.status });
    }
    return undefined;
  }
  async put(req, res) {
    if (this.env.failCachePut) throw new Error("QuotaExceededError");
    this.entries.set(urlOf(req), { body: await res.text(), status: res.status });
  }
  async addAll(requests) {
    const got = [];
    for (const r of requests) {
      const res = await this.env.fetch(r);
      if (!res.ok) throw new TypeError(`addAll: ${r.url} ${res.status}`);
      got.push([r, res]);
    }
    for (const [r, res] of got) await this.put(r, res);
  }
  urls() {
    return [...this.entries.keys()];
  }
  text(url) {
    return this.entries.get(url)?.body;
  }
}

class FakeCacheStorage {
  constructor(env) {
    this.env = env;
    this.map = new Map();
  }
  async open(name) {
    if (!this.map.has(name)) this.map.set(name, new FakeCache(this.env));
    return this.map.get(name);
  }
  async keys() {
    return [...this.map.keys()];
  }
  async delete(name) {
    return this.map.delete(name);
  }
  async has(name) {
    return this.map.has(name);
  }
  get(name) {
    return this.map.get(name);
  }
}

// sw.js を読み込む。respond(request) で通信の結果を決める（Promise<Response> を返す。返さなければ届かない）
export async function loadServiceWorker({ respond = () => Promise.reject(new TypeError("network")) } = {}) {
  const code = await readFile(SW_FILE, "utf8");
  const listeners = {};
  const env = {
    respond,
    requests: [], // fetch に渡されたもの（{ url, cache }）
    skipped: false,
    claimed: false,
    failCachePut: false,
  };
  env.fetch = (req) => {
    env.requests.push({ url: urlOf(req), cache: req.cache });
    return env.respond(req);
  };
  env.caches = new FakeCacheStorage(env);
  const self = {
    location: new URL(`${SCOPE}sw.js`),
    registration: { scope: SCOPE },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => {
      env.skipped = true;
    },
    clients: {
      claim: async () => {
        env.claimed = true;
      },
    },
  };
  const context = vm.createContext({
    self,
    caches: env.caches,
    fetch: (req) => env.fetch(req),
    Request,
    Response,
    URL,
    // node:test の模擬タイマーが効くよう、呼ばれた時点の setTimeout を使う
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    console,
  });
  // 最後の式の値として、sw.js の定数を取り出す（vm の中の配列は比べにくいので、JSON でこちら側の値にする）
  env.constants = JSON.parse(
    vm.runInContext(
      `${code}\n;JSON.stringify({ CACHE_VERSION, CACHE_PREFIX, APP_CACHE, DATA_CACHE, SHOPS_TIMEOUT_MS, APP_FILES, SHOPS_FILE })`,
      context,
      { filename: "sw.js" },
    ),
  );

  const extendable = () => {
    const waits = [];
    return { waits, waitUntil: (p) => waits.push(p) };
  };
  env.install = async () => {
    const e = extendable();
    listeners.install(e);
    await Promise.all(e.waits);
  };
  env.activate = async () => {
    const e = extendable();
    listeners.activate(e);
    await Promise.all(e.waits);
  };
  // ページからの取得。respondWith が呼ばれなければ handled: false（ブラウザがそのまま通信する）
  env.dispatchFetch = (url, { method = "GET", mode = "cors", cache = "default" } = {}) => {
    let response = null;
    const waits = [];
    const event = {
      request: { url, method, mode, cache },
      respondWith: (p) => {
        response = Promise.resolve(p);
      },
      waitUntil: (p) => waits.push(p),
    };
    listeners.fetch(event);
    return { handled: response !== null, response, waits };
  };
  env.abs = (path) => new URL(path, `${SCOPE}sw.js`).href;
  return env;
}

// 応答（本文は文字列）
export const ok = (body) => Promise.resolve(new Response(body, { status: 200 }));

// 外から解決できる Promise（ネットワークが遅い状態を作る）
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 待っている処理（Promise の続き）を進める
export async function flush(times = 10) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}
