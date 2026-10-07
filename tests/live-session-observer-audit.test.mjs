import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("observer token issuance fails closed when monitoring audit writes are not committed", async () => {
  const source = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/observer-token/route.ts", import.meta.url), "utf8");
  assert.match(source, /const auditResults = await d1\.batch/);
  assert.match(source, /auditResults\[0\]\?\.meta\.changes/);
  assert.match(source, /auditResults\[1\]\?\.meta\.changes/);
  assert.match(source, /SESSION_MONITORING_AUDIT_FAILED/);
});
