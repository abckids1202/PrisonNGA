import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvironment } from "../lib/server/config.ts";

const withDatabase = { DB: {} };

test("missing and unsupported deployment modes fail closed", () => {
  for (const mode of [undefined, "prod", "Production", "preview"]) {
    const environment = { ...withDatabase };
    if (mode !== undefined) environment.SECUREVISIT_ENVIRONMENT = mode;
    const result = validateEnvironment(environment);
    assert.equal(result.environment, "invalid");
    assert.equal(result.ok, false);
    assert.ok(result.missing.some((item) => item.startsWith("SECUREVISIT_ENVIRONMENT")));
  }
});

test("only explicitly configured development gets development-only defaults", () => {
  const result = validateEnvironment({ ...withDatabase, SECUREVISIT_ENVIRONMENT: "development" });
  assert.equal(result.environment, "development");
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes("SECUREVISIT_HASH_SALT uses the development fallback"));
});

test("staging and production fail closed until every required provider is configured", () => {
  for (const mode of ["staging", "production"]) {
    const result = validateEnvironment({ ...withDatabase, SECUREVISIT_ENVIRONMENT: mode });
    assert.equal(result.environment, mode);
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes("VISITOR_AUTH_DELIVERY=webhook"));
    assert.ok(result.missing.includes("PAYMENT_PROVIDER=webhook"));
  }
});

test("institutional OIDC configuration requires a confidential client secret", () => {
  const base = {
    ...withDatabase,
    SECUREVISIT_ENVIRONMENT: "staging",
    STAFF_AUTH_PROVIDER: "oidc",
    STAFF_OIDC_ISSUER: "https://idp.example.test",
    STAFF_OIDC_CLIENT_ID: "securevisit-control",
    STAFF_OIDC_REDIRECT_URI: "https://securevisit.example.test/api/auth/staff/oidc/callback",
  };
  const withoutSecret = validateEnvironment(base);
  assert.ok(withoutSecret.missing.includes("STAFF_OIDC_CLIENT_SECRET"));
  const withSecret = validateEnvironment({ ...base, STAFF_OIDC_CLIENT_SECRET: "client-secret" });
  assert.ok(!withSecret.missing.includes("STAFF_OIDC_CLIENT_SECRET"));
});
