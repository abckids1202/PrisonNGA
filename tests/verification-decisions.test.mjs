import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { verificationDecisionStatements } from "../lib/server/verification-decisions.ts";

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
      CREATE TABLE verification_cases (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, relationship_id TEXT NOT NULL, status TEXT NOT NULL, evidence_required INTEGER NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, status TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT, version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE evidence_documents (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, verification_case_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT, facility_id TEXT, payload TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO verification_cases VALUES ('case-1', 'facility-1', 'relationship-1', 'PENDING', 1, NULL, NULL, NULL, 4, 'before');
      INSERT INTO visitor_relationships VALUES ('relationship-1', 'facility-1', 'PENDING', NULL, NULL, NULL, 2, 'before');
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
  verificationCaseId: "case-1",
  relationshipId: "relationship-1",
  facilityId: "facility-1",
  fromStatus: "PENDING",
  toStatus: "APPROVED",
  expectedCaseVersion: 4,
  fromRelationshipStatus: "PENDING",
  expectedRelationshipVersion: 2,
  relationshipStatus: "APPROVED",
  evidenceRequired: true,
  actorUserId: "staff-1",
  actorRole: "Verification Officer",
  reason: "Identity and relationship evidence reviewed.",
  requestId: "request-1",
  correlationId: "correlation-1",
  now: "2026-09-22T12:00:00.000Z",
};

test("verification approval requires available evidence and has no partial side effects", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(verificationDecisionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [0, 0, 0, 0]);
    assert.equal(d1.sqlite.prepare("SELECT status FROM verification_cases WHERE id = 'case-1'").get().status, "PENDING");
    assert.equal(d1.sqlite.prepare("SELECT status FROM visitor_relationships WHERE id = 'relationship-1'").get().status, "PENDING");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 0);
  } finally { d1.close(); }
});

test("evidenced verification approval updates the relationship and audit trail together", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("INSERT INTO evidence_documents VALUES ('evidence-1', 'facility-1', 'case-1', 'AVAILABLE');");
    const results = await d1.batch(verificationDecisionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status, version FROM verification_cases WHERE id = 'case-1'").get().status, "APPROVED");
    assert.equal(d1.sqlite.prepare("SELECT status, version FROM visitor_relationships WHERE id = 'relationship-1'").get().status, "APPROVED");
    assert.equal(d1.sqlite.prepare("SELECT action_type FROM audit_events").get().action_type, "VERIFICATION_APPROVED");
    assert.equal(d1.sqlite.prepare("SELECT event_type FROM outbox_events").get().event_type, "VERIFICATION_APPROVED");
  } finally { d1.close(); }
});

test("stale concurrent verification reviews cannot change state or emit events", async () => {
  const d1 = new SQLiteD1();
  try {
    d1.sqlite.exec("UPDATE verification_cases SET version = 5 WHERE id = 'case-1';");
    d1.sqlite.exec("INSERT INTO evidence_documents VALUES ('evidence-1', 'facility-1', 'case-1', 'AVAILABLE');");
    const results = await d1.batch(verificationDecisionStatements(d1, input));
    assert.deepEqual(results.map((result) => result.meta.changes), [0, 0, 0, 0]);
    assert.equal(d1.sqlite.prepare("SELECT status FROM visitor_relationships WHERE id = 'relationship-1'").get().status, "PENDING");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0);
  } finally { d1.close(); }
});

test("requesting more information synchronizes the case and relationship", async () => {
  const d1 = new SQLiteD1();
  try {
    const results = await d1.batch(verificationDecisionStatements(d1, { ...input, toStatus: "MORE_INFO", relationshipStatus: "PENDING" }));
    assert.deepEqual(results.map((result) => result.meta.changes), [1, 1, 1, 1]);
    assert.equal(d1.sqlite.prepare("SELECT status FROM verification_cases WHERE id = 'case-1'").get().status, "MORE_INFO");
    assert.equal(d1.sqlite.prepare("SELECT status FROM visitor_relationships WHERE id = 'relationship-1'").get().status, "PENDING");
  } finally { d1.close(); }
});
