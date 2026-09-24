import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor verification keeps account and session creation in one guarded batch", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/auth/visitor/verify/route.ts", import.meta.url), "utf8");
  assert.match(source, /await d1\.batch\(\[/);
  assert.match(source, /UPDATE auth_challenges SET consumed_at/);
  assert.match(source, /INSERT INTO auth_sessions/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM users WHERE \$\{contactColumn\} = \? AND user_type <> 'VISITOR'\)/);
  assert.match(source, /users\.status = 'ACTIVE'/);
});

test("visitor authentication supports both email and SMS challenge channels", async () => {
  const requestSource = await (await import("node:fs/promises")).readFile(new URL("../app/api/auth/visitor/request/route.ts", import.meta.url), "utf8");
  const deliverySource = await (await import("node:fs/promises")).readFile(new URL("../lib/server/visitor-auth/delivery.ts", import.meta.url), "utf8");
  assert.match(requestSource, /channel === "EMAIL"/);
  assert.match(requestSource, /VALID_PHONE_REQUIRED/);
  assert.match(requestSource, /\+\[1-9\]\\d\{7,14\}/);
  assert.match(deliverySource, /channel: "EMAIL" \| "SMS"/);
});

test("visitor authentication enforces the advertised persisted OTP resend cooldown", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/auth/visitor/request/route.ts", import.meta.url), "utf8");
  assert.match(source, /INSERT INTO auth_challenges[\s\S]*WHERE NOT EXISTS/);
  assert.match(source, /julianday\(created_at\) > julianday\('now', '-60 seconds'\)/);
  assert.match(source, /purpose = 'VISITOR_SIGN_IN'/);
  assert.match(source, /AUTH_RETRY_TOO_SOON/);
});

test("visitor authentication atomically audits login and caps failed-code increments", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/auth/visitor/verify/route.ts", import.meta.url), "utf8");
  assert.match(source, /attempt_count = attempt_count \+ 1 WHERE id = \? AND consumed_at IS NULL/);
  assert.match(source, /attempt_count < max_attempts/);
  assert.match(source, /INSERT INTO security_events/);
  assert.match(source, /VISITOR_LOGIN_CHALLENGE_FAILED/);
  assert.match(source, /ip_hash/);
  assert.match(source, /'VISITOR_LOGIN'/);
  assert.match(source, /if \(!results\[3\]\?\.meta\.changes\)/);
});

test("visitor verification records a privacy-safe new-device security event", async () => {
  const source = await readFile(new URL("../app/api/auth/visitor/verify/route.ts", import.meta.url), "utf8");
  assert.match(source, /knownDevice/);
  assert.match(source, /created_at >= datetime\('now', '-30 days'\)/);
  assert.match(source, /VISITOR_SUSPICIOUS_LOGIN/);
  assert.match(source, /reason: "NEW_DEVICE"/);
  assert.doesNotMatch(source, /challenge\.destination.*VISITOR_SUSPICIOUS_LOGIN/);
});

test("session revocation commits the auth mutation and audit event as one D1 batch", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/auth/sessions/route.ts", import.meta.url), "utf8");
  assert.match(source, /d1 = await getD1\(\)/);
  assert.match(source, /await d1\.batch\(\[/);
  assert.match(source, /UPDATE auth_sessions SET revoked_at/);
  assert.match(source, /INSERT INTO security_events/);
  assert.match(source, /WHERE EXISTS \(SELECT 1 FROM auth_sessions/);
  assert.match(source, /SESSION_NOT_FOUND/);
});

test("session revocation requires idempotency and stores a replay response", async () => {
  const source = await readFile(new URL("../app/api/auth/sessions/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(d1/);
  assert.match(source, /completeIdempotencyStatement\(d1/);
  assert.match(source, /releaseIdempotencyClaim/);
});
