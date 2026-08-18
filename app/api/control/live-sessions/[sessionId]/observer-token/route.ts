import { getD1 } from "@/db/runtime";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { createLiveKitProvider, getVideoConfig } from "@/lib/server/video/provider";
import { assertJoinable, getStaffSession, toSessionPayload } from "@/lib/server/video/session";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const authorization = await requirePermission("session.monitor");
    const { sessionId } = await context.params;
    const body = await request.json() as { reason?: string };
    const reason = assertReason(body.reason);
    const session = await getStaffSession(sessionId, authorization.facilityId);
    assertJoinable(session);
    const config = await getVideoConfig();
    if (!config.configured) throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
    const provider = await createLiveKitProvider();
    const token = await provider.createParticipantToken({ roomName: session.provider_room_name, identity: `observer:${authorization.userId}`, name: authorization.displayName, role: "STAFF_OBSERVER" });
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const d1 = await getD1();
    await d1.batch([
      d1.prepare(`INSERT INTO visit_session_events (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), sessionId, "MONITORING_STARTED", "STAFF", "STAFF_OBSERVER", JSON.stringify({ reason }), correlationId, now),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), authorization.userId, authorization.roles[0] || null, authorization.facilityId, "SESSION_MONITORING_STARTED", "visit_session", sessionId, reason, null, JSON.stringify({ participantRole: "STAFF_OBSERVER" }), correlationId, requestContext.requestId, now),
    ]);
    return securityResponse({ token, serverUrl: config.url, session: toSessionPayload(session), participantRole: "STAFF_OBSERVER", expiresInSeconds: 600 }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
