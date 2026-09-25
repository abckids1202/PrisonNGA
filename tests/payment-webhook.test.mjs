import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { serializePaymentWebhookSnapshot, verifyPaymentWebhookSignature } from "../lib/server/payments/provider.ts";

test("payment webhook snapshot keeps only settlement fields, not raw provider data", () => {
  const snapshot = serializePaymentWebhookSnapshot({
    eventType: " payment_succeeded ",
    paymentIntentId: " intent-123 ",
    providerReference: " provider-456 ",
    status: " succeeded ",
    amountMinor: 50000,
    currency: " idr ",
  });

  assert.deepEqual(JSON.parse(snapshot), {
    eventType: "PAYMENT_SUCCEEDED",
    paymentIntentId: "intent-123",
    providerReference: "provider-456",
    status: "SUCCEEDED",
    amountMinor: 50000,
    currency: "IDR",
  });
  assert.equal(snapshot.includes("cardNumber"), false);
  assert.equal(snapshot.includes("payerAddress"), false);
});

test("webhook snapshots are stable for normalized retries and differ when settlement identity changes", () => {
  const first = serializePaymentWebhookSnapshot({ eventType: "paid", paymentIntentId: "intent-123", status: "succeeded", amountMinor: 50000, currency: "IDR" });
  const normalizedRetry = serializePaymentWebhookSnapshot({ eventType: " PAID ", paymentIntentId: " intent-123 ", status: " SUCCEEDED ", amountMinor: 50000, currency: " idr " });
  const otherIntent = serializePaymentWebhookSnapshot({ eventType: "PAID", paymentIntentId: "intent-456", status: "SUCCEEDED" });

  assert.equal(first, normalizedRetry);
  assert.notEqual(first, otherIntent);
});

test("payment webhook HMAC verification accepts only the signed raw body", async () => {
  const rawBody = '{"eventId":"evt-1","eventType":"PAYMENT_SUCCEEDED"}';
  const secret = "webhook-test-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

  assert.equal(await verifyPaymentWebhookSignature(rawBody, `sha256=${signature}`, secret), true);
  assert.equal(await verifyPaymentWebhookSignature(rawBody, signature.toUpperCase(), secret), true);
  assert.equal(await verifyPaymentWebhookSignature(`${rawBody} `, `sha256=${signature}`, secret), false);
  assert.equal(await verifyPaymentWebhookSignature(rawBody, `sha256=${signature.slice(0, -2)}zz`, secret), false);
  assert.equal(await verifyPaymentWebhookSignature(rawBody, "", secret), false);
  assert.equal(await verifyPaymentWebhookSignature(rawBody, `sha256=${signature}`, null), false);
});

test("payment webhook HMAC verification supports a bounded timestamp replay window", async () => {
  const rawBody = '{"eventId":"evt-1"}';
  const secret = "webhook-test-secret";
  const timestamp = "1760000000";
  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload)));
  const signature = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

  assert.equal(await verifyPaymentWebhookSignature(rawBody, `sha256=${signature}`, secret, timestamp, 1760000000 * 1000), true);
  assert.equal(await verifyPaymentWebhookSignature(rawBody, `sha256=${signature}`, secret, timestamp, (1760000000 + 301) * 1000), false);
  assert.equal(await verifyPaymentWebhookSignature(rawBody, `sha256=${signature}`, secret, "not-a-timestamp", 1760000000 * 1000), false);
});

test("non-development payment webhooks require timestamped signatures", async () => {
  const route = await readFile(new URL("../app/api/webhooks/payments/route.ts", import.meta.url), "utf8");
  assert.match(route, /PAYMENT_WEBHOOK_TIMESTAMP_REQUIRED/);
  assert.match(route, /x-securevisit-timestamp/);
  assert.match(route, /environment !== "development"/);
});

test("payment webhook processing binds events to the configured provider", async () => {
  const route = await readFile(new URL("../app/api/webhooks/payments/route.ts", import.meta.url), "utf8");
  const processor = await readFile(new URL("../lib/server/payments/process-event.ts", import.meta.url), "utf8");
  assert.match(route, /configuredProvider/);
  assert.match(route, /PAYMENT_WEBHOOK_PROVIDER_MISMATCH/);
  assert.match(processor, /WHERE provider = \? AND \(id = \? OR provider_reference = \?\)/);
});

test("payment webhook processing verifies provider reference and settlement amount", async () => {
  const processor = await readFile(new URL("../lib/server/payments/process-event.ts", import.meta.url), "utf8");
  assert.match(processor, /PAYMENT_PROVIDER_REFERENCE_MISMATCH/);
  assert.match(processor, /PAYMENT_AMOUNT_MISMATCH/);
  assert.match(processor, /PAYMENT_CURRENCY_MISMATCH/);
  assert.match(processor, /provider_reference, credit_quantity, amount_minor, currency/);
});

test("direct webhook delivery claims an event before settlement and releases failed claims", async () => {
  const route = await readFile(new URL("../app/api/webhooks/payments/route.ts", import.meta.url), "utf8");
  assert.match(route, /status = 'PROCESSING', attempt_count = attempt_count \+ 1/);
  assert.match(route, /status IN \('RECEIVED', 'FAILED'\)/);
  assert.match(route, /status = 'FAILED', available_at = datetime\('now', '\+30 seconds'\)/);
});

test("refund webhooks remain retryable until reserved credits can be released", async () => {
  const source = await readFile(new URL("../lib/server/payments/process-event.ts", import.meta.url), "utf8");
  assert.match(source, /refundPurchasedCreditsStatements/);
  assert.match(source, /PAYMENT_REFUND_PENDING/);
  assert.match(source, /if \(!accountId \|\| !purchase\) throw/);
});

test("payment reconciliation recovers stale processing claims", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /status = 'FAILED', available_at = CURRENT_TIMESTAMP, processing_started_at = NULL, last_error = 'Recovered stale processing claim\.'/);
  assert.match(source, /status = 'PROCESSING' AND processing_started_at IS NOT NULL AND julianday\(processing_started_at\) < julianday\('now', '-5 minutes'\)/);
});

test("notification delivery resolves recipients from facility-scoped aggregates", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /resolveOutboxVisitorRecipient\(env\.DB, row\)/);
  assert.match(source, /OUTBOX_RECIPIENT_MISMATCH/);
});
