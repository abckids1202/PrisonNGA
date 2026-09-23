import { getD1 } from "../../../../../../db/runtime";
import { authenticateKiosk } from "../../../../../../lib/server/kiosk-credentials";
import { enforceRateLimit } from "../../../../../../lib/server/rate-limit";
import { getRequestContext, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";

export async function POST(request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  const context = await getRequestContext();
  try {
    const body = await request.json() as { presence?: unknown };
    if (body.presence !== "present" && body.presence !== "absent") throw new SecurityError("INVALID_KIOSK_PRESENCE", 400);
    const { visitId } = await params;
    if (!visitId || visitId.length > 128) throw new SecurityError("VISIT_NOT_FOUND", 404);
    const d1 = await getD1();
    const kiosk = await authenticateKiosk(d1, request);
    if (!kiosk) throw new SecurityError("KIOSK_AUTHENTICATION_REQUIRED", 401);
    await enforceRateLimit(d1, { key: `kiosk-presence:${kiosk.facilityId}:${kiosk.resourceId}`, limit: 120, windowSeconds: 60 });
    const current = await d1.prepare(`SELECT a.id, a.facility_id, a.status AS appointment_status, a.version AS appointment_version,
        f.current_state AS facility_state, wr.version AS waiting_version, wr.state, wr.visitor_presence, wr.prisoner_presence
      FROM appointments a
      INNER JOIN facilities f ON f.id = a.facility_id
      LEFT JOIN waiting_room_sessions wr ON wr.appointment_id = a.id AND wr.facility_id = a.facility_id
      LEFT JOIN resource_reservations rr ON rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.resource_id = ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')
      WHERE a.id = ? AND a.facility_id = ? AND (rr.appointment_id IS NOT NULL OR wr.assigned_kiosk_id = ?)`).bind(kiosk.resourceId, visitId, kiosk.facilityId, kiosk.resourceId).first<Record<string, string | number | null>>();
    if (!current) throw new SecurityError("KIOSK_NOT_ASSIGNED_TO_VISIT", 403);
    const terminalPresenceClear = body.presence === "absent" && ["COMPLETED", "CANCELLED_BY_FACILITY", "CANCELLED_BY_VISITOR", "TECHNICAL_FAILURE", "NO_SHOW"].includes(String(current.appointment_status));
    if (!terminalPresenceClear && !["APPROVED", "WAITING", "IN_PROGRESS"].includes(String(current.appointment_status))) throw new SecurityError("VISIT_NOT_READY_FOR_PRESENCE", 409);
    if (!terminalPresenceClear && current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    if (terminalPresenceClear) {
      return securityResponse({ visitId, state: current.state || "COMPLETED", prisonerPresence: body.presence, visitorPresence: current.visitor_presence || "absent", version: Number(current.waiting_version || 0), idempotent: true }, 200, context.requestId);
    }
    const stableStates = ["NOT_ARRIVED", "VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT", "TECHNICAL_ISSUE", "STAFF_REVIEW", "READY_TO_START", "LATE", "LIVE"];
    if (String(current.prisoner_presence || "absent") === body.presence && stableStates.includes(String(current.state || "NOT_ARRIVED"))) {
      return securityResponse({ visitId, state: current.state || "NOT_ARRIVED", prisonerPresence: body.presence, visitorPresence: current.visitor_presence || "absent", version: Number(current.waiting_version || 0), idempotent: true }, 200, context.requestId);
    }
    const now = new Date().toISOString();
    const nextVisitorPresence = String(current.visitor_presence || "absent");
    const nextState = terminalPresenceClear ? String(current.state || "COMPLETED") : current.state === "LIVE" ? "LIVE" : body.presence === "present"
      ? nextVisitorPresence === "present" ? "BOTH_PRESENT" : "PRISONER_WAITING"
      : nextVisitorPresence === "present" ? "VISITOR_WAITING" : "NOT_ARRIVED";
    const currentVersion = Number(current.waiting_version || 0);
    const nextVersion = currentVersion + 1;
    const correlationId = crypto.randomUUID();
    const result = await d1.batch([
      d1.prepare(`UPDATE waiting_room_sessions SET state = ?, prisoner_presence = ?, version = ?, last_checked_at = ?, updated_at = ?
        WHERE appointment_id = ? AND facility_id = ? AND version = ?
          AND EXISTS (SELECT 1 FROM appointments a WHERE a.id = ? AND a.facility_id = ? AND a.version = ? AND a.status IN ('APPROVED', 'WAITING', 'IN_PROGRESS'))`)
        .bind(nextState, body.presence, nextVersion, now, now, visitId, kiosk.facilityId, currentVersion, visitId, kiosk.facilityId, Number(current.appointment_version || 1)),
      d1.prepare(`UPDATE appointments SET status = CASE WHEN ? = 'present' AND status = 'APPROVED' THEN 'WAITING' ELSE status END, version = version + 1, updated_at = ?
        WHERE id = ? AND facility_id = ? AND version = ? AND status IN ('APPROVED', 'WAITING', 'IN_PROGRESS')
          AND EXISTS (SELECT 1 FROM waiting_room_sessions wr WHERE wr.appointment_id = ? AND wr.facility_id = ? AND wr.version = ?)`)
        .bind(body.presence, now, visitId, kiosk.facilityId, Number(current.appointment_version || 1), visitId, kiosk.facilityId, nextVersion),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        SELECT ?, NULL, 'KIOSK', ?, ?, 'waiting_room', ?, 'Controlled kiosk reported prisoner presence.', ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), kiosk.facilityId, `KIOSK_PRISONER_${String(body.presence).toUpperCase()}`, visitId, JSON.stringify({ state: current.state || "NOT_ARRIVED", prisonerPresence: current.prisoner_presence || "waiting", version: currentVersion }), JSON.stringify({ state: nextState, prisonerPresence: body.presence, version: nextVersion, resourceId: kiosk.resourceId }), correlationId, context.requestId, now),
      d1.prepare(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        SELECT ?, ?, 'appointment', ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), `KIOSK_PRISONER_${String(body.presence).toUpperCase()}`, visitId, kiosk.facilityId, JSON.stringify({ appointmentId: visitId, state: nextState, prisonerPresence: body.presence, resourceId: kiosk.resourceId }), correlationId, now),
    ]);
    if (!result[0]?.meta.changes || !result[1]?.meta.changes) throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
    return securityResponse({ visitId, state: nextState, prisonerPresence: body.presence, visitorPresence: nextVisitorPresence, version: nextVersion, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
