import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor relationship queries keep related records inside the same facility", async () => {
  const relationshipsRoute = await readFile(new URL("../app/api/visitor/relationships/route.ts", import.meta.url), "utf8");
  const appointmentsRoute = await readFile(new URL("../app/api/visitor/appointments/route.ts", import.meta.url), "utf8");
  const evidenceRoute = await readFile(new URL("../app/api/visitor/verification/evidence/route.ts", import.meta.url), "utf8");

  assert.match(relationshipsRoute, /p\.id = vr\.prisoner_id AND p\.facility_id = vr\.facility_id/);
  assert.match(relationshipsRoute, /vc\.relationship_id = vr\.id AND vc\.facility_id = vr\.facility_id/);
  assert.match(relationshipsRoute, /WHERE vr\.visitor_user_id = \? AND vr\.facility_id = \? AND vr\.prisoner_id = \?/);
  assert.match(relationshipsRoute, /\.bind\(visitor\.userId, facilityId, prisonerId\)/);
  assert.match(appointmentsRoute, /p\.id = vr\.prisoner_id AND p\.facility_id = vr\.facility_id/);
  assert.match(evidenceRoute, /vr\.id = vc\.relationship_id AND vr\.facility_id = vc\.facility_id/);
});
