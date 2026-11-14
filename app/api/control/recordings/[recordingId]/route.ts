import { getD1 } from "../../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../../lib/server/security";

/** Metadata-only detail boundary. Playback remains a separate audited operation. */
export async function GET(_request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("recording.manage");
    const { recordingId } = await params;
    if (!recordingId || recordingId.length > 128) throw new SecurityError("RECORDING_NOT_FOUND", 404);
    const d1 = await getD1();
    const facility = await d1.prepare("SELECT organization_id FROM facilities WHERE id = ?")
      .bind(authorization.facilityId)
      .first<{ organization_id: string | null }>();
    if (!facility?.organization_id) throw new SecurityError("FACILITY_ORGANIZATION_NOT_CONFIGURED", 503);
    const recording = await d1.prepare(`SELECT r.id, r.organization_id, r.facility_id, r.session_id, r.provider,
        r.provider_reference, r.status, r.content_type, r.byte_size, r.sha256,
        r.retention_until, r.legal_hold, r.failure_reason, r.created_at, r.updated_at,
        vs.status AS session_status, vs.recording_policy, vs.recording_status, vs.actual_started_at, vs.actual_ended_at,
        a.id AS appointment_id, a.requested_start, a.requested_end,
        u.display_name AS visitor_name, p.display_name AS prisoner_name
      FROM recordings r
      INNER JOIN facilities f ON f.id = r.facility_id AND f.organization_id = r.organization_id
      INNER JOIN visit_sessions vs ON vs.id = r.session_id AND vs.facility_id = r.facility_id
      INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = r.facility_id
      INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = r.facility_id
      WHERE r.id = ? AND r.organization_id = ? AND r.facility_id = ?`)
      .bind(recordingId, facility.organization_id, authorization.facilityId)
      .first<Record<string, unknown>>();
    if (!recording) throw new SecurityError("RECORDING_NOT_FOUND", 404);
    const access = await d1.prepare(`SELECT rae.id, rae.actor_user_id, rae.access_type, rae.break_glass_request_id,
        rae.reason, rae.correlation_id, rae.created_at, u.display_name AS actor_name
      FROM recording_access_events rae
      LEFT JOIN users u ON u.id = rae.actor_user_id
      WHERE rae.recording_id = ? AND rae.organization_id = ? AND rae.facility_id = ?
      ORDER BY rae.created_at DESC LIMIT 50`)
      .bind(recordingId, facility.organization_id, authorization.facilityId)
      .all();
    return securityResponse({ recording, accessEvents: access.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
