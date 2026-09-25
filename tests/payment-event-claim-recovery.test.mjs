import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("payment event recovery uses processing start time, not original event age", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const webhook = await readFile(new URL("../app/api/webhooks/payments/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0046_payment_event_processing_claims.sql", import.meta.url), "utf8");

  assert.match(migration, /processing_started_at/);
  assert.match(worker, /processing_started_at IS NOT NULL AND julianday\(processing_started_at\)/);
  assert.match(worker, /processing_started_at = CURRENT_TIMESTAMP/);
  assert.match(webhook, /processing_started_at = CURRENT_TIMESTAMP/);
  assert.match(webhook, /processing_started_at = NULL/);
  assert.doesNotMatch(worker, /julianday\(created_at\) < julianday\('now', '-5 minutes'\)/);
});
