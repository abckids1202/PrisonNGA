import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("OIDC and SAML callbacks fail closed when session audit persistence is not committed", async () => {
  const [oidc, saml] = await Promise.all([
    readFile(new URL("../app/api/auth/staff/oidc/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/staff/saml/callback/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [oidc, saml]) {
    assert.match(source, /const sessionResults = await d1\.batch/);
    assert.match(source, /sessionResults\[0\]\?\.meta\.changes/);
    assert.match(source, /sessionResults\[2\]\?\.meta\.changes/);
    assert.match(source, /STAFF_FEDERATION_AUDIT_FAILED/);
  }
});
