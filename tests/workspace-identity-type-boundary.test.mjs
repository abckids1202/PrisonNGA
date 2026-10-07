import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("workspace identity endpoints resolve only staff records", () => {
  const me = fs.readFileSync("app/api/auth/me/route.ts", "utf8");
  const logout = fs.readFileSync("app/api/auth/logout/route.ts", "utf8");
  assert.match(me, /eq\(users\.externalId, identity\.externalId\), eq\(users\.userType, "STAFF"\)/);
  assert.match(logout, /eq\(users\.externalId, identity\.externalId\), eq\(users\.userType, "STAFF"\)/);
});
