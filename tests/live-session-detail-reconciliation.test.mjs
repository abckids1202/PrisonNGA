import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("live-session detail exposes facility-scoped settlement recovery evidence", async () => {
  const source = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /facility_id = \? AND entity_type = 'visit_session'/);
  assert.match(source, /INNER JOIN visit_sessions vs ON vs\.id = vse\.session_id AND vs\.facility_id = \?/);
  assert.match(source, /\.bind\(authorization\.facilityId, sessionId\)\.all\(\)/);
  assert.match(source, /action_type = 'LIVE_SESSION_FINALIZATION_BLOCKED'/);
  assert.match(source, /reconciliation: reconciliation \? \{ required: true/);
  assert.match(source, /reconciliation: reconciliation \? \{ required: true[\s\S]*required: false/);
});

test("live-session drawer loads and presents persisted evidence and settlement recovery", async () => {
  const source = await readFile(new URL("../app/features/live-session/LiveSessionsPage.tsx", import.meta.url), "utf8");
  assert.match(source, /loadSessionDetail\(sessionId: string\)/);
  assert.match(source, /\/api\/control\/live-sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(source, /MANUAL REVIEW REQUIRED/);
  assert.match(source, /selectedDetail\?\.events\.slice\(0, 4\)/);
  assert.match(source, /setSelectedDetail\(null\)/);
});
