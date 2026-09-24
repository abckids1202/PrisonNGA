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
      CREATE TABLE appointments (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, visitor_user_id TEXT NOT NULL, prisoner_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, requested_start TEXT NOT NULL, requested_end TEXT NOT NULL, timezone TEXT, policy_version INTEGER, duration_minutes INTEGER, updated_at TEXT NOT NULL, last_transition_id TEXT);
      CREATE TABLE appointment_status_events (id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, actor_user_id TEXT, reason_code TEXT, reason_text TEXT, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT, facility_id TEXT, payload TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, available_credits INTEGER NOT NULL, reserved_credits INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
      CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT NOT NULL, appointment_id TEXT, entry_type TEXT NOT NULL, amount INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, reason TEXT, created_by TEXT, created_at TEXT NOT NULL);
      CREATE TABLE resources (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, resource_type TEXT NOT NULL, display_name TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE resource_reservations (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, appointment_id TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, status TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE waiting_room_sessions (appointment_id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL, last_checked_at TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE facilities (id TEXT PRIMARY KEY, current_state TEXT NOT NULL, timezone TEXT NOT NULL);
      CREATE TABLE visit_policies (facility_id TEXT PRIMARY KEY, version INTEGER NOT NULL, min_duration_minutes INTEGER NOT NULL, max_duration_minutes INTEGER NOT NULL, min_advance_minutes INTEGER NOT NULL, max_advance_days INTEGER NOT NULL, daily_start_time TEXT NOT NULL, daily_end_time TEXT NOT NULL);
      CREATE TABLE prisoners (id TEXT PRIMARY KEY, status TEXT NOT NULL, visitation_status TEXT NOT NULL);
      CREATE TABLE visitor_relationships (facility_id TEXT NOT NULL, prisoner_id TEXT NOT NULL, visitor_user_id TEXT NOT NULL, status TEXT NOT NULL);
      INSERT INTO appointments VALUES ('visit-1', 'facility-1', 'visitor-1', 'prisoner-1', 'UNDER_REVIEW', 3, '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'Asia/Jakarta', 1, 30, 'before', NULL);
      INSERT INTO credit_accounts VALUES ('credit-1', 2, 0, 1, 'before');
      INSERT INTO resources VALUES ('room-1', 'facility-1', 'ROOM', 'Room 01', 'AVAILABLE');
      INSERT INTO resources VALUES ('device-1', 'facility-1', 'DEVICE', 'Kiosk 01', 'ONLINE');
      INSERT INTO facilities VALUES ('facility-1', 'NORMAL_OPERATIONS', 'Asia/Jakarta');
      INSERT INTO visit_policies VALUES ('facility-1', 1, 15, 30, 60, 30, '08:00', '17:00');
      INSERT INTO prisoners VALUES ('prisoner-1', 'ACTIVE', 'APPROVED');
      INSERT INTO visitor_relationships VALUES ('facility-1', 'prisoner-1', 'visitor-1', 'APPROVED');
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
  approval: {
    creditAccountId: "credit-1",
    startsAt: "2026-10-01T09:00:00.000Z",
    endsAt: "2026-10-01T09:30:00.000Z",
    policyVersion: 1,
    facilityTimezone: "Asia/Jakarta",
    durationMinutes: 30,
    earliestStartAt: "2026-09-22T11:00:00.000Z",
    latestStartAt: "2026-10-22T10:00:00.000Z",
  },
};

test("appointment decision, status history, audit, and outbox commit together", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(appointmentDecisionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 1, 1, 1, 1, 1]);
    const appointment = d1.sqlite.prepare("SELECT status, version FROM appointments WHERE id = 'visit-1'").get();
    assert.equal(appointment.status, "APPROVED");
    assert.equal(appointment.version, 4);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM appointment_status_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE id = 'credit-1'").get().available_credits, 1);
    assert.equal(d1.sqlite.prepare("SELECT reserved_credits FROM credit_accounts WHERE id = 'credit-1'").get().reserved_credits, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = 'visit-1' AND entry_type = 'RESERVATION'").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE appointment_id = 'visit-1'").get().count, 2);
  } finally { d1.close(); }
});

