import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("provider adapters use bounded response parsing", async () => {
  const [payments, scanner] = await Promise.all([
    readFile(new URL("../lib/server/payments/provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/evidence-scanner.ts", import.meta.url), "utf8"),
  ]);
  assert.match(payments, /readBoundedResponseText\(response\)/);
  assert.doesNotMatch(payments, /response\.json\(\)/);
  assert.match(scanner, /readBoundedResponseText\(response\)/);
  assert.doesNotMatch(scanner, /response\.json\(\)/);
});
