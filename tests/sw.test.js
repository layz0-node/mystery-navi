// サービスワーカー（requirements.md 11章「ホーム画面対応」）
// sw.js を作り物のキャッシュと通信で動かす（tests/fixtures/fake-sw.js）。実際の通信や店リストのファイルは使わない。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadServiceWorker, ok, deferred, flush, SCOPE, ORIGIN } from "./fixtures/fake-sw.js";

// ダミー店モードの店リスト。sw.js は本物の店リストと同じ扱いにする
const TEST_SHOPS = `${SCOPE}tests/fixtures/shops.json`;

// インストール済み（本体と店リストがキャッシュにある）の状態を作る
async function installed(shopsBody = '{"v":"cached"}') {
  const env = await loadServiceWorker({ respond: (req) => ok(`body of ${req.url}`) });
  await env.install();
  await env.activate();
  const data = await env.caches.open(env.constants.DATA_CACHE);
  await data.put(TEST_SHOPS, new Response(shopsBody));
  env.requests.length = 0;
  return env;
}

const textOf = async (r) => (await r).text();

// ---------- インストールと入れ替え ----------

test("インストールで、アプリ本体をすべて cache: reload で取り、キャッシュに入れる", async () => {
  const env = await loadServiceWorker({ respond: (req) => ok(`body of ${req.url}`) });
  await env.install();
  const { APP_CACHE, APP_FILES } = env.constants;
  const app = env.caches.get(APP_CACHE);
  assert.deepEqual(app.urls().sort(), APP_FILES.map(env.abs).sort());
  for (const path of APP_FILES) {
    const r = env.requests.find((x) => x.url === env.abs(path));
    assert.equal(r?.cache, "reload", path); // GitHub Pages のブラウザ側のキャッシュを通さない
  }
  assert.equal(env.skipped, true); // 次に開いたときから新しい版
});

test("インストールで、本物の店リストもキャッシュに入れる（ダミー店は入れない）", async () => {
  const env = await loadServiceWorker({ respond: (req) => ok(`body of ${req.url}`) });
  await env.install();
  const real = env.abs("./shops" + ".json"); // 文字列として使うだけ（ファイルは読まない）
  assert.equal(env.constants.SHOPS_FILE, "./shops" + ".json");
  assert.deepEqual(env.caches.get(env.constants.DATA_CACHE).urls(), [real]);
  assert.equal(env.requests.find((x) => x.url === real)?.cache, "reload");
});

test("インストールのとき店リストが取れなくても、アプリ本体は入る", async () => {
  const env = await loadServiceWorker({
    respond: (req) => (req.url.endsWith("/shops" + ".json") ? Promise.reject(new TypeError("network")) : ok("x")),
  });
  await env.install();
  assert.equal(env.caches.get(env.constants.APP_CACHE).urls().length, env.constants.APP_FILES.length);
  assert.equal(env.caches.get(env.constants.DATA_CACHE)?.urls().length ?? 0, 0);
});

test("入れ替えでは mystery-navi- で始まる古いキャッシュだけを消し、店リストと他のアプリのキャッシュは残す", async () => {
  const env = await loadServiceWorker();
  const { APP_CACHE, DATA_CACHE } = env.constants;
  for (const name of ["mystery-navi-app-v1", "mystery-navi-app-v8", APP_CACHE, DATA_CACHE, "other-app-v1"]) await env.caches.open(name);
  await env.activate();
  assert.deepEqual((await env.caches.keys()).sort(), [APP_CACHE, DATA_CACHE, "other-app-v1"].sort());
  assert.equal(env.claimed, true);
});

test("キャッシュの名前は版ごとに変わる（版を上げると新しいキャッシュに入れ替わる）", async () => {
  const env = await loadServiceWorker();
  const { APP_CACHE, CACHE_VERSION, CACHE_PREFIX } = env.constants;
  assert.equal(APP_CACHE, `${CACHE_PREFIX}app-${CACHE_VERSION}`);
  assert.equal(CACHE_PREFIX, "mystery-navi-");
});

// ---------- アプリ本体 ----------

test("アプリ本体はキャッシュから返し、通信しない", async () => {
  const env = await installed();
  const r = env.dispatchFetch(`${SCOPE}src/app.js`);
  assert.equal(r.handled, true);
  assert.equal(await textOf(r.response), `body of ${SCOPE}src/app.js`);
  assert.equal(env.requests.length, 0);
});

test("画面を開くとき（?debug=1 などが付いていても）は、キャッシュの index.html を返す", async () => {
  const env = await installed();
  for (const url of [SCOPE, `${SCOPE}?debug=1`, `${SCOPE}?debug=1&shops=test`, `${SCOPE}index.html?debug=1`]) {
    const r = env.dispatchFetch(url, { mode: "navigate" });
    assert.equal(r.handled, true, url);
    assert.equal(await textOf(r.response), `body of ${SCOPE}index.html`, url);
  }
  assert.equal(env.requests.length, 0);
});

