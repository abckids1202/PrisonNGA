import { getD1 } from "../../../../../../../db/runtime";
import { enforceRateLimit } from "../../../../../../../lib/server/rate-limit";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../../lib/server/security";
import { isRecentPresence } from "../../../../../../../lib/server/waiting-room-readiness";
import { recordWaitingRoomReconciliationRequired } from "../../../../../../../lib/server/reconciliation";

const activeStatuses = ["APPROVED", "WAITING", "IN_PROGRESS"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const context = await getRequestContext();
  try {
    const rawBody = await request.text();
    let requestedPresence: unknown = "present";
    if (rawBody.trim()) {
      try {
        requestedPresence = (JSON.parse(rawBody) as { presence?: unknown }).presence;
      } catch {
        throw new SecurityError("INVALID_VISITOR_PRESENCE", 400);
      }
    }
    if (requestedPresence !== "present" && requestedPresence !== "absent") throw new SecurityError("INVALID_VISITOR_PRESENCE", 400);
    const presence = requestedPresence as "present" | "absent";
    const visitor = await requireVisitorIdentity();
    const { appointmentId } = await params;
    if (!appointmentId || appointmentId.length > 128) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const d1 = await getD1();
    await enforceRateLimit(d1, { key: `visitor-waiting-room-presence:${visitor.userId}:${appointmentId}`, limit: 120, windowSeconds: 10 * 60 });
    const current = await d1.prepare(`SELECT a.id, a.facility_id, a.status AS appointment_status, a.version AS appointment_version,
        f.current_state AS facility_state, wr.version AS waiting_version, wr.state, wr.visitor_presence, wr.visitor_presence_at, wr.prisoner_presence, wr.prisoner_presence_at, wr.last_checked_at
      FROM appointments a
      INNER JOIN facilities f ON f.id = a.facility_id
      LEFT JOIN waiting_room_sessions wr ON wr.appointment_id = a.id AND wr.facility_id = a.facility_id
      WHERE a.id = ? AND a.visitor_user_id = ?`).bind(appointmentId, visitor.userId).first<Record<string, string | number | null>>();
    if (!current) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    if (!activeStatuses.includes(String(current.appointment_status) as typeof activeStatuses[number])) throw new SecurityError("VISIT_NOT_READY_FOR_PRESENCE", 409);
    if (current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    if (!current.waiting_version) throw new SecurityError("WAITING_ROOM_NOT_OPEN", 409);
    // Clearing presence is allowed during a facility restriction so a
    // browser cannot leave a false-positive visitor in the operational queue.
    if (presence === "present" && current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    const now = new Date().toISOString();
    const prisonerPresent = current.prisoner_presence === "present" && isRecentPresence(current.prisoner_presence_at === null ? null : String(current.prisoner_presence_at));

    // A browser can disappear without a final navigation request. Allow the
    // visitor client to explicitly clear its presence when pagehide/leave is
    // observed, while preserving LIVE and staff-escalated states. This keeps
    // the queue truthful immediately instead of waiting for the freshness
    // timeout used by reconciliation.
    if (presence === "absent") {
      const currentState = String(current.state || "NOT_ARRIVED");
      const nextState = currentState === "LIVE"
        ? "LIVE"
        : ["NOT_ARRIVED", "VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"].includes(currentState)
          ? prisonerPresent ? "PRISONER_WAITING" : "NOT_ARRIVED"
          : currentState;
      if (current.visitor_presence !== "present") {
        return securityResponse({ presence: "absent", state: currentState, visitorPresenceAt: current.visitor_presence_at || null, prisonerPresence: prisonerPresent ? "present" : current.prisoner_presence || "waiting", version: Number(current.waiting_version), idempotent: true }, 200, context.requestId);
      }
      const nextVersion = Number(current.waiting_version) + 1;
      const correlationId = crypto.randomUUID();
      const cleared = await d1.batch([
        d1.prepare(`UPDATE waiting_room_sessions
          SET state = ?, visitor_presence = 'absent', visitor_presence_at = ?, version = ?, last_checked_at = ?, updated_at = ?
          WHERE appointment_id = ? AND facility_id = ? AND version = ? AND visitor_presence = 'present'`)
          .bind(nextState, now, nextVersion, now, now, appointmentId, current.facility_id, Number(current.waiting_version)),
        d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
          SELECT ?, ?, 'VISITOR', ?, 'VISITOR_PRESENCE_CLEARED', 'appointment', ?, 'Visitor presence was cleared when the browser left the waiting room or live visit.', ?, ?, ?, ?, ?
          WHERE changes() > 0`)
          .bind(crypto.randomUUID(), visitor.userId, current.facility_id, appointmentId, JSON.stringify({ state: currentState, visitorPresence: "present", version: Number(current.waiting_version) }), JSON.stringify({ state: nextState, visitorPresence: "absent", version: nextVersion }), correlationId, context.requestId, now),
      ]);
      if (!cleared[0]?.meta.changes) throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
      if (!cleared[1]?.meta.changes) {
        const restored = await d1.prepare(`UPDATE waiting_room_sessions
          SET state = ?, visitor_presence = ?, visitor_presence_at = ?, version = ?, last_checked_at = ?, updated_at = ?
          WHERE appointment_id = ? AND facility_id = ? AND version = ?`)
          .bind(current.state || "NOT_ARRIVED", current.visitor_presence || null, current.visitor_presence_at || null, Number(current.waiting_version), current.last_checked_at || null, now, appointmentId, current.facility_id, nextVersion).run();
        if (!restored.meta.changes) {
          await recordWaitingRoomReconciliationRequired(d1, { facilityId: String(current.facility_id), appointmentId, operation: "VISITOR_PRESENCE_CLEAR", requestId: context.requestId, correlationId, expectedVersion: nextVersion });
          throw new SecurityError("WAITING_ROOM_RECONCILIATION_REQUIRED", 503);
        }
        throw new SecurityError("VISITOR_PRESENCE_AUDIT_INCOMPLETE", 503);
      }
      return securityResponse({ presence: "absent", state: nextState, visitorPresenceAt: now, prisonerPresence: prisonerPresent ? "present" : current.prisoner_presence || "waiting", version: nextVersion, correlationId }, 200, context.requestId);
    }

    const nextState = prisonerPresent ? "BOTH_PRESENT" : "VISITOR_WAITING";
    const persistedState = ["NOT_ARRIVED", "VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"].includes(String(current.state || "NOT_ARRIVED"))
      ? nextState
      : String(current.state || "NOT_ARRIVED");
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
    if (!result[0]?.meta.changes || !result[1]?.meta.changes) {
      // D1 batches are atomic for SQL errors, but a statement that matches zero
      // rows is not an SQL error. If the appointment loses its version race
      // after the waiting-room row changed, compensate while the new version
      // is still exclusively ours so the two records cannot drift apart.
      if (result[0]?.meta.changes) {
        const restored = await d1.prepare(`UPDATE waiting_room_sessions
          SET state = ?, visitor_presence = ?, visitor_presence_at = ?, version = ?, last_checked_at = ?, updated_at = ?
          WHERE appointment_id = ? AND facility_id = ? AND version = ?`)
          .bind(
            current.state || "NOT_ARRIVED",
            current.visitor_presence || null,
            current.visitor_presence_at || null,
            Number(current.waiting_version),
            current.last_checked_at || null,
            now,
            appointmentId,
            current.facility_id,
            nextVersion,
          ).run();
        if (!restored.meta.changes) {
          await recordWaitingRoomReconciliationRequired(d1, { facilityId: String(current.facility_id), appointmentId, operation: "VISITOR_PRESENCE", requestId: context.requestId, expectedVersion: nextVersion });
          throw new SecurityError("WAITING_ROOM_RECONCILIATION_REQUIRED", 503);
        }
      }
      throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
    }
    return securityResponse({ presence: "present", state: persistedState, visitorPresenceAt: now, prisonerPresence: prisonerPresent ? "present" : "waiting", prisonerPresenceAt: prisonerPresent ? current.prisoner_presence_at || null : null, version: nextVersion }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
