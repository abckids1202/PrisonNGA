import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("readiness fails closed on critical columns, not only table names", async () => {
  const source = await readFile(new URL("../app/api/health/readiness/route.ts", import.meta.url), "utf8");
  assert.match(source, /const requiredColumns/);
  assert.match(source, /credit_price_minor IS NOT NULL/);
  assert.match(source, /tariffConfigured/);
  assert.match(source, /payment_provider_events: \["processing_started_at"\]/);
  assert.match(source, /idempotency_records: \["processing_started_at"\]/);
  assert.match(source, /notification_delivery_attempts.*notification_provider_events/);
  assert.match(source, /notification_delivery_attempts: \["provider", "provider_reference", "provider_status", "status_updated_at"\]/);
  assert.match(source, /PRAGMA table_info\(\$\{table\}\)/);
  assert.match(source, /schemaMissing: \{ tables: missingTables, columns: missingColumns \}/);
});
