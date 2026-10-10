import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isWaitingRoomOpen } from "../lib/server/waiting-room-window.ts";

const source = await readFile(new URL("../app/api/visitor/appointments/[appointmentId]/waiting-room/route.ts", import.meta.url), "utf8");

test("visitor check-in requires fresh prisoner presence before reporting both present", () => {
  assert.match(source, /const visitorPresent = current\.visitor_presence === "present"/);
  assert.match(source, /if \(visitorPresent && current\.state !== "NOT_ARRIVED"\)/);
  assert.match(source, /isRecentPresence/);
  assert.match(source, /const prisonerPresent = current\.prisoner_presence === "present"/);
  assert.match(source, /const nextPrisonerPresence = prisonerPresent \? "present" : "waiting"/);
  assert.match(source, /const nextState = prisonerPresent \? "BOTH_PRESENT" : "VISITOR_WAITING"/);
});

test("visitor waiting-room entry opens ten minutes before the scheduled start", () => {
  const start = "2026-10-07T10:00:00.000Z";
  const end = "2026-10-07T10:30:00.000Z";
  assert.equal(isWaitingRoomOpen(start, end, Date.parse("2026-10-07T09:49:59.999Z")), false);
  assert.equal(isWaitingRoomOpen(start, end, Date.parse("2026-10-07T09:50:00.000Z")), true);
  assert.equal(isWaitingRoomOpen(start, end, Date.parse("2026-10-07T10:29:59.999Z")), true);
  assert.equal(isWaitingRoomOpen(start, end, Date.parse("2026-10-07T10:30:00.000Z")), false);
});

test("visitor waiting-room check-in enforces the opening boundary unless staff already opened it", () => {
  assert.match(source, /const facilityAlreadyOpenedRoom = current\.waiting_version !== null/);
  assert.match(source, /!facilityAlreadyOpenedRoom && !isWaitingRoomOpen\(/);
  assert.match(source, /throw new SecurityError\("WAITING_ROOM_NOT_OPEN", 409\)/);
});

test("visitor check-in compensates partial appointment and Waiting Room writes", () => {
  assert.match(source, /WAITING_ROOM_RECONCILIATION_REQUIRED/);
  assert.match(source, /DELETE FROM waiting_room_sessions WHERE appointment_id = \? AND facility_id = \? AND version = \?/);
  assert.match(source, /UPDATE appointments SET status = \?, version = \?, updated_at = \?/);
  assert.match(source, /recordWaitingRoomReconciliationRequired/);
});

test("visitor check-in preserves authoritative staff states and identity review", () => {
  assert.match(source, /state IN \('NOT_ARRIVED', 'VISITOR_WAITING', 'PRISONER_WAITING', 'BOTH_PRESENT'\) THEN excluded\.state ELSE waiting_room_sessions\.state/);
  assert.match(source, /identity_state = waiting_room_sessions\.identity_state/);
});
