import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/features/management/VisitationPage.tsx", import.meta.url), "utf8");

test("Visitation workspace routes supported tabs to authoritative persisted workflows", () => {
  assert.match(source, /const connected = \["Visit Policies", "Appointment Types", "Availability Rules", "Operating Hours", "Closures"\]\.includes\(tab\)/);
  assert.match(source, /\["Visit Policies", "Availability Rules", "Operating Hours"\]\.includes\(tab\) \? <VisitPolicyEditor timeZone=\{timeZone\} \/>/);
  assert.match(source, /tab === "Closures" \? <FacilityClosures timeZone=\{timeZone\} \/>/);
  assert.match(source, /tab === "Appointment Types" \? <AppointmentTypesPanel \/>/);
});
