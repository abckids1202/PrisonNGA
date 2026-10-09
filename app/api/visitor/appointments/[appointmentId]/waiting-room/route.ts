import { getD1 } from "../../../../../../db/runtime";
import { enforceRateLimit } from "../../../../../../lib/server/rate-limit";
import { getRequestContext, requireVisitorIdentity, securityErrorResponse, securityResponse, SecurityError } from "../../../../../../lib/server/security";
import { isRecentDeviceCheck, isRecentPresence } from "../../../../../../lib/server/waiting-room-readiness";
import { isWaitingRoomOpen } from "../../../../../../lib/server/waiting-room-window";
import { recordWaitingRoomReconciliationRequired } from "../../../../../../lib/server/reconciliation";

export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const context = await getRequestContext();
  try {
    const visitor = await requireVisitorIdentity();
    const { appointmentId } = await params;
    if (!appointmentId || appointmentId.length > 128) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);

    const d1 = await getD1();
    const now = new Date().toISOString();
    const current = await d1.prepare(`SELECT a.id, a.facility_id, a.status AS appointment_status, a.version AS appointment_version,
        a.requested_start, a.requested_end, a.updated_at AS appointment_updated_at,
        f.current_state AS facility_state, p.status AS prisoner_status, p.visitation_status,
        wr.version AS waiting_version, wr.state, wr.visitor_presence, wr.visitor_presence_at, wr.prisoner_presence, wr.prisoner_presence_at,
        wr.identity_state, wr.camera_state, wr.microphone_state, wr.network_state, wr.room_state, wr.kiosk_state, wr.restriction_state, wr.last_checked_at,
        dc.id AS device_check_id, dc.camera_result, dc.microphone_result, dc.network_result, dc.created_at AS device_checked_at
      FROM appointments a
      INNER JOIN facilities f ON f.id = a.facility_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
      LEFT JOIN waiting_room_sessions wr ON wr.appointment_id = a.id AND wr.facility_id = a.facility_id
      LEFT JOIN visitor_device_check_attempts dc ON dc.id = (
        SELECT latest.id FROM visitor_device_check_attempts latest
        WHERE latest.appointment_id = a.id AND latest.facility_id = a.facility_id AND latest.visitor_user_id = a.visitor_user_id
        ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
      )
      WHERE a.id = ? AND a.visitor_user_id = ?`).bind(appointmentId, visitor.userId).first<Record<string, string | number | null>>();
    if (!current) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);

    // Bind the idempotency record to the authorized facility after the
    // appointment ownership check. This prevents an unscoped replay lookup
    // from becoming a cross-facility workflow primitive.
    const existingKey = `${visitor.userId}:${current.facility_id}:${appointmentId}:${idempotencyKey}`;
    const existing = await d1.prepare(`SELECT id, appointment_id, facility_id, version, state
      FROM visitor_waiting_room_checkins WHERE idempotency_key = ? AND facility_id = ?`).bind(existingKey, current.facility_id).first<Record<string, string | number | null>>();
    if (existing) return securityResponse({ checkIn: existing, idempotent: true }, 200, context.requestId);

    await enforceRateLimit(d1, { key: `visitor-waiting-room:${visitor.userId}:${current.facility_id}:${appointmentId}`, limit: 12, windowSeconds: 60 * 60 });
    if (!["APPROVED", "WAITING"].includes(String(current.appointment_status))) throw new SecurityError("VISIT_NOT_READY_FOR_WAITING_ROOM", 409);
    if (current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    if (current.prisoner_status !== "ACTIVE" || current.visitation_status !== "APPROVED") throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
    if (!current.device_check_id || !isRecentDeviceCheck(String(current.device_checked_at || ""))) throw new SecurityError("RECENT_DEVICE_CHECK_REQUIRED", 409);
    if ([current.camera_result, current.microphone_result].some((result) => result === "failed") || current.network_result === "poor") throw new SecurityError("DEVICE_CHECK_NOT_READY", 409);
    const facilityAlreadyOpenedRoom = current.waiting_version !== null;
    if (!facilityAlreadyOpenedRoom && !isWaitingRoomOpen(String(current.requested_start), String(current.requested_end), Date.parse(now))) {
      throw new SecurityError("WAITING_ROOM_NOT_OPEN", 409);
    }
    const visitorPresent = current.visitor_presence === "present" && isRecentPresence(current.visitor_presence_at === null ? null : String(current.visitor_presence_at));
    if (visitorPresent && current.state !== "NOT_ARRIVED") {
      return securityResponse({ checkIn: { appointmentId, version: Number(current.waiting_version || 1), state: current.state, visitorPresence: "present", prisonerPresence: current.prisoner_presence || "waiting" }, idempotent: true }, 200, context.requestId);
    }

    const waitingVersion = Number(current.waiting_version || 0);
    const nextVersion = waitingVersion + 1;
    const prisonerPresent = current.prisoner_presence === "present" && isRecentPresence(current.prisoner_presence_at === null ? null : String(current.prisoner_presence_at));
    const nextState = prisonerPresent ? "BOTH_PRESENT" : "VISITOR_WAITING";
    const nextPrisonerPresence = prisonerPresent ? "present" : "waiting";
    const correlationId = crypto.randomUUID();
    const checkInId = crypto.randomUUID();
    const result = await d1.batch([
      d1.prepare(`UPDATE appointments SET status = 'WAITING', version = version + 1, updated_at = ?
        WHERE id = ? AND visitor_user_id = ? AND version = ? AND status IN ('APPROVED', 'WAITING')`)
        .bind(now, appointmentId, visitor.userId, Number(current.appointment_version || 1)),
      d1.prepare(`INSERT INTO waiting_room_sessions (appointment_id, facility_id, state, visitor_presence, visitor_presence_at, prisoner_presence, prisoner_presence_at, identity_state, camera_state, microphone_state, network_state, room_state, kiosk_state, restriction_state, assigned_room_id, assigned_kiosk_id, staff_notes, version, last_checked_at, created_at, updated_at)
        SELECT ?, ?, ?, 'present', ?, ?, ?, 'pass', ?, ?, ?, 'pass', 'pending', 'pass', NULL, NULL, NULL, ?, ?, ?, ?
        WHERE changes() > 0
        ON CONFLICT(appointment_id) DO UPDATE SET state = excluded.state, visitor_presence = 'present', visitor_presence_at = excluded.visitor_presence_at, prisoner_presence = excluded.prisoner_presence, prisoner_presence_at = excluded.prisoner_presence_at, identity_state = excluded.identity_state, camera_state = excluded.camera_state, microphone_state = excluded.microphone_state, network_state = excluded.network_state, last_checked_at = excluded.last_checked_at, version = excluded.version, updated_at = excluded.updated_at
        WHERE waiting_room_sessions.version = ?`)
        .bind(appointmentId, current.facility_id, nextState, now, nextPrisonerPresence, prisonerPresent ? (current.prisoner_presence_at || now) : null, String(current.camera_result) === "ready" ? "pass" : "warning", String(current.microphone_result) === "ready" ? "pass" : "warning", String(current.network_result) === "stable" || String(current.network_result) === "fair" ? "pass" : "warning", nextVersion, now, now, now, waitingVersion),
      d1.prepare(`INSERT INTO visitor_waiting_room_checkins (id, appointment_id, facility_id, visitor_user_id, idempotency_key, state, version, correlation_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(checkInId, appointmentId, current.facility_id, visitor.userId, existingKey, nextState, nextVersion, correlationId, now),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        SELECT ?, ?, 'VISITOR', ?, 'VISITOR_WAITING_ROOM_CHECK_IN', 'appointment', ?, 'Visitor entered the waiting room.', ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), visitor.userId, current.facility_id, appointmentId, JSON.stringify({ appointmentStatus: current.appointment_status, state: current.state || "NOT_ARRIVED", version: current.waiting_version || 0 }), JSON.stringify({ appointmentStatus: "WAITING", state: nextState, visitorPresence: "present", version: nextVersion }), correlationId, context.requestId, now),
      d1.prepare(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        SELECT ?, 'VISITOR_WAITING_ROOM_CHECKED_IN', 'appointment', ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), appointmentId, current.facility_id, JSON.stringify({ appointmentId, state: nextState }), correlationId, now),
    ]);
    if (!result.every((entry) => entry?.meta.changes === 1)) {
      // D1 reports a zero-row optimistic-concurrency match as a successful
      // statement. Restore every earlier write while its incremented version
      // is still owned by this request, including deleting a newly created
      // Waiting Room row when no row existed before check-in.
      let restored = true;
      if (result[1]?.meta.changes) {
        const waitingRestore = current.waiting_version === null
          ? await d1.prepare(`DELETE FROM waiting_room_sessions WHERE appointment_id = ? AND facility_id = ? AND version = ?`).bind(appointmentId, current.facility_id, nextVersion).run()
          : await d1.prepare(`UPDATE waiting_room_sessions SET state = ?, visitor_presence = ?, visitor_presence_at = ?, prisoner_presence = ?, prisoner_presence_at = ?, identity_state = ?, camera_state = ?, microphone_state = ?, network_state = ?, room_state = ?, kiosk_state = ?, restriction_state = ?, version = ?, last_checked_at = ?, updated_at = ? WHERE appointment_id = ? AND facility_id = ? AND version = ?`)
            .bind(current.state || "NOT_ARRIVED", current.visitor_presence || null, current.visitor_presence_at || null, current.prisoner_presence || null, current.prisoner_presence_at || null, current.identity_state || null, current.camera_state || null, current.microphone_state || null, current.network_state || null, current.room_state || null, current.kiosk_state || null, current.restriction_state || null, Number(current.waiting_version), current.last_checked_at || null, now, appointmentId, current.facility_id, nextVersion).run();
        restored = restored && Boolean(waitingRestore.meta.changes);
      }
      if (result[0]?.meta.changes) {
        const appointmentRestore = await d1.prepare(`UPDATE appointments SET status = ?, version = ?, updated_at = ? WHERE id = ? AND facility_id = ? AND visitor_user_id = ? AND version = ?`).bind(current.appointment_status, Number(current.appointment_version), current.appointment_updated_at || now, appointmentId, current.facility_id, visitor.userId, Number(current.appointment_version || 1) + 1).run();
        restored = restored && Boolean(appointmentRestore.meta.changes);
      }
      if (!restored) {
        await recordWaitingRoomReconciliationRequired(d1, { facilityId: String(current.facility_id), appointmentId, operation: "VISITOR_WAITING_ROOM_CHECK_IN", requestId: context.requestId, correlationId, expectedVersion: nextVersion });
        throw new SecurityError("WAITING_ROOM_RECONCILIATION_REQUIRED", 503);
      }
      throw new SecurityError("WAITING_ROOM_CHECK_IN_INCOMPLETE", 503);
    }
    return securityResponse({ checkIn: { id: checkInId, appointmentId, state: nextState, visitorPresence: "present", prisonerPresence: nextPrisonerPresence, version: nextVersion, correlationId }, idempotent: false }, 201, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
