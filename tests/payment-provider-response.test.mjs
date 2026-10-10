import assert from "node:assert/strict";
import test from "node:test";
import { getPaymentProvider } from "../lib/server/payments/provider.ts";

async function withPaymentProvider(callback) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    SECUREVISIT_ENVIRONMENT: "staging",
    PAYMENT_PROVIDER: "webhook",
    PAYMENT_CHECKOUT_URL: "https://payments.example.test/checkout",
    PAYMENT_REFUND_URL: "https://payments.example.test/refund",
    PAYMENT_PROVIDER_SECRET: "payment-secret",
  });
  try { return await callback(); }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

test("malformed checkout JSON becomes a stable payment provider error", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    await withPaymentProvider(async () => {
      const provider = await getPaymentProvider();
      assert.ok(provider);
      await assert.rejects(() => provider.createCheckout({ paymentIntentId: "payment-malformed", email: "visitor@example.test", phone: null, creditQuantity: 1, amountMinor: 50000, currency: "IDR" }), /PAYMENT_CHECKOUT_INVALID_RESPONSE/);
    });
  } finally { globalThis.fetch = previousFetch; }
});

test("malformed refund JSON becomes a stable payment provider error", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    await withPaymentProvider(async () => {
      const provider = await getPaymentProvider();
      assert.ok(provider);
      await assert.rejects(() => provider.requestRefund({ paymentIntentId: "payment-malformed", providerReference: "provider-1", amountMinor: 50000, currency: "IDR", reason: "Facility cancellation." }), /PAYMENT_REFUND_INVALID_RESPONSE/);
    });
  } finally { globalThis.fetch = previousFetch; }
});
