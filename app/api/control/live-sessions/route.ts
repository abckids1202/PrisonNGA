import { getD1 } from "@/db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "@/lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("session.monitor");
    const d1 = await getD1();
    const rows = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.status, vs.provider, vs.authorized_start_at, vs.authorized_end_at,
        vs.actual_started_at, vs.actual_ended_at, vs.recording_policy, vs.recording_status, vs.termination_reason,
        u.display_name AS visitor_name, p.display_name AS prisoner_name, p.prisoner_number,
        a.requested_start, a.requested_end, a.appointment_type,
        (SELECT r.display_name FROM resources r WHERE r.id = (SELECT rr.resource_id FROM resource_reservations rr
          WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM'
          ORDER BY rr.created_at DESC LIMIT 1) AND r.facility_id = a.facility_id) AS room_name,
        (SELECT r.display_name FROM resources r WHERE r.id = (SELECT rr.resource_id FROM resource_reservations rr
          WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE'
          ORDER BY rr.created_at DESC LIMIT 1) AND r.facility_id = a.facility_id) AS kiosk_name
      FROM visit_sessions vs
      INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
      WHERE vs.facility_id = ? AND (
        vs.status IN ('CONNECTING', 'ACTIVE', 'RECONNECTING', 'ENDING') OR
        (vs.status IN ('ENDED', 'TERMINATED', 'FAILED', 'CANCELLED') AND julianday(vs.actual_ended_at) >= julianday('now', '-24 hours'))
      ) ORDER BY CASE WHEN vs.status IN ('CONNECTING', 'ACTIVE', 'RECONNECTING', 'ENDING') THEN 0 ELSE 1 END,
        COALESCE(vs.actual_started_at, vs.authorized_start_at) DESC LIMIT 40`).bind(authorization.facilityId).all();
    const sessions = rows.results || [];
    return securityResponse({
      sessions: sessions.filter((session) => typeof session.status === "string" && ["CONNECTING", "ACTIVE", "RECONNECTING", "ENDING"].includes(session.status)),
      recentlyEnded: sessions.filter((session) => typeof session.status === "string" && ["ENDED", "TERMINATED", "FAILED", "CANCELLED"].includes(session.status)),
      facilityId: authorization.facilityId,
      generatedAt: new Date().toISOString(),
    }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
