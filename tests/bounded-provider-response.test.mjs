import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("provider adapters use bounded response parsing", async () => {
  const [payments, scanner, messaging, visitorAuth, notifications] = await Promise.all([
    readFile(new URL("../lib/server/payments/provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/evidence-scanner.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/messaging/providers.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/visitor-auth/delivery.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/notifications/provider.ts", import.meta.url), "utf8"),
  ]);
  assert.match(payments, /readBoundedResponseText\(response\)/);
  assert.doesNotMatch(payments, /response\.json\(\)/);
  assert.match(scanner, /readBoundedResponseText\(response\)/);
  assert.doesNotMatch(scanner, /response\.json\(\)/);
  for (const provider of [messaging, visitorAuth, notifications]) {
    assert.match(provider, /readBoundedResponseText\(response\)/);
    assert.doesNotMatch(provider, /response\.json\(\)/);
  }
});
