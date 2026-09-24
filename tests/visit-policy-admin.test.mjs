import test from "node:test";
import assert from "node:assert/strict";
import { parseEditableVisitPolicy } from "../lib/server/visit-policy-admin.ts";

const valid = {
  minDurationMinutes: 15,
  maxDurationMinutes: 60,
  minAdvanceMinutes: 30,
  maxAdvanceDays: 90,
  dailyStartTime: "08:00",
  dailyEndTime: "17:00",
};

test("visit policy admin accepts valid bounded facility configuration", () => {
  assert.deepEqual(parseEditableVisitPolicy(valid), valid);
});

test("visit policy admin rejects invalid duration bounds and granularity", () => {
  assert.equal(parseEditableVisitPolicy({ ...valid, minDurationMinutes: 10 }), null);
  assert.equal(parseEditableVisitPolicy({ ...valid, minDurationMinutes: 30, maxDurationMinutes: 15 }), null);
  assert.equal(parseEditableVisitPolicy({ ...valid, maxDurationMinutes: 50 }), null);
});

test("visit policy admin rejects malformed booking horizon and operating hours", () => {
  assert.equal(parseEditableVisitPolicy({ ...valid, maxAdvanceDays: 0 }), null);
  assert.equal(parseEditableVisitPolicy({ ...valid, minAdvanceMinutes: 10081 }), null);
  assert.equal(parseEditableVisitPolicy({ ...valid, dailyStartTime: "25:00" }), null);
  assert.equal(parseEditableVisitPolicy({ ...valid, dailyStartTime: "17:00", dailyEndTime: "08:00" }), null);
  assert.equal(parseEditableVisitPolicy(null), null);
});

test("visit policy mutation is replay-safe and preserves the step-up boundary", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/control/visit-policy/route.ts", import.meta.url), "utf8");
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /claimIdempotency\(database/);
  assert.match(source, /completeIdempotencyStatement\(database/);
  assert.match(source, /releaseIdempotencyClaim/);
  assert.match(source, /requireStepUp/);
});
