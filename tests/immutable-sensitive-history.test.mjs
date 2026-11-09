import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("sensitive financial, incident, and recording access history is append-only", async () => {
  const migration = await readFile("drizzle/0087_immutable_sensitive_history.sql", "utf8");
  for (const [table, label] of [
    ["credit_ledger_entries", "credit ledger entries"],
    ["incident_events", "incident events"],
    ["recording_access_events", "recording access events"],
  ]) {
    assert.match(migration, new RegExp(`${table}_immutable_update`));
    assert.match(migration, new RegExp(`${table}_immutable_delete`));
    assert.match(migration, new RegExp(`RAISE\\(ABORT, '${label} are append-only'\\)`));
  }
});
