import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeXenditWebhook, normalizeXenditWebhookId } from "../app/api/webhooks/xendit/route.ts";

test("Xendit webhook delivery identity requires the provider webhook-id", () => {
  assert.equal(normalizeXenditWebhookId("wh_123"), "wh_123");
  assert.throws(() => normalizeXenditWebhookId(""), /XENDIT_WEBHOOK_ID_REQUIRED/);
  assert.throws(() => normalizeXenditWebhookId("x\ninvalid"), /XENDIT_WEBHOOK_ID_REQUIRED/);
});

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

test("Xendit top-level dispute notifications map to an audited disputed payment", () => {
  const payload = canonicalizeXenditWebhook({
    event: "dispute.action_required",
    id: "mi-dspt-123",
    reference_id: "payment-intent-123",
    status: "ACTION_REQUIRED",
    currency: "IDR",
    amount: { initial: "50000.00", terminal: null },
  });
  assert.deepEqual(payload, {
    eventId: "xendit:dispute.action_required:mi-dspt-123",
    eventType: "PAYMENT_DISPUTED",
    paymentIntentId: "payment-intent-123",
    status: "DISPUTED",
    currency: "IDR",
  });
});

test("unknown Xendit dispute lifecycle events fail closed", () => {
  assert.throws(() => canonicalizeXenditWebhook({
    event: "dispute.injected",
    id: "mi-dspt-123",
    reference_id: "payment-intent-123",
    status: "ACTION_REQUIRED",
    currency: "IDR",
  }), /XENDIT_WEBHOOK_INVALID/);
});
