// 圏外画面（S3）のメッセージ、位置を待つ間の判定とエラー表示（S4）
import { test } from "node:test";
import assert from "node:assert/strict";
import { outOfAreaMessage, locationGate, waitingText, errorView } from "../src/logic.js";
import { POSITION_FAIL_TIMEOUT_SEC, INITIAL_FIX_TIMEOUT_SEC } from "../src/config.js";

// ---------- 圏外のメッセージ ----------

test("A1・A2・B・C → それぞれ仕様の2行", () => {
  assert.deepEqual(outOfAreaMessage("A1"), ["近くにシーシャ屋が見つかりませんでした", "東京23区内でお試しください"]);
  assert.deepEqual(outOfAreaMessage("A2"), ["すぐ近くのお店しか見つかりませんでした", "少し離れてから、また開いてみてください"]);
  assert.deepEqual(outOfAreaMessage("B"), ["この辺りのお店は、今は案内できません", "少し離れた場所で、また開いてみてください"]);
  assert.deepEqual(outOfAreaMessage("C"), ["近くのシーシャ屋は今の時間すべて閉まっています", "時間を変えて、また開いてみてください"]);
});

test("それ以外の値 → 例外にならず、A1 と同じ文言", () => {
  assert.deepEqual(outOfAreaMessage("Z"), outOfAreaMessage("A1"));
  assert.deepEqual(outOfAreaMessage(undefined), outOfAreaMessage("A1"));
});

test("返した配列を書き換えても、次に返す文言は変わらない", () => {
  outOfAreaMessage("B")[0] = "x";
  assert.equal(outOfAreaMessage("B")[0], "この辺りのお店は、今は案内できません");
});

// ---------- 位置を待つ間の判定 ----------

const T0 = 1_000_000;
const P = { lat: 35.7295, lng: 139.7109, accuracy: 30 }; // 池袋駅
const gate = (o) => locationGate({ secure: true, position: null, positionError: null, startedAtMs: T0, nowMs: T0, ...o });

test("位置の上限は20秒、精度待ちは10秒", () => {
  assert.equal(POSITION_FAIL_TIMEOUT_SEC, 20);
  assert.equal(INITIAL_FIX_TIMEOUT_SEC, 10);
});

test("HTTPSでない → 位置に関係なく「https」", () => {
  assert.deepEqual(gate({ secure: false }), { kind: "error", error: "https" });
  assert.deepEqual(gate({ secure: false, position: P }), { kind: "error", error: "https" });
});

test("位置が1回でも届いている → 「取れた」。あとでエラーが来ても、20秒を過ぎても変わらない", () => {
  assert.deepEqual(gate({ position: P }), { kind: "ok" });
  assert.deepEqual(gate({ position: P, positionError: { code: 1 } }), { kind: "ok" });
  assert.deepEqual(gate({ position: P, nowMs: T0 + 60_000 }), { kind: "ok" });
});

test("位置がなく、拒否のエラー（code 1） → 「denied」", () => {
  assert.deepEqual(gate({ positionError: { code: 1 } }), { kind: "error", error: "denied" });
});

test("位置がなく、取れないエラー（code 2）や「unsupported」 → 「unavailable」", () => {
  assert.deepEqual(gate({ positionError: { code: 2 } }), { kind: "error", error: "unavailable" });
  assert.deepEqual(gate({ positionError: { code: "unsupported" } }), { kind: "error", error: "unavailable" });
});

test("位置がなく、タイムアウトのエラー（code 3） → 「timeout」", () => {
  assert.deepEqual(gate({ positionError: { code: 3 } }), { kind: "error", error: "timeout" });
});

test("位置もエラーもなく9.999秒 → 待つ（遅くない）、10秒 → 待つ（遅い）", () => {
  assert.deepEqual(gate({ nowMs: T0 + 9_999 }), { kind: "waiting", slow: false });
  assert.deepEqual(gate({ nowMs: T0 + 10_000 }), { kind: "waiting", slow: true });
});

test("位置もエラーもなく19.999秒 → 待つ、ちょうど20秒 → 「timeout」", () => {
  assert.deepEqual(gate({ nowMs: T0 + 19_999 }), { kind: "waiting", slow: true });
  assert.deepEqual(gate({ nowMs: T0 + 20_000 }), { kind: "error", error: "timeout" });
});

test("待っている間の文言：はじめは「現在地を確かめています…」、遅いときは空が見える場所の案内", () => {
  assert.equal(waitingText(false), "現在地を確かめています…");
  assert.equal(waitingText(true), "時間がかかっています…（空が見える場所だと早く取れます）");
});

// ---------- エラー表示 ----------

test("拒否 → 許可の方法を出し、「もう一度試す」を出す", () => {
  assert.deepEqual(errorView("denied"), { title: "位置情報の利用が許可されていません", help: true, retry: true });
});

test("取れない・タイムアウト → 「現在地を取得できませんでした」と「もう一度試す」", () => {
  for (const k of ["unavailable", "timeout"]) {
    assert.deepEqual(errorView(k), { title: "現在地を取得できませんでした", help: false, retry: true });
  }
});

test("HTTPSでない → 「このページはHTTPSで開いてください」。もう一度試しても直らないのでボタンは出さない", () => {
  assert.deepEqual(errorView("https"), { title: "このページはHTTPSで開いてください", help: false, retry: false });
});
