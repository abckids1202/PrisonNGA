import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor profile never invents phone verification and preserves authoritative SMS verification", async () => {
  const security = await readFile(new URL("../lib/server/security.ts", import.meta.url), "utf8");
  const profile = await readFile(new URL("../app/api/visitor/profile/route.ts", import.meta.url), "utf8");
  assert.match(security, /phoneVerifiedAt: users\.phoneVerifiedAt/);
  assert.match(security, /phoneVerifiedAt: sessionUser\.phoneVerifiedAt/);
  assert.match(profile, /phoneVerifiedAt: visitor\.phoneVerifiedAt/);
  assert.match(profile, /visitor\.phone === phone \? visitor\.phoneVerifiedAt/);
  assert.doesNotMatch(profile, /phone \? new Date\(\)\.toISOString\(\) : null/);
});
