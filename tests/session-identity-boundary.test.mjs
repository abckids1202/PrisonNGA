import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/api/auth/sessions/route.ts", "utf8");

test("workspace session management resolves only active staff users", () => {
  assert.match(source, /eq\(users\.externalId, identity\.externalId\), eq\(users\.userType, "STAFF"\), eq\(users\.status, "ACTIVE"\)/);
});
