import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/visitor/appointments/[appointmentId]/waiting-room/presence/route.ts", import.meta.url), "utf8");

test("repeat visitor waiting-room heartbeats refresh freshness without version churn", () => {
  assert.match(source, /current\.visitor_presence === "present" && current\.state !== "NOT_ARRIVED"/);
  assert.match(source, /visitor_presence_at = \?, last_checked_at = \?, updated_at = \?/);
  assert.match(source, /AND version = \? AND visitor_presence = 'present'/);
  assert.match(source, /idempotent: true/);
});
