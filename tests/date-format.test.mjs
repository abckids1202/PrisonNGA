import assert from "node:assert/strict";
import test from "node:test";
import { formatDateValue, localDateKey, safeTimeZone } from "../lib/date-format.ts";

test("date formatting falls back safely for invalid timezone and date values", () => {
  assert.equal(safeTimeZone("Not/AZone"), "Asia/Jakarta");
  assert.equal(formatDateValue("not-a-date", { dateStyle: "full" }, "Not/AZone"), "Schedule unavailable");
  assert.equal(formatDateValue("2026-10-10T09:00:00+07:00", { hour: "2-digit", minute: "2-digit" }, "Not/AZone"), "09:00");
});

test("local date keys remain usable when timezone input is malformed", () => {
  assert.equal(localDateKey(new Date("2026-10-10T09:00:00+07:00"), "Not/AZone"), "2026-10-10");
  assert.equal(localDateKey(new Date("not-a-date"), "Asia/Jakarta"), "");
});
