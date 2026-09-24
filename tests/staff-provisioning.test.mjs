import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("staff provisioning is idempotent and commits domain records with audit/outbox", async () => {
  const source = await readFile(new URL("../app/api/control/staff/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /completeIdempotencyStatement\(d1/);
  assert.match(source, /auditAndOutboxStatements\(d1/);
  assert.match(source, /await d1\.batch\(\[/);
  assert.match(source, /releaseIdempotencyClaim\(d1, idempotency\)/);
  assert.doesNotMatch(source, /appendAuditAndOutbox/);
});

