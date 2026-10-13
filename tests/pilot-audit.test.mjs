import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function runAudit(extra = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/audit-pilot.mjs", ...extra], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("pilot audit emits a redacted actionable report without failing normal development use", async () => {
  const result = await runAudit([], { SECUREVISIT_ENVIRONMENT: "development", PILOT_AUDIT_SECRET: "must-not-appear" });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.environment, "development");
  assert.equal(report.readyForPilot, false);
  assert.ok(Array.isArray(report.nextActions));
  assert.ok(report.nextActions.some((action) => action.includes("PUBLIC_APP_URL")));
  assert.ok(report.nextActions.some((action) => action.includes("D1_DATABASE_ID")));
  assert.equal(report.checks.find((check) => check.id === "release-artifacts")?.ok, true);
  assert.equal(report.checks.find((check) => check.id === "external-integrations")?.ok, true);
  assert.equal(report.externalIntegrationChecks.find((check) => check.id === "payment-provider")?.configured, false);
  assert.equal(report.externalIntegrationChecks.find((check) => check.id === "notification-delivery")?.configured, false);
  assert.equal(report.externalIntegrationChecks.find((check) => check.id === "payment-provider")?.ok, false);
  assert.equal(report.externalIntegrationChecks.find((check) => check.id === "payment-provider")?.developmentWaived, true);
  assert.equal(report.externalIntegrationChecks.find((check) => check.id === "payment-provider")?.evaluation, "waived");
  assert.ok(report.waivedExternalIntegrations.includes("payment-provider"));
  assert.match(report.checks.find((check) => check.id === "external-integrations")?.detail || "", /waived in development/);
  assert.ok(report.nextActions.some((action) => action.includes("payment provider")));
  assert.doesNotMatch(result.stdout, /must-not-appear/);
});

test("pilot audit reports real integration readiness without exposing provider secrets", async () => {
  const result = await runAudit([], {
    SECUREVISIT_ENVIRONMENT: "staging",
    VISITOR_EMAIL_DELIVERY: "resend",
    VISITOR_SMS_DELIVERY: "twilio",
    VISITOR_AUTH_WEBHOOK_URL: "",
    RESEND_API_KEY: "resend-test-key",
    VISITOR_EMAIL_FROM: "SecureVisit <no-reply@example.test>",
    VISITOR_SMS_TWILIO_ACCOUNT_SID: "AC1234567890",
    VISITOR_SMS_TWILIO_AUTH_TOKEN: "twilio-test-token",
    VISITOR_SMS_TWILIO_FROM: "+15005550006",
    STAFF_AUTH_PROVIDER: "both",
    STAFF_OIDC_ISSUER: "https://idp.example.test",
    STAFF_OIDC_CLIENT_ID: "securevisit-control",
    STAFF_OIDC_CLIENT_SECRET: "oidc-secret",
    STAFF_OIDC_REDIRECT_URI: "https://securevisit.example.test/api/auth/staff/oidc/callback",
    STAFF_OIDC_MFA_ACR: "urn:mfa",
    STAFF_SAML_ENTITY_ID: "https://securevisit.example.test/saml",
    STAFF_SAML_METADATA_URL: "https://idp.example.test/metadata",
    STAFF_SAML_ENTRY_POINT: "https://idp.example.test/sso",
    STAFF_SAML_IDP_CERT: "-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----",
    STAFF_SAML_CALLBACK_URI: "https://securevisit.example.test/api/auth/staff/saml/callback",
    STAFF_SAML_MFA_ACR: "urn:mfa",
    PAYMENT_PROVIDER: "xendit",
    XENDIT_SECRET_KEY: "provider-secret-must-not-appear",
    XENDIT_WEBHOOK_TOKEN: "xendit-webhook-token",
    VIDEO_PROVIDER: "livekit",
    LIVEKIT_URL: "wss://example.livekit.cloud",
    LIVEKIT_API_KEY: "lk-key",
    LIVEKIT_API_SECRET: "lk-secret-must-not-appear",
    EVIDENCE_SCAN_PROVIDER: "webhook",
    EVIDENCE_SCAN_WEBHOOK_URL: "https://scanner.example.test/callback",
    EVIDENCE_SCAN_WEBHOOK_SECRET: "scanner-secret-must-not-appear",
    NOTIFICATION_EMAIL_DELIVERY: "resend",
    NOTIFICATION_SMS_DELIVERY: "twilio",
  });
  const report = JSON.parse(result.stdout);
  assert.equal(report.externalIntegrationChecks.every((check) => check.configured), true);
  assert.equal(report.externalIntegrationChecks.every((check) => check.ok), true);
  assert.equal(report.externalIntegrationChecks.every((check) => check.evaluation === "configured"), true);
  assert.doesNotMatch(result.stdout, /provider-secret-must-not-appear|lk-secret-must-not-appear|scanner-secret-must-not-appear/);
});

