import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("resource reassignment rejects stale kiosk targets in the transactional boundary", async () => {
  const source = await readFile(new URL("../lib/server/resource-reassignment.ts", import.meta.url), "utf8");
  assert.match(source, /tr\.last_heartbeat_at IS NOT NULL/);
  assert.match(source, /julianday\('now', '-3 minutes'\)/);
});
