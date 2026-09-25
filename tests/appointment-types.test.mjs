import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../drizzle/0045_appointment_types.sql", import.meta.url), "utf8");
const visitorRoute = await readFile(new URL("../app/api/visitor/appointments/route.ts", import.meta.url), "utf8");
const visitorTypes = await readFile(new URL("../app/api/visitor/appointment-types/route.ts", import.meta.url), "utf8");
const controlTypes = await readFile(new URL("../app/api/control/appointment-types/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("appointment types are facility-scoped, seeded, exposed, and enforced", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS appointment_types/);
  assert.match(migration, /appointment_types_facility_code_idx/);
  assert.match(migration, /INSERT OR IGNORE INTO appointment_types/);
  assert.match(visitorRoute, /APPOINTMENT_TYPE_NOT_AVAILABLE/);
  assert.match(visitorRoute, /status = 'ACTIVE'/);
  assert.match(visitorTypes, /requireVisitorIdentity/);
  assert.match(controlTypes, /requirePermission\("facility\.read"\)/);
  assert.match(page, /tab === "Appointment Types" \? <AppointmentTypesPanel \/>/);
  assert.match(page, /\["Visit Policies", "Appointment Types", "Availability Rules", "Operating Hours", "Closures"\]\.includes\(tab\)/);
});
