import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/api/control/waiting-room/route.ts", "utf8");

test("staff presence commands refresh authoritative presence timestamps", () => {
  assert.match(source, /const terminalWithoutLiveSession = command === "cancel_visit"/);
  assert.match(source, /const nextVisitorPresenceAt = terminalWithoutLiveSession \? now : command === "admit_visitor" \? now/);
  assert.match(source, /const nextPrisonerPresenceAt = terminalWithoutLiveSession \? now : command === "confirm_prisoner_presence" \? now/);
  assert.match(source, /visitorPresenceAt: nextVisitorPresenceAt === null/);
  assert.match(source, /prisonerPresenceAt: nextPrisonerPresenceAt === null/);
  assert.match(source, /nextState, visitorPresence, nextVisitorPresenceAt, prisonerPresence, nextPrisonerPresenceAt/);
});
