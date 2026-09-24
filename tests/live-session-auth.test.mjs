import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertVisitorJoinAllowed } from "../lib/server/video/session.ts";

test("LiveKit grants restrict participants to camera and microphone sources", async () => {
  const source = await readFile(new URL("../lib/server/video/provider.ts", import.meta.url), "utf8");
  assert.match(source, /canPublishSources/);
  assert.match(source, /TrackSource\.CAMERA/);
  assert.match(source, /TrackSource\.MICROPHONE/);
  assert.match(source, /input\.role === "STAFF_OBSERVER" \? \[\] :/);
});

const session = {
  id: "session-1",
  appointment_id: "visit-1",
  facility_id: "facility-1",
  visitor_user_id: "visitor-1",
  visitor_name: "Visitor",
  prisoner_id: "prisoner-1",
  appointment_status: "IN_PROGRESS",
  appointment_version: 2,
  prisoner_status: "ACTIVE",
  visitation_status: "APPROVED",
  facility_state: "NORMAL_OPERATIONS",
  status: "ACTIVE",
  provider: "livekit",
  provider_room_name: "sv_session1",
  authorized_start_at: new Date(Date.now() - 60_000).toISOString(),
  authorized_end_at: new Date(Date.now() + 60_000).toISOString(),
  actual_started_at: new Date().toISOString(),
  actual_ended_at: null,
  termination_reason: null,
  recording_policy: "OFF",
  recording_status: "NOT_RECORDED",
  version: 1,
};

test("eligible visitor can join an active session", () => {
  assert.doesNotThrow(() => assertVisitorJoinAllowed(session));
});

test("visitor join is denied when prisoner eligibility has changed", () => {
  for (const change of [{ prisoner_status: "RELEASED" }, { visitation_status: "SUSPENDED" }, { visitation_status: "RESTRICTED" }]) {
    assert.throws(() => assertVisitorJoinAllowed({ ...session, ...change }), (error) => error.code === "PRISONER_NOT_AVAILABLE");
  }
});

test("visitor join is denied during facility restrictions or outside the live appointment state", () => {
  assert.throws(() => assertVisitorJoinAllowed({ ...session, facility_state: "LOCKDOWN" }), (error) => error.code === "FACILITY_NOT_ACCEPTING_REQUESTS");
  assert.throws(() => assertVisitorJoinAllowed({ ...session, appointment_status: "CANCELLED_BY_FACILITY" }), (error) => error.code === "APPOINTMENT_NOT_IN_PROGRESS");
});
