import { getD1 } from "../../../../../../db/runtime";
import { auditAndOutboxStatements } from "../../../../../../lib/server/events";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, requireStepUp, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";
import { recordingProviderCleanupFailureStatement } from "../../../../../../lib/server/reconciliation";
import { getVideoConfig } from "../../../../../../lib/server/video/provider";
import { startLiveKitRecording, stopLiveKitRecording } from "../../../../../../lib/server/video/recording";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  let claimedRecordingId: string | null = null;
  let claimedRecordingReference: string | null = null;
  let startedEgressId: string | null = null;
  let recordingProviderConfig: { url: string; apiKey: string; apiSecret: string } | null = null;
  let recordingCorrelationId: string | null = null;
  let claimedFacilityId: string | null = null;
  let claimedSessionId: string | null = null;
  try {
    const { sessionId } = await params;
    const authorization = await requirePermission("recording.manage");
    const body = await request.json() as { expectedVersion?: unknown; reason?: unknown };
    const reason = assertReason(body.reason);
    if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new SecurityError("EXPECTED_VERSION_REQUIRED", 400);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    d1 = await getD1();
    const session = await d1.prepare(`SELECT vs.id, vs.facility_id, vs.appointment_id, vs.provider, vs.provider_room_name, vs.status, vs.recording_policy, vs.recording_status, vs.version,
      vp.recording_policy AS facility_recording_policy, vp.version AS policy_version,
      rc.decision AS visitor_consent
      FROM visit_sessions vs INNER JOIN visit_policies vp ON vp.facility_id = vs.facility_id
      LEFT JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      LEFT JOIN recording_consents rc ON rc.session_id = vs.id AND rc.participant_user_id = a.visitor_user_id
      WHERE vs.id = ? AND vs.facility_id = ?`).bind(sessionId, authorization.facilityId).first<{ id: string; facility_id: string; appointment_id: string; provider: string; provider_room_name: string; status: string; recording_policy: string; recording_status: string; version: number; facility_recording_policy: string; policy_version: number; visitor_consent: string | null }>();
    if (!session) throw new SecurityError("SESSION_NOT_FOUND", 404);
    if (session.version !== body.expectedVersion) throw new SecurityError("STALE_SESSION", 409);
    if ((session.facility_recording_policy || session.recording_policy) !== "ON" || session.visitor_consent !== "GRANTED") throw new SecurityError("RECORDING_CONSENT_REQUIRED", 409);
    if (!["CONNECTING", "ACTIVE", "RECONNECTING"].includes(session.status)) throw new SecurityError("SESSION_NOT_RECORDABLE", 409);
    if (session.provider !== "livekit") throw new SecurityError("RECORDING_PROVIDER_UNSUPPORTED", 503);
    const scope = `session-recording:${authorization.facilityId}:${session.id}`;
    const requestHash = await hashIdempotencyPayload({ sessionId, expectedVersion: body.expectedVersion, reason });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    await requireStepUp({ purpose: "recording_start", userId: authorization.userId, targetId: session.id, payload: { expectedVersion: body.expectedVersion, reason } });
    const existing = await d1.prepare("SELECT id, provider_reference, storage_key, status FROM recordings WHERE session_id = ? AND facility_id = ?").bind(session.id, session.facility_id).first<{ id: string; provider_reference: string | null; storage_key: string | null; status: string }>();
    if (existing?.provider_reference && ["PROCESSING", "AVAILABLE"].includes(existing.status)) {
      const responseBody = { recordingId: existing.id, providerReference: existing.provider_reference, storageKey: existing.storage_key, status: existing.status, idempotent: true };
      const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', processing_started_at = NULL, response_status = 200, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(JSON.stringify(responseBody), new Date().toISOString(), idempotency.claimId, idempotency.scope, idempotency.key).run();
      if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
      idempotency = null;
      return securityResponse(responseBody, 200, context.requestId);
    }
    if (existing?.status === "PENDING" && existing.provider_reference && existing.provider_reference.startsWith("pending:")) {
      throw new SecurityError("RECORDING_START_IN_PROGRESS", 409);
    }
    const recordingId = existing?.id || crypto.randomUUID();
    const storageKey = existing?.storage_key || `recordings/${session.facility_id}/${session.id}/${recordingId}.mp4`;
    const startClaim = `pending:${crypto.randomUUID()}`;
    claimedRecordingId = recordingId;
    claimedRecordingReference = startClaim;
    claimedFacilityId = session.facility_id;
    claimedSessionId = session.id;
    if (!existing) {
      const created = await d1.prepare(`INSERT INTO recordings (id, organization_id, facility_id, session_id, provider, provider_reference, storage_key, status, retention_until, version, created_at, updated_at)
        SELECT ?, f.organization_id, ?, ?, 'livekit', ?, ?, 'PENDING', datetime(?, '+' || COALESCE(vp.recording_retention_days, 30) || ' days'), 1, ?, ?
        FROM facilities f INNER JOIN visit_policies vp ON vp.facility_id = f.id WHERE f.id = ?`)
        .bind(recordingId, session.facility_id, session.id, startClaim, storageKey, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), session.facility_id).run();
      if (!created.meta.changes) throw new SecurityError("RECORDING_START_NOT_PERSISTED", 503);
    } else if (existing.status === "PENDING" && !existing.provider_reference) {
      const claimed = await d1.prepare("UPDATE recordings SET provider_reference = ?, updated_at = ? WHERE id = ? AND facility_id = ? AND status = 'PENDING' AND provider_reference IS NULL").bind(startClaim, new Date().toISOString(), recordingId, session.facility_id).run();
      if (!claimed.meta.changes) throw new SecurityError("RECORDING_START_IN_PROGRESS", 409);
    }
    const config = await getVideoConfig();
    const liveKitUrl = config.url;
    if (!config.configured || config.provider !== "livekit" || !liveKitUrl || !config.apiKey || !config.apiSecret) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    recordingProviderConfig = { url: liveKitUrl, apiKey: config.apiKey, apiSecret: config.apiSecret };
    const started = await startLiveKitRecording({ liveKitUrl, apiKey: config.apiKey, apiSecret: config.apiSecret, roomName: session.provider_room_name, storageKey });
    startedEgressId = started.egressId;
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    recordingCorrelationId = correlationId;
    const latest = await d1.prepare("SELECT provider_reference, storage_key, status FROM recordings WHERE id = ? AND facility_id = ?").bind(recordingId, session.facility_id).first<{ provider_reference: string | null; storage_key: string | null; status: string }>();
    if (!latest) throw new SecurityError("RECORDING_START_NOT_PERSISTED", 503);
    if (latest.provider_reference === started.egressId && ["PROCESSING", "AVAILABLE", "FAILED"].includes(latest.status)) {
      const responseBody = { recordingId, sessionId: session.id, providerReference: started.egressId, storageKey: latest.storage_key || storageKey, status: latest.status, idempotent: true };
      const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', processing_started_at = NULL, response_status = 200, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(JSON.stringify(responseBody), now, idempotency.claimId, idempotency.scope, idempotency.key).run();
      if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
      idempotency = null;
      return securityResponse(responseBody, 200, context.requestId);
    }
    const responseBody = { recordingId, sessionId: session.id, providerReference: started.egressId, storageKey, status: "PROCESSING", correlationId };
    const guard = { sql: "EXISTS (SELECT 1 FROM recordings WHERE id = ? AND provider_reference = ? AND status = 'PROCESSING')", values: [recordingId, started.egressId] };
    if (latest.status !== "PENDING" || (latest.provider_reference && latest.provider_reference !== startClaim && !latest.provider_reference.startsWith("pending:"))) {
      throw new SecurityError("RECORDING_START_STATE_CHANGED", 409);
    }
    const statements = [d1.prepare("UPDATE recordings SET provider_reference = ?, storage_key = ?, status = 'PROCESSING', version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND status = 'PENDING' AND (provider_reference = ? OR provider_reference IS NULL)").bind(started.egressId, storageKey, now, recordingId, session.facility_id, latest.provider_reference || startClaim)];
    const results = await d1.batch([...statements, d1.prepare("UPDATE visit_sessions SET recording_status = 'RECORDING', version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(now, session.id, session.facility_id, session.version), ...auditAndOutboxStatements(d1, { actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Supervisor", facilityId: session.facility_id, actionType: "RECORDING_STARTED", entityType: "recording", entityId: recordingId, reason, newValues: responseBody, requestId: context.requestId, correlationId, eventType: "RECORDING_STARTED", payload: { recordingId, sessionId: session.id, providerReference: started.egressId } }, guard), completeIdempotencyStatement(d1, { ...idempotency, status: 201, body: responseBody, guard })]);
    if (!results.every((result) => Boolean(result?.meta.changes))) throw new SecurityError("RECORDING_START_NOT_PERSISTED", 503);
    idempotency = null;
    return securityResponse(responseBody, 201, context.requestId);
  } catch (error) {
    if (d1 && claimedRecordingId && startedEgressId && recordingProviderConfig) {
      let providerAlreadyBound = false;
      try {
        const current = await d1.prepare("SELECT provider_reference, status FROM recordings WHERE id = ? AND facility_id = ?").bind(claimedRecordingId, claimedFacilityId).first<{ provider_reference: string | null; status: string }>();
        providerAlreadyBound = current?.provider_reference === startedEgressId && ["PROCESSING", "AVAILABLE", "FAILED"].includes(current.status);
      } catch { /* Attempt cleanup when authoritative state cannot be read. */ }
      if (!providerAlreadyBound) {
        try {
          await stopLiveKitRecording({ liveKitUrl: recordingProviderConfig.url, apiKey: recordingProviderConfig.apiKey, apiSecret: recordingProviderConfig.apiSecret, egressId: startedEgressId });
        } catch (cleanupError) {
          try {
            if (claimedFacilityId && claimedSessionId) await recordingProviderCleanupFailureStatement(d1, {
              facilityId: claimedFacilityId,
              recordingId: claimedRecordingId,
              sessionId: claimedSessionId,
              providerReference: startedEgressId,
              reason: cleanupError instanceof Error ? cleanupError.message.slice(0, 500) : String(cleanupError).slice(0, 500),
              requestId: context.requestId,
              correlationId: recordingCorrelationId || crypto.randomUUID(),
              now: new Date().toISOString(),
            }).run();
          } catch { /* Preserve the original provider error; operations can inspect provider reconciliation. */ }
        }
      }
    }
    if (d1 && claimedRecordingId && claimedRecordingReference) {
      try {
        await d1.prepare("UPDATE recordings SET provider_reference = NULL, updated_at = ? WHERE id = ? AND status = 'PENDING' AND provider_reference = ?").bind(new Date().toISOString(), claimedRecordingId, claimedRecordingReference).run();
      } catch { /* Preserve the original provider error; scheduled recovery can inspect the claim. */ }
    }
    if (d1 && idempotency) { try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve original error. */ } }
    return securityErrorResponse(error, context.requestId);
  }
}
