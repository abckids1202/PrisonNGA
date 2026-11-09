import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("inherited tenant records reject explicit cross-organization inserts", async () => {
  const migration = await readFile("drizzle/0086_inherited_tenant_scope_guards.sql", "utf8");
  assert.match(migration, /credit_ledger_entries_organization_guard/);
  assert.match(migration, /RAISE\(ABORT, 'credit ledger organization scope mismatch'\)/);
  assert.match(migration, /incident_events_organization_guard/);
  assert.match(migration, /RAISE\(ABORT, 'incident event organization scope mismatch'\)/);
  assert.match(migration, /incident_events_organization_fill/);
  assert.match(migration, /FROM `credit_accounts` ca/);
  assert.match(migration, /FROM `incidents`/);
});
