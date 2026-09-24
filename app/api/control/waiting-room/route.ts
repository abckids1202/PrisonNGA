import { getD1 } from "../../../../db/runtime";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { createLiveKitProvider, createProviderRoomName } from "../../../../lib/server/video/provider";
import { operationalLog } from "../../../../lib/server/observability";
import { canTransitionWaitingRoom } from "../../../../lib/server/workflow";
import { evaluateWaitingRoomReadiness } from "../../../../lib/server/waiting-room-readiness";
import { claimIdempotency, completeIdempotencyStatement, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";

const eligibleStatuses = ["APPROVED", "WAITING", "IN_PROGRESS"] as const;
const commands = ["admit_visitor", "confirm_prisoner_presence", "run_preflight", "retry_device", "contact_visitor", "mark_late", "cancel_visit", "start_visit"] as const;
type WaitingCommand = typeof commands[number];

export async function GET() {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("facility.read");
    const d1 = await getD1();
    const placeholders = eligibleStatuses.map(() => "?").join(", ");
    const result = await d1.prepare(`SELECT
        a.id, a.status AS appointment_status, a.prisoner_id, a.requested_start, a.requested_end, a.timezone, a.appointment_type, a.version AS appointment_version,
        u.display_name AS visitor_name, p.display_name AS prisoner_name, p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state,
        (SELECT vr.status FROM visitor_relationships vr WHERE vr.visitor_user_id = a.visitor_user_id AND vr.prisoner_id = a.prisoner_id AND vr.facility_id = a.facility_id LIMIT 1) AS relationship_status,
        w.state, w.visitor_presence, w.prisoner_presence, w.identity_state, w.camera_state, w.microphone_state, w.network_state, w.room_state, w.kiosk_state, w.kiosk_camera_state, w.kiosk_microphone_state, w.kiosk_network_state, w.kiosk_device_checked_at, w.restriction_state,
        COALESCE(w.assigned_room_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AS assigned_room_id,
        COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AS assigned_kiosk_id,
        w.staff_notes, w.version, w.last_checked_at,
        (SELECT r.display_name FROM resources r WHERE r.id = COALESCE(w.assigned_room_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS assigned_room_name,
        (SELECT r.display_name FROM resources r WHERE r.id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS assigned_kiosk_name,
        (SELECT r.status FROM resources r WHERE r.id = COALESCE(w.assigned_room_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS room_resource_status,
        (SELECT r.health_state FROM resources r WHERE r.id = COALESCE(w.assigned_room_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS room_health_state,
        (SELECT r.status FROM resources r WHERE r.id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS kiosk_resource_status,
        (SELECT r.health_state FROM resources r WHERE r.id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS kiosk_health_state,
        (SELECT r.last_heartbeat_at FROM resources r WHERE r.id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS kiosk_heartbeat_at,
        EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')) AS room_reserved,
        EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')) AS kiosk_reserved,
        EXISTS (SELECT 1 FROM kiosk_credentials kc WHERE kc.resource_id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND kc.facility_id = a.facility_id AND kc.status = 'ACTIVE') AS kiosk_credential_active,
        (SELECT dc.camera_result FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_camera_result,
        (SELECT dc.microphone_result FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_microphone_result,
        (SELECT dc.network_result FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_network_result,
        (SELECT dc.latency_ms FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_latency_ms,
        (SELECT dc.created_at FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_device_checked_at
      FROM appointments a
      INNER JOIN users u ON u.id = a.visitor_user_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id
      INNER JOIN facilities f ON f.id = a.facility_id
      LEFT JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
      WHERE a.facility_id = ? AND a.status IN (${placeholders})
      ORDER BY a.requested_start ASC`).bind(authorization.facilityId, ...eligibleStatuses).all();
    const facility = await d1.prepare("SELECT id, name, current_state, version FROM facilities WHERE id = ?").bind(authorization.facilityId).first();
    const visits = result.results.map((raw) => {
      const row = raw as Record<string, string | number | null>;
      const readiness = evaluateWaitingRoomReadiness({
        visitorPresence: row.visitor_presence === null ? null : String(row.visitor_presence),
        prisonerPresence: row.prisoner_presence === null ? null : String(row.prisoner_presence),
        relationshipStatus: row.relationship_status === null ? null : String(row.relationship_status),
        prisonerStatus: row.prisoner_status === null ? null : String(row.prisoner_status),
        visitationStatus: row.visitation_status === null ? null : String(row.visitation_status),
        facilityState: row.facility_state === null ? null : String(row.facility_state),
        visitorCameraResult: row.visitor_camera_result === null ? null : String(row.visitor_camera_result),
        visitorMicrophoneResult: row.visitor_microphone_result === null ? null : String(row.visitor_microphone_result),
        visitorNetworkResult: row.visitor_network_result === null ? null : String(row.visitor_network_result),
        visitorLatencyMs: row.visitor_latency_ms === null ? null : Number(row.visitor_latency_ms),
        visitorDeviceCheckedAt: row.visitor_device_checked_at === null ? null : String(row.visitor_device_checked_at),
        roomReserved: Number(row.room_reserved) === 1,
        roomStatus: row.room_resource_status === null ? null : String(row.room_resource_status),
        roomHealth: row.room_health_state === null ? null : String(row.room_health_state),
        kioskReserved: Number(row.kiosk_reserved) === 1,
        kioskStatus: row.kiosk_resource_status === null ? null : String(row.kiosk_resource_status),
        kioskHealth: row.kiosk_health_state === null ? null : String(row.kiosk_health_state),
        kioskHeartbeatAt: row.kiosk_heartbeat_at === null ? null : String(row.kiosk_heartbeat_at),
        kioskCredentialActive: Number(row.kiosk_credential_active) === 1,
        kioskCameraResult: row.kiosk_camera_state === null ? null : String(row.kiosk_camera_state),
        kioskMicrophoneResult: row.kiosk_microphone_state === null ? null : String(row.kiosk_microphone_state),
        kioskNetworkResult: row.kiosk_network_state === null ? null : String(row.kiosk_network_state),
        kioskDeviceCheckedAt: row.kiosk_device_checked_at === null ? null : String(row.kiosk_device_checked_at),
      });
      const savedState = String(row.state || "NOT_ARRIVED");
      return {
        ...row,
        state: ["LIVE", "CANCELLED", "LATE"].includes(savedState) ? savedState : readiness.state,
        identity_state: readiness.checks.identity,
        camera_state: readiness.checks.camera,
        microphone_state: readiness.checks.microphone,
        network_state: readiness.checks.network,
        room_state: readiness.checks.room,
        kiosk_state: readiness.checks.kiosk,
        restriction_state: readiness.checks.restriction,
        readiness,
      };
    });
    return securityResponse({ facility, visits, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let roomCleanup: { provider: Awaited<ReturnType<typeof createLiveKitProvider>>; name: string } | null = null;
  let databaseRef: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const authorization = await requirePermission("appointment.review");
    const body = await request.json() as { appointmentId?: string; command?: string; expectedVersion?: number; reason?: string; staffNotes?: string };
    if (!body.appointmentId || !commands.includes(body.command as WaitingCommand)) throw new SecurityError("INVALID_WAITING_ROOM_COMMAND", 400);
    const command = body.command as WaitingCommand;
    const reason = assertReason(body.reason);
    const database = await getD1();
    databaseRef = database;
    const d1 = database;
    const current = await d1.prepare(`SELECT a.id, a.status AS appointment_status, a.version AS appointment_version, a.requested_start, a.requested_end, a.visitor_user_id, f.current_state,
        p.status AS prisoner_status, p.visitation_status,
        (SELECT vr.status FROM visitor_relationships vr WHERE vr.visitor_user_id = a.visitor_user_id AND vr.prisoner_id = a.prisoner_id AND vr.facility_id = a.facility_id LIMIT 1) AS relationship_status,
        vs.id AS session_id, vs.status AS session_status, vs.provider_room_name,
        w.state, w.visitor_presence, w.prisoner_presence, w.identity_state, w.camera_state, w.microphone_state, w.network_state, w.room_state, w.kiosk_state, w.kiosk_camera_state, w.kiosk_microphone_state, w.kiosk_network_state, w.kiosk_device_checked_at, w.restriction_state,
        COALESCE(w.assigned_room_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AS assigned_room_id,
        COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AS assigned_kiosk_id,
        (SELECT r.status FROM resources r WHERE r.id = COALESCE(w.assigned_room_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS room_resource_status,
        (SELECT r.health_state FROM resources r WHERE r.id = COALESCE(w.assigned_room_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS room_health_state,
        (SELECT r.status FROM resources r WHERE r.id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS kiosk_resource_status,
        (SELECT r.health_state FROM resources r WHERE r.id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS kiosk_health_state,
        (SELECT r.last_heartbeat_at FROM resources r WHERE r.id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND r.facility_id = a.facility_id) AS kiosk_heartbeat_at,
        EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'ROOM' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')) AS room_reserved,
        EXISTS (SELECT 1 FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')) AS kiosk_reserved,
        EXISTS (SELECT 1 FROM kiosk_credentials kc WHERE kc.resource_id = COALESCE(w.assigned_kiosk_id, (SELECT rr.resource_id FROM resource_reservations rr WHERE rr.appointment_id = a.id AND rr.facility_id = a.facility_id AND rr.resource_type = 'DEVICE' AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE') ORDER BY rr.created_at DESC LIMIT 1)) AND kc.facility_id = a.facility_id AND kc.status = 'ACTIVE') AS kiosk_credential_active,
        (SELECT dc.camera_result FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_camera_result,
        (SELECT dc.microphone_result FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_microphone_result,
        (SELECT dc.network_result FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_network_result,
        (SELECT dc.latency_ms FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_latency_ms,
        (SELECT dc.created_at FROM visitor_device_check_attempts dc WHERE dc.appointment_id = a.id AND dc.visitor_user_id = a.visitor_user_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 1) AS visitor_device_checked_at,
        w.version
      FROM appointments a INNER JOIN facilities f ON f.id = a.facility_id
      INNER JOIN prisoners p ON p.id = a.prisoner_id AND p.facility_id = a.facility_id
      LEFT JOIN waiting_room_sessions w ON w.appointment_id = a.id AND w.facility_id = a.facility_id
      LEFT JOIN visit_sessions vs ON vs.appointment_id = a.id AND vs.facility_id = a.facility_id
      WHERE a.id = ? AND a.facility_id = ?`).bind(body.appointmentId, authorization.facilityId).first<Record<string, string | number | null>>();
    if (!current) throw new SecurityError("WAITING_APPOINTMENT_NOT_FOUND", 404);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const scope = `waiting-room:${authorization.facilityId}:${body.appointmentId}`;
    const requestHash = await hashIdempotencyPayload({ appointmentId: body.appointmentId, command, expectedVersion: body.expectedVersion ?? null, reason, staffNotes: body.staffNotes ?? null });
    const claimed: IdempotencyClaim = await claimIdempotency(database, { scope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope, key: idempotencyKey };
    const finish = async (responseBody: unknown, status = 200) => {
      const completed = await database.batch([completeIdempotencyStatement(database, { ...idempotency!, status, body: responseBody })]);
      if (!completed[0]?.meta.changes) throw new SecurityError("WAITING_ROOM_IDEMPOTENCY_CONFLICT", 409);
      idempotency = null;
      return securityResponse(responseBody, status, context.requestId);
    };
    const currentVersion = Number(current.version || 1);
    if (body.expectedVersion !== undefined && body.expectedVersion !== currentVersion) throw new SecurityError("STALE_WAITING_ROOM_STATE", 409);
    if (!eligibleStatuses.includes(current.appointment_status as typeof eligibleStatuses[number])) throw new SecurityError("APPOINTMENT_NOT_ELIGIBLE", 409);
    const currentState = String(current.state || "NOT_ARRIVED") as string;
    const prisonerEligible = current.prisoner_status === "ACTIVE" && current.visitation_status === "APPROVED";
    const facilityEligible = current.current_state === "NORMAL_OPERATIONS";
    if (command === "cancel_visit" && (currentState === "LIVE" || current.appointment_status === "IN_PROGRESS")) throw new SecurityError("LIVE_VISIT_MUST_BE_TERMINATED", 409);
    if (command === "start_visit" && !facilityEligible) throw new SecurityError("FACILITY_NOT_ACCEPTING_REQUESTS", 409);
    if (command === "start_visit" && !prisonerEligible) throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
    if (command === "run_preflight" || command === "retry_device") {
      if (current.visitor_presence !== "present" || current.prisoner_presence !== "present") throw new SecurityError("BOTH_PARTICIPANTS_NOT_PRESENT", 409);
    }
    if (command === "confirm_prisoner_presence" && !["NOT_ARRIVED", "VISITOR_WAITING", "PRISONER_WAITING", "BOTH_PRESENT"].includes(currentState)) throw new SecurityError("PRISONER_PRESENCE_CANNOT_BE_CONFIRMED", 409);
    if (command === "start_visit" && current.session_id && ["CONNECTING", "ACTIVE", "RECONNECTING"].includes(String(current.session_status))) return finish({ appointmentId: body.appointmentId, sessionId: String(current.session_id), state: "LIVE", version: currentVersion, idempotent: true });
    if (command === "start_visit" && currentState !== "READY_TO_START") throw new SecurityError("WAITING_ROOM_NOT_READY", 409);

    const now = new Date().toISOString();
    const nextVersion = currentVersion + 1;
    const nextVisitorPresence = command === "admit_visitor" ? "present" : String(current.visitor_presence || "absent");
    const nextPrisonerPresence = command === "confirm_prisoner_presence" ? "present" : String(current.prisoner_presence || "waiting");
    const readiness = command === "run_preflight" || command === "retry_device" || command === "start_visit"
      ? evaluateWaitingRoomReadiness({
          visitorPresence: nextVisitorPresence,
          prisonerPresence: nextPrisonerPresence,
          relationshipStatus: current.relationship_status === null ? null : String(current.relationship_status),
          prisonerStatus: String(current.prisoner_status || ""),
          visitationStatus: String(current.visitation_status || ""),
          facilityState: String(current.current_state || ""),
          visitorCameraResult: current.visitor_camera_result === null ? null : String(current.visitor_camera_result),
          visitorMicrophoneResult: current.visitor_microphone_result === null ? null : String(current.visitor_microphone_result),
          visitorNetworkResult: current.visitor_network_result === null ? null : String(current.visitor_network_result),
          visitorLatencyMs: current.visitor_latency_ms === null ? null : Number(current.visitor_latency_ms),
          visitorDeviceCheckedAt: current.visitor_device_checked_at === null ? null : String(current.visitor_device_checked_at),
          roomReserved: Number(current.room_reserved) === 1,
          roomStatus: current.room_resource_status === null ? null : String(current.room_resource_status),
          roomHealth: current.room_health_state === null ? null : String(current.room_health_state),
          kioskReserved: Number(current.kiosk_reserved) === 1,
          kioskStatus: current.kiosk_resource_status === null ? null : String(current.kiosk_resource_status),
          kioskHealth: current.kiosk_health_state === null ? null : String(current.kiosk_health_state),
          kioskHeartbeatAt: current.kiosk_heartbeat_at === null ? null : String(current.kiosk_heartbeat_at),
          kioskCredentialActive: Number(current.kiosk_credential_active) === 1,
          kioskCameraResult: current.kiosk_camera_state === null ? null : String(current.kiosk_camera_state),
          kioskMicrophoneResult: current.kiosk_microphone_state === null ? null : String(current.kiosk_microphone_state),
          kioskNetworkResult: current.kiosk_network_state === null ? null : String(current.kiosk_network_state),
          kioskDeviceCheckedAt: current.kiosk_device_checked_at === null ? null : String(current.kiosk_device_checked_at),
        })
      : null;
    if (command === "start_visit" && !readiness?.readyToStart) throw new SecurityError("PRECALL_CHECKS_INCOMPLETE", 409);
    const nextState = command === "admit_visitor" ? (nextPrisonerPresence === "present" ? "BOTH_PRESENT" : "VISITOR_WAITING")
      : command === "confirm_prisoner_presence" ? (nextVisitorPresence === "present" ? "BOTH_PRESENT" : "PRISONER_WAITING")
        : command === "mark_late" ? "LATE"
          : command === "start_visit" ? "LIVE"
            : command === "contact_visitor" || command === "cancel_visit" ? (command === "cancel_visit" ? "CANCELLED" : currentState)
              : readiness?.state || currentState;
    if (!canTransitionWaitingRoom(currentState, nextState)) throw new SecurityError("INVALID_WAITING_ROOM_TRANSITION", 409);
    const visitorPresence = nextVisitorPresence;
    const prisonerPresence = nextPrisonerPresence;
    const identityState = readiness?.checks.identity || String(current.identity_state || "pending");
    const cameraState = readiness?.checks.camera || String(current.camera_state || "pending");
    const microphoneState = readiness?.checks.microphone || String(current.microphone_state || "pending");
    const networkState = readiness?.checks.network || String(current.network_state || "pending");
    const roomState = readiness?.checks.room || String(current.room_state || "pending");
    const kioskState = readiness?.checks.kiosk || String(current.kiosk_state || "pending");
    const restrictionState = readiness?.checks.restriction || String(current.restriction_state || "pending");
    const nextAppointmentStatus = command === "start_visit" ? "IN_PROGRESS" : command === "cancel_visit" ? "CANCELLED_BY_FACILITY" : command === "admit_visitor" ? "WAITING" : String(current.appointment_status);
    const correlationId = crypto.randomUUID();
    let newSession: { id: string; roomName: string; roomSid: string | null } | null = null;
    if (command === "start_visit" && !current.session_id) {
      try {
        const provider = await createLiveKitProvider();
        newSession = { id: crypto.randomUUID(), ...(await provider.createSession(createProviderRoomName())) };
        roomCleanup = { provider, name: newSession.roomName };
      } catch (error) {
        if (error instanceof Error && error.message === "VIDEO_PROVIDER_NOT_CONFIGURED") throw new SecurityError("VIDEO_PROVIDER_NOT_CONFIGURED", 503);
        throw new SecurityError("VIDEO_PROVIDER_START_FAILED", 502);
      }
    }
    const eligibilityGuard = command === "start_visit" ? `AND EXISTS (
      SELECT 1 FROM prisoners p INNER JOIN facilities f ON f.id = appointments.facility_id
      WHERE p.id = appointments.prisoner_id AND p.facility_id = appointments.facility_id
        AND p.status = 'ACTIVE' AND p.visitation_status = 'APPROVED' AND f.current_state = 'NORMAL_OPERATIONS'
    )` : "";
    const statements = [
      d1.prepare(`UPDATE appointments SET status = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND facility_id = ? AND version = ? ${eligibilityGuard}`)
        .bind(nextAppointmentStatus, now, body.appointmentId, authorization.facilityId, Number(current.appointment_version || 1)),
      d1.prepare(`INSERT INTO waiting_room_sessions (appointment_id, facility_id, state, visitor_presence, prisoner_presence, identity_state, camera_state, microphone_state, network_state, room_state, kiosk_state, restriction_state, assigned_room_id, assigned_kiosk_id, staff_notes, version, last_checked_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0
        ON CONFLICT(appointment_id) DO UPDATE SET state = excluded.state, visitor_presence = excluded.visitor_presence, prisoner_presence = excluded.prisoner_presence, identity_state = excluded.identity_state, camera_state = excluded.camera_state, microphone_state = excluded.microphone_state, network_state = excluded.network_state, room_state = excluded.room_state, kiosk_state = excluded.kiosk_state, restriction_state = excluded.restriction_state, assigned_room_id = COALESCE(excluded.assigned_room_id, waiting_room_sessions.assigned_room_id), assigned_kiosk_id = COALESCE(excluded.assigned_kiosk_id, waiting_room_sessions.assigned_kiosk_id), staff_notes = COALESCE(excluded.staff_notes, waiting_room_sessions.staff_notes), version = excluded.version, last_checked_at = excluded.last_checked_at, updated_at = excluded.updated_at`)
        .bind(body.appointmentId, authorization.facilityId, nextState, visitorPresence, prisonerPresence, identityState, cameraState, microphoneState, networkState, roomState, kioskState, restrictionState, String(current.assigned_room_id || "") || null, String(current.assigned_kiosk_id || "") || null, body.staffNotes?.trim().slice(0, 500) || null, nextVersion, now, now, now),
      d1.prepare(`INSERT INTO audit_events (id, actor_user_id, actor_role, facility_id, action_type, entity_type, entity_id, reason, old_values, new_values, correlation_id, request_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), authorization.userId, authorization.roles[0] || null, authorization.facilityId, `WAITING_ROOM_${command.toUpperCase()}`, "waiting_room", body.appointmentId, reason, JSON.stringify({ state: current.state || "NOT_ARRIVED", version: currentVersion }), JSON.stringify({ state: nextState, version: nextVersion, checks: readiness?.checks || undefined }), correlationId, context.requestId, now),
      d1.prepare(`INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, facility_id, payload, correlation_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), `WAITING_ROOM_${command.toUpperCase()}`, "appointment", body.appointmentId, authorization.facilityId, JSON.stringify({ appointmentId: body.appointmentId, command, state: nextState, sessionId: newSession?.id || current.session_id || null }), correlationId, now),
    ];
    if (newSession) {
      statements.push(d1.prepare(`INSERT INTO visit_sessions (id, appointment_id, facility_id, provider, provider_room_name, provider_room_sid, status, authorized_start_at, authorized_end_at, actual_started_at, created_by, recording_policy, recording_status, version, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(newSession.id, body.appointmentId, authorization.facilityId, "livekit", newSession.roomName, newSession.roomSid, "CONNECTING", String(current.requested_start || now), String(current.requested_end || new Date(Date.now() + 20 * 60_000).toISOString()), null, authorization.userId, "OFF", "NOT_RECORDED", 1, now, now));
      statements.push(d1.prepare(`INSERT INTO visit_session_events (id, session_id, event_type, source, participant_role, metadata, correlation_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
        .bind(crypto.randomUUID(), newSession.id, "SESSION_CREATED", "SECUREVISIT", "FACILITY", JSON.stringify({ appointmentId: body.appointmentId }), correlationId, now));
    }
    const results = await d1.batch(statements);
    if (!results[0]?.meta.changes) throw new SecurityError("STALE_APPOINTMENT_STATE", 409);
    roomCleanup = null;
    return finish({ appointmentId: body.appointmentId, sessionId: newSession?.id || current.session_id || null, state: nextState, version: nextVersion, correlationId });
  } catch (error) {
    if (roomCleanup) {
      try { await roomCleanup.provider.endRoom(roomCleanup.name); }
      catch (error) { operationalLog("error", { event: "LIVEKIT_ORPHAN_ROOM_CLEANUP_FAILED", requestId: context.requestId, error }); }
    }
    if (databaseRef && idempotency) {
      try { await releaseIdempotencyClaim(databaseRef, idempotency); } catch { /* Preserve the original waiting-room error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
