import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("operational audit and state history is append-only with scope-fill compatibility", async () => {
  const migration = await readFile("drizzle/0089_append_only_operational_history.sql", "utf8");
  for (const [table, label] of [
    ["audit_events", "audit events"],
    ["security_events", "security events"],
    ["appointment_status_events", "appointment status events"],
    ["visit_session_events", "visit session events"],
  ]) {
    assert.match(migration, new RegExp(`${table}_immutable_update`));
    assert.match(migration, new RegExp(`${table}_immutable_delete`));
    assert.match(migration, new RegExp(`RAISE\\(ABORT, '${label} are append-only'\\)`));
  }
  assert.match(migration, /OLD\.`organization_id` IS NULL/);
  assert.match(migration, /NEW\.`organization_id` = \(SELECT `organization_id` FROM `facilities`/);
  assert.match(migration, /NEW\.`organization_id` = \(SELECT `organization_id` FROM `appointments`/);
  assert.match(migration, /NEW\.`organization_id` = \(SELECT `organization_id` FROM `visit_sessions`/);
});
