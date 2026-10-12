import assert from "node:assert/strict";
import test from "node:test";
import { getPaymentProvider } from "../lib/server/payments/provider.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  SECUREVISIT_ENVIRONMENT: process.env.SECUREVISIT_ENVIRONMENT,
  XENDIT_SECRET_KEY: process.env.XENDIT_SECRET_KEY,
  XENDIT_API_BASE_URL: process.env.XENDIT_API_BASE_URL,
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
}

test.afterEach(restoreEnvironment);

test("Xendit adapter creates a hosted payment session with a stable SecureVisit reference", async () => {
  process.env.PAYMENT_PROVIDER = "xendit";
  process.env.SECUREVISIT_ENVIRONMENT = "development";
  process.env.XENDIT_SECRET_KEY = "xnd_development_secret";
  process.env.XENDIT_API_BASE_URL = "https://api.xendit.example.test";
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ payment_session_id: "ps-session-123", payment_link_url: "https://checkout.xendit.test/sessions/ps-session-123" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const provider = await getPaymentProvider();
  assert.equal(provider?.name, "xendit");
  const result = await provider.createCheckout({
    paymentIntentId: "payment-intent-123",
    email: "visitor@example.test",
    phone: null,
    creditQuantity: 2,
    amountMinor: 100000,
    currency: "IDR",
    successUrl: "https://securevisit.example.test/visitor/payment/payment-intent-123?result=success",
    cancelUrl: "https://securevisit.example.test/visitor/payment/payment-intent-123?result=cancelled",
  });
  assert.equal(result.provider, "xendit");
  assert.equal(result.providerReference, "ps-session-123");
  assert.match(result.checkoutUrl, /^https:\/\//);
  assert.equal(request.url, "https://api.xendit.example.test/sessions");
  assert.equal(request.init.method, "POST");
  assert.match(request.init.headers.authorization, /^Basic /);
  const body = JSON.parse(request.init.body);
  assert.equal(body.reference_id, "payment-intent-123");
  assert.equal(body.session_type, "PAY");
  assert.equal(body.mode, "PAYMENT_LINK");
  assert.equal(body.country, "ID");
  assert.equal(body.amount, 100000);
});

test("Xendit refund resolves the payment request ID before requesting a refund", async () => {
  process.env.PAYMENT_PROVIDER = "xendit";
  process.env.SECUREVISIT_ENVIRONMENT = "development";
  process.env.XENDIT_SECRET_KEY = "xnd_development_secret";
  process.env.XENDIT_API_BASE_URL = "https://api.xendit.example.test";
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/sessions/ps-session-123")) return new Response(JSON.stringify({ payment_request_id: "pr-request-123" }), { status: 200 });
    return new Response(JSON.stringify({ id: "rfd-refund-123" }), { status: 200 });
  };
  const provider = await getPaymentProvider();
  const result = await provider.requestRefund({ paymentIntentId: "payment-intent-123", providerReference: "ps-session-123", amountMinor: 50000, currency: "IDR", reason: "visitor cancellation" });
  assert.deepEqual(result, { provider: "xendit", providerReference: "rfd-refund-123" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.method, "GET");
  const refundBody = JSON.parse(requests[1].init.body);
  assert.equal(refundBody.payment_request_id, "pr-request-123");
  assert.equal(refundBody.reference_id, "payment-intent-123");
  assert.equal(refundBody.reason, "CANCELLATION");
});
