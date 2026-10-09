import { getD1 } from "../../../../db/runtime";
import { getEvidenceBucket } from "../../../../db/runtime";
import { getRequestContext, getRuntimeValue, requirePermission, securityErrorResponse, securityResponse } from "../../../../lib/server/security";
import { validateEnvironment } from "../../../../lib/server/config";
import { getPaymentProvider } from "../../../../lib/server/payments/provider";
import { getVideoConfig } from "../../../../lib/server/video/provider";
import { getNotificationDelivery } from "../../../../lib/server/notifications/provider";
import { isSecureHttpsEndpoint } from "../../../../lib/server/endpoint";
import { isDeliveryConfigured } from "../../../../lib/server/delivery-readiness";
import { evaluateReleaseGates } from "../../../../lib/server/release-gates";

const requiredTables = [
  "users", "facilities", "visit_policies", "visit_policy_history", "staff_profiles", "roles", "permissions", "user_roles", "role_permissions",
  "auth_sessions", "auth_challenges", "auth_challenge_delivery_attempts", "idempotency_records", "auth_federation_states", "saml_request_cache", "security_events", "rate_limit_buckets",
  "audit_events", "audit_export_manifests", "break_glass_requests", "outbox_events", "appointments", "appointment_types", "appointment_type_history", "prisoners", "visitor_profiles", "visitor_relationships", "verification_cases", "evidence_documents",
  "retention_policies", "legal_holds", "facility_closures", "appointment_status_events", "resource_reservations", "resources", "kiosk_credentials", "kiosk_device_check_attempts", "waiting_room_sessions", "visitor_waiting_room_checkins",
  "visit_sessions", "visit_session_participants", "visitor_device_check_attempts", "visit_session_events", "credit_accounts", "credit_ledger_entries", "payment_intents",
  "payment_provider_events", "payment_refund_requests", "notification_delivery_attempts", "notification_provider_events", "notifications", "incidents", "incident_events", "step_up_assertions",
];

// Table existence alone is not enough for a safe rollout. A database can have
// every historical table while still missing columns introduced by a newer
// migration. Keep this list focused on columns used by recovery-sensitive
// workflows so a partially migrated database fails closed before traffic is
// admitted.
const requiredColumns: Record<string, string[]> = {
  users: ["phone", "phone_verified_at"],
  auth_challenges: ["user_id"],
  saml_request_cache: ["state_hash"],
  appointments: ["last_transition_id", "policy_version", "duration_minutes"],
  incidents: ["idempotency_key", "request_hash"],
  visit_policies: ["credit_price_minor", "credit_currency"],
  waiting_room_sessions: ["assigned_room_id", "assigned_kiosk_id", "visitor_presence_at", "prisoner_presence_at", "kiosk_camera_state", "kiosk_microphone_state", "kiosk_network_state", "kiosk_device_checked_at"],
  payment_provider_events: ["attempt_count", "available_at", "last_error", "processing_started_at"],
  idempotency_records: ["processing_started_at"],
  auth_sessions: ["revoked_at"],
  outbox_events: ["attempt_count", "next_attempt_at", "processing_started_at"],
  notification_delivery_attempts: ["provider", "provider_reference", "provider_status", "status_updated_at"],
  auth_challenge_delivery_attempts: ["provider_reference", "provider_status", "status_updated_at"],
};

