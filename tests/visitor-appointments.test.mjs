import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createVisitorAppointmentStatements } from "../lib/server/visitor-appointments.ts";

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
      CREATE TABLE credit_accounts (user_id TEXT, facility_id TEXT, available_credits INTEGER);
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
      INSERT INTO credit_accounts VALUES ('v1', 'f1', 2);
      INSERT INTO credit_accounts VALUES ('v2', 'f1', 2);
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
