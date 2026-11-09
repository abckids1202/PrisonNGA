import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("scheduled tenant integrity reconciliation covers facility-owned records and durable alarms", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /const tenantScopedFacilityTables = \[/);
  assert.match(source, /t\.organization_id IS NULL OR t\.organization_id <> f\.organization_id/);
  assert.match(source, /TENANT_INTEGRITY_RECONCILIATION_REQUIRED/);
  assert.match(source, /json_extract\(se\.metadata, '\$\.table'\)/);
  assert.match(source, /credit_ledger_entries/);
  assert.match(source, /incident_events/);
  assert.match(source, /cl\.organization_id IS NULL OR cl\.organization_id <> ca\.organization_id/);
  assert.match(source, /ie\.organization_id IS NULL OR ie\.organization_id <> i\.organization_id/);
  assert.match(source, /runScheduledJob\(env, "tenant-integrity"/);
});
