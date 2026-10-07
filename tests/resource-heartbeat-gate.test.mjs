import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor capacity and approval allocation require a fresh kiosk heartbeat", async () => {
  const [availability, resources] = await Promise.all([
    readFile(new URL("../app/api/visitor/availability/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/resources.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [availability, resources]) {
    assert.match(source, /last_heartbeat_at IS NOT NULL/);
    assert.match(source, /julianday\('now', '-3 minutes'\)/);
  }
});
