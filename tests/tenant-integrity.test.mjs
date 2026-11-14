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

test("facility closures carry organization scope and database guards", async () => {
  const migration = await readFile(new URL("../drizzle/0092_facility_closure_organization_scope.sql", import.meta.url), "utf8");
  const readiness = await readFile(new URL("../app/api/health/readiness/route.ts", import.meta.url), "utf8");
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE `facility_closures` ADD COLUMN `organization_id`/);
  assert.match(migration, /facility_closures_organization_guard/);
  assert.match(migration, /facility_closures_organization_fill/);
  assert.match(migration, /facility_closures_organization_update_guard/);
  assert.match(readiness, /facility_closures: \["organization_id"\]/);
  assert.match(source, /"legal_holds", "facility_closures", "break_glass_requests", "appointment_status_events"/);
});

test("kiosk device-check evidence carries organization scope and database guards", async () => {
  const migration = await readFile(new URL("../drizzle/0093_kiosk_device_check_organization_scope.sql", import.meta.url), "utf8");
  const readiness = await readFile(new URL("../app/api/health/readiness/route.ts", import.meta.url), "utf8");
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE `kiosk_device_check_attempts` ADD COLUMN `organization_id`/);
  assert.match(migration, /kiosk_device_check_organization_guard/);
  assert.match(migration, /kiosk_device_check_organization_fill/);
  assert.match(migration, /kiosk_device_check_organization_update_guard/);
  assert.match(readiness, /kiosk_device_check_attempts: \["organization_id"\]/);
  assert.match(source, /visitor_device_check_attempts", "kiosk_device_check_attempts/);
});

test("tenant integrity reconciliation covers scoped evidence, audit, access, and outbox records", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /"legal_holds", "facility_closures", "break_glass_requests"/);
  assert.match(source, /"incidents", "evidence_scan_events", "audit_events", "outbox_events", "security_events"/);
});
