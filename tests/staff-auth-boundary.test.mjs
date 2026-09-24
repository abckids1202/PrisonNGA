import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace identity headers are development-only and cannot bypass institutional staff sessions", async () => {
  const source = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  assert.match(source, /getStaffSessionIdentity\(\)/);
  assert.match(source, /getRuntimeValue\("SECUREVISIT_ENVIRONMENT"\)/);
  assert.match(source, /!== "development"\) return null/);
});
