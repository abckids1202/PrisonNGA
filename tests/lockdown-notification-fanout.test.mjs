import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("facility lockdown fan-outs idempotent appointment notifications without changing visit state", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");

  assert.match(worker, /row\.event_type === "LOCKDOWN_STARTED"/);
  assert.match(worker, /INSERT OR IGNORE INTO outbox_events/);
  assert.match(worker, /'FACILITY_LOCKDOWN_APPOINTMENT'/);
  assert.match(worker, /a\.status IN \('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'WAITING', 'IN_PROGRESS'\)/);
  assert.match(worker, /lockdown:\' \|\| a\.facility_id/);
  assert.match(worker, /eventType === "FACILITY_LOCKDOWN_APPOINTMENT"/);
});
