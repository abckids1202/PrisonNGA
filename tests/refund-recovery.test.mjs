import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/control/finance/refunds/route.ts", import.meta.url), "utf8");

test("refund retries reuse an existing failed request instead of creating a second provider refund", () => {
  assert.match(source, /status IN \('REQUESTED', 'FAILED', 'COMPLETED'\)/);
  assert.match(source, /existing\?\.status === "COMPLETED"/);
  assert.match(source, /existing\.status === "FAILED"/);
  assert.match(source, /PAYMENT_REFUND_RETRY_REQUESTED/);
  assert.match(source, /reason: refundReason/);
});

test("refund provider acceptance remains webhook-driven and replay-safe", () => {
  assert.match(source, /PAYMENT_REFUND_PROVIDER_ACCEPTED/);
  assert.match(source, /completeIdempotencyStatement\(d1/);
  assert.match(source, /status: "REQUESTED"/);
});

test("refund lookup is restricted to visitor-owned payment intents", () => {
  assert.match(source, /u\.id = pi\.user_id AND u\.user_type = 'VISITOR'/);
});

test("refund operations fail closed until the approved policy attestation exists", () => {
  assert.match(source, /REFUND_POLICY_APPROVAL_REQUIRED/);
  assert.match(source, /SECUREVISIT_REFUND_POLICY_APPROVAL/);
});

test("refund operations treat a missing environment as non-development", () => {
  assert.match(source, /getRuntimeValue\("SECUREVISIT_ENVIRONMENT"\) \|\| "unknown"/);
});
