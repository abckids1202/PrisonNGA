import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("federated identity rebinding is conditional and fails on a concurrent conflict", async () => {
  const [oidc, saml] = await Promise.all([
    readFile(new URL("../app/api/auth/staff/oidc/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/staff/saml/callback/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [oidc, saml]) {
    assert.match(source, /external_id IS NULL OR external_id = \?/);
    assert.match(source, /if \(!sessionResults\[0\]\?\.meta\.changes\) throw new SecurityError\("STAFF_IDENTITY_BINDING_CONFLICT"/);
    assert.match(source, /INSERT INTO auth_sessions[\s\S]*external_id = \?/);
    assert.match(source, /INSERT INTO security_events[\s\S]*external_id = \?/);
  }
});
