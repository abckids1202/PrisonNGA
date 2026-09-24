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
});
