import { validateEnvironment } from "../lib/server/config.ts";
import { evaluateReleaseGates } from "../lib/server/release-gates.ts";
import { existsSync } from "node:fs";

const values = { ...process.env, DB: {} };
const environment = String(values.SECUREVISIT_ENVIRONMENT || "invalid").trim() || "invalid";
const strict = process.argv.includes("--strict");
const environmentCheck = validateEnvironment(values);
const releaseGates = evaluateReleaseGates(environment, values);
const missingStagingEvidence = environment === "staging" ? releaseGates.missing : [];
const requiredRepositoryArtifacts = [
  "docs/PRODUCTION_OPERATIONS_RUNBOOK.md",
  "docs/PILOT_EVIDENCE_REGISTER.md",
  "docs/ROUTE_SECURITY_MATRIX.md",
];
const missingRepositoryArtifacts = requiredRepositoryArtifacts.filter((path) => !existsSync(path));

const present = (key) => typeof values[key] === "string" && values[key].trim().length > 0;
const realD1Id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(values.D1_DATABASE_ID || "").trim());
const evidenceProvider = String(values.EVIDENCE_STORAGE_PROVIDER || "").trim().toLowerCase();
const protectedEvidenceStorage = environment === "development"
  ? evidenceProvider === "r2" || evidenceProvider === "local_test"
  : evidenceProvider === "r2" && present("EVIDENCE_BUCKET_NAME");
