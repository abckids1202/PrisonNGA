import { getD1 } from "../../../../../../db/runtime";
import { getRecordingStore } from "../../../../../../lib/server/evidence-storage";
import { applySecurityHeaders, getRequestContext, requirePermission, securityErrorResponse, SecurityError } from "../../../../../../lib/server/security";

export async function GET(_request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("session.monitor");
    const { recordingId } = await params;
    const d1 = await getD1();
    const recording = await d1.prepare(`SELECT id, facility_id, storage_key, status, content_type, byte_size, sha256, legal_hold
      FROM recordings WHERE id = ? AND facility_id = ?`).bind(recordingId, authorization.facilityId)
      .first<{ id: string; facility_id: string; storage_key: string | null; status: string; content_type: string | null; byte_size: number | null; sha256: string | null; legal_hold: number }>();
    if (!recording) throw new SecurityError("RECORDING_NOT_FOUND", 404);
    if (recording.status !== "AVAILABLE" || !recording.storage_key || !recording.content_type || !recording.byte_size || !recording.sha256) throw new SecurityError("RECORDING_NOT_AVAILABLE", 409);
    const store = await getRecordingStore();
    if (!store) throw new SecurityError("RECORDING_STORAGE_NOT_CONFIGURED", 503);
    const object = await store.get(recording.storage_key);
    if (!object || object.size !== recording.byte_size) throw new SecurityError("RECORDING_NOT_AVAILABLE", 404);
    const bytes = new Uint8Array(await object.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (sha256 !== recording.sha256) throw new SecurityError("RECORDING_INTEGRITY_CHECK_FAILED", 409);
    const correlationId = crypto.randomUUID();
    const audited = await d1.prepare(`INSERT INTO recording_access_events
      (id, recording_id, facility_id, actor_user_id, access_type, reason, correlation_id, created_at)
      VALUES (?, ?, ?, ?, 'PLAYBACK', 'Authorized staff recording playback.', ?, ?)`)
      .bind(crypto.randomUUID(), recording.id, authorization.facilityId, authorization.userId, correlationId, new Date().toISOString()).run();
    if (!audited.meta.changes) throw new SecurityError("RECORDING_ACCESS_AUDIT_FAILED", 503);
    const response = new Response(bytes, { status: 200, headers: {
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
