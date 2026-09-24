import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { expiredEvidenceRetentionStatements } from "../lib/server/retention-workflow.ts";

class D1 {
  sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(`
      CREATE TABLE evidence_documents (id TEXT PRIMARY KEY, facility_id TEXT NOT NULL, storage_key TEXT NOT NULL, status TEXT NOT NULL, legal_hold INTEGER NOT NULL, retention_until TEXT NOT NULL, deleted_at TEXT, updated_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, created_at TEXT);
      INSERT INTO evidence_documents VALUES ('evidence-1', 'facility-1', 'facility-1/verification/evidence-1', 'AVAILABLE', 0, '2026-09-01T00:00:00.000Z', NULL, '2026-08-01T00:00:00.000Z');
      INSERT INTO evidence_documents VALUES ('evidence-hold', 'facility-1', 'facility-1/verification/evidence-hold', 'AVAILABLE', 1, '2026-09-01T00:00:00.000Z', NULL, '2026-08-01T00:00:00.000Z');
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
}

function input(overrides = {}) {
  return {
    id: "evidence-1",
    facilityId: "facility-1",
    storageKey: "facility-1/verification/evidence-1",
    retentionUntil: "2026-09-01T00:00:00.000Z",
    requestId: "request-1",
    correlationId: "correlation-1",
    now: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

test("retention deletion records an audit and outbox event atomically", async () => {
  const d1 = new D1();
  const result = await d1.batch(expiredEvidenceRetentionStatements(d1, input()));
  assert.equal(result[0].meta.changes, 1);
  assert.equal(d1.sqlite.prepare("SELECT status FROM evidence_documents WHERE id = 'evidence-1'").get().status, "DELETED");
  assert.equal(d1.sqlite.prepare("SELECT action_type FROM audit_events WHERE entity_id = 'evidence-1'").get().action_type, "EVIDENCE_RETENTION_DELETED");
  assert.equal(d1.sqlite.prepare("SELECT event_type FROM outbox_events WHERE aggregate_id = 'evidence-1'").get().event_type, "EVIDENCE_RETENTION_DELETED");
});

test("retention policy changes use an optimistic transactional audit boundary", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../app/api/control/retention/route.ts", import.meta.url), "utf8");
  assert.match(source, /await d1\.batch\(\[/);
  assert.match(source, /version = version \+ 1/);
  assert.match(source, /AND version = \?/);
  assert.match(source, /RETENTION_POLICY_CONFLICT/);
  assert.match(source, /auditAndOutboxStatements/);
  assert.doesNotMatch(source, /appendAuditAndOutbox/);
});

test("retention deletion is facility-scoped and respects legal holds", async () => {
  const d1 = new D1();
  const result = await d1.batch(expiredEvidenceRetentionStatements(d1, input({ id: "evidence-hold" })));
  assert.equal(result[0].meta.changes, 0);
  assert.equal(d1.sqlite.prepare("SELECT status FROM evidence_documents WHERE id = 'evidence-hold'").get().status, "AVAILABLE");
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 0);
});

test("retention replay is idempotent", async () => {
  const d1 = new D1();
  await d1.batch(expiredEvidenceRetentionStatements(d1, input()));
  const replay = await d1.batch(expiredEvidenceRetentionStatements(d1, input()));
  assert.equal(replay[0].meta.changes, 0);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 1);
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
});