const httpsUrl = (key) => {
  if (!present(key)) return false;
  try {
    const url = new URL(values[key].trim());
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
};

const configuredValue = (key) => String(values[key] || "").trim().toLowerCase();
const nonLocal = (key, ...localValues) => {
  const value = configuredValue(key);
  return Boolean(value) && !localValues.includes(value);
};
const externalIntegrationChecks = [
  {
    id: "visitor-email-provider",
    label: "Visitor email delivery provider",
    configured: nonLocal("VISITOR_EMAIL_DELIVERY", "", "console") || (present("VISITOR_AUTH_WEBHOOK_URL") && present("VISITOR_AUTH_WEBHOOK_SECRET")),
    detail: "VISITOR_EMAIL_DELIVERY or signed delivery webhook",
    action: "Configure a real visitor email provider and delivery-status callback",
  },
  {
    id: "visitor-sms-provider",
    label: "Visitor SMS delivery provider",
    configured: nonLocal("VISITOR_SMS_DELIVERY", "", "console") || (present("VISITOR_AUTH_WEBHOOK_URL") && present("VISITOR_AUTH_WEBHOOK_SECRET")),
    detail: "VISITOR_SMS_DELIVERY or signed delivery webhook",
    action: "Configure a real visitor SMS provider or formally approve email-only pilot scope",
  },
  {
    id: "staff-federation",
    label: "Institutional staff federation",
    configured: configuredValue("STAFF_AUTH_PROVIDER") !== "none" && present("STAFF_OIDC_ISSUER") && present("STAFF_SAML_METADATA_URL"),
    detail: "OIDC and SAML configuration with MFA claims",
    action: "Connect institutional OIDC and SAML providers with MFA claims and facility mapping",
  },
  {
    id: "payment-provider",
    label: "Payment provider",
    configured: nonLocal("PAYMENT_PROVIDER", "local_test") && (configuredValue("PAYMENT_PROVIDER") !== "xendit" || present("XENDIT_SECRET_KEY")),
    detail: "non-local payment adapter with sandbox credentials",
    action: "Select a payment provider and configure sandbox checkout, webhooks, refunds, and reconciliation",
  },
  {
    id: "livekit-provider",
    label: "LiveKit provider",
    configured: configuredValue("VIDEO_PROVIDER") === "livekit" && present("LIVEKIT_URL") && present("LIVEKIT_API_KEY") && present("LIVEKIT_API_SECRET"),
    detail: "VIDEO_PROVIDER=livekit with server credentials",
    action: "Configure LiveKit staging credentials and execute the visitor/kiosk/staff three-party test",
  },
  {
    id: "evidence-scanner",
    label: "Evidence malware scanner",
    configured: nonLocal("EVIDENCE_SCAN_PROVIDER", "development") && present("EVIDENCE_SCAN_WEBHOOK_URL") && present("EVIDENCE_SCAN_WEBHOOK_SECRET"),
    detail: "non-development scanner with signed callback",
    action: "Configure a protected malware-scanning adapter and quarantine callback",
  },
  {
    id: "notification-delivery",
    label: "Operational notification delivery",
    configured: nonLocal("NOTIFICATION_EMAIL_DELIVERY", "", "in_app")
      || nonLocal("NOTIFICATION_SMS_DELIVERY", "", "in_app")
      || (present("NOTIFICATION_WEBHOOK_URL") && present("NOTIFICATION_WEBHOOK_SECRET")),
    detail: "real email/SMS adapter or signed notification delivery webhook",
    action: "Configure operational email/SMS delivery, signed callbacks, retry, and dead-letter replay",
  },
];

const checks = [
  { id: "environment", label: "Explicit runtime environment", ok: environmentCheck.environment !== "invalid", detail: environmentCheck.environment },
  { id: "public-domain", label: "HTTPS public application domain", ok: httpsUrl("PUBLIC_APP_URL"), detail: "PUBLIC_APP_URL" },
  { id: "remote-database", label: "Remote D1 identity", ok: realD1Id && present("D1_DATABASE_NAME"), detail: "D1_DATABASE_ID plus D1_DATABASE_NAME" },
  { id: "evidence-storage", label: "Protected evidence storage", ok: protectedEvidenceStorage, detail: environment === "development" ? "development storage permitted" : "EVIDENCE_STORAGE_PROVIDER=r2 plus EVIDENCE_BUCKET_NAME" },
  { id: "queue", label: "Notification queue binding", ok: environment === "development" || present("NOTIFICATION_QUEUE_NAME"), detail: present("NOTIFICATION_QUEUE_NAME") ? "configured" : environment === "development" ? "development-only cron fallback" : "required for staging/production" },
  { id: "environment-config", label: "Provider and secret configuration", ok: environmentCheck.ok, detail: environmentCheck.ok ? "validated" : `${environmentCheck.missing.length} requirement(s) missing` },
  { id: "release-gates", label: "Institutional release evidence", ok: environment === "development" || releaseGates.ready, detail: environment === "development" ? "development-only gates not evaluated" : releaseGates.ready ? "all required gates attested" : `${releaseGates.missing.length} gate(s) missing` },
  { id: "staging-evidence", label: "Staging acceptance evidence", ok: environment !== "staging" || missingStagingEvidence.length === 0, detail: environment !== "staging" ? "not required outside staging" : missingStagingEvidence.length ? `${missingStagingEvidence.length} attestation(s) missing` : "all pilot attestations present" },
  { id: "release-artifacts", label: "Release documentation artifacts", ok: missingRepositoryArtifacts.length === 0, detail: missingRepositoryArtifacts.length ? `${missingRepositoryArtifacts.length} required artifact(s) missing` : "runbook, evidence register, and route matrix present" },
];

const operationalActions = {
  "public-domain": "Set PUBLIC_APP_URL to the deployed HTTPS application URL",
  "remote-database": "Set D1_DATABASE_ID and D1_DATABASE_NAME to the real remote database identity",
  "evidence-storage": "Configure EVIDENCE_STORAGE_PROVIDER=r2 and EVIDENCE_BUCKET_NAME for the protected evidence bucket",
  queue: "Configure NOTIFICATION_QUEUE_NAME for the deployed environment",
  "release-artifacts": "Restore the required release documentation artifacts before accepting pilot evidence",
};

const report = {
  generatedAt: new Date().toISOString(),
  environment: environmentCheck.environment,
  strict,
  readyForPilot: environmentCheck.environment !== "development" && environmentCheck.ok && releaseGates.ready && checks.every((check) => check.ok),
  checks,
  missingConfiguration: environmentCheck.missing,
  warnings: environmentCheck.warnings,
  missingReleaseEvidence: releaseGates.missing,
  missingStagingEvidence,
  externalIntegrationChecks: externalIntegrationChecks.map((check) => ({
    id: check.id,
    label: check.label,
    configured: check.configured,
    detail: check.detail,
    requiredOutsideDevelopment: true,
    ok: environment === "development" || check.configured,
  })),
  nextActions: [
    ...environmentCheck.missing.map((item) => `Configure ${item}`),
    ...releaseGates.missing.map((item) => `Record release evidence for ${item}`),
    ...missingRepositoryArtifacts.map((path) => `Restore required repository artifact ${path}`),
    ...checks.filter((check) => !check.ok && operationalActions[check.id]).map((check) => operationalActions[check.id]),
    ...externalIntegrationChecks.filter((check) => !check.configured).map((check) => check.action),
  ],
};

console.log(JSON.stringify(report, null, 2));
if (strict && !report.readyForPilot) process.exitCode = 1;
