import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cancelVisitorAppointmentStatements, createVisitorAppointmentStatements, rescheduleVisitorAppointmentStatements } from "../lib/server/visitor-appointments.ts";

test("visitor appointment mutations use a visitor-scoped rate-limit boundary", async () => {
  const source = await readFile(new URL("../app/api/visitor/appointments/route.ts", import.meta.url), "utf8");
  assert.match(source, /visitor-appointment-create:\$\{visitor\.userId\}/);
  assert.match(source, /visitor-appointment-change:\$\{visitor\.userId\}/);
  assert.match(source, /enforceRateLimit/);
});

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async run() {
    const result = this.db.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE appointments (id TEXT PRIMARY KEY, facility_id TEXT, visitor_user_id TEXT, prisoner_id TEXT, status TEXT, requested_start TEXT, requested_end TEXT, timezone TEXT, policy_version INTEGER, duration_minutes INTEGER, appointment_type TEXT, version INTEGER, created_at TEXT, updated_at TEXT, last_transition_id TEXT);
      CREATE TABLE idempotency_records (id TEXT PRIMARY KEY, scope TEXT, idempotency_key TEXT, request_hash TEXT, status TEXT, response_status INTEGER, response_body TEXT, created_at TEXT, completed_at TEXT);
      CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, facility_id TEXT, visitor_user_id TEXT, prisoner_id TEXT, status TEXT);
      CREATE TABLE prisoners (id TEXT PRIMARY KEY, facility_id TEXT, status TEXT, visitation_status TEXT);
      CREATE TABLE facilities (id TEXT PRIMARY KEY, current_state TEXT, timezone TEXT);
      CREATE TABLE visit_policies (facility_id TEXT PRIMARY KEY, version INTEGER);
      CREATE TABLE facility_closures (id TEXT PRIMARY KEY, facility_id TEXT, starts_at TEXT, ends_at TEXT, reason TEXT, status TEXT, version INTEGER, created_by TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, user_id TEXT, facility_id TEXT, available_credits INTEGER, reserved_credits INTEGER DEFAULT 0, version INTEGER DEFAULT 1, updated_at TEXT);
      CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT, appointment_id TEXT, entry_type TEXT, amount INTEGER, idempotency_key TEXT UNIQUE, reason TEXT, created_by TEXT, created_at TEXT);
      CREATE TABLE resource_reservations (id TEXT PRIMARY KEY, facility_id TEXT, appointment_id TEXT, resource_type TEXT, resource_id TEXT, status TEXT, starts_at TEXT, ends_at TEXT);
      CREATE TABLE appointment_status_events (id TEXT PRIMARY KEY, appointment_id TEXT, from_status TEXT, to_status TEXT, actor_user_id TEXT, reason_code TEXT, reason_text TEXT, correlation_id TEXT, created_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, created_at TEXT);
      INSERT INTO facilities VALUES ('f1', 'NORMAL_OPERATIONS', 'Asia/Jakarta');
      INSERT INTO visit_policies VALUES ('f1', 4);
      INSERT INTO prisoners VALUES ('p1', 'f1', 'ACTIVE', 'APPROVED');
      INSERT INTO prisoners VALUES ('p2', 'f1', 'ACTIVE', 'APPROVED');
      INSERT INTO visitor_relationships VALUES ('r1', 'f1', 'v1', 'p1', 'APPROVED');
      INSERT INTO visitor_relationships VALUES ('r2', 'f1', 'v1', 'p2', 'APPROVED');
      INSERT INTO visitor_relationships VALUES ('r3', 'f1', 'v2', 'p1', 'APPROVED');
      INSERT INTO credit_accounts VALUES ('ca1', 'v1', 'f1', 2, 0, 1, 'created');
      INSERT INTO credit_accounts VALUES ('ca2', 'v2', 'f1', 2, 0, 1, 'created');
    `);
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}

function input(id, { visitor = "v1", prisoner = "p1", relationship = "r1" } = {}) {
  const prisonerId = prisoner;
  const relationshipId = relationship;
  const scope = `visitor:${visitor}:appointment:create`;
  const now = "2026-09-22T03:00:00.000Z";
  const correlationId = `cor-${id}`;
  return {
    appointmentId: id, facilityId: "f1", visitorUserId: visitor, prisonerId, relationshipId,
    requestedStart: "2026-10-01T02:00:00.000Z", requestedEnd: "2026-10-01T02:30:00.000Z",
    timezone: "Asia/Jakarta", policyVersion: 4, durationMinutes: 30, appointmentType: "FAMILY",
    now, correlationId, requestId: `req-${id}`,
    idempotency: { claimId: `claim-${id}`, scope, key: `key-${id}` },
    responseBody: { appointmentId: id, status: "SUBMITTED", correlationId },
  };
}

async function submit(db, data) {
  db.sqlite.prepare("INSERT INTO idempotency_records (id, scope, idempotency_key, request_hash, status, created_at) VALUES (?, ?, ?, 'hash', 'PROCESSING', ?)")
    .run(data.idempotency.claimId, data.idempotency.scope, data.idempotency.key, data.now);
  return db.batch(createVisitorAppointmentStatements(db, data));
}

function rescheduleInput(id = "reschedule-1", version = 2) {
  const now = "2026-09-22T03:00:00.000Z";
  const correlationId = `cor-${id}`;
  return {
    appointmentId: "visit-1", facilityId: "f1", visitorUserId: "v1", prisonerId: "p1",
    expectedVersion: version, previousStatus: "UNDER_REVIEW",
    requestedStart: "2026-10-02T02:00:00.000Z", requestedEnd: "2026-10-02T02:30:00.000Z",
    timezone: "Asia/Jakarta", policyVersion: 4, durationMinutes: 30, now, correlationId, requestId: `req-${id}`,
    idempotency: { claimId: `claim-${id}`, scope: "visitor:v1:appointment:reschedule:visit-1", key: `key-${id}` },
    responseBody: { appointmentId: "visit-1", status: "UNDER_REVIEW", requestedStart: "2026-10-02T02:00:00.000Z", requestedEnd: "2026-10-02T02:30:00.000Z", version: version + 1, correlationId },
  };
}

function seedPendingAppointment(db, status = "UNDER_REVIEW") {
  db.sqlite.prepare(`INSERT INTO appointments
    (id, facility_id, visitor_user_id, prisoner_id, status, requested_start, requested_end, timezone, policy_version, duration_minutes, appointment_type, version, created_at, updated_at)
    VALUES ('visit-1', 'f1', 'v1', 'p1', ?, '2026-10-01T02:00:00.000Z', '2026-10-01T02:30:00.000Z', 'Asia/Jakarta', 4, 30, 'FAMILY', 2, 'created', 'updated')`).run(status);
}

async function submitReschedule(db, data) {
  seedPendingAppointment(db, data.previousStatus);
  db.sqlite.prepare("INSERT INTO idempotency_records (id, scope, idempotency_key, request_hash, status, created_at) VALUES (?, ?, ?, 'hash', 'PROCESSING', ?)")
    .run(data.idempotency.claimId, data.idempotency.scope, data.idempotency.key, data.now);
  return db.batch(rescheduleVisitorAppointmentStatements(db, data));
}

test("appointment create atomically rejects overlapping visitor slots without partial records", async () => {
  const db = new D1();
  try {
    assert.equal((await submit(db, input("a1")))[0].meta.changes, 1);
    assert.equal((await submit(db, input("a2", { prisoner: "p2", relationship: "r2" })))[0].meta.changes, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointments").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM outbox_events").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT status FROM idempotency_records WHERE id = 'claim-a2'").get().status, "PROCESSING");
  } finally { db.close(); }
});

test("appointment create atomically rejects overlapping prisoner slots across visitors", async () => {
  const db = new D1();
  try {
    assert.equal((await submit(db, input("a1")))[0].meta.changes, 1);
    assert.equal((await submit(db, input("a2", { visitor: "v2", relationship: "r3" })))[0].meta.changes, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointments").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointment_status_events").get().n, 1);
  } finally { db.close(); }
});

test("appointment create rechecks the policy version in the transaction", async () => {
  const db = new D1();
  try {
    const data = input("a1");
    data.policyVersion = 3;
    assert.equal((await submit(db, data))[0].meta.changes, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointments").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n, 0);
  } finally { db.close(); }
});

test("appointment, audit, outbox, and idempotency completion roll back together", async () => {
  const db = new D1();
  try {
    db.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    await assert.rejects(submit(db, input("a1")), /audit unavailable/);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointments").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointment_status_events").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM outbox_events").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT status FROM idempotency_records WHERE id = 'claim-a1'").get().status, "PROCESSING");
  } finally { db.close(); }
});

test("visitor reschedule atomically changes time and records decision history", async () => {
  const db = new D1();
  try {
    const data = rescheduleInput();
    assert.equal((await submitReschedule(db, data))[0].meta.changes, 1);
    const updated = db.sqlite.prepare("SELECT requested_start, requested_end, status, version, last_transition_id FROM appointments WHERE id = 'visit-1'").get();
    assert.equal(updated.requested_start, data.requestedStart);
    assert.equal(updated.status, "UNDER_REVIEW");
    assert.equal(updated.version, 3);
    assert.equal(updated.last_transition_id, data.correlationId);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointment_status_events WHERE from_status = 'UNDER_REVIEW' AND to_status = 'UNDER_REVIEW'").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action_type = 'APPOINTMENT_RESCHEDULED'").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM outbox_events WHERE event_type = 'APPOINTMENT_RESCHEDULED'").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT status FROM idempotency_records WHERE id = ?").get(data.idempotency.claimId).status, "COMPLETED");
  } finally { db.close(); }
});

test("visitor reschedule refuses a conflicting slot without partial writes", async () => {
  const db = new D1();
  try {
    const data = rescheduleInput();
    seedPendingAppointment(db);
    db.sqlite.prepare(`INSERT INTO appointments
      (id, facility_id, visitor_user_id, prisoner_id, status, requested_start, requested_end, timezone, appointment_type, version, created_at, updated_at)
      VALUES ('conflict-1', 'f1', 'v1', 'p2', 'SUBMITTED', ?, ?, 'Asia/Jakarta', 'FAMILY', 1, 'created', 'created')`)
      .run(data.requestedStart, data.requestedEnd);
    db.sqlite.prepare("INSERT INTO idempotency_records (id, scope, idempotency_key, request_hash, status, created_at) VALUES (?, ?, ?, 'hash', 'PROCESSING', ?)")
      .run(data.idempotency.claimId, data.idempotency.scope, data.idempotency.key, data.now);

    assert.equal((await db.batch(rescheduleVisitorAppointmentStatements(db, data)))[0].meta.changes, 0);
    assert.equal(db.sqlite.prepare("SELECT requested_start FROM appointments WHERE id = 'visit-1'").get().requested_start, "2026-10-01T02:00:00.000Z");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM outbox_events").get().n, 0);
  } finally { db.close(); }
});

test("visitor reschedule rolls back its time update if audit writing fails", async () => {
  const db = new D1();
  try {
    const data = rescheduleInput();
    seedPendingAppointment(db);
    db.sqlite.prepare("INSERT INTO idempotency_records (id, scope, idempotency_key, request_hash, status, created_at) VALUES (?, ?, ?, 'hash', 'PROCESSING', ?)")
      .run(data.idempotency.claimId, data.idempotency.scope, data.idempotency.key, data.now);
    db.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");

    await assert.rejects(db.batch(rescheduleVisitorAppointmentStatements(db, data)), /audit unavailable/);
    assert.equal(db.sqlite.prepare("SELECT requested_start, version FROM appointments WHERE id = 'visit-1'").get().requested_start, "2026-10-01T02:00:00.000Z");
    assert.equal(db.sqlite.prepare("SELECT version FROM appointments WHERE id = 'visit-1'").get().version, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointment_status_events").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM outbox_events").get().n, 0);
  } finally { db.close(); }
});

function cancelInput(previousStatus = "APPROVED", version = 2) {
  return {
    appointmentId: "visit-1", facilityId: "f1", visitorUserId: "v1", previousStatus,
    expectedVersion: version, creditAccountId: "ca1", now: "2026-09-22T03:00:00.000Z",
    correlationId: "cor-cancel", requestId: "req-cancel",
    idempotency: { claimId: "claim-cancel", scope: "visitor:v1:appointment:cancel:visit-1", key: "key-cancel" },
    responseBody: { appointmentId: "visit-1", status: "CANCELLED_BY_VISITOR", version: version + 1, correlationId: "cor-cancel" },
  };
}

function seedApprovedCancellation(db) {
  seedPendingAppointment(db, "APPROVED");
  db.sqlite.prepare("INSERT INTO idempotency_records (id, scope, idempotency_key, request_hash, status, created_at) VALUES ('claim-cancel', 'visitor:v1:appointment:cancel:visit-1', 'key-cancel', 'hash', 'PROCESSING', 'created')").run();
  db.sqlite.prepare("UPDATE credit_accounts SET available_credits = 1, reserved_credits = 1 WHERE id = 'ca1'").run();
  db.sqlite.prepare("INSERT INTO credit_ledger_entries VALUES ('reservation-1', 'ca1', 'visit-1', 'RESERVATION', -1, 'visit-1:reservation', 'reserved', 'staff-1', 'created')").run();
  db.sqlite.prepare("INSERT INTO resource_reservations VALUES ('room-1', 'f1', 'visit-1', 'ROOM', 'room-1', 'RESERVED', 'start', 'end')").run();
  db.sqlite.prepare("INSERT INTO resource_reservations VALUES ('device-1', 'f1', 'visit-1', 'DEVICE', 'device-1', 'RESERVED', 'start', 'end')").run();
}

test("visitor cancellation releases credit and resources with history, audit, and outbox atomically", async () => {
  const db = new D1();
  try {
    seedApprovedCancellation(db);
    const result = await db.batch(cancelVisitorAppointmentStatements(db, cancelInput()));
    assert.equal(result[0].meta.changes, 1);
    assert.equal(db.sqlite.prepare("SELECT status, version FROM appointments WHERE id = 'visit-1'").get().status, "CANCELLED_BY_VISITOR");
    assert.equal(db.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = 'ca1'").get().available_credits, 2);
    assert.equal(db.sqlite.prepare("SELECT status FROM resource_reservations WHERE appointment_id = 'visit-1'").get().status, "RELEASED");
    assert.equal(db.sqlite.prepare("SELECT entry_type FROM credit_ledger_entries WHERE appointment_id = 'visit-1' AND entry_type = 'RESERVATION_RELEASE'").get().entry_type, "RESERVATION_RELEASE");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointment_status_events WHERE to_status = 'CANCELLED_BY_VISITOR'").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action_type = 'APPOINTMENT_CANCELLED_BY_VISITOR'").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM outbox_events WHERE event_type = 'APPOINTMENT_CANCELLED_BY_VISITOR'").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT status, response_status FROM idempotency_records WHERE id = 'claim-cancel'").get().status, "COMPLETED");
  } finally { db.close(); }
});

test("visitor cancellation rolls back the appointment and settlement when audit fails", async () => {
  const db = new D1();
  try {
    seedApprovedCancellation(db);
    db.sqlite.exec("CREATE TRIGGER reject_cancel_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    await assert.rejects(db.batch(cancelVisitorAppointmentStatements(db, cancelInput())), /audit unavailable/);
    assert.equal(db.sqlite.prepare("SELECT status, version FROM appointments WHERE id = 'visit-1'").get().status, "APPROVED");
    assert.equal(db.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = 'ca1'").get().reserved_credits, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM credit_ledger_entries WHERE appointment_id = 'visit-1'").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM appointment_status_events WHERE to_status = 'CANCELLED_BY_VISITOR'").get().n, 0);
  } finally { db.close(); }
});
