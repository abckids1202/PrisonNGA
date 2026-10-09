import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("scheduled worker raises durable alarms for active appointment integrity gaps", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /async function reconcileActiveAppointmentInvariants/);
  assert.match(source, /APPOINTMENT_INTEGRITY_RECONCILIATION_REQUIRED/);
  assert.match(source, /activeResources/);
  assert.match(source, /runScheduledJob\("active-appointment-reconciliation"/);
});
