import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeXenditWebhook } from "../app/api/webhooks/xendit/route.ts";

test("Xendit payment-session completion maps to the canonical settlement contract", () => {
  const payload = canonicalizeXenditWebhook({
    event: "payment_session.completed",
    created: "2026-10-12T08:00:00.000Z",
    data: {
      reference_id: "payment-intent-123",
      payment_session_id: "ps-session-123",
      amount: 50000,
      currency: "IDR",
    },
  });
  assert.deepEqual(payload, {
    eventId: "xendit:payment_session.completed:ps-session-123",
    eventType: "PAYMENT_SUCCEEDED",
    paymentIntentId: "payment-intent-123",
    providerReference: "ps-session-123",
    status: "SUCCEEDED",
    amountMinor: 50000,
    currency: "IDR",
  });
});

test("Xendit refund failures do not masquerade as failed payments", () => {
  const payload = canonicalizeXenditWebhook({
    event: "refund.failed",
    created: "2026-10-12T08:05:00.000Z",
    data: { reference_id: "payment-intent-123", id: "rfd-123", currency: "IDR", amount: 50000 },
  });
  assert.equal(payload.eventType, "PAYMENT_REFUND_FAILED");
  assert.equal(payload.status, "FAILED");
  assert.equal(payload.paymentIntentId, "payment-intent-123");
});

test("unsupported Xendit events fail closed instead of becoming payment state", () => {
  assert.throws(() => canonicalizeXenditWebhook({ event: "payment.authorization", data: { reference_id: "payment-intent-123" } }), /XENDIT_WEBHOOK_UNSUPPORTED/);
});
