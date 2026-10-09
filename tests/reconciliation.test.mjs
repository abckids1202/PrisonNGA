import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { recordResourceReconciliationRequired, recordWaitingRoomReconciliationRequired } from "../lib/server/reconciliation.ts";

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
