import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("scanner callback history is append-only", async () => {
  const migration = await readFile("drizzle/0091_immutable_evidence_scan_events.sql", "utf8");
  assert.match(migration, /evidence_scan_events_immutable_update/);
  assert.match(migration, /evidence_scan_events_immutable_delete/);
  assert.match(migration, /evidence scan events are append-only/);
});
