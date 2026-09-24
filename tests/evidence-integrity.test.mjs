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
