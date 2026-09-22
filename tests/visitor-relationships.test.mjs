import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createVisitorRelationshipStatements } from "../lib/server/visitor-relationships.ts";

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
      CREATE TABLE prisoners (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, status TEXT NOT NULL, visitation_status TEXT NOT NULL);
      CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, visitor_user_id TEXT NOT NULL, prisoner_id TEXT NOT NULL, relationship_type TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(visitor_user_id, prisoner_id));
      CREATE TABLE verification_cases (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, relationship_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, evidence_required INTEGER NOT NULL, submitted_at TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT, facility_id TEXT, payload TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO prisoners VALUES ('prisoner-1', 'facility-1', 'ACTIVE', 'APPROVED');
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
  relationshipId: "relationship-1",
  verificationId: "verification-1",
  facilityId: "facility-1",
  visitorUserId: "visitor-1",
  prisonerId: "prisoner-1",
  relationshipType: "Sibling",
  now: "2026-09-22T12:00:00.000Z",
  requestId: "request-1",
  correlationId: "correlation-1",
};

test("relationship, verification case, audit, and outbox are created together", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(createVisitorRelationshipStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status FROM visitor_relationships WHERE id = 'relationship-1'").get().status, "PENDING");
    assert.equal(d1.sqlite.prepare("SELECT relationship_id FROM verification_cases WHERE id = 'verification-1'").get().relationship_id, "relationship-1");
    assert.equal(d1.sqlite.prepare("SELECT action_type FROM audit_events").get().action_type, "RELATIONSHIP_SUBMITTED");
    assert.equal(d1.sqlite.prepare("SELECT event_type FROM outbox_events").get().event_type, "RELATIONSHIP_SUBMITTED");
  } finally { d1.close(); }
});

test("duplicate submission creates no orphan case, duplicate audit, or duplicate event", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec(`INSERT INTO visitor_relationships VALUES ('existing-relationship', 'facility-1', 'visitor-1', 'prisoner-1', 'Sibling', 'PENDING', 1, 'before', 'before');`);
    const results = await d1.batch(createVisitorRelationshipStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [0, 0, 0, 0]);
    for (const table of ["visitor_relationships", "verification_cases", "audit_events", "outbox_events"]) {
      assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, table === "visitor_relationships" ? 1 : 0);
    }
  } finally { d1.close(); }
});

test("eligibility changing before the write produces no partial records", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("UPDATE prisoners SET visitation_status = 'SUSPENDED' WHERE id = 'prisoner-1';");
    const results = await d1.batch(createVisitorRelationshipStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [0, 0, 0, 0]);
    for (const table of ["visitor_relationships", "verification_cases", "audit_events", "outbox_events"]) {
      assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  } finally { d1.close(); }
});

test("audit failure rolls the relationship and verification case back", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("CREATE TRIGGER fail_relationship_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    await assert.rejects(d1.batch(createVisitorRelationshipStatements(d1, input)), /audit unavailable/);
    for (const table of ["visitor_relationships", "verification_cases", "audit_events", "outbox_events"]) {
      assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  } finally { d1.close(); }
});
