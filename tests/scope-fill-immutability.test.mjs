import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("append-only guards allow only the legacy organization scope fill", async () => {
  const migration = await readFile("drizzle/0088_allow_only_scope_fill_updates.sql", "utf8");
  assert.match(migration, /DROP TRIGGER IF EXISTS `credit_ledger_entries_immutable_update`/);
  assert.match(migration, /OLD\.`organization_id` IS NULL/);
  assert.match(migration, /NEW\.`organization_id` = \(SELECT `organization_id` FROM `credit_accounts`/);
  assert.match(migration, /DROP TRIGGER IF EXISTS `incident_events_immutable_update`/);
  assert.match(migration, /NEW\.`organization_id` = \(SELECT `organization_id` FROM `incidents`/);
  assert.match(migration, /DROP TRIGGER IF EXISTS `recording_access_events_immutable_update`/);
  assert.match(migration, /NEW\.`organization_id` = \(SELECT `organization_id` FROM `recordings`/);
});
