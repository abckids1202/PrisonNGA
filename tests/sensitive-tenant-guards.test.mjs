import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function applyMigration(database) {
  const migration = readFileSync(new URL("../drizzle/0097_sensitive_tenant_guards.sql", import.meta.url), "utf8");
  for (const statement of migration.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean)) database.exec(statement);
}

test("sensitive records reject cross-tenant parent and facility links", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      CREATE TABLE facilities (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
      CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE verification_cases (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, relationship_id TEXT);
      CREATE TABLE evidence_documents (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, verification_case_id TEXT);
      CREATE TABLE appointments (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE visit_sessions (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE resources (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE incidents (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, appointment_id TEXT, session_id TEXT, resource_id TEXT);
      CREATE TABLE visit_policies (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE appointment_types (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE credit_accounts (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE recordings (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, session_id TEXT);
      CREATE TABLE recording_consents (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, session_id TEXT);
      CREATE TABLE legal_holds (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE retention_policies (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
    `);
    applyMigration(database);
    database.exec("INSERT INTO organizations VALUES ('org-a'), ('org-b'); INSERT INTO facilities VALUES ('facility-a', 'org-a'), ('facility-b', 'org-b');");
    database.exec("INSERT INTO visitor_relationships VALUES ('relationship-a', 'org-a', 'facility-a'); INSERT INTO verification_cases VALUES ('case-a', 'org-a', 'facility-a', 'relationship-a'); INSERT INTO visit_sessions VALUES ('session-a', 'org-a', 'facility-a'); INSERT INTO appointments VALUES ('appointment-a', 'org-a', 'facility-a'), ('appointment-b', 'org-b', 'facility-b'); INSERT INTO resources VALUES ('resource-a', 'org-a', 'facility-a');");
    assert.throws(() => database.prepare("INSERT INTO verification_cases VALUES (?, ?, ?, ?)").run("case-bad", "org-b", "facility-b", "relationship-a"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO evidence_documents VALUES (?, ?, ?, ?)").run("evidence-bad", "org-b", "facility-b", "case-a"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO incidents VALUES (?, ?, ?, ?, ?, ?)").run("incident-bad", "org-a", "facility-a", "appointment-b", "session-a", "resource-a"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO recordings VALUES (?, ?, ?, ?)").run("recording-bad", "org-b", "facility-b", "session-a"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO legal_holds VALUES (?, ?, ?)").run("hold-bad", "org-a", "facility-b"), /TENANT_SCOPE_MISMATCH/);
    database.prepare("INSERT INTO recording_consents VALUES (?, ?, ?, ?)").run("consent-fill", null, "facility-a", "session-a");
  } finally {
    database.close();
  }
});
