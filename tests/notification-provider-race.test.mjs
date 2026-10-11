import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { reconcileStoredNotificationProviderEvent } from "../lib/server/notifications/provider-status.ts";

class D1 {
  sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE notification_provider_events (id TEXT PRIMARY KEY, provider TEXT, event_key TEXT, provider_reference TEXT, status TEXT, payload TEXT, created_at TEXT);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, created_at TEXT);
      CREATE TABLE notification_delivery_attempts (id TEXT PRIMARY KEY, outbox_event_id TEXT, notification_id TEXT, channel TEXT, attempt_number INTEGER, status TEXT, provider TEXT, provider_reference TEXT, provider_status TEXT, provider_error TEXT, status_updated_at TEXT, error_message TEXT, started_at TEXT, finished_at TEXT);
      CREATE TABLE notifications (id TEXT PRIMARY KEY, facility_id TEXT, user_id TEXT, channel TEXT, status TEXT, delivered_at TEXT, last_error TEXT);
      CREATE TABLE auth_challenge_delivery_attempts (id TEXT PRIMARY KEY, challenge_id TEXT, provider TEXT, provider_reference TEXT, status TEXT, provider_status TEXT, provider_error TEXT, status_updated_at TEXT, completed_at TEXT, created_at TEXT);
      CREATE TABLE auth_challenges (id TEXT PRIMARY KEY, expires_at TEXT, consumed_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
    `);
  }

  prepare(sql) {
    let values = [];
    const sqlite = this.sqlite;
    return {
      bind(...next) { values = next; return this; },
      first: async () => sqlite.prepare(sql).get(...values),
      run: async () => { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    };
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

test("provider callback received before reference persistence is reconciled", async () => {
  const d1 = new D1();
  d1.sqlite.exec(`
    INSERT INTO notification_provider_events VALUES ('provider-event-1', 'resend', 'evt-1', 'msg-1', 'DELIVERED', '{}', '2026-10-11T10:00:00.000Z');
    INSERT INTO outbox_events VALUES ('outbox-1', 'VISIT_APPROVED', 'appointment', 'visit-1', 'facility-1', '{}', 'corr-1', '2026-10-11T09:59:00.000Z');
    INSERT INTO notification_delivery_attempts (id, outbox_event_id, notification_id, channel, attempt_number, status, provider, provider_reference, started_at)
      VALUES ('attempt-1', 'outbox-1', 'notification-1', 'EXTERNAL', 1, 'PROCESSING', 'resend', 'msg-1', '2026-10-11T09:59:30.000Z');
    INSERT INTO notifications VALUES ('notification-1', 'facility-1', 'visitor-1', 'EMAIL', 'SENT', NULL, NULL);
  `);

  assert.equal(await reconcileStoredNotificationProviderEvent(d1, { provider: "resend", providerReference: "msg-1", requestId: "request-1" }), true);
  assert.deepEqual({ ...d1.sqlite.prepare("SELECT status, provider_status FROM notification_delivery_attempts WHERE id = 'attempt-1'").get() }, { status: "DELIVERED", provider_status: "DELIVERED" });
  assert.equal(d1.sqlite.prepare("SELECT status, delivered_at FROM notifications WHERE id = 'notification-1'").get().status, "DELIVERED");
  assert.equal(d1.sqlite.prepare("SELECT action_type FROM audit_events WHERE entity_id = 'attempt-1'").get().action_type, "NOTIFICATION_DELIVERY_STATUS_RECONCILED");
});
