import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("delivery status webhook is signed, replay-safe, and updates both notification and OTP delivery records", async () => {
  const route = await readFile(new URL("../app/api/webhooks/notifications/status/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0051_delivery_status_webhooks.sql", import.meta.url), "utf8");
  assert.match(route, /NOTIFICATION_STATUS_WEBHOOK_SECRET/);
  assert.match(route, /verifyPaymentWebhookSignature/);
  assert.match(route, /notification_provider_events/);
  assert.match(route, /INSERT OR IGNORE/);
  assert.match(route, /provider_reference/);
  assert.match(route, /nda\.provider = \?/);
  assert.match(route, /UPDATE notifications SET status = \?/);
  assert.match(route, /BOUNCED/);
  assert.match(route, /auth_challenge_delivery_attempts/);
  assert.match(route, /UPDATE auth_challenges SET expires_at/);
  assert.match(route, /consumed_at IS NULL/);
  assert.match(route, /auditAndOutboxStatements/);
  assert.match(migration, /provider_status/);
  assert.match(migration, /provider_error/);
  assert.match(migration, /notification_provider_events/);
});

test("external notification status webhooks bypass browser CSRF checks only at the exact callback path", async () => {
  const csrf = await readFile(new URL("../lib/server/csrf.ts", import.meta.url), "utf8");
  assert.match(csrf, /\/api\/webhooks\/notifications\/status/);
  assert.match(csrf, /FEDERATION_CALLBACKS/);
});
