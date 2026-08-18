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
    const events = await d1.prepare(`SELECT id, event_type, source, participant_role, metadata, correlation_id, created_at
      FROM visit_session_events WHERE session_id = ? ORDER BY created_at DESC LIMIT 50`).bind(sessionId).all();
    return securityResponse({ session: toSessionPayload(session), events: events.results, permissions: authorization.permissions }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
