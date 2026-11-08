import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("recording retention and legal holds are wired into the scheduled worker", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const holds = await readFile(new URL("../lib/server/legal-hold-workflow.ts", import.meta.url), "utf8");
  assert.match(worker, /async function purgeExpiredRecordings/);
  assert.match(worker, /runScheduledJob\(env, "recording-retention"/);
  assert.match(worker, /recordingRetentionFailureStatement/);
  assert.match(worker, /async function reconcileRecordingObjects/);
  assert.match(worker, /runScheduledJob\(env, "recording-object-reconciliation"/);
  assert.match(holds, /entityType === "recording"/);
  assert.match(holds, /UPDATE recordings SET legal_hold = 1/);
});

test("consented recording sessions remain joinable while egress is processing", async () => {
  const session = await readFile(new URL("../lib/server/video/session.ts", import.meta.url), "utf8");
  assert.match(session, /\["CONSENTED", "RECORDING", "PROCESSING", "AVAILABLE"\]/);
  assert.match(session, /recording_policy === "OFF" && record\.recording_status === "NOT_RECORDED"/);
});

test("recording retention deletes the private object before final database deletion", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const section = worker.slice(worker.indexOf("async function purgeExpiredRecordings"), worker.indexOf("async function purgeExpiredStepUpAssertions"));
  assert.match(section, /await env\.RECORDINGS_BUCKET\.delete\(row\.storage_key\)/);
  assert.match(section, /expiredRecordingRetentionStatements/);
  assert.match(section, /status !== 'PENDING_DELETION'/);
});

test("recording start claims are reset when provider startup fails", async () => {
  const route = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/recording/route.ts", import.meta.url), "utf8");
  assert.match(route, /status = 'PENDING' AND provider_reference = \?/);
  assert.match(route, /SET provider_reference = NULL/);
  assert.match(route, /RECORDING_START_IN_PROGRESS/);
});

test("recording inventory exposes facility-scoped access history", async () => {
  const route = await readFile(new URL("../app/api/control/recordings/route.ts", import.meta.url), "utf8");
  const playback = await readFile(new URL("../app/api/control/recordings/[recordingId]/playback/route.ts", import.meta.url), "utf8");
  const compliance = await readFile(new URL("../app/features/management/CompliancePageInteractive.tsx", import.meta.url), "utf8");
  assert.match(route, /requirePermission\("recording\.manage"\)/);
  assert.match(playback, /requirePermission\("recording\.manage"\)/);
  assert.match(route, /recording_access_events rae WHERE rae\.recording_id = r\.id AND rae\.facility_id = r\.facility_id/);
  assert.match(route, /access_count/);
  assert.match(route, /last_accessed_at/);
  assert.match(compliance, /Open audited playback/);
  assert.match(compliance, /audited access/);
});

test("recording permission is assigned to the intended operational roles", async () => {
  const migration = await readFile(new URL("../drizzle/0060_recording_access_permission.sql", import.meta.url), "utf8");
  const seed = await readFile(new URL("../db/seed.sql", import.meta.url), "utf8");
  const staging = await readFile(new URL("../db/staging-fixture.sql", import.meta.url), "utf8");
  assert.match(migration, /Monitoring Officer/);
  assert.match(migration, /Supervisor/);
  assert.match(seed, /role-supervisor.*perm-recording-manage/);
  assert.match(seed, /role-monitoring-officer.*perm-recording-manage/);
  assert.match(staging, /role-supervisor.*perm-recording-manage/);
  assert.match(staging, /role-monitoring-officer.*perm-recording-manage/);
});
