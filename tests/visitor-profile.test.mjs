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
