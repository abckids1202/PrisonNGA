import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("kiosk credential rotation keeps resource, credential, audit, and outbox writes in one batch", async () => {
  const source = await readFile(new URL("../app/api/control/resources/route.ts", import.meta.url), "utf8");
  assert.match(source, /issue_kiosk_credential/);
  assert.match(source, /revoke_kiosk_credential/);
  assert.match(source, /const results = await d1\.batch\(\[/);
  assert.match(source, /KIOSK_CREDENTIAL_ISSUED/);
  assert.match(source, /KIOSK_CREDENTIAL_REVOKED/);
  assert.match(source, /auditAndOutboxStatements\(d1/);
  assert.match(source, /version = version \+ 1/);
  assert.match(source, /INSERT INTO kiosk_credentials/);
  assert.match(source, /kiosk-credential:\$\{authorization\.facilityId\}:\$\{current\.id\}/);
  assert.match(source, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(source, /completeIdempotencyStatement\(d1/);
  assert.match(source, /credentialStatus: "ACTIVE", version/);
  assert.match(source, /credentialStatus: "REVOKED", version/);
});

test("kiosk credential UI sends idempotency keys and explains sanitized retries", async () => {
  const source = await readFile(new URL("../app/components/KioskCredentialManager.tsx", import.meta.url), "utf8");
  assert.match(source, /"Idempotency-Key": `kiosk-credential-/);
  assert.match(source, /one-time secret was not returned again/);
  assert.match(source, /Start a new rotation if the secret was lost/);
});
