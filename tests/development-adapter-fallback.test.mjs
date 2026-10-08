import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("payment local fallback is explicit-development-only", async () => {
  const source = await readFile(new URL("../lib/server/payments/provider.ts", import.meta.url), "utf8");
  assert.match(source, /environment === "development"\) return new LocalDevelopmentPaymentProvider/);
  assert.match(source, /environment === "development" \? new LocalDevelopmentPaymentProvider\(\) : null/);
  assert.doesNotMatch(source, /environment === "development" \|\| environment === null/);
});

test("evidence storage local fallback is explicit-development-only", async () => {
  const source = await readFile(new URL("../lib/server/evidence-storage.ts", import.meta.url), "utf8");
  assert.match(source, /!bucket && environment === "development"/);
  assert.doesNotMatch(source, /environment === "development" \|\| environment === null/);
});

