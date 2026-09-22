import { getD1 } from "../../../../db/runtime";
import { releaseVisitCredit } from "../../../../lib/server/credits";
import { releaseVisitResources, type Allocation } from "../../../../lib/server/resources";
import { appointmentDecisionStatements } from "../../../../lib/server/appointment-decisions";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { canTransitionAppointment } from "../../../../lib/server/workflow";

const commands = ["approve", "reject", "request_info", "cancel"] as const;
type AppointmentCommand = typeof commands[number];

async function getAssignedResources(d1: D1Database, facilityId: string, appointmentId: string): Promise<Allocation | null> {
  const result = await d1.prepare(`SELECT rr.resource_type, rr.resource_id, r.display_name
    FROM resource_reservations rr INNER JOIN resources r ON r.id = rr.resource_id
    WHERE rr.facility_id = ? AND rr.appointment_id = ? AND rr.status IN ('HELD', 'RESERVED', 'ACTIVE')`)
    .bind(facilityId, appointmentId).all<{ resource_type: string; resource_id: string; display_name: string }>();
  const room = result.results.find((item) => item.resource_type === "ROOM");
  const device = result.results.find((item) => item.resource_type === "DEVICE");
  return room && device
    ? { roomId: room.resource_id, roomName: room.display_name, deviceId: device.resource_id, deviceName: device.display_name, created: false }
    : null;
}

