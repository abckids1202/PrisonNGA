import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Visitation workspace routes supported tabs to authoritative persisted workflows", () => {
  assert.match(source, /const connected = \["Visit Policies", "Availability Rules", "Operating Hours", "Closures"\]\.includes\(tab\)/);
  assert.match(source, /\["Visit Policies", "Availability Rules", "Operating Hours"\]\.includes\(tab\) \? <VisitPolicyEditor \/>/);
  assert.match(source, /tab === "Closures" \? <FacilityClosures \/>/);
  assert.match(source, /Appointment types need a dedicated policy model/);
});
