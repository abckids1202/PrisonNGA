import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/visitor/page.tsx", import.meta.url), "utf8");

test("visitor credits refreshes delayed payment state without deciding settlement in the browser", () => {
  assert.match(source, /\[\"PENDING\", \"CHECKOUT_CREATED\"\]\.includes\(payment\.status\)/);
  assert.match(source, /paymentPolls\.current >= 6/);
  assert.match(source, /setRefreshTick\(\(value\) => value \+ 1\)/);
  assert.match(source, /Credits are added only after its signed confirmation/);
});

test("visitor credits does not infer checkout availability from pricing alone", () => {
  assert.match(source, /setPaymentProviderAvailable\(paymentBody\.checkoutAvailable === true\)/);
  assert.doesNotMatch(source, /setPaymentProviderAvailable\(paymentBody\.checkoutAvailable === true \|\| Boolean\(paymentBody\.pricing\)\)/);
});
