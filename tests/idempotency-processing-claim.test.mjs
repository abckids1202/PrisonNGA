import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("idempotency claims track processing age separately from creation age", async () => {
  const source = await readFile(new URL("../lib/server/idempotency.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0047_idempotency_processing_claims.sql", import.meta.url), "utf8");
  assert.match(migration, /processing_started_at/);
  assert.match(source, /processing_started_at, created_at/);
  assert.match(source, /COALESCE\(processing_started_at, created_at\) <= \?/);
  assert.match(source, /const processingStartedAt = existing\.processing_started_at \|\| existing\.created_at/);
  assert.match(source, /status = 'COMPLETED', processing_started_at = NULL/);
});
