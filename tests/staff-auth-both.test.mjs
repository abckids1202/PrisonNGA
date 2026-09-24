import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvironment } from "../lib/server/config.ts";

const base = {
  DB: {},
  SECUREVISIT_ENVIRONMENT: "staging",
  STAFF_AUTH_PROVIDER: "both",
  STAFF_STEP_UP_SECRET: "x".repeat(32),
  SECUREVISIT_HASH_SALT: "y".repeat(32),
  VISITOR_AUTH_DELIVERY: "webhook",
  VISITOR_AUTH_WEBHOOK_URL: "https://auth.example.test",
  VISITOR_AUTH_WEBHOOK_SECRET: "visitor-secret",
  VIDEO_PROVIDER: "livekit",
  LIVEKIT_URL: "wss://securevisit.livekit.cloud",
  LIVEKIT_API_KEY: "key",
  LIVEKIT_API_SECRET: "secret",
  EVIDENCE_BUCKET: {},
  EVIDENCE_SCAN_PROVIDER: "webhook",
  EVIDENCE_SCAN_WEBHOOK_URL: "https://scan.example.test",
  EVIDENCE_SCAN_WEBHOOK_SECRET: "scan-secret",
  PAYMENT_PROVIDER: "webhook",
  VISIT_CREDIT_PRICE_MINOR: "100000",
  PAYMENT_CHECKOUT_URL: "https://payments.example.test/checkout",
  PAYMENT_REFUND_URL: "https://payments.example.test/refund",
  PAYMENT_PROVIDER_SECRET: "payment-secret",
  PAYMENT_WEBHOOK_SECRET: "webhook-secret",
  NOTIFICATION_DELIVERY: "webhook",
  NOTIFICATION_WEBHOOK_URL: "https://notify.example.test",
  NOTIFICATION_WEBHOOK_SECRET: "notify-secret",
  STAFF_OIDC_ISSUER: "https://oidc.example.test",
  STAFF_OIDC_CLIENT_ID: "securevisit",
  STAFF_OIDC_CLIENT_SECRET: "oidc-secret",
  STAFF_OIDC_REDIRECT_URI: "https://securevisit.example.test/api/auth/staff/oidc/callback",
  STAFF_OIDC_MFA_ACR: "urn:mfa",
  STAFF_SAML_ENTITY_ID: "https://securevisit.example.test/saml",
  STAFF_SAML_METADATA_URL: "https://saml.example.test/metadata",
  STAFF_SAML_ENTRY_POINT: "https://saml.example.test/login",
  STAFF_SAML_IDP_CERT: "certificate",
  STAFF_SAML_CALLBACK_URI: "https://securevisit.example.test/api/auth/staff/saml/callback",
  STAFF_SAML_MFA_ACR: "urn:mfa",
};

test("both staff federation providers are required when configured", () => {
  const ready = validateEnvironment(base);
  assert.equal(ready.ok, true);
  const missingSaml = validateEnvironment({ ...base, STAFF_SAML_IDP_CERT: "" });
  assert.ok(missingSaml.missing.includes("STAFF_SAML_IDP_CERT"));
  const missingOidc = validateEnvironment({ ...base, STAFF_OIDC_CLIENT_SECRET: "" });
  assert.ok(missingOidc.missing.includes("STAFF_OIDC_CLIENT_SECRET"));
});
