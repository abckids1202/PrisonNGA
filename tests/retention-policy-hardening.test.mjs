import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("retention policy changes are scoped and replay-safe", async () => {
  const source = await readFile(new URL("../app/api/control/retention/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0036_retention_manage_permission.sql", import.meta.url), "utf8");
  assert.match(source, /requirePermission\("retention\.manage"\)/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /completeIdempotencyStatement/);
  assert.match(source, /auditAndOutboxStatements\(d1/);
  assert.match(migration, /retention\.manage/);
  assert.match(migration, /role-supervisor/);
});

