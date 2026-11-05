// 端末のタイムゾーンが日本以外でも、時刻の判定が同じ結果になることを確かめる（requirements.md T4）。
// 開発機が日本時間だと、端末の時刻を使う不具合が隠れるので、
// 時刻を扱うテストを America/New_York と UTC で別プロセスとして走らせ直す。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const TIME_TESTS = [
  "logic-hours.test.js",
  "logic-visits.test.js",
  "logic-target.test.js",
  "logic-select.test.js",
  "logic-trophy.test.js",
  "storage-validate.test.js",
  "storage-save.test.js",
  "storage-undo.test.js",
  "storage-backup.test.js",
].map((f) => path.join(testsDir, f));

function envWith(tz) {
  const env = { ...process.env, TZ: tz };
  delete env.NODE_TEST_CONTEXT; // 親の node --test の子として扱われないようにする
  return env;
}

for (const [tz, offsetMin] of [
  ["America/New_York", 300],
  ["UTC", 0],
]) {
  test(`${tz} でも、時刻のテストがすべて通る`, () => {
    // まず、そのタイムゾーンが本当に効いていることを確かめる（1970年1月の時差）
    const probe = spawnSync(process.execPath, ["-e", "process.stdout.write(String(new Date(0).getTimezoneOffset()))"], {
      env: envWith(tz),
      encoding: "utf8",
    });
    assert.equal(probe.stdout, String(offsetMin), `TZ=${tz} が効いていません`);

    const run = spawnSync(process.execPath, ["--test", "--test-reporter=dot", ...TIME_TESTS], {
      env: envWith(tz),
      encoding: "utf8",
    });
    assert.equal(run.status, 0, `TZ=${tz} で失敗しました\n${run.stdout}\n${run.stderr}`);
  });
}