test("a stale decision produces no status, history, audit, or outbox writes", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(appointmentDecisionStatements(d1, { ...input, expectedVersion: 2 }));
    assert.deepEqual(results.map((result) => result.meta.changes), Array(8).fill(0));
    const appointment = d1.sqlite.prepare("SELECT status, version FROM appointments WHERE id = 'visit-1'").get();
    assert.equal(appointment.status, "UNDER_REVIEW");
    assert.equal(appointment.version, 3);
    for (const table of ["appointment_status_events", "audit_events", "outbox_events"]) {
      assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 0);
  } finally { d1.close(); }
});

test("same-millisecond competing decisions cannot write duplicate events", async () => {
  const d1 = new SQLiteD1();
  try {
    const first = await d1.batch(appointmentDecisionStatements(d1, input));
    assert.equal(first[0].meta.changes, 1);
    const retry = await d1.batch(appointmentDecisionStatements(d1, { ...input, correlationId: "correlation-2" }));
    assert.deepEqual(retry.map((result) => result.meta.changes), Array(8).fill(0));
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
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 0);
  } finally { d1.close(); }
});

test("approval does not reserve a credit when the account has no available credit", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("UPDATE credit_accounts SET available_credits = 0 WHERE id = 'credit-1';");
    const results = await d1.batch(appointmentDecisionStatements(d1, input));
    assert.equal(results[0].meta.changes, 0);
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "UNDER_REVIEW");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 0);
  } finally { d1.close(); }
});

test("approval fails atomically when no device is available", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("DELETE FROM resources WHERE id = 'device-1';");
    const results = await d1.batch(appointmentDecisionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), Array(8).fill(0));
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "UNDER_REVIEW");
    assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE id = 'credit-1'").get().available_credits, 2);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 0);
  } finally { d1.close(); }
});

test("approval refuses a facility lockdown, inactive prisoner, or revoked relationship", async () => {
  const mutations = [
    "UPDATE facilities SET current_state = 'LOCKDOWN' WHERE id = 'facility-1';",
    "UPDATE prisoners SET status = 'RELEASED' WHERE id = 'prisoner-1';",
    "UPDATE visitor_relationships SET status = 'REVOKED' WHERE visitor_user_id = 'visitor-1';",
  ];
  for (const mutation of mutations) {
    const d1 = new SQLiteD1();
    try {
      d1.sqlite.exec(mutation);
      const results = await d1.batch(appointmentDecisionStatements(d1, input));
      assert.deepEqual(results.map((result) => result.meta.changes), Array(8).fill(0), mutation);
      assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "UNDER_REVIEW");
      assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries").get().count, 0);
      assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations").get().count, 0);
      assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 0);
    } finally { d1.close(); }
  }
});

test("approval atomically refuses a changed policy or overlapping approved visit", async () => {
  const mutations = [
    "UPDATE visit_policies SET version = 2 WHERE facility_id = 'facility-1';",
    "UPDATE facilities SET timezone = 'Asia/Makassar' WHERE id = 'facility-1';",
    "UPDATE appointments SET duration_minutes = 15 WHERE id = 'visit-1';",
    "INSERT INTO appointments VALUES ('visit-2', 'facility-1', 'visitor-1', 'prisoner-1', 'APPROVED', 1, '2026-10-01T09:15:00.000Z', '2026-10-01T09:45:00.000Z', 'Asia/Jakarta', 1, 30, 'before', NULL);",
  ];
  for (const mutation of mutations) {
    const d1 = new SQLiteD1();
    try {
      d1.sqlite.exec(mutation);
      const results = await d1.batch(appointmentDecisionStatements(d1, input));
      assert.deepEqual(results.map((result) => result.meta.changes), Array(8).fill(0), mutation);
      assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "UNDER_REVIEW");
      assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = 'visit-1'").get().count, 0);
      assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE appointment_id = 'visit-1'").get().count, 0);
      assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = 'visit-1'").get().count, 0);
    } finally { d1.close(); }
  }
});

