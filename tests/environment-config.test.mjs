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

test("staging and production do not require a global credit price", () => {
  const result = validateEnvironment({ ...withDatabase, SECUREVISIT_ENVIRONMENT: "staging" });
  assert.equal(result.missing.includes("VISIT_CREDIT_PRICE_MINOR"), false);
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

test("staging and production require protected R2 evidence storage", () => {
  const base = { ...withDatabase, SECUREVISIT_ENVIRONMENT: "staging", EVIDENCE_STORAGE_PROVIDER: "local_test" };
  const result = validateEnvironment(base);
  assert.ok(result.missing.includes("EVIDENCE_STORAGE_PROVIDER=r2"));
  const configured = validateEnvironment({ ...base, EVIDENCE_STORAGE_PROVIDER: "r2" });
  assert.ok(!configured.missing.includes("EVIDENCE_STORAGE_PROVIDER=r2"));
});

test("staging and production reject weak webhook signing secrets", () => {
  const base = {
    ...withDatabase,
    SECUREVISIT_ENVIRONMENT: "staging",
    PUBLIC_APP_URL: "https://securevisit.example.test",
    SECUREVISIT_HASH_SALT: "x".repeat(32),
    STAFF_STEP_UP_SECRET: "y".repeat(32),
    VISITOR_AUTH_DELIVERY: "webhook",
    VISITOR_AUTH_WEBHOOK_URL: "https://auth.example.test/send",
    VISITOR_AUTH_WEBHOOK_SECRET: "short",
    VIDEO_PROVIDER: "livekit",
    LIVEKIT_URL: "wss://securevisit.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    EVIDENCE_STORAGE_PROVIDER: "r2",
    EVIDENCE_BUCKET: {},
    EVIDENCE_RETENTION_DAYS: "365",
    EVIDENCE_SCAN_PROVIDER: "webhook",
    EVIDENCE_SCAN_WEBHOOK_URL: "https://scan.example.test/scan",
    EVIDENCE_SCAN_WEBHOOK_SECRET: "short",
    PAYMENT_PROVIDER: "webhook",
    VISIT_CREDIT_PRICE_MINOR: "50000",
    PAYMENT_CHECKOUT_URL: "https://payments.example.test/checkout",
    PAYMENT_REFUND_URL: "https://payments.example.test/refund",
    PAYMENT_PROVIDER_SECRET: "provider-secret",
    PAYMENT_WEBHOOK_SECRET: "short",
    NOTIFICATION_DELIVERY: "webhook",
    NOTIFICATION_WEBHOOK_URL: "https://notify.example.test/send",
    NOTIFICATION_WEBHOOK_SECRET: "short",
  };
  const result = validateEnvironment(base);
  assert.ok(result.missing.includes("VISITOR_AUTH_WEBHOOK_SECRET (must be at least 32 characters)"));
  assert.ok(result.missing.includes("EVIDENCE_SCAN_WEBHOOK_SECRET (must be at least 32 characters)"));
  assert.ok(result.missing.includes("PAYMENT_WEBHOOK_SECRET (must be at least 32 characters)"));
  assert.ok(result.missing.includes("NOTIFICATION_WEBHOOK_SECRET (must be at least 32 characters)"));
});

test("staging and production reject weak LiveKit secrets and unsafe retention windows", () => {
  const result = validateEnvironment({
    ...withDatabase,
    SECUREVISIT_ENVIRONMENT: "staging",
    SECUREVISIT_HASH_SALT: "x".repeat(32),
    STAFF_STEP_UP_SECRET: "y".repeat(32),
    VIDEO_PROVIDER: "livekit",
    LIVEKIT_URL: "wss://securevisit.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "short",
    EVIDENCE_STORAGE_PROVIDER: "r2",
    EVIDENCE_BUCKET: {},
    EVIDENCE_RETENTION_DAYS: "0",
  });
  assert.ok(result.missing.includes("LIVEKIT_API_SECRET (must be at least 32 characters)"));
  assert.ok(result.missing.includes("EVIDENCE_RETENTION_DAYS (must be an integer from 1 to 3650)"));
});

test("production endpoints reject embedded credentials, fragments, and non-HTTPS URLs", () => {
  const base = {
    DB: {},
    SECUREVISIT_ENVIRONMENT: "staging",
    VISITOR_AUTH_DELIVERY: "webhook",
    VISITOR_AUTH_WEBHOOK_URL: "https://user:pass@auth.example.test/send",
    EVIDENCE_SCAN_PROVIDER: "webhook",
    EVIDENCE_SCAN_WEBHOOK_URL: "https://scan.example.test/scan#fragment",
    PAYMENT_PROVIDER: "webhook",
    PAYMENT_CHECKOUT_URL: "http://payments.example.test/checkout",
    PAYMENT_REFUND_URL: "https://payments.example.test/refund",
    NOTIFICATION_DELIVERY: "webhook",
    NOTIFICATION_WEBHOOK_URL: "https://notify.example.test/send",
    VIDEO_PROVIDER: "livekit",
    LIVEKIT_URL: "wss://securevisit.livekit.cloud",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "secret",
    EVIDENCE_STORAGE_PROVIDER: "r2",
    EVIDENCE_BUCKET: {},
    VISIT_CREDIT_PRICE_MINOR: "50000",
    SECUREVISIT_HASH_SALT: "x".repeat(32),
    STAFF_STEP_UP_SECRET: "y".repeat(32),
  };
  const result = validateEnvironment(base);
  assert.ok(result.missing.some((item) => item.startsWith("VISITOR_AUTH_WEBHOOK_URL")));
  assert.ok(result.missing.some((item) => item.startsWith("EVIDENCE_SCAN_WEBHOOK_URL")));
  assert.ok(result.missing.some((item) => item.startsWith("PAYMENT_CHECKOUT_URL")));
  assert.equal(result.missing.some((item) => item.startsWith("PAYMENT_REFUND_URL")), false);
  assert.equal(result.missing.some((item) => item.startsWith("NOTIFICATION_WEBHOOK_URL")), false);
});
