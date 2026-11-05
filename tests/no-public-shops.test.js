// テストが公開用の shops.json を読んでいないことを確かめる（CLAUDE.md 3）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const self = path.basename(fileURLToPath(import.meta.url));
const target = "shops" + ".json";

test("tests/ のコードは fixtures/ 以外の店データを参照しない", async () => {
  const entries = await readdir(testsDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.(m?js|cjs)$/.test(e.name) && e.name !== self)
    .map((e) => path.join(e.parentPath, e.name));
  assert.ok(files.length > 0);
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (line.includes(target)) {
        assert.ok(
          line.includes("fixtures/" + target),
          `${path.relative(testsDir, file)}:${i + 1} が fixtures/ 以外の店データを参照しています`,
        );
      }
    });
  }
});
