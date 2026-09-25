import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public liveness keeps the probe lightweight and request-correlated", async () => {
  const source = await readFile(new URL("../app/api/health/live/route.ts", import.meta.url), "utf8");
  assert.match(source, /getRequestContext/);
  assert.match(source, /securityResponse\(\{ status: "ok" \}, 200, context\.requestId\)/);
  assert.doesNotMatch(source, /requirePermission|requireVisitorIdentity|getD1|getDb/);
});
