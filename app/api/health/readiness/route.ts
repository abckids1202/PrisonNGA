import { getD1 } from "../../../../db/runtime";
import { getEvidenceBucket } from "../../../../db/runtime";
import { getRuntimeValue, securityResponse } from "../../../../lib/server/security";
import { getPaymentProvider } from "../../../../lib/server/payments/provider";
import { getVideoConfig } from "../../../../lib/server/video/provider";
import { getNotificationDelivery } from "../../../../lib/server/notifications/provider";

const requiredTables = [
  "users", "facilities", "visit_policies", "visit_policy_history", "staff_profiles", "roles", "permissions", "user_roles", "role_permissions",
  "auth_sessions", "auth_challenges", "auth_challenge_delivery_attempts", "idempotency_records", "auth_federation_states", "saml_request_cache", "security_events", "rate_limit_buckets",
  "audit_events", "outbox_events", "appointments", "prisoners", "visitor_profiles", "visitor_relationships", "verification_cases", "evidence_documents",
  "retention_policies", "legal_holds", "appointment_status_events", "resource_reservations", "resources", "kiosk_credentials", "waiting_room_sessions", "visitor_waiting_room_checkins",
  "visit_sessions", "visitor_device_check_attempts", "visit_session_events", "credit_accounts", "credit_ledger_entries", "payment_intents",
  "payment_provider_events", "notifications", "incidents", "incident_events", "step_up_assertions",
];

export async function GET() {
  const environment = await getRuntimeValue("SECUREVISIT_ENVIRONMENT") || "invalid";
  try {
    const d1 = await getD1();
    const rows = await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const present = new Set(rows.results.map((row) => row.name));
    const schemaReady = requiredTables.every((table) => present.has(table));
    const [paymentProvider, videoConfig, notificationDelivery, evidenceBucket, notificationWebhookUrl, notificationWebhookSecret, visitorAuthDelivery, visitorAuthWebhookUrl, visitorAuthWebhookSecret, evidenceScanProvider, evidenceScanWebhookUrl, evidenceScanWebhookSecret, paymentWebhookSecret, staffAuthProvider, staffOidcIssuer, staffOidcClientId, staffOidcClientSecret, staffOidcRedirectUri, staffSamlEntityId, staffSamlMetadataUrl, staffSamlEntryPoint, staffSamlIdpCert, staffSamlCallbackUri] = await Promise.all([
      getPaymentProvider(),
      getVideoConfig(),
      getNotificationDelivery(),
      getEvidenceBucket(),
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
    ]);
    const isHttps = (value: string | null) => typeof value === "string" && /^https:\/\//i.test(value);
    const webhookConfigured = (url: string | null, secret: string | null) => isHttps(url) && Boolean(secret);
    const visitorAuth = visitorAuthDelivery === "webhook" && webhookConfigured(visitorAuthWebhookUrl, visitorAuthWebhookSecret);
    const evidenceScanning = evidenceScanProvider === "webhook" && webhookConfigured(evidenceScanWebhookUrl, evidenceScanWebhookSecret);
    const paymentWebhook = Boolean(paymentProvider) && Boolean(paymentWebhookSecret);
    const staffIdentity = staffAuthProvider === "oidc"
      ? isHttps(staffOidcIssuer) && Boolean(staffOidcClientId) && Boolean(staffOidcClientSecret) && isHttps(staffOidcRedirectUri)
      : staffAuthProvider === "saml"
        ? Boolean(staffSamlEntityId) && isHttps(staffSamlMetadataUrl) && isHttps(staffSamlEntryPoint) && Boolean(staffSamlIdpCert) && isHttps(staffSamlCallbackUri)
        : false;
    const providerConfiguration = {
      payment: Boolean(paymentProvider),
      paymentWebhook,
      livekit: videoConfig.configured,
      evidenceStorage: Boolean(evidenceBucket),
      evidenceScanning,
      visitorAuth,
      staffIdentity,
      notifications: notificationDelivery === "in_app" || (Boolean(notificationWebhookUrl) && Boolean(notificationWebhookSecret)),
    };
    const providersReady = Object.values(providerConfiguration).every(Boolean);
    const ready = schemaReady && (environment === "development" || providersReady);
    return securityResponse({ status: ready ? "ready" : "not_ready", environment, checks: { database: true, schema: schemaReady, providerConfiguration } }, ready ? 200 : 503);
  } catch {
    return securityResponse({ status: "not_ready", environment, checks: { database: false, schema: false, providerConfiguration: { payment: false, paymentWebhook: false, livekit: false, evidenceStorage: false, evidenceScanning: false, visitorAuth: false, staffIdentity: false, notifications: false } } }, 503);
  }
}
