import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("lib/server/security.ts", "utf8");

test("central staff permission checks require a STAFF user type", () => {
  assert.match(source, /eq\(users\.externalId, identity\.externalId\), eq\(users\.userType, "STAFF"\)/);
});
