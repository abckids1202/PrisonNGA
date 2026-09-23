import { getD1 } from "../../../../db/runtime";
import { getEvidenceBucket } from "../../../../db/runtime";
import { getRuntimeValue, securityResponse } from "../../../../lib/server/security";
import { getPaymentProvider } from "../../../../lib/server/payments/provider";
import { getVideoConfig } from "../../../../lib/server/video/provider";
import { getNotificationDelivery } from "../../../../lib/server/notifications/provider";

const requiredTables = [
  "users", "facilities", "visit_policies", "visit_policy_history", "staff_profiles", "roles", "permissions", "user_roles", "role_permissions",
  "auth_sessions", "auth_challenges", "idempotency_records", "auth_federation_states", "saml_request_cache", "security_events", "rate_limit_buckets",
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
    const [paymentProvider, videoConfig, notificationDelivery, evidenceBucket, notificationWebhookUrl, notificationWebhookSecret] = await Promise.all([
      getPaymentProvider(),
      getVideoConfig(),
      getNotificationDelivery(),
      getEvidenceBucket(),
      getRuntimeValue("NOTIFICATION_WEBHOOK_URL"),
      getRuntimeValue("NOTIFICATION_WEBHOOK_SECRET"),
    ]);
    const providerConfiguration = {
      payment: Boolean(paymentProvider),
      livekit: videoConfig.configured,
      evidenceStorage: Boolean(evidenceBucket),
      notifications: notificationDelivery === "in_app" || (Boolean(notificationWebhookUrl) && Boolean(notificationWebhookSecret)),
    };
    const providersReady = Object.values(providerConfiguration).every(Boolean);
    const ready = schemaReady && (environment === "development" || providersReady);
    return securityResponse({ status: ready ? "ready" : "not_ready", environment, checks: { database: true, schema: schemaReady, providerConfiguration } }, ready ? 200 : 503);
  } catch {
    return securityResponse({ status: "not_ready", environment, checks: { database: false, schema: false, providerConfiguration: { payment: false, livekit: false, evidenceStorage: false, notifications: false } } }, 503);
  }
}