test("strict pilot audit fails closed outside development until configuration and evidence exist", async () => {
  const result = await runAudit(["--strict"], { SECUREVISIT_ENVIRONMENT: "staging" });
  assert.notEqual(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.readyForPilot, false);
  assert.ok(report.missingConfiguration.length > 0);
  assert.ok(report.missingStagingEvidence.includes("SECUREVISIT_LIVEKIT_STAGING=verified"));
  assert.equal(report.externalIntegrationChecks.every((check) => check.configured), false);
  assert.equal(report.readyForPilot, false);
  assert.equal(report.checks.find((check) => check.id === "external-integrations")?.ok, false);
});

test("pilot audit does not treat an unbound R2 provider as protected evidence storage", async () => {
  const result = await runAudit([], {
    SECUREVISIT_ENVIRONMENT: "staging",
    EVIDENCE_STORAGE_PROVIDER: "r2",
    EVIDENCE_BUCKET_NAME: "",
  });
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.find((check) => check.id === "evidence-storage")?.ok, false);
  assert.ok(report.nextActions.some((action) => action.includes("EVIDENCE_BUCKET_NAME")));
});

test("pilot audit accepts R2 storage only when the staging bucket is named", async () => {
  const result = await runAudit([], {
    SECUREVISIT_ENVIRONMENT: "staging",
    EVIDENCE_STORAGE_PROVIDER: "r2",
    EVIDENCE_BUCKET_NAME: "securevisit-staging-evidence",
  });
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.find((check) => check.id === "evidence-storage")?.ok, true);
});

test("pilot audit requires the remote D1 database name as well as its UUID", async () => {
  const result = await runAudit([], {
    SECUREVISIT_ENVIRONMENT: "staging",
    D1_DATABASE_ID: "11111111-1111-4111-8111-111111111111",
    D1_DATABASE_NAME: "",
  });
  assert.equal(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.find((check) => check.id === "remote-database")?.ok, false);
  assert.ok(report.nextActions.some((action) => action.includes("D1_DATABASE_NAME")));
});

test("environment template declares every pilot evidence gate", async () => {
  const template = await readFile(".env.example", "utf8");
  for (const key of [
    "SECUREVISIT_RELEASE_APPROVAL",
    "SECUREVISIT_SECURITY_REVIEW",
    "SECUREVISIT_PRIVACY_REVIEW",
    "SECUREVISIT_TARIFF_APPROVAL",
    "SECUREVISIT_REFUND_POLICY_APPROVAL",
    "SECUREVISIT_BACKUP_RESTORE_DRILL",
    "SECUREVISIT_WAF",
    "SECUREVISIT_MONITORING",
    "SECUREVISIT_OUTAGE_RUNBOOK",
    "SECUREVISIT_IDENTITY_STAGING",
    "SECUREVISIT_PAYMENT_STAGING",
    "SECUREVISIT_NOTIFICATION_STAGING",
    "SECUREVISIT_EVIDENCE_STAGING",
    "SECUREVISIT_KIOSK_STAGING",
    "SECUREVISIT_LIVEKIT_STAGING",
  ]) assert.match(template, new RegExp(`^${key}=`, "m"));
});

test("pilot evidence register maps every release gate", async () => {
  const register = await readFile("docs/PILOT_EVIDENCE_REGISTER.md", "utf8");
  for (const key of [
    "SECUREVISIT_RELEASE_APPROVAL",
    "SECUREVISIT_SECURITY_REVIEW",
    "SECUREVISIT_PRIVACY_REVIEW",
    "SECUREVISIT_TARIFF_APPROVAL",
    "SECUREVISIT_REFUND_POLICY_APPROVAL",
    "SECUREVISIT_BACKUP_RESTORE_DRILL",
    "SECUREVISIT_WAF",
    "SECUREVISIT_MONITORING",
    "SECUREVISIT_OUTAGE_RUNBOOK",
    "SECUREVISIT_IDENTITY_STAGING",
    "SECUREVISIT_PAYMENT_STAGING",
    "SECUREVISIT_NOTIFICATION_STAGING",
    "SECUREVISIT_EVIDENCE_STAGING",
    "SECUREVISIT_KIOSK_STAGING",
    "SECUREVISIT_LIVEKIT_STAGING",
  ]) assert.ok(register.includes(`| \`${key}\` |`), `missing register entry for ${key}`);
});
