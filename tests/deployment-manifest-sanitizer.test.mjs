import assert from "node:assert/strict";
import test from "node:test";
import { resolveBuildEnvironment, sanitizeDeploymentManifest } from "../scripts/sanitize-deployment-manifest.mjs";

test("deployment build recognizes development mode loaded from .env.local", () => {
  assert.equal(resolveBuildEnvironment("", "SECUREVISIT_ENVIRONMENT=development\n"), "development");
  assert.equal(resolveBuildEnvironment("staging", "SECUREVISIT_ENVIRONMENT=development\n"), "staging");
});

test("deployment manifest sanitizer replaces local adapters with deployment values", () => {
  const result = sanitizeDeploymentManifest({
    vars: {
      SECUREVISIT_ENVIRONMENT: "staging",
      VISITOR_AUTH_DELIVERY: "console",
      NOTIFICATION_DELIVERY: "in_app",
      PAYMENT_PROVIDER: "local_test",
    },
  }, {
    SECUREVISIT_ENVIRONMENT: "staging",
    VISITOR_AUTH_DELIVERY: "webhook",
    NOTIFICATION_DELIVERY: "resend",
    PAYMENT_PROVIDER: "xendit",
  });

  assert.equal(result.vars.VISITOR_AUTH_DELIVERY, "webhook");
  assert.equal(result.vars.NOTIFICATION_DELIVERY, "resend");
  assert.equal(result.vars.PAYMENT_PROVIDER, "xendit");
});

test("deployment manifest sanitizer preserves recording storage runtime configuration", () => {
  const result = sanitizeDeploymentManifest({ vars: {
    PLATFORM_PROVISIONING_SECRET: "secret",
    RECORDING_STORAGE_PROVIDER: "local_test",
    RECORDINGS_ENCRYPTION_MODE: "local_test",
    RECORDINGS_BUCKET_NAME: "local-recordings",
    R2_S3_ENDPOINT: "http://localhost:9000",
    R2_S3_REGION: "local",
  } }, {
    SECUREVISIT_ENVIRONMENT: "staging",
    RECORDING_STORAGE_PROVIDER: "livekit_r2",
    RECORDINGS_ENCRYPTION_MODE: "r2_managed",
    RECORDINGS_BUCKET_NAME: "securevisit-staging-recordings",
    R2_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    R2_S3_REGION: "auto",
  });

  assert.equal(result.vars.RECORDING_STORAGE_PROVIDER, "livekit_r2");
  assert.equal(result.vars.RECORDINGS_ENCRYPTION_MODE, "r2_managed");
  assert.equal(result.vars.RECORDINGS_BUCKET_NAME, "securevisit-staging-recordings");
  assert.equal(result.vars.R2_S3_ENDPOINT, "https://account.r2.cloudflarestorage.com");
  assert.equal(result.vars.R2_S3_REGION, "auto");
});

test("deployment manifest sanitizer clears omitted configuration instead of inheriting local values", () => {
  const result = sanitizeDeploymentManifest({ vars: { VISITOR_AUTH_DELIVERY: "console", PUBLIC_APP_URL: "http://localhost:3000" } }, {
    SECUREVISIT_ENVIRONMENT: "production",
  });

  assert.equal(result.vars.VISITOR_AUTH_DELIVERY, "");
  assert.equal(result.vars.PUBLIC_APP_URL, "");
});

test("deployment manifest sanitizer removes forbidden credentials", () => {
  const result = sanitizeDeploymentManifest({ vars: {
    LIVEKIT_API_SECRET: "secret",
    PAYMENT_WEBHOOK_SECRET: "secret",
    XENDIT_SECRET_KEY: "secret",
    XENDIT_WEBHOOK_TOKEN: "secret",
    RESEND_API_KEY: "secret",
    VISITOR_AUTH_WEBHOOK_SECRET: "secret",
    VISITOR_SMS_TWILIO_AUTH_TOKEN: "secret",
    EVIDENCE_SCAN_WEBHOOK_SECRET: "secret",
    R2_S3_ACCESS_KEY_ID: "secret",
    R2_S3_SECRET_ACCESS_KEY: "secret",
    SECUREVISIT_ENVIRONMENT: "production",
  } }, { SECUREVISIT_ENVIRONMENT: "production" });

  assert.equal(Object.hasOwn(result.vars, "LIVEKIT_API_SECRET"), false);
  assert.equal(Object.hasOwn(result.vars, "PLATFORM_PROVISIONING_SECRET"), false);
  assert.equal(Object.hasOwn(result.vars, "PAYMENT_WEBHOOK_SECRET"), false);
  assert.equal(Object.hasOwn(result.vars, "XENDIT_SECRET_KEY"), false);
  assert.equal(Object.hasOwn(result.vars, "XENDIT_WEBHOOK_TOKEN"), false);
  assert.equal(Object.hasOwn(result.vars, "RESEND_API_KEY"), false);
  assert.equal(Object.hasOwn(result.vars, "VISITOR_AUTH_WEBHOOK_SECRET"), false);
  assert.equal(Object.hasOwn(result.vars, "VISITOR_SMS_TWILIO_AUTH_TOKEN"), false);
  assert.equal(Object.hasOwn(result.vars, "EVIDENCE_SCAN_WEBHOOK_SECRET"), false);
  assert.equal(Object.hasOwn(result.vars, "R2_S3_ACCESS_KEY_ID"), false);
  assert.equal(Object.hasOwn(result.vars, "R2_S3_SECRET_ACCESS_KEY"), false);
});
