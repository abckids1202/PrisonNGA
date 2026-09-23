import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { auditAndOutboxStatements } from "../lib/server/events.ts";

class D1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, status TEXT, attempt_count INTEGER, available_at TEXT, processed_at TEXT, last_error TEXT, created_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      INSERT INTO outbox_events VALUES ('event-1', 'VISIT_APPROVED', 'appointment', 'visit-1', 'facility-1', '{}', 'original-correlation', 'DEAD_LETTER', 6, 'before', NULL, 'delivery failed', 'before');
    `);
  }
  prepare(sql) {
    let values = [];
    const sqlite = this.sqlite;
    return { bind(...next) { values = next; return this; }, async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; } };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

test("outbox replay records audit after the event moves to pending", async () => {
  const d1 = new D1();
  const guard = { sql: "EXISTS (SELECT 1 FROM outbox_events WHERE id = ? AND facility_id = ? AND status = 'PENDING' AND attempt_count = 0)", values: ["event-1", "facility-1"] };
  const results = await d1.batch([
    d1.prepare("UPDATE outbox_events SET status = 'PENDING', attempt_count = 0 WHERE id = ? AND facility_id = ? AND status IN ('FAILED', 'DEAD_LETTER')").bind("event-1", "facility-1"),
    ...auditAndOutboxStatements(d1, { actorUserId: "staff-1", actorRole: "Supervisor", facilityId: "facility-1", actionType: "OUTBOX_EVENT_REPLAYED", entityType: "outbox_event", entityId: "event-1", reason: "Retry delivery", newValues: { status: "PENDING" }, requestId: "request-1", correlationId: "replay-1", eventType: "OUTBOX_EVENT_REPLAYED", payload: { replayedEventId: "event-1" } }, guard),
  ]);
  assert.equal(results[0].meta.changes, 1);
  assert.equal(results[1].meta.changes, 1);
  assert.equal(results[2].meta.changes, 1);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 2);
});
