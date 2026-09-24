import assert from "node:assert/strict";
import test from "node:test";
import { hasValidOidcClaimShape } from "../lib/server/auth/oidc.ts";

const valid = { iss: "https://idp.example.test", sub: "staff-1", aud: "securevisit-control", exp: Math.floor(Date.now() / 1000) + 300 };

test("OIDC claim validation requires a strict issuer, subject, audience, and expiry shape", () => {
  assert.equal(hasValidOidcClaimShape(valid), true);
  assert.equal(hasValidOidcClaimShape({ ...valid, aud: ["securevisit-control", "profile"] }), true);
  for (const malformed of [
    { ...valid, exp: undefined },
    { ...valid, exp: "future" },
    { ...valid, aud: [] },
    { ...valid, aud: ["securevisit-control", 42] },
    { ...valid, sub: "" },
    { ...valid, iss: "" },
  ]) assert.equal(hasValidOidcClaimShape(malformed), false);
});
