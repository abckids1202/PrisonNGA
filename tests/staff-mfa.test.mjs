import assert from "node:assert/strict";
import test from "node:test";
import { hasRequiredStaffMfa } from "../lib/server/auth/oidc.ts";

test("OIDC staff MFA requires the configured acr and/or amr claim", () => {
  assert.equal(hasRequiredStaffMfa({ acr: "urn:securevisit:mfa", amr: ["pwd", "mfa"] }, { acr: null, amr: ["mfa"] }), true);
  assert.equal(hasRequiredStaffMfa({ acr: "urn:securevisit:password", amr: ["pwd"] }, { acr: null, amr: ["mfa"] }), false);
  assert.equal(hasRequiredStaffMfa({ acr: "urn:securevisit:mfa", amr: ["mfa"] }, { acr: "urn:securevisit:mfa", amr: [] }), true);
  assert.equal(hasRequiredStaffMfa({ acr: "urn:securevisit:mfa", amr: ["mfa"] }, { acr: "urn:other", amr: ["mfa"] }), false);
});
