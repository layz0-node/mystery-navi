import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateShopsData,
  validateShopsFile,
  normalizeForNameCheck,
  parseRange,
} from "../scripts/validate-shops.mjs";

const FIXTURE_URL = new URL("./fixtures/shops.json", import.meta.url);

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE_URL, "utf8"));
}

// 1軒目だけを書き換えたデータを作る
async function withFirstShop(change) {
  const data = await loadFixture();
  change(data.shops[0], data);
  return data;
}

function assertRejected(data, pattern) {
  const errors = validateShopsData(data);
  assert.ok(
    errors.some((e) => pattern.test(e)),
    `期待した問題が見つかりません: ${pattern}\n実際: ${JSON.stringify(errors, null, 2)}`,
  );
}

test("テスト用のダミー店は検査に通る", async () => {
  assert.deepEqual(await validateShopsFile(FIXTURE_URL), []);
});

test("ダミー店は11軒で、2〜3区に分かれ、同じ区に複数の店がある", async () => {
  const { shops } = await loadFixture();
  // 11軒目（shop_901）は、ほかの店から1km以上離した店。圏外A2（200m以内にしか店がない）を再現するため
  assert.equal(shops.length, 11);
  const counts = new Map();
  for (const s of shops) counts.set(s.ward, (counts.get(s.ward) ?? 0) + 1);
  assert.ok(counts.size >= 2 && counts.size <= 3);
  assert.ok([...counts.values()].some((n) => n >= 2));
});

