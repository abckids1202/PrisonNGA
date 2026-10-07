import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cleanup = await readFile(new URL("../lib/server/auth/cleanup.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("stale visitor delivery attempts are failed and their active challenges expire", () => {
  assert.match(cleanup, /reconcileStaleAuthDeliveryAttempts/);
  assert.match(cleanup, /AUTH_DELIVERY_ATTEMPT_STALE/);
  assert.match(cleanup, /status = 'PENDING'.*julianday\('now', '-5 minutes'\)/s);
  assert.match(cleanup, /SET expires_at = CURRENT_TIMESTAMP/);
  assert.match(worker, /reconcileStaleAuthDeliveryAttempts\(env\.DB\)/);
});
