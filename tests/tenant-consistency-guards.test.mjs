import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function applyMigration(database) {
  const migration = readFileSync(new URL("../drizzle/0096_tenant_consistency_guards.sql", import.meta.url), "utf8");
  for (const statement of migration.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean)) database.exec(statement);
}

test("tenant consistency guards reject cross-facility and cross-organization writes", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      CREATE TABLE facilities (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
      CREATE TABLE appointments (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE waiting_room_sessions (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, appointment_id TEXT);
      CREATE TABLE visit_sessions (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, appointment_id TEXT);
      CREATE TABLE resources (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE resource_reservations (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, resource_id TEXT, appointment_id TEXT);
      CREATE TABLE kiosk_credentials (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, resource_id TEXT);
      CREATE TABLE prisoners (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE visitor_relationships (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, prisoner_id TEXT);
      CREATE TABLE payment_intents (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT);
      CREATE TABLE payment_refund_requests (id TEXT PRIMARY KEY, organization_id TEXT, facility_id TEXT, payment_intent_id TEXT);
    `);
    applyMigration(database);
    database.exec("INSERT INTO organizations VALUES ('org-a'), ('org-b'); INSERT INTO facilities VALUES ('facility-a', 'org-a'), ('facility-b', 'org-b');");
    database.prepare("INSERT INTO appointments VALUES (?, ?, ?)").run("appointment-a", "org-a", "facility-a");
    database.prepare("INSERT INTO resources VALUES (?, ?, ?)").run("resource-a", "org-a", "facility-a");
    database.prepare("INSERT INTO prisoners VALUES (?, ?, ?)").run("prisoner-a", "org-a", "facility-a");
    database.prepare("INSERT INTO payment_intents VALUES (?, ?, ?)").run("payment-a", "org-a", "facility-a");
    assert.throws(() => database.prepare("INSERT INTO appointments VALUES (?, ?, ?)").run("bad", "org-a", "facility-b"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO waiting_room_sessions VALUES (?, ?, ?, ?)").run("waiting-bad", "org-a", "facility-a", "missing"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO resource_reservations VALUES (?, ?, ?, ?, ?)").run("reservation-bad", "org-a", "facility-a", "resource-a", "missing"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO visitor_relationships VALUES (?, ?, ?, ?)").run("relationship-bad", "org-a", "facility-a", "missing"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO payment_refund_requests VALUES (?, ?, ?, ?)").run("refund-bad", "org-a", "facility-b", "payment-a"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("UPDATE appointments SET facility_id = ? WHERE id = ?").run("facility-b", "appointment-a"), /TENANT_SCOPE_MISMATCH/);
  } finally {
    database.close();
  }
});
