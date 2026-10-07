import assert from "node:assert/strict";
import test from "node:test";
import { operationalLog, safeOperationalErrorMessage } from "../lib/server/observability.ts";

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

test("operational logs redact sensitive error text and nested contact fields", () => {
  const original = console.warn;
  let output = "";
  console.warn = (value) => { output = String(value); };
  try {
    operationalLog("warn", {
      event: "PROVIDER_FAILURE",
      error: new Error("provider token=secret-value for private@example.test"),
      contact: { email: "private@example.test", phone: "+628123456789" },
      providerReference: "provider-secret-reference",
    });
  } finally {
    console.warn = original;
  }
  const record = JSON.parse(output);
  assert.deepEqual(record.error, { name: "Error", message: "[REDACTED]" });
  assert.deepEqual(record.contact, { email: "[REDACTED]", phone: "[REDACTED]" });
  assert.equal(record.providerReference, "[REDACTED]");
});

test("provider error persistence uses a safe fallback for credentials and contact data", () => {
  assert.equal(safeOperationalErrorMessage(new Error("upstream returned 502"), "PROVIDER_FAILED"), "upstream returned 502");
  assert.equal(safeOperationalErrorMessage(new Error("request failed for token=secret"), "PROVIDER_FAILED"), "PROVIDER_FAILED");
  assert.equal(safeOperationalErrorMessage(new Error("delivery failed for private@example.test"), "PROVIDER_FAILED"), "PROVIDER_FAILED");
  assert.equal(safeOperationalErrorMessage(new Error("provider returned eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-value-long"), "PROVIDER_FAILED"), "PROVIDER_FAILED");
  assert.equal(safeOperationalErrorMessage(new Error("payment key xnd_live_example-secret-value"), "PROVIDER_FAILED"), "PROVIDER_FAILED");
  assert.equal(safeOperationalErrorMessage("not an Error", "PROVIDER_FAILED"), "PROVIDER_FAILED");
});