export async function GET(request: Request) {
  const context = await getRequestContext();
  try {
    const authorization = await requirePermission("appointment.review");
    const status = new URL(request.url).searchParams.get("status")?.trim();
    const d1 = await getD1();
    const result = status
      ? await d1.prepare(`SELECT a.id, a.visitor_user_id, u.display_name AS visitor_name, a.prisoner_id, p.prisoner_number, p.display_name AS prisoner_name, a.status, a.requested_start, a.requested_end, a.appointment_type, a.version, a.created_at, a.updated_at FROM appointments a INNER JOIN users u ON u.id = a.visitor_user_id INNER JOIN prisoners p ON p.id = a.prisoner_id WHERE a.facility_id = ? AND a.status = ? ORDER BY a.requested_start ASC`).bind(authorization.facilityId, status).all()
      : await d1.prepare(`SELECT a.id, a.visitor_user_id, u.display_name AS visitor_name, a.prisoner_id, p.prisoner_number, p.display_name AS prisoner_name, a.status, a.requested_start, a.requested_end, a.appointment_type, a.version, a.created_at, a.updated_at FROM appointments a INNER JOIN users u ON u.id = a.visitor_user_id INNER JOIN prisoners p ON p.id = a.prisoner_id WHERE a.facility_id = ? ORDER BY a.requested_start ASC`).bind(authorization.facilityId).all();
    return securityResponse({ appointments: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  try {
    const reviewer = await requirePermission("appointment.review");
    const body = await request.json() as { appointmentId?: unknown; command?: unknown; reason?: unknown; expectedVersion?: unknown };
    const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : "";
    const command = body.command as AppointmentCommand;
    if (!appointmentId || !commands.includes(command)) throw new SecurityError("INVALID_APPOINTMENT_COMMAND", 400);
    const authorization = command === "approve" ? await requirePermission("appointment.approve", reviewer.facilityId) : reviewer;
    const reason = assertReason(body.reason);
    const d1 = await getD1();
    const current = await d1.prepare(`SELECT a.id, a.facility_id, a.visitor_user_id, a.prisoner_id, a.status, a.version, a.requested_start, a.requested_end, p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state, ca.id AS credit_account_id, ca.available_credits,
      CASE WHEN EXISTS (SELECT 1 FROM credit_ledger_entries r WHERE r.appointment_id = a.id AND r.credit_account_id = ca.id AND r.entry_type = 'RESERVATION'
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t WHERE t.appointment_id = a.id AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))) THEN 1 ELSE 0 END AS active_credit_reservation,
      CASE WHEN EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.facility_id = a.facility_id AND vr.prisoner_id = a.prisoner_id AND vr.visitor_user_id = a.visitor_user_id AND vr.status = 'APPROVED') THEN 1 ELSE 0 END AS relationship_approved
      FROM appointments a INNER JOIN prisoners p ON p.id = a.prisoner_id INNER JOIN facilities f ON f.id = a.facility_id LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id WHERE a.id = ? AND a.facility_id = ?`).bind(appointmentId, authorization.facilityId).first<{ id: string; facility_id: string; visitor_user_id: string; prisoner_id: string; status: string; version: number; requested_start: string; requested_end: string; prisoner_status: string; visitation_status: string; facility_state: string; credit_account_id: string | null; available_credits: number | null; active_credit_reservation: number; relationship_approved: number }>();
    if (!current) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const nextStatus = command === "approve" ? "APPROVED" : command === "reject" ? "REJECTED" : command === "request_info" ? "UNDER_REVIEW" : "CANCELLED_BY_FACILITY";
    if (current.status === nextStatus) {
      if (command === "cancel" || command === "reject") {
        if (current.credit_account_id) await releaseVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason: `Appointment ${command}ed by facility.` });
        await releaseVisitResources(d1, appointmentId, authorization.facilityId);
      }
      const allocation = command === "approve" ? await getAssignedResources(d1, authorization.facilityId, appointmentId) : null;
      if (command === "approve" && !allocation) throw new SecurityError("APPOINTMENT_RESOURCE_ASSIGNMENT_INCOMPLETE", 500);
      return securityResponse({ appointmentId, status: nextStatus, idempotent: true, allocation: allocation && { roomId: allocation.roomId, roomName: allocation.roomName, deviceId: allocation.deviceId, deviceName: allocation.deviceName } }, 200, context.requestId);
    }
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_APPOINTMENT", 409);
    if (!canTransitionAppointment(current.status, nextStatus)) throw new SecurityError("INVALID_APPOINTMENT_TRANSITION", 409);
    if (command === "approve" && (current.prisoner_status !== "ACTIVE" || current.visitation_status !== "APPROVED" || !current.relationship_approved)) throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
    if (command === "approve" && current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_APPOINTMENTS", 409);
    if (command === "approve" && (!current.credit_account_id || (!current.active_credit_reservation && Number(current.available_credits || 0) < 1))) throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const results = await d1.batch(appointmentDecisionStatements(d1, {
      appointmentId,
      facilityId: authorization.facilityId,
      visitorUserId: current.visitor_user_id,
      fromStatus: current.status,
      toStatus: nextStatus,
      expectedVersion: current.version,
      actorUserId: authorization.userId,
      actorRole: authorization.roles[0] || "Scheduling Officer",
      command,
      reason,
      requestId: context.requestId,
      correlationId,
      now,
      creditAccountId: current.credit_account_id || undefined,
      approval: command === "approve" && current.credit_account_id
        ? { creditAccountId: current.credit_account_id, startsAt: current.requested_start, endsAt: current.requested_end }
        : undefined,
    }));
    if (!results[0]?.meta.changes) {
      const latest = await d1.prepare(`SELECT a.status, a.version, p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state, ca.available_credits, ca.reserved_credits,
        CASE WHEN EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.facility_id = a.facility_id AND vr.prisoner_id = a.prisoner_id AND vr.visitor_user_id = a.visitor_user_id AND vr.status = 'APPROVED') THEN 1 ELSE 0 END AS relationship_approved,
        CASE WHEN EXISTS (SELECT 1 FROM credit_ledger_entries r WHERE r.appointment_id = a.id AND r.credit_account_id = ca.id AND r.entry_type = 'RESERVATION'
          AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t WHERE t.appointment_id = a.id AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))) THEN 1 ELSE 0 END AS active_credit_reservation
        FROM appointments a INNER JOIN prisoners p ON p.id = a.prisoner_id INNER JOIN facilities f ON f.id = a.facility_id LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
        WHERE a.id = ? AND a.facility_id = ?`).bind(appointmentId, authorization.facilityId).first<{ status: string; version: number; prisoner_status: string; visitation_status: string; facility_state: string; relationship_approved: number; available_credits: number | null; reserved_credits: number | null; active_credit_reservation: number }>();
      if (latest?.status === nextStatus) {
        const allocation = command === "approve" ? await getAssignedResources(d1, authorization.facilityId, appointmentId) : null;
        if (command === "approve" && !allocation) throw new SecurityError("APPOINTMENT_RESOURCE_ASSIGNMENT_INCOMPLETE", 500);
        return securityResponse({ appointmentId, status: nextStatus, idempotent: true, allocation: allocation && { roomId: allocation.roomId, roomName: allocation.roomName, deviceId: allocation.deviceId, deviceName: allocation.deviceName } }, 200, context.requestId);
      }
      if (latest && latest.status === current.status && latest.version === current.version && command === "approve") {
        if (latest.prisoner_status !== "ACTIVE" || latest.visitation_status !== "APPROVED" || !latest.relationship_approved) throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
        if (latest.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_APPOINTMENTS", 409);
        if (!latest.active_credit_reservation && Number(latest.available_credits || 0) < 1) throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);
        throw new SecurityError("RESOURCE_RESERVATION_CONFLICT", 409);
      }
      throw new SecurityError("STALE_APPOINTMENT", 409);
    }
    const allocation = command === "approve" ? await getAssignedResources(d1, authorization.facilityId, appointmentId) : null;
    if (command === "approve" && !allocation) throw new SecurityError("APPOINTMENT_RESOURCE_ASSIGNMENT_INCOMPLETE", 500);
    const assignedResources = allocation ? { roomId: allocation.roomId, roomName: allocation.roomName, deviceId: allocation.deviceId, deviceName: allocation.deviceName } : null;
    return securityResponse({ appointmentId, status: nextStatus, version: current.version + 1, allocation: assignedResources, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
