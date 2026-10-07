import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("staff observer route requests a restricted server token and mounts the read-only client", async () => {
  const source = await readFile(new URL("../app/features/live-session/StaffObserverRouteClient.tsx", import.meta.url), "utf8");
  assert.match(source, /observer-token/);
  assert.match(source, /Routine live-session observation/);
  assert.match(source, /StaffObserverClient/);
  assert.match(source, /credentials: "include"/);
});

test("staff observer authorization requires the appointment to remain in progress", async () => {
  const source = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/observer-token/route.ts", import.meta.url), "utf8");
  const session = await readFile(new URL("../lib/server/video/session.ts", import.meta.url), "utf8");
  assert.match(source, /assertStaffObserverJoinAllowed\(session\)/);
  assert.match(session, /assertStaffObserverJoinAllowed/);
  assert.match(session, /record\.appointment_status !== "IN_PROGRESS"/);
  assert.match(session, /SESSION_NOT_AVAILABLE/);
});

test("staff observer token refreshes are audited as token issuance, not repeated session starts", async () => {
  const source = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/observer-token/route.ts", import.meta.url), "utf8");
  assert.match(source, /MONITORING_TOKEN_ISSUED/);
  assert.match(source, /SESSION_MONITORING_TOKEN_ISSUED/);
  assert.doesNotMatch(source, /MONITORING_STARTED/);
  assert.doesNotMatch(source, /SESSION_MONITORING_STARTED/);
});
