import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverVisitorChallenge } from "../lib/server/visitor-auth/delivery.ts";
import { getPaymentProvider } from "../lib/server/payments/provider.ts";
import { deliverNotification } from "../lib/server/notifications/provider.ts";

async function expectedSignature(secret, timestamp, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("outbound visitor, payment, and notification webhooks bind signatures to a timestamp", async () => {
  const previous = { ...process.env };
  const calls = [];
  const originalFetch = globalThis.fetch;
  process.env.SECUREVISIT_ENVIRONMENT = "staging";
  process.env.VISITOR_AUTH_WEBHOOK_URL = "https://auth.example.test/send";
  process.env.VISITOR_AUTH_WEBHOOK_SECRET = "visitor-secret";
  process.env.PAYMENT_PROVIDER = "webhook";
  process.env.PAYMENT_CHECKOUT_URL = "https://payments.example.test/checkout";
  process.env.PAYMENT_PROVIDER_SECRET = "payment-secret";
  process.env.NOTIFICATION_DELIVERY = "webhook";
  process.env.NOTIFICATION_WEBHOOK_URL = "https://notify.example.test/send";
  process.env.NOTIFICATION_WEBHOOK_SECRET = "notification-secret";
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ providerReference: "provider-1", checkoutUrl: "https://payments.example.test/pay/provider-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await deliverVisitorChallenge({ channel: "EMAIL", challengeId: "challenge-1", destination: "visitor@example.test", code: "123456", expiresAt: "2026-09-24T12:00:00.000Z" });
    const payment = await getPaymentProvider();
    assert.ok(payment);
    await payment.createCheckout({ paymentIntentId: "payment-1", email: "visitor@example.test", phone: null, creditQuantity: 1, amountMinor: 50000, currency: "IDR" });
    await deliverNotification({ notificationId: "notification-1", email: "visitor@example.test", phone: null, template: "APPOINTMENT_APPROVED", title: "Approved", body: "Your visit is approved.", payload: {} });

    assert.equal(calls.length, 3);
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      const timestamp = headers.get("x-securevisit-timestamp");
      const payload = String(call.init.body);
      assert.match(timestamp || "", /^\d{10}$/);
      assert.equal(headers.get("x-securevisit-signature"), `sha256=${await expectedSignature(call.url.includes("payments") ? "payment-secret" : call.url.includes("notify") ? "notification-secret" : "visitor-secret", timestamp, payload)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});