const configurationKeys = [
  "SECUREVISIT_ENVIRONMENT", "SECUREVISIT_HASH_SALT", "STAFF_STEP_UP_SECRET", "VISITOR_AUTH_DELIVERY", "VISITOR_EMAIL_DELIVERY", "VISITOR_SMS_DELIVERY", "VISITOR_AUTH_WEBHOOK_URL", "VISITOR_AUTH_WEBHOOK_SECRET", "RESEND_API_KEY", "VISITOR_EMAIL_FROM", "VISITOR_SMS_TWILIO_ACCOUNT_SID", "VISITOR_SMS_TWILIO_AUTH_TOKEN", "VISITOR_SMS_TWILIO_FROM", "VISITOR_SMS_TWILIO_MESSAGING_SERVICE_SID",
  "VIDEO_PROVIDER", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "EVIDENCE_STORAGE_PROVIDER", "EVIDENCE_SCAN_PROVIDER", "EVIDENCE_SCAN_WEBHOOK_URL", "EVIDENCE_SCAN_WEBHOOK_SECRET",
  "PAYMENT_PROVIDER", "PAYMENT_CHECKOUT_URL", "PAYMENT_REFUND_URL", "PAYMENT_PROVIDER_SECRET", "PAYMENT_WEBHOOK_SECRET", "NOTIFICATION_DELIVERY", "NOTIFICATION_EMAIL_DELIVERY", "NOTIFICATION_SMS_DELIVERY", "NOTIFICATION_WEBHOOK_URL", "NOTIFICATION_WEBHOOK_SECRET", "NOTIFICATION_STATUS_WEBHOOK_SECRET",
  "STAFF_AUTH_PROVIDER", "STAFF_OIDC_ISSUER", "STAFF_OIDC_CLIENT_ID", "STAFF_OIDC_CLIENT_SECRET", "STAFF_OIDC_REDIRECT_URI", "STAFF_OIDC_MFA_ACR", "STAFF_OIDC_MFA_AMR",
  "STAFF_SAML_ENTITY_ID", "STAFF_SAML_METADATA_URL", "STAFF_SAML_ENTRY_POINT", "STAFF_SAML_IDP_CERT", "STAFF_SAML_CALLBACK_URI", "STAFF_SAML_MFA_ACR", "PUBLIC_APP_URL",
  "SECUREVISIT_RELEASE_APPROVAL", "SECUREVISIT_SECURITY_REVIEW", "SECUREVISIT_PRIVACY_REVIEW", "SECUREVISIT_TARIFF_APPROVAL", "SECUREVISIT_REFUND_POLICY_APPROVAL", "SECUREVISIT_BACKUP_RESTORE_DRILL", "SECUREVISIT_WAF", "SECUREVISIT_MONITORING", "SECUREVISIT_OUTAGE_RUNBOOK", "SECUREVISIT_IDENTITY_STAGING", "SECUREVISIT_PAYMENT_STAGING", "SECUREVISIT_NOTIFICATION_STAGING", "SECUREVISIT_EVIDENCE_STAGING", "SECUREVISIT_KIOSK_STAGING", "SECUREVISIT_LIVEKIT_STAGING", "SECUREVISIT_RELEASE_EVIDENCE_ID", "SECUREVISIT_RELEASE_EVIDENCE_EXPIRES_AT", "SECUREVISIT_RELEASE_EVIDENCE_MANIFEST",
];

