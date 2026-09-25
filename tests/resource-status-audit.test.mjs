import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("resource status changes require optimistic concurrency and create audit/outbox records", async () => {
  const source = await readFile(new URL("../app/api/control/resources/route.ts", import.meta.url), "utf8");
  assert.match(source, /body\.command !== "set_status"/);
  assert.match(source, /EXPECTED_VERSION_REQUIRED/);
  assert.match(source, /RESOURCE_STATUS_CHANGED/);
  assert.match(source, /auditAndOutboxStatements\(d1/);
  assert.match(source, /version = version \+ 1/);
});

test("resource reassignment requires and replays an idempotency claim", async () => {
  const source = await readFile(new URL("../app/api/control/resources/route.ts", import.meta.url), "utf8");
  assert.match(source, /body\.command === "reassign_appointment"/);
  assert.match(source, /resource-reassign:\$\{authorization\.facilityId\}:\$\{appointmentId\}:\$\{current\.id\}/);
  assert.match(source, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /completeIdempotencyStatement\(d1/);
  assert.match(source, /releaseIdempotencyClaim\(databaseRef, idempotency\)/);
});