test("ダミー店に、200m以内に隣り合う組がある", async () => {
  const { shops } = await loadFixture();
  // 検査用の簡易な距離（ハバーサイン）。本番の距離計算は Phase 1 で logic.js に作る
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dist = (a, b) => {
    const h =
      Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  let found = false;
  for (let i = 0; i < shops.length; i++) {
    for (let j = i + 1; j < shops.length; j++) {
      if (dist(shops[i], shops[j]) <= 200) found = true;
    }
  }
  assert.ok(found);
});

test("ダミー店の営業時間に、定休日・26:00表記・昼休み・24時間営業がある", async () => {
  const { shops } = await loadFixture();
  const all = shops.map((s) => Object.values(s.hours));
  assert.ok(all.some((days) => days.some((d) => d.length === 0)), "定休日");
  assert.ok(all.some((days) => days.some((d) => d.some((r) => r.endsWith("-26:00")))), "26:00表記");
  assert.ok(all.some((days) => days.some((d) => d.length === 2)), "昼休み");
  assert.ok(all.some((days) => days.every((d) => d.length === 1 && d[0] === "00:00-24:00")), "24時間営業");
});

test("ダミー店に、ヒント3が決まり文句の店がある", async () => {
  const { shops } = await loadFixture();
  const phrase = "入口の情報はまだありません。『地図で見る』で確かめてください";
  assert.ok(shops.some((s) => s.hints[2] === phrase));
});

test("ID の重複を見つける", async () => {
  const data = await withFirstShop((shop, d) => { shop.id = d.shops[1].id; });
  assertRejected(data, /重複/);
});

test("ID が shop_001 の形でなければ弾く", async () => {
  for (const id of ["shop_01", "Shop_001", "store_001", "shop_001a", 1]) {
    const data = await withFirstShop((shop) => { shop.id = id; });
    assertRejected(data, /id は shop_001 の形/);
  }
});

test("公開用データにない項目（作業用の項目）が混ざっていたら弾く", async () => {
  const data = await withFirstShop((shop) => { shop.source = "メモ"; });
  assertRejected(data, /公開用データにない項目 "source"/);
});

test("必要な項目がなければ弾く", async () => {
  const data = await withFirstShop((shop) => { delete shop.ward; });
  assertRejected(data, /項目 "ward" がありません/);
});

test("一番上に不明な項目があれば弾く", async () => {
  const data = await loadFixture();
  data.notes = "メモ";
  assertRejected(data, /一番上に不明な項目 "notes"/);
});

test("座標が東京23区の範囲外なら弾く", async () => {
  for (const [lat, lng] of [[35.0, 139.7], [35.7, 140.1], [36.0, 139.7], [35.7, 139.3]]) {
    const data = await withFirstShop((shop) => { shop.lat = lat; shop.lng = lng; });
    assertRejected(data, /範囲外/);
  }
});

test("座標が数値でなければ弾く", async () => {
  const data = await withFirstShop((shop) => { shop.lat = "35.7"; });
  assertRejected(data, /数値ではありません/);
});

test("区が23区の区名でなければ弾く", async () => {
  for (const ward of ["渋谷", "武蔵野市", "", null]) {
    const data = await withFirstShop((shop) => { shop.ward = ward; });
    assertRejected(data, /23区の区名ではありません/);
  }
});

test("営業時間の書式の誤りを弾く", async () => {
  const bad = ["18:00〜26:00", "18:00-26:60", "24:00-26:00", "18:00-18:00", "20:00-19:00", "18:00-30:30", "8:00-12:00"];
  for (const range of bad) {
    const data = await withFirstShop((shop) => { shop.hours.mon = [range]; });
    assert.ok(validateShopsData(data).length > 0, `弾かれるべき: ${range}`);
  }
});

test("営業時間の書式：通るもの", () => {
  assert.deepEqual(parseRange("00:00-24:00"), { start: 0, end: 1440 });
  assert.deepEqual(parseRange("18:00-26:00"), { start: 1080, end: 1560 });
  assert.deepEqual(parseRange("23:59-30:00"), { start: 1439, end: 1800 });
});

test("曜日が足りない・不明な曜日があれば弾く", async () => {
  let data = await withFirstShop((shop) => { delete shop.hours.sun; });
  assertRejected(data, /hours\.sun がありません/);
  data = await withFirstShop((shop) => { shop.hours.holiday = []; });
  assertRejected(data, /不明な曜日 "holiday"/);
});

test("同じ日の範囲が重なっている・並びが逆なら弾く", async () => {
  let data = await withFirstShop((shop) => { shop.hours.mon = ["12:00-16:00", "15:00-23:00"]; });
  assertRejected(data, /重なっているか/);
  data = await withFirstShop((shop) => { shop.hours.mon = ["17:00-23:00", "12:00-15:00"]; });
  assertRejected(data, /重なっているか/);
});

test("前の日の深夜の営業が次の日の開始と重なれば弾く。ちょうどつながるのは通す", async () => {
  let data = await withFirstShop((shop) => {
    shop.hours.mon = ["18:00-29:00"];
    shop.hours.tue = ["04:00-12:00"];
  });
  assertRejected(data, /hours\.mon の深夜の営業が hours\.tue の開始と重なっています/);

  data = await withFirstShop((shop) => {
    shop.hours.mon = ["18:00-29:00"];
    shop.hours.tue = ["05:00-12:00"];
  });
  assert.deepEqual(validateShopsData(data), []);
});

test("日曜の深夜の営業と月曜の開始の重なりも見る", async () => {
  const data = await withFirstShop((shop) => {
    shop.hours.sun = ["18:00-28:00"];
    shop.hours.mon = ["03:00-12:00"];
  });
  assertRejected(data, /hours\.sun の深夜の営業が hours\.mon の開始と重なっています/);
});

test("ヒントが3つでない・空なら弾く", async () => {
  let data = await withFirstShop((shop) => { shop.hints = shop.hints.slice(0, 2); });
  assertRejected(data, /3つの配列/);
  data = await withFirstShop((shop) => { shop.hints[1] = "  "; });
  assertRejected(data, /hints\[1\] が空/);
});

test("ヒントに店名が含まれていたら弾く（全角・半角、大文字・小文字、空白、記号の違いも見る）", async () => {
  const cases = [
    ["テスト店01", "テスト店01の看板が目印"],
    ["テスト店01", "ﾃｽﾄ店０１の看板が目印"],
    ["テスト店01", "テスト 店・01 の看板が目印"],
    ["Test Shop 01", "看板に TEST-SHOP01 とある"],
  ];
  for (const [name, hint] of cases) {
    const data = await withFirstShop((shop) => { shop.name = name; shop.hints[2] = hint; });
    assertRejected(data, /hints\[2\] に店名が含まれています/);
  }
});

test("比べるための正規化", () => {
  assert.equal(normalizeForNameCheck("ＴＥＳＴ　店・０１！"), "test店01");
});

test("店名が空・記号だけなら弾く", async () => {
  let data = await withFirstShop((shop) => { shop.name = " "; });
  assertRejected(data, /name が空/);
  data = await withFirstShop((shop) => { shop.name = "・・"; });
  assertRejected(data, /記号と空白だけ/);
});

test("壊れた JSON は読み込めないと報告する", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mystery-navi-"));
  try {
    const file = path.join(dir, "broken.json");
    await writeFile(file, "{broken");
    const errors = await validateShopsFile(file);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /読み込めません: .*JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
