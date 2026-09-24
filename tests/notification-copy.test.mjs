import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("outbox notification copy explains critical payment and visit outcomes", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /PAYMENT_CHECKOUT_CREATED/);
  assert.match(source, /PAYMENT_CHECKOUT_FAILED/);
  assert.match(source, /PAYMENT_STATUS_UPDATED/);
  assert.match(source, /VISIT_COMPLETED/);
  assert.match(source, /SESSION_TERMINATED/);
});
