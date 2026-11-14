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

test("recording stop treats only a provider missing-egress response as an idempotent success", async () => {
  const storage = await readFile(new URL("../lib/server/video/recording.ts", import.meta.url), "utf8");
  assert.match(storage, /instanceof ServerError/);
  assert.match(storage, /egress_not_found/);
  assert.match(storage, /throw error/);
});

test("recording startup requires and persists a non-secret encryption control reference", async () => {
  const config = await readFile(new URL("../lib/server/config.ts", import.meta.url), "utf8");
  const storage = await readFile(new URL("../lib/server/video/recording.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/recording/route.ts", import.meta.url), "utf8");
  assert.match(config, /RECORDINGS_ENCRYPTION_KEY_REFERENCE/);
  assert.match(config, /RECORDINGS_ENCRYPTION_MODE/);
  assert.match(storage, /RECORDINGS_ENCRYPTION_KEY_REFERENCE/);
  assert.match(storage, /RECORDINGS_ENCRYPTION_MODE/);
  assert.match(storage, /isSafeRecordingEncryptionReference/);
  assert.match(route, /isSafeRecordingEncryptionReference/);
  assert.match(storage, /securevisit-encryption-control/);
  assert.match(storage, /securevisit-privacy/);
  assert.match(route, /RECORDINGS_ENCRYPTION_MODE/);
  assert.match(route, /RECORDING_ENCRYPTION_MODE_NOT_CONFIGURED/);
  assert.match(route, /RECORDING_ENCRYPTION_REFERENCE_NOT_CONFIGURED/);
  assert.match(route, /encryption_key_reference/);
});

test("recording startup writes remain tenant-safe if the organization is disabled mid-request", async () => {
  const route = await readFile(new URL("../app/api/control/live-sessions/[sessionId]/recording/route.ts", import.meta.url), "utf8");
  assert.match(route, /INNER JOIN organizations o ON o\.id = f\.organization_id AND o\.status = 'ACTIVE'/);
  assert.match(route, /UPDATE recordings SET provider_reference[\s\S]*AND EXISTS \(SELECT 1 FROM facilities f/);
  assert.match(route, /UPDATE visit_sessions SET recording_status = 'RECORDING'[\s\S]*AND EXISTS \(SELECT 1 FROM facilities f/);
});

test("recording encryption control references are bounded non-secret identifiers", async () => {
  const config = await readFile(new URL("../lib/server/config.ts", import.meta.url), "utf8");
  const readiness = await readFile(new URL("../app/api/health/readiness/route.ts", import.meta.url), "utf8");
  const reference = await readFile(new URL("../lib/server/recording-config.ts", import.meta.url), "utf8");
  assert.match(reference, /\{2,159\}/);
  assert.match(config, /bounded non-secret identifier/);
  assert.match(readiness, /isSafeRecordingEncryptionReference/);
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
  assert.match(playback, /FROM facilities WHERE id = \?/);
  assert.match(playback, /organization_id = \? AND facility_id = \?/);
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

test("playback integrity failures create a durable security alarm", async () => {
  const route = await readFile(new URL("../app/api/control/recordings/[recordingId]/playback/route.ts", import.meta.url), "utf8");
  assert.match(route, /recordingIntegrityFailureStatement/);
  assert.match(route, /RECORDING_PLAYBACK_INTEGRITY_ALARM_FAILED/);
  assert.match(route, /The recorded object checksum does not match/);
  assert.match(route, /The recorded object is missing or its persisted size does not match/);
});

test("LiveKit egress ingestion does not buffer large recordings when R2 has no checksum", async () => {
  const webhook = await readFile(new URL("../app/api/webhooks/livekit/route.ts", import.meta.url), "utf8");
  assert.match(webhook, /object\.checksumSha256 \|\| null/);
  assert.match(webhook, /object\.size <= MAX_FALLBACK_INTEGRITY_BYTES/);
  assert.match(webhook, /lacked bounded integrity metadata/);
  assert.doesNotMatch(webhook, /byteSize = bytes\.byteLength/);
});

test("scheduled recording reconciliation prefers R2 checksums and alarms on oversized fallback hashing", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const reconciliation = await readFile(new URL("../lib/server/reconciliation.ts", import.meta.url), "utf8");
  assert.match(worker, /object\.checksums\?\.sha256/);
  assert.match(worker, /MAX_FALLBACK_INTEGRITY_BYTES/);
  assert.match(worker, /RECORDING_INTEGRITY_METADATA_MISSING/);
  assert.match(worker, /recordingIntegrityFailureStatement/);
  assert.match(reconciliation, /RECORDING_OBJECT_INTEGRITY_FAILED/);
  assert.match(reconciliation, /\(id, organization_id, facility_id, event_type, severity, request_id, metadata, created_at\)/);
  assert.match(reconciliation, /FROM facilities f\s+WHERE f\.id = \? AND f\.organization_id IS NOT NULL/);
  const normalizedWorker = worker.replaceAll("\r\n", "\n");
  const reconciliationTry = normalizedWorker.indexOf("try {\n      const object = await env.RECORDINGS_BUCKET.get(row.storage_key);");
  const integrityGuard = normalizedWorker.indexOf("RECORDING_INTEGRITY_METADATA_MISSING");
  assert.ok(reconciliationTry >= 0 && reconciliationTry < integrityGuard, "R2 read and size guard must be inside the alarm boundary");
});
