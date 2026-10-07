import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const routes = [
  "../app/api/auth/staff/oidc/start/route.ts",
  "../app/api/auth/staff/oidc/callback/route.ts",
  "../app/api/auth/staff/saml/start/route.ts",
  "../app/api/auth/staff/saml/callback/route.ts",
];

test("staff federation start and callback routes have independent IP rate limits", async () => {
  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(source, /import \{ enforceRateLimit \}/);
    assert.match(source, /enforceRateLimit\(d1, \{ key: `staff-federation:/);
    assert.match(source, /context\.ipAddress \|\| "unknown"/);
    assert.match(source, /windowSeconds: 15 \* 60/);
  }
});
