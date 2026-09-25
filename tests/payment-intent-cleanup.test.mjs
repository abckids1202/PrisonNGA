import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

test("scheduler expires only abandoned pre-checkout payment intents transactionally", () => {
  assert.match(worker, /async function expireAbandonedPaymentIntents/);
  assert.match(worker, /status = 'PENDING' AND julianday\(created_at\) <= julianday\('now', '-30 minutes'\)/);
  assert.match(worker, /status = 'EXPIRED'.*version = version \+ 1/s);
  assert.match(worker, /PAYMENT_EXPIRED/);
  assert.match(worker, /PAYMENT_STATUS_UPDATED/);
  assert.match(worker, /expireAbandonedPaymentIntents\(env\)/);
  assert.doesNotMatch(worker, /status = 'CHECKOUT_CREATED'.*created_at <= datetime\('now', '-30 minutes'\)/s);
});
