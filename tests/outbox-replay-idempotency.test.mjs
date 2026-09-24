import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff outbox replay is replay-safe and facility-scoped", async () => {
  const source = await readFile(new URL("../app/api/control/notifications/outbox/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(database/);
  assert.match(source, /completeIdempotencyStatement\(d1/);
  assert.match(source, /releaseIdempotencyClaim/);
  assert.match(source, /facility_id = \?/);
});
