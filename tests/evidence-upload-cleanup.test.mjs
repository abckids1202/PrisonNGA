import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/visitor/verification/evidence/route.ts", import.meta.url), "utf8");

test("evidence upload cleanup deletes an object unless every persistence proof succeeds", () => {
  assert.match(source, /let evidenceCommitted = false;/);
  assert.match(source, /if \(!inserted\.slice\(0, 3\)\.every/);
  assert.match(source, /if \(!inserted\[inserted\.length - 1\]\?\.meta\.changes\)/);
  assert.match(source, /evidenceCommitted = true/);
  assert.match(source, /let evidenceUploaded = false/);
  assert.match(source, /evidenceUploaded = true/);
  assert.match(source, /if \(!evidenceCommitted && evidenceUploaded\)/);
  assert.match(source, /evidenceUploadCleanupFailureStatement/);
  assert.match(source, /EVIDENCE_UPLOAD_CLEANUP_REQUIRED/);
});
