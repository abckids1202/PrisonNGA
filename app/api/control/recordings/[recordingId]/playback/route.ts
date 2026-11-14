import { getD1 } from "../../../../../../db/runtime";
import { getRecordingStore, MAX_FALLBACK_INTEGRITY_BYTES } from "../../../../../../lib/server/evidence-storage";
import { applySecurityHeaders, getRequestContext, requireActiveBreakGlass, requirePermission, securityErrorResponse, SecurityError } from "../../../../../../lib/server/security";

export async function GET(_request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
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
    if (!object || object.size !== recording.byte_size) throw new SecurityError("RECORDING_NOT_AVAILABLE", 404);
    if (object.checksumSha256) {
      if (object.checksumSha256 !== recording.sha256) throw new SecurityError("RECORDING_INTEGRITY_CHECK_FAILED", 409);
    } else {
      if (object.size > MAX_FALLBACK_INTEGRITY_BYTES) throw new SecurityError("RECORDING_INTEGRITY_METADATA_MISSING", 503);
      const bytes = new Uint8Array(await object.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (sha256 !== recording.sha256) throw new SecurityError("RECORDING_INTEGRITY_CHECK_FAILED", 409);
    }
    const correlationId = crypto.randomUUID();
    const audited = await d1.prepare(`INSERT INTO recording_access_events
      (id, recording_id, organization_id, facility_id, actor_user_id, access_type, break_glass_request_id, reason, correlation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), recording.id, recording.organization_id, authorization.facilityId, authorization.userId, breakGlassRequestId ? "BREAK_GLASS_PLAYBACK" : "PLAYBACK", breakGlassRequestId ? "Approved break-glass recording playback." : "Authorized staff recording playback.", breakGlassRequestId, correlationId, new Date().toISOString()).run();
    if (!audited.meta.changes) throw new SecurityError("RECORDING_ACCESS_AUDIT_FAILED", 503);
    const response = new Response(object.body, { status: 200, headers: {
      "Content-Type": recording.content_type,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="securevisit-recording-${recording.id}.bin"`,
      "Cache-Control": "private, no-store, max-age=0",
      "Cross-Origin-Resource-Policy": "same-origin",
    } });
    applySecurityHeaders(response, context.requestId);
    response.headers.set("Content-Type", recording.content_type);
    response.headers.set("Content-Length", String(object.size));
    response.headers.set("Content-Disposition", `inline; filename="securevisit-recording-${recording.id}.bin"`);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
