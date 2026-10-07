import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("federated identity binding occurs only after active staff authorization", async () => {
  const [oidc, saml] = await Promise.all([
    readFile(new URL("../app/api/auth/staff/oidc/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/staff/saml/callback/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [oidc, saml]) {
    const rejected = source.indexOf('STAFF_ACCOUNT_NOT_PROVISIONED');
    const binding = source.indexOf("status = 'ACTIVE'");
    assert.ok(rejected >= 0 && binding > rejected, "identity binding must follow the active-account check");
    assert.match(source, /AND status = 'ACTIVE'/);
  }
});
