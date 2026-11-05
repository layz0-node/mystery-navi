// 到着画面（S2）：評価の値・取り消しの文言・地図のURL・到着画面を保つ期限
// 例の日付：2026-11-09 月曜、11-10 火曜、11-11 水曜
import { test } from "node:test";
import assert from "node:assert/strict";
import { RATING_BUTTONS, ratingValue, ratingLabel, mapSearchUrl, arrivalHoldExpired } from "../src/logic.js";
import { SCORE } from "../src/config.js";
import { jst } from "./fixtures/make-shop.js";

// ---------- 評価の値 ----------

test("「お店良かった」を押す → good、「お店悪かった」を押す → bad", () => {
  assert.equal(ratingValue("good"), "good");
  assert.equal(ratingValue("bad"), "bad");
});

test("「行かなかった」→「入る気にならなかった」→ declined、「今日はやめておく」→ skip", () => {
  assert.equal(ratingValue("notGo", "declined"), "declined");
  assert.equal(ratingValue("notGo", "skip"), "skip");
});

test("「空いてなかった」→「閉まっていた」→ closed、「満席・入れなかった」→ full", () => {
  assert.equal(ratingValue("notOpen", "closed"), "closed");
  assert.equal(ratingValue("notOpen", "full"), "full");
});

test("「行かなかった」を押して理由がまだない → 記録しない（null）", () => {
  assert.equal(ratingValue("notGo"), null);
  assert.equal(ratingValue("notOpen", null), null);
});

test("知らないボタンや、ボタンに合わない理由 → null", () => {
  assert.equal(ratingValue("great"), null);
  assert.equal(ratingValue("notGo", "closed"), null);
  assert.equal(ratingValue("notOpen", "skip"), null);
  assert.equal(ratingValue("good", "skip"), null);
});

test("ボタンと理由から決まる値は、6種類の記録とちょうど一致する", () => {
  const values = RATING_BUTTONS.flatMap((b) => (b.reasons ? b.reasons.map((r) => ratingValue(b.id, r.value)) : [ratingValue(b.id)]));
  assert.deepEqual([...values].sort(), Object.keys(SCORE).sort());
});

// ---------- 取り消しのお知らせの文言 ----------

test("bad → 「『お店悪かった』で記録しました」", () => {
  assert.equal(ratingLabel("bad"), "『お店悪かった』で記録しました");
});

test("理由付き → ボタンと理由を「・」でつなぐ", () => {
  assert.equal(ratingLabel("declined"), "『行かなかった・入る気にならなかった』で記録しました");
  assert.equal(ratingLabel("full"), "『空いてなかった・満席・入れなかった』で記録しました");
});

test("6種類のどれでも → 空でない文言が返り、それぞれ違う", () => {
  const labels = Object.keys(SCORE).map(ratingLabel);
  assert.ok(labels.every((l) => l.length > 0));
  assert.equal(new Set(labels).size, 6);
});

// ---------- 地図のURL ----------

test("店名「テスト店01」・区「豊島区」 → query に「テスト店01 豊島区」をURLエンコードして入れる", () => {
  const url = mapSearchUrl({ name: "テスト店01", ward: "豊島区" });
  assert.equal(url, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("テスト店01 豊島区")}`);
  assert.equal(new URL(url).searchParams.get("query"), "テスト店01 豊島区");
});

test("店名に & # / 空白が入っている → URL が壊れず、店名がそのまま検索語になる", () => {
  const url = mapSearchUrl({ name: "A&B #2 / Lounge", ward: "渋谷区" });
  const u = new URL(url);
  assert.equal(u.searchParams.get("query"), "A&B #2 / Lounge 渋谷区");
  assert.equal(u.searchParams.get("api"), "1");
  assert.equal(u.hash, "");
});

test("返す URL は https://www.google.com/maps/search/ から始まる", () => {
  assert.ok(mapSearchUrl({ name: "x", ward: "港区" }).startsWith("https://www.google.com/maps/search/"));
});

test("店名に $ が入っていても、雛形の置き換えが崩れない", () => {
  assert.equal(new URL(mapSearchUrl({ name: "$& $1", ward: "港区" })).searchParams.get("query"), "$& $1 港区");
});

// ---------- 到着画面を保つ期限 ----------

const arrivedAt = (t) => ({ shopId: "shop_001", selectedAt: t.toISOString(), unlockedHints: 2, arrivedAt: t.toISOString() });

test("月曜23:00着 → 火曜4:59は保つ、火曜5:00ちょうどは期限切れ", () => {
  const t = arrivedAt(jst("2026-11-09T23:00"));
  assert.equal(arrivalHoldExpired(t, jst("2026-11-10T04:59")), false);
  assert.equal(arrivalHoldExpired(t, jst("2026-11-10T05:00")), true);
});

test("火曜3:30着 → 6:30ちょうどは保つ、6:30:01は期限切れ", () => {
  const t = arrivedAt(jst("2026-11-10T03:30"));
  assert.equal(arrivalHoldExpired(t, jst("2026-11-10T06:30")), false);
  assert.equal(arrivalHoldExpired(t, new Date(jst("2026-11-10T06:30").getTime() + 1000)), true);
});

test("火曜5:01着 → 水曜4:59は保つ、水曜5:00は期限切れ", () => {
  const t = arrivedAt(jst("2026-11-10T05:01"));
  assert.equal(arrivalHoldExpired(t, jst("2026-11-11T04:59")), false);
  assert.equal(arrivalHoldExpired(t, jst("2026-11-11T05:00")), true);
});

test("到着していない案内先・案内先なし → 期限切れではない（対象外）", () => {
  const pending = { shopId: "shop_001", selectedAt: jst("2026-11-09T20:00").toISOString(), unlockedHints: 0, arrivedAt: null };
  assert.equal(arrivalHoldExpired(pending, jst("2026-11-12T20:00")), false);
  assert.equal(arrivalHoldExpired(null, jst("2026-11-12T20:00")), false);
});
