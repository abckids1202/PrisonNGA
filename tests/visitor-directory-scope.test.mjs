import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("visitor prisoner directory is limited to operational, configured facilities", async () => {
  const source = await readFile(new URL("../app/api/visitor/prisoners/route.ts", import.meta.url), "utf8");

  assert.match(source, /INNER JOIN visit_policies vp ON vp\.facility_id = p\.facility_id/);
  assert.match(source, /f\.current_state = 'NORMAL_OPERATIONS'/);
  assert.match(source, /vr\.facility_id = p\.facility_id/);
});

test("visitor appointment types use the same operational facility boundary", async () => {
  const source = await readFile(new URL("../app/api/visitor/appointment-types/route.ts", import.meta.url), "utf8");

  assert.match(source, /INNER JOIN facilities f ON f\.id = at\.facility_id/);
  assert.match(source, /INNER JOIN visit_policies vp ON vp\.facility_id = at\.facility_id/);
  assert.match(source, /f\.current_state = 'NORMAL_OPERATIONS'/);
});
