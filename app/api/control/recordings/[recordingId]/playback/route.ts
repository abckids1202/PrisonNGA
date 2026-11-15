import { getD1 } from "../../../../../../db/runtime";
import { getRecordingStore, MAX_FALLBACK_INTEGRITY_BYTES } from "../../../../../../lib/server/evidence-storage";
import { recordingIntegrityFailureStatement } from "../../../../../../lib/server/reconciliation";
import { operationalLog, safeOperationalErrorMessage } from "../../../../../../lib/server/observability";
import { applySecurityHeaders, getRequestContext, requireActiveBreakGlass, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";

async function recordIntegrityFailure(input: {
  database: D1Database;
  facilityId: string;
  recordingId: string;
  storageKey: string;
  reason: string;
  requestId: string;
}): Promise<void> {
  const correlationId = crypto.randomUUID();
  try {
    const result = await input.database.batch([recordingIntegrityFailureStatement(input.database, {
      facilityId: input.facilityId,
      recordingId: input.recordingId,
      storageKey: input.storageKey,
      error: input.reason,
      requestId: input.requestId,
      correlationId,
      now: new Date().toISOString(),
    })]);
    if (!result[0]?.meta.changes) throw new Error("RECORDING_INTEGRITY_ALARM_NOT_PERSISTED");
  } catch (error) {
    operationalLog("error", {
      event: "RECORDING_PLAYBACK_INTEGRITY_ALARM_FAILED",
      facilityId: input.facilityId,
      requestId: input.requestId,
      correlationId,
      error: safeOperationalErrorMessage(error, "RECORDING_INTEGRITY_ALARM_FAILED"),
    });
  }
}

function requestedByteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) throw new SecurityError("RECORDING_RANGE_INVALID", 416);
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new SecurityError("RECORDING_RANGE_INVALID", 416);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) throw new SecurityError("RECORDING_RANGE_INVALID", 416);
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export async function GET(request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const context = await getRequestContext();
  try {
    let authorization;
    let breakGlassRequestId: string | null = null;
    try {
      authorization = await requirePermission("recording.manage");
    } catch (error) {
      // Emergency access is a separate, explicitly approved path. Do not
      // convert authentication, facility-scope, or other failures into a
      // break-glass opportunity.
      if (!(error instanceof SecurityError) || error.code !== "PERMISSION_DENIED") throw error;
      authorization = await requirePermission("access.break_glass.request");
    }
    const { recordingId } = await params;
    const d1 = await getD1();
    const facility = await d1.prepare("SELECT organization_id FROM facilities WHERE id = ?")
      .bind(authorization.facilityId)
      .first<{ organization_id: string | null }>();
    if (!facility?.organization_id) throw new SecurityError("FACILITY_ORGANIZATION_NOT_CONFIGURED", 503);
    const recording = await d1.prepare(`SELECT id, organization_id, facility_id, storage_key, status, content_type, byte_size, sha256, retention_until, legal_hold
      FROM recordings WHERE id = ? AND organization_id = ? AND facility_id = ?`).bind(recordingId, facility.organization_id, authorization.facilityId)
      .first<{ id: string; organization_id: string | null; facility_id: string; storage_key: string | null; status: string; content_type: string | null; byte_size: number | null; sha256: string | null; retention_until: string | null; legal_hold: number }>();
    if (!recording) throw new SecurityError("RECORDING_NOT_FOUND", 404);
    if (!recording.organization_id) throw new SecurityError("RECORDING_ORGANIZATION_SCOPE_MISSING", 503);
    if (!authorization.permissions.includes("recording.manage")) {
      const grant = await requireActiveBreakGlass(d1, { facilityId: authorization.facilityId, userId: authorization.userId, targetType: "recording", targetId: recording.id });
      breakGlassRequestId = grant.requestId;
    }
    if (!recording.legal_hold && recording.retention_until && Date.parse(recording.retention_until) <= Date.now()) throw new SecurityError("RECORDING_RETENTION_EXPIRED", 410);
    if (recording.status !== "AVAILABLE" || !recording.storage_key || !recording.content_type || !recording.byte_size || !recording.sha256) throw new SecurityError("RECORDING_NOT_AVAILABLE", 409);
    const store = await getRecordingStore();
    if (!store) throw new SecurityError("RECORDING_STORAGE_NOT_CONFIGURED", 503);
    const object = await store.get(recording.storage_key);
    if (!object || object.size !== recording.byte_size) {
      await recordIntegrityFailure({ database: d1, facilityId: recording.facility_id, recordingId: recording.id, storageKey: recording.storage_key, reason: "The recorded object is missing or its persisted size does not match.", requestId: context.requestId });
      throw new SecurityError("RECORDING_NOT_AVAILABLE", 404);
    }
    if (object.checksumSha256) {
      if (object.checksumSha256 !== recording.sha256) {
        await recordIntegrityFailure({ database: d1, facilityId: recording.facility_id, recordingId: recording.id, storageKey: recording.storage_key, reason: "The recorded object checksum does not match the persisted recording digest.", requestId: context.requestId });
        throw new SecurityError("RECORDING_INTEGRITY_CHECK_FAILED", 409);
      }
    } else {
      if (object.size > MAX_FALLBACK_INTEGRITY_BYTES) {
        await recordIntegrityFailure({ database: d1, facilityId: recording.facility_id, recordingId: recording.id, storageKey: recording.storage_key, reason: "The recorded object has no provider checksum and exceeds the bounded fallback verification size.", requestId: context.requestId });
        throw new SecurityError("RECORDING_INTEGRITY_METADATA_MISSING", 503);
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (sha256 !== recording.sha256) {
        await recordIntegrityFailure({ database: d1, facilityId: recording.facility_id, recordingId: recording.id, storageKey: recording.storage_key, reason: "The recorded object fallback digest does not match the persisted recording digest.", requestId: context.requestId });
        throw new SecurityError("RECORDING_INTEGRITY_CHECK_FAILED", 409);
      }
    }
    let range: { start: number; end: number } | null;
    try {
      range = requestedByteRange(request.headers.get("range"), object.size);
    } catch (error) {
      if (error instanceof SecurityError && error.code === "RECORDING_RANGE_INVALID") {
        const response = securityResponse({ error: error.code, requestId: context.requestId }, 416, context.requestId);
        response.headers.set("Content-Range", `bytes */${object.size}`);
        return response;
      }
      throw error;
    }
    const servedObject = range ? await store.get(recording.storage_key, { range: { offset: range.start, length: range.end - range.start + 1 } }) : object;
    if (!servedObject || (range && servedObject.size !== range.end - range.start + 1)) throw new SecurityError("RECORDING_RANGE_UNAVAILABLE", 503);
    const correlationId = crypto.randomUUID();
    const audited = await d1.prepare(`INSERT INTO recording_access_events
      (id, recording_id, organization_id, facility_id, actor_user_id, access_type, break_glass_request_id, reason, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), recording.id, recording.organization_id, authorization.facilityId, authorization.userId, breakGlassRequestId ? "BREAK_GLASS_PLAYBACK" : "PLAYBACK", breakGlassRequestId ? "Approved break-glass recording playback." : "Authorized staff recording playback.", breakGlassRequestId, correlationId, new Date().toISOString()).run();
    if (!audited.meta.changes) throw new SecurityError("RECORDING_ACCESS_AUDIT_FAILED", 503);
    const response = new Response(servedObject.body, { status: range ? 206 : 200, headers: {
      "Content-Type": recording.content_type,
      "Content-Length": String(servedObject.size),
      "Content-Disposition": `inline; filename="securevisit-recording-${recording.id}.bin"`,
      "Cache-Control": "private, no-store, max-age=0",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${object.size}` } : {}),
    } });
    applySecurityHeaders(response, context.requestId);
    response.headers.set("Content-Type", recording.content_type);
    response.headers.set("Content-Length", String(servedObject.size));
    response.headers.set("Content-Disposition", `inline; filename="securevisit-recording-${recording.id}.bin"`);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Accept-Ranges", "bytes");
    if (range) response.headers.set("Content-Range", `bytes ${range.start}-${range.end}/${object.size}`);
    return response;
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
