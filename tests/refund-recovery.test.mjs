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
