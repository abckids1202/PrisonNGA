import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseVisitorProfileInput } from "../lib/server/visitor-profile.ts";

test("visitor profile and notification writes use scoped rate limits", async () => {
  const profileRoute = await readFile(new URL("../app/api/visitor/profile/route.ts", import.meta.url), "utf8");
  const notificationsRoute = await readFile(new URL("../app/api/visitor/notifications/route.ts", import.meta.url), "utf8");
  assert.match(profileRoute, /visitor-profile-update:\$\{visitor\.userId\}/);
  assert.match(notificationsRoute, /visitor-notification-update:\$\{visitor\.userId\}/);
  assert.match(notificationsRoute, /Idempotency-Key/);
  assert.match(notificationsRoute, /claimIdempotency\(database/);
  assert.match(notificationsRoute, /completeIdempotencyStatement\(database/);
  assert.match(notificationsRoute, /auditAndOutboxStatements/);
  assert.match(profileRoute, /enforceRateLimit/);
  assert.match(notificationsRoute, /enforceRateLimit/);
});

test("marking a visitor notification read preserves its delivery status", async () => {
  const route = await readFile(new URL("../app/api/visitor/notifications/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/visitor/page.tsx", import.meta.url), "utf8");
  assert.match(route, /UPDATE notifications SET read_at = COALESCE\(read_at, \?\)/);
  assert.doesNotMatch(route, /UPDATE notifications SET status = 'READ'/);
  assert.match(page, /unreadNotifications:.*!item\.read_at/);
  assert.match(page, /notification\.status === "FAILED" \? "Delivery issue/);
  assert.match(page, /notification\.status === "SENT" \? "Accepted for delivery/);
});

test("visitor profile updates are replay-safe and emit privacy-safe workflow events", async () => {
  const profileRoute = await readFile(new URL("../app/api/visitor/profile/route.ts", import.meta.url), "utf8");
  assert.match(profileRoute, /Idempotency-Key/);
  assert.match(profileRoute, /claimIdempotency\(d1/);
  assert.match(profileRoute, /completeIdempotencyStatement\(d1/);
  assert.match(profileRoute, /releaseIdempotencyClaim/);
  assert.match(profileRoute, /auditAndOutboxStatements/);
  assert.match(profileRoute, /VISITOR_PROFILE_UPDATED/);
  assert.match(profileRoute, /\[REDACTED\]/);
  assert.doesNotMatch(profileRoute, /payload: \{[^}]*phone[,}]/s);
});

test("visitor profile input is normalized for an active profile", () => {
  assert.deepEqual(parseVisitorProfileInput({ legalName: "  Siti Rahma  ", preferredName: " Siti ", phone: "+628123456789" }), {
    legalName: "Siti Rahma",
    preferredName: "Siti",
    phone: "+628123456789",
  });
});

test("visitor profile input rejects invalid names and non-E.164 phone numbers", () => {
  assert.throws(() => parseVisitorProfileInput({ legalName: "A", phone: "+628123456789" }), /LEGAL_NAME_INVALID/);
  assert.throws(() => parseVisitorProfileInput({ legalName: "Siti Rahma", phone: "08123456789" }), /PHONE_FORMAT_INVALID/);
  assert.throws(() => parseVisitorProfileInput({ legalName: "Siti Rahma", preferredName: "x".repeat(121) }), /PREFERRED_NAME_INVALID/);
});

test("visitor phone verification binds the challenge to the visitor and persists verified contact state", async () => {
  const route = await readFile(new URL("../app/api/visitor/profile/phone-verification/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0048_contact_verification_owner.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN `user_id` text REFERENCES `users`\(`id`\)/);
  assert.match(route, /requireVisitorIdentity/);
  assert.match(route, /purpose = 'CONTACT_VERIFICATION'/);
  assert.match(route, /user_id = \?/);
  assert.match(route, /visitor-contact-verification:\$\{visitor\.userId\}:\$\{code\}/);
  assert.match(route, /UPDATE users SET phone = \?, phone_verified_at = \?/);
  assert.doesNotMatch(route, /phone IS NULL OR phone =/);
  assert.match(route, /SELECT id FROM users WHERE phone = \? AND id <> \? LIMIT 1/);
  assert.match(route, /UPDATE visitor_profiles SET phone = \?, phone_verified_at = \?/);
  assert.match(route, /VISITOR_PHONE_VERIFIED/);
  assert.match(route, /auditAndOutboxStatements/);
  assert.doesNotMatch(route, /console\.log|console\.error/);
});

test("visitor account clears phone verification as soon as the entered number changes", async () => {
  const source = await readFile(new URL("../app/visitor/page.tsx", import.meta.url), "utf8");
  assert.match(source, /setProfile\(\(current\) => current \? \{ \.\.\.current, phoneVerifiedAt: null \} : current\)/);
  assert.match(source, /setPhoneChallengeId\(""\)/);
});

test("visitor phone verification uses the provider-neutral SMS delivery boundary", async () => {
  const route = await readFile(new URL("../app/api/visitor/profile/phone-verification/route.ts", import.meta.url), "utf8");
  assert.match(route, /deliverVisitorChallenge\(\{ channel: "SMS"/);
  assert.match(route, /AUTH_DELIVERY_NOT_CONFIGURED/);
  assert.match(route, /AUTH_DELIVERY_UNAVAILABLE/);
  assert.match(route, /attempt_count < max_attempts/);
});
