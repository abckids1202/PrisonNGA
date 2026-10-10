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
  process.env.VISITOR_EMAIL_DELIVERY = "webhook";
  process.env.VISITOR_SMS_DELIVERY = "webhook";
  process.env.VISITOR_AUTH_WEBHOOK_URL = "https://auth.example.test/send";
  process.env.VISITOR_AUTH_WEBHOOK_SECRET = "visitor-secret";
  process.env.PAYMENT_PROVIDER = "webhook";
  process.env.PAYMENT_CHECKOUT_URL = "https://payments.example.test/checkout";
  process.env.PAYMENT_REFUND_URL = "https://payments.example.test/refund";
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
    await payment.requestRefund({ paymentIntentId: "payment-1", providerReference: "provider-1", amountMinor: 50000, currency: "IDR", reason: "Facility cancellation." });
    await deliverNotification({ notificationId: "notification-1", email: "visitor@example.test", phone: null, template: "APPOINTMENT_APPROVED", title: "Approved", body: "Your visit is approved.", payload: {} });

    assert.equal(calls.length, 4);
    for (const call of calls) {
      const headers = new Headers(call.init.headers);
      const timestamp = headers.get("x-securevisit-timestamp");
      const payload = String(call.init.body);
      assert.match(timestamp || "", /^\d{10}$/);
      assert.equal(headers.get("x-securevisit-signature"), `sha256=${await expectedSignature(call.url.includes("payments") ? "payment-secret" : call.url.includes("notify") ? "notification-secret" : "visitor-secret", timestamp, payload)}`);
    }
    assert.equal(new Headers(calls[0].init.headers).get("idempotency-key"), "visitor-auth:challenge-1");
    assert.equal(new Headers(calls[1].init.headers).get("idempotency-key"), "payment-1");
    assert.equal(new Headers(calls[2].init.headers).get("idempotency-key"), "refund:payment-1");
    assert.equal(new Headers(calls[3].init.headers).get("idempotency-key"), "notification-1:email");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});

