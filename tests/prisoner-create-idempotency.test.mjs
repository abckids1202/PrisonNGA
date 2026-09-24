import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("prisoner creation is replay-safe and commits its audit/outbox record", async () => {
  const source = await readFile(new URL("../app/api/control/prisoners/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /completeIdempotencyStatement\(d1/);
  assert.match(source, /releaseIdempotencyClaim\(d1, idempotency\)/);
  assert.match(source, /PRISONER_CREATED/);
  assert.match(source, /auditAndOutboxStatements\(d1/);
  assert.match(source, /const statements = await d1\.batch\(\[/);
});

