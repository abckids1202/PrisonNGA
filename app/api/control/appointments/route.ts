import { getD1 } from "../../../../db/runtime";
import { releaseVisitCredit, reserveVisitCredit } from "../../../../lib/server/credits";
import { allocateVisitResources, releaseVisitResources, type Allocation } from "../../../../lib/server/resources";
import { appendAuditAndOutbox } from "../../../../lib/server/events";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { canTransitionAppointment } from "../../../../lib/server/workflow";

const commands = ["approve", "reject", "request_info", "cancel"] as const;
type AppointmentCommand = typeof commands[number];

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
    const current = await d1.prepare(`SELECT a.id, a.facility_id, a.visitor_user_id, a.prisoner_id, a.status, a.version, a.requested_start, a.requested_end, p.visitation_status, ca.id AS credit_account_id, ca.available_credits FROM appointments a INNER JOIN prisoners p ON p.id = a.prisoner_id LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id WHERE a.id = ? AND a.facility_id = ?`).bind(appointmentId, authorization.facilityId).first<{ id: string; facility_id: string; visitor_user_id: string; prisoner_id: string; status: string; version: number; requested_start: string; requested_end: string; visitation_status: string; credit_account_id: string | null; available_credits: number | null }>();
    if (!current) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_APPOINTMENT", 409);
    const nextStatus = command === "approve" ? "APPROVED" : command === "reject" ? "REJECTED" : command === "request_info" ? "UNDER_REVIEW" : "CANCELLED_BY_FACILITY";
    if (current.status === nextStatus) {
      if (command === "cancel") {
        if (current.credit_account_id) await releaseVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason: "Appointment cancelled by facility." });
        await releaseVisitResources(d1, appointmentId, authorization.facilityId);
      }
      return securityResponse({ appointmentId, status: nextStatus, idempotent: true }, 200, context.requestId);
    }
    if (!canTransitionAppointment(current.status, nextStatus)) throw new SecurityError("INVALID_APPOINTMENT_TRANSITION", 409);
    if (command === "approve" && current.visitation_status !== "APPROVED") throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
    if (command === "approve" && (!current.credit_account_id || Number(current.available_credits || 0) < 1)) throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);
    const now = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements = [
      d1.prepare(`UPDATE appointments SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND facility_id = ? AND version = ?`).bind(nextStatus, now, appointmentId, authorization.facilityId, current.version),
      d1.prepare(`INSERT INTO appointment_status_events (id, appointment_id, from_status, to_status, actor_user_id, reason_code, reason_text, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), appointmentId, current.status, nextStatus, authorization.userId, `STAFF_${command.toUpperCase()}`, reason, correlationId, now),
    ];
    let reservationCreated = false;
    let resourcesAllocated = false;
    let allocation: Allocation | null = null;
    if (command === "approve" && current.credit_account_id) {
      const reservation = await reserveVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason });
      reservationCreated = reservation.created;
      try {
        allocation = await allocateVisitResources(d1, { facilityId: authorization.facilityId, appointmentId, startsAt: current.requested_start, endsAt: current.requested_end });
        resourcesAllocated = allocation.created;
      } catch (error) {
        await releaseVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason: "Resource allocation failed; credit reservation released." });
        throw error;
      }
    }
    let results: Array<{ meta: { changes: number } }>;
    try {
      results = await d1.batch(statements);
    } catch (error) {
      if (reservationCreated && current.credit_account_id) {
        await releaseVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason: "Appointment state update failed; reservation released." });
      }
      if (resourcesAllocated) await releaseVisitResources(d1, appointmentId, authorization.facilityId);
      throw error;
    }
    if (!results[0]?.meta.changes) {
      if (reservationCreated && current.credit_account_id) {
        await releaseVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason: "Appointment was already changed; reservation released." });
      }
      if (resourcesAllocated) await releaseVisitResources(d1, appointmentId, authorization.facilityId);
      throw new SecurityError("STALE_APPOINTMENT", 409);
    }
    if (command === "approve" && !reservationCreated) throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);
    if ((command === "cancel" || command === "reject") && current.credit_account_id) {
      await releaseVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason: `Appointment ${command}ed by facility.` });
      await releaseVisitResources(d1, appointmentId, authorization.facilityId);
    } else if (command === "cancel") {
      await releaseVisitResources(d1, appointmentId, authorization.facilityId);
    }
    await appendAuditAndOutbox({ actorUserId: authorization.userId, actorRole: authorization.roles[0] || "Scheduling Officer", facilityId: authorization.facilityId, actionType: `APPOINTMENT_${command.toUpperCase()}`, entityType: "appointment", entityId: appointmentId, reason, oldValues: { status: current.status }, newValues: { status: nextStatus }, requestId: context.requestId, correlationId, eventType: `APPOINTMENT_${command.toUpperCase()}`, payload: { appointmentId, status: nextStatus, visitorUserId: current.visitor_user_id } });
    const assignedResources = allocation ? { roomId: allocation.roomId, roomName: allocation.roomName, deviceId: allocation.deviceId, deviceName: allocation.deviceName } : null;
    return securityResponse({ appointmentId, status: nextStatus, version: current.version + 1, allocation: assignedResources, correlationId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}
