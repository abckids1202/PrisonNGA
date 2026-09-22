import assert from "node:assert/strict";
import test from "node:test";
import { validateVisitWindow } from "../lib/server/visit-policy.ts";

const now = Date.parse("2026-09-22T10:00:00.000Z");
const policy = {
  timezone: "Asia/Jakarta",
  min_duration_minutes: 15,
  max_duration_minutes: 30,
  min_advance_minutes: 60,
  max_advance_days: 30,
  daily_start_time: "08:00",
  daily_end_time: "17:00",
};

test("validates and canonicalizes an allowed facility-local appointment window", () => {
  const result = validateVisitWindow("2026-10-01T16:00:00+07:00", "2026-10-01T16:30:00+07:00", now, policy);
  assert.deepEqual(result, {
    ok: true,
    requestedStart: "2026-10-01T09:00:00.000Z",
    requestedEnd: "2026-10-01T09:30:00.000Z",
    earliestStartAt: "2026-09-22T11:00:00.000Z",
    latestStartAt: "2026-10-22T10:00:00.000Z",
  });
});

test("rejects an appointment that starts inside but ends after facility hours", () => {
  const result = validateVisitWindow("2026-10-01T09:45:00.000Z", "2026-10-01T10:15:00.000Z", now, policy);
  assert.deepEqual(result, { ok: false, reason: "APPOINTMENT_OUTSIDE_OPERATING_HOURS" });
});

test("rejects invalid duration, booking horizon, and facility timezone", () => {
  assert.deepEqual(
    validateVisitWindow("2026-10-01T09:00:00.000Z", "2026-10-01T09:45:00.000Z", now, policy),
    { ok: false, reason: "DURATION_NOT_ALLOWED" },
  );
  assert.deepEqual(
    validateVisitWindow("2026-09-22T10:30:00.000Z", "2026-09-22T10:45:00.000Z", now, policy),
    { ok: false, reason: "APPOINTMENT_OUTSIDE_BOOKING_HORIZON" },
  );
  assert.deepEqual(
    validateVisitWindow("2026-10-01T09:00:00.000Z", "2026-10-01T09:15:00.000Z", now, { ...policy, timezone: "Not/A_Zone" }),
    { ok: false, reason: "FACILITY_TIMEZONE_INVALID" },
  );
});
