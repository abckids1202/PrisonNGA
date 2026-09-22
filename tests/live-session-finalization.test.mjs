import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { finalizeLiveSessionStatements } from "../lib/server/live-session-finalization.ts";

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
      CREATE TABLE visit_session_events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL, source TEXT NOT NULL, participant_role TEXT, metadata TEXT, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT, facility_id TEXT, payload TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO visit_sessions VALUES ('session-1', 'visit-1', 'facility-1', 'ACTIVE', 3, NULL, NULL, 'before');
      INSERT INTO appointments VALUES ('visit-1', 'facility-1', 'IN_PROGRESS', 5, 'before');
      INSERT INTO credit_accounts VALUES ('account-1', 'facility-1', 0, 1, 2, 'before');
      INSERT INTO credit_ledger_entries VALUES ('reservation-1', 'account-1', 'visit-1', 'RESERVATION', -1, 'visit-1:reservation', 'reserved', 'staff-1', 'before');
      INSERT INTO resource_reservations VALUES ('room-1', 'facility-1', 'visit-1', 'ACTIVE');
      INSERT INTO resource_reservations VALUES ('device-1', 'facility-1', 'visit-1', 'RESERVED');
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
  appointmentVersion: 5,
  creditAccountId: "account-1",
  actorUserId: "system:livekit",
  actorRole: "SYSTEM",
  requestId: "request-1",
  correlationId: "correlation-1",
  now: "2026-09-22T12:00:00.000Z",
  reason: "LiveKit room completed.",
  providerEvent: {
    id: "provider-event-1",
    eventType: "PROVIDER_ROOM_FINISHED",
    participantRole: null,
    metadata: { roomName: "securevisit-room-1" },
  },
};

test("session end, appointment completion, resources, credit, audit, and outbox commit atomically", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(finalizeLiveSessionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 2, 1, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status, version FROM visit_sessions WHERE id = 'session-1'").get().status, "ENDED");
    assert.equal(d1.sqlite.prepare("SELECT status FROM appointments WHERE id = 'visit-1'").get().status, "COMPLETED");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM resource_reservations WHERE status <> 'RELEASED'").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT entry_type FROM credit_ledger_entries WHERE appointment_id = 'visit-1' AND entry_type = 'CONSUMPTION'").get().entry_type, "CONSUMPTION");
    const balance = d1.sqlite.prepare("SELECT available_credits, reserved_credits FROM credit_accounts WHERE id = 'account-1'").get();
    assert.equal(balance.available_credits, 0);
    assert.equal(balance.reserved_credits, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
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