test("アプリの画面以外のページを開くとき、別のサイト、範囲の外、GET 以外には手を出さない", async () => {
  const env = await installed();
  assert.equal(env.dispatchFetch(`${SCOPE}docs/plan.md`, { mode: "navigate" }).handled, false);
  assert.equal(env.dispatchFetch("https://fonts.googleapis.com/css2?family=DM+Mono").handled, false); // Googleフォント
  assert.equal(env.dispatchFetch("https://fonts.gstatic.com/s/dmmono/x.woff2").handled, false);
  assert.equal(env.dispatchFetch(`${ORIGIN}/other-app/app.js`).handled, false);
  assert.equal(env.dispatchFetch(`${SCOPE}src/app.js`, { method: "POST" }).handled, false);
});

test("キャッシュにないファイルは通信して返す", async () => {
  const env = await installed();
  const r = env.dispatchFetch(`${SCOPE}docs/requirements.md`);
  assert.equal(await textOf(r.response), `body of ${SCOPE}docs/requirements.md`);
});

// ---------- 店リスト ----------

test("店リスト：ネットワークから取れたらそれを返し、キャッシュも新しくする", async () => {
  const env = await installed('{"v":"old"}');
  env.respond = () => ok('{"v":"new"}');
  const r = env.dispatchFetch(TEST_SHOPS, { cache: "no-cache" });
  assert.equal(await textOf(r.response), '{"v":"new"}');
  await Promise.all(r.waits);
  assert.equal(env.caches.get(env.constants.DATA_CACHE).text(TEST_SHOPS), '{"v":"new"}');
});

test("店リスト：つながらないときはキャッシュを返す", async () => {
  const env = await installed('{"v":"old"}');
  env.respond = () => Promise.reject(new TypeError("network"));
  assert.equal(await textOf(env.dispatchFetch(TEST_SHOPS).response), '{"v":"old"}');
});

test("店リスト：サーバーがエラーを返したときもキャッシュを返す", async () => {
  const env = await installed('{"v":"old"}');
  env.respond = () => Promise.resolve(new Response("error", { status: 500 }));
  assert.equal(await textOf(env.dispatchFetch(TEST_SHOPS).response), '{"v":"old"}');
});

test("店リスト：応答がないとき、3秒ちょうどでキャッシュを返す。遅れて届いた応答でキャッシュを新しくする", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = await installed('{"v":"old"}');
  assert.equal(env.constants.SHOPS_TIMEOUT_MS, 3000);
  const slow = deferred();
  env.respond = () => slow.promise;
  const r = env.dispatchFetch(TEST_SHOPS);
  let body = null;
  r.response.then(async (res) => {
    body = await res.text();
  });

  t.mock.timers.tick(2999);
  await flush();
  assert.equal(body, null); // まだ待っている

  t.mock.timers.tick(1);
  await flush();
  assert.equal(body, '{"v":"old"}');

  slow.resolve(new Response('{"v":"late"}'));
  await Promise.all(r.waits);
  assert.equal(env.caches.get(env.constants.DATA_CACHE).text(TEST_SHOPS), '{"v":"late"}');
});

test("店リスト：キャッシュがないときは、3秒を過ぎてもネットワークを待つ", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const env = await loadServiceWorker();
  const slow = deferred();
  env.respond = () => slow.promise;
  const r = env.dispatchFetch(TEST_SHOPS);
  let body = null;
  r.response.then(async (res) => {
    body = await res.text();
  });
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(body, null);
  slow.resolve(new Response('{"v":"net"}'));
  await flush();
  assert.equal(body, '{"v":"net"}');
});

test("店リスト：キャッシュもなく、つながらないときは、失敗をそのままページに返す", async () => {
  const env = await loadServiceWorker();
  env.respond = () => Promise.reject(new TypeError("network"));
  await assert.rejects(env.dispatchFetch(TEST_SHOPS).response, TypeError);
});

test("店リスト：URL に ? が付いていても、同じキャッシュを使う", async () => {
  const env = await installed('{"v":"old"}');
  env.respond = () => Promise.reject(new TypeError("network"));
  assert.equal(await textOf(env.dispatchFetch(`${TEST_SHOPS}?t=1`).response), '{"v":"old"}');
});

test("店リスト：キャッシュに書けなくても、取れた店リストはそのまま返す", async () => {
  const env = await installed('{"v":"old"}');
  env.failCachePut = true;
  env.respond = () => ok('{"v":"new"}');
  assert.equal(await textOf(env.dispatchFetch(TEST_SHOPS).response), '{"v":"new"}');
});

test("店リストは通信してから返す（キャッシュを先に使わない）", async () => {
  const env = await installed('{"v":"old"}');
  env.respond = () => ok('{"v":"new"}');
  await textOf(env.dispatchFetch(TEST_SHOPS, { cache: "no-cache" }).response);
  assert.deepEqual(env.requests.map((x) => x.url), [TEST_SHOPS]);
  assert.equal(env.requests[0].cache, "no-cache"); // ページの指定（ブラウザ側のキャッシュを確かめ直す）を引き継ぐ
});

