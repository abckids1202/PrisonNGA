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
  });

  assert.deepEqual(JSON.parse(snapshot), {
    eventType: "PAYMENT_SUCCEEDED",
    paymentIntentId: "intent-123",
    providerReference: "provider-456",
    status: "SUCCEEDED",
  });
  assert.equal(snapshot.includes("cardNumber"), false);
  assert.equal(snapshot.includes("payerAddress"), false);
});

test("webhook snapshots are stable for normalized retries and differ when settlement identity changes", () => {
  const first = serializePaymentWebhookSnapshot({ eventType: "paid", paymentIntentId: "intent-123", status: "succeeded" });
  const normalizedRetry = serializePaymentWebhookSnapshot({ eventType: " PAID ", paymentIntentId: " intent-123 ", status: " SUCCEEDED " });
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

test("refund webhooks remain retryable until reserved credits can be released", async () => {
  const source = await readFile(new URL("../lib/server/payments/process-event.ts", import.meta.url), "utf8");
  assert.match(source, /const refund = await refundPurchasedCredits/);
  assert.match(source, /PAYMENT_REFUND_PENDING/);
  assert.match(source, /if \(\"pending\" in refund && refund\.pending\) throw/);
});

test("payment reconciliation recovers stale processing claims", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /status = 'FAILED', available_at = CURRENT_TIMESTAMP, last_error = 'Recovered stale processing claim\.'/);
  assert.match(source, /status = 'PROCESSING' AND created_at < datetime\('now', '-5 minutes'\)/);
});
