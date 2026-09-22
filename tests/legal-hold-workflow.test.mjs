import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createLegalHoldStatements, legalHoldTargetExists, releaseLegalHoldStatements } from "../lib/server/legal-hold-workflow.ts";

class D1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE verification_cases (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL);
      CREATE TABLE evidence_documents (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, verification_case_id TEXT NOT NULL, legal_hold INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
      CREATE TABLE legal_holds (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, released_by TEXT, released_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, created_at TEXT);
      INSERT INTO verification_cases VALUES ('case-1', 'facility-1');
      INSERT INTO evidence_documents VALUES ('evidence-1', 'facility-1', 'case-1', 0, 'before');
    `);
  }
  prepare(sql) {
    const sqlite = this.sqlite;
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
    };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}

function event(actionType, holdId, entityId = "case-1") {
  return { actorUserId: "staff-1", actorRole: "Auditor", facilityId: "facility-1", actionType, entityType: "verification_case", entityId, reason: "Legal review requires preservation", oldValues: null, newValues: { holdId }, requestId: "request-1", correlationId: `cor-${holdId}`, eventType: actionType, payload: { holdId } };
}

function create(d1, id) {
  const now = `2026-09-22T10:0${id.endsWith("2") ? "1" : "0"}:00.000Z`;
  return d1.batch(createLegalHoldStatements(d1, { id, facilityId: "facility-1", entityType: "verification_case", entityId: "case-1", reason: "Legal review requires preservation", actorUserId: "staff-1", now }, event("LEGAL_HOLD_CREATED", id)));
}

function release(d1, id, now = "2026-09-22T11:00:00.000Z") {
  return d1.batch(releaseLegalHoldStatements(d1, { id, facilityId: "facility-1", entityType: "verification_case", entityId: "case-1", actorUserId: "staff-1", now }, event("LEGAL_HOLD_RELEASED", id)));
}

test("legal holds reject missing or unsupported facility-scoped targets", async () => {
  const d1 = new D1();
  try {
    assert.equal(await legalHoldTargetExists(d1, "facility-1", "verification_case", "case-1"), true);
    assert.equal(await legalHoldTargetExists(d1, "facility-2", "verification_case", "case-1"), false);
    assert.equal(await legalHoldTargetExists(d1, "facility-1", "unsupported", "case-1"), false);
  } finally { d1.close(); }
});

test("overlapping holds keep evidence retained until the last active hold is released", async () => {
  const d1 = new D1();
  try {
    await create(d1, "hold-1");
    await create(d1, "hold-2");
    assert.equal(d1.sqlite.prepare("SELECT legal_hold FROM evidence_documents WHERE id = 'evidence-1'").get().legal_hold, 1);
    await release(d1, "hold-1");
    assert.equal(d1.sqlite.prepare("SELECT legal_hold FROM evidence_documents WHERE id = 'evidence-1'").get().legal_hold, 1);
    await release(d1, "hold-2", "2026-09-22T11:01:00.000Z");
    assert.equal(d1.sqlite.prepare("SELECT legal_hold FROM evidence_documents WHERE id = 'evidence-1'").get().legal_hold, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 4);
  } finally { d1.close(); }
});

test("legal-hold release retry has no side effects and audit failure rolls back create/release", async () => {
  const d1 = new D1();
  try {
    await create(d1, "hold-1");
    await release(d1, "hold-1");
    const retry = await release(d1, "hold-1");
    assert.equal(retry[0].meta.changes, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 2);

    d1.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    await assert.rejects(create(d1, "hold-2"), /audit unavailable/);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM legal_holds").get().count, 1);
    assert.equal(d1.sqlite.prepare("SELECT legal_hold FROM evidence_documents WHERE id = 'evidence-1'").get().legal_hold, 0);
  } finally { d1.close(); }
});

test("legal-hold release rolls back both hold state and evidence flags when audit persistence fails", async () => {
  const d1 = new D1();
  try {
    await create(d1, "hold-1");
    d1.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    await assert.rejects(release(d1, "hold-1"), /audit unavailable/);
    assert.equal(d1.sqlite.prepare("SELECT status FROM legal_holds WHERE id = 'hold-1'").get().status, "ACTIVE");
    assert.equal(d1.sqlite.prepare("SELECT legal_hold FROM evidence_documents WHERE id = 'evidence-1'").get().legal_hold, 1);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
  } finally { d1.close(); }
});
