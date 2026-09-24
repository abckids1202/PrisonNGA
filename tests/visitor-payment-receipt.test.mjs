import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor payment receipts are restricted to the authenticated visitor's settled purchase", async () => {
  const source = await readFile(new URL("../app/api/visitor/payments/[paymentIntentId]/receipt/route.ts", import.meta.url), "utf8");
  assert.match(source, /pi\.user_id = \?/);
  assert.match(source, /pi\.status = 'SUCCEEDED'/);
  assert.match(source, /cle\.entry_type = 'PURCHASE'/);
  assert.match(source, /PAYMENT_RECEIPT_NOT_FOUND/);
});
