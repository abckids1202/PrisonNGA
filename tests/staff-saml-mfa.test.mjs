import assert from "node:assert/strict";
import test from "node:test";
import { hasRequiredSamlMfa } from "../lib/server/auth/saml.ts";

function profile(context) {
  return { getAssertion: () => ({ Assertion: [{ AuthnStatement: [{ AuthnContext: [{ AuthnContextClassRef: [{ _: context }] }] }] }] }) };
}

test("SAML staff MFA requires the configured authentication context from the signed assertion", () => {
  assert.equal(hasRequiredSamlMfa(profile("urn:securevisit:mfa"), "urn:securevisit:mfa"), true);
  assert.equal(hasRequiredSamlMfa(profile("urn:securevisit:password"), "urn:securevisit:mfa"), false);
});
