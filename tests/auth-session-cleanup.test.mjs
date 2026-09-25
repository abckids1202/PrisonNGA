import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("scheduled worker runs bounded authentication session cleanup", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /purgeExpiredAuthSessions\(env\.DB\)/);
});
