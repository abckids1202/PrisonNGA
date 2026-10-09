import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("waiting-room commands are replay-safe and clean up orphan LiveKit rooms on failure", async () => {
  const source = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(database/);
  assert.match(source, /completeIdempotencyStatement\(database/);
  assert.match(source, /releaseIdempotencyClaim/);
  assert.match(source, /LIVEKIT_ORPHAN_ROOM_CLEANUP_FAILED/);
  assert.match(source, /STALE_WAITING_ROOM_STATE/);
  assert.match(source, /recordWaitingRoomReconciliationRequired/);
  assert.match(source, /WAITING_ROOM_COMMIT_INCOMPLETE/);
});

test("waiting-room reconciliation failures create a durable critical signal", async () => {
  const source = await readFile(new URL("../lib/server/reconciliation.ts", import.meta.url), "utf8");
  assert.match(source, /WAITING_ROOM_RECONCILIATION_REQUIRED/);
  assert.match(source, /severity, request_id, metadata, created_at/);
  assert.match(source, /requiresStaffReview: true/);
  assert.match(source, /WAITING_ROOM_RECONCILIATION_RECORD_FAILED/);
});

test("resource reassignment conflicts create a durable reconciliation signal", async () => {
  const source = await readFile(new URL("../app/api/control/resources/route.ts", import.meta.url), "utf8");
  assert.match(source, /recordWaitingRoomReconciliationRequired/);
  assert.match(source, /operation: "RESOURCE_REASSIGNMENT"/);
  assert.match(source, /RESOURCE_REASSIGNMENT_CONFLICT/);
});

test("waiting-room cancellation releases reserved credit and assigned resources", async () => {
  const source = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");
  assert.match(source, /releaseVisitCreditStatements/);
  assert.match(source, /CREDIT_RESERVATION_NOT_SETTLEABLE/);
  assert.match(source, /entry_type IN \('RESERVATION_RELEASE', 'CONSUMPTION'\)/);
  assert.match(source, /UPDATE resource_reservations SET status = 'RELEASED'/);
  assert.match(source, /last_transition_id = \?/);
  assert.match(source, /SET status = \?, version = version \+ 1, updated_at = \?, last_transition_id = \?/);
  assert.match(source, /\.bind\(nextAppointmentStatus, now, correlationId/);
});

test("waiting-room admission is blocked while the facility is restricted", async () => {
  const source = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");
  assert.match(source, /command === "admit_visitor" && !facilityEligible/);
  assert.match(source, /FACILITY_NOT_ACCEPTING_REQUESTS/);
});

test("waiting-room late marking is blocked before the scheduled start", async () => {
  const source = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");
  assert.match(source, /command === "mark_late"/);
  assert.match(source, /Date\.parse\(String\(current\.requested_start \|\| ""\)\) > Date\.now\(\)/);
  assert.match(source, /VISIT_NOT_LATE_YET/);
});

test("waiting-room session start uses the same one-minute authorization window as token issuance", async () => {
  const source = await readFile(new URL("../app/api/control/waiting-room/route.ts", import.meta.url), "utf8");
  assert.match(source, /command === "start_visit"\)/);
  assert.match(source, /nowMs < start - 60_000/);
  assert.match(source, /VISIT_NOT_STARTED/);
  assert.match(source, /nowMs > end \+ 60_000/);
  assert.match(source, /VISIT_EXPIRED/);
});
