import assert from "node:assert/strict";
import test from "node:test";
import { parseWeeklyHours, validateVisitWindow } from "../lib/server/visit-policy.ts";
import { parseEditableVisitPolicy } from "../lib/server/visit-policy-admin.ts";

const base = {
  timezone: "Asia/Jakarta",
  min_duration_minutes: 15,
  max_duration_minutes: 30,
  min_advance_minutes: 60,
  max_advance_days: 30,
  daily_start_time: "08:00",
  daily_end_time: "17:00",
};

const weekdaysClosedSunday = [
  { open: null, close: null },
  { open: "08:00", close: "17:00" },
  { open: "08:00", close: "17:00" },
  { open: "08:00", close: "17:00" },
  { open: "08:00", close: "17:00" },
  { open: "08:00", close: "17:00" },
  { open: "08:00", close: "12:00" },
];

test("weekly policy rejects an appointment on a configured closed day", () => {
  const result = validateVisitWindow(
    "2026-10-04T09:00:00+07:00",
    "2026-10-04T09:30:00+07:00",
    Date.parse("2026-09-22T10:00:00.000Z"),
    { ...base, weekly_hours_json: JSON.stringify(weekdaysClosedSunday) },
  );
  assert.deepEqual(result, { ok: false, reason: "APPOINTMENT_OUTSIDE_OPERATING_HOURS" });
});

test("weekly policy accepts a weekday-specific operating window", () => {
  const result = validateVisitWindow(
    "2026-10-03T10:00:00+07:00",
    "2026-10-03T10:30:00+07:00",
    Date.parse("2026-09-22T10:00:00.000Z"),
    { ...base, weekly_hours_json: JSON.stringify(weekdaysClosedSunday) },
  );
  assert.equal(result.ok, true);
});

test("weekly policy admin input is normalized and preserves closed days", () => {
  const parsed = parseEditableVisitPolicy({
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
    minAdvanceMinutes: 60,
    maxAdvanceDays: 30,
    dailyStartTime: "08:00",
    dailyEndTime: "17:00",
    creditPriceMinor: 50000,
    creditCurrency: "IDR",
    weeklyHours: weekdaysClosedSunday,
  });
  assert.equal(parsed?.weeklyHoursJson, JSON.stringify(weekdaysClosedSunday));
});

test("malformed persisted weekly hours fail closed instead of becoming daily fallback", () => {
  assert.equal(parseWeeklyHours("{not-json}"), null);
  assert.equal(parseWeeklyHours(JSON.stringify([{ open: "08:00", close: "17:00" }])), null);
});
