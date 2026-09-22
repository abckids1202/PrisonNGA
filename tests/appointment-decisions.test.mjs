import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { appointmentDecisionStatements } from "../lib/server/appointment-decisions.ts";

class SQLiteD1Statement {
  values = [];
  constructor(database, sql) { this.database = database; this.sql = sql; }
  bind(...values) { this.values = values; return this; }
  async run() {
    const result = this.database.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
}

class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE appointments (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, visitor_user_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, last_transition_id TEXT);
      CREATE TABLE appointment_status_events (id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, actor_user_id TEXT, reason_code TEXT, reason_text TEXT, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT, facility_id TEXT, payload TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO appointments VALUES ('visit-1', 'facility-1', 'visitor-1', 'UNDER_REVIEW', 3, 'before', NULL);
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

const input = {
  appointmentId: "visit-1",
  facilityId: "facility-1",
  visitorUserId: "visitor-1",
  fromStatus: "UNDER_REVIEW",
  toStatus: "APPROVED",
  expectedVersion: 3,
  actorUserId: "staff-1",
  actorRole: "Scheduling Officer",
  command: "approve",
  reason: "Eligibility and capacity verified.",
  requestId: "request-1",
  correlationId: "correlation-1",
  now: "2026-09-22T10:00:00.000Z",
};

test("appointment decision, status history, audit, and outbox commit together", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(appointmentDecisionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 1]);
    const appointment = d1.sqlite.prepare("SELECT status, version FROM appointments WHERE id = 'visit-1'").get();
    assert.equal(appointment.status, "APPROVED");
    assert.equal(appointment.version, 4);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_status_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
  } finally { d1.close(); }
});

test("a stale decision produces no status, history, audit, or outbox writes", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(appointmentDecisionStatements(d1, { ...input, expectedVersion: 2 }));
    assert.deepEqual(results.map((result) => result.meta.changes), [0, 0, 0, 0]);
    const appointment = d1.sqlite.prepare("SELECT status, version FROM appointments WHERE id = 'visit-1'").get();
    assert.equal(appointment.status, "UNDER_REVIEW");
    assert.equal(appointment.version, 3);
    for (const table of ["appointment_status_events", "audit_events", "outbox_events"]) {
      assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  } finally { d1.close(); }
});

test("same-millisecond competing decisions cannot write duplicate events", async () => {
  const d1 = new SQLiteD1();
  try {
    const first = await d1.batch(appointmentDecisionStatements(d1, input));
    assert.equal(first[0].meta.changes, 1);
    const retry = await d1.batch(appointmentDecisionStatements(d1, { ...input, correlationId: "correlation-2" }));
    assert.deepEqual(retry.map((result) => result.meta.changes), [0, 0, 0, 0]);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_status_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
  } finally { d1.close(); }
});

test("an audit/outbox failure rolls back the appointment transition and history", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON outbox_events BEGIN SELECT RAISE(ABORT, 'simulated outbox failure'); END;");
    await assert.rejects(d1.batch(appointmentDecisionStatements(d1, input)), /simulated outbox failure/);
    const appointment = d1.sqlite.prepare("SELECT status, version FROM appointments WHERE id = 'visit-1'").get();
    assert.equal(appointment.status, "UNDER_REVIEW");
    assert.equal(appointment.version, 3);
    for (const table of ["appointment_status_events", "audit_events", "outbox_events"]) {
      assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  } finally { d1.close(); }
});
