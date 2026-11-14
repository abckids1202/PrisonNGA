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
  assert.match(holds, /organization_id/);
});

test("legal holds are organization-scoped and legacy rows are backfilled", async () => {
  const migration = await readFile(new URL("../drizzle/0068_legal_hold_organization_scope.sql", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/control/legal-holds/route.ts", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN `organization_id`/);
  assert.match(migration, /UPDATE `legal_holds`/);
  assert.match(migration, /facilities/);
  assert.match(route, /WHERE organization_id = \? AND facility_id = \?/);
  assert.match(route, /LEGAL_HOLD_ORGANIZATION_SCOPE_MISSING/);
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

test("recording startup requires and persists a non-secret encryption control reference", async () => {
  const config = await readFile(new URL("../lib/server/config.ts", import.meta.url), "utf8");
  const storage = await readFile(new URL("../lib/server/video/recording.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/recording/route.ts", import.meta.url), "utf8");
  assert.match(config, /RECORDINGS_ENCRYPTION_KEY_REFERENCE/);
  assert.match(storage, /RECORDINGS_ENCRYPTION_KEY_REFERENCE/);
  assert.match(route, /RECORDING_ENCRYPTION_REFERENCE_NOT_CONFIGURED/);
  assert.match(route, /encryption_key_reference/);
});

test("failed recording rows can be retried without creating a second recording", async () => {
  const route = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/recording/route.ts", import.meta.url), "utf8");
  assert.match(route, /existing\?\.status === "FAILED"/);
  assert.match(route, /status = 'PENDING', failure_reason = NULL/);
  assert.match(route, /RECORDING_RETRY_STATE_CHANGED/);
});

test("staff recording controls only start after persisted consent or a retryable failure", async () => {
  const page = await readFile(new URL("../app/features/live-session/LiveSessionsPage.tsx", import.meta.url), "utf8");
  assert.match(page, /\["CONSENTED", "FAILED"\]\.includes\(selected\.recording_status\)/);
  assert.match(page, /Start recording/);
  assert.match(page, /Retry recording/);
});

test("recording inventory exposes facility-scoped access history", async () => {
  const route = await readFile(new URL("../app/api/control/recordings/route.ts", import.meta.url), "utf8");
  const detail = await readFile(new URL("../app/api/control/recordings/[recordingId]/route.ts", import.meta.url), "utf8");
  const playback = await readFile(new URL("../app/api/control/recordings/[recordingId]/playback/route.ts", import.meta.url), "utf8");
  const compliance = await readFile(new URL("../app/features/management/CompliancePageInteractive.tsx", import.meta.url), "utf8");
  assert.match(route, /requirePermission\("recording\.manage"\)/);
  assert.match(route, /f\.organization_id = \?/);
  assert.match(route, /r\.organization_id = f\.organization_id/);
  assert.match(playback, /requirePermission\("recording\.manage"\)/);
  assert.match(route, /recording_access_events rae WHERE rae\.recording_id = r\.id AND rae\.facility_id = r\.facility_id/);
  assert.match(route, /access_count/);
  assert.match(route, /last_accessed_at/);
  assert.match(detail, /requirePermission\("recording\.manage"\)/);
  assert.match(detail, /r\.organization_id = \?/);
  assert.match(detail, /rae\.organization_id = \?/);
  assert.match(detail, /accessEvents/);
  assert.doesNotMatch(detail, /r\.encryption_key_reference/);
  assert.match(compliance, /\/api\/control\/recordings\/\$\{encodeURIComponent\(recordingId\)\}/);
  assert.match(compliance, /Inspect record/);
  assert.match(compliance, /Open audited playback/);
  assert.match(compliance, /audited access/);
  assert.match(compliance, /\/api\/control\/legal-holds/);
  assert.match(compliance, /Place legal hold/);
  assert.match(compliance, /Release legal hold/);
});

test("recording playback supports approved break-glass access with an auditable request reference", async () => {
  const request = await readFile(new URL("../app/api/control/access/break-glass/route.ts", import.meta.url), "utf8");
  const playback = await readFile(new URL("../app/api/control/recordings/[recordingId]/playback/route.ts", import.meta.url), "utf8");
  assert.match(request, /"recording"/);
  assert.match(request, /FROM recordings/);
  assert.match(playback, /requireActiveBreakGlass/);
  assert.match(playback, /targetType: "recording"/);
  assert.match(playback, /break_glass_request_id/);
  assert.match(playback, /BREAK_GLASS_PLAYBACK/);
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

test("recording playback streams verified objects and bounds fallback hashing", async () => {
  const route = await readFile(new URL("../app/api/control/recordings/[recordingId]/playback/route.ts", import.meta.url), "utf8");
  const storage = await readFile(new URL("../lib/server/evidence-storage.ts", import.meta.url), "utf8");
  assert.match(storage, /checksumSha256\?: string/);
  assert.match(storage, /checksums\?\.sha256/);
  assert.match(route, /new Response\(object\.body/);
  assert.match(route, /MAX_FALLBACK_INTEGRITY_BYTES/);
  assert.match(route, /RECORDING_INTEGRITY_METADATA_MISSING/);
  assert.match(route, /RECORDING_RETENTION_EXPIRED/);
  assert.match(route, /retention_until/);
  assert.match(route, /SELECT id, organization_id, facility_id/);
  assert.match(route, /recording\.organization_id/);
  assert.match(route, /recording_id, organization_id, facility_id/);
  assert.match(route, /RECORDING_ORGANIZATION_SCOPE_MISSING/);
});

test("LiveKit egress ingestion does not buffer large recordings when R2 has no checksum", async () => {
  const webhook = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  assert.match(webhook, /object\.checksumSha256 \|\| null/);
  assert.match(webhook, /object\.size <= MAX_FALLBACK_INTEGRITY_BYTES/);
  assert.match(webhook, /lacked bounded integrity metadata/);
  assert.doesNotMatch(webhook, /byteSize = bytes\.byteLength/);
});
