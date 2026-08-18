import { getD1 } from "@/db/runtime";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { getStaffSession } from "@/lib/server/video/session";
import { createLiveKitProvider } from "@/lib/server/video/provider";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const authorization = await requirePermission("session.monitor");
    const { sessionId } = await context.params;
    const body = await request.json() as { reason?: string; expectedVersion?: number; mode?: "normal" | "terminate" };
    const reason = assertReason(body.reason);
    const session = await getStaffSession(sessionId, authorization.facilityId);
    if (["ENDED", "TERMINATED", "CANCELLED"].includes(session.status)) return securityResponse({ sessionId, status: session.status, idempotent: true }, 200, requestContext.requestId);
    if (body.expectedVersion !== undefined && body.expectedVersion !== session.version) throw new SecurityError("STALE_SESSION_STATE", 409);
    try {
      const provider = await createLiveKitProvider();
      await provider.endRoom(session.provider_room_name);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_PROVIDER_NOT_CONFIGURED") throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
      throw new SecurityError("VIDEO_PROVIDER_END_FAILED", 502);
    }
    const now = new Date().toISOString();
    const status = body.mode === "terminate" ? "TERMINATED" : "ENDED";
    const correlationId = crypto.randomUUID();
    const d1 = await getD1();
    const appointment = await d1.prepare("SELECT version FROM appointments WHERE id = ? AND facility_id = ?").bind(session.appointment_id, authorization.facilityId).first<{ version: number }>();
    if (!appointment) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const results = await d1.batch([
      d1.prepare("UPDATE visit_sessions SET status = ?, actual_ended_at = ?, termination_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(status, now, reason, now, sessionId, authorization.facilityId, session.version),
      d1.prepare("UPDATE appointments SET status = 'COMPLETED', version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(now, session.appointment_id, authorization.facilityId, appointment.version),
      d1.prepare("UPDATE resource_reservations SET status = 'RELEASED' WHERE appointment_id = ? AND facility_id = ? AND status IN ('RESERVED', 'ACTIVE')").bind(session.appointment_id, authorization.facilityId),
      d1.prepare(`INSERT INTO visit_session_events (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), sessionId, status === "ENDED" ? "SESSION_ENDED" : "SESSION_TERMINATED", "STAFF", "FACILITY", JSON.stringify({ reason }), correlationId, now),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), authorization.userId, authorization.roles[0] || null, authorization.facilityId, status === "ENDED" ? "VISIT_ENDED" : "VISIT_TERMINATED", "visit_session", sessionId, reason, JSON.stringify({ status: session.status, version: session.version }), JSON.stringify({ status, version: session.version + 1 }), correlationId, requestContext.requestId, now),
      d1.prepare(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), status === "ENDED" ? "VISIT_COMPLETED" : "VISIT_TERMINATED", "visit_session", sessionId, authorization.facilityId, JSON.stringify({ sessionId, appointmentId: session.appointment_id, status }), correlationId, now),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) throw new SecurityError("STALE_SESSION_STATE", 409);
    return securityResponse({ sessionId, status, endedAt: now, correlationId }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
