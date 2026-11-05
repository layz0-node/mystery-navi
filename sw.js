// サービスワーカー（requirements.md 11章「ホーム画面対応」）。app.js から登録する。
//
// - アプリ本体（HTML・CSS・JS・アイコン）：キャッシュを先に使う。バージョンを上げたら新しいキャッシュに入れ替える
// - 店リスト（shops.json。ダミー店モードの tests/fixtures/shops.json も同じ扱い）：ネットワークを先に見る。
//   SHOPS_TIMEOUT_MS で応答がないとき、またはつながらないときはキャッシュを使う。キャッシュもなければネットワークを待つ
// - 別のサイト（Googleフォント）と GET 以外には手を出さない
//
// 画面やロジックを変えたら、CACHE_VERSION を上げる。
// src/ やアイコンにファイルを足したら、APP_FILES にも足す（tests/pwa-files.test.js で入れ忘れを見つける）。
// パスはすべて相対にする（GitHub Pages のサブパスで公開するため）。

const CACHE_VERSION = "v9";
const CACHE_PREFIX = "mystery-navi-"; // 同じドメインの他のページのキャッシュに触らないよう、消すのはこの名前で始まるものだけ
const APP_CACHE = `${CACHE_PREFIX}app-${CACHE_VERSION}`;
const DATA_CACHE = `${CACHE_PREFIX}data`; // 店リスト。アプリの版を上げても消さない
const SHOPS_TIMEOUT_MS = 3000; // 店リストのネットワークを待つ時間（11章の3秒）。SWからは config.js を読めないのでここに置く

const APP_FILES = [
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/config.js",
  "./src/debug.js",
  "./src/logic.js",
  "./src/sensors.js",
  "./src/storage.js",
  "./src/trophy-icons.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
const SHOPS_FILE = "./shops.json"; // インストールのときに入れておく（ダミー店は入れない）

const abs = (path) => new URL(path, self.location.href).href;
const INDEX_URL = abs("./index.html");
const TIMEOUT = Symbol("timeout");
const FAILED = Symbol("failed");

self.addEventListener("install", (event) => {
  event.waitUntil(install());
});

async function install() {
  // GitHub Pages のブラウザ側のキャッシュ（10分）を通さず、必ずサーバーから取る（新旧のファイルが混ざらないように）
  const app = await caches.open(APP_CACHE);
  await app.addAll(APP_FILES.map((path) => new Request(abs(path), { cache: "reload" })));
  // 店リストも入れておく。初めて開いたときは、ページがこのSWより先に店リストを読むため。取れなくてもインストールは続ける
  try {
    const res = await fetch(new Request(abs(SHOPS_FILE), { cache: "reload" }));
    if (res.ok) await (await caches.open(DATA_CACHE)).put(abs(SHOPS_FILE), res);
  } catch {
    // ネットワークがなければ、次に読めたときに入る
  }
  // 入ったらすぐ有効にする。開いている画面はそのまま動き、次に開いたときから新しい版になる
  await self.skipWaiting();
}

self.addEventListener("activate", (event) => {
  event.waitUntil(activate());
});

async function activate() {
  for (const key of await caches.keys()) {
    if (key.startsWith(CACHE_PREFIX) && key !== APP_CACHE && key !== DATA_CACHE) await caches.delete(key);
  }
  await self.clients.claim();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Googleフォントなど
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return;

  if (url.pathname.endsWith("/shops.json")) {
    event.respondWith(shopsResponse(event, request));
  } else if (request.mode === "navigate") {
    // 画面を開くとき（?debug=1 などが付いていても同じ index.html）
    if (url.pathname === scopePath || url.pathname === `${scopePath}index.html`) event.respondWith(pageResponse(request));
  } else {
    event.respondWith(appResponse(request));
  }
});

async function pageResponse(request) {
  const cached = await (await caches.open(APP_CACHE)).match(INDEX_URL);
  return cached ?? fetch(request);
}

async function appResponse(request) {
  const cached = await (await caches.open(APP_CACHE)).match(request, { ignoreSearch: true });
  return cached ?? fetch(request);
}

function cacheKey(href) {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.href;
}

async function shopsResponse(event, request) {
  const key = cacheKey(request.url);
  const network = fetch(request).then(async (res) => {
    if (!res.ok) throw new Error(`店リストを取得できませんでした（HTTP ${res.status}）`);
    try {
      await (await caches.open(DATA_CACHE)).put(key, res.clone());
    } catch {
      // キャッシュに書けなくても（容量など）、取れた店リストはそのまま使う
    }
    return res;
  });
  // キャッシュで先に返したあとも、遅れて届いた応答でキャッシュを更新する
  event.waitUntil(network.then(
    () => {},
    () => {},
  ));

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, SHOPS_TIMEOUT_MS, TIMEOUT);
  });
  const first = await Promise.race([network.catch(() => FAILED), timeout]);
  clearTimeout(timer);
  if (first !== TIMEOUT && first !== FAILED) return first;

  const cached = await (await caches.open(DATA_CACHE)).match(key);
  if (cached) return cached;
  // キャッシュもないときは、ネットワークを待つ（失敗したら、そのままページに失敗を返す）
  return network;
}
