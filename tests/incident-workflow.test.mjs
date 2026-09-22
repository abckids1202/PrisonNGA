import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createIncidentStatements, transitionIncidentStatements } from "../lib/server/incident-workflow.ts";

class D1 {
  sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE incidents (id TEXT PRIMARY KEY, facility_id TEXT, incident_type TEXT, severity TEXT, status TEXT, title TEXT, description TEXT, appointment_id TEXT, session_id TEXT, resource_id TEXT, reporter_user_id TEXT, assigned_user_id TEXT, resolution TEXT, version INTEGER, idempotency_key TEXT, request_hash TEXT, created_at TEXT, updated_at TEXT);
      CREATE UNIQUE INDEX incidents_create_idempotency_idx ON incidents (facility_id, reporter_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE incident_events (id TEXT PRIMARY KEY, incident_id TEXT, event_type TEXT, actor_user_id TEXT, details TEXT, correlation_id TEXT, created_at TEXT);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor_user_id TEXT, actor_role TEXT, facility_id TEXT, action_type TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, old_values TEXT, new_values TEXT, correlation_id TEXT, request_id TEXT, created_at TEXT);
      CREATE TABLE outbox_events (id TEXT PRIMARY KEY, event_type TEXT, aggregate_type TEXT, aggregate_id TEXT, facility_id TEXT, payload TEXT, correlation_id TEXT, created_at TEXT);
    `);
  }
  prepare(sql) {
    let values = [];
    const sqlite = this.sqlite;
    return {
      bind(...next) { values = next; return this; },
      async run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    };
  }
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

function auditInput(actionType, id) {
  return { actorUserId: "staff-1", actorRole: "Supervisor", facilityId: "facility-1", actionType, entityType: "incident", entityId: id, reason: "Verified operational reason", oldValues: null, newValues: { actionType }, requestId: "request-1", correlationId: `cor-${id}`, eventType: actionType, payload: { id } };
}

const createInput = { id: "incident-1", facilityId: "facility-1", incidentType: "DEVICE", severity: "HIGH", title: "Kiosk disconnected", description: "Kiosk heartbeat stopped during the visit.", appointmentId: "visit-1", sessionId: null, resourceId: "kiosk-1", reporterUserId: "staff-1", idempotencyKey: "key-hash", requestHash: "request-hash", now: "2026-09-22T10:00:00.000Z", correlationId: "cor-incident-1" };

test("incident create writes record, case history, central audit, and outbox together", async () => {
  const d1 = new D1();
  try {
    const results = await d1.batch(createIncidentStatements(d1, createInput, auditInput("INCIDENT_CREATED", createInput.id)));
    assert.equal(results[0].meta.changes, 1);
    for (const table of ["incidents", "incident_events", "audit_events", "outbox_events"]) assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1);
  } finally { d1.close(); }
});

test("incident creation retry with the same idempotency key adds no duplicate history or audit", async () => {
  const d1 = new D1();
  try {
    await d1.batch(createIncidentStatements(d1, createInput, auditInput("INCIDENT_CREATED", createInput.id)));
    const retry = await d1.batch(createIncidentStatements(d1, { ...createInput, id: "incident-retry" }, auditInput("INCIDENT_CREATED", "incident-retry")));
    assert.equal(retry[0].meta.changes, 0);
    for (const table of ["incidents", "incident_events", "audit_events", "outbox_events"]) assert.equal(d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1);
  } finally { d1.close(); }
});

test("stale concurrent incident transition writes no phantom event or audit", async () => {
  const d1 = new D1();
  try {
    await d1.batch(createIncidentStatements(d1, createInput, auditInput("INCIDENT_CREATED", createInput.id)));
    const transition = { incidentId: createInput.id, facilityId: createInput.facilityId, expectedVersion: 1, nextStatus: "ACKNOWLEDGED", nextAssignee: null, resolution: null, actorUserId: "staff-1", command: "acknowledge", details: "Acknowledged by supervisor", now: createInput.now, correlationId: "cor-transition" };
    const first = await d1.batch(transitionIncidentStatements(d1, transition, auditInput("INCIDENT_ACKNOWLEDGED", createInput.id)));
    const stale = await d1.batch(transitionIncidentStatements(d1, transition, auditInput("INCIDENT_ACKNOWLEDGED", createInput.id)));
    assert.equal(first[0].meta.changes, 1);
    assert.equal(stale[0].meta.changes, 0);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM incident_events").get().count, 2);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 2);
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 2);
    assert.equal(d1.sqlite.prepare("SELECT version FROM incidents WHERE id = ?").get(createInput.id).version, 2);
  } finally { d1.close(); }
});

test("incident update rolls back if central audit writing fails", async () => {
  const d1 = new D1();
  try {
    await d1.batch(createIncidentStatements(d1, createInput, auditInput("INCIDENT_CREATED", createInput.id)));
    d1.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    const transition = { incidentId: createInput.id, facilityId: createInput.facilityId, expectedVersion: 1, nextStatus: "ACKNOWLEDGED", nextAssignee: null, resolution: null, actorUserId: "staff-1", command: "acknowledge", details: "Acknowledged by supervisor", now: createInput.now, correlationId: "cor-transition" };
    await assert.rejects(d1.batch(transitionIncidentStatements(d1, transition, auditInput("INCIDENT_ACKNOWLEDGED", createInput.id))), /audit unavailable/);
    assert.equal(d1.sqlite.prepare("SELECT status FROM incidents WHERE id = ?").get(createInput.id).status, "OPEN");
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM incident_events").get().count, 1);
  } finally { d1.close(); }
});
