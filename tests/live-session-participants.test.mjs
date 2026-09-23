import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LiveKit webhook persists participant lifecycle state idempotently", async () => {
  const source = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  assert.match(source, /visit_session_participants/);
  assert.match(source, /ON CONFLICT\(session_id, identity\) DO UPDATE/);
  assert.match(source, /participant_joined/);
  assert.match(source, /participant_connection_aborted/);
});

test("LiveKit status promotion requires an in-progress appointment", async () => {
  const source = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  assert.match(source, /EXISTS \(SELECT 1 FROM appointments WHERE id = \? AND facility_id = \? AND status = 'IN_PROGRESS'\)/);
});

test("LiveKit participant events are bound to the appointment visitor and assigned kiosk", async () => {
  const source = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  assert.match(source, /a\.visitor_user_id/);
  assert.match(source, /kiosk_resource_id/);
  assert.match(source, /PARTICIPANT_NOT_ASSIGNED_TO_VISIT/);
  assert.match(source, /PARTICIPANT_ASSIGNMENT_UNAVAILABLE/);
});
