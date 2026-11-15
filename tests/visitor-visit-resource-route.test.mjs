import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../app/api/visitor/visits/[visitId]/route.ts", import.meta.url), "utf8");

test("visitor visit resource requires a visitor session and bounded visit id", () => {
  assert.match(route, /requireVisitorIdentity\(\)/);
  assert.match(route, /visitId\.length > 128/);
  assert.match(route, /VISIT_NOT_FOUND/);
});

test("visitor visit resource uses visitor-owned detail and history queries", () => {
  assert.match(route, /visitorAppointmentDetailStatement/);
  assert.match(route, /visitorAppointmentHistoryStatement/);
  assert.match(route, /appointmentId: visitId/);
  assert.match(route, /visitorUserId: visitor\.userId/);
  assert.match(route, /statusHistory: history\.results/);
});
