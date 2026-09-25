import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/control/appointments/route.ts", import.meta.url), "utf8");

test("staff approval rechecks active closure windows for older appointment requests", () => {
  assert.match(source, /FROM facility_closures fc/);
  assert.match(source, /fc\.starts_at < a\.requested_end/);
  assert.match(source, /closure_conflict/);
  assert.match(source, /FACILITY_CLOSED_FOR_REQUESTED_WINDOW/);
});
