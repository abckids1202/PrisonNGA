import { getD1 } from "../../../../db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("recording.manage");
    const d1 = await getD1();
    const facility = await d1.prepare("SELECT organization_id FROM facilities WHERE id = ?").bind(authorization.facilityId).first<{ organization_id: string | null }>();
    if (!facility?.organization_id) throw new SecurityError("FACILITY_ORGANIZATION_NOT_CONFIGURED", 503);
    const recordings = await d1.prepare(`SELECT r.id, r.session_id, r.facility_id, r.provider, r.provider_reference,
        r.status, r.content_type, r.byte_size, r.sha256, r.retention_until, r.legal_hold, r.created_at, r.updated_at,
        (SELECT COUNT(*) FROM recording_access_events rae WHERE rae.recording_id = r.id AND rae.facility_id = r.facility_id) AS access_count,
        (SELECT MAX(rae.created_at) FROM recording_access_events rae WHERE rae.recording_id = r.id AND rae.facility_id = r.facility_id) AS last_accessed_at,
        a.id AS appointment_id, a.requested_start, a.requested_end,
        u.display_name AS visitor_name, p.display_name AS prisoner_name
      FROM recordings r
      INNER JOIN facilities f ON f.id = r.facility_id AND f.organization_id = ?
      INNER JOIN visit_sessions vs ON vs.id = r.session_id AND vs.facility_id = r.facility_id
      INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = r.facility_id
      INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = r.facility_id
      WHERE r.facility_id = ? AND r.organization_id = f.organization_id ORDER BY r.created_at DESC LIMIT 100`).bind(facility.organization_id, authorization.facilityId).all();
    return securityResponse({ recordings: recordings.results }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
