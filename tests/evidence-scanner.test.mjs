import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("evidence scanning fails closed outside development and signs timestamped webhook requests", async () => {
  const source = await readFile(new URL("../lib/server/evidence-scanner.ts", import.meta.url), "utf8");
  assert.match(source, /EVIDENCE_SCAN_NOT_CONFIGURED/);
  assert.match(source, /environment === "development"/);
  assert.match(source, /x-securevisit-timestamp/);
  assert.match(source, /\$\{timestamp\}\.\$\{payload\}/);
  assert.match(source, /idempotency-key/);
});

test("staging and production require the configured evidence scanner adapter", async () => {
  const source = await readFile(new URL("../lib/server/config.ts", import.meta.url), "utf8");
  assert.match(source, /EVIDENCE_SCAN_PROVIDER=webhook/);
  assert.match(source, /EVIDENCE_SCAN_WEBHOOK_URL/);
  assert.match(source, /EVIDENCE_SCAN_WEBHOOK_SECRET/);
});

test("visitor evidence cannot become available before a clean scan", async () => {
  const source = await readFile(new URL("../app/api/visitor/verification/evidence/route.ts", import.meta.url), "utf8");
  assert.match(source, /await scanEvidence\(/);
  assert.match(source, /EVIDENCE_MALWARE_DETECTED/);
  assert.match(source, /await bucket\.put\(storageKey/);
  assert.ok(source.indexOf("await scanEvidence(") < source.indexOf("await bucket.put(storageKey"));
});
