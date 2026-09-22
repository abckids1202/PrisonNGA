import { getD1 } from "@/db/runtime";
import { finalizeLiveSessionStatements, requestLiveSessionEndStatements } from "@/lib/server/live-session-finalization";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "@/lib/server/security";
import { getStaffSession } from "@/lib/server/video/session";
import { createLiveKitProvider } from "@/lib/server/video/provider";

type RouteContext = { params: Promise<{ sessionId: string }> };
type EndMode = "normal" | "terminate";

export async function POST(request: Request, context: RouteContext) {
  const requestContext = await getRequestContext();
  try {
    const authorization = await requirePermission("session.monitor");
    const { sessionId } = await context.params;
    const body = await request.json() as { reason?: unknown; expectedVersion?: unknown; mode?: unknown };
    if (body.mode !== undefined && body.mode !== "normal" && body.mode !== "terminate") throw new SecurityError("INVALID_SESSION_END_MODE", 400);
    const session = await getStaffSession(sessionId, authorization.facilityId);
    const d1 = await getD1();
    const appointment = await d1.prepare(`SELECT a.status, a.version, ca.id AS credit_account_id
      FROM appointments a LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
      WHERE a.id = ? AND a.facility_id = ?`).bind(session.appointment_id, authorization.facilityId)
      .first<{ status: string; version: number; credit_account_id: string | null }>();
    if (!appointment) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);

    if (["ENDED", "TERMINATED", "CANCELLED"].includes(session.status)) {
      if (session.status === "CANCELLED") return securityResponse({ sessionId, status: session.status, idempotent: true }, 200, requestContext.requestId);
      const expectedStatus = session.status === "ENDED" ? "COMPLETED" : "TECHNICAL_FAILURE";
      const expectedEntry = session.status === "ENDED" ? "CONSUMPTION" : "RESERVATION_RELEASE";
      const settled = appointment.credit_account_id && appointment.status === expectedStatus
        ? await d1.prepare("SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = ?")
          .bind(session.appointment_id, appointment.credit_account_id, expectedEntry).first()
        : null;
      if (!settled) throw new SecurityError("SESSION_SETTLEMENT_REQUIRES_RECONCILIATION", 503);
      return securityResponse({ sessionId, status: session.status, idempotent: true }, 200, requestContext.requestId);
    }

    if (body.expectedVersion !== undefined && body.expectedVersion !== session.version) throw new SecurityError("STALE_SESSION_STATE", 409);
    if (!appointment.credit_account_id) throw new SecurityError("CREDIT_RESERVATION_NOT_FOUND", 409);
    if (appointment.status !== "IN_PROGRESS") throw new SecurityError("APPOINTMENT_NOT_IN_PROGRESS", 409);
    const mode: EndMode = session.status === "ENDING"
      ? session.termination_reason?.startsWith("STAFF_TERMINATE:") ? "terminate" : "normal"
      : (body.mode as EndMode | undefined) || "normal";
    if (session.status === "ENDING" && body.mode !== undefined && body.mode !== mode) throw new SecurityError("SESSION_END_ALREADY_REQUESTED", 409);
    if (!["CONNECTING", "ACTIVE", "RECONNECTING", "ENDING"].includes(session.status)) throw new SecurityError("SESSION_NOT_ENDABLE", 409);
    if (mode === "normal" && !session.actual_started_at) throw new SecurityError("VISIT_NOT_STARTED_MUST_BE_TERMINATED", 409);
    const reason = session.status === "ENDING" && session.termination_reason?.startsWith("STAFF_TERMINATE:")
      ? session.termination_reason.slice("STAFF_TERMINATE:".length)
      : assertReason(body.reason);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    if (session.status !== "ENDING") {
      const requested = await d1.batch(requestLiveSessionEndStatements(d1, {
        sessionId,
        appointmentId: session.appointment_id,
        facilityId: authorization.facilityId,
        sessionVersion: session.version,
        sessionStatus: session.status,
        appointmentVersion: appointment.version,
        creditAccountId: appointment.credit_account_id,
        actorUserId: authorization.userId,
        actorRole: authorization.roles[0] || "STAFF",
        requestId: requestContext.requestId,
        correlationId,
        now,
        reason,
        mode,
      }));
      if (!requested[0]?.meta.changes) throw new SecurityError("STALE_SESSION_STATE", 409);
    }

    try {
      const provider = await createLiveKitProvider();
      await provider.endRoom(session.provider_room_name);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_PROVIDER_NOT_CONFIGURED") throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
      throw new SecurityError("VIDEO_PROVIDER_END_FAILED", 502);
    }

    const latest = await d1.prepare(`SELECT vs.status, vs.version, a.status AS appointment_status, a.version AS appointment_version
      FROM visit_sessions vs INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
      WHERE vs.id = ? AND vs.facility_id = ?`).bind(sessionId, authorization.facilityId)
      .first<{ status: string; version: number; appointment_status: string; appointment_version: number }>();
    if (!latest) throw new SecurityError("SESSION_NOT_FOUND", 404);
    const finalSessionStatus = mode === "terminate" ? "TERMINATED" : "ENDED";
    const finalAppointmentStatus = mode === "terminate" ? "TECHNICAL_FAILURE" : "COMPLETED";
    const creditOutcome = mode === "terminate" ? "RELEASE" : "CONSUME";
    if (latest.status === finalSessionStatus && latest.appointment_status === finalAppointmentStatus) {
      const expectedEntry = mode === "terminate" ? "RESERVATION_RELEASE" : "CONSUMPTION";
      const settled = await d1.prepare("SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = ?")
        .bind(session.appointment_id, appointment.credit_account_id, expectedEntry).first();
      if (settled) return securityResponse({ sessionId, status: latest.status, idempotent: true }, 200, requestContext.requestId);
      throw new SecurityError("SESSION_SETTLEMENT_REQUIRES_RECONCILIATION", 503);
    }
    if (latest.status !== "ENDING") throw new SecurityError("STALE_SESSION_STATE", 409);

    const finalized = await d1.batch(finalizeLiveSessionStatements(d1, {
      sessionId,
      appointmentId: session.appointment_id,
      facilityId: authorization.facilityId,
      sessionVersion: latest.version,
      sessionStatus: "ENDING",
      finalSessionStatus,
      appointmentVersion: latest.appointment_version,
      finalAppointmentStatus,
      creditAccountId: appointment.credit_account_id,
      creditOutcome,
      actorUserId: authorization.userId,
      actorRole: authorization.roles[0] || "STAFF",
      requestId: requestContext.requestId,
      correlationId,
      now: new Date().toISOString(),
      reason,
      event: {
        id: crypto.randomUUID(),
        eventType: mode === "terminate" ? "SESSION_TERMINATED" : "SESSION_ENDED",
        source: "STAFF",
        participantRole: "FACILITY",
        metadata: { reason, mode },
      },
    }));
    if (!finalized[1]?.meta.changes || !finalized[2]?.meta.changes || !finalized[4]?.meta.changes) {
      const raced = await d1.prepare(`SELECT vs.status, a.status AS appointment_status FROM visit_sessions vs
        INNER JOIN appointments a ON a.id = vs.appointment_id AND a.facility_id = vs.facility_id
        WHERE vs.id = ? AND vs.facility_id = ?`).bind(sessionId, authorization.facilityId)
        .first<{ status: string; appointment_status: string }>();
      if (raced?.status === finalSessionStatus && raced.appointment_status === finalAppointmentStatus) {
        const expectedEntry = mode === "terminate" ? "RESERVATION_RELEASE" : "CONSUMPTION";
        const settled = await d1.prepare("SELECT id FROM credit_ledger_entries WHERE appointment_id = ? AND credit_account_id = ? AND entry_type = ?")
          .bind(session.appointment_id, appointment.credit_account_id, expectedEntry).first();
        if (settled) return securityResponse({ sessionId, status: raced.status, idempotent: true }, 200, requestContext.requestId);
      }
      throw new SecurityError("STALE_SESSION_STATE", 409);
    }
    return securityResponse({ sessionId, status: finalSessionStatus, appointmentStatus: finalAppointmentStatus, endedAt: new Date().toISOString(), correlationId }, 200, requestContext.requestId);
  } catch (error) {
    return securityErrorResponse(error, requestContext.requestId);
  }
}
