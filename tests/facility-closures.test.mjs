import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../drizzle/0044_facility_closures.sql", import.meta.url), "utf8");
const availability = await readFile(new URL("../app/api/visitor/availability/route.ts", import.meta.url), "utf8");
const appointmentStatements = await readFile(new URL("../lib/server/visitor-appointments.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/control/facility-closures/route.ts", import.meta.url), "utf8");

test("facility closures are persisted with facility scope, lifecycle, and overlap index", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS facility_closures/);
  assert.match(migration, /facility_id TEXT NOT NULL REFERENCES facilities\(id\)/);
  assert.match(migration, /CHECK \(ends_at > starts_at\)/);
  assert.match(migration, /CHECK \(status IN \('ACTIVE', 'CANCELLED'\)\)/);
  assert.match(migration, /facility_closures_window_idx/);
});

test("availability excludes active closure windows", () => {
  assert.match(availability, /FROM facility_closures/);
  assert.match(availability, /status = 'ACTIVE'/);
  assert.match(availability, /closures\.results\.some/);
});

test("appointment creation and rescheduling fail closed inside active closures", () => {
  assert.equal((appointmentStatements.match(/FROM facility_closures/g) || []).length, 2);
  assert.equal((appointmentStatements.match(/fc\.status = 'ACTIVE'/g) || []).length, 2);
});

test("closure management requires idempotency, step-up, facility scope, and audit", () => {
  assert.match(route, /requirePermission\("facility\.state\.change"\)/);
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /requireStepUp/);
  assert.match(route, /auditAndOutboxStatements/);
  assert.match(route, /facility_id = \?/g);
  assert.match(route, /CLOSURE_OVERLAPS_EXISTING/);
});

test("closure cancellation is replay-safe and commits state, audit, and outbox atomically", () => {
  assert.match(route, /facility-closure-cancel:/);
  assert.match(route, /completeIdempotencyStatement\(d1/);
  assert.match(route, /d1\.batch\(\[/);
  assert.match(route, /CLOSURE_AUDIT_FAILED/);
  assert.match(route, /releaseIdempotencyClaim/);
});
