import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff evidence retrieval verifies the persisted digest before serving storage content", async () => {
  const source = await readFile(new URL("../app/api/control/verification/evidence/[documentId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /ed\.sha256/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(source, /EVIDENCE_INTEGRITY_CHECK_FAILED/);
  assert.match(source, /new Response\(bytes/);
});

test("visitor evidence only preserves the object after every persistence proof succeeds", async () => {
  const source = await readFile(new URL("../app/api/visitor/verification/evidence/route.ts", import.meta.url), "utf8");
  assert.match(source, /let evidenceCommitted = false/);
  assert.match(source, /if \(!inserted\.slice\(0, 3\)\.every/);
  assert.match(source, /if \(!inserted\[inserted\.length - 1\]\?\.meta\.changes\)/);
  assert.match(source, /evidenceCommitted = true/);
  assert.match(source, /if \(!evidenceCommitted\) await bucket\.delete\(storageKey\)/);
  assert.ok(source.lastIndexOf("evidenceCommitted = true") < source.lastIndexOf("idempotency = null;"));
});
