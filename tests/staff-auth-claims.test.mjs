import assert from "node:assert/strict";
import test from "node:test";
import { hasVerifiedStaffEmail } from "../lib/server/auth/oidc.ts";

test("staff OIDC account matching requires a verified email claim", () => {
  assert.equal(hasVerifiedStaffEmail({ email: "staff@example.test", email_verified: true }), true);
  assert.equal(hasVerifiedStaffEmail({ email: "staff@example.test", email_verified: false }), false);
  assert.equal(hasVerifiedStaffEmail({ email: "staff@example.test" }), false);
  assert.equal(hasVerifiedStaffEmail({ email: "  ", email_verified: true }), false);
  assert.equal(hasVerifiedStaffEmail({ email_verified: true }), false);
});
