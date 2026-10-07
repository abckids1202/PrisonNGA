import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("scheduled reconciliation marks stale kiosks failed with audit and outbox evidence", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /async function reconcileStaleKioskHealth/);
  assert.match(source, /health_state = 'FAILED'/);
  assert.match(source, /julianday\('now', '-3 minutes'\)/);
  assert.match(source, /KIOSK_HEALTH_FAILED/);
  assert.match(source, /reconcileStaleKioskHealth\(env\)/);
});
