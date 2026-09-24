import assert from "node:assert/strict";
import test from "node:test";
import { operationalLog } from "../lib/server/observability.ts";

test("operational logs carry searchable context and redact sensitive fields", () => {
  const original = console.error;
  let output = "";
  console.error = (value) => { output = String(value); };
  try {
    operationalLog("error", {
      event: "TEST_FAILURE",
      requestId: "req-1",
      correlationId: "corr-1",
      facilityId: "facility-1",
      actorId: "staff-1",
      sessionId: "session-1",
      error: new Error("provider unavailable"),
      token: "do-not-log",
      payload: { email: "private@example.test" },
    });
  } finally {
    console.error = original;
  }
  const record = JSON.parse(output);
  assert.equal(record.service, "securevisit");
  assert.equal(record.event, "TEST_FAILURE");
  assert.equal(record.requestId, "req-1");
  assert.equal(record.correlationId, "corr-1");
  assert.equal(record.facilityId, "facility-1");
  assert.equal(record.actorId, "staff-1");
  assert.equal(record.sessionId, "session-1");
  assert.deepEqual(record.error, { name: "Error", message: "provider unavailable" });
  assert.equal(record.token, "[REDACTED]");
  assert.equal(record.payload, "[REDACTED]");
  assert.ok(record.timestamp);
});
