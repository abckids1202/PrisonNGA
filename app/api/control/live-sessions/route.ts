import { getD1 } from "@/db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "@/lib/server/security";

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("session.monitor");
    const d1 = await getD1();
    const rows = await d1.prepare(`SELECT vs.id, vs.appointment_id, vs.status, vs.provider, vs.authorized_end_at, vs.actual_started_at, vs.recording_policy, vs.recording_status,
        u.display_name AS visitor_name, a.prisoner_id, a.appointment_type
      FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id INNER JOIN users u ON u.id = a.visitor_user_id
      WHERE vs.facility_id = ? AND vs.status IN ('CONNECTING', 'ACTIVE', 'RECONNECTING', 'ENDING')
      ORDER BY vs.actual_started_at ASC`).bind(authorization.facilityId).all();
    return securityResponse({ sessions: rows.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
