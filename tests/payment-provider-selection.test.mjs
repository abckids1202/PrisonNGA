import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("new payment intents persist the selected provider adapter identity", async () => {
  const source = await readFile(new URL("../app/api/visitor/payments/route.ts", import.meta.url), "utf8");
  assert.ok(source.includes("VALUES (?, ?, ?, ?, ?, ?, 'IDR', 'PENDING'"));
  assert.ok(source.includes("visitor.userId, provider.name, creditQuantity"));
});
