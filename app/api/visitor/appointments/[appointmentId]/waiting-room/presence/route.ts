import { getD1 } from "../../../../../../../db/runtime";
import { enforceRateLimit } from "../../../../../../../lib/server/rate-limit";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../../lib/server/security";
import { isRecentPresence } from "../../../../../../../lib/server/waiting-room-readiness";

const activeStatuses = ["APPROVED", "WAITING", "IN_PROGRESS"] as const;

export async function POST(_request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { appointmentId } = await params;
    if (!appointmentId || appointmentId.length > 128) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-waiting-room-presence:${visitor.userId}:${appointmentId}`, limit: 120, windowSeconds: 10 * 60 });
    const current = await d1.prepare(`SELECT a.id, a.facility_id, a.status AS appointment_status, a.version AS appointment_version,
        f.current_state AS facility_state, wr.version AS waiting_version, wr.state, wr.visitor_presence, wr.prisoner_presence, wr.prisoner_presence_at
      FROM appointments a
      INNER JOIN facilities f ON f.id = a.facility_id
      LEFT JOIN waiting_room_sessions wr ON wr.appointment_id = a.id AND wr.facility_id = a.facility_id
      WHERE a.id = ? AND a.visitor_user_id = ?`).bind(appointmentId, visitor.userId).first<Record<string, string | number | null>>();
    if (!current) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    if (!activeStatuses.includes(String(current.appointment_status) as typeof activeStatuses[number])) throw new SecurityError("VISIT_NOT_READY_FOR_PRESENCE", 409);
    if (current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    if (!current.waiting_version) throw new SecurityError("WAITING_ROOM_NOT_OPEN", 409);
    const now = new Date().toISOString();
    const prisonerPresent = current.prisoner_presence === "present" && isRecentPresence(current.prisoner_presence_at === null ? null : String(current.prisoner_presence_at));
    const nextState = prisonerPresent ? "BOTH_PRESENT" : "VISITOR_WAITING";
    if (current.visitor_presence === "present" && current.state !== "NOT_ARRIVED") {
      const refreshed = await d1.prepare(`UPDATE waiting_room_sessions
        SET visitor_presence_at = ?, last_checked_at = ?, updated_at = ?
        WHERE appointment_id = ? AND facility_id = ? AND version = ? AND visitor_presence = 'present'`)
        .bind(now, now, now, appointmentId, current.facility_id, Number(current.waiting_version)).run();
      if (!refreshed.meta.changes) throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
      return securityResponse({ presence: "present", state: current.state, visitorPresenceAt: now, prisonerPresence: prisonerPresent ? "present" : "waiting", prisonerPresenceAt: prisonerPresent ? current.prisoner_presence_at || null : null, version: Number(current.waiting_version), idempotent: true }, 200, context.requestId);
    }
    const nextVersion = Number(current.waiting_version) + 1;
    const result = await d1.batch([
      d1.prepare(`UPDATE waiting_room_sessions SET state = CASE WHEN state IN ('NOT_ARRIVED', 'VISITOR_WAITING', 'PRISONER_WAITING', 'BOTH_PRESENT') THEN ? ELSE state END,
          visitor_presence = 'present', visitor_presence_at = ?, version = version + 1, last_checked_at = ?, updated_at = ?
        WHERE appointment_id = ? AND facility_id = ? AND version = ?`)
        .bind(nextState, now, now, now, appointmentId, current.facility_id, Number(current.waiting_version)),
      d1.prepare(`UPDATE appointments SET status = CASE WHEN status = 'APPROVED' THEN 'WAITING' ELSE status END, version = version + 1, updated_at = ?
        WHERE id = ? AND facility_id = ? AND version = ? AND status IN ('APPROVED', 'WAITING', 'IN_PROGRESS')`)
        .bind(now, appointmentId, current.facility_id, Number(current.appointment_version)),
    ]);
    if (!result[0]?.meta.changes || !result[1]?.meta.changes) throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
    return securityResponse({ presence: "present", state: nextState, visitorPresenceAt: now, prisonerPresence: prisonerPresent ? "present" : "waiting", prisonerPresenceAt: prisonerPresent ? current.prisoner_presence_at || null : null, version: nextVersion }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
