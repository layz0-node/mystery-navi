// 記録パネル（S5）：回数・段階・「？？？」・店の数・読み込みの確認文・書き出した日・注意の表示
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordsPanelModel,
  importConfirmText,
  importErrorText,
  exportDateLabel,
  versionLabel,
  unreadableNotice,
  savingFailed,
} from "../src/logic.js";
import { TROPHY_LEVELS } from "../src/config.js";
import { jst, visit } from "./fixtures/make-shop.js";

// 日本時間で書いた日時の記録
const v = (shopId, value, t) => visit(shopId, value, jst(t));

// n 回分の記録（店も日も別。2026-01-01 から1日ずつ）
function visitsCount(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ shopId: `shop_${i}`, value: "skip", at: new Date(Date.UTC(2026, 0, 1, 12) + i * 86400000).toISOString() });
  return out;
}

test("記録が0件 → 段階なし・0回・あと5回。一覧の7つはすべて「？？？」で、回数は 5〜150", () => {
  const m = recordsPanelModel([]);
  assert.equal(m.level, null);
  assert.equal(m.countText, "0回");
  assert.equal(m.nextText, "あと5回");
  assert.deepEqual(m.levels.map((l) => l.name), Array(7).fill("？？？"));
  assert.deepEqual(m.levels.map((l) => l.countText), ["5回", "10回", "20回", "35回", "60回", "100回", "150回"]);
  assert.ok(m.levels.every((l) => !l.earned));
  assert.deepEqual([m.visitedText, m.goodText, m.badText], ["0軒", "0軒", "0軒"]);
});

test("12回 → ブロンズ・あと8回。アイアンとブロンズだけ名前が出て、シルバー以降は「？？？」", () => {
  const m = recordsPanelModel(visitsCount(12));
  assert.equal(m.level.id, "bronze");
  assert.equal(m.countText, "12回");
  assert.equal(m.nextText, "あと8回");
  assert.deepEqual(m.levels.map((l) => l.name), ["アイアン", "ブロンズ", "？？？", "？？？", "？？？", "？？？", "？？？"]);
});

test("150回以上 → ポラリス・「最上級」。すべて名前が出る", () => {
  const m = recordsPanelModel(visitsCount(151));
  assert.equal(m.level.id, "polaris");
  assert.equal(m.nextText, "最上級");
  assert.deepEqual(m.levels.map((l) => l.name), TROPHY_LEVELS.map((l) => l.name));
});

test("どの回数でも → 「次のトロフィーまで」に次の段階の名前が入っていない", () => {
  for (const n of [0, 4, 5, 9, 19, 34, 59, 99, 149]) {
    const text = recordsPanelModel(visitsCount(n)).nextText;
    for (const l of TROPHY_LEVELS) assert.ok(!text.includes(l.name), `${n}回：${text}`);
  }
});

test("同じ店・同じ日の記録が2件 → 1回。4:59 と 5:01 → 2回", () => {
  assert.equal(recordsPanelModel([v("shop_001", "good", "2026-11-09T21:00"), v("shop_001", "bad", "2026-11-10T02:00")]).countText, "1回");
  assert.equal(recordsPanelModel([v("shop_001", "good", "2026-11-10T04:59"), v("shop_001", "good", "2026-11-10T05:01")]).countText, "2回");
});

test("good・closed・good の店 → 良い店。good・declined の店 → どちらにも数えない。bad だけの店 → 悪い店", () => {
  const visits = [
    v("shop_001", "good", "2026-11-01T21:00"),
    v("shop_001", "closed", "2026-11-02T21:00"),
    v("shop_001", "good", "2026-11-03T21:00"),
    v("shop_002", "good", "2026-11-01T21:00"),
    v("shop_002", "declined", "2026-11-02T21:00"),
    v("shop_003", "bad", "2026-11-01T21:00"),
  ];
  const m = recordsPanelModel(visits);
  assert.deepEqual([m.visitedText, m.goodText, m.badText], ["3軒", "1軒", "1軒"]);
});

test("店リストにない店IDの記録 → 回数と訪れた店に数える", () => {
  const m = recordsPanelModel([v("shop_closed_forever", "good", "2026-11-01T21:00")]);
  assert.equal(m.countText, "1回");
  assert.equal(m.visitedText, "1軒");
});

// ---------- 読み込み ----------

test("今23回・読み込む5回 → 回数入りの確認文", () => {
  assert.equal(importConfirmText(23, 5), "今の記録（23回）を、読み込む記録（5回）で上書きします。よろしいですか？");
});

test("0回同士 → 「（0回）」がそれぞれ入る", () => {
  assert.equal(importConfirmText(0, 0), "今の記録（0回）を、読み込む記録（0回）で上書きします。よろしいですか？");
});

test("読み込めなかった理由ごとに、空でない別々の文言が返る", () => {
  const reasons = ["json", "app", "version", "record", "backup-failed"];
  const texts = reasons.map(importErrorText);
  assert.ok(texts.every((t) => t.length > 0));
  assert.equal(new Set(texts).size, reasons.length);
  assert.equal(importErrorText("visits"), importErrorText("record"));
});

// ---------- 書き出した日 ----------

test("2026-11-12T15:30:00Z → 日本時間で日付が変わって「2026年11月13日」", () => {
  assert.equal(exportDateLabel("2026-11-12T15:30:00Z"), "2026年11月13日");
});

test("2026-11-12T20:35:00+09:00 → 「2026年11月12日」", () => {
  assert.equal(exportDateLabel("2026-11-12T20:35:00+09:00"), "2026年11月12日");
  assert.equal(exportDateLabel(jst("2026-11-12T00:10")), "2026年11月12日");
});

test("まだ書き出していない（null） → 「まだ書き出していません」", () => {
  assert.equal(exportDateLabel(null), "まだ書き出していません");
});

// ---------- 注意の表示 ----------

test("読めない記録が0件 → 何も出さない。3件 → 件数入りの注意", () => {
  assert.equal(unreadableNotice(0), null);
  assert.equal(unreadableNotice(3), "書き出せない記録が3件あります（端末の保存データには残してあります）");
});

test("保存できている → 出さない。保存せずに動いている、または書き込みに失敗した → 出す", () => {
  assert.equal(savingFailed({ saving: true, lastWriteFailed: false }), false);
  assert.equal(savingFailed({ saving: false, lastWriteFailed: false }), true);
  assert.equal(savingFailed({ saving: true, lastWriteFailed: true }), true);
});

test("版の表示：先頭の v を外して「バージョン 10」の形にする", () => {
  assert.equal(versionLabel("v10"), "バージョン 10");
  assert.equal(versionLabel("v9"), "バージョン 9");
  assert.equal(versionLabel("11"), "バージョン 11");
});
