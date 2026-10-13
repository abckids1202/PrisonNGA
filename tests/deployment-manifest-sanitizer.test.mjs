import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDeploymentManifest } from "../scripts/sanitize-deployment-manifest.mjs";

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
    RESEND_API_KEY: "secret",
    SECUREVISIT_ENVIRONMENT: "production",
  } }, { SECUREVISIT_ENVIRONMENT: "production" });

  assert.equal(Object.hasOwn(result.vars, "LIVEKIT_API_SECRET"), false);
  assert.equal(Object.hasOwn(result.vars, "PAYMENT_WEBHOOK_SECRET"), false);
  assert.equal(Object.hasOwn(result.vars, "RESEND_API_KEY"), false);
});
