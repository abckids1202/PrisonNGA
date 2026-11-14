import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scanEvidence } from "../lib/server/evidence-scanner.ts";

test("evidence scanning fails closed outside development and signs timestamped webhook requests", async () => {
  const source = await readFile(new URL("../lib/server/evidence-scanner.ts", import.meta.url), "utf8");
  assert.match(source, /EVIDENCE_SCAN_NOT_CONFIGURED/);
  assert.match(source, /environment === "development"/);
  assert.match(source, /x-securevisit-timestamp/);
  assert.match(source, /\$\{timestamp\}\.\$\{payload\}/);
  assert.match(source, /idempotency-key/);
  assert.match(source, /const environment = .*unknown/);
});

test("missing environment cannot enable the development evidence scanner", async () => {
  const previousEnvironment = process.env.SECUREVISIT_ENVIRONMENT;
  const previousProvider = process.env.EVIDENCE_SCAN_PROVIDER;
  try {
    delete process.env.SECUREVISIT_ENVIRONMENT;
    process.env.EVIDENCE_SCAN_PROVIDER = "development";
    await assert.rejects(() => scanEvidence({ bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf", sha256: "a".repeat(64), byteSize: 3 }), /EVIDENCE_SCAN_NOT_CONFIGURED/);
  } finally {
    if (previousEnvironment === undefined) delete process.env.SECUREVISIT_ENVIRONMENT; else process.env.SECUREVISIT_ENVIRONMENT = previousEnvironment;
    if (previousProvider === undefined) delete process.env.EVIDENCE_SCAN_PROVIDER; else process.env.EVIDENCE_SCAN_PROVIDER = previousProvider;
  }
});

test("malformed scanner responses fail with a stable scan error", async () => {
  const previous = { ...process.env };
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, { SECUREVISIT_ENVIRONMENT: "staging", EVIDENCE_SCAN_PROVIDER: "webhook", EVIDENCE_SCAN_WEBHOOK_URL: "https://scanner.example.test/scan", EVIDENCE_SCAN_WEBHOOK_SECRET: "scanner-secret" });
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    await assert.rejects(() => scanEvidence({ bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf", sha256: "b".repeat(64), byteSize: 3 }), /EVIDENCE_SCAN_INVALID_RESPONSE/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("staging and production require the configured evidence scanner adapter", async () => {
  const source = await readFile(new URL("../lib/server/config.ts", import.meta.url), "utf8");
  assert.match(source, /EVIDENCE_SCAN_PROVIDER=webhook/);
  assert.match(source, /EVIDENCE_SCAN_WEBHOOK_URL/);
  assert.match(source, /EVIDENCE_SCAN_WEBHOOK_SECRET/);
});

test("visitor evidence cannot become available before a clean scan", async () => {
  const source = await readFile(new URL("../app/api/visitor/verification/evidence/route.ts", import.meta.url), "utf8");
  assert.match(source, /await requestEvidenceScan\(/);
  assert.match(source, /EVIDENCE_MALWARE_DETECTED/);
  assert.match(source, /await bucket\.put\(storageKey/);
  assert.ok(source.indexOf("await requestEvidenceScan(") < source.indexOf("await bucket.put(storageKey"));
  assert.match(source, /"QUARANTINED"/);
  assert.match(source, /scan_status/);
});

test("scanner callbacks support an accepted reference without treating it as clean", async () => {
  const scanner = await readFile(new URL("../lib/server/evidence-scanner.ts", import.meta.url), "utf8");
  const callback = await readFile(new URL("../app/api/webhooks/evidence-scan/route.ts", import.meta.url), "utf8");
  assert.match(scanner, /result\.status === "accepted"/);
  assert.match(scanner, /verdict: "PENDING"/);
  assert.match(callback, /EVIDENCE_SCAN_SIGNATURE_INVALID/);
  assert.match(callback, /status = 'QUARANTINED'/);
  assert.match(callback, /nextStatus = callback\.verdict === "clean" \? "AVAILABLE"/);
});

test("scanner callbacks fail closed for disabled organizations", async () => {
  const callback = await readFile(new URL("../app/api/webhooks/evidence-scan/route.ts", import.meta.url), "utf8");
  assert.match(callback, /INNER JOIN facilities f ON f\.id = ed\.facility_id AND f\.organization_id = ed\.organization_id/);
  assert.match(callback, /INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/);
});
