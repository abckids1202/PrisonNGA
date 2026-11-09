import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/control/appointment-types/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../drizzle/0045_appointment_types.sql", import.meta.url), "utf8");
const panel = await readFile(new URL("../app/components/AppointmentTypesPanel.tsx", import.meta.url), "utf8");
const permission = await readFile(new URL("../drizzle/0065_appointment_type_manage_permission.sql", import.meta.url), "utf8");

test("appointment type changes require version, idempotency, step-up, history, audit, and outbox", () => {
  assert.match(route, /export async function POST/);
  assert.match(route, /appointment-type-create:/);
  assert.match(route, /APPOINTMENT_TYPE_CODE_IN_USE/);
  assert.match(route, /purpose: "appointment_type_create"/);
  assert.match(route, /APPOINTMENT_TYPE_CREATED/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /requirePermission\("appointment_type\.manage"\)/);
  assert.match(route, /requireStepUp\(\{ purpose: "appointment_type_change"/);
  assert.match(route, /completeIdempotencyStatement/);
  assert.match(route, /appointment_type_history/);
  assert.match(route, /auditAndOutboxStatements/);
  assert.match(migration, /appointment_type_history/);
  assert.match(panel, /Create appointment type · requires supervisor step-up/);
  assert.match(panel, /method: "POST"/);
  assert.match(panel, /duration_minutes/);
  assert.match(panel, /credit_cost/);
  assert.match(permission, /appointment_type\.manage/);
});
