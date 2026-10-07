import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/visitor/appointments/[appointmentId]/waiting-room/route.ts", import.meta.url), "utf8");

test("visitor check-in requires fresh prisoner presence before reporting both present", () => {
  assert.match(source, /const visitorPresent = current\.visitor_presence === "present"/);
  assert.match(source, /if \(visitorPresent && current\.state !== "NOT_ARRIVED"\)/);
  assert.match(source, /isRecentPresence/);
  assert.match(source, /const prisonerPresent = current\.prisoner_presence === "present"/);
  assert.match(source, /const nextPrisonerPresence = prisonerPresent \? "present" : "waiting"/);
  assert.match(source, /const nextState = prisonerPresent \? "BOTH_PRESENT" : "VISITOR_WAITING"/);
});
