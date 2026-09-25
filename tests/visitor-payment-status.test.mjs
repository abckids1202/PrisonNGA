import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/visitor/payments/[paymentIntentId]/route.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../lib/server/payments/provider.ts", import.meta.url), "utf8");
const client = await readFile(new URL("../app/visitor/payment/[paymentIntentId]/PaymentStatusClient.tsx", import.meta.url), "utf8");

test("visitor payment status is owner-scoped and return handling remains webhook-authoritative", () => {
  assert.match(route, /pi\.user_id = \?/);
  assert.match(route, /PAYMENT_NOT_FOUND/);
  assert.match(route, /payment-status:\$\{visitor\.userId\}/);
  assert.match(route, /cle\.idempotency_key = 'payment:' \|\| pi\.id \|\| ':purchase'/);
  assert.match(provider, /successUrl\?: string; cancelUrl\?: string/);
  assert.match(client, /credit balance changes only after SecureVisit receives and verifies the provider confirmation/);
});
