import { getD1 } from "../../../../db/runtime";
import { controlAppointmentsStatement } from "../../../../lib/server/control-appointments";
import { releaseVisitCredit } from "../../../../lib/server/credits";
import { releaseVisitResources, type Allocation } from "../../../../lib/server/resources";
import { appointmentDecisionStatements } from "../../../../lib/server/appointment-decisions";
import { claimIdempotency, hashIdempotencyPayload, releaseIdempotencyClaim, type IdempotencyClaim } from "../../../../lib/server/idempotency";
import { assertReason, getRequestContext, requirePermission, securityErrorResponse, securityResponse, SecurityError } from "../../../../lib/server/security";
import { canTransitionAppointment } from "../../../../lib/server/workflow";
import { validateVisitWindow } from "../../../../lib/server/visit-policy";

const commands = ["approve", "reject", "request_info", "cancel", "no_show"] as const;
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
    const result = await controlAppointmentsStatement(d1, authorization.facilityId, status).all();
    return securityResponse({ appointments: result.results, facilityId: authorization.facilityId }, 200, context.requestId);
  } catch (error) {
    return securityErrorResponse(error, context.requestId);
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();
  let d1: D1Database | null = null;
  let idempotency: { claimId: string; scope: string; key: string } | null = null;
  try {
    const reviewer = await requirePermission("appointment.review");
    const body = await request.json() as { appointmentId?: unknown; command?: unknown; reason?: unknown; expectedVersion?: unknown };
    const appointmentId = typeof body.appointmentId === "string" ? body.appointmentId.trim() : "";
    const command = body.command as AppointmentCommand;
    if (!appointmentId || !commands.includes(command)) throw new SecurityError("INVALID_APPOINTMENT_COMMAND", 400);
    const authorization = command === "approve" ? await requirePermission("appointment.approve", reviewer.facilityId) : reviewer;
    const reason = assertReason(body.reason);
    d1 = await getD1();
    const current = await d1.prepare(`SELECT a.id, a.facility_id, a.visitor_user_id, a.prisoner_id, a.status, a.version, a.requested_start, a.requested_end, a.timezone AS appointment_timezone, a.policy_version AS appointment_policy_version, a.duration_minutes, p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state, f.timezone AS facility_timezone, vp.version AS policy_version, vp.min_duration_minutes, vp.max_duration_minutes, vp.min_advance_minutes, vp.max_advance_days, vp.daily_start_time, vp.daily_end_time, ca.id AS credit_account_id, ca.available_credits,
      CASE WHEN EXISTS (SELECT 1 FROM credit_ledger_entries r WHERE r.appointment_id = a.id AND r.credit_account_id = ca.id AND r.entry_type = 'RESERVATION'
        AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t WHERE t.appointment_id = a.id AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))) THEN 1 ELSE 0 END AS active_credit_reservation,
      CASE WHEN EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.facility_id = a.facility_id AND vr.prisoner_id = a.prisoner_id AND vr.visitor_user_id = a.visitor_user_id AND vr.status = 'APPROVED') THEN 1 ELSE 0 END AS relationship_approved
      FROM appointments a INNER JOIN prisoners p ON p.id = a.prisoner_id INNER JOIN facilities f ON f.id = a.facility_id LEFT JOIN visit_policies vp ON vp.facility_id = f.id LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id WHERE a.id = ? AND a.facility_id = ?`).bind(appointmentId, authorization.facilityId).first<{ id: string; facility_id: string; visitor_user_id: string; prisoner_id: string; status: string; version: number; requested_start: string; requested_end: string; appointment_timezone: string | null; appointment_policy_version: number | null; duration_minutes: number | null; prisoner_status: string; visitation_status: string; facility_state: string; facility_timezone: string | null; policy_version: number | null; min_duration_minutes: number | null; max_duration_minutes: number | null; min_advance_minutes: number | null; max_advance_days: number | null; daily_start_time: string | null; daily_end_time: string | null; credit_account_id: string | null; available_credits: number | null; active_credit_reservation: number; relationship_approved: number }>();
    if (!current) throw new SecurityError("APPOINTMENT_NOT_FOUND", 404);
    const nextStatus = command === "approve" ? "APPROVED" : command === "reject" ? "REJECTED" : command === "request_info" ? "UNDER_REVIEW" : command === "no_show" ? "NO_SHOW" : "CANCELLED_BY_FACILITY";
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) throw new SecurityError("IDEMPOTENCY_KEY_REQUIRED", 400);
    const idempotencyScope = `appointment-decision:${authorization.facilityId}:${authorization.userId}:${appointmentId}`;
    const requestHash = await hashIdempotencyPayload({ appointmentId, command, reason, expectedVersion: body.expectedVersion ?? current.version });
    const claimed: IdempotencyClaim = await claimIdempotency(d1, { scope: idempotencyScope, key: idempotencyKey, requestHash });
    if ("replay" in claimed) return securityResponse(claimed.replay.body, claimed.replay.status, context.requestId);
    idempotency = { claimId: claimed.claimId, scope: idempotencyScope, key: idempotencyKey };
    if (current.status === nextStatus) {
      if (command === "cancel" || command === "reject" || command === "no_show") {
        if (current.credit_account_id) await releaseVisitCredit(d1, { accountId: current.credit_account_id, appointmentId, actorUserId: authorization.userId, reason: `Appointment ${command}ed by facility.` });
        await releaseVisitResources(d1, appointmentId, authorization.facilityId);
      }
      const allocation = command === "approve" ? await getAssignedResources(d1, authorization.facilityId, appointmentId) : null;
      if (command === "approve" && !allocation) throw new SecurityError("APPOINTMENT_RESOURCE_ASSIGNMENT_INCOMPLETE", 500);
      const responseBody = { appointmentId, status: nextStatus, idempotent: true, allocation: allocation && { roomId: allocation.roomId, roomName: allocation.roomName, deviceId: allocation.deviceId, deviceName: allocation.deviceName } };
      const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(200, JSON.stringify(responseBody), new Date().toISOString(), idempotency.claimId, idempotency.scope, idempotency.key).run();
      if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
      idempotency = null;
      return securityResponse(responseBody, 200, context.requestId);
    }
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== current.version) throw new SecurityError("STALE_APPOINTMENT", 409);
    if (!canTransitionAppointment(current.status, nextStatus)) throw new SecurityError("INVALID_APPOINTMENT_TRANSITION", 409);
    if (command === "no_show" && Date.parse(current.requested_end) > Date.now()) throw new SecurityError("NO_SHOW_TOO_EARLY", 409);
    if (command === "approve" && (current.prisoner_status !== "ACTIVE" || current.visitation_status !== "APPROVED" || !current.relationship_approved)) throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
    if (command === "approve" && current.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_APPOINTMENTS", 409);
    if (command === "approve" && (!current.credit_account_id || (!current.active_credit_reservation && Number(current.available_credits || 0) < 1))) throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);
    let approvalWindow: Extract<ReturnType<typeof validateVisitWindow>, { ok: true }> | null = null;
    if (command === "approve") {
      if (current.policy_version === null || current.facility_timezone === null || current.appointment_policy_version === null || current.duration_minutes === null || current.appointment_policy_version !== current.policy_version || current.appointment_timezone !== current.facility_timezone) throw new SecurityError("FACILITY_POLICY_CHANGED", 409);
      const window = validateVisitWindow(current.requested_start, current.requested_end, Date.now(), {
        timezone: current.facility_timezone,
        min_duration_minutes: current.min_duration_minutes,
        max_duration_minutes: current.max_duration_minutes,
        min_advance_minutes: current.min_advance_minutes,
        max_advance_days: current.max_advance_days,
        daily_start_time: current.daily_start_time,
        daily_end_time: current.daily_end_time,
      });
      if (!window.ok) throw new SecurityError(window.reason, window.reason.startsWith("FACILITY_") ? 503 : 409);
      if (current.policy_version === null || current.facility_timezone === null) throw new SecurityError("FACILITY_POLICY_NOT_CONFIGURED", 503);
      approvalWindow = window;
    }
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
      approval: command === "approve" && current.credit_account_id && approvalWindow && current.policy_version !== null && current.facility_timezone
        ? {
          creditAccountId: current.credit_account_id,
          startsAt: current.requested_start,
          endsAt: current.requested_end,
          policyVersion: current.policy_version,
          facilityTimezone: current.facility_timezone,
          durationMinutes: current.duration_minutes!,
          earliestStartAt: approvalWindow.earliestStartAt,
          latestStartAt: approvalWindow.latestStartAt,
        }
        : undefined,
    }));
    if (!results[0]?.meta.changes) {
      const latest = await d1.prepare(`SELECT a.status, a.version, a.requested_start, a.requested_end, p.status AS prisoner_status, p.visitation_status, f.current_state AS facility_state, f.timezone AS facility_timezone, vp.version AS policy_version, vp.min_duration_minutes, vp.max_duration_minutes, vp.min_advance_minutes, vp.max_advance_days, vp.daily_start_time, vp.daily_end_time, ca.available_credits, ca.reserved_credits,
        CASE WHEN EXISTS (SELECT 1 FROM visitor_relationships vr WHERE vr.facility_id = a.facility_id AND vr.prisoner_id = a.prisoner_id AND vr.visitor_user_id = a.visitor_user_id AND vr.status = 'APPROVED') THEN 1 ELSE 0 END AS relationship_approved,
        CASE WHEN EXISTS (SELECT 1 FROM credit_ledger_entries r WHERE r.appointment_id = a.id AND r.credit_account_id = ca.id AND r.entry_type = 'RESERVATION'
          AND NOT EXISTS (SELECT 1 FROM credit_ledger_entries t WHERE t.appointment_id = a.id AND t.entry_type IN ('RESERVATION_RELEASE', 'CONSUMPTION'))) THEN 1 ELSE 0 END AS active_credit_reservation,
        CASE WHEN EXISTS (SELECT 1 FROM appointments other WHERE other.id <> a.id AND other.facility_id = a.facility_id
          AND (other.visitor_user_id = a.visitor_user_id OR other.prisoner_id = a.prisoner_id)
          AND other.status IN ('APPROVED', 'WAITING', 'IN_PROGRESS') AND other.requested_start < a.requested_end AND other.requested_end > a.requested_start) THEN 1 ELSE 0 END AS appointment_overlap
        FROM appointments a INNER JOIN prisoners p ON p.id = a.prisoner_id INNER JOIN facilities f ON f.id = a.facility_id LEFT JOIN visit_policies vp ON vp.facility_id = f.id LEFT JOIN credit_accounts ca ON ca.user_id = a.visitor_user_id AND ca.facility_id = a.facility_id
        WHERE a.id = ? AND a.facility_id = ?`).bind(appointmentId, authorization.facilityId).first<{ status: string; version: number; requested_start: string; requested_end: string; prisoner_status: string; visitation_status: string; facility_state: string; facility_timezone: string | null; policy_version: number | null; min_duration_minutes: number | null; max_duration_minutes: number | null; min_advance_minutes: number | null; max_advance_days: number | null; daily_start_time: string | null; daily_end_time: string | null; relationship_approved: number; available_credits: number | null; reserved_credits: number | null; active_credit_reservation: number; appointment_overlap: number }>();
      if (latest?.status === nextStatus) {
        const allocation = command === "approve" ? await getAssignedResources(d1, authorization.facilityId, appointmentId) : null;
        if (command === "approve" && !allocation) throw new SecurityError("APPOINTMENT_RESOURCE_ASSIGNMENT_INCOMPLETE", 500);
        const responseBody = { appointmentId, status: nextStatus, idempotent: true, allocation: allocation && { roomId: allocation.roomId, roomName: allocation.roomName, deviceId: allocation.deviceId, deviceName: allocation.deviceName } };
        const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(200, JSON.stringify(responseBody), new Date().toISOString(), idempotency.claimId, idempotency.scope, idempotency.key).run();
        if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
        idempotency = null;
        return securityResponse(responseBody, 200, context.requestId);
      }
      if (latest && latest.status === current.status && latest.version === current.version && command === "approve") {
        if (latest.prisoner_status !== "ACTIVE" || latest.visitation_status !== "APPROVED" || !latest.relationship_approved) throw new SecurityError("PRISONER_NOT_AVAILABLE", 409);
        if (latest.facility_state !== "NORMAL_OPERATIONS") throw new SecurityError("FACILITY_NOT_ACCEPTING_APPOINTMENTS", 409);
        if (!latest.active_credit_reservation && Number(latest.available_credits || 0) < 1) throw new SecurityError("INSUFFICIENT_VISIT_CREDITS", 409);
        if (latest.policy_version !== current.policy_version || latest.facility_timezone !== current.facility_timezone) throw new SecurityError("FACILITY_POLICY_CHANGED", 409);
        const latestWindow = validateVisitWindow(latest.requested_start, latest.requested_end, Date.now(), {
          timezone: latest.facility_timezone,
          min_duration_minutes: latest.min_duration_minutes,
          max_duration_minutes: latest.max_duration_minutes,
          min_advance_minutes: latest.min_advance_minutes,
          max_advance_days: latest.max_advance_days,
          daily_start_time: latest.daily_start_time,
          daily_end_time: latest.daily_end_time,
        });
        if (!latestWindow.ok) throw new SecurityError("APPOINTMENT_NO_LONGER_ELIGIBLE", 409);
        if (latest.appointment_overlap) throw new SecurityError("APPOINTMENT_OVERLAP", 409);
        throw new SecurityError("RESOURCE_RESERVATION_CONFLICT", 409);
      }
      throw new SecurityError("STALE_APPOINTMENT", 409);
    }
    const allocation = command === "approve" ? await getAssignedResources(d1, authorization.facilityId, appointmentId) : null;
    if (command === "approve" && !allocation) throw new SecurityError("APPOINTMENT_RESOURCE_ASSIGNMENT_INCOMPLETE", 500);
    const assignedResources = allocation ? { roomId: allocation.roomId, roomName: allocation.roomName, deviceId: allocation.deviceId, deviceName: allocation.deviceName } : null;
    const responseBody = { appointmentId, status: nextStatus, version: current.version + 1, allocation: assignedResources, correlationId };
    const completed = await d1.prepare("UPDATE idempotency_records SET status = 'COMPLETED', response_status = ?, response_body = ?, completed_at = ? WHERE id = ? AND scope = ? AND idempotency_key = ? AND status = 'PROCESSING'").bind(200, JSON.stringify(responseBody), new Date().toISOString(), idempotency.claimId, idempotency.scope, idempotency.key).run();
    if (!completed.meta.changes) throw new SecurityError("IDEMPOTENCY_RETRY_REQUIRED", 409);
    idempotency = null;
    return securityResponse(responseBody, 200, context.requestId);
  } catch (error) {
    if (d1 && idempotency) {
      try { await releaseIdempotencyClaim(d1, idempotency); } catch { /* Preserve the original appointment decision error. */ }
    }
    return securityErrorResponse(error, context.requestId);
  }
}