export async function GET() {
  const context = await getRequestContext();
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT") || "invalid";
  try {
    await requirePermission("facility.read");
    const d1 = await getD1();
    const rows = await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const present = new Set(rows.results.map((row) => row.name));
    const missingTables = requiredTables.filter((table) => !present.has(table));
    const missingColumns: string[] = [];
    for (const [table, columns] of Object.entries(requiredColumns)) {
      if (!present.has(table)) continue;
      const tableInfo = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      const available = new Set(tableInfo.results.map((column) => column.name));
      for (const column of columns) if (!available.has(column)) missingColumns.push(`${table}.${column}`);
    }
    const schemaReady = missingTables.length === 0 && missingColumns.length === 0;
    const [paymentProvider, videoConfig, , , evidenceBucket, evidenceStorageProvider, notificationWebhookUrl, notificationWebhookSecret, , visitorAuthWebhookUrl, visitorAuthWebhookSecret, evidenceScanProvider, evidenceScanWebhookUrl, evidenceScanWebhookSecret, paymentWebhookSecret, staffAuthProvider, staffOidcIssuer, staffOidcClientId, staffOidcClientSecret, staffOidcRedirectUri, staffSamlEntityId, staffSamlMetadataUrl, staffSamlEntryPoint, staffSamlIdpCert, staffSamlCallbackUri, tariffRow, ...configurationValues] = await Promise.all([
      getPaymentProvider(),
      getVideoConfig(),
      getNotificationDelivery("EMAIL"),
      getNotificationDelivery("SMS"),
      getEvidenceBucket(),
      getRuntimeValue("EVIDENCE_STORAGE_PROVIDER"),
      getRuntimeValue("NOTIFICATION_WEBHOOK_URL"),
      getRuntimeValue("NOTIFICATION_WEBHOOK_SECRET"),
      getRuntimeValue("VISITOR_AUTH_DELIVERY"),
      getRuntimeValue("VISITOR_AUTH_WEBHOOK_URL"),
      getRuntimeValue("VISITOR_AUTH_WEBHOOK_SECRET"),
      getRuntimeValue("EVIDENCE_SCAN_PROVIDER"),
      getRuntimeValue("EVIDENCE_SCAN_WEBHOOK_URL"),
      getRuntimeValue("EVIDENCE_SCAN_WEBHOOK_SECRET"),
      getRuntimeValue("PAYMENT_WEBHOOK_SECRET"),
      getRuntimeValue("STAFF_AUTH_PROVIDER"),
      getRuntimeValue("STAFF_OIDC_ISSUER"),
      getRuntimeValue("STAFF_OIDC_CLIENT_ID"),
      getRuntimeValue("STAFF_OIDC_CLIENT_SECRET"),
      getRuntimeValue("STAFF_OIDC_REDIRECT_URI"),
      getRuntimeValue("STAFF_SAML_ENTITY_ID"),
      getRuntimeValue("STAFF_SAML_METADATA_URL"),
      getRuntimeValue("STAFF_SAML_ENTRY_POINT"),
      getRuntimeValue("STAFF_SAML_IDP_CERT"),
      getRuntimeValue("STAFF_SAML_CALLBACK_URI"),
      d1.prepare("SELECT COUNT(*) AS configured_count FROM visit_policies WHERE credit_price_minor IS NOT NULL AND credit_price_minor > 0 AND credit_currency = 'IDR'").first<{ configured_count: number }>(),
      ...configurationKeys.map((key) => getRuntimeValue(key)),
    ]);
    const environmentConfig = validateEnvironment({ DB: d1, EVIDENCE_BUCKET: evidenceBucket, ...Object.fromEntries(configurationKeys.map((key, index) => [key, configurationValues[index]])) });
    const configured = Object.fromEntries(await Promise.all(configurationKeys.map(async (key) => [key, await getRuntimeValue(key)] as const)));
    const configuredString = (key: string) => typeof configured[key] === "string" ? configured[key].trim() : "";
    const deliveryConfigured = (delivery: string, channel: "EMAIL" | "SMS", webhookUrl: string | null, webhookSecret: string | null) => {
      return isDeliveryConfigured({
        environment,
        delivery,
        channel,
        webhookUrl,
        webhookSecret,
        resendApiKey: configuredString("RESEND_API_KEY"),
        emailFrom: configuredString("VISITOR_EMAIL_FROM"),
        twilioAccountSid: configuredString("VISITOR_SMS_TWILIO_ACCOUNT_SID"),
        twilioAuthToken: configuredString("VISITOR_SMS_TWILIO_AUTH_TOKEN"),
        twilioFrom: configuredString("VISITOR_SMS_TWILIO_FROM"),
        twilioMessagingServiceSid: configuredString("VISITOR_SMS_TWILIO_MESSAGING_SERVICE_SID"),
      });
    };
    const configuredVisitorEmailDelivery = (configuredString("VISITOR_EMAIL_DELIVERY") || configuredString("VISITOR_AUTH_DELIVERY") || "").toLowerCase();
    const configuredVisitorSmsDelivery = (configuredString("VISITOR_SMS_DELIVERY") || configuredString("VISITOR_AUTH_DELIVERY") || "").toLowerCase();
    const visitorAuth = environment === "development"
      || (deliveryConfigured(configuredVisitorEmailDelivery, "EMAIL", configuredString("VISITOR_AUTH_WEBHOOK_URL") || visitorAuthWebhookUrl, configuredString("VISITOR_AUTH_WEBHOOK_SECRET") || visitorAuthWebhookSecret)
        && deliveryConfigured(configuredVisitorSmsDelivery, "SMS", configuredString("VISITOR_AUTH_WEBHOOK_URL") || visitorAuthWebhookUrl, configuredString("VISITOR_AUTH_WEBHOOK_SECRET") || visitorAuthWebhookSecret));
    const evidenceScanning = evidenceScanProvider === "webhook" && Boolean(evidenceScanWebhookUrl && isSecureHttpsEndpoint(evidenceScanWebhookUrl)) && Boolean(evidenceScanWebhookSecret);
    const paymentWebhook = Boolean(paymentProvider) && Boolean(paymentWebhookSecret);
    const oidcReady = Boolean(staffOidcIssuer && isSecureHttpsEndpoint(staffOidcIssuer)) && Boolean(staffOidcClientId) && Boolean(staffOidcClientSecret) && Boolean(staffOidcRedirectUri && isSecureHttpsEndpoint(staffOidcRedirectUri))
      && Boolean((await getRuntimeValue("STAFF_OIDC_MFA_ACR")) || (await getRuntimeValue("STAFF_OIDC_MFA_AMR")));
    const samlReady = Boolean(staffSamlEntityId) && Boolean(staffSamlMetadataUrl && isSecureHttpsEndpoint(staffSamlMetadataUrl)) && Boolean(staffSamlEntryPoint && isSecureHttpsEndpoint(staffSamlEntryPoint)) && Boolean(staffSamlIdpCert) && Boolean(staffSamlCallbackUri && isSecureHttpsEndpoint(staffSamlCallbackUri))
      && Boolean(await getRuntimeValue("STAFF_SAML_MFA_ACR"));
    const tariffConfigured = environment === "development" || Number(tariffRow?.configured_count || 0) > 0;
    // Staging and production have one institutional staff-auth contract: both
    // federation paths must be configured and MFA-validated. The environment
    // validator enforces this too; keeping the summary equally strict avoids a
    // misleading partial "staff identity ready" status in the UI.
    const staffIdentity = String(staffAuthProvider || "").toLowerCase() === "both" && oidcReady && samlReady;
    const configuredNotificationEmailDelivery = (configuredString("NOTIFICATION_EMAIL_DELIVERY") || configuredString("NOTIFICATION_DELIVERY") || "").toLowerCase();
    const configuredNotificationSmsDelivery = (configuredString("NOTIFICATION_SMS_DELIVERY") || configuredString("NOTIFICATION_DELIVERY") || "").toLowerCase();
    const notifications = deliveryConfigured(configuredNotificationEmailDelivery, "EMAIL", configuredString("NOTIFICATION_WEBHOOK_URL") || notificationWebhookUrl, configuredString("NOTIFICATION_WEBHOOK_SECRET") || notificationWebhookSecret)
      && deliveryConfigured(configuredNotificationSmsDelivery, "SMS", configuredString("NOTIFICATION_WEBHOOK_URL") || notificationWebhookUrl, configuredString("NOTIFICATION_WEBHOOK_SECRET") || notificationWebhookSecret)
      && (configuredNotificationEmailDelivery !== "webhook" && configuredNotificationSmsDelivery !== "webhook" || Boolean(notificationWebhookUrl) && Boolean(notificationWebhookSecret));
    const providerConfiguration = {
      payment: Boolean(paymentProvider),
      tariff: tariffConfigured,
      paymentWebhook,
      livekit: videoConfig.configured,
      evidenceStorage: Boolean(evidenceBucket) && (environment === "development" ? evidenceStorageProvider === "local_test" || evidenceStorageProvider === "r2" : evidenceStorageProvider === "r2"),
      evidenceScanning,
      visitorAuth,
      staffIdentity,
      notifications,
    };
    const providersReady = Object.values(providerConfiguration).every(Boolean);
    const releaseGates = evaluateReleaseGates(environment, configured);
    const ready = schemaReady && environmentConfig.ok && (environment === "development" || providersReady && releaseGates.ready);
    return securityResponse({ status: ready ? "ready" : "not_ready", environment, checks: { database: true, schema: schemaReady, schemaMissing: { tables: missingTables, columns: missingColumns }, providerConfiguration, releaseGates, tariff: { configured: tariffConfigured, configuredFacilities: Number(tariffRow?.configured_count || 0) }, environment: { ok: environmentConfig.ok, missing: environmentConfig.missing, warnings: environmentConfig.warnings } } }, ready ? 200 : 503, context.requestId);
  } catch (error) {
    if (error instanceof Error && error.name === "SecurityError") return securityErrorResponse(error, context.requestId);
    return securityResponse({ status: "not_ready", environment, checks: { database: false, schema: false, providerConfiguration: { payment: false, tariff: false, paymentWebhook: false, livekit: false, evidenceStorage: false, evidenceScanning: false, visitorAuth: false, staffIdentity: false, notifications: false }, releaseGates: { ready: false, required: [], missing: ["READINESS_CHECK_FAILED"] }, tariff: { configured: false, configuredFacilities: 0 }, environment: { ok: false, missing: ["READINESS_CHECK_FAILED"], warnings: [] } } }, 503, context.requestId);
  }
}
