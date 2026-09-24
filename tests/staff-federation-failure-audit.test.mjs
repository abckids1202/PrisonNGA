import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const routes = {
  oidc: fs.readFileSync("app/api/auth/staff/oidc/callback/route.ts", "utf8"),
  saml: fs.readFileSync("app/api/auth/staff/saml/callback/route.ts", "utf8"),
};

test("staff federation callback failures are audited without sensitive payloads", () => {
  for (const [provider, source] of Object.entries(routes)) {
    const upper = provider.toUpperCase();
    assert.match(source, /INSERT INTO security_events/);
    assert.match(source, new RegExp(`STAFF_${upper}_LOGIN_FAILED`));
    assert.match(source, /hashIdentifier\(/);
    assert.match(source, new RegExp(`provider: "${upper}"`));
    assert.match(source, /errorCode/);
    assert.match(source, /catch \{/);
    assert.doesNotMatch(source, /JSON\.stringify\(\{[^}]*\b(?:code|samlResponse|assertion|token)\b/);
  }
});
