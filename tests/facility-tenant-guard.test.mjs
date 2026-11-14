import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("facilities require an active organization scope", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE organizations (id TEXT PRIMARY KEY, status TEXT NOT NULL); CREATE TABLE facilities (id TEXT PRIMARY KEY, organization_id TEXT);");
    const migration = readFileSync(new URL("../drizzle/0099_facility_tenant_guard.sql", import.meta.url), "utf8");
    for (const statement of migration.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean)) database.exec(statement);
    database.exec("INSERT INTO organizations VALUES ('org-a', 'ACTIVE'), ('org-disabled', 'DISABLED');");
    database.prepare("INSERT INTO facilities VALUES (?, ?)").run("facility-a", "org-a");
    assert.throws(() => database.prepare("INSERT INTO facilities VALUES (?, ?)").run("facility-b", "org-missing"), /FACILITY_ORGANIZATION_REQUIRED/);
    assert.throws(() => database.prepare("INSERT INTO facilities VALUES (?, ?)").run("facility-c", "org-disabled"), /FACILITY_ORGANIZATION_REQUIRED/);
    assert.throws(() => database.prepare("UPDATE facilities SET organization_id = NULL WHERE id = ?").run("facility-a"), /FACILITY_ORGANIZATION_REQUIRED/);
  } finally {
    database.close();
  }
});
