import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("recording access evidence has database-level organization fill and mismatch protection", () => {
  const migration = fs.readFileSync("drizzle/0085_recording_access_organization_scope.sql", "utf8");
  assert.match(migration, /recording_access_events_organization_guard/);
  assert.match(migration, /RAISE\(ABORT, 'recording access organization scope mismatch'\)/);
  assert.match(migration, /recording_access_events_organization_fill/);
  assert.match(migration, /FROM `recordings`/);
  assert.match(migration, /NEW\.`recording_id`/);
  assert.match(migration, /NEW\.`facility_id`/);
});
