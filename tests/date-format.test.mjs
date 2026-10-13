import assert from "node:assert/strict";
import test from "node:test";
import { addLocalDateDays, formatDateValue, localDateKey, safeTimeZone } from "../lib/date-format.ts";

test("date formatting falls back safely for invalid timezone and date values", () => {
  assert.equal(safeTimeZone("Not/AZone"), "Asia/Jakarta");
  assert.equal(formatDateValue("not-a-date", { dateStyle: "full" }, "Not/AZone"), "Schedule unavailable");
  assert.equal(formatDateValue("2026-10-10T09:00:00+07:00", { hour: "2-digit", minute: "2-digit" }, "Not/AZone"), "09:00");
});

test("local date keys remain usable when timezone input is malformed", () => {
  assert.equal(localDateKey(new Date("2026-10-10T09:00:00+07:00"), "Not/AZone"), "2026-10-10");
  assert.equal(localDateKey(new Date("not-a-date"), "Asia/Jakarta"), "");
});

test("local calendar day arithmetic follows the facility timezone", () => {
  const instant = new Date("2026-11-01T23:30:00.000Z");
  assert.equal(localDateKey(instant, "Asia/Jakarta"), "2026-11-02");
  assert.equal(addLocalDateDays(instant, 1, "Asia/Jakarta"), "2026-11-03");
});
