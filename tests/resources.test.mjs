import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { allocateVisitResources } from "../lib/server/resources.ts";
import { resourceReassignmentStatements } from "../lib/server/resource-reassignment.ts";

class SQLiteD1Statement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async run() {
    const result = this.database.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
  async all() { return { results: this.database.sqlite.prepare(this.sql).all(...this.values) }; }
}

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE resources (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, resource_type TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL, health_state TEXT NOT NULL DEFAULT 'HEALTHY');
      CREATE TABLE resource_reservations (
        id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
        resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, status TEXT NOT NULL,
        starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }
  prepare(sql) { return new SQLiteD1Statement(this, sql); }
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
  close() { this.sqlite.close(); }
}

function addResource(d1, id, resourceType, displayName, status) {
  d1.sqlite.prepare("INSERT INTO resources (id, facility_id, resource_type, display_name, status) VALUES (?, 'facility-1', ?, ?, ?)").run(id, resourceType, displayName, status);
}

test("resource selection and room/device reservations are atomic and idempotent", async () => {
  const d1 = new SQLiteD1();
  try {
    addResource(d1, "room-1", "ROOM", "Room 01", "AVAILABLE");
    addResource(d1, "device-1", "DEVICE", "Kiosk 01", "ONLINE");
    const visit = { facilityId: "facility-1", appointmentId: "visit-1", startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T09:30:00.000Z" };
    const first = await allocateVisitResources(d1, visit);
    assert.equal(first.roomId, "room-1");
    assert.equal(first.deviceId, "device-1");
    assert.equal(first.created, true);

    const replay = await allocateVisitResources(d1, visit);
    assert.equal(replay.roomId, first.roomId);
    assert.equal(replay.deviceId, first.deviceId);
    assert.equal(replay.created, false);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 2);

    await assert.rejects(allocateVisitResources(d1, { ...visit, appointmentId: "visit-2" }), /RESOURCE_RESERVATION_CONFLICT/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 2, "failed device selection rolls back the room reservation");
  } finally { d1.close(); }
});

