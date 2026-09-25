import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor appointment cards use the facility name returned by the scoped API", async () => {
  const route = await readFile(new URL("../app/api/visitor/appointments/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/visitor/page.tsx", import.meta.url), "utf8");
  assert.match(route, /f\.name AS facility_name/);
  assert.match(route, /INNER JOIN facilities f ON f\.id = a\.facility_id/);
  assert.match(page, /facility_name: string/);
  assert.match(page, /nextVisit\.facility_name/);
  assert.doesNotMatch(page, /appointment_type\} visit · Central Facility/);
});
