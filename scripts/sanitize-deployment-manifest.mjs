import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const nonSecretDeploymentKeys = [
  "SECUREVISIT_ENVIRONMENT",
  "VIDEO_PROVIDER",
  "LIVEKIT_URL",
  "VISITOR_AUTH_CHANNELS",
  "SECUREVISIT_VISITOR_EMAIL_ONLY_APPROVAL",
  "VISITOR_AUTH_DELIVERY",
  "PAYMENT_PROVIDER",
  "VISIT_CREDIT_PRICE_MINOR",
  "EVIDENCE_STORAGE_PROVIDER",
  "SECUREVISIT_E2E_ISOLATED",
  "PUBLIC_APP_URL",
  "NOTIFICATION_QUEUE_NAME",
  "VISITOR_EMAIL_DELIVERY",
  "VISITOR_SMS_DELIVERY",
  "VISITOR_AUTH_WEBHOOK_URL",
  "VISITOR_EMAIL_FROM",
  "VISITOR_SMS_TWILIO_ACCOUNT_SID",
  "VISITOR_SMS_TWILIO_FROM",
  "VISITOR_SMS_TWILIO_MESSAGING_SERVICE_SID",
  "EVIDENCE_RETENTION_DAYS",
  "EVIDENCE_SCAN_PROVIDER",
  "EVIDENCE_SCAN_WEBHOOK_URL",
  "PAYMENT_CHECKOUT_URL",
  "PAYMENT_REFUND_URL",
  "XENDIT_API_BASE_URL",
  "NOTIFICATION_DELIVERY",
  "NOTIFICATION_EMAIL_DELIVERY",
  "NOTIFICATION_SMS_DELIVERY",
  "NOTIFICATION_WEBHOOK_URL",
  "STAFF_AUTH_PROVIDER",
  "STAFF_OIDC_ISSUER",
  "STAFF_OIDC_CLIENT_ID",
  "STAFF_OIDC_REDIRECT_URI",
  "STAFF_OIDC_EXPECTED_AUDIENCE",
  "STAFF_OIDC_MFA_ACR",
  "STAFF_OIDC_MFA_AMR",
  "STAFF_SAML_ENTITY_ID",
  "STAFF_SAML_METADATA_URL",
  "STAFF_SAML_ENTRY_POINT",
  "STAFF_SAML_CALLBACK_URI",
  "STAFF_SAML_MFA_ACR",
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
  "SECUREVISIT_RELEASE_EVIDENCE_ID",
  "SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT",
  "SECUREVISIT_RELEASE_EVIDENCE_MANIFEST",
];

export const forbiddenManifestSecrets = [
  "SECUREVISIT_HASH_SALT",
  "STAFF_STEP_UP_SECRET",
  "VISITOR_AUTH_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "VISITOR_SMS_TWILIO_AUTH_TOKEN",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "PAYMENT_PROVIDER_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "XENDIT_SECRET_KEY",
  "XENDIT_WEBHOOK_TOKEN",
  "NOTIFICATION_WEBHOOK_SECRET",
  "NOTIFICATION_STATUS_WEBHOOK_SECRET",
  "EVIDENCE_SCAN_WEBHOOK_SECRET",
  "STAFF_OIDC_CLIENT_SECRET",
  "STAFF_SAML_IDP_CERT",
];

export function sanitizeDeploymentManifest(manifest, runtime = {}) {
  const sanitized = { ...manifest };
  const vars = sanitized.vars && typeof sanitized.vars === "object" ? { ...sanitized.vars } : {};

  // Wrangler can merge .env/.dev.vars into its emitted manifest. Re-apply only
  // deployment-process values so local adapters never cross into staging or
  // production. Empty values intentionally remain fail-closed for runtime checks.
  for (const key of nonSecretDeploymentKeys) vars[key] = String(runtime[key] || "").trim();
  for (const key of forbiddenManifestSecrets) delete vars[key];
  sanitized.vars = vars;
  return sanitized;
}

export function resolveBuildEnvironment(environmentValue, localEnvironmentText = "") {
  const explicit = String(environmentValue || "").trim();
  if (explicit) return explicit;
  const match = String(localEnvironmentText).match(/^\s*SECUREVISIT_ENVIRONMENT\s*=\s*["']?([^"'#\r\n]+?)["']?\s*(?:#.*)?$/m);
  return match?.[1]?.trim() || "";
}

let localEnvironmentText = "";
if (!process.env.SECUREVISIT_ENVIRONMENT) {
  const localEnvironmentPath = path.resolve(".env.local");
  if (fs.existsSync(localEnvironmentPath)) localEnvironmentText = fs.readFileSync(localEnvironmentPath, "utf8");
}
const environment = resolveBuildEnvironment(process.env.SECUREVISIT_ENVIRONMENT, localEnvironmentText);
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain && environment !== "development") {
  const manifestPath = path.resolve("dist/server/wrangler.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`Deployment manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.writeFileSync(manifestPath, JSON.stringify(sanitizeDeploymentManifest(manifest, process.env)));
}