test("approval retry completes an earlier reservation without reserving twice", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec(`
      UPDATE credit_accounts SET available_credits = 1, reserved_credits = 1 WHERE id = 'credit-1';
      INSERT INTO credit_ledger_entries VALUES ('ledger-existing', 'credit-1', 'visit-1', 'RESERVATION', -1, 'visit-1:reservation', 'Earlier approval attempt', 'staff-1', 'before');
      INSERT INTO resource_reservations VALUES ('rr-room', 'facility-1', 'visit-1', 'ROOM', 'room-1', 'RESERVED', '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'before');
      INSERT INTO resource_reservations VALUES ('rr-device', 'facility-1', 'visit-1', 'DEVICE', 'device-1', 'RESERVED', '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'before');
    `);
    const results = await d1.batch(appointmentDecisionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 0, 0, 0, 0, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE id = 'credit-1'").get().available_credits, 1);
    assert.equal(d1.sqlite.prepare("SELECT reserved_credits FROM credit_accounts WHERE id = 'credit-1'").get().reserved_credits, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = 'visit-1' AND entry_type = 'RESERVATION'").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE appointment_id = 'visit-1'").get().count, 2);
  } finally { d1.close(); }
});

test("cancellation releases reserved credit and resources in the status transaction", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec(`
      UPDATE appointments SET status = 'APPROVED', version = 4 WHERE id = 'visit-1';
      UPDATE credit_accounts SET available_credits = 1, reserved_credits = 1 WHERE id = 'credit-1';
      INSERT INTO credit_ledger_entries VALUES ('ledger-existing', 'credit-1', 'visit-1', 'RESERVATION', -1, 'visit-1:reservation', 'Approved visit', 'staff-1', 'before');
      INSERT INTO resource_reservations VALUES ('rr-room', 'facility-1', 'visit-1', 'ROOM', 'room-1', 'RESERVED', '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'before');
      INSERT INTO resource_reservations VALUES ('rr-device', 'facility-1', 'visit-1', 'DEVICE', 'device-1', 'RESERVED', '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'before');
    `);
    const cancel = { ...input, fromStatus: "APPROVED", toStatus: "CANCELLED_BY_FACILITY", expectedVersion: 4, command: "cancel", creditAccountId: "credit-1", approval: undefined };
    const results = await d1.batch(appointmentDecisionStatements(d1, cancel));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 2, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "CANCELLED_BY_FACILITY");
    assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE id = 'credit-1'").get().available_credits, 2);
    assert.equal(d1.sqlite.prepare("SELECT reserved_credits FROM credit_accounts WHERE id = 'credit-1'").get().reserved_credits, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = 'visit-1' AND entry_type = 'RESERVATION_RELEASE'").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE appointment_id = 'visit-1' AND status = 'RELEASED'").get().count, 2);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
  } finally { d1.close(); }
});

test("no-show closes the waiting room and releases reserved credit and resources atomically", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec(`
      UPDATE appointments SET status = 'WAITING', version = 4 WHERE id = 'visit-1';
      UPDATE credit_accounts SET available_credits = 1, reserved_credits = 1 WHERE id = 'credit-1';
      INSERT INTO credit_ledger_entries VALUES ('ledger-existing', 'credit-1', 'visit-1', 'RESERVATION', -1, 'visit-1:reservation', 'Approved visit', 'staff-1', 'before');
      INSERT INTO resource_reservations VALUES ('rr-room', 'facility-1', 'visit-1', 'ROOM', 'room-1', 'RESERVED', '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'before');
      INSERT INTO resource_reservations VALUES ('rr-device', 'facility-1', 'visit-1', 'DEVICE', 'device-1', 'RESERVED', '2026-10-01T09:00:00.000Z', '2026-10-01T09:30:00.000Z', 'before');
      INSERT INTO waiting_room_sessions VALUES ('visit-1', 'facility-1', 'LATE', 1, 'before', 'before');
    `);
    const noShow = { ...input, fromStatus: "WAITING", toStatus: "NO_SHOW", expectedVersion: 4, command: "no_show", creditAccountId: "credit-1", approval: undefined };
    const results = await d1.batch(appointmentDecisionStatements(d1, noShow));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 2, 1, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "NO_SHOW");
    assert.equal(d1.sqlite.prepare("SELECT state FROM waiting_room_sessions WHERE appointment_id = 'visit-1'").get().state, "NO_SHOW");
    assert.equal(d1.sqlite.prepare("SELECT available_credits FROM credit_accounts WHERE id = 'credit-1'").get().available_credits, 2);
    assert.equal(d1.sqlite.prepare("SELECT reserved_credits FROM credit_accounts WHERE id = 'credit-1'").get().reserved_credits, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE appointment_id = 'visit-1' AND entry_type = 'RESERVATION_RELEASE'").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE appointment_id = 'visit-1' AND status = 'RELEASED'").get().count, 2);
  } finally { d1.close(); }
});
