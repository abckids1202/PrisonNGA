import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/control/audit/export/route.ts", import.meta.url), "utf8");

test("audit export commits its manifest and audit/outbox evidence in one D1 batch", () => {
  assert.match(source, /auditAndOutboxStatements/);
  assert.match(source, /const results = await d1\.batch\(\[/);
  assert.match(source, /INSERT INTO audit_export_manifests/);
  assert.match(source, /AUDIT_EXPORT_COMMIT_FAILED/);
  assert.match(source, /EXISTS \(SELECT 1 FROM audit_export_manifests/);
});
