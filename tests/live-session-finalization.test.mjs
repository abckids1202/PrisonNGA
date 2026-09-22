import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { finalizeLiveSessionStatements, getExpiredSessionDisposition, requestLiveSessionEndStatements } from "../lib/server/live-session-finalization.ts";

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
      CREATE TABLE visit_sessions (id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL, facility_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, actual_ended_at TEXT, termination_reason TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE appointments (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, available_credits INTEGER NOT NULL, reserved_credits INTEGER NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, credit_account_id TEXT NOT NULL, appointment_id TEXT, entry_type TEXT NOT NULL, amount INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, reason TEXT, created_by TEXT, created_at TEXT NOT NULL);
      CREATE TABLE resource_reservations (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, appointment_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE waiting_room_sessions (id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL, facility_id TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE visit_session_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL, source TEXT NOT NULL, participant_role TEXT, metadata TEXT, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT, facility_id TEXT, payload TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO visit_sessions VALUES ('session-1', 'visit-1', 'facility-1', 'ACTIVE', 3, NULL, NULL, 'before');
      INSERT INTO appointments VALUES ('visit-1', 'facility-1', 'IN_PROGRESS', 5, 'before');
      INSERT INTO credit_accounts VALUES ('account-1', 'facility-1', 0, 1, 2, 'before');
      INSERT INTO credit_ledger_entries VALUES ('reservation-1', 'account-1', 'visit-1', 'RESERVATION', -1, 'visit-1:reservation', 'reserved', 'staff-1', 'before');
      INSERT INTO resource_reservations VALUES ('room-1', 'facility-1', 'visit-1', 'ACTIVE');
      INSERT INTO resource_reservations VALUES ('device-1', 'facility-1', 'visit-1', 'RESERVED');
      INSERT INTO waiting_room_sessions VALUES ('waiting-1', 'visit-1', 'facility-1', 'READY_TO_START', 2, 'before');
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
  sessionId: "session-1",
  appointmentId: "visit-1",
  facilityId: "facility-1",
  sessionVersion: 3,
  sessionStatus: "ACTIVE",
  finalSessionStatus: "ENDED",
  appointmentVersion: 5,
  finalAppointmentStatus: "COMPLETED",
  creditAccountId: "account-1",
  creditOutcome: "CONSUME",
  actorUserId: "system:livekit",
  actorRole: "SYSTEM",
  requestId: "request-1",
  correlationId: "correlation-1",
  now: "2026-09-22T12:00:00.000Z",
  reason: "LiveKit room completed.",
  event: {
    id: "provider-event-1",
    eventType: "PROVIDER_ROOM_FINISHED",
    source: "LIVEKIT_WEBHOOK",
    participantRole: null,
    metadata: { roomName: "securevisit-room-1" },
  },
};

const endRequestInput = {
  sessionId: "session-1",
  appointmentId: "visit-1",
  facilityId: "facility-1",
  sessionVersion: 3,
  sessionStatus: "ACTIVE",
  appointmentVersion: 5,
  creditAccountId: "account-1",
  actorUserId: "staff-1",
  actorRole: "Supervisor",
  requestId: "request-end-1",
  correlationId: "correlation-end-1",
  now: "2026-09-22T12:00:00.000Z",
  reason: "Staff requested session end.",
  mode: "normal",
};

test("an expired room created without participant presence releases its reserved credit", () => {
  assert.deepEqual(getExpiredSessionDisposition({ actual_started_at: null, termination_reason: null }), {
    terminationRequested: false,
    finalSessionStatus: "TERMINATED",
    finalAppointmentStatus: "TECHNICAL_FAILURE",
    creditOutcome: "RELEASE",
    eventType: "SESSION_ABANDONED",
    reason: "Live-session window expired before the visit started.",
  });
});

test("scheduled reconciliation preserves a staff termination reason and releases the credit", () => {
  assert.deepEqual(getExpiredSessionDisposition({ actual_started_at: "2026-09-22T12:00:00.000Z", termination_reason: "STAFF_TERMINATE:Safety incident." }), {
    terminationRequested: true,
    finalSessionStatus: "TERMINATED",
    finalAppointmentStatus: "TECHNICAL_FAILURE",
    creditOutcome: "RELEASE",
    eventType: "SESSION_TERMINATED",
    reason: "Safety incident.",
  });
});

test("an actually started room expiring normally completes and consumes the reserved credit", () => {
  const disposition = getExpiredSessionDisposition({ actual_started_at: "2026-09-22T12:00:00.000Z", termination_reason: null });
  assert.equal(disposition.finalSessionStatus, "ENDED");
  assert.equal(disposition.finalAppointmentStatus, "COMPLETED");
  assert.equal(disposition.creditOutcome, "CONSUME");
  assert.equal(disposition.eventType, "SESSION_EXPIRED");
});

test("staff end intent is persisted with its event, audit, and outbox before provider shutdown", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(requestLiveSessionEndStatements(d1, endRequestInput));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 1]);
    const session = d1.sqlite.prepare("SELECT status, version, termination_reason FROM visit_sessions WHERE id = 'session-1'").get();
    assert.equal(session.status, "ENDING");
    assert.equal(session.version, 4);
    assert.equal(session.termination_reason, null);
    assert.equal(d1.sqlite.prepare("SELECT event_type FROM visit_session_events").get().event_type, "SESSION_END_REQUESTED");
    assert.equal(d1.sqlite.prepare("SELECT action_type FROM audit_events").get().action_type, "VISIT_END_REQUESTED");
    assert.equal(d1.sqlite.prepare("SELECT event_type FROM outbox_events").get().event_type, "VISIT_END_REQUESTED");
  } finally { d1.close(); }
});

