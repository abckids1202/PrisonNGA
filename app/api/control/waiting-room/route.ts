import { getD1 } from "../../../../db/runtime";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { createLiveKitProvider, createProviderRoomName } from "../../../../lib/server/video/provider";

const eligibleStatuses = ["APPROVED", "WAITING", "IN_PROGRESS"] as const;
const commands = ["admit_visitor", "run_preflight", "retry_device", "contact_visitor", "mark_late", "reassign_kiosk", "cancel_visit", "start_visit"] as const;
type WaitingCommand = typeof commands[number];

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const placeholders = eligibleStatuses.map(() => "?").join(", ");
    const result = await d1.prepare(`SELECT
        a.id, a.status AS appointment_status, a.prisoner_id, a.requested_start, a.requested_end, a.timezone, a.appointment_type, a.version AS appointment_version,
        u.display_name AS visitor_name,
        w.state, w.visitor_presence, w.prisoner_presence, w.identity_state, w.camera_state, w.microphone_state, w.network_state, w.room_state, w.kiosk_state, w.restriction_state, w.staff_notes, w.version, w.last_checked_at
      FROM appointments a
      INNER JOIN users u ON u.id = a.visitor_user_id
      LEFT JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
      WHERE a.facility_id = ? AND a.status IN (${placeholders})
      ORDER BY a.requested_start ASC`).bind(authorization.facilityId, ...eligibleStatuses).all();
    const facility = await d1.prepare("SELECT id, name, current_state, version FROM facilities WHERE id = ?").bind(authorization.facilityId).first();
    return securityResponse({ facility, visits: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("appointment.review");
    const body = await request.json() as { appointmentId?: string; command?: string; expectedVersion?: number; reason?: string; staffNotes?: string; kioskId?: string };
    if (!body.appointmentId || !commands.includes(body.command as WaitingCommand)) throw new SecurityError("INVALID_WAITING_ROOM_COMMAND", 400);
    const command = body.command as WaitingCommand;
    const reason = assertReason(body.reason);
    const d1 = await getD1();
    const current = await d1.prepare(`SELECT a.id, a.status AS appointment_status, a.version AS appointment_version, a.requested_start, a.requested_end, f.current_state,
        vs.id AS session_id, vs.status AS session_status, vs.provider_room_name,
        w.state, w.visitor_presence, w.prisoner_presence, w.identity_state, w.camera_state, w.microphone_state, w.network_state, w.room_state, w.kiosk_state, w.restriction_state, w.version
      FROM appointments a INNER JOIN facilities f ON f.id = a.facility_id
      LEFT JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
      LEFT JOIN visit_sessions vs ON vs.appointment_id = a.id AND vs.facility_id = a.facility_id
      WHERE a.id = ? AND a.facility_id = ?`).bind(body.appointmentId, authorization.facilityId).first<Record<string, string | number | null>>();
    if (!current) throw new SecurityError("WAITING_APPOINTMENT_NOT_FOUND", 404);
    const currentVersion = Number(current.version || 1);
    if (body.expectedVersion !== undefined && body.expectedVersion !== currentVersion) throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
    if (!eligibleStatuses.includes(current.appointment_status as typeof eligibleStatuses[number])) throw new SecurityError("APPOINTMENT_NOT_ELIGIBLE", 409);
    if (command === "start_visit" && (current.current_state !== "NORMAL_OPERATIONS" || current.identity_state !== "pass" || current.camera_state !== "pass" || current.microphone_state !== "pass" || current.network_state !== "pass" || current.room_state !== "pass" || current.kiosk_state !== "pass" || current.restriction_state !== "pass")) throw new SecurityError("PRECALL_CHECKS_INCOMPLETE", 409);
    if (command === "start_visit" && current.session_id && ["CONNECTING", "ACTIVE", "RECONNECTING"].includes(String(current.session_status))) return securityResponse({ appointmentId: body.appointmentId, sessionId: String(current.session_id), state: "LIVE", version: currentVersion, idempotent: true }, 200, context.requestId);

    const now = new Date().toISOString();
    const nextVersion = currentVersion + 1;
    const nextState = command === "admit_visitor" ? "VISITOR_WAITING" : command === "mark_late" ? "LATE" : command === "start_visit" ? "LIVE" : command === "contact_visitor" ? String(current.state || "NOT_ARRIVED") : command === "cancel_visit" ? "CANCELLED" : "READY_TO_START";
    const visitorPresence = command === "admit_visitor" || command === "run_preflight" || command === "retry_device" || command === "reassign_kiosk" || command === "start_visit" ? "present" : String(current.visitor_presence || "absent");
    const prisonerPresence = command === "run_preflight" || command === "retry_device" || command === "start_visit" ? "present" : String(current.prisoner_presence || "waiting");
    const checkState = command === "run_preflight" || command === "retry_device" || command === "reassign_kiosk" || command === "start_visit" ? "pass" : String(current.identity_state || "pending");
    const nextAppointmentStatus = command === "start_visit" ? "IN_PROGRESS" : command === "cancel_visit" ? "CANCELLED_BY_FACILITY" : command === "admit_visitor" ? "WAITING" : String(current.appointment_status);
    const correlationId = crypto.randomUUID();
    let newSession: { id: string; roomName: string; roomSid: string | null } | null = null;
    if (command === "start_visit" && !current.session_id) {
      try {
        const provider = await createLiveKitProvider();
        newSession = { id: crypto.randomUUID(), ...(await provider.createSession(createProviderRoomName())) };
      } catch (error) {
        if (error instanceof Error && error.message === "VIDEO_PROVIDER_NOT_CONFIGURED") throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
        throw new SecurityError("VIDEO_PROVIDER_START_FAILED", 502);
      }
    }
    const statements = [
      d1.prepare(`INSERT INTO waiting_room_sessions (appointment_id, facility_id, state, visitor_presence, prisoner_presence, identity_state, camera_state, microphone_state, network_state, room_state, kiosk_state, restriction_state, staff_notes, version, last_checked_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(appointment_id) DO UPDATE SET state = excluded.state, visitor_presence = excluded.visitor_presence, prisoner_presence = excluded.prisoner_presence, identity_state = excluded.identity_state, camera_state = excluded.camera_state, microphone_state = excluded.microphone_state, network_state = excluded.network_state, room_state = excluded.room_state, kiosk_state = excluded.kiosk_state, restriction_state = excluded.restriction_state, staff_notes = COALESCE(excluded.staff_notes, waiting_room_sessions.staff_notes), version = excluded.version, last_checked_at = excluded.last_checked_at, updated_at = excluded.updated_at`)
        .bind(body.appointmentId, authorization.facilityId, nextState, visitorPresence, prisonerPresence, checkState, checkState, checkState, checkState, "pass", checkState, current.current_state === "NORMAL_OPERATIONS" ? "pass" : "failed", body.staffNotes?.trim().slice(0, 500) || null, nextVersion, now, now, now),
      d1.prepare("UPDATE appointments SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?").bind(nextAppointmentStatus, now, body.appointmentId, authorization.facilityId, Number(current.appointment_version || 1)),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), authorization.userId, authorization.roles[0] || null, authorization.facilityId, `WAITING_ROOM_${command.toUpperCase()}`, "waiting_room", body.appointmentId, reason, JSON.stringify({ state: current.state || "NOT_ARRIVED", version: currentVersion }), JSON.stringify({ state: nextState, version: nextVersion }), correlationId, context.requestId, now),
      d1.prepare(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), `WAITING_ROOM_${command.toUpperCase()}`, "appointment", body.appointmentId, authorization.facilityId, JSON.stringify({ appointmentId: body.appointmentId, command, state: nextState, sessionId: newSession?.id || current.session_id || null, kioskId: body.kioskId || null }), correlationId, now),
    ];
    if (newSession) {
      statements.push(d1.prepare(`INSERT INTO visit_sessions (id, appointment_id, facility_id, provider, provider_room_name, provider_room_sid, status, authorized_start_at, authorized_end_at, actual_started_at, created_by, recording_policy, recording_status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(newSession.id, body.appointmentId, authorization.facilityId, "livekit", newSession.roomName, newSession.roomSid, "CONNECTING", String(current.requested_start || now), String(current.requested_end || new Date(Date.now() + 20 * 60_000).toISOString()), now, authorization.userId, "OFF", "NOT_RECORDED", 1, now, now));
      statements.push(d1.prepare(`INSERT INTO visit_session_events (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), newSession.id, "SESSION_CREATED", "SECUREVISIT", "FACILITY", JSON.stringify({ appointmentId: body.appointmentId }), correlationId, now));
    }
    const results = await d1.batch(statements);
    if (!results[1]?.meta.changes) throw new SecurityError("STALE_APPOINTMENT_STATE", 409);
    return securityResponse({ appointmentId: body.appointmentId, sessionId: newSession?.id || current.session_id || null, state: nextState, version: nextVersion, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
