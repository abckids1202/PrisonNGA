import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { notificationDeadLetterStatement, recordResourceReconciliationRequired, recordWaitingRoomReconciliationRequired } from "../lib/server/reconciliation.ts";

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE security_events (
        id TEXT PRIMARY KEY,
        facility_id TEXT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        request_id TEXT,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE outbox_events (
        id TEXT PRIMARY KEY,
        facility_id TEXT,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL
      );
    `);
  }

  prepare(sql) {
    let values = [];
    const database = this.sqlite;
    return {
      bind(...next) { values = next; return this; },
      async run() {
        const result = database.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  close() { this.sqlite.close(); }
}

test("waiting-room reconciliation alarms persist facility-scoped critical metadata", async () => {
  const d1 = new SQLiteD1();
  try {
    await recordWaitingRoomReconciliationRequired(d1, {
      facilityId: "facility-1",
      appointmentId: "visit-1",
      operation: "KIOSK_DEVICE_CHECK",
      requestId: "request-1",
      correlationId: "correlation-1",
      expectedVersion: 8,
    });
    const event = d1.sqlite.prepare("SELECT facility_id, event_type, severity, request_id, metadata FROM security_events").get();
    assert.equal(event.facility_id, "facility-1");
    assert.equal(event.event_type, "WAITING_ROOM_RECONCILIATION_REQUIRED");
    assert.equal(event.severity, "CRITICAL");
    assert.equal(event.request_id, "request-1");
    assert.deepEqual(JSON.parse(event.metadata), {
      entityType: "appointment",
      entityId: "visit-1",
      operation: "KIOSK_DEVICE_CHECK",
      correlationId: "correlation-1",
      expectedVersion: 8,
      requiresStaffReview: true,
    });
  } finally {
    d1.close();
  }
});

test("resource reconciliation alarms use the resource entity boundary", async () => {
  const d1 = new SQLiteD1();
  try {
    await recordResourceReconciliationRequired(d1, {
      facilityId: "facility-1",
      resourceId: "kiosk-1",
      operation: "KIOSK_CREDENTIAL_REVOKE",
      requestId: "request-2",
      correlationId: "correlation-2",
      expectedVersion: 4,
    });
    const event = d1.sqlite.prepare("SELECT facility_id, event_type, severity, metadata FROM security_events").get();
    assert.equal(event.facility_id, "facility-1");
    assert.equal(event.event_type, "RESOURCE_RECONCILIATION_REQUIRED");
    assert.equal(event.severity, "CRITICAL");
    assert.deepEqual(JSON.parse(event.metadata), {
      entityType: "resource",
      entityId: "kiosk-1",
      operation: "KIOSK_CREDENTIAL_REVOKE",
      correlationId: "correlation-2",
      expectedVersion: 4,
      requiresStaffReview: true,
    });
  } finally {
    d1.close();
  }
});

test("notification dead letters create one durable facility-scoped alarm", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.prepare("INSERT INTO outbox_events VALUES (?, ?, 'DEAD_LETTER', ?)").run("outbox-1", "facility-1", 5);
    const statement = notificationDeadLetterStatement(d1, {
      facilityId: "facility-1",
      outboxEventId: "outbox-1",
      eventType: "VISIT_APPROVED",
      aggregateType: "appointment",
      aggregateId: "visit-1",
      attempt: 5,
      error: "provider unavailable",
      requestId: "correlation-3",
      correlationId: "correlation-3",
      now: "2026-10-09T12:00:00.000Z",
    });
    assert.equal((await statement.run()).meta.changes, 1);
    const duplicateStatement = notificationDeadLetterStatement(d1, {
      facilityId: "facility-1",
      outboxEventId: "outbox-1",
      eventType: "VISIT_APPROVED",
      aggregateType: "appointment",
      aggregateId: "visit-1",
      attempt: 5,
      error: "provider unavailable",
      requestId: "correlation-3",
      correlationId: "correlation-3",
      now: "2026-10-09T12:00:00.000Z",
    });
    assert.equal((await duplicateStatement.run()).meta.changes, 0);
    const event = d1.sqlite.prepare("SELECT facility_id, event_type, severity, metadata FROM security_events WHERE event_type = 'NOTIFICATION_OUTBOX_DEAD_LETTER'").get();
    assert.equal(event.facility_id, "facility-1");
    assert.equal(event.severity, "CRITICAL");
    assert.deepEqual(JSON.parse(event.metadata), {
      entityType: "outbox_event",
      entityId: "outbox-1",
      operation: "NOTIFICATION_DELIVERY",
      eventType: "VISIT_APPROVED",
      aggregateType: "appointment",
      aggregateId: "visit-1",
      attempt: 5,
      error: "provider unavailable",
      correlationId: "correlation-3",
      requiresStaffReview: true,
    });
  } finally {
    d1.close();
  }
});