test("resource allocation skips conflicting resources and uses another available pair", async () => {
  const d1 = new SQLiteD1();
  try {
    addResource(d1, "room-1", "ROOM", "Room 01", "AVAILABLE");
    addResource(d1, "room-2", "ROOM", "Room 02", "AVAILABLE");
    addResource(d1, "device-1", "DEVICE", "Kiosk 01", "ONLINE");
    addResource(d1, "device-2", "DEVICE", "Kiosk 02", "ONLINE");
    const slot = { facilityId: "facility-1", startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T09:30:00.000Z" };
    await allocateVisitResources(d1, { ...slot, appointmentId: "visit-1" });
    const second = await allocateVisitResources(d1, { ...slot, appointmentId: "visit-2" });
    assert.equal(second.roomId, "room-2");
    assert.equal(second.deviceId, "device-2");
    assert.equal(second.created, true);
  } finally { d1.close(); }
});

test("resource allocation fails closed when a room or kiosk is unhealthy", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.prepare("INSERT INTO resources VALUES ('room-1', 'facility-1', 'ROOM', 'Room 01', 'AVAILABLE', 'FAILED')").run();
    d1.sqlite.prepare("INSERT INTO resources VALUES ('device-1', 'facility-1', 'DEVICE', 'Kiosk 01', 'ONLINE', 'HEALTHY')").run();
    await assert.rejects(allocateVisitResources(d1, { facilityId: "facility-1", appointmentId: "visit-1", startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T09:30:00.000Z" }), /RESOURCES_UNAVAILABLE|RESOURCE_RESERVATION_CONFLICT/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 0);
  } finally { d1.close(); }
});

class ReassignmentD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE resources (id TEXT PRIMARY KEY, facility_id TEXT, resource_type TEXT, display_name TEXT, status TEXT, health_state TEXT, version INTEGER, updated_at TEXT);
      CREATE TABLE resource_reservations (id TEXT PRIMARY KEY, facility_id TEXT, appointment_id TEXT, resource_type TEXT, resource_id TEXT, status TEXT, starts_at TEXT, ends_at TEXT, created_at TEXT);
      CREATE TABLE waiting_room_sessions (appointment_id TEXT PRIMARY KEY, facility_id TEXT, assigned_room_id TEXT, assigned_kiosk_id TEXT, version INTEGER, updated_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, created_at TEXT);
    `);
  }
  prepare(sql) {
    const database = this.sqlite;
    return { bind(...values) { this.values = values; return this; }, async run() { const result = database.prepare(sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; } };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}

function seedReassignment(d1, withCollision = false) {
  d1.sqlite.exec(`
    INSERT INTO resources VALUES ('source', 'facility-1', 'DEVICE', 'Kiosk 01', 'OFFLINE', 'FAILED', 1, 'before');
    INSERT INTO resources VALUES ('target', 'facility-1', 'DEVICE', 'Kiosk 02', 'ONLINE', 'HEALTHY', 1, 'before');
    INSERT INTO resource_reservations VALUES ('reservation-source', 'facility-1', 'visit-1', 'DEVICE', 'source', 'RESERVED', '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'before');
    INSERT INTO waiting_room_sessions VALUES ('visit-1', 'facility-1', NULL, 'source', 4, 'before');
  `);
  if (withCollision) d1.sqlite.exec("INSERT INTO resource_reservations VALUES ('reservation-other', 'facility-1', 'visit-2', 'DEVICE', 'target', 'RESERVED', '2026-10-01T09:15:00.000Z', '2026-10-01T09:45:00.000Z', 'before');");
}

function reassignmentInput(d1) {
  return { d1, facilityId: "facility-1", appointmentId: "visit-1", sourceReservationId: "reservation-source", sourceResourceId: "source", sourceResourceType: "DEVICE", sourceStatus: "RESERVED", startsAt: "2026-10-01T09:00:00.000Z", endsAt: "2026-10-01T09:30:00.000Z", targetResourceId: "target", expectedSourceVersion: 1, expectedTargetVersion: 1, expectedWaitingVersion: 4, waitingExists: true, actorUserId: "staff-1", actorRole: "Supervisor", reason: "Kiosk failure requires replacement.", oldResourceName: "Kiosk 01", newResourceName: "Kiosk 02", requestId: "request-1", correlationId: "correlation-1", now: "2026-10-01T08:00:00.000Z" };
}

test("resource reassignment atomically swaps reservation, versions, waiting assignment, audit, and outbox", async () => {
  const d1 = new ReassignmentD1();
  try {
    seedReassignment(d1);
    const results = await d1.batch(resourceReassignmentStatements(reassignmentInput(d1)));
    assert.deepEqual(results.slice(0, 5).map((result) => result.meta.changes), [1, 1, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status FROM resource_reservations WHERE id = 'reservation-source'").get().status, "RELEASED");
    assert.equal(d1.sqlite.prepare("SELECT resource_id FROM resource_reservations WHERE appointment_id = 'visit-1' AND status = 'RESERVED'").get().resource_id, "target");
    assert.deepEqual(d1.sqlite.prepare("SELECT id, version FROM resources ORDER BY id").all().map((row) => ({ ...row })), [{ id: "source", version: 2 }, { id: "target", version: 2 }]);
    assert.deepEqual({ ...d1.sqlite.prepare("SELECT assigned_kiosk_id, version FROM waiting_room_sessions").get() }, { assigned_kiosk_id: "target", version: 5 });
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
  } finally { d1.close(); }
});

test("resource reassignment leaves the original reservation untouched when the target collides", async () => {
  const d1 = new ReassignmentD1();
  try {
    seedReassignment(d1, true);
    const results = await d1.batch(resourceReassignmentStatements(reassignmentInput(d1)));
    assert.equal(results[0].meta.changes, 0);
    assert.equal(d1.sqlite.prepare("SELECT status FROM resource_reservations WHERE id = 'reservation-source'").get().status, "RESERVED");
    assert.equal(d1.sqlite.prepare("SELECT version FROM resources WHERE id = 'source'").get().version, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 0);
  } finally { d1.close(); }
});