test("outbound providers reject unsafe endpoint configuration before sending data", async () => {
  const previous = { ...process.env };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  process.env.SECUREVISIT_ENVIRONMENT = "staging";
  process.env.VISITOR_EMAIL_DELIVERY = "webhook";
  process.env.VISITOR_SMS_DELIVERY = "webhook";
  process.env.VISITOR_AUTH_WEBHOOK_URL = "https://user:pass@auth.example.test/send";
  process.env.VISITOR_AUTH_WEBHOOK_SECRET = "visitor-secret";
  process.env.PAYMENT_PROVIDER = "webhook";
  process.env.PAYMENT_CHECKOUT_URL = "http://payments.example.test/checkout";
  process.env.PAYMENT_REFUND_URL = "https://payments.example.test/refund#unsafe";
  process.env.PAYMENT_PROVIDER_SECRET = "payment-secret";
  process.env.NOTIFICATION_WEBHOOK_URL = "https://notify.example.test/send#unsafe";
  process.env.NOTIFICATION_WEBHOOK_SECRET = "notification-secret";
  globalThis.fetch = async () => { calls += 1; return new Response("unexpected", { status: 500 }); };
  try {
    await assert.rejects(() => deliverVisitorChallenge({ channel: "EMAIL", challengeId: "challenge-unsafe", destination: "visitor@example.test", code: "123456", expiresAt: "2026-09-24T12:00:00.000Z" }), /VISITOR_AUTH_DELIVERY_NOT_CONFIGURED/);
    assert.equal(await getPaymentProvider(), null);
    await assert.rejects(() => deliverNotification({ notificationId: "notification-unsafe", email: "visitor@example.test", phone: null, template: "TEST", title: "Test", body: "Test", payload: {} }), /NOTIFICATION_DELIVERY_NOT_CONFIGURED/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});

test("direct visitor auth adapters send email through Resend and SMS through Twilio", async () => {
  const previous = { ...process.env };
  const originalFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, {
    SECUREVISIT_ENVIRONMENT: "staging",
    VISITOR_AUTH_DELIVERY: "",
    VISITOR_EMAIL_DELIVERY: "resend",
    VISITOR_SMS_DELIVERY: "twilio",
    RESEND_API_KEY: "re_test_key",
    VISITOR_EMAIL_FROM: "SecureVisit <no-reply@example.test>",
    VISITOR_SMS_TWILIO_ACCOUNT_SID: "AC1234567890",
    VISITOR_SMS_TWILIO_AUTH_TOKEN: "t".repeat(32),
    VISITOR_SMS_TWILIO_FROM: "+15005550006",
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(String(url).includes("twilio") ? { sid: "SM-provider-message-1" } : { id: "provider-message-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    assert.deepEqual(await deliverVisitorChallenge({ channel: "EMAIL", challengeId: "resend-challenge", destination: "visitor@example.test", code: "123456", expiresAt: "2026-09-24T12:00:00.000Z" }), { providerReference: "provider-message-1" });
    assert.deepEqual(await deliverVisitorChallenge({ channel: "SMS", challengeId: "twilio-challenge", destination: "+6281234567890", code: "654321", expiresAt: "2026-09-24T12:00:00.000Z" }), { providerReference: "SM-provider-message-1" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(new Headers(calls[0].init.headers).get("idempotency-key"), "securevisit-auth:resend-challenge");
    assert.match(String(calls[0].init.body), /123456/);
    assert.match(new Headers(calls[0].init.headers).get("authorization") || "", /^Bearer /);
    assert.match(calls[1].url, /api\.twilio\.com\/2010-04-01\/Accounts\/AC1234567890\/Messages\.json$/);
    assert.equal(new Headers(calls[1].init.headers).get("idempotency-key"), "securevisit-auth:twilio-challenge");
    assert.match(new Headers(calls[1].init.headers).get("authorization") || "", /^Basic /);
    assert.match(String(calls[1].init.body), /To=%2B6281234567890/);
    assert.match(String(calls[1].init.body), /654321/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});

test("notification delivery can use the same verified direct email and SMS adapters", async () => {
  const previous = { ...process.env };
  const originalFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, {
    SECUREVISIT_ENVIRONMENT: "staging",
    NOTIFICATION_DELIVERY: "",
    NOTIFICATION_EMAIL_DELIVERY: "resend",
    NOTIFICATION_SMS_DELIVERY: "twilio",
    RESEND_API_KEY: "re_test_key",
    VISITOR_EMAIL_FROM: "SecureVisit <no-reply@example.test>",
    VISITOR_SMS_TWILIO_ACCOUNT_SID: "AC1234567890",
    VISITOR_SMS_TWILIO_AUTH_TOKEN: "t".repeat(32),
    VISITOR_SMS_TWILIO_FROM: "+15005550006",
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(String(url).includes("api.twilio.com") ? { sid: "SMprovider-message-1" } : { id: "provider-message-1" }), { status: 200 });
  };
  try {
    await deliverNotification({ notificationId: "notification-email", email: "visitor@example.test", phone: null, template: "APPOINTMENT_APPROVED", title: "Visit approved", body: "Your visit is approved.", payload: {} });
    await deliverNotification({ notificationId: "notification-sms", email: null, phone: "+6281234567890", template: "VISIT_REMINDER", title: "Visit reminder", body: "Your visit starts soon.", payload: {} });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(new Headers(calls[0].init.headers).get("idempotency-key"), "notification-email:email");
    assert.equal(calls[1].url.includes("api.twilio.com"), true);
    assert.equal(new Headers(calls[1].init.headers).get("idempotency-key"), "notification-sms:sms");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});

test("notification delivery rejects an explicitly unsupported adapter", async () => {
  const previous = { ...process.env };
  Object.assign(process.env, { SECUREVISIT_ENVIRONMENT: "staging", NOTIFICATION_DELIVERY: "unsupported-provider" });
  try {
    await assert.rejects(() => deliverNotification({ notificationId: "notification-invalid", email: "visitor@example.test", phone: null, template: "TEST", title: "Test", body: "Test", payload: {} }), /NOTIFICATION_DELIVERY_INVALID/);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});
