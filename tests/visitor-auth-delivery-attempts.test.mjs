import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor OTP requests persist delivery attempts without storing the code", async () => {
  const route = await readFile(new URL("../app/api/auth/visitor/request/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0037_auth_challenge_delivery_attempts.sql", import.meta.url), "utf8");
  assert.match(route, /auth_challenge_delivery_attempts/);
  assert.match(route, /status = 'SENT'/);
  assert.match(route, /status = 'FAILED'/);
  assert.match(route, /AUTH_DELIVERY_UNAVAILABLE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_challenge_delivery_attempts/);
  assert.doesNotMatch(migration, /\bcode_hash\b|\bdestination\b/i);
});
