import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/api/auth/sessions/route.ts", "utf8");
const securitySource = fs.readFileSync("lib/server/security.ts", "utf8");

test("workspace session management resolves only active staff users", () => {
  assert.match(source, /eq\(users\.externalId, identity\.externalId\), eq\(users\.userType, "STAFF"\), eq\(users\.status, "ACTIVE"\)/);
});

test("session authorization normalizes SQLite and ISO timestamp formats", () => {
  assert.match(source, /julianday\(\$\{authSessions\.expiresAt\}\) > julianday\(\$\{new Date\(\)\.toISOString\(\)\}\)/);
  assert.match(securitySource, /julianday\(\$\{authSessions\.expiresAt\}\) > julianday\(\$\{new Date\(\)\.toISOString\(\)\}\)/g);
});

test("session activity touches are throttled without weakening authorization", () => {
  assert.match(securitySource, /SESSION_TOUCH_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(securitySource, /lastSeenAt: authSessions\.lastSeenAt/);
  assert.match(securitySource, /if \(shouldTouchSession\(sessionUser\.lastSeenAt\)\) await db\.update\(authSessions\)/);
  assert.match(securitySource, /function shouldTouchSession\(lastSeenAt: string \| null\)/);
  assert.match(securitySource, /Date\.parse\(lastSeenAt\)/);
});
