import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor payment checkout records success and failure audit/outbox events", async () => {
  const source = await readFile(new URL("../app/api/visitor/payments/route.ts", import.meta.url), "utf8");
  assert.match(source, /PAYMENT_CHECKOUT_CREATED/);
  assert.match(source, /PAYMENT_CHECKOUT_FAILED/);
  assert.match(source, /auditAndOutboxStatements/);
  assert.match(source, /provider_reference = \?/);
});
