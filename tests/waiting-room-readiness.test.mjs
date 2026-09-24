import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWaitingRoomReadiness } from "../lib/server/waiting-room-readiness.ts";

const now = Date.parse("2026-09-22T10:00:00.000Z");
const readyFacts = {
  visitorPresence: "present",
  visitorPresenceAt: "2026-09-22T09:59:00.000Z",
  prisonerPresence: "present",
  prisonerPresenceAt: "2026-09-22T09:59:00.000Z",
  relationshipStatus: "APPROVED",
  prisonerStatus: "ACTIVE",
  visitationStatus: "APPROVED",
  facilityState: "NORMAL_OPERATIONS",
  visitorCameraResult: "ready",
  visitorMicrophoneResult: "ready",
  visitorNetworkResult: "stable",
  visitorLatencyMs: 80,
  visitorDeviceCheckedAt: "2026-09-22T09:55:00.000Z",
  roomReserved: true,
  roomStatus: "AVAILABLE",
  roomHealth: "HEALTHY",
  kioskReserved: true,
  kioskStatus: "ONLINE",
  kioskHealth: "HEALTHY",
  kioskHeartbeatAt: "2026-09-22T09:59:00.000Z",
  kioskCredentialActive: true,
  kioskCameraResult: "ready",
  kioskMicrophoneResult: "ready",
  kioskNetworkResult: "stable",
  kioskDeviceCheckedAt: "2026-09-22T09:55:00.000Z",
};

test("visit is ready only when every persisted readiness fact passes", () => {
  const result = evaluateWaitingRoomReadiness(readyFacts, now);
  assert.equal(result.readyToStart, true);
  assert.equal(result.state, "READY_TO_START");
  assert.ok(Object.values(result.checks).every((state) => state === "pass"));
});

test("presence and an approved relationship cannot substitute for a recent visitor device check", () => {
  const result = evaluateWaitingRoomReadiness({ ...readyFacts, visitorCameraResult: null, visitorMicrophoneResult: null, visitorNetworkResult: null, visitorDeviceCheckedAt: null }, now);
  assert.equal(result.readyToStart, false);
  assert.equal(result.checks.camera, "pending");
  assert.equal(result.checks.microphone, "pending");
  assert.equal(result.checks.network, "pending");
});

test("stale device checks, stale kiosk heartbeat, or absent kiosk credentials fail closed", () => {
  for (const facts of [
    { ...readyFacts, visitorDeviceCheckedAt: "2026-09-22T09:39:59.999Z" },
    { ...readyFacts, kioskHeartbeatAt: "2026-09-22T09:56:59.999Z" },
    { ...readyFacts, kioskCredentialActive: false },
  ]) {
    assert.equal(evaluateWaitingRoomReadiness(facts, now).readyToStart, false);
  }
});

test("stale visitor or prisoner presence cannot make a visit ready", () => {
  assert.equal(evaluateWaitingRoomReadiness({ ...readyFacts, visitorPresenceAt: "2026-09-22T09:56:59.999Z" }, now).readyToStart, false);
  assert.equal(evaluateWaitingRoomReadiness({ ...readyFacts, prisonerPresenceAt: "2026-09-22T09:56:59.999Z" }, now).readyToStart, false);
});

test("missing or failed kiosk device checks block admission", () => {
  const missing = evaluateWaitingRoomReadiness({ ...readyFacts, kioskCameraResult: null, kioskMicrophoneResult: null, kioskNetworkResult: null, kioskDeviceCheckedAt: null }, now);
  assert.equal(missing.readyToStart, false);
  assert.equal(missing.checks.kiosk, "pending");

  const failed = evaluateWaitingRoomReadiness({ ...readyFacts, kioskMicrophoneResult: "failed" }, now);
  assert.equal(failed.readyToStart, false);
  assert.equal(failed.checks.kiosk, "failed");
});

test("staff-recorded presence remains independent and does not bypass other checks", () => {
  const visitorOnly = evaluateWaitingRoomReadiness({ ...readyFacts, prisonerPresence: "waiting" }, now);
  assert.equal(visitorOnly.state, "VISITOR_WAITING");
  assert.equal(visitorOnly.readyToStart, false);

  const prisonerOnly = evaluateWaitingRoomReadiness({ ...readyFacts, visitorPresence: "absent" }, now);
  assert.equal(prisonerOnly.state, "PRISONER_WAITING");
  assert.equal(prisonerOnly.readyToStart, false);
});

test("failed eligibility, facility restrictions, device checks, and resource health block admission", () => {
  const cases = [
    { ...readyFacts, relationshipStatus: "PENDING" },
    { ...readyFacts, facilityState: "LOCKDOWN" },
    { ...readyFacts, visitorMicrophoneResult: "failed" },
    { ...readyFacts, roomStatus: "MAINTENANCE" },
    { ...readyFacts, kioskHealth: "FAILED" },
  ];
  for (const facts of cases) assert.equal(evaluateWaitingRoomReadiness(facts, now).readyToStart, false);
  assert.equal(evaluateWaitingRoomReadiness({ ...readyFacts, visitorLatencyMs: null }, now).readyToStart, false);
});
