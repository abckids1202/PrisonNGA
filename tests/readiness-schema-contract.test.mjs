import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("readiness fails closed on critical columns, not only table names", async () => {
  const source = await readFile(new URL("../app/api/health/readiness/route.ts", import.meta.url), "utf8");
  assert.match(source, /const requiredColumns/);
  assert.match(source, /credit_price_minor IS NOT NULL/);
  assert.match(source, /tariffConfigured/);
  assert.match(source, /payment_provider_events: \["attempt_count", "available_at", "last_error", "processing_started_at"\]/);
  assert.match(source, /idempotency_records: \["processing_started_at"\]/);
  assert.match(source, /notification_delivery_attempts.*notification_provider_events/);
  assert.match(source, /notification_delivery_attempts: \["provider", "provider_reference", "provider_status", "status_updated_at"\]/);
  assert.match(source, /appointment_types.*appointment_type_history.*prisoners/);
  assert.match(source, /facility_closures.*appointment_status_events/);
  assert.match(source, /kiosk_device_check_attempts.*waiting_room_sessions/);
  assert.match(source, /visit_session_participants.*visitor_device_check_attempts/);
  assert.match(source, /appointments: \["last_transition_id", "policy_version", "duration_minutes"\]/);
  assert.match(source, /payment_provider_events: \["attempt_count", "available_at", "last_error", "processing_started_at"\]/);
  assert.match(source, /waiting_room_sessions: \["assigned_room_id", "assigned_kiosk_id", "visitor_presence_at", "prisoner_presence_at", "kiosk_camera_state", "kiosk_microphone_state", "kiosk_network_state", "kiosk_device_checked_at"\]/);
  assert.match(source, /saml_request_cache: \["state_hash"\]/);
  assert.match(source, /PRAGMA table_info\(\$\{table\}\)/);
  assert.match(source, /schemaMissing: \{ tables: missingTables, columns: missingColumns \}/);
  assert.match(source, /const deliveryConfigured = \(delivery: string, channel: "EMAIL" \| "SMS"/);
  assert.match(source, /configuredVisitorEmailDelivery/);
  assert.match(source, /configuredVisitorSmsDelivery/);
  assert.match(source, /configuredNotificationEmailDelivery/);
  assert.match(source, /configuredNotificationSmsDelivery/);
});
