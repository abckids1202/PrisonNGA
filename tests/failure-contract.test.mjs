import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contract = await readFile(new URL("../docs/FAILURE_HANDLING.md", import.meta.url), "utf8");

const requiredFailures = [
  "Payment failed",
  "Payment delayed",
  "Duplicate webhook",
  "Appointment collision",
  "Credit reservation failed",
  "Visitor late",
  "Prisoner unavailable",
  "Kiosk disconnected",
  "Camera or microphone failed",
  "Network degraded",
  "LiveKit unavailable",
  "Staff session expired",
  "Notification failed",
  "Refund delayed",
  "Provider outage",
  "Database unavailable",
];

test("failure-handling contract covers every required failure path", () => {
  for (const failure of requiredFailures) assert.match(contract, new RegExp(`\\| ${failure.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")} \\|`));
  assert.match(contract, /\\| Failure \\| User-visible result \\| Retry \/ idempotency \\| Credit and appointment \\| Staff action and records \\|/);
});

test("failure-handling contract preserves non-negotiable safety invariants", () => {
  assert.match(contract, /failed or ambiguous request cannot create a successful payment, approval, readiness, live session, completion, or credit settlement/i);
  assert.match(contract, /Every retryable mutation has a stable idempotency boundary or a persisted provider event key/i);
  assert.match(contract, /Audit and outbox writes are part of the same transaction/i);
  assert.match(contract, /Recording remains `OFF` and `NOT_RECORDED`/i);
});
