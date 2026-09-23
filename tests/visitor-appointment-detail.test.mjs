import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createVisitorDeviceCheckStatements, visitorAppointmentDetailStatement, visitorAppointmentHistoryStatement } from "../lib/server/visitor-appointment-detail.ts";

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async run() { const result = this.db.sqlite.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.db.sqlite.prepare(this.sql).all(...this.values) }; }
}

class D1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE facilities (id TEXT PRIMARY KEY, name TEXT, current_state TEXT);
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE prisoners (id TEXT PRIMARY KEY, facility_id TEXT, prisoner_number TEXT, display_name TEXT, status TEXT, visitation_status TEXT);
      CREATE TABLE appointments (id TEXT PRIMARY KEY, facility_id TEXT, visitor_user_id TEXT, prisoner_id TEXT, status TEXT, requested_start TEXT, requested_end TEXT, timezone TEXT, appointment_type TEXT, version INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, facility_id TEXT, visitor_user_id TEXT, prisoner_id TEXT, relationship_type TEXT);
      CREATE TABLE waiting_room_sessions (appointment_id TEXT, facility_id TEXT, state TEXT, visitor_presence TEXT, prisoner_presence TEXT, identity_state TEXT, camera_state TEXT, microphone_state TEXT, network_state TEXT, room_state TEXT, kiosk_state TEXT, restriction_state TEXT, last_checked_at TEXT);
      CREATE TABLE visit_sessions (id TEXT, appointment_id TEXT, facility_id TEXT, status TEXT, authorized_start_at TEXT, authorized_end_at TEXT, actual_started_at TEXT, actual_ended_at TEXT, recording_policy TEXT, recording_status TEXT);
      CREATE TABLE visitor_device_check_attempts (id TEXT PRIMARY KEY, facility_id TEXT, appointment_id TEXT, visitor_user_id TEXT, idempotency_key TEXT UNIQUE, camera_result TEXT, microphone_result TEXT, network_result TEXT, latency_ms INTEGER, correlation_id TEXT, created_at TEXT);
      CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, appointment_id TEXT, entry_type TEXT, created_at TEXT);
      CREATE TABLE appointment_status_events (id TEXT PRIMARY KEY, appointment_id TEXT, from_status TEXT, to_status TEXT, created_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      INSERT INTO facilities VALUES ('f1', 'Central Facility', 'NORMAL_OPERATIONS');
      INSERT INTO users VALUES ('visitor-1'), ('visitor-2');
      INSERT INTO prisoners VALUES ('p1', 'f1', 'P-001', 'Person One', 'ACTIVE', 'APPROVED');
      INSERT INTO appointments VALUES ('a1', 'f1', 'visitor-1', 'p1', 'APPROVED', '2026-09-23T02:00:00.000Z', '2026-09-23T02:20:00.000Z', 'Asia/Jakarta', 'FAMILY', 2, '2026-09-20T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
      INSERT INTO appointments VALUES ('a2', 'f1', 'visitor-2', 'p1', 'APPROVED', '2026-09-23T02:00:00.000Z', '2026-09-23T02:20:00.000Z', 'Asia/Jakarta', 'FAMILY', 1, '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
      INSERT INTO visitor_relationships VALUES ('r1', 'f1', 'visitor-1', 'p1', 'Sister');
      INSERT INTO visitor_relationships VALUES ('r2', 'f1', 'visitor-2', 'p1', 'Brother');
      INSERT INTO appointment_status_events VALUES ('e1', 'a1', 'SUBMITTED', 'APPROVED', '2026-09-21T00:00:00.000Z');
    `);
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}

test("visitor detail query returns saved visit data and never crosses account ownership", async () => {
  const db = new D1();
  try {
    const owned = await visitorAppointmentDetailStatement(db, { appointmentId: "a1", visitorUserId: "visitor-1" }).first();
    assert.equal(owned.prisoner_name, "Person One");
    assert.equal(owned.facility_name, "Central Facility");
    assert.equal(owned.relationship_type, "Sister");
    assert.equal(owned.status, "APPROVED");
    assert.equal(owned.visit_credit_status, "NOT_RESERVED");
    assert.equal((await visitorAppointmentHistoryStatement(db, { appointmentId: "a1", visitorUserId: "visitor-1" }).all()).results.length, 1);
    assert.equal(await visitorAppointmentDetailStatement(db, { appointmentId: "a1", visitorUserId: "visitor-2" }).first(), null);
    assert.equal((await visitorAppointmentHistoryStatement(db, { appointmentId: "a1", visitorUserId: "visitor-2" }).all()).results.length, 0);
  } finally { db.close(); }
});

test("visitor device check is append-only, idempotent, and audited once", async () => {
  const db = new D1();
  try {
    const input = { id: "check-1", facilityId: "f1", appointmentId: "a1", visitorUserId: "visitor-1", idempotencyKey: "visitor-1:key-12345678", cameraResult: "ready", microphoneResult: "warning", networkResult: "fair", latencyMs: 420, correlationId: "cor-1", requestId: "req-1", now: "2026-09-22T00:00:00.000Z" };
    const first = await db.batch(createVisitorDeviceCheckStatements(db, input));
    assert.equal(first[0].meta.changes, 1);
    assert.equal(first[1].meta.changes, 1);
    assert.equal(db.sqlite.prepare("SELECT camera_result, microphone_result, network_result, latency_ms FROM visitor_device_check_attempts WHERE id = 'check-1'").get().microphone_result, "warning");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    const retry = await db.batch(createVisitorDeviceCheckStatements(db, { ...input, id: "check-2" }));
    assert.equal(retry[0].meta.changes, 0);
    assert.equal(retry[1].meta.changes, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM visitor_device_check_attempts").get().count, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
  } finally { db.close(); }
});

test("visitor device check cannot be recorded for an ineligible visit or after an eligibility change", async () => {
  const db = new D1();
  try {
    db.sqlite.prepare("UPDATE facilities SET current_state = 'LOCKDOWN' WHERE id = 'f1'").run();
    const input = { id: "check-1", facilityId: "f1", appointmentId: "a1", visitorUserId: "visitor-1", idempotencyKey: "visitor-1:key-12345678", cameraResult: "ready", microphoneResult: "ready", networkResult: "stable", latencyMs: 10, correlationId: "cor-1", requestId: "req-1", now: "2026-09-22T00:00:00.000Z" };
    const result = await db.batch(createVisitorDeviceCheckStatements(db, input));
    assert.equal(result[0].meta.changes, 0);
    assert.equal(result[1].meta.changes, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM visitor_device_check_attempts").get().count, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0);
  } finally { db.close(); }
});
