import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/visitor/appointments/[appointmentId]/waiting-room/presence/route.ts", import.meta.url), "utf8");
const visitDetailsSource = await readFile(new URL("../app/visitor/VisitDetailsClient.tsx", import.meta.url), "utf8");
const liveSessionSource = await readFile(new URL("../app/features/live-session/LiveSessionClient.tsx", import.meta.url), "utf8");

test("repeat visitor waiting-room heartbeats refresh freshness without version churn", () => {
  assert.match(source, /current\.visitor_presence === "present" && current\.state !== "NOT_ARRIVED"/);
  assert.match(source, /visitor_presence_at = \?, last_checked_at = \?, updated_at = \?/);
  assert.match(source, /AND version = \? AND visitor_presence = 'present'/);
  assert.match(source, /idempotent: true/);
});

test("visitor heartbeat response preserves authoritative escalated states", () => {
  assert.match(source, /const persistedState = \["NOT_ARRIVED", "VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"\]/);
  assert.match(source, /state: persistedState/);
});

test("visitor presence compensates a partial optimistic-concurrency write", () => {
  assert.match(source, /WAITING_ROOM_RECONCILIATION_REQUIRED/);
  assert.match(source, /SET state = \?, visitor_presence = \?, visitor_presence_at = \?, version = \?, last_checked_at = \?, updated_at = \?/);
  assert.match(source, /if \(result\[0\]\?\.meta\.changes\) \{/);
});

test("visitor presence can be cleared safely when the browser leaves", () => {
  assert.match(source, /requestedPresence !== "present" && requestedPresence !== "absent"/);
  assert.match(source, /presence === "absent"/);
  assert.match(source, /visitor_presence = 'absent'/);
  assert.match(source, /currentState === "LIVE"/);
  assert.match(source, /VISITOR_PRESENCE_CLEARED/);
  assert.match(source, /VISITOR_PRESENCE_AUDIT_INCOMPLETE/);
  assert.match(source, /VISITOR_PRESENCE_CLEAR/);
  assert.match(visitDetailsSource, /body: JSON\.stringify\(\{ presence: "absent" \}\)/);
  assert.match(visitDetailsSource, /window\.addEventListener\("pagehide", clearPresence\)/);
  assert.match(liveSessionSource, /window\.addEventListener\("pagehide", clearPresence\)/);
  assert.match(liveSessionSource, /function leaveVisit\(\)/);
});
