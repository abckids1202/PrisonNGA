import { getD1 } from "@/db/runtime";
import { getRequestContext, requirePermission, securityErrorResponse, securityResponse } from "@/lib/server/security";
import { getStaffSession, toSessionPayload } from "@/lib/server/video/session";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const authorization = await requirePermission("session.monitor");
    const { sessionId } = await context.params;
    const session = await getStaffSession(sessionId, authorization.facilityId);
    const d1 = await getD1();
    const events = await d1.prepare(`SELECT vse.id, vse.event_type, vse.source, vse.participant_role, vse.metadata, vse.correlation_id, vse.created_at
      FROM visit_session_events vse
      INNER JOIN visit_sessions vs ON vs.id = vse.session_id AND vs.facility_id = ?
      WHERE vse.session_id = ? ORDER BY vse.created_at DESC LIMIT 50`).bind(authorization.facilityId, sessionId).all();
    const reconciliation = await d1.prepare(`SELECT id, action_type, reason, correlation_id, request_id, created_at, new_values
      FROM audit_events
      WHERE facility_id = ? AND entity_type = 'visit_session' AND entity_id = ?
        AND action_type = 'LIVE_SESSION_FINALIZATION_BLOCKED'
      ORDER BY created_at DESC LIMIT 1`).bind(authorization.facilityId, sessionId).first();
    return securityResponse({
      session: toSessionPayload(session),
      events: events.results,
      reconciliation: reconciliation ? { required: true, ...reconciliation } : { required: false },
      permissions: authorization.permissions,
    }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
