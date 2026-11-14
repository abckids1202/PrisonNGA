import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function applyMigration(database) {
  const migration = readFileSync(new URL("../drizzle/0098_staff_scope_guards.sql", import.meta.url), "utf8");
  for (const statement of migration.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean)) database.exec(statement);
}

test("staff membership and role records cannot cross organization facility scope", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      CREATE TABLE facilities (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
      CREATE TABLE organization_memberships (id TEXT PRIMARY KEY, organization_id TEXT, user_id TEXT, facility_id TEXT);
      CREATE TABLE organization_role_assignments (user_id TEXT, organization_id TEXT, role_id TEXT);
      CREATE TABLE staff_facility_assignments (user_id TEXT, organization_id TEXT, facility_id TEXT);
      CREATE TABLE user_roles (user_id TEXT, role_id TEXT, organization_id TEXT, facility_id TEXT);
      CREATE TABLE staff_profiles (user_id TEXT, organization_id TEXT, facility_id TEXT);
    `);
    applyMigration(database);
    database.exec("INSERT INTO organizations VALUES ('org-a'), ('org-b'); INSERT INTO facilities VALUES ('facility-a', 'org-a'), ('facility-b', 'org-b');");
    database.prepare("INSERT INTO organization_memberships VALUES (?, ?, ?, ?)").run("membership-a", "org-a", "user-a", "facility-a");
    database.prepare("INSERT INTO organization_role_assignments VALUES (?, ?, ?)").run("user-a", "org-a", "role-admin");
    assert.throws(() => database.prepare("INSERT INTO organization_memberships VALUES (?, ?, ?, ?)").run("membership-bad", "org-a", "user-b", "facility-b"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO organization_role_assignments VALUES (?, ?, ?)").run("user-b", "org-missing", "role-admin"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO staff_facility_assignments VALUES (?, ?, ?)").run("user-b", "org-a", "facility-b"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO user_roles VALUES (?, ?, ?, ?)").run("user-b", "role-admin", "org-a", "facility-b"), /TENANT_SCOPE_MISMATCH/);
    assert.throws(() => database.prepare("INSERT INTO staff_profiles VALUES (?, ?, ?)").run("user-b", "org-a", "facility-b"), /TENANT_SCOPE_MISMATCH/);
    database.prepare("INSERT INTO staff_facility_assignments VALUES (?, ?, ?)").run("user-a", null, "facility-a");
  } finally {
    database.close();
  }
});
