import assert from "node:assert/strict";
import test from "node:test";
import { facilityLocalDateTime } from "../lib/server/time.ts";

test("facility local time rejects impossible calendar dates", () => {
  assert.throws(() => facilityLocalDateTime("2026-02-30", "09:00", "Asia/Jakarta"), /INVALID_LOCAL_DATE_TIME/);
  assert.throws(() => facilityLocalDateTime("2026-09-22", "25:00", "Asia/Jakarta"), /INVALID_LOCAL_DATE_TIME/);
});

test("facility local time preserves a valid wall-clock date", () => {
  assert.equal(facilityLocalDateTime("2026-09-22", "09:00", "Asia/Jakarta").toISOString(), "2026-09-22T02:00:00.000Z");
});