test("termination intent rolls back as a unit when its audit cannot be stored", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("CREATE TRIGGER fail_visit_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    await assert.rejects(d1.batch(requestLiveSessionEndStatements(d1, { ...endRequestInput, mode: "terminate", reason: "Safety incident." })), /audit unavailable/);
    const session = d1.sqlite.prepare("SELECT status, version, termination_reason FROM visit_sessions WHERE id = 'session-1'").get();
    assert.equal(session.status, "ACTIVE");
    assert.equal(session.version, 3);
    assert.equal(session.termination_reason, null);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM visit_session_events").get().count, 0);
  } finally { d1.close(); }
});

test("session end, appointment completion, resources, credit, audit, and outbox commit atomically", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(finalizeLiveSessionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 2, 1, 1, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status, version FROM visit_sessions WHERE id = 'session-1'").get().status, "ENDED");
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "COMPLETED");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE status <> 'RELEASED'").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT entry_type FROM credit_ledger_entries WHERE appointment_id = 'visit-1' AND entry_type = 'CONSUMPTION'").get().entry_type, "CONSUMPTION");
    const balance = d1.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = 'account-1'").get();
    assert.equal(balance.available_credits, 0);
    assert.equal(balance.reserved_credits, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT state FROM waiting_room_sessions WHERE id = 'waiting-1'").get().state, "COMPLETED");
  } finally { d1.close(); }
});

test("audit failure rolls back provider event, session, appointment, resources, and credit", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("CREATE TRIGGER fail_visit_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    await assert.rejects(d1.batch(finalizeLiveSessionStatements(d1, input)), /audit unavailable/);
    assert.equal(d1.sqlite.prepare("SELECT status FROM visit_sessions WHERE id = 'session-1'").get().status, "ACTIVE");
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "IN_PROGRESS");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM visit_session_events").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE status = 'RELEASED'").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'CONSUMPTION'").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT reserved_credits FROM credit_accounts WHERE id = 'account-1'").get().reserved_credits, 1);
  } finally { d1.close(); }
});

test("replayed finalization is idempotent and cannot consume or notify twice", async () => {
  const d1 = new SQLiteD1();
  try {
    await d1.batch(finalizeLiveSessionStatements(d1, input));
    const replay = await d1.batch(finalizeLiveSessionStatements(d1, input));
    assert.equal(replay[1].meta.changes, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'CONSUMPTION'").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
  } finally { d1.close(); }
});

test("missing active reservation prevents every finalization side effect", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("UPDATE credit_accounts SET reserved_credits = 0 WHERE id = 'account-1';");
    const results = await d1.batch(finalizeLiveSessionStatements(d1, input));
    assert.equal(results[0].meta.changes, 0);
    assert.equal(d1.sqlite.prepare("SELECT status FROM visit_sessions WHERE id = 'session-1'").get().status, "ACTIVE");
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "IN_PROGRESS");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM visit_session_events").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 0);
  } finally { d1.close(); }
});

test("staff termination records technical failure and releases rather than consumes the credit", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.prepare("UPDATE visit_sessions SET status = 'ENDING', version = 4, termination_reason = 'Safety incident.' WHERE id = 'session-1'").run();
    const results = await d1.batch(finalizeLiveSessionStatements(d1, {
      ...input,
      sessionVersion: 4,
      sessionStatus: "ENDING",
      finalSessionStatus: "TERMINATED",
      finalAppointmentStatus: "TECHNICAL_FAILURE",
      creditOutcome: "RELEASE",
      actorUserId: "staff-1",
      actorRole: "Supervisor",
      correlationId: "correlation-termination",
      reason: "Safety incident.",
      event: { id: "staff-event-1", eventType: "SESSION_TERMINATED", source: "STAFF", participantRole: "FACILITY", metadata: { reason: "Safety incident." } },
    }));
    assert.equal(results[1].meta.changes, 1);
    assert.equal(results[2].meta.changes, 1);
    assert.equal(d1.sqlite.prepare("SELECT status FROM visit_sessions WHERE id = 'session-1'").get().status, "TERMINATED");
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "TECHNICAL_FAILURE");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'RESERVATION_RELEASE'").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE entry_type = 'CONSUMPTION'").get().count, 0);
    const balance = d1.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = 'account-1'").get();
    assert.equal(balance.available_credits, 1);
    assert.equal(balance.reserved_credits, 0);
    assert.equal(d1.sqlite.prepare("SELECT action_type FROM audit_events").get().action_type, "VISIT_TERMINATED");
    assert.equal(d1.sqlite.prepare("SELECT state FROM waiting_room_sessions WHERE id = 'waiting-1'").get().state, "CANCELLED");
  } finally { d1.close(); }
});
